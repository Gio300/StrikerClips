// =============================================================================
// ensureSchema — idempotent DDL for the auto-match + render pipeline.
//
// The live database predates these tables. Rather than run a manual migration,
// the worker guarantees its own tables exist on startup. Every statement is
// `if not exists` / `add column if not exists`, so this is safe to run on every
// boot and against a database that already has them. Reuses uuid_generate_v4(),
// which the existing schema already relies on (no extension creation needed).
// =============================================================================
import type { Pool } from 'pg'
import { MEDIA_EVIDENCE_DDL } from './mediaEvidenceSchema'
import { applyChatFoundation } from './chatFoundationSchema'
import { applyPushSchema } from './pushSchema'
import { applyAuthSecuritySchema } from './authSecuritySchema'
import { applyOrganizerSchema } from './organizerSchema'
import { applyOnboardingSchema } from './onboardingSchema'
import { applyContentReportsSchema } from './contentReportsSchema'
import {
  MIN_DETECTED_BATTLE_SECONDS,
  MIN_DETECTED_BOUNDARY_CONFIDENCE,
  recomputePower,
} from './power'

const DDL = `
create table if not exists public.match_groups (
  id                 uuid primary key default uuid_generate_v4(),
  signature          text not null,
  sig_hash           text not null,
  participants       text[] default '{}',
  outcome            text check (outcome in ('victory','defeat','draw')),
  score_line         text,
  mode               text,
  map                text,
  confidence         numeric,
  time_window_start  timestamptz,
  time_window_end    timestamptz,
  game               text not null default 'shinobi_striker',
  created_at         timestamptz default now()
);
create index if not exists idx_match_groups_hash on public.match_groups(game, sig_hash);
create unique index if not exists uq_match_groups_sig on public.match_groups(sig_hash);

create table if not exists public.clip_records (
  id             uuid primary key default uuid_generate_v4(),
  clip_id        uuid references public.clips(id) on delete set null,
  player_id      uuid references public.profiles(id) on delete cascade,
  player_handle  text,
  lobby_id       text,
  participants   text[] default '{}',
  category       text check (category in ('kill','death','ultimate','flag','win','clutch','opening','closing')),
  outcome        text check (outcome in ('victory','defeat','draw')),
  kills          integer,
  deaths         integer,
  assists        integer,
  score_line     text,
  map            text,
  mode           text,
  youtube_id     text,
  duration_sec   integer,
  recorded_at    timestamptz,
  ocr_confidence numeric,
  match_id       uuid references public.match_groups(id) on delete set null,
  created_at     timestamptz default now()
);
create index if not exists idx_clip_records_match on public.clip_records(match_id);
create index if not exists idx_clip_records_player on public.clip_records(player_id, recorded_at desc);
create index if not exists idx_clip_records_youtube on public.clip_records(youtube_id);
alter table public.clip_records add column if not exists lobby_id text;
alter table public.clip_records add column if not exists participants text[] default '{}';
-- The TKO-channel composite this clip ended up in. Kept SEPARATE from youtube_id
-- (which stays the clip's own raw source upload, on the uploader's channel, used
-- by the render worker to fetch the angle). Only rows with a composite id are
-- real produced videos on the TKO channel — that's what the public feed shows.
alter table public.clip_records add column if not exists composite_youtube_id text;
create index if not exists idx_clip_records_composite on public.clip_records(composite_youtube_id);

create table if not exists public.render_jobs (
  id               uuid primary key default uuid_generate_v4(),
  match_id         uuid references public.match_groups(id) on delete cascade,
  match_key        text unique,
  status           text not null default 'pending'
                     check (status in ('pending','rendering','uploading','done','failed')),
  clip_ids         uuid[] default '{}',
  participant_ids  uuid[] default '{}',
  youtube_id       text,
  combined_video_url text,
  error            text,
  attempts         integer not null default 0,
  ready_at         timestamptz not null default now(),
  rerender_requested boolean not null default false,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
alter table public.render_jobs add column if not exists ready_at timestamptz not null default now();
alter table public.render_jobs add column if not exists rerender_requested boolean not null default false;
create index if not exists idx_render_jobs_status on public.render_jobs(status, ready_at, created_at);

alter table public.profiles add column if not exists auto_merge_opt_out boolean not null default false;
alter table public.profiles add column if not exists auto_detect_live boolean not null default true;
alter table public.profiles add column if not exists reel_usage_privacy text not null default 'followers_of_followers';

-- APPROVED-GAME GATE: the game a live stream is playing. The public "who's live"
-- read only features streams whose game is on the server's APPROVED_GAMES
-- allowlist. Defaults to the one supported title so existing rows stay featured.
alter table public.live_streams add column if not exists game text default 'Shinobi Striker';

-- Go Live setup config (grouped dropdowns in the client). Additive + idempotent,
-- safe defaults. price_cents is STORED only — no payment is collected here (Phase 2).
alter table public.live_streams add column if not exists chat_enabled boolean not null default true;
alter table public.live_streams add column if not exists is_paid boolean not null default false;
alter table public.live_streams add column if not exists price_cents integer;
alter table public.live_streams add column if not exists tournament_id uuid;
alter table public.live_streams add column if not exists host_share text not null default 'both';
alter table public.live_streams add column if not exists background_url text;
alter table public.live_streams add column if not exists team_a text;
alter table public.live_streams add column if not exists team_b text;
alter table public.live_streams add column if not exists score_a integer not null default 0;
alter table public.live_streams add column if not exists score_b integer not null default 0;
alter table public.live_streams add column if not exists score_revision bigint not null default 0;
alter table public.live_streams add column if not exists layout text not null default 'auto';
alter table public.live_streams add column if not exists show_bracket boolean not null default false;
alter table public.live_streams add column if not exists source text not null default 'manual';
alter table public.live_streams add column if not exists external_stream_id text;
alter table public.live_streams add column if not exists detected_live_at timestamptz;
create index if not exists idx_live_streams_auto_source
  on public.live_streams(user_id, source, is_live, updated_at desc);

create table if not exists public.auto_live_discoveries (
  id uuid primary key default uuid_generate_v4(), user_id uuid not null,
  provider text not null default 'youtube', external_stream_id text not null,
  channel_url text not null, watch_url text not null, title text,
  status text not null default 'live', detection_method text not null,
  confidence real not null default 0, live_stream_id uuid,
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  ended_at timestamptz, details jsonb not null default '{}'::jsonb,
  unique(user_id, provider, external_stream_id)
);

create table if not exists public.shadow_match_analyses (
  id uuid primary key default uuid_generate_v4(), source_fingerprint text not null unique,
  source_kind text not null default 'footage_group', source_ref text,
  status text not null default 'queued', match_signature text,
  game text not null default 'shinobi_striker', mode text,
  verdict jsonb not null default '{}'::jsonb, confidence real not null default 0,
  evidence_quality real not null default 0, analyzer text not null default 'local',
  model text, analyzer_version text, evidence jsonb not null default '[]'::jsonb,
  analysis jsonb not null default '{}'::jsonb, error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create table if not exists public.shadow_match_participants (
  id uuid primary key default uuid_generate_v4(), analysis_id uuid not null,
  profile_id uuid, detected_name text not null, team text,
  outcome text not null default 'unknown', kills integer, deaths integer, assists integer,
  confidence real not null default 0, evidence jsonb not null default '{}'::jsonb,
  unique(analysis_id, detected_name)
);
-- HOST'S OWN FEED status (angle 1), independent of is_live so a host can stop
-- their own feed without ending the multi-cam session. See /api/fn/live-host-feed.
alter table public.live_streams add column if not exists host_feed_status text not null default 'live';
-- Per-angle lifecycle: 'live' | 'stopped' | 'reconnecting'. Retains a
-- participant's slot across a manual stop or a dropped feed (see live-angle-*).
alter table public.live_stream_angles add column if not exists status text not null default 'live';
-- LIVE ACTION SIGNAL (0-100 per feed + write timestamp), written by the PC-side
-- watcher via /api/internal/live-action; read by the client AUTO director.
alter table public.live_stream_angles add column if not exists action_level integer;
alter table public.live_stream_angles add column if not exists action_at timestamptz;
alter table public.live_streams add column if not exists host_action_level integer;
alter table public.live_streams add column if not exists host_action_at timestamptz;
alter table public.live_stream_angles add column if not exists fight_detected boolean not null default false;
alter table public.live_stream_angles add column if not exists fight_mode text;
alter table public.live_stream_angles add column if not exists fight_at timestamptz;
alter table public.live_streams add column if not exists host_fight_detected boolean not null default false;
alter table public.live_streams add column if not exists host_fight_mode text;
alter table public.live_streams add column if not exists host_fight_at timestamptz;
alter table public.live_streams add column if not exists host_view jsonb;

-- Durable live-director state. The host writes this only through the trusted
-- live-director-command function; viewers read it to follow camera/layout
-- commands on every device without relying on the host's local React state.
create table if not exists public.live_director_state (
  live_stream_id uuid primary key references public.live_streams(id) on delete cascade,
  mode text not null default 'auto',
  angle_ids jsonb not null default '[]'::jsonb,
  last_action text not null default 'status',
  last_payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Server-authoritative Oracle lifecycle. A host opens a short prediction
-- window after at least two real live participants are attached; the server
-- owns the choices, lock time, winner, loser, and settlement state.
create table if not exists public.oracle_bets (
  id uuid primary key default uuid_generate_v4(),
  match_ref text not null,
  stream_id uuid,
  user_id uuid not null references public.profiles(id) on delete cascade,
  choice text not null,
  stake_kind text not null check (stake_kind in ('ticket','sweeps','artifact')),
  stake_amount integer not null default 0 check (stake_amount >= 0),
  stake_cents integer not null default 0 check (stake_cents >= 0),
  artifact_id uuid,
  status text not null default 'active' check (status in ('active','won','lost','refunded')),
  payout integer not null default 0,
  payout_cents integer not null default 0,
  created_at timestamptz not null default now(),
  unique (match_ref, user_id)
);
create index if not exists oracle_bets_match_idx on public.oracle_bets(match_ref, status);
create index if not exists oracle_bets_stream_idx on public.oracle_bets(stream_id);

create table if not exists public.oracle_live_rounds (
  id uuid primary key default uuid_generate_v4(),
  stream_id uuid not null,
  match_ref text not null unique,
  status text not null default 'open'
    check (status in ('open','locked','settled','cancelled')),
  choices jsonb not null default '[]'::jsonb,
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  locks_at timestamptz not null,
  winning_choice text,
  losing_choice text,
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists oracle_live_rounds_stream_idx
  on public.oracle_live_rounds(stream_id, opened_at desc);
create unique index if not exists oracle_live_rounds_one_active_idx
  on public.oracle_live_rounds(stream_id)
  where status in ('open','locked');

create table if not exists public.oracle_stream_config (
  stream_id uuid primary key,
  min_bet integer not null default 1 check (min_bet >= 0),
  min_stake_kind text not null default 'ticket',
  updated_at timestamptz default now()
);

create table if not exists public.oracle_stream_tally (
  stream_id uuid primary key,
  sweeps_cents_in integer not null default 0 check (sweeps_cents_in >= 0),
  streamer_cents_paid integer not null default 0 check (streamer_cents_paid >= 0),
  updated_at timestamptz default now()
);

create table if not exists public.oracle_bet_settlements (
  match_ref text primary key,
  stream_id uuid,
  winning_choice text,
  sweeps_cents_in integer not null default 0,
  streamer_cents_paid integer not null default 0,
  resolved_at timestamptz not null default now()
);

alter table public.tournament_battles add column if not exists round integer;
alter table public.tournament_battles add column if not exists bracket_slot integer;
-- Replay timeline timestamps: when the matchup was decided and when its watch
-- links last changed (see src/lib/tournamentReplay.ts). Additive & idempotent.
alter table public.tournament_battles add column if not exists decided_at timestamptz;
alter table public.tournament_battles add column if not exists media_updated_at timestamptz;
-- Every tournament carries an end time; the end sweep
-- (server/tournamentEndSweep.ts) scans (status, end_at) to auto-close.
alter table public.tournaments add column if not exists end_at timestamptz;
create index if not exists idx_tournaments_end_sweep on public.tournaments(status, end_at);
create unique index if not exists uq_tournament_battle_bracket_slot
  on public.tournament_battles(tournament_id, round, bracket_slot)
  where round is not null and bracket_slot is not null;
-- Per-side watch links ({a:{live_url,clip_urls},b:{...}}) — written only by
-- /api/fn/tournament-battle-media (see src/lib/battleMedia.ts).
alter table public.tournament_battles add column if not exists media jsonb;

create table if not exists public.match_versions (
  id               uuid primary key default uuid_generate_v4(),
  match_key        text not null,
  version          integer not null default 1,
  youtube_id       text,
  angle_count      integer not null default 2,
  participant_ids  uuid[] not null default '{}',
  clip_ids         uuid[] not null default '{}',
  source_angles    jsonb not null default '[]'::jsonb,
  reason           text not null default 'render',
  created_at       timestamptz not null default now(),
  unique (match_key, version)
);
alter table public.match_versions add column if not exists participant_ids uuid[] not null default '{}';
alter table public.match_versions add column if not exists clip_ids uuid[] not null default '{}';
alter table public.match_versions add column if not exists source_angles jsonb not null default '[]'::jsonb;
alter table public.match_versions add column if not exists reason text not null default 'render';
create index if not exists match_versions_key_idx on public.match_versions(match_key);

create table if not exists public.match_angles (
  id                  uuid primary key default uuid_generate_v4(),
  match_key           text not null,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  youtube_video_id    text not null,
  clip_record_id      uuid references public.clip_records(id) on delete set null,
  joined_at           timestamptz not null default now(),
  included_in_version integer,
  status              text not null default 'active'
                        check (status in ('active','removed')),
  removed_at          timestamptz,
  removal_reason      text,
  unique (match_key, user_id)
);
alter table public.match_angles add column if not exists clip_record_id uuid references public.clip_records(id) on delete set null;
alter table public.match_angles add column if not exists status text not null default 'active';
alter table public.match_angles add column if not exists removed_at timestamptz;
alter table public.match_angles add column if not exists removal_reason text;
create index if not exists match_angles_key_idx on public.match_angles(match_key);
create index if not exists match_angles_user_status_idx on public.match_angles(user_id, status);
`

