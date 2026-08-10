import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Pool } from 'pg'
import { createApp, hostGateDecision } from './app'
import { LEAGUE_URL_DDL } from './leagueUrl'
import { RENDER_CLAIM_DDL } from './renderClaims'
import { PHYSICAL_MERCH_DDL } from './physicalMerchSchema'
import { sslMemberMigration2026_08_02 } from './sslMemberMigration'
import { startAutoLiveScanner } from './autoLive'
import { ensureSchema } from './ensureSchema'
import { startAutoYouTubeScanner } from './autoYouTube'
import { startTournamentEndSweeper } from './tournamentEndSweep'
import { backfillEntrantsFromRegistrations } from './tournamentEntrants'
import { shouldServeSpaShell } from './staticDelivery'

// Production entry: talks to your real Postgres (Cloud SQL / RDS / self-hosted).
//   Standard TCP form:  DATABASE_URL=postgres://user:pass@host:5432/killcam
//   Cloud Run + Cloud SQL unix socket (recommended for this deploy):
//     DATABASE_URL=postgresql://USER:PASS@/killcam?host=/cloudsql/reelone-498406:REGION:INSTANCE
// pg accepts either form as a connectionString. On Cloud Run we build it from
// parts (matching the existing service's env + Secret Manager secrets) so the
// DB password stays a secret and we reuse the Cloud SQL unix socket.
const connectionString =
  process.env.DATABASE_URL ||
  (process.env.INSTANCE_CONNECTION_NAME
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD || '')}@/${process.env.DB_NAME}?host=/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`
    : undefined)
const configuredPoolMax = Number(process.env.DB_POOL_MAX || 5)
const pool = new Pool({
  connectionString,
  max: Math.max(1, Math.min(20, Number.isFinite(configuredPoolMax) ? Math.round(configuredPoolMax) : 5)),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})
pool.on('error', (error) => console.warn('[db] idle client error:', error.message))

// createApp gives us the API (everything under /api, plus /health). The product
// SPA owns the root origin. Marketing is a route inside that SPA at /marketing,
// so the web app and the installed Capacitor app use the same route tree.
const app = createApp(pool)

// One-time, idempotent repair on every boot: make sure every user has a profile
// row AND a username. Older signups could leave profiles.username blank (a
// schema trigger pre-created the row, and the old insert used `do nothing`),
// which made those players unsearchable in Discover. This fills the gap from
// user_metadata without ever clobbering a good name or creating a duplicate.
async function backfillProfiles() {
  try {
    await pool.query(
      `insert into profiles (id, username)
       select u.id, coalesce(nullif(u.user_metadata->>'username',''), 'user_'||left(u.id::text,8))
       from users u
       on conflict (id) do nothing`,
    )
    // Sync the searchable handle to the account's real username whenever it's
    // blank OR out of sync (the display name is read from metadata, so a mismatch
    // means the player is findable under the wrong name — or not at all). The
    // not-exists guard skips anyone whose target handle is already taken (e.g. a
    // dedup-suffixed row), so this can never collide.
    const r = await pool.query(
      `update profiles p
         set username = u.user_metadata->>'username'
       from users u
       where p.id = u.id
         and nullif(u.user_metadata->>'username','') is not null
         and lower(coalesce(p.username,'')) is distinct from lower(u.user_metadata->>'username')
         and not exists (
           select 1 from profiles p2
           where lower(p2.username) = lower(u.user_metadata->>'username') and p2.id <> p.id
         )`,
    )
    // eslint-disable-next-line no-console
    console.log(`[boot] profile backfill ok (${r.rowCount ?? 0} usernames synced)`)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[boot] profile backfill skipped:', (e as Error).message)
  }
}
void backfillProfiles()

// Create the artifact-economy + hosting tables on boot (migrations 015/016).
// The server doesn't run a migration tool, so these idempotent CREATEs are how
// the tables reach production — without them the Forge/Rewards writes no-op.
async function bootstrapTables() {
  const ddl = [
    `create table if not exists public.worker_leases (
       lease_name text primary key,
       owner_id text not null,
       lease_until timestamptz not null,
       updated_at timestamptz not null default now())`,
    `create index if not exists worker_leases_expiry_idx on public.worker_leases(lease_until)`,
    `create table if not exists public.artifacts (
       id uuid primary key default gen_random_uuid(),
       owner_id uuid not null, slug text not null, name text not null,
       rarity text not null default 'common', capability text not null default 'none',
       code text unique, image_url text, price_cents integer,
       redeemed_by uuid, redeemed_at timestamptz,
       recipe_code text, forge_tier text, power_payload jsonb not null default '[]',
       power_score integer not null default 0, slot_cost integer not null default 0,
       official_override boolean not null default false, clan_id uuid,
       powers jsonb not null default '[]', shirt_ref text,
       used_at timestamptz, created_at timestamptz not null default now())`,
    `create index if not exists artifacts_owner_idx on public.artifacts(owner_id)`,
    `alter table public.artifacts add column if not exists recipe_code text`,
    `alter table public.artifacts add column if not exists forge_tier text`,
    `alter table public.artifacts add column if not exists power_payload jsonb not null default '[]'`,
    `alter table public.artifacts add column if not exists power_score integer not null default 0`,
    `alter table public.artifacts add column if not exists slot_cost integer not null default 0`,
    `alter table public.artifacts add column if not exists official_override boolean not null default false`,
    `alter table public.artifacts add column if not exists clan_id uuid`,
    `alter table public.artifacts add column if not exists used_at timestamptz`,
    // Unified-forge paid extras (see src/lib/forgeTiers.ts): creator-authored
    // powers (Pro+) and the bundled t-shirt reference (Legend). Written only by
    // /api/fn/forge-artifact-save — both are PRIVILEGE_COLS in server/app.ts.
    `alter table public.artifacts add column if not exists powers jsonb not null default '[]'`,
    `alter table public.artifacts add column if not exists shirt_ref text`,
    `create index if not exists artifacts_recipe_idx on public.artifacts(owner_id, recipe_code, created_at)`,
    `create table if not exists public.posts (
       id uuid primary key default gen_random_uuid(), user_id uuid not null,
       body text not null default '', created_at timestamptz default now(),
       updated_at timestamptz default now())`,
    `create table if not exists public.post_attachments (
       id uuid primary key default gen_random_uuid(), post_id uuid not null,
       type text not null, url_or_id text not null, sort_order integer default 0,
       created_at timestamptz default now())`,
    `create table if not exists public.post_comments (
       id uuid primary key default gen_random_uuid(), post_id uuid not null, user_id uuid not null,
       body text not null, created_at timestamptz default now())`,
    `create index if not exists idx_post_comments_post on public.post_comments(post_id, created_at)`,
    `create table if not exists public.post_likes (
       id uuid primary key default gen_random_uuid(), post_id uuid not null, user_id uuid not null,
       created_at timestamptz default now(), unique(post_id, user_id))`,
    `create index if not exists idx_post_likes_post on public.post_likes(post_id)`,
    `create table if not exists public.post_polls (
       id uuid primary key default gen_random_uuid(), post_id uuid not null unique,
       question text not null, ends_at timestamptz, created_at timestamptz default now())`,
    `create table if not exists public.post_poll_options (
       id uuid primary key default gen_random_uuid(), poll_id uuid not null,
       label text not null, sort_order integer default 0, created_at timestamptz default now())`,
    `create table if not exists public.post_poll_votes (
       id uuid primary key default gen_random_uuid(), option_id uuid not null, user_id uuid not null,
       created_at timestamptz default now(), unique(option_id, user_id))`,
    `create table if not exists public.dm_conversations (
       id uuid primary key default gen_random_uuid(), name text, pair_key text unique,
       created_at timestamptz default now(), updated_at timestamptz default now())`,
    `alter table public.dm_conversations add column if not exists pair_key text`,
    `create unique index if not exists uq_dm_conversations_pair
       on public.dm_conversations(pair_key)`,
    `create table if not exists public.dm_participants (
       id uuid primary key default gen_random_uuid(), conversation_id uuid not null,
       user_id uuid not null, joined_at timestamptz default now(),
       unique(conversation_id, user_id))`,
    `create table if not exists public.dm_messages (
       id uuid primary key default gen_random_uuid(), conversation_id uuid not null,
       user_id uuid not null, content text not null default '',
       created_at timestamptz default now())`,
    `create index if not exists idx_dm_messages_conversation
       on public.dm_messages(conversation_id, created_at desc)`,
    `create index if not exists idx_dm_participants_user
       on public.dm_participants(user_id)`,
    `create table if not exists public.oracle_live_rounds (
       id uuid primary key default gen_random_uuid(), stream_id uuid not null,
       match_ref text not null unique, status text not null default 'open',
       choices jsonb not null default '[]'::jsonb, opened_by uuid not null,
       opened_at timestamptz not null default now(), locks_at timestamptz not null,
       winning_choice text, losing_choice text, resolved_at timestamptz,
       updated_at timestamptz not null default now())`,
    `create index if not exists oracle_live_rounds_stream_idx
       on public.oracle_live_rounds(stream_id, opened_at desc)`,
    `create unique index if not exists oracle_live_rounds_one_active_idx
       on public.oracle_live_rounds(stream_id) where status in ('open','locked')`,
    `create table if not exists public.activities (
       id uuid primary key default gen_random_uuid(), user_id uuid not null,
       type text not null, target_id uuid, target_meta jsonb default '{}',
       created_at timestamptz default now())`,
    `create index if not exists idx_activities_user_created
       on public.activities(user_id, created_at desc)`,
    `create table if not exists public.stream_messages (
       id uuid primary key default gen_random_uuid(), stream_id uuid not null,
       user_id uuid, content text not null, created_at timestamptz default now())`,
    `create index if not exists idx_stream_messages_stream
       on public.stream_messages(stream_id, created_at desc)`,
    `create table if not exists public.referrals (
       id uuid primary key default gen_random_uuid(),
       referrer_id uuid not null, referred_id uuid not null unique,
       went_paid boolean not null default false, created_at timestamptz not null default now())`,
    `create index if not exists referrals_referrer_idx on public.referrals(referrer_id)`,
    `create table if not exists public.gifted_subs (
       id uuid primary key default gen_random_uuid(),
       giver_id uuid not null, recipient_id uuid not null, artifact_id uuid,
       created_at timestamptz not null default now(), unique (giver_id, recipient_id))`,
    // ── Creator/streamer GOALS (paid-tier feature). Public read so viewers and
    //    the live banner can show a creator's live progress; all writes go
    //    through /api/fn/goal-set + /api/fn/goal-remove (TABLE_POLICY deny-write).
    `create table if not exists public.creator_goals (
       id uuid primary key default gen_random_uuid(),
       user_id uuid not null,
       kind text not null default 'custom',
       label text not null default '',
       target integer not null default 0,
       active boolean not null default true,
       created_at timestamptz not null default now())`,
    `create index if not exists creator_goals_user_idx on public.creator_goals(user_id, active)`,
    `create table if not exists public.match_versions (
       id uuid primary key default gen_random_uuid(),
       match_key text not null, version integer not null default 1, youtube_id text,
       angle_count integer not null default 2,
       participant_ids uuid[] not null default '{}', clip_ids uuid[] not null default '{}',
       source_angles jsonb not null default '[]'::jsonb,
       reason text not null default 'render', created_at timestamptz not null default now(),
       unique (match_key, version))`,
    `create table if not exists public.match_angles (
       id uuid primary key default gen_random_uuid(),
       match_key text not null, user_id uuid not null, youtube_video_id text not null,
       clip_record_id uuid, joined_at timestamptz not null default now(),
       included_in_version integer, status text not null default 'active',
       removed_at timestamptz, removal_reason text,
       unique (match_key, user_id))`,
    `create table if not exists public.video_hosts (
       id uuid primary key default gen_random_uuid(),
       match_key text not null, host_id uuid not null, kind text not null default 'commentary',
       tournament_id uuid, created_at timestamptz not null default now())`,
    `create table if not exists public.render_ledger (
       id uuid primary key default gen_random_uuid(),
       user_id uuid not null, match_key text not null, kind text not null default 'rerender',
       cost_usd numeric(8,4) not null default 0.05, created_at timestamptz not null default now())`,
    // ── Shinobi Conquest: the land board + battle log ──────────────────────
    `create table if not exists public.territories (
       id uuid primary key default gen_random_uuid(),
       name text not null, col integer not null, row integer not null,
       owner_clan_id uuid, captured_at timestamptz,
       protected_until timestamptz, protected_by_artifact_id uuid,
       created_at timestamptz not null default now(),
       unique (col, row))`,
    `alter table public.territories add column if not exists protected_until timestamptz`,
    `alter table public.territories add column if not exists protected_by_artifact_id uuid`,
    `create index if not exists territories_owner_idx on public.territories(owner_clan_id)`,
    `create table if not exists public.clan_battles (
       id uuid primary key default gen_random_uuid(),
       winner_clan_id uuid, loser_clan_id uuid, match_key text,
       territory_id uuid, created_at timestamptz not null default now())`,
    `create table if not exists public.conquest_artifact_activations (
       id uuid primary key default gen_random_uuid(),
       artifact_id uuid not null unique, user_id uuid not null, clan_id uuid not null,
       recipe_code text not null, effects jsonb not null default '[]',
       slot_cost integer not null default 0, official_override boolean not null default false,
       target_territory_id uuid, status text not null default 'active',
       activated_at timestamptz not null default now(), expires_at timestamptz)`,
    `create index if not exists conquest_activations_clan_idx
       on public.conquest_artifact_activations(clan_id, status, activated_at)`,
    `create table if not exists public.clan_conquest_state (
       clan_id uuid primary key, rivalry_reset_at timestamptz,
       reset_count integer not null default 0, updated_at timestamptz not null default now())`,
    `create table if not exists public.clan_basic_pass_pools (
       id uuid primary key default gen_random_uuid(), clan_id uuid not null,
       source_artifact_id uuid not null unique, total_count integer not null,
       remaining_count integer not null, duration_days integer not null default 30,
       created_at timestamptz not null default now())`,
    `create index if not exists clan_pass_pools_clan_idx
       on public.clan_basic_pass_pools(clan_id, remaining_count, created_at)`,
    `create table if not exists public.clan_basic_pass_entitlements (
       id uuid primary key default gen_random_uuid(), source_pool_id uuid not null,
       clan_id uuid not null, user_id uuid not null,
       starts_at timestamptz not null default now(), expires_at timestamptz not null,
       created_at timestamptz not null default now(), unique(source_pool_id, user_id))`,
    `create index if not exists clan_pass_entitlements_user_idx
       on public.clan_basic_pass_entitlements(user_id, clan_id, expires_at)`,
    // Alliances: two clans that AGREED to merge into a village. Battles between
    // allied clans don't count for land, and a village's combined size defends
    // its territory. One row per accepted pair.
    `create table if not exists public.clan_alliances (
       id uuid primary key default gen_random_uuid(),
       clan_id uuid not null, ally_clan_id uuid not null,
       created_at timestamptz not null default now(),
       unique (clan_id, ally_clan_id))`,
    // Pending alliance proposals — an alliance forms only when BOTH clans agree.
    `create table if not exists public.clan_alliance_requests (
       id uuid primary key default gen_random_uuid(),
       from_clan_id uuid not null, to_clan_id uuid not null,
       requester_id uuid, status text not null default 'pending',
       created_at timestamptz not null default now(),
       unique (from_clan_id, to_clan_id))`,
    // TKO King ladder — a rating per Shinobi + the never-ending match queue.
    `create table if not exists public.king_ratings (
       user_id uuid primary key, rating integer not null default 1000,
       matches integer not null default 0, wins integer not null default 0,
       updated_at timestamptz not null default now())`,
    `create table if not exists public.king_matches (
       id uuid primary key default gen_random_uuid(),
       player_a uuid not null, player_b uuid not null,
       proposals_a jsonb default '[]', proposals_b jsonb default '[]',
       agreed_time timestamptz, winner_id uuid,
       report_a_winner_id uuid, report_b_winner_id uuid,
       status text not null default 'proposing',
       created_at timestamptz not null default now())`,
    `alter table public.king_matches add column if not exists report_a_winner_id uuid`,
    `alter table public.king_matches add column if not exists report_b_winner_id uuid`,
    `create index if not exists idx_king_matches_open on public.king_matches(status)`,
    // clip_records columns the auto-match/render pipeline + power level need.
    // The live clip_records table predates these; ensureSchema (render worker)
    // adds them, but the MAIN app never ran it — so on production the column was
    // missing and recomputePower's query THREW, silently returning 0 for every
    // player. These idempotent ALTERs bring prod up to date on the app's own boot.
    `alter table public.clip_records add column if not exists lobby_id text`,
    `alter table public.clip_records add column if not exists participants text[] default '{}'`,
    `alter table public.clip_records add column if not exists composite_youtube_id text`,
    `create index if not exists idx_clip_records_composite on public.clip_records(composite_youtube_id)`,
    // Live streams heartbeat + host-curated angles. `updated_at` powers the
    // stale-live TTL (a dead stream stops blocking go-live and drops off the LIVE
    // NOW reads); live_stream_angles stores the extra players a host adds to their
    // multi-angle show. Both are additive & idempotent.
    `alter table public.live_streams add column if not exists updated_at timestamptz default now()`,
    // The game a live stream is playing. Powers the APPROVED_GAMES gate: only
    // approved-game streams are featured on the public "who's live" read. Defaults
    // to the one supported title so existing rows stay featured. Additive + idempotent.
    `alter table public.live_streams add column if not exists game text default 'Shinobi Striker'`,
    // Go Live setup config (grouped dropdowns on the client). All additive +
    // idempotent, all with safe defaults so existing rows keep working. Money
    // safety: price_cents is STORED only — no payment is collected here (Phase 2).
    `alter table public.live_streams add column if not exists chat_enabled boolean not null default true`,
    `alter table public.live_streams add column if not exists is_paid boolean not null default false`,
    `alter table public.live_streams add column if not exists price_cents integer`,
    `alter table public.live_streams add column if not exists tournament_id uuid`,
    `alter table public.live_streams add column if not exists host_share text not null default 'both'`,
    `alter table public.live_streams add column if not exists background_url text`,
    `alter table public.live_streams add column if not exists team_a text`,
    `alter table public.live_streams add column if not exists team_b text`,
    `alter table public.live_streams add column if not exists score_a integer not null default 0`,
    `alter table public.live_streams add column if not exists score_b integer not null default 0`,
    `alter table public.live_streams add column if not exists score_revision bigint not null default 0`,
    `alter table public.live_streams add column if not exists layout text not null default 'auto'`,
    `alter table public.live_streams add column if not exists show_bracket boolean not null default false`,
    `alter table public.live_streams add column if not exists source text not null default 'manual'`,
    `alter table public.live_streams add column if not exists external_stream_id text`,
    `alter table public.live_streams add column if not exists detected_live_at timestamptz`,
    `create index if not exists idx_live_streams_auto_source
       on public.live_streams(user_id, source, is_live, updated_at desc)`,
    `create unique index if not exists uq_live_streams_auto_external
       on public.live_streams(source, external_stream_id)
       where source='auto_youtube' and external_stream_id is not null`,
    `alter table public.profiles add column if not exists auto_detect_live boolean not null default true`,
    `create table if not exists public.auto_live_discoveries (
       id uuid primary key default gen_random_uuid(), user_id uuid not null,
       provider text not null default 'youtube', external_stream_id text not null,
       channel_url text not null, watch_url text not null, title text,
       status text not null default 'live', detection_method text not null,
       confidence real not null default 0, live_stream_id uuid,
       first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
       ended_at timestamptz, details jsonb not null default '{}'::jsonb,
       unique(user_id, provider, external_stream_id))`,
    `create index if not exists idx_auto_live_discoveries_status
       on public.auto_live_discoveries(status, last_seen_at desc)`,
    `create table if not exists public.shadow_match_analyses (
       id uuid primary key default gen_random_uuid(), source_fingerprint text not null unique,
       source_kind text not null default 'footage_group', source_ref text,
       status text not null default 'queued', match_signature text,
       game text not null default 'shinobi_striker', mode text,
       verdict jsonb not null default '{}'::jsonb, confidence real not null default 0,
       evidence_quality real not null default 0, analyzer text not null default 'local',
       model text, analyzer_version text, evidence jsonb not null default '[]'::jsonb,
       analysis jsonb not null default '{}'::jsonb, error text,
       created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
       completed_at timestamptz)`,
    `create index if not exists idx_shadow_match_analyses_status
       on public.shadow_match_analyses(status, confidence desc, updated_at desc)`,
    `create table if not exists public.shadow_match_participants (
       id uuid primary key default gen_random_uuid(), analysis_id uuid not null,
       profile_id uuid, detected_name text not null, team text,
       outcome text not null default 'unknown', kills integer, deaths integer, assists integer,
       confidence real not null default 0, evidence jsonb not null default '{}'::jsonb,
       unique(analysis_id, detected_name))`,
    `alter table public.tournament_battles add column if not exists round integer`,
    `alter table public.tournament_battles add column if not exists bracket_slot integer`,
    // Replay timeline timestamps: when the matchup was DECIDED (winner written
    // by /api/fn/tournament-bracket-winner) and when watch links last changed
    // (/api/fn/tournament-battle-media). Additive & idempotent; rows from
    // before these columns fall back to created_at in src/lib/tournamentReplay.
    `alter table public.tournament_battles add column if not exists decided_at timestamptz`,
    `alter table public.tournament_battles add column if not exists media_updated_at timestamptz`,
    // The end-time sweep (server/tournamentEndSweep.ts) scans for tournaments
    // whose end_at has passed and are not yet closed.
    `create index if not exists idx_tournaments_end_sweep on public.tournaments(status, end_at)`,
    // Which league brand a tournament runs under: 'tko' (the house brand) or a
    // leagues.slug like 'shinobistrikerleague'. Branding context only — picked
    // at creation, shown as the accent on the tournament header.
    `alter table public.tournaments add column if not exists league_slug text not null default 'tko'`,
    `create unique index if not exists uq_tournament_battle_bracket_slot
       on public.tournament_battles(tournament_id, round, bracket_slot)
       where round is not null and bracket_slot is not null`,
    // Per-side watch links ({a:{live_url,clip_urls},b:{...}}) — written only by
    // /api/fn/tournament-battle-media. Additive & idempotent.
    `alter table public.tournament_battles add column if not exists media jsonb`,
    `create table if not exists public.live_stream_angles (
       id uuid primary key default gen_random_uuid(),
       live_stream_id uuid not null, user_id uuid,
       label text, youtube_url text, created_at timestamptz not null default now())`,
    `create index if not exists idx_live_stream_angles_stream
       on public.live_stream_angles(live_stream_id, created_at)`,
    // LIVE ACTION SIGNAL — written by the PC-side watcher (tko_live_director)
    // via /api/internal/live-action after scoring live frames with the HUD
    // detectors; read by the client's AUTO director so the camera can follow
    // the action. `*_level` is 0-100 (100 = spike, e.g. a Secret Technique just
    // fired); `*_at` is the write time so clients can ignore stale scores.
    // Additive & idempotent.
    `alter table public.live_stream_angles add column if not exists action_level integer`,
    `alter table public.live_stream_angles add column if not exists action_at timestamptz`,
    `alter table public.live_streams add column if not exists host_action_level integer`,
    `alter table public.live_streams add column if not exists host_action_at timestamptz`,
    `alter table public.live_stream_angles add column if not exists fight_detected boolean not null default false`,
    `alter table public.live_stream_angles add column if not exists fight_mode text`,
    `alter table public.live_stream_angles add column if not exists fight_at timestamptz`,
    `alter table public.live_streams add column if not exists host_fight_detected boolean not null default false`,
    `alter table public.live_streams add column if not exists host_fight_mode text`,
    `alter table public.live_streams add column if not exists host_fight_at timestamptz`,
    // Host on-air shot ({layout, feeds[], at}) -- viewers on Host view mirror it.
    `alter table public.live_streams add column if not exists host_view jsonb`,
    // Co-stream INVITES: a host (or accepted co-host) invites a player to add
    // their OWN stream as an angle. `role` snapshots the invitee's streaming tier
    // at invite time (the ceiling is enforced server-side in the live-invite fn).
    // One invite per (stream, invitee). Additive & idempotent.
    `create table if not exists public.live_stream_invites (
       id uuid primary key default gen_random_uuid(),
       live_stream_id uuid not null,
       inviter_id uuid not null, invitee_id uuid not null,
       role text, status text not null default 'pending',
       created_at timestamptz not null default now(),
       unique (live_stream_id, invitee_id))`,
    `create index if not exists idx_live_stream_invites_invitee
       on public.live_stream_invites(invitee_id, status)`,
    `create index if not exists idx_live_stream_invites_stream
       on public.live_stream_invites(live_stream_id)`,
    `alter table public.profiles add column if not exists auto_merge_opt_out boolean not null default false`,
    // Who may reuse this player's footage inside TKO. The social two-hop circle
    // is the product default; the API validates every non-default value.
    `alter table public.profiles add column if not exists reel_usage_privacy text not null default 'followers_of_followers'`,
    // Persisted YouTube channel-id cache for the background scanners
    // (server/youtubeChannel.ts, operator audit 2026-08-03): the stored URL is
    // the member's @handle; the UC… id it resolves to is written back here so
    // [auto-youtube]/[auto-live] stop re-scraping the handle page every cycle
    // (the per-cycle scrape is what YouTube throttled from cloud egress IPs).
    `alter table public.user_youtube_links add column if not exists channel_id text`,
    `alter table public.match_versions add column if not exists participant_ids uuid[] not null default '{}'`,
    `alter table public.match_versions add column if not exists clip_ids uuid[] not null default '{}'`,
    `alter table public.match_versions add column if not exists source_angles jsonb not null default '[]'::jsonb`,
    `alter table public.match_versions add column if not exists reason text not null default 'render'`,
    `alter table public.match_angles add column if not exists clip_record_id uuid`,
    `alter table public.match_angles add column if not exists status text not null default 'active'`,
    `alter table public.match_angles add column if not exists removed_at timestamptz`,
    `alter table public.match_angles add column if not exists removal_reason text`,
    `create index if not exists match_angles_user_status_idx on public.match_angles(user_id, status)`,
    // Give a newly found pair time to collect player three/four before a worker
    // claims it. If an angle arrives during a render, request one fuller pass.
    `alter table public.render_jobs add column if not exists ready_at timestamptz not null default now()`,
    `alter table public.render_jobs add column if not exists rerender_requested boolean not null default false`,
    `create index if not exists idx_render_jobs_ready on public.render_jobs(status, ready_at, created_at)`,
    // ── ARTIFACT TAGS: a clan tag a user EQUIPS to show off everywhere ──────
    // A clan leader lists a tag (server-priced); a member buys+equips it. The
    // grant ledger (user_artifact_tags) is what "own/were granted" means; a
    // user equips exactly one at a time (user_equipped_tag, one row per user).
    `create table if not exists public.artifact_tags (
       id uuid primary key default gen_random_uuid(),
       clan_id uuid not null, creator_id uuid not null,
       tag_text text not null, price integer not null default 0,
       rarity text not null default 'common', created_at timestamptz not null default now())`,
    `create index if not exists idx_artifact_tags_clan on public.artifact_tags(clan_id)`,
    `create table if not exists public.user_artifact_tags (
       id uuid primary key default gen_random_uuid(),
       user_id uuid not null, artifact_tag_id uuid not null,
       granted_at timestamptz not null default now(), unique (user_id, artifact_tag_id))`,
    `create table if not exists public.user_equipped_tag (
       user_id uuid primary key, artifact_tag_id uuid not null,
       equipped_at timestamptz not null default now())`,
    // ── ORACLE VOTING: a 30s in-match outcome vote (+10 power if correct) ────
    `create table if not exists public.oracle_votes (
       id uuid primary key default gen_random_uuid(),
       user_id uuid not null, match_ref text not null, choice text not null,
       correct boolean, resolved_at timestamptz,
       created_at timestamptz not null default now(), unique (user_id, match_ref))`,
    `create index if not exists idx_oracle_votes_match on public.oracle_votes(match_ref)`,
    // The persistent Oracle bonus recomputePower ADDS to a player's power level.
    `alter table public.profiles add column if not exists oracle_points integer not null default 0`,
    // ── TKO-BETA tester chat membership ─────────────────────────────────────
    `create table if not exists public.chat_space_members (
       id uuid primary key default gen_random_uuid(),
       space_id uuid not null, user_id uuid not null,
       joined_at timestamptz not null default now(), unique (space_id, user_id))`,
    `create index if not exists idx_chat_space_members_user on public.chat_space_members(user_id)`,
    // Marketplace storefront ownership. Existing platform/reward rows are
    // normalized to official; new user listings default to creator.
    `alter table public.assets add column if not exists seller_type text not null default 'creator'`,
    `alter table public.assets add column if not exists clan_id uuid`,
    `alter table public.assets add column if not exists price_cents integer`,
    `alter table public.assets add column if not exists cash_enabled boolean not null default false`,
    `alter table public.assets add column if not exists paid_sweeps_enabled boolean not null default false`,
    `update public.assets
       set seller_type = case
         when origin in ('seed','reward','prize') or created_by is null then 'official'
         else coalesce(nullif(seller_type,''), 'creator')
       end`,
    `create index if not exists idx_assets_seller on public.assets(seller_type, clan_id, created_at desc)`,
    // Paid creator commerce. Free Give Points stay in wallets.sweeps and can
    // never enter these cash-settlement paths.
    `alter table public.wallets add column if not exists paid_sweeps_cents integer not null default 0`,
    `alter table public.wallet_ledger add column if not exists paid_sweeps_delta_cents integer not null default 0`,
    `alter table public.wallet_ledger drop constraint if exists wallet_ledger_kind_check`,
    `alter table public.wallet_ledger add constraint wallet_ledger_kind_check
       check (kind in ('purchase','grant','spend','prediction','tournament','clan_dues','marketplace','adjustment','wager'))`,
    `alter table public.creator_stripe_accounts add column if not exists transfers_enabled boolean not null default false`,
    `alter table public.creator_stripe_accounts add column if not exists tax_certified_at timestamptz`,
    `alter table public.creator_stripe_accounts add column if not exists tax_form_type text`,
    `alter table public.creator_stripe_accounts add column if not exists electronic_1099_consent_at timestamptz`,
    `alter table public.creator_stripe_accounts add column if not exists tax_consent_version text`,
    `alter table public.creator_stripe_accounts add column if not exists platform_fee_debit_consent_at timestamptz`,
    `alter table public.creator_stripe_accounts add column if not exists platform_fee_debit_consent_version text`,
    `create table if not exists public.creator_offers (
       id uuid primary key default gen_random_uuid(),
       seller_user_id uuid not null, seller_type text not null default 'creator',
       clan_id uuid, offer_type text not null, name text not null,
       description text not null default '', image_url text,
       price_cents integer not null, billing_interval text not null default 'month',
       cash_enabled boolean not null default true,
       paid_sweeps_enabled boolean not null default true,
       giftable boolean not null default true, active boolean not null default true,
       created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
    `create index if not exists idx_creator_offers_seller on public.creator_offers(seller_user_id, active, created_at desc)`,
    `create table if not exists public.creator_orders (
       id uuid primary key default gen_random_uuid(),
       buyer_id uuid not null, recipient_id uuid, seller_user_id uuid not null,
       seller_type text not null, clan_id uuid, asset_id text, offer_id uuid,
       payment_method text not null, list_price_cents integer not null,
       buyer_charge_cents integer not null, discount_cents integer not null default 0,
       seller_tier text not null default 'pro',
       seller_share_percent integer not null default 50,
       seller_share_cents integer not null, platform_share_cents integer not null,
       currency text not null default 'usd', status text not null default 'pending',
       stripe_checkout_session_id text, stripe_payment_intent_id text,
       stripe_subscription_id text, stripe_transfer_id text,
       idempotency_key text not null unique, created_at timestamptz not null default now(),
       paid_at timestamptz, updated_at timestamptz not null default now())`,
    `create unique index if not exists uq_creator_orders_checkout
       on public.creator_orders(stripe_checkout_session_id) where stripe_checkout_session_id is not null`,
    `create index if not exists idx_creator_orders_buyer on public.creator_orders(buyer_id, created_at desc)`,
    `create index if not exists idx_creator_orders_seller on public.creator_orders(seller_user_id, created_at desc)`,
    `alter table public.creator_orders add column if not exists seller_tier text not null default 'pro'`,
    `alter table public.creator_orders add column if not exists seller_share_percent integer not null default 50`,
    `create table if not exists public.creator_earnings (
       id uuid primary key default gen_random_uuid(), order_id uuid not null unique,
       seller_user_id uuid not null, amount_cents integer not null,
       status text not null default 'pending', stripe_transfer_id text,
       created_at timestamptz not null default now(), available_at timestamptz,
       transferred_at timestamptz, updated_at timestamptz not null default now())`,
    // Upgrade the legacy ad-revenue earnings table in place. Older deployments
    // used creator_id and had no order/payout audit columns.
    `alter table public.creator_earnings add column if not exists order_id uuid`,
    `alter table public.creator_earnings add column if not exists seller_user_id uuid`,
    `alter table public.creator_earnings add column if not exists stripe_transfer_id text`,
    `alter table public.creator_earnings add column if not exists available_at timestamptz`,
    `alter table public.creator_earnings add column if not exists transferred_at timestamptz`,
    `alter table public.creator_earnings add column if not exists updated_at timestamptz not null default now()`,
    `do $$
       begin
         if exists (
           select 1 from information_schema.columns
            where table_schema='public' and table_name='creator_earnings' and column_name='creator_id'
         ) then
           execute 'update public.creator_earnings
                       set seller_user_id=creator_id
                     where seller_user_id is null and creator_id is not null';
           execute 'alter table public.creator_earnings alter column creator_id drop not null';
         end if;
       end $$`,
    `alter table public.creator_earnings alter column seller_user_id set not null`,
    `alter table public.creator_earnings drop constraint if exists creator_earnings_status_check`,
    `alter table public.creator_earnings add constraint creator_earnings_status_check
       check (status in ('pending','available','transferred','reversed','accrued','payable','paid'))`,
    `create unique index if not exists uq_creator_earnings_order
       on public.creator_earnings(order_id)`,
    `create index if not exists idx_creator_earnings_seller on public.creator_earnings(seller_user_id, created_at desc)`,
    `create table if not exists public.creator_included_passes (
       id uuid primary key default gen_random_uuid(), member_user_id uuid not null,
       offer_id uuid not null, seller_user_id uuid not null,
       membership_tier text not null, cycle_key text not null,
       status text not null default 'active', starts_at timestamptz not null default now(),
       expires_at timestamptz not null, created_at timestamptz not null default now(),
       updated_at timestamptz not null default now(), unique(member_user_id, cycle_key))`,
    `create index if not exists idx_creator_included_passes_seller
       on public.creator_included_passes(seller_user_id, cycle_key, status)`,
    `create table if not exists public.creator_platform_fees (
       id uuid primary key default gen_random_uuid(), seller_user_id uuid not null,
       fee_type text not null, period_key text not null, source_ref text,
       total_fee_cents integer not null, seller_fee_cents integer not null,
       platform_fee_cents integer not null, included_pass_id uuid,
       status text not null default 'pending', stripe_payment_id text, error text,
       created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
       unique(seller_user_id, fee_type, period_key))`,
    `create index if not exists idx_creator_platform_fees_seller
       on public.creator_platform_fees(seller_user_id, status, period_key desc)`,
    `create table if not exists public.creator_entitlements (
       id uuid primary key default gen_random_uuid(), order_id uuid, included_pass_id uuid,
       user_id uuid not null, offer_id uuid not null, status text not null default 'active',
       stripe_subscription_id text, starts_at timestamptz not null default now(),
       expires_at timestamptz, created_at timestamptz not null default now(),
       updated_at timestamptz not null default now(), unique(order_id, user_id))`,
    `alter table public.creator_entitlements alter column order_id drop not null`,
    `alter table public.creator_entitlements add column if not exists included_pass_id uuid`,
    `create unique index if not exists uq_creator_entitlements_included_pass
       on public.creator_entitlements(included_pass_id, user_id) where included_pass_id is not null`,
    `create index if not exists idx_creator_entitlements_user on public.creator_entitlements(user_id, status, expires_at)`,
    `create index if not exists idx_creator_entitlements_subscription
       on public.creator_entitlements(stripe_subscription_id) where stripe_subscription_id is not null`,
    `create table if not exists public.paid_sweeps_purchases (
       id uuid primary key default gen_random_uuid(), user_id uuid not null,
       amount_cents integer not null, status text not null default 'pending',
       stripe_checkout_session_id text, stripe_payment_intent_id text,
       idempotency_key text not null unique, created_at timestamptz not null default now(),
       paid_at timestamptz, updated_at timestamptz not null default now())`,
    `create unique index if not exists uq_paid_sweeps_checkout
       on public.paid_sweeps_purchases(stripe_checkout_session_id) where stripe_checkout_session_id is not null`,
    `create index if not exists idx_paid_sweeps_user on public.paid_sweeps_purchases(user_id, created_at desc)`,
    // Tournament entry prize pools. Sweeps is the only enabled settlement path;
    // cash is reserved for a separately approved tournament-payment provider.
    `create table if not exists public.tournament_prize_pools (
       id uuid primary key default gen_random_uuid(), tournament_id uuid not null,
       currency text not null, entry_amount integer not null,
       paid_places integer not null default 3,
       prize_split_bps jsonb not null default '[7000,2000,1000]'::jsonb,
       status text not null default 'open', provider text not null default 'internal_sweeps',
       compliance_approved boolean not null default false, minimum_age integer not null default 18,
       allowed_regions jsonb not null default '[]'::jsonb, created_by uuid not null,
       created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
       locked_at timestamptz, settled_at timestamptz, cancelled_at timestamptz)`,
    `create index if not exists idx_tournament_prize_pools_tournament
       on public.tournament_prize_pools(tournament_id, created_at desc)`,
    `create unique index if not exists uq_tournament_prize_pool_active
       on public.tournament_prize_pools(tournament_id, currency)
       where status in ('draft','open','locked')`,
    `create table if not exists public.tournament_prize_entries (
       id uuid primary key default gen_random_uuid(), pool_id uuid not null,
       user_id uuid not null, amount integer not null, status text not null default 'pending',
       provider_payment_id text, entered_at timestamptz not null default now(),
       updated_at timestamptz not null default now(), unique(pool_id, user_id))`,
    `create index if not exists idx_tournament_prize_entries_pool
       on public.tournament_prize_entries(pool_id, status, entered_at)`,
    `create table if not exists public.tournament_prize_payouts (
       id uuid primary key default gen_random_uuid(), pool_id uuid not null,
       user_id uuid not null, placement integer not null,
       gross_amount integer not null, net_amount integer not null,
       provider_payout_id text, status text not null default 'paid',
       created_at timestamptz not null default now(), paid_at timestamptz,
       unique(pool_id, placement), unique(pool_id, user_id))`,
    `create index if not exists idx_tournament_prize_payouts_user
       on public.tournament_prize_payouts(user_id, created_at desc)`,
    // ── White-label LEAGUES (see the LEAGUES section in db/schema.sql). A
    //    league is the public identity of a re-skinned community; membership
    //    routes a signed-in user to THEIR league at `/` and picks the skin.
    //    Served by GET /api/league/:slug/config (app shell + renderer).
    `create table if not exists public.leagues (
       id uuid primary key default gen_random_uuid(),
       slug text unique not null, name text not null, domain text,
       colors jsonb not null default '{}'::jsonb, logo_url text, tagline text,
       music jsonb not null default '{}'::jsonb,
       video_ownership text not null default 'tko',
       tier text not null default 'starter', owner_id uuid,
       created_at timestamptz default now(), updated_at timestamptz default now())`,
    `create index if not exists idx_leagues_owner on public.leagues(owner_id)`,
    `create table if not exists public.league_members (
       id uuid primary key default gen_random_uuid(),
       league_id uuid not null, user_id uuid not null,
       role text not null default 'member', joined_at timestamptz default now(),
       unique(league_id, user_id))`,
    `create index if not exists idx_league_members_league on public.league_members(league_id)`,
    `create index if not exists idx_league_members_user on public.league_members(user_id)`,
    // ── LEAGUE URL IDENTITY, rung 3 (operator 2026-08-04: "users can attach
    //    their website name to our app if they pay for that level for their
    //    branding.. or they just get tko.cam/their league name"). The claimed
    //    SERVING domain plus its TXT ownership challenge. Purely additive —
    //    `domain` keeps being the free-text display value the Studio writes,
    //    and nothing reads custom_domain until a league claims one. The
    //    statements live in server/leagueUrl.ts so real Postgres and the
    //    pg-mem test harness can never drift on the shape.
    ...LEAGUE_URL_DDL,
    // ── RENDER CLAIMS (server/renderClaims.ts). "Who is rendering this video",
    //    shared between GPU boxes. Without it a second render machine costs
    //    money instead of making it: both boxes pick the same job, both burn
    //    the GPU, and both post a near-duplicate. Kept beside the DDL rather
    //    than inline so the tests and production can never drift on the shape.
    ...RENDER_CLAIM_DDL,
    // ── LEAGUE BILLING (db/schema.sql "LEAGUE BILLING"; src/lib/leaguePlans.ts).
    //    `tier` says WHICH plan, `plan_status` says whether it was PAID FOR.
    //    Both are needed because tier defaults to 'starter' — itself a $49 plan
    //    — so a Studio draft row would otherwise look identical to a purchase.
    //    Written only by the Stripe webhook; both are PRIVILEGE_COLS.
    `alter table public.leagues add column if not exists plan_status text not null default 'none'`,
    `alter table public.leagues add column if not exists plan_since timestamptz`,
    `alter table public.leagues add column if not exists plan_expires_at timestamptz`,
    `alter table public.leagues add column if not exists stripe_subscription_id text`,
    `alter table public.leagues add column if not exists stripe_customer_id text`,
    `create index if not exists idx_leagues_subscription on public.leagues(stripe_subscription_id)`,
    `create table if not exists public.league_plan_purchases (
       id uuid primary key default gen_random_uuid(),
       user_id uuid not null, league_id uuid,
       league_slug text not null, league_name text not null default '',
       plan text not null, status text not null default 'pending',
       stripe_checkout_session_id text unique, stripe_subscription_id text,
       stripe_customer_id text,
       amount_cents integer not null default 0, currency text not null default 'usd',
       paid_at timestamptz,
       created_at timestamptz default now(), updated_at timestamptz default now())`,
    `create index if not exists idx_league_plan_purchases_user
       on public.league_plan_purchases(user_id, created_at desc)`,
    `create index if not exists idx_league_plan_purchases_status
       on public.league_plan_purchases(status, created_at desc)`,
    // Lead capture: enterprise ("contact us"), and ANY plan whose Stripe price
    // is not configured yet. This is what makes the plans page safe to ship
    // before the operator has created the Stripe products — the prospect is
    // recorded instead of hitting a dead end.
    `create table if not exists public.league_leads (
       id uuid primary key default gen_random_uuid(),
       email text not null, plan text not null,
       league_name text not null default '', league_slug text not null default '',
       user_id uuid, note text,
       source text not null default 'enterprise',
       status text not null default 'new',
       created_at timestamptz default now(), updated_at timestamptz default now())`,
    `create index if not exists idx_league_leads_status
       on public.league_leads(status, created_at desc)`,
    // One open lead per (email, plan, league) — a prospect mashing the button
    // is one lead, not nine. The handler still UPDATEs first, so this index is
    // the race backstop rather than the only dedupe.
    `create unique index if not exists idx_league_leads_unique
       on public.league_leads(lower(email), plan, league_slug)`,
    // GRANDFATHER the two house leagues. Both predate billing: 'tko' is the
    // house brand and 'shinobistrikerleague' is the live flagship on its own
    // domain. Defaulting them to 'none' the day entitlements go live would
    // strip SSL's domain takeover and video ownership mid-flight. Guarded on
    // plan_status='none' so a real later subscription is never clobbered.
    `update public.leagues
        set plan_status = 'comped', plan_since = coalesce(plan_since, now()), updated_at = now()
      where slug in ('tko', 'shinobistrikerleague') and plan_status = 'none'`,
    // League #1 seed. SSL is the operator-owned Enterprise league; colors stay stock
    // (operator 2026-08-02): the indigo/red/cream of the renderer palette
    // (Loras/assets/leagues/shinobistrikerleague.json) are LOGO colors, not
    // UI chrome. Values mirror STOCK_LEAGUE_COLORS (src/lib/leagueTheme.ts =
    // the index.css :root defaults). do-nothing on conflict so a Studio save
    // is never clobbered at boot.
    `insert into public.leagues (slug, name, domain, colors, tagline, video_ownership, tier)
       values ('shinobistrikerleague', 'SHINOBI STRIKER LEAGUE', 'shinobistrikerleague.com',
               '{"primary":"#ff5b3d","secondary":"#2ed3dc","accent":"#ffb224","text":"#f5f5f8"}'::jsonb,
               'rise. strike. reign.', 'league', 'enterprise')
       on conflict (slug) do nothing`,
    // SSL is the operator's own full Enterprise build. Heal rows created by the
    // former Pro seed so clean branding, custom-domain and ownership gates can
    // never silently downgrade the live league after a restart.
    `update public.leagues
        set tier = 'enterprise', plan_status = 'comped',
            plan_since = coalesce(plan_since, now()), updated_at = now()
      where slug = 'shinobistrikerleague'
        and (tier <> 'enterprise' or plan_status <> 'comped')`,
    // HEAL the old indigo seed (operator 2026-08-02): rows created by earlier
    // deploys carry the SSL logo palette as UI chrome. Guarded on the exact
    // known-indigo primary so a real operator/Studio customization is never
    // clobbered — this fires once, flips the row to stock, then never matches.
    `update public.leagues
        set colors = '{"primary":"#ff5b3d","secondary":"#2ed3dc","accent":"#ffb224","text":"#f5f5f8"}'::jsonb,
            updated_at = now()
      where slug = 'shinobistrikerleague' and colors->>'primary' = '#484878'`,
    // The HOUSE league row (operator audit 2026-08-03): GET /api/league/tko/config
    // 404'd because 'tko' only existed as a client-side seed. Values mirror
    // SEED_LEAGUES / DEFAULT_LEAGUE_CONFIG (src/lib/leagueConfig.ts) — the
    // colors are the TKO_NEUTRAL tokens from src/lib/leagueTheme.ts (blue /
    // royal / teal / ice), so the served row paints exactly what the seed
    // fallback painted. do-nothing on conflict: a Studio save is never
    // clobbered at boot.
    `insert into public.leagues (slug, name, domain, colors, tagline, video_ownership, tier)
       values ('tko', 'TKO', 'tko.cam',
               '{"primary":"#2b69e4","secondary":"#1647aa","accent":"#40c094","text":"#f5f5f6"}'::jsonb,
               'every angle. one cam.', 'tko', 'starter')
       on conflict (slug) do nothing`,
    // Heal the palette-v1 house row (operator 2026-08-03, palette v2): guarded
    // on the exact v1 primary so a real Studio customization is never
    // clobbered — fires once, flips the row to the measured v2 tokens, then
    // never matches again.
    `update public.leagues
        set colors = '{"primary":"#2b69e4","secondary":"#1647aa","accent":"#40c094","text":"#f5f5f6"}'::jsonb,
            updated_at = now()
      where slug = 'tko' and colors->>'primary' = '#2563ff'`,
    // 2026-08-02 OPERATOR MIGRATION (shinobistrikerleague.com launch): the SSL
    // league row existed but league_members was EMPTY, so no existing player —
    // nor the operator — was routed/themed as a league member anywhere the app
    // reads membership. Idempotent inserts (NOT EXISTS), same seed pattern as
    // above; the operator's own account is matched by the SSL_OPERATOR_EMAIL
    // env var on the service. Statements + tests: server/sslMemberMigration.ts.
    ...sslMemberMigration2026_08_02(process.env.SSL_OPERATOR_EMAIL),
    // Front-page visibility flag for reels: default true (ordinary reels keep
    // appearing); the video factory writes false for FREE-member weekly renders
    // so they live on the member's own page + share link, never the front feed.
    `alter table public.reels add column if not exists promoted boolean not null default true`,
    // League provenance for a factory-produced reel (NULL for every ordinary
    // user-created reel). Written only by /api/internal/publish-reel, so this is
    // purely additive — no existing row or feed changes meaning.
    `alter table public.reels add column if not exists league_slug text`,
    // publish-reel's idempotency key is (user_id, combined_video_url); without
    // this the "have I already published this video?" probe scans that member's
    // whole reel history on every delivery.
    `create index if not exists idx_reels_combined_url on public.reels(combined_video_url)`,
    // ── TOURNAMENT ENTRY + STAT CHECK parity (supabase migrations 007/010/011
    //    were never ported to the real backend: db/schema.sql has neither
    //    tournament_entrants nor the stat-check review columns, so on prod the
    //    entry flow's stat-check insert (invited_admin_id) and the admin-picker
    //    read (can_approve_stat_check) THREW — a submitted stat check could
    //    never land, which is exactly "the stat check never showed up".
    //    All additive + idempotent; this boot path heals prod on deploy.
    `alter table public.tournaments add column if not exists start_at timestamptz`,
    `alter table public.tournaments add column if not exists end_at timestamptz`,
    `alter table public.tournaments add column if not exists status text default 'draft'`,
    `alter table public.tournaments add column if not exists prize_pool text`,
    `alter table public.tournament_admins add column if not exists can_approve_stat_check boolean default true`,
    `alter table public.tournament_admins add column if not exists can_submit_results boolean default true`,
    // Entrants: who entered (solo/team). status default is 'pending' — an entry
    // is NEVER born approved; only /api/fn/tournament-entrant-review flips it.
    `create table if not exists public.tournament_entrants (
       id uuid primary key default gen_random_uuid(),
       tournament_id uuid not null, user_id uuid not null,
       team_name text, team_server_id uuid,
       status text not null default 'pending',
       agreed_to_rules_at timestamptz, invited_by uuid,
       created_at timestamptz default now(),
       unique (tournament_id, user_id))`,
    `create index if not exists idx_tournament_entrants_tournament on public.tournament_entrants(tournament_id)`,
    `create index if not exists idx_tournament_entrants_user on public.tournament_entrants(user_id)`,
    // Older installs created the table with default 'accepted' (the
    // self-approval hole) and a 3-value check constraint; bring both up to the
    // approval model ('rejected' included).
    `alter table public.tournament_entrants alter column status set default 'pending'`,
    `do $$ begin
       if exists (select 1 from pg_constraint where conname = 'tournament_entrants_status_check') then
         alter table public.tournament_entrants drop constraint tournament_entrants_status_check;
       end if;
       alter table public.tournament_entrants
         add constraint tournament_entrants_status_check
         check (status in ('pending', 'accepted', 'withdrawn', 'rejected'));
     exception when others then null; end $$`,
    // Stat checks: the review/audit columns the frontend writes.
    `create table if not exists public.stat_check_submissions (
       id uuid primary key default gen_random_uuid(),
       user_id uuid not null, video_url text not null,
       character_name text, description text,
       status text not null default 'pending',
       tournament_id uuid, invited_admin_id uuid,
       reviewed_by uuid, reviewed_at timestamptz, review_notes text,
       creator_decision text, creator_notes text, creator_decided_at timestamptz,
       created_at timestamptz default now())`,
    `alter table public.stat_check_submissions add column if not exists tournament_id uuid`,
    `alter table public.stat_check_submissions add column if not exists invited_admin_id uuid`,
    `alter table public.stat_check_submissions add column if not exists reviewed_by uuid`,
    `alter table public.stat_check_submissions add column if not exists reviewed_at timestamptz`,
    `alter table public.stat_check_submissions add column if not exists review_notes text`,
    `alter table public.stat_check_submissions add column if not exists creator_decision text`,
    `alter table public.stat_check_submissions add column if not exists creator_notes text`,
    `alter table public.stat_check_submissions add column if not exists creator_decided_at timestamptz`,
    `create index if not exists idx_stat_check_tournament on public.stat_check_submissions(tournament_id)`,
    `create index if not exists idx_stat_check_user on public.stat_check_submissions(user_id)`,
    `create index if not exists idx_stat_check_invited_admin on public.stat_check_submissions(invited_admin_id)`,
    // ── MISSING PRODUCTION TABLES (operator audit 2026-08-04) ───────────────
    //    db/schema.sql declares all three, but the live database predates them
    //    and NOTHING applies schema.sql — this boot list is the only migration
    //    path. Each absence was silent (the API turns the error into a 4xx the
    //    client swallows), so each looked like a feature that "just never
    //    works" rather than a crash:
    //
    //      • live_sessions     — the unified "who is live right now" record.
    //        Read by EVERY profile page (LiveSessionsStrip) and the Live hub,
    //        so every profile view spent a round-trip on a guaranteed 400 and
    //        no player could ever be shown as live. Verified against
    //        production: POST /api/db {table:'live_sessions'} →
    //        `relation "live_sessions" does not exist`.
    //      • host_commentaries — saving a hosted / commentary track threw, so
    //        the Host page could never persist a "with host" version.
    //      • redeemed_codes    — the redeem handler claims a single-use code by
    //        INSERTing here FIRST and treats any throw as "already claimed", so
    //        on production EVERY founder-host code and EVERY tier pass came
    //        back "code already used" and no code could be redeemed at all.
    //
    //    Written in this file's house style: gen_random_uuid() (the boot list's
    //    generator — uuid_generate_v4 needs uuid-ossp, which schema.sql enables
    //    and this path does not) and no FK references, so a statement can never
    //    depend on the creation order of anything else here. Additive and
    //    idempotent — a no-op the moment the table exists.
    `create table if not exists public.live_sessions (
       id uuid primary key default gen_random_uuid(),
       host_id uuid not null,
       kind text not null default 'host' check (kind in ('host','battle','stream')),
       title text,
       status text not null default 'live' check (status in ('live','ended')),
       match_id uuid, reel_id uuid, battle_id uuid, tournament_id uuid,
       watch_url text, youtube_id text,
       started_at timestamptz default now(), ended_at timestamptz,
       created_at timestamptz default now())`,
    `create index if not exists idx_live_sessions_status on public.live_sessions(status, started_at desc)`,
    `create index if not exists idx_live_sessions_host on public.live_sessions(host_id, status)`,
    `create table if not exists public.host_commentaries (
       id uuid primary key default gen_random_uuid(),
       host_id uuid not null, match_id uuid, reel_id uuid,
       mode text not null default 'past' check (mode in ('live','past')),
       capture_source text not null default 'camera'
         check (capture_source in ('obs','camera','mic')),
       title text, commentary_url text,
       status text not null default 'ready' check (status in ('draft','live','ready')),
       created_at timestamptz default now(), updated_at timestamptz default now())`,
    `create index if not exists idx_host_commentaries_match on public.host_commentaries(match_id)`,
    `create index if not exists idx_host_commentaries_reel on public.host_commentaries(reel_id)`,
    `create index if not exists idx_host_commentaries_host on public.host_commentaries(host_id)`,
    // `code` is the PRIMARY KEY on purpose: that uniqueness IS the single-use
    // guarantee the redeem handler leans on (first insert wins, everyone else
    // gets 23505 → "code already used").
    `create table if not exists public.redeemed_codes (
       code text primary key,
       redeemed_by uuid not null,
       redeemed_at timestamptz not null default now())`,
    `create index if not exists idx_redeemed_codes_by on public.redeemed_codes(redeemed_by)`,
    // ── HOT-PATH INDEXES (operator audit 2026-08-04) ────────────────────────
    //    The reads every profile view and every sign-in makes, in the order the
    //    page makes them. All were sequential scans: invisible at 26 players,
    //    quadratic once the roster grows. Idempotent, and a no-op wherever the
    //    index already exists.
    //
    //    follows: the table has unique(follower_id, following_id), which serves
    //    a follower_id lookup (leading column) but NOT following_id — and the
    //    FOLLOWER count on every profile filters on following_id.
    `create index if not exists idx_follows_following on public.follows(following_id)`,
    `create index if not exists idx_follows_follower on public.follows(follower_id)`,
    //    reels had NO index besides its primary key, yet both the profile page
    //    and My Clips read `where user_id = $1 order by created_at desc`.
    `create index if not exists idx_reels_user_created on public.reels(user_id, created_at desc)`,
    `create index if not exists idx_reels_created on public.reels(created_at desc)`,
    //    clips are fetched by owner (My Clips) but only indexed by subject.
    `create index if not exists idx_clips_user_created on public.clips(user_id, created_at desc)`,
    //    The profile wall reads posts by author, newest first.
    `create index if not exists idx_posts_user_created on public.posts(user_id, created_at desc)`,
    //    The unread badge counts a user's unread notifications on every load.
    `create index if not exists idx_notifications_user_unread
       on public.notifications(user_id, read_at, created_at desc)`,
    //    Rankings orders the whole profiles table by power_level to take 10.
    `create index if not exists idx_profiles_power on public.profiles(power_level desc)`,
    //    Produced-video reads: by player (profile/My Clips) and by the composite
    //    upload id. recorded_at/composite variants exist above; this is the
    //    created_at ordering the global "recent videos" strip asks for.
    `create index if not exists idx_clip_records_player on public.clip_records(player_id, recorded_at desc)`,
    `create index if not exists idx_clip_records_created on public.clip_records(created_at desc)`,
    `create index if not exists idx_match_versions_created on public.match_versions(created_at desc)`,
    //    Identity uniqueness. Verified PRESENT on production 2026-08-04 (a
    //    rename to a case-variant of a taken handle is refused by name), so
    //    this is a no-op there — it is asserted here because the signup
    //    handler's clash probe and its 23505 retry both assume the rule, and
    //    any future database must get it without anyone applying schema.sql.
    //    If legacy rows ever collide case-insensitively the statement fails and
    //    is skipped by the loop's catch — the right outcome (it never destroys
    //    data), and the operator sees it in the boot log.
    `create unique index if not exists profiles_username_lower_uniq
       on public.profiles (lower(username))`,
    // Legacy Supabase installs renamed clan_members.clan_id to server_id but
    // kept the old FK pointing at public.clans. Organizer writes use servers,
    // so approvals failed even for authorized clan owners. Replace that stale
    // constraint; NOT VALID preserves any historical rows while enforcing the
    // correct servers FK for every new membership.
    `alter table public.clan_members drop constraint if exists clan_members_clan_id_fkey`,
    `do $$ begin
       if not exists (
         select 1 from pg_constraint
          where conname = 'clan_members_server_id_fkey'
            and conrelid = 'public.clan_members'::regclass
       ) then
         alter table public.clan_members
           add constraint clan_members_server_id_fkey
           foreign key (server_id) references public.servers(id) on delete cascade not valid;
       end if;
     end $$`,
    // The same legacy table only allowed owner/officer/member. The application
    // uses leader/officer/recruiter/member, and the server owner is the durable
    // source of clan ownership. Normalize the legacy owner label, then replace
    // the check so officer/recruiter assignment works after the FK repair.
    `update public.clan_members set role='leader' where role='owner'`,
    `alter table public.clan_members drop constraint if exists clan_members_role_check`,
    `alter table public.clan_members
       add constraint clan_members_role_check
       check (role in ('leader','officer','recruiter','member')) not valid`,
    // The legacy counter trigger also kept reading NEW.clan_id after that
    // column was renamed. `servers` has no materialized member_count column;
    // organizer reads count clan_members directly, so this trigger is obsolete.
    `drop trigger if exists trg_clan_member_count on public.clan_members`,
  ]
  for (const stmt of ddl) {
    try { await pool.query(stmt) } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[boot] table bootstrap stmt skipped:', (e as Error).message)
    }
  }
  try {
    await pool.query(PHYSICAL_MERCH_DDL)
  } catch (e) {
    // Physical commerce fails closed if its schema cannot be ensured.
    // eslint-disable-next-line no-console
    console.warn('[boot] physical merchandise tables skipped:', (e as Error).message)
  }
  // Seed a SMALL starting board (5×4) once — Conquest starts tiny and grows as
  // it fills (see conquest.targetBoardSize). Territories are unclaimed at first;
  // clans take them by winning battles.
  try {
    const c = await pool.query('select count(*)::int n from territories')
    if ((c.rows[0]?.n ?? 0) === 0) {
      const PLACES = ['Leaf', 'Sand', 'Mist', 'Cloud', 'Stone', 'Rain', 'Grass', 'Sound',
        'Waterfall', 'Star', 'Moon', 'Snow', 'Valley', 'Ember', 'Tide', 'Dune',
        'Ridge', 'Hollow', 'Reach', 'Verge']
      let k = 0
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 5; col++) {
          const name = PLACES[k % PLACES.length] + (k >= PLACES.length ? ` ${Math.floor(k / PLACES.length) + 1}` : '')
          await pool.query(
            'insert into territories (name, col, row) values ($1,$2,$3) on conflict (col,row) do nothing',
            [name, col, row],
          )
          k++
        }
      }
      // eslint-disable-next-line no-console
      console.log('[boot] seeded Conquest board (20 territories)')
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[boot] conquest seed skipped:', (e as Error).message)
  }
  // Create the single global TKO-BETA tester chat space + its #general channel
  // once (idempotent). Every TKO-BETA redeemer is auto-joined to it; the redeem
  // handler also self-ensures it, so this is just a warm start on boot.
  try {
    await pool.query(
      `insert into chat_spaces (id, kind, name, owner_id, clan_id)
       values ('00000000-0000-0000-0000-0000000be7a0','tko','TKO-BETA',null,null)
       on conflict (id) do nothing`,
    )
    await pool.query(
      `insert into chat_channels (space_id, name, category, position)
       select '00000000-0000-0000-0000-0000000be7a0','general','COMMUNITY',0
       where not exists (
         select 1 from chat_channels
         where space_id='00000000-0000-0000-0000-0000000be7a0' and name='general')`,
    )
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[boot] TKO-BETA space seed skipped:', (e as Error).message)
  }
  // ENTRANT ROSTER BACKFILL — tournament_entrants is the canonical roster and
  // tournament_registrations (the King entry flow) reads through to it. Every
  // registration written from now on is mirrored at write time
  // (server/app.ts), but every registration made BEFORE that existed has no
  // entrant row, so on those tournaments the bracket seeder, the end sweep and
  // the prize settlement each resolved a different roster. One idempotent pass
  // on boot heals them; see server/tournamentEntrants.ts for the model.
  try {
    const created = await backfillEntrantsFromRegistrations(pool)
    if (created > 0) {
      // eslint-disable-next-line no-console
      console.log(`[boot] backfilled ${created} tournament entrant row(s) from King registrations`)
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[boot] entrant backfill skipped:', (e as Error).message)
  }
  // eslint-disable-next-line no-console
  console.log('[boot] artifact/hosting/conquest tables ensured')
}
const bootstrapReady = bootstrapTables().then(() => ensureSchema(pool))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..', 'dist')

