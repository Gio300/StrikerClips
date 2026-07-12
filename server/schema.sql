-- ============================================================================
--  KillCam — plain-Postgres schema (Supabase-free)
--
--  Ported from supabase/migrations/001..013 and src/types/database.ts.
--  Differences from the Supabase migrations:
--    * auth.users            -> public.users (real table, bcrypt password_hash)
--    * uuid_generate_v4()    -> gen_random_uuid()  (pgcrypto)
--    * NO row-level security, NO create policy  (auth is enforced in the API)
--    * NO notify pgrst / NO alter publication supabase_realtime
--    * NO auth.uid() / NO storage.* / NO handle_new_user auth trigger
--
--  Fully idempotent: safe to run on every boot. Uses CREATE TABLE IF NOT EXISTS
--  plus ADD COLUMN IF NOT EXISTS so an older/partial database is upgraded too.
-- ============================================================================

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────
--  Identity — replaces auth.users
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  created_at    timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────
--  Profiles (extends users)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                 uuid primary key references public.users(id) on delete cascade,
  username           text unique not null,
  avatar_url         text,
  bio                text,
  social_links       jsonb default '{}',
  power_level        integer default 0,
  country            text,
  dashboard_override jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
alter table public.profiles add column if not exists power_level        integer default 0;
alter table public.profiles add column if not exists country            text;
alter table public.profiles add column if not exists dashboard_override jsonb;

-- ─────────────────────────────────────────────────────────────────────────
--  Clips
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.clips (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.profiles(id) on delete cascade not null,
  source_type  text check (source_type in ('youtube', 'upload')) not null,
  url_or_path  text not null,
  start_sec    integer,
  end_sec      integer,
  thumbnail    text,
  title        text,
  is_transient boolean default true,
  purged_at    timestamptz,
  created_at   timestamptz default now()
);
alter table public.clips add column if not exists is_transient boolean default true;
alter table public.clips add column if not exists purged_at    timestamptz;

-- ─────────────────────────────────────────────────────────────────────────
--  Reels  (clan_id / youtube_video_id / is_clan_highlight added after clans)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.reels (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references public.profiles(id) on delete cascade not null,
  title              text not null,
  clip_ids           uuid[] default '{}',
  combined_video_url text,
  thumbnail          text,
  layout             text not null default 'concat',
  created_at         timestamptz default now()
);
alter table public.reels add column if not exists layout text not null default 'concat';

-- ─────────────────────────────────────────────────────────────────────────
--  Matches
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  reel_ids    uuid[] default '{}',
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────
--  Servers / channels / messages / reactions
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.servers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  icon_url   text,
  created_at timestamptz default now()
);

create table if not exists public.server_members (
  id         uuid primary key default gen_random_uuid(),
  server_id  uuid references public.servers(id) on delete cascade not null,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  role       text default 'member',
  created_at timestamptz default now(),
  unique (server_id, user_id)
);

create table if not exists public.channels (
  id         uuid primary key default gen_random_uuid(),
  server_id  uuid references public.servers(id) on delete cascade not null,
  name       text not null,
  type       text check (type in ('text', 'clips')) default 'text',
  created_at timestamptz default now()
);

do $$ begin
  alter table public.channels add constraint channels_server_name_unique unique (server_id, name);
exception when duplicate_object then null;
end $$;

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid references public.channels(id) on delete cascade not null,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  content    text not null default '',
  clip_id    uuid references public.clips(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.reactions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages(id) on delete cascade not null,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  emoji      text not null,
  created_at timestamptz default now(),
  unique (message_id, user_id, emoji)
);

-- ─────────────────────────────────────────────────────────────────────────
--  Social — follows / reel likes
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid references public.profiles(id) on delete cascade not null,
  following_id uuid references public.profiles(id) on delete cascade not null,
  created_at   timestamptz default now(),
  unique (follower_id, following_id),
  check (follower_id != following_id)
);

create table if not exists public.reel_likes (
  id         uuid primary key default gen_random_uuid(),
  reel_id    uuid references public.reels(id) on delete cascade not null,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique (reel_id, user_id)
);

