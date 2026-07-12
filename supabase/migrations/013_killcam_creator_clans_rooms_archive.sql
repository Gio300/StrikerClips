-- Migration 013 — KillCam: creator agreements, rev-share ledger, first-class
-- clans, polymorphic chat rooms, YouTube embed mapping, and archive/retention
-- bookkeeping.
--
-- One mega-migration, everything idempotent, so it stays a single paste in the
-- Supabase SQL editor. Safe to re-run.

-- ─────────────────────────────────────────────────────────────────────
-- 1. creator_agreements — the explicit, timestamped license grant captured
--    AT UPLOAD. This is the legal backbone: it records exactly what rights the
--    creator granted, for which content, under which agreement version, with a
--    content hash of the text they actually saw.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.creator_agreements (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  -- 'account' = accepted at signup; 'clip'/'reel' = accepted at that upload.
  scope text not null default 'clip',
  clip_id uuid references public.clips(id) on delete cascade,
  reel_id uuid references public.reels(id) on delete cascade,
  agreement_version text not null,
  -- sha256 of the exact agreement text the user saw (audit / dispute defense).
  content_sha256 text,
  -- The explicit grants. All true when accepted; kept as columns so a future
  -- narrower agreement can grant a subset.
  grant_host boolean not null default true,
  grant_edit_combine boolean not null default true,
  grant_distribute boolean not null default true,
  grant_youtube boolean not null default true,
  grant_monetize boolean not null default true,
  -- Creator's ad-revenue share in basis points at time of acceptance (5000 = 50%).
  rev_share_bps integer not null default 5000,
  user_agent text,
  accepted_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'creator_agreements_scope_check') then
    alter table public.creator_agreements
      add constraint creator_agreements_scope_check
      check (scope in ('account', 'clip', 'reel'));
  end if;
end $$;

create index if not exists idx_creator_agreements_user on public.creator_agreements(user_id, accepted_at desc);
create index if not exists idx_creator_agreements_clip on public.creator_agreements(clip_id);
create index if not exists idx_creator_agreements_reel on public.creator_agreements(reel_id);

alter table public.creator_agreements enable row level security;

drop policy if exists "Users read own agreements" on public.creator_agreements;
create policy "Users read own agreements"
  on public.creator_agreements for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own agreements" on public.creator_agreements;
create policy "Users insert own agreements"
  on public.creator_agreements for insert
  with check (auth.uid() = user_id);

-- Agreements are an immutable audit log: no UPDATE/DELETE policy on purpose.

-- ─────────────────────────────────────────────────────────────────────
-- 2. creator_earnings — the ad rev-share ledger. Every accrual/payout the
--    creator can see on their dashboard. This backs the "rev-share so creators
--    want to submit" promise.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.creator_earnings (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid references public.profiles(id) on delete cascade not null,
  -- 'ad_revshare' (site/display), 'youtube_revshare', 'tip', 'adjustment'
  source text not null default 'ad_revshare',
  reel_id uuid references public.reels(id) on delete set null,
  amount_cents integer not null default 0,
  currency text default 'usd',
  -- 'accrued' -> 'payable' -> 'paid'
  status text not null default 'accrued',
  period text, -- e.g. '2026-07' for monthly accruals
  note text,
  created_at timestamptz default now(),
  paid_at timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'creator_earnings_status_check') then
    alter table public.creator_earnings
      add constraint creator_earnings_status_check
      check (status in ('accrued', 'payable', 'paid', 'reversed'));
  end if;
end $$;

create index if not exists idx_creator_earnings_creator on public.creator_earnings(creator_id, created_at desc);

alter table public.creator_earnings enable row level security;

drop policy if exists "Creators read own earnings" on public.creator_earnings;
create policy "Creators read own earnings"
  on public.creator_earnings for select
  using (auth.uid() = creator_id);

-- Inserts/updates come from the service role (accrual jobs). No user-write policy.