// ---- PWA update plumbing --------------------------------------------------
// Three things must never be served stale, or a tester gets pinned to an old
// build with no way forward. These routes are declared BEFORE express.static so
// they win over its default caching headers.
//
//  • version.json — the build stamp emitted by `vite build` (vite.buildId.ts)
//    into dist/. The running app polls it and compares against its own
//    VITE_BUILD_ID; a difference raises the in-app "Update" prompt. Exposed at
//    BOTH /version.json and legacy /app/version.json so old installs can update.
//  • sw.js — the service worker script. Browsers cap SW script caching at 24h
//    anyway, but an explicit no-cache makes a deploy visible immediately.
//  • the HTML shells — they name the hashed asset filenames, so a cached shell
//    is a cached app.
const versionFile = path.join(appDir, 'version.json')
app.get(['/version.json', '/app/version.json'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, must-revalidate')
  if (existsSync(versionFile)) return res.sendFile(versionFile)
  // Unstamped build: 'unknown' is treated as "not comparable" by the client
  // (src/lib/appVersion.ts), so it prompts nothing rather than looping.
  res.json({ buildId: 'unknown' })
})

const mobileVersionFile = path.join(appDir, 'mobile-version.json')
app.get(['/mobile-version.json', '/app/mobile-version.json'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, must-revalidate')
  if (existsSync(mobileVersionFile)) return res.sendFile(mobileVersionFile)
  res.status(404).json({ error: 'mobile release not published' })
})