-- ─────────────────────────────────────────────────────────────────────────
--  Live streams / groups / youtube links
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.live_streams (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete cascade not null,
  youtube_url text not null,
  title       text,
  is_live     boolean default true,
  created_at  timestamptz default now()
);

create table if not exists public.live_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  creator_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz default now()
);
alter table public.live_groups add column if not exists creator_id uuid references public.profiles(id) on delete cascade;

create table if not exists public.live_group_members (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid references public.live_groups(id) on delete cascade not null,
  user_id   uuid references public.profiles(id) on delete cascade not null,
  stream_id uuid references public.live_streams(id) on delete set null,
  accepted  boolean default false,
  unique (group_id, user_id)
);

create table if not exists public.user_youtube_links (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete cascade not null,
  url        text not null,
  title      text,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────
--  Direct messages
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.dm_conversations (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.dm_participants (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.dm_conversations(id) on delete cascade not null,
  user_id         uuid references public.profiles(id) on delete cascade not null,
  joined_at       timestamptz default now(),
  unique (conversation_id, user_id)
);

create table if not exists public.dm_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.dm_conversations(id) on delete cascade not null,
  user_id         uuid references public.profiles(id) on delete cascade not null,
  content         text not null default '',
  created_at      timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────
--  Polls
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.polls (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete cascade not null,
  question   text not null,
  created_at timestamptz default now(),
  ends_at    timestamptz
);

create table if not exists public.poll_options (
  id      uuid primary key default gen_random_uuid(),
  poll_id uuid references public.polls(id) on delete cascade not null,
  text    text not null,
  "order" int default 0
);

create table if not exists public.poll_votes (
  id             uuid primary key default gen_random_uuid(),
  poll_id        uuid references public.polls(id) on delete cascade not null,
  poll_option_id uuid references public.poll_options(id) on delete cascade not null,
  user_id        uuid references public.profiles(id) on delete cascade not null,
  created_at     timestamptz default now(),
  unique (poll_id, user_id)
);

-- ─────────────────────────────────────────────────────────────────────────
--  Reel reactions + activity feed
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.reel_reactions (
  id         uuid primary key default gen_random_uuid(),
  reel_id    uuid references public.reels(id) on delete cascade not null,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  emoji      text not null,
  created_at timestamptz default now(),
  unique (reel_id, user_id, emoji)
);

create table if not exists public.activities (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete cascade not null,
  type        text not null check (type in ('reel_created', 'follow', 'reel_like', 'poll_created')),
  target_id   uuid,
  target_meta jsonb default '{}',
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────
--  Screenshot rankings — match results / power ratings / trophies
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.match_results (
  id             uuid primary key default gen_random_uuid(),
  uploader_id    uuid references public.profiles(id) on delete cascade not null,
  screenshot_url text,
  match_type     text not null check (match_type in ('survival', 'quick_match', 'red_white', 'ninja_world_league', 'tournament')),
  status         text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  outcome        text,
  kills          integer,
  deaths         integer,
  ocr_confidence real,
  verified_at    timestamptz,
  verified_by    uuid references public.profiles(id),
  created_at     timestamptz default now()
);
alter table public.match_results add column if not exists outcome        text;
alter table public.match_results add column if not exists kills          integer;
alter table public.match_results add column if not exists deaths         integer;
alter table public.match_results add column if not exists ocr_confidence real;
alter table public.match_results add column if not exists screenshot_url text;

create table if not exists public.match_result_players (
  id         uuid primary key default gen_random_uuid(),
  result_id  uuid references public.match_results(id) on delete cascade not null,
  profile_id uuid references public.profiles(id) on delete cascade not null,
  role       text not null check (role in ('winner', 'loser', 'participant')),
  score      integer,
  team       text check (team in ('red', 'white')),
  unique (result_id, profile_id)
);

create table if not exists public.power_ratings (
  profile_id uuid references public.profiles(id) on delete cascade not null,
  match_type text not null,
  rating     integer not null default 1000,
  wins       integer not null default 0,
  losses     integer not null default 0,
  updated_at timestamptz default now(),
  primary key (profile_id, match_type)
);

create table if not exists public.trophies (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references public.profiles(id) on delete cascade not null,
  trophy_type text not null,
  earned_at   timestamptz default now(),
  metadata    jsonb default '{}'
);

-- ─────────────────────────────────────────────────────────────────────────
--  Tournaments
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.tournaments (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  description           text,
  rules                 text,
  server_id             uuid references public.servers(id) on delete set null,
  start_at              timestamptz,
  end_at                timestamptz,
  status                text default 'draft',
  prize_pool            text,
  stat_check_times      jsonb default '[]',
  tournament_days_times jsonb default '{}',
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz default now()
);
alter table public.tournaments add column if not exists rules                 text;
alter table public.tournaments add column if not exists start_at              timestamptz;
alter table public.tournaments add column if not exists end_at                timestamptz;
alter table public.tournaments add column if not exists status                text default 'draft';
alter table public.tournaments add column if not exists prize_pool            text;
alter table public.tournaments add column if not exists stat_check_times      jsonb default '[]';
alter table public.tournaments add column if not exists tournament_days_times jsonb default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_status_check') then
    alter table public.tournaments add constraint tournaments_status_check
      check (status in ('draft', 'open', 'live', 'closed'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
--  Stat check submissions (buff/tournament verification)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.stat_check_submissions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references public.profiles(id) on delete cascade not null,
  tournament_id     uuid references public.tournaments(id) on delete set null,
  video_url         text not null,
  character_name    text,
  description       text,
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  invited_admin_id  uuid references public.profiles(id) on delete set null,
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  review_notes      text,
  creator_decision  text,
  creator_notes     text,
  creator_decided_at timestamptz,
  created_at        timestamptz default now()
);
alter table public.stat_check_submissions add column if not exists tournament_id      uuid references public.tournaments(id) on delete set null;
alter table public.stat_check_submissions add column if not exists invited_admin_id   uuid references public.profiles(id) on delete set null;
alter table public.stat_check_submissions add column if not exists reviewed_by        uuid references public.profiles(id) on delete set null;
alter table public.stat_check_submissions add column if not exists review_notes       text;
alter table public.stat_check_submissions add column if not exists creator_decision   text;
alter table public.stat_check_submissions add column if not exists creator_notes      text;
alter table public.stat_check_submissions add column if not exists creator_decided_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stat_check_creator_decision_check') then
    alter table public.stat_check_submissions add constraint stat_check_creator_decision_check
      check (creator_decision is null or creator_decision in ('allow', 'disqualify', 'no_action'));
  end if;
end $$;

create table if not exists public.tournament_admins (
  id                     uuid primary key default gen_random_uuid(),
  tournament_id          uuid references public.tournaments(id) on delete cascade not null,
  user_id                uuid references public.profiles(id) on delete cascade not null,
  can_approve_stat_check boolean default true,
  can_submit_results     boolean default true,
  created_at             timestamptz default now(),
  unique (tournament_id, user_id)
);
alter table public.tournament_admins add column if not exists can_approve_stat_check boolean default true;
alter table public.tournament_admins add column if not exists can_submit_results     boolean default true;

create table if not exists public.tournament_results (
  id                uuid primary key default gen_random_uuid(),
  tournament_id     uuid references public.tournaments(id) on delete cascade not null,
  winner_profile_id uuid references public.profiles(id) on delete cascade not null,
  team_name         text,
  submitted_by      uuid references public.profiles(id) on delete set null,
  created_at        timestamptz default now()
);

create table if not exists public.tournament_entrants (
  id                 uuid primary key default gen_random_uuid(),
  tournament_id      uuid references public.tournaments(id) on delete cascade not null,
  user_id            uuid references public.profiles(id) on delete cascade not null,
  team_name          text,
  team_server_id     uuid references public.servers(id) on delete set null,
  status             text not null default 'accepted',
  agreed_to_rules_at timestamptz,
  invited_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz default now(),
  unique (tournament_id, user_id)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tournament_entrants_status_check') then
    alter table public.tournament_entrants add constraint tournament_entrants_status_check
      check (status in ('pending', 'accepted', 'withdrawn'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
--  Notifications
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete cascade not null,
  kind       text not null,
  title      text not null,
  body       text,
  link       text,
  related_id uuid,
  actor_id   uuid references public.profiles(id) on delete set null,
  read_at    timestamptz,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────
--  Live platform — stream chat, stripe, donations, uploads, soundboard, labels
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.stream_messages (
  id         uuid primary key default gen_random_uuid(),
  stream_id  uuid references public.live_streams(id) on delete cascade not null,
  user_id    uuid references public.profiles(id) on delete set null,
  content    text not null,
  created_at timestamptz default now()
);

create table if not exists public.creator_stripe_accounts (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  stripe_account_id text unique,
  charges_enabled   boolean default false,
  payouts_enabled   boolean default false,
  onboarded_at      timestamptz,
  updated_at        timestamptz default now()
);

create table if not exists public.donations (
  id                       uuid primary key default gen_random_uuid(),
  donor_id                 uuid references public.profiles(id) on delete set null,
  creator_id               uuid references public.profiles(id) on delete cascade not null,
  amount_cents             integer not null check (amount_cents > 0),
  currency                 text default 'usd',
  message                  text,
  stripe_payment_intent_id text unique,
  stripe_charge_id         text,
  status                   text default 'pending',
  created_at               timestamptz default now(),
  paid_at                  timestamptz
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'donations_status_check') then
    alter table public.donations add constraint donations_status_check
      check (status in ('pending', 'paid', 'failed', 'refunded'));
  end if;
end $$;

create table if not exists public.pending_uploads (
  id                  uuid primary key default gen_random_uuid(),
  reel_id             uuid references public.reels(id) on delete cascade not null,
  requested_by        uuid references public.profiles(id) on delete set null,
  status              text default 'queued',
  youtube_video_id    text,
  error               text,
  attempts            integer default 0,
  master_storage_path text,
  archived_path       text,
  archived_at         timestamptz,
  sources_purged_at   timestamptz,
  queued_at           timestamptz default now(),
  uploaded_at         timestamptz
);
alter table public.pending_uploads add column if not exists master_storage_path text;
alter table public.pending_uploads add column if not exists archived_path       text;
alter table public.pending_uploads add column if not exists archived_at         timestamptz;
alter table public.pending_uploads add column if not exists sources_purged_at   timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pending_uploads_status_check') then
    alter table public.pending_uploads add constraint pending_uploads_status_check
      check (status in ('queued', 'processing', 'uploaded', 'failed'));
  end if;
end $$;

create table if not exists public.soundboard_pads (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.profiles(id) on delete cascade not null,
  label        text not null,
  storage_path text not null,
  hotkey       text,
  position     integer default 0,
  created_at   timestamptz default now()
);

create table if not exists public.frame_labels (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete cascade not null,
  source_url text not null,
  game       text default 'shinobi_striker',
  event_kind text not null,
  t_seconds  numeric not null,
  notes      text,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────
--  Creator agreements + earnings (migration 013)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.creator_agreements (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references public.profiles(id) on delete cascade not null,
  scope              text not null default 'clip',
  clip_id            uuid references public.clips(id) on delete cascade,
  reel_id            uuid references public.reels(id) on delete cascade,
  agreement_version  text not null,
  content_sha256     text,
  grant_host         boolean not null default true,
  grant_edit_combine boolean not null default true,
  grant_distribute   boolean not null default true,
  grant_youtube      boolean not null default true,
  grant_monetize     boolean not null default true,
  rev_share_bps      integer not null default 5000,
  user_agent         text,
  accepted_at        timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'creator_agreements_scope_check') then
    alter table public.creator_agreements add constraint creator_agreements_scope_check
      check (scope in ('account', 'clip', 'reel'));
  end if;
end $$;

create table if not exists public.creator_earnings (
  id           uuid primary key default gen_random_uuid(),
  creator_id   uuid references public.profiles(id) on delete cascade not null,
  source       text not null default 'ad_revshare',
  reel_id      uuid references public.reels(id) on delete set null,
  amount_cents integer not null default 0,
  currency     text default 'usd',
  status       text not null default 'accrued',
  period       text,
  note         text,
  created_at   timestamptz default now(),
  paid_at      timestamptz
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'creator_earnings_status_check') then
    alter table public.creator_earnings add constraint creator_earnings_status_check
      check (status in ('accrued', 'payable', 'paid', 'reversed'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
--  Clans
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.clans (
  id           uuid primary key default gen_random_uuid(),
  tag          text unique not null,
  name         text not null,
  description  text,
  emblem_icon  text default 'skull',
  emblem_bg    text default '#f43f5e',
  emblem_fg    text default '#0a0a0f',
  banner_url   text,
  owner_id     uuid references public.profiles(id) on delete set null,
  points       integer not null default 0,
  member_count integer not null default 0,
  wins         integer not null default 0,
  losses       integer not null default 0,
  join_mode    text not null default 'open',
  created_at   timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clans_tag_len_check') then
    alter table public.clans add constraint clans_tag_len_check check (char_length(tag) between 2 and 6);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clans_join_mode_check') then
    alter table public.clans add constraint clans_join_mode_check check (join_mode in ('open', 'request', 'invite'));
  end if;
end $$;

create table if not exists public.clan_members (
  id        uuid primary key default gen_random_uuid(),
  clan_id   uuid references public.clans(id) on delete cascade not null,
  user_id   uuid references public.profiles(id) on delete cascade not null,
  role      text not null default 'member',
  joined_at timestamptz default now(),
  unique (clan_id, user_id)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clan_members_role_check') then
    alter table public.clan_members add constraint clan_members_role_check check (role in ('owner', 'officer', 'member'));
  end if;
end $$;

create table if not exists public.clan_messages (
  id         uuid primary key default gen_random_uuid(),
  clan_id    uuid references public.clans(id) on delete cascade not null,
  user_id    uuid references public.profiles(id) on delete set null,
  content    text not null,
  created_at timestamptz default now()
);

create table if not exists public.clan_matches (
  id             uuid primary key default gen_random_uuid(),
  clan_a         uuid references public.clans(id) on delete cascade not null,
  clan_b         uuid references public.clans(id) on delete cascade not null,
  scheduled_at   timestamptz,
  status         text not null default 'scheduled',
  score_a        integer default 0,
  score_b        integer default 0,
  winner_clan_id uuid references public.clans(id) on delete set null,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clan_matches_status_check') then
    alter table public.clan_matches add constraint clan_matches_status_check
      check (status in ('scheduled', 'live', 'final', 'cancelled'));
  end if;
end $$;

-- ── Keep clans.member_count in sync with the roster (plain plpgsql) ──
create or replace function public.sync_clan_member_count() returns trigger
language plpgsql as $$
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

-- ─────────────────────────────────────────────────────────────────────────
--  Polymorphic chat rooms
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.room_messages (
  id         uuid primary key default gen_random_uuid(),
  room_type  text not null,
  room_ref   uuid not null,
  user_id    uuid references public.profiles(id) on delete set null,
  content    text not null,
  created_at timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'room_messages_type_check') then
    alter table public.room_messages add constraint room_messages_type_check
      check (room_type in ('clip', 'reel', 'match', 'tournament', 'clan_match'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
--  Reels: YouTube embed mapping + clan attribution (added after clans exist)
-- ─────────────────────────────────────────────────────────────────────────
alter table public.reels add column if not exists youtube_video_id  text;
alter table public.reels add column if not exists clan_id           uuid references public.clans(id) on delete set null;
alter table public.reels add column if not exists is_clan_highlight boolean default false;

-- ─────────────────────────────────────────────────────────────────────────
--  Monetization — ad-free entitlement + upload-credit ledger + rewarded ads
--  (server is the SOURCE OF TRUTH for whether a user sees ads; never CSS)
-- ─────────────────────────────────────────────────────────────────────────

-- One row per user. ad_free is the authoritative "hide all ads" flag; it is
-- flipped by the Stripe webhook (or the internal setter) — NOT by the client.
create table if not exists public.entitlements (
  user_id                uuid primary key references public.profiles(id) on delete cascade,
  ad_free                boolean not null default false,
  tier                   text not null default 'free',   -- 'free' | 'pro'
  source                 text,                            -- 'stripe' | 'grant' | 'manual'
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  updated_at             timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'entitlements_tier_check') then
    alter table public.entitlements add constraint entitlements_tier_check check (tier in ('free', 'pro'));
  end if;
end $$;

-- Current credit balance per user + which calendar month we last granted the
-- free monthly allotment (so the refill happens exactly once per month, lazily).
create table if not exists public.upload_credits (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  balance           integer not null default 0,
  last_refill_month text,                                 -- 'YYYY-MM'
  updated_at        timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'upload_credits_balance_nonneg') then
    alter table public.upload_credits add constraint upload_credits_balance_nonneg check (balance >= 0);
  end if;
end $$;

-- Append-only ledger — every credit change (grant / earn / spend / purchase).
create table if not exists public.credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles(id) on delete cascade not null,
  delta         integer not null,                         -- +earn / -spend
  balance_after integer not null,
  reason        text not null,   -- 'monthly_grant'|'rewarded_ad'|'upload'|'purchase'|'admin'
  ref           text,            -- external ref (reward token, reel id, stripe id)
  created_at    timestamptz default now()
);

-- One row per completed rewarded-ad view. The unique (provider, reward_token)
-- makes credit grants idempotent — a replayed token can never double-credit.
create table if not exists public.ad_rewards (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.profiles(id) on delete cascade not null,
  provider     text not null default 'house',
  reward_token text not null,
  credited     boolean not null default false,
  created_at   timestamptz default now(),
  unique (provider, reward_token)
);

-- ─────────────────────────────────────────────────────────────────────────
--  Indexes (all idempotent)
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_entitlements_stripe_customer on public.entitlements(stripe_customer_id);
create index if not exists idx_credit_ledger_user           on public.credit_ledger(user_id, created_at desc);
create index if not exists idx_ad_rewards_user_created      on public.ad_rewards(user_id, created_at desc);
create index if not exists idx_clips_user                on public.clips(user_id);
create index if not exists idx_reels_user                on public.reels(user_id);
create index if not exists idx_reels_clan                on public.reels(clan_id);
create index if not exists idx_messages_channel          on public.messages(channel_id, created_at desc);
create index if not exists idx_activities_user_created   on public.activities(user_id, created_at desc);
create index if not exists idx_dm_messages_conversation  on public.dm_messages(conversation_id, created_at desc);
create index if not exists idx_dm_participants_user      on public.dm_participants(user_id);
create index if not exists idx_match_results_uploader    on public.match_results(uploader_id);
create index if not exists idx_match_results_status      on public.match_results(status);
create index if not exists idx_power_ratings_profile     on public.power_ratings(profile_id);
create index if not exists idx_trophies_profile          on public.trophies(profile_id);
create index if not exists idx_stat_check_user           on public.stat_check_submissions(user_id);
create index if not exists idx_stat_check_status         on public.stat_check_submissions(status);
create index if not exists idx_stat_check_tournament     on public.stat_check_submissions(tournament_id);
create index if not exists idx_stat_check_invited_admin  on public.stat_check_submissions(invited_admin_id);
create index if not exists idx_tournament_admins_tournament   on public.tournament_admins(tournament_id);
create index if not exists idx_tournament_results_tournament  on public.tournament_results(tournament_id);
create index if not exists idx_tournament_entrants_tournament on public.tournament_entrants(tournament_id);
create index if not exists idx_tournament_entrants_user       on public.tournament_entrants(user_id);
create index if not exists idx_tournaments_start_at      on public.tournaments(start_at);
create index if not exists idx_tournaments_status        on public.tournaments(status);
create index if not exists idx_notifications_user_unread  on public.notifications(user_id, read_at);
create index if not exists idx_notifications_user_created on public.notifications(user_id, created_at desc);
create index if not exists idx_stream_messages_stream    on public.stream_messages(stream_id, created_at desc);
create index if not exists idx_donations_creator_paid    on public.donations(creator_id, paid_at desc);
create index if not exists idx_donations_donor           on public.donations(donor_id, created_at desc);
create index if not exists idx_pending_uploads_status_queued on public.pending_uploads(status, queued_at);
create unique index if not exists uq_pending_uploads_reel_open on public.pending_uploads(reel_id) where status in ('queued', 'processing');
create index if not exists idx_soundboard_pads_user      on public.soundboard_pads(user_id, position);
create index if not exists idx_frame_labels_source       on public.frame_labels(source_url);
create index if not exists idx_frame_labels_event        on public.frame_labels(game, event_kind);
create index if not exists idx_creator_agreements_user   on public.creator_agreements(user_id, accepted_at desc);
create index if not exists idx_creator_agreements_clip   on public.creator_agreements(clip_id);
create index if not exists idx_creator_agreements_reel   on public.creator_agreements(reel_id);
create index if not exists idx_creator_earnings_creator  on public.creator_earnings(creator_id, created_at desc);
create index if not exists idx_clans_points              on public.clans(points desc);
create index if not exists idx_clan_members_clan         on public.clan_members(clan_id);
create index if not exists idx_clan_members_user         on public.clan_members(user_id);
create index if not exists idx_clan_messages_clan        on public.clan_messages(clan_id, created_at desc);
create index if not exists idx_clan_matches_a            on public.clan_matches(clan_a);
create index if not exists idx_clan_matches_b            on public.clan_matches(clan_b);
create index if not exists idx_room_messages_room        on public.room_messages(room_type, room_ref, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
--  Seed: default server + channels (migrations 002 / 008)
-- ─────────────────────────────────────────────────────────────────────────
insert into public.servers (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Shinobi Village')
on conflict (id) do update set name = excluded.name;

insert into public.channels (server_id, name, type)
values ('00000000-0000-0000-0000-000000000001', 'general', 'text'),
       ('00000000-0000-0000-0000-000000000001', 'highlights', 'clips'),
       ('00000000-0000-0000-0000-000000000001', 'clips', 'clips')
on conflict (server_id, name) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
--  clip_events — the EVENT INDEX that makes the AI moment-reference instant.
--  A timestamped log of in-game events per video (kill, flag grab, capture,
--  base/barrier, round/match win, combo) for Naruto to Boruto: Shinobi Striker.
--  Sources, most reliable first: 'tag' (uploader-supplied at upload),
--  'ocr' (killfeed/HUD), 'audio', 'chat'. `ordinal` supports "the Nth run".
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.clip_events (
  id          uuid primary key default gen_random_uuid(),
  video_id    text not null,          -- YouTube id (canonical) or reel/clip id
  clip_id     uuid,                   -- optional link to public.clips
  game        text not null default 'shinobi_striker',
  mode        text,                   -- flag_battle | barrier_battle | base_battle | combat
  event_kind  text not null,          -- kill | death | flag_grab | flag_capture | base_taken | barrier | round_win | match_win | combo
  actor       text,                   -- who did it (username / display text)
  target      text,                   -- who it happened to
  ordinal     integer,                -- 1st, 2nd, ... occurrence of this kind
  t_seconds   numeric not null,       -- start moment
  end_seconds numeric,                -- optional segment end (reference only; full video stays scrubbable)
  label       text,                   -- human label for chapters ("Kill 4 on rival")
  source      text not null default 'tag',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz default now()
);

create index if not exists idx_clip_events_video on public.clip_events(video_id, t_seconds);
create index if not exists idx_clip_events_kind  on public.clip_events(video_id, event_kind, ordinal);
