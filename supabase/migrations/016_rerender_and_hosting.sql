-- 016_rerender_and_hosting.sql
-- Re-render-on-join + hosting/commentary + the budget ledger that keeps cloud
-- re-renders paid for. Additive + idempotent. Rules live in src/lib/hosting.ts.

-- ── match_versions ───────────────────────────────────────────────────────────
-- One row per RENDER of a match. When a new angle joins we render a NEW version
-- (higher angle_count) and post it; the OLD YouTube video is kept (we never
-- delete). The app points at the newest version; older ones stay watchable.
create table if not exists public.match_versions (
  id           uuid primary key default gen_random_uuid(),
  match_key    text not null,                       -- the fingerprint matchKey/slug
  version      integer not null default 1,
  youtube_id   text,
  angle_count  integer not null default 2,
  created_at   timestamptz not null default now(),
  unique (match_key, version)
);
create index if not exists match_versions_key_idx on public.match_versions(match_key);
alter table public.match_versions enable row level security;
do $$ begin
  create policy match_versions_public_read on public.match_versions for select using (true);
exception when duplicate_object then null; end $$;

-- ── match_angles ─────────────────────────────────────────────────────────────
-- Who has contributed an angle to a match, and whether it's been rendered in yet.
-- `included_in_version` is null until a render picks the angle up.
create table if not exists public.match_angles (
  id                  uuid primary key default gen_random_uuid(),
  match_key           text not null,
  user_id             uuid not null references auth.users(id) on delete cascade,
  youtube_video_id    text not null,
  joined_at           timestamptz not null default now(),
  included_in_version integer,
  unique (match_key, user_id)                        -- one angle per person per match
);
create index if not exists match_angles_key_idx on public.match_angles(match_key);
alter table public.match_angles enable row level security;
do $$ begin
  create policy match_angles_public_read on public.match_angles for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  -- a user may register their OWN angle (server verifies the clip is really the
  -- same match before a render actually uses it).
  create policy match_angles_self_write on public.match_angles
    for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ── video_hosts ──────────────────────────────────────────────────────────────
-- A commentary/hosting session laid over a match's video. Legend hosts anywhere;
-- a tournament host may host their own tournament's videos (enforced in the app
-- + server via hosting.ts).
create table if not exists public.video_hosts (
  id           uuid primary key default gen_random_uuid(),
  match_key    text not null,
  host_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null default 'commentary',
  tournament_id uuid,
  created_at   timestamptz not null default now()
);
create index if not exists video_hosts_key_idx on public.video_hosts(match_key);
alter table public.video_hosts enable row level security;
do $$ begin
  create policy video_hosts_public_read on public.video_hosts for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy video_hosts_self_write on public.video_hosts
    for insert with check (auth.uid() = host_id);
exception when duplicate_object then null; end $$;

-- ── render_ledger (budget + abuse limits) ────────────────────────────────────
-- Every re-render / host is billed here against the triggering user. The app +
-- server count this month's rows for a user to enforce RERENDER_BUDGET per tier,
-- so nobody can drain cloud spend by spamming joins/hosts.
create table if not exists public.render_ledger (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  match_key    text not null,
  kind         text not null default 'rerender',    -- rerender | host
  cost_usd     numeric(8,4) not null default 0.05,
  created_at   timestamptz not null default now()
);
create index if not exists render_ledger_user_month_idx on public.render_ledger(user_id, created_at);
alter table public.render_ledger enable row level security;
do $$ begin
  create policy render_ledger_self_read on public.render_ledger
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
