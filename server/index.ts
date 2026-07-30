import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Pool } from 'pg'
import { createApp } from './app'
import { PHYSICAL_MERCH_DDL } from './physicalMerchSchema'

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
const pool = new Pool({ connectionString })

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
    `create table if not exists public.artifacts (
       id uuid primary key default gen_random_uuid(),
       owner_id uuid not null, slug text not null, name text not null,
       rarity text not null default 'common', capability text not null default 'none',
       code text unique, image_url text, price_cents integer,
       redeemed_by uuid, redeemed_at timestamptz,
       recipe_code text, forge_tier text, power_payload jsonb not null default '[]',
       power_score integer not null default 0, slot_cost integer not null default 0,
       official_override boolean not null default false, clan_id uuid,
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
       status text not null default 'proposing',
       created_at timestamptz not null default now())`,
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
    `alter table public.live_streams add column if not exists layout text not null default 'auto'`,
    `alter table public.live_streams add column if not exists show_bracket boolean not null default false`,
    `alter table public.tournament_battles add column if not exists round integer`,
    `alter table public.tournament_battles add column if not exists bracket_slot integer`,
    `create unique index if not exists uq_tournament_battle_bracket_slot
       on public.tournament_battles(tournament_id, round, bracket_slot)
       where round is not null and bracket_slot is not null`,
    `create table if not exists public.live_stream_angles (
       id uuid primary key default gen_random_uuid(),
       live_stream_id uuid not null, user_id uuid,
       label text, youtube_url text, created_at timestamptz not null default now())`,
    `create index if not exists idx_live_stream_angles_stream
       on public.live_stream_angles(live_stream_id, created_at)`,
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
  ]
  for (const stmt of ddl) {
    try { await pool.query(stmt) } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[boot] table bootstrap stmt skipped:', (e as Error).message)
    }
  }
  try {
    await pool.query(PHYSICAL_MERCH_DDL)
    // These tables contain order, address, provider-cost, and payout records.
    // They are intentionally server-only: the Express API applies per-user
    // authorization and the service-role database connection bypasses RLS.
    // Run this on every boot so even databases first created by the runtime
    // bootstrap cannot expose physical-commerce rows through a direct client.
    for (const table of [
      'physical_merch_products',
      'physical_merch_variants',
      'physical_merch_orders',
      'physical_merch_order_items',
      'physical_merch_events',
      'physical_merch_earnings',
    ]) {
      await pool.query(`alter table public.${table} enable row level security`)
    }
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
  // eslint-disable-next-line no-console
  console.log('[boot] artifact/hosting/conquest tables ensured')
}
void bootstrapTables()

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
    if (filePath.endsWith('.html')) noStore(res)
  },
}

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
// first to keep the canonical route stable.
app.get(['/marketing', '/download'], (_req, res) => {
  noStore(res)
  res.sendFile(path.join(appDir, 'index.html'))
})

app.use(express.static(appDir, staticOpts))
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' })
  noStore(res)
  res.sendFile(path.join(appDir, 'index.html'))
})

const port = Number(process.env.PORT || 8787)
app.listen(port, () =>
  console.log(`TKO server listening on :${port} - app '${appDir}' at /, marketing at /marketing`),
)