// Accepts both express.Response and the raw ServerResponse that
// express.static's setHeaders hook hands back.
const noStore = (res: { setHeader(name: string, value: string): void }) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
}
app.get(['/sw.js', '/app/sw.js'], (req, res) => {
  noStore(res)
  res.setHeader('Service-Worker-Allowed', req.path.startsWith('/app/') ? '/app/' : '/')
  const file = path.join(appDir, 'sw.js')
  if (!existsSync(file)) return res.status(404).type('text/plain').send('not found')
  res.type('application/javascript')
  res.sendFile(file)
})

/** Long-cache the content-hashed assets, never the HTML shell. */
const staticOpts: Parameters<typeof express.static>[1] = {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      noStore(res)
      return
    }
    const normalized = filePath.replace(/\\/g, '/')
    if (/\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(normalized)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    }
  },
}

// ---------------------------------------------------------------------------
// LEAGUE HOST GATE — where a league's URL TIER becomes real (operator
// 2026-08-04). The three rungs live in src/lib/leagueUrls.ts:
//
//   RUNG 1  tko.cam/<slug>     every tier   — no infra, no gate, always works
//   RUNG 2  <slug>.tko.cam     Pro League+  — needs the wildcard record/cert
//   RUNG 3  <their own domain> Enterprise   — needs a verified TXT + a mapping
//
// Rungs 2 and 3 arrive as a HOSTNAME, which the browser cannot be trusted to
// police — so the check happens here, before a single byte of the app is
// served. A league that isn't entitled (wrong tier, or a custom domain whose
// TXT challenge hasn't been proven) is REDIRECTED DOWN to its path rung
// rather than refused: every league owns `tko.cam/<slug>`, so the worst case
// is a league on the address it actually paid for, never a dead page.
//
// Cheap by construction: one small query per hostname, memoized for a minute,
// skipped entirely for /api (those requests are same-origin app traffic and
// must never be redirected mid-flight), and fail-soft — any error, unknown
// host, or missing column just serves the site exactly as it did before.
// ---------------------------------------------------------------------------
const HOST_GATE_TTL_MS = 60_000
const hostGateCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof hostGateDecision>> }>()