-- ─────────────────────────────────────────────────────────────────────
-- 3. clans — first-class. tag + emblem + roster + points leaderboard.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.clans (
  id uuid primary key default uuid_generate_v4(),
  tag text unique not null,               -- short, e.g. [KILL]
  name text not null,
  description text,
  emblem_icon text default 'skull',       -- preset icon key
  emblem_bg text default '#f43f5e',        -- hex color
  emblem_fg text default '#0a0a0f',
  banner_url text,
  owner_id uuid references public.profiles(id) on delete set null,
  points integer not null default 0,       -- leaderboard score
  member_count integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  join_mode text not null default 'open',  -- 'open' | 'request' | 'invite'
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clans_tag_len_check') then
    alter table public.clans add constraint clans_tag_len_check check (char_length(tag) between 2 and 6);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clans_join_mode_check') then
    alter table public.clans add constraint clans_join_mode_check check (join_mode in ('open','request','invite'));
  end if;
end $$;

create index if not exists idx_clans_points on public.clans(points desc);

alter table public.clans enable row level security;

drop policy if exists "Clans viewable" on public.clans;
create policy "Clans viewable" on public.clans for select using (true);

drop policy if exists "Authenticated create clans" on public.clans;
create policy "Authenticated create clans"
  on public.clans for insert with check (auth.uid() = owner_id);

drop policy if exists "Owner updates clan" on public.clans;
create policy "Owner updates clan"
  on public.clans for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "Owner deletes clan" on public.clans;
create policy "Owner deletes clan"
  on public.clans for delete using (auth.uid() = owner_id);

-- ── clan_members — roster ────────────────────────────────────────────
create table if not exists public.clan_members (
  id uuid primary key default uuid_generate_v4(),
  clan_id uuid references public.clans(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role text not null default 'member',    -- 'owner' | 'officer' | 'member'
  joined_at timestamptz default now(),
  unique (clan_id, user_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clan_members_role_check') then
    alter table public.clan_members add constraint clan_members_role_check check (role in ('owner','officer','member'));
  end if;
end $$;

create index if not exists idx_clan_members_clan on public.clan_members(clan_id);
create index if not exists idx_clan_members_user on public.clan_members(user_id);

alter table public.clan_members enable row level security;

drop policy if exists "Clan members viewable" on public.clan_members;
create policy "Clan members viewable" on public.clan_members for select using (true);

drop policy if exists "Users join clans" on public.clan_members;
create policy "Users join clans"
  on public.clan_members for insert with check (auth.uid() = user_id);

drop policy if exists "Users leave clans" on public.clan_members;
create policy "Users leave clans"
  on public.clan_members for delete using (auth.uid() = user_id);

-- Keep clans.member_count in sync with the roster.
create or replace function public.sync_clan_member_count() returns trigger
language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT') then
    update public.clans set member_count = member_count + 1 where id = new.clan_id;
  elsif (tg_op = 'DELETE') then
    update public.clans set member_count = greatest(member_count - 1, 0) where id = old.clan_id;
  end if;
  return null;
end $$;

drop trigger if exists trg_clan_member_count on public.clan_members;
create trigger trg_clan_member_count
  after insert or delete on public.clan_members
  for each row execute function public.sync_clan_member_count();

-- ── clan_messages — clan chat (realtime) ─────────────────────────────
create table if not exists public.clan_messages (
  id uuid primary key default uuid_generate_v4(),
  clan_id uuid references public.clans(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete set null,
  content text not null,
  created_at timestamptz default now()
);

create index if not exists idx_clan_messages_clan on public.clan_messages(clan_id, created_at desc);

alter table public.clan_messages enable row level security;

drop policy if exists "Clan messages viewable" on public.clan_messages;
create policy "Clan messages viewable" on public.clan_messages for select using (true);

drop policy if exists "Members post clan messages" on public.clan_messages;
create policy "Members post clan messages"
  on public.clan_messages for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.clan_members m where m.clan_id = clan_messages.clan_id and m.user_id = auth.uid())
  );

drop policy if exists "Users delete own clan messages" on public.clan_messages;
create policy "Users delete own clan messages"
  on public.clan_messages for delete using (auth.uid() = user_id);

-- ── clan_matches — clan-vs-clan ──────────────────────────────────────
create table if not exists public.clan_matches (
  id uuid primary key default uuid_generate_v4(),
  clan_a uuid references public.clans(id) on delete cascade not null,
  clan_b uuid references public.clans(id) on delete cascade not null,
  scheduled_at timestamptz,
  status text not null default 'scheduled', -- 'scheduled'|'live'|'final'|'cancelled'
  score_a integer default 0,
  score_b integer default 0,
  winner_clan_id uuid references public.clans(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clan_matches_status_check') then
    alter table public.clan_matches add constraint clan_matches_status_check
      check (status in ('scheduled','live','final','cancelled'));
  end if;
end $$;

create index if not exists idx_clan_matches_a on public.clan_matches(clan_a);
create index if not exists idx_clan_matches_b on public.clan_matches(clan_b);

alter table public.clan_matches enable row level security;

drop policy if exists "Clan matches viewable" on public.clan_matches;
create policy "Clan matches viewable" on public.clan_matches for select using (true);

drop policy if exists "Authenticated create clan matches" on public.clan_matches;
create policy "Authenticated create clan matches"
  on public.clan_matches for insert with check (auth.uid() = created_by);

drop policy if exists "Clan owners update clan matches" on public.clan_matches;
create policy "Clan owners update clan matches"
  on public.clan_matches for update
  using (
    exists (select 1 from public.clans c where (c.id = clan_matches.clan_a or c.id = clan_matches.clan_b) and c.owner_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────
-- 4. room_messages — polymorphic chat rooms scoped to any entity
--    (a clip, a reel, a match, a tournament, a clan match). One table keyed by
--    (room_type, room_ref) keeps the high-dwell chat surface simple.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.room_messages (
  id uuid primary key default uuid_generate_v4(),
  room_type text not null,   -- 'clip' | 'reel' | 'match' | 'tournament' | 'clan_match'
  room_ref uuid not null,    -- the id of that entity (not an FK: polymorphic)
  user_id uuid references public.profiles(id) on delete set null,
  content text not null,
  created_at timestamptz default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'room_messages_type_check') then
    alter table public.room_messages add constraint room_messages_type_check
      check (room_type in ('clip','reel','match','tournament','clan_match'));
  end if;
end $$;

create index if not exists idx_room_messages_room on public.room_messages(room_type, room_ref, created_at desc);

alter table public.room_messages enable row level security;

drop policy if exists "Room messages viewable" on public.room_messages;
create policy "Room messages viewable" on public.room_messages for select using (true);

drop policy if exists "Authenticated post room messages" on public.room_messages;
create policy "Authenticated post room messages"
  on public.room_messages for insert with check (auth.uid() = user_id);

drop policy if exists "Users delete own room messages" on public.room_messages;
create policy "Users delete own room messages"
  on public.room_messages for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- 5. reels: YouTube embed mapping + clan attribution + highlight flag
-- ─────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='reels') then
    -- The monetized re-upload on OUR channel. When set, the app embeds THIS
    -- instead of the creator's original (bootstraps our channel's watch time).
    execute 'alter table public.reels add column if not exists youtube_video_id text';
    execute 'alter table public.reels add column if not exists clan_id uuid references public.clans(id) on delete set null';
    execute 'alter table public.reels add column if not exists is_clan_highlight boolean default false';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Cost discipline: mark raw uploads transient + track archive/purge.
--    Raw clips are deleted once the combined master is confirmed on YouTube
--    AND archived to the external drive. These columns are the bookkeeping.
-- ─────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='clips') then
    -- Raw user uploads are transient by default; YouTube-sourced clips are not.
    execute 'alter table public.clips add column if not exists is_transient boolean default true';
    execute 'alter table public.clips add column if not exists purged_at timestamptz';
  end if;
end $$;

-- Extend the upload queue with archive state so the worker records where the
-- final master went and when the raw sources were purged.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='pending_uploads') then
    execute 'alter table public.pending_uploads add column if not exists master_storage_path text';
    execute 'alter table public.pending_uploads add column if not exists archived_path text';
    execute 'alter table public.pending_uploads add column if not exists archived_at timestamptz';
    execute 'alter table public.pending_uploads add column if not exists sources_purged_at timestamptz';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 7. Realtime: broadcast the chat tables so the app subscribes to inserts.
-- ─────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['clan_messages','room_messages'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception
  when undefined_object then null;
end $$;

-- Ping PostgREST so the schema cache reloads without waiting.
notify pgrst, 'reload schema';