// The retired screenshot-result flow used a database trigger to turn rows in
// match_result_players into public power. Removing only the UI would leave old
// cached clients and direct requests able to use it. This database guard makes
// the retirement authoritative while leaving tournament_results and the
// verified media pipeline untouched.
const MANUAL_RESULT_SAFETY_DDL = `
create or replace function public.reject_manual_match_result()
returns trigger language plpgsql as $$
begin
  raise exception 'manual screenshot match result submissions are retired'
    using errcode = '42501';
end;
$$;

do $manual_result_safety$
begin
  if to_regclass('public.match_results') is not null then
    execute 'drop trigger if exists reject_manual_match_result_insert on public.match_results';
    execute 'create trigger reject_manual_match_result_insert before insert on public.match_results for each row execute procedure public.reject_manual_match_result()';
  end if;
  if to_regclass('public.match_result_players') is not null then
    execute 'drop trigger if exists on_match_result_player_insert_power on public.match_result_players';
  end if;
end;
$manual_result_safety$;
`

/**
 * CHAT FOUNDATION DDL now lives in server/chatFoundationSchema.ts as a list of
 * NAMED, INDIVIDUALLY APPLIED statements — not as one string in one query.
 *
 * Why it moved: `pool.query(oneBigString)` is a single simple query, which
 * Postgres runs as one implicit transaction, so a single failing statement
 * silently rolled back every statement that had already succeeded beside it
 * (a refused `set not null` took the (room, created_at) indexes with it), and
 * the one swallow-and-log catch never named which statement died. See the
 * header of chatFoundationSchema.ts.
 */