async function cachedHostGate(host: string) {
  const hit = hostGateCache.get(host)
  const now = Date.now()
  if (hit && now - hit.at < HOST_GATE_TTL_MS) return hit.value
  const value = await hostGateDecision(pool, host)
  hostGateCache.set(host, { at: now, value })
  // Bounded: a flood of junk Host headers must not grow this without limit.
  if (hostGateCache.size > 500) {
    for (const [k, v] of hostGateCache) {
      if (now - v.at >= HOST_GATE_TTL_MS) hostGateCache.delete(k)
    }
  }
  return value
}

app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') return next()
  const host = String(req.hostname || '').toLowerCase()
  if (!host || host === 'tko.cam' || host === 'www.tko.cam' || host === 'localhost') return next()
  void cachedHostGate(host)
    .then((decision) => {
      if (decision.action !== 'redirect') return next()
      // 302, not 308: the day the league upgrades, the address must start
      // working immediately — a permanently-cached redirect would strand it.
      res.redirect(302, `https://tko.cam${decision.to}${req.originalUrl === '/' ? '' : req.originalUrl}`)
    })
    .catch(() => next())
})

// Preserve old shared links after moving the product from /app to the root.
// originalUrl keeps the query string, so /app/live?do=watch becomes
// /live?do=watch instead of dropping the user's intended flow.
app.get(['/app', '/app/*'], (req, res) => {
  const target = req.originalUrl.slice('/app'.length) || '/'
  res.redirect(308, target)
})

