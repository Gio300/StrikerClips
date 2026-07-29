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

export async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(DDL)
}