export async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(DDL)
  await pool.query(MEDIA_EVIDENCE_DDL)
  await pool.query(MANUAL_RESULT_SAFETY_DDL)
  // Older scanners revived terminal failures on every channel scan. Those
  // poison rows could accumulate hundreds of attempts and permanently sit at
  // the front of the FIFO queue. The worker's contract already caps retries at
  // three, so heal only rows that violate that invariant.
  await pool.query(
    `update public.media_analysis_jobs
        set status='failed', lease_until=null, worker_id=null, updated_at=now()
      where status='queued' and attempts >= 3`,
  )
  // Backfill qualifying battles that were detected before participation power
  // existed. This is intentionally scoped to owners who actually have strong
  // connected-YouTube evidence; it does not scan/recompute every profile on a
  // cold start, and the calculation is idempotent.
  const detectedOwners = await pool.query(
    `select distinct cr.player_id
       from clip_records cr
       join media_sources s on s.id=cr.source_id and s.owner_id=cr.player_id
       join match_segments ms on ms.id=cr.segment_id and ms.source_id=s.id
      where cr.player_id is not null
        and coalesce(cr.score_verification_status,'legacy')='shadow'
        and s.provider='youtube'
        and s.source_kind in ('youtube_upload','youtube_live')
        and s.status='complete'
        and cr.youtube_id is not null
        and cr.youtube_id=s.external_id
        and ms.boundary_confidence >= $1
        and (ms.end_sec - ms.start_sec) >= $2`,
    [MIN_DETECTED_BOUNDARY_CONFIDENCE, MIN_DETECTED_BATTLE_SECONDS],
  )
  for (const row of detectedOwners.rows) {
    await recomputePower(pool, String(row.player_id))
  }
  if (detectedOwners.rows.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[boot] recomputed detected-battle power for ${detectedOwners.rows.length} player(s)`)
  }
  await applyOrganizerSchema(pool)
  await applyOnboardingSchema(pool)
  await applyContentReportsSchema(pool)
  await applyAuthSecuritySchema(pool)
  // Isolated on purpose, and now statement by statement. Chat works without
  // these columns (mentions/replies/reactions simply don't render), so a failure
  // here must not cost the caller its pipeline tables or, at boot, its scanners
  // — and one refused statement must not cost the other twenty-eight either.
  // applyChatFoundation logs each failure by name and never throws.
  await applyChatFoundation(pool)
  // Same treatment for web-push subscriptions, and for the same reason: with no
  // push_subscriptions table nobody can subscribe, so a refused statement here
  // costs exactly the phone notifications and nothing else. Never throws.
  await applyPushSchema(pool)
}