// ---- Product app at the root; /marketing is handled by React Router. ----
// public/marketing contains image assets, so express.static would otherwise
// redirect the exact /marketing route to /marketing/. Serve the SPA shell
// first to keep the canonical route stable. /studio and /leagues are the
// white-label League Studio + league gateway (full-bleed React routes) —
// allowlisted here for the same reason, so a future asset directory of the
// same name can never shadow them.
app.get([
  '/marketing', '/download', '/studio', '/leagues', '/make-a-league',
  // The league-owner plan select + Stripe Checkout return. Must be reachable by
  // a HARD navigation: Stripe redirects the browser back to a full URL, so a
  // client-only route would 404 on the way home from a successful payment.
  '/league-plans',
], (_req, res) => {
  noStore(res)
  res.sendFile(path.join(appDir, 'index.html'))
})

app.use(express.static(appDir, staticOpts))
app.get('*', (req, res) => {
  if (!shouldServeSpaShell(req.path)) {
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'not found' })
    }
    return res.status(404).type('text/plain').send('not found')
  }
  noStore(res)
  res.sendFile(path.join(appDir, 'index.html'))
})

const port = Number(process.env.PORT || 8787)
app.listen(port, () =>
  console.log(`TKO server listening on :${port} - app '${appDir}' at /, marketing at /marketing`),
)
void bootstrapReady.then(() => startAutoLiveScanner(pool))
void bootstrapReady.then(() => startAutoYouTubeScanner(pool))
// Auto-end tournaments whose end_at has passed: decide the bracket leader(s),
// settle/refund the prize pool (tie = even split), close, notify entrants.
void bootstrapReady.then(() => startTournamentEndSweeper(pool))
