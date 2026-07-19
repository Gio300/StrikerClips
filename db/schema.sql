-- ============================================================================
-- KillCam — portable SQL schema (plain PostgreSQL, NO Supabase)
-- ----------------------------------------------------------------------------
-- Extracted from the Supabase migrations and de-Supabase-ified:
--   * `auth.users`      -> a real `public.users` table (own auth) that `profiles`
--                          references. Passwords stored as a hash (bcrypt/argon2
--                          done in the API layer, never plaintext).
--   * `auth.uid()` RLS  -> REMOVED. Authorization is enforced in the API layer.
--                          (If you want DB-level RLS on standalone Postgres, set
--                          `SET app.user_id = '<uuid>'` per request and rewrite
--                          policies to use current_setting('app.user_id').)
--   * `storage.*`       -> a `public.files` table; blobs live in S3/GCS/disk and
--                          the app keeps the URL. Existing url/thumbnail columns
--                          keep working unchanged.
-- Deploy: `psql "<conn>" -f db/schema.sql` on any Postgres 13+ (Cloud SQL, RDS,
-- self-hosted). No Supabase project required.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;   -- gen_random_uuid(), crypt() if you hash in SQL

-- ---------------------------------------------------------------------------
-- AUTH: users (replaces Supabase auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id             uuid primary key default uuid_generate_v4(),
  email          text unique not null,
  password_hash  text,                       -- null for OAuth-only accounts
  provider       text default 'email',       -- 'email' | 'google' | 'github' | ...
  email_verified boolean default false,
  user_metadata  jsonb default '{}',         -- e.g. {"username": "...", "reelone_tier": "pro", "reelone_tier_expires": "..."}
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- CORE
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references public.users(id) on delete cascade,
  username text unique not null,
  avatar_url text,
  bio text,
  social_links jsonb default '{}',
  power_level integer default 0,
  country text,
  game_tag text,
  status text,
  theme_prefs jsonb default '{}',
  text_scale_override numeric default 1,
  dashboard_override jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint profiles_status_length check (status is null or char_length(status) <= 60)
);

create table if not exists public.clips (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null check (source_type in ('youtube','upload')),
  url_or_path text not null,
  start_sec integer,
  end_sec integer,
  thumbnail text,
  title text,
  -- tags for the searchable archive ("his last 10 kills")
  category text check (category in ('kill','death','ultimate','flag','win','clutch','opening','closing')),
  subject_profile_id uuid references public.profiles(id) on delete set null,
  youtube_video_id text,
  created_at timestamptz default now()
);
create index if not exists idx_clips_subject_cat on public.clips(subject_profile_id, category, created_at desc);

create table if not exists public.reels (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  clip_ids uuid[] default '{}',
  combined_video_url text,
  thumbnail text,
  created_at timestamptz default now()
);

create table if not exists public.matches (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  reel_ids uuid[] default '{}',
  scheduled_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.servers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  icon_url text,
  clan_tag text,
  owner_id uuid references public.profiles(id) on delete set null,
  join_mode text default 'open',
  total_points integer default 0,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists public.server_members (
  id uuid primary key default uuid_generate_v4(),
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text default 'member',
  created_at timestamptz default now(),
  unique(server_id, user_id)
);

create table if not exists public.channels (
  id uuid primary key default uuid_generate_v4(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null,
  type text default 'text' check (type in ('text','clips')),
  created_at timestamptz default now()
);
create unique index if not exists channels_server_name_idx on public.channels (server_id, name);

create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  clip_id uuid references public.clips(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.reactions (
  id uuid primary key default uuid_generate_v4(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz default now(),
  unique(message_id, user_id, emoji)
);

create table if not exists public.follows (
  id uuid primary key default uuid_generate_v4(),
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique(follower_id, following_id),
  check (follower_id != following_id)
);

create table if not exists public.reel_likes (
  id uuid primary key default uuid_generate_v4(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique(reel_id, user_id)
);

-- ---------------------------------------------------------------------------
-- LIVE
-- ---------------------------------------------------------------------------
create table if not exists public.live_streams (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  youtube_url text not null,
  title text,
  is_live boolean default true,
  created_at timestamptz default now()
);
create table if not exists public.live_groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  creator_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz default now()
);
create table if not exists public.live_group_members (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.live_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  stream_id uuid references public.live_streams(id) on delete set null,
  accepted boolean default false,
  unique(group_id, user_id)
);
create table if not exists public.user_youtube_links (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  url text not null,
  title text,
  created_at timestamptz default now()
);

-- Channel restream SLOTS (limited concurrent live streams on OUR channel; FCFS + scheduling)
create table if not exists public.stream_slots (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','live','ended','cancelled')),
  created_at timestamptz default now(),
  check (ends_at > starts_at)
);
create index if not exists idx_stream_slots_window on public.stream_slots(starts_at, ends_at);

-- ---------------------------------------------------------------------------
-- DMs / POLLS / ACTIVITY / POSTS
-- ---------------------------------------------------------------------------
create table if not exists public.dm_conversations (id uuid primary key default uuid_generate_v4(), name text, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.dm_participants (id uuid primary key default uuid_generate_v4(), conversation_id uuid not null references public.dm_conversations(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, joined_at timestamptz default now(), unique(conversation_id, user_id));
create table if not exists public.dm_messages (id uuid primary key default uuid_generate_v4(), conversation_id uuid not null references public.dm_conversations(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, content text not null default '', created_at timestamptz default now());
create table if not exists public.polls (id uuid primary key default uuid_generate_v4(), user_id uuid not null references public.profiles(id) on delete cascade, question text not null, created_at timestamptz default now(), ends_at timestamptz);
create table if not exists public.poll_options (id uuid primary key default uuid_generate_v4(), poll_id uuid not null references public.polls(id) on delete cascade, text text not null, "order" int default 0);
create table if not exists public.poll_votes (id uuid primary key default uuid_generate_v4(), poll_id uuid not null references public.polls(id) on delete cascade, poll_option_id uuid not null references public.poll_options(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz default now(), unique(poll_id, user_id));
create table if not exists public.reel_reactions (id uuid primary key default uuid_generate_v4(), reel_id uuid not null references public.reels(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, emoji text not null, created_at timestamptz default now(), unique(reel_id, user_id, emoji));
create table if not exists public.activities (id uuid primary key default uuid_generate_v4(), user_id uuid not null references public.profiles(id) on delete cascade, type text not null check (type in ('reel_created','follow','reel_like','poll_created')), target_id uuid, target_meta jsonb default '{}', created_at timestamptz default now());
create index if not exists idx_activities_user_created on public.activities(user_id, created_at desc);
create index if not exists idx_dm_messages_conversation on public.dm_messages(conversation_id, created_at desc);
create index if not exists idx_dm_participants_user on public.dm_participants(user_id);

create table if not exists public.posts (id uuid primary key default uuid_generate_v4(), user_id uuid not null references public.profiles(id) on delete cascade, body text not null default '', created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.post_attachments (id uuid primary key default uuid_generate_v4(), post_id uuid not null references public.posts(id) on delete cascade, type text not null check (type in ('image','reel')), url_or_id text not null, sort_order integer default 0, created_at timestamptz default now());
create table if not exists public.post_polls (id uuid primary key default uuid_generate_v4(), post_id uuid not null references public.posts(id) on delete cascade unique, question text not null, ends_at timestamptz, created_at timestamptz default now());
create table if not exists public.post_poll_options (id uuid primary key default uuid_generate_v4(), poll_id uuid not null references public.post_polls(id) on delete cascade, label text not null, sort_order integer default 0, created_at timestamptz default now());
create table if not exists public.post_poll_votes (id uuid primary key default uuid_generate_v4(), option_id uuid not null references public.post_poll_options(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz default now(), unique(option_id, user_id));
create index if not exists posts_user_id on public.posts(user_id);
create index if not exists posts_created_at on public.posts(created_at desc);

-- ---------------------------------------------------------------------------
-- RANKINGS / MATCH RESULTS / STAT CHECK / TOURNAMENTS
-- ---------------------------------------------------------------------------
create table if not exists public.match_results (id uuid primary key default uuid_generate_v4(), uploader_id uuid not null references public.profiles(id) on delete cascade, screenshot_url text, screenshot_hash text, match_type text not null check (match_type in ('survival','quick_match','red_white','ninja_world_league','tournament','barrier_battle')), status text not null default 'pending' check (status in ('pending','verified','rejected')), play_time_sec integer, results_remaining_sec integer, game text default 'shinobi_striker', uploader_in_game_name text, verified_at timestamptz, verified_by uuid references public.profiles(id), created_at timestamptz default now());
create table if not exists public.match_result_players (id uuid primary key default uuid_generate_v4(), result_id uuid not null references public.match_results(id) on delete cascade, profile_id uuid not null references public.profiles(id) on delete cascade, role text not null check (role in ('winner','loser','participant')), score integer, points integer, in_game_name text, team text check (team in ('red','white')), unique(result_id, profile_id));
create table if not exists public.power_ratings (profile_id uuid not null references public.profiles(id) on delete cascade, match_type text not null, rating integer not null default 1000, wins integer not null default 0, losses integer not null default 0, accumulated_points integer not null default 0, updated_at timestamptz default now(), primary key (profile_id, match_type));
create table if not exists public.trophies (id uuid primary key default uuid_generate_v4(), profile_id uuid not null references public.profiles(id) on delete cascade, trophy_type text not null, earned_at timestamptz default now(), metadata jsonb default '{}');
create table if not exists public.stat_check_submissions (id uuid primary key default uuid_generate_v4(), user_id uuid not null references public.profiles(id) on delete cascade, video_url text not null, character_name text, description text, status text not null default 'pending' check (status in ('pending','approved','rejected')), tournament_id uuid, reviewed_by uuid references public.profiles(id) on delete set null, reviewed_at timestamptz, created_at timestamptz default now());
create table if not exists public.tournaments (id uuid primary key default uuid_generate_v4(), name text not null, description text, rules text, server_id uuid references public.servers(id) on delete set null, stat_check_times jsonb default '[]', tournament_days_times jsonb default '{}', created_by uuid references public.profiles(id) on delete set null, created_at timestamptz default now());
create table if not exists public.tournament_admins (id uuid primary key default uuid_generate_v4(), tournament_id uuid not null references public.tournaments(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz default now(), unique(tournament_id, user_id));
create table if not exists public.tournament_results (id uuid primary key default uuid_generate_v4(), tournament_id uuid not null references public.tournaments(id) on delete cascade, winner_profile_id uuid not null references public.profiles(id) on delete cascade, team_name text, submitted_by uuid references public.profiles(id) on delete set null, created_at timestamptz default now());
alter table public.stat_check_submissions add constraint stat_check_tournament_fk foreign key (tournament_id) references public.tournaments(id) on delete set null;
create index if not exists idx_match_results_uploader on public.match_results(uploader_id);
create index if not exists idx_power_ratings_profile on public.power_ratings(profile_id);
create index if not exists idx_trophies_profile on public.trophies(profile_id);

-- ---------------------------------------------------------------------------
-- REDEEM PASSES  (comp/founder codes -> Pro month)
-- ---------------------------------------------------------------------------
create table if not exists public.redeem_codes (
  code text primary key, tier text not null default 'pro' check (tier in ('pro','supporter','creator')),
  months integer not null default 1, max_uses integer not null default 1, uses integer not null default 0,
  active boolean not null default true, note text, expires_at timestamptz, created_at timestamptz default now()
);
create table if not exists public.code_redemptions (
  id uuid primary key default uuid_generate_v4(), code text not null references public.redeem_codes(code) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade, tier_granted text not null,
  grant_expires_at timestamptz not null, redeemed_at timestamptz not null default now(), unique(code, user_id)
);

-- ---------------------------------------------------------------------------
-- STORAGE replacement (blobs live in S3/GCS/disk; DB keeps metadata + URL)
-- ---------------------------------------------------------------------------
create table if not exists public.files (
  id uuid primary key default uuid_generate_v4(),
  bucket text not null,                     -- 'videos' | 'avatars' | 'match-screenshots' | 'post-images' | 'stat-check-videos'
  path text not null,
  url text not null,
  owner_id uuid references public.profiles(id) on delete set null,
  content_type text,
  bytes bigint,
  created_at timestamptz default now(),
  unique(bucket, path)
);

-- ---------------------------------------------------------------------------
-- BUSINESS LOGIC (kept as plain plpgsql — no auth dependency)
-- ---------------------------------------------------------------------------
create or replace function public.on_user_created() returns trigger as $$
declare base_username text; final_username text;
begin
  base_username := coalesce(nullif(trim(new.user_metadata->>'username'), ''), split_part(new.email,'@',1), 'user_' || substr(new.id::text,1,8));
  base_username := regexp_replace(base_username, '[^a-zA-Z0-9_]', '_', 'g');
  final_username := base_username;
  while exists (select 1 from public.profiles where username = final_username) loop
    final_username := base_username || '_' || substr(md5(random()::text),1,4);
  end loop;
  insert into public.profiles (id, username) values (new.id, final_username) on conflict (id) do nothing;
  return new;
end; $$ language plpgsql;
drop trigger if exists trg_on_user_created on public.users;
create trigger trg_on_user_created after insert on public.users for each row execute procedure public.on_user_created();

create or replace function public.record_reel_activity() returns trigger as $$ begin insert into public.activities (user_id, type, target_id, target_meta) values (new.user_id, 'reel_created', new.id, jsonb_build_object('title', new.title)); return new; end; $$ language plpgsql;
create or replace function public.record_follow_activity() returns trigger as $$ begin insert into public.activities (user_id, type, target_id, target_meta) values (new.follower_id, 'follow', new.following_id, '{}'); return new; end; $$ language plpgsql;
create or replace function public.record_reel_like_activity() returns trigger as $$ begin insert into public.activities (user_id, type, target_id) values (new.user_id, 'reel_like', new.reel_id); return new; end; $$ language plpgsql;
create or replace function public.record_poll_activity() returns trigger as $$ begin insert into public.activities (user_id, type, target_id, target_meta) values (new.user_id, 'poll_created', new.id, jsonb_build_object('question', new.question)); return new; end; $$ language plpgsql;
drop trigger if exists on_reel_created_activity on public.reels;   create trigger on_reel_created_activity after insert on public.reels for each row execute procedure public.record_reel_activity();
drop trigger if exists on_follow_activity on public.follows;       create trigger on_follow_activity after insert on public.follows for each row execute procedure public.record_follow_activity();
drop trigger if exists on_reel_like_activity on public.reel_likes; create trigger on_reel_like_activity after insert on public.reel_likes for each row execute procedure public.record_reel_like_activity();
drop trigger if exists on_poll_created_activity on public.polls;   create trigger on_poll_created_activity after insert on public.polls for each row execute procedure public.record_poll_activity();

create or replace function public.update_power_ratings_on_match() returns trigger as $$
declare v_match_type text; v_status text; v_points int;
begin
  select mr.match_type, mr.status into v_match_type, v_status from public.match_results mr where mr.id = new.result_id;
  if v_status is distinct from 'verified' then return new; end if;
  v_points := coalesce(new.points, 0);
  insert into public.power_ratings (profile_id, match_type, rating, wins, losses, accumulated_points, updated_at)
    values (new.profile_id, v_match_type, 1000, 0, 0, v_points, now())
    on conflict (profile_id, match_type) do update set accumulated_points = power_ratings.accumulated_points + v_points, updated_at = now();
  if new.role = 'winner' then update public.power_ratings set wins = wins + 1, updated_at = now() where profile_id = new.profile_id and match_type = v_match_type;
  elsif new.role = 'loser' then update public.power_ratings set losses = losses + 1, updated_at = now() where profile_id = new.profile_id and match_type = v_match_type; end if;
  update public.profiles set power_level = coalesce((select sum(accumulated_points) from public.power_ratings where profile_id = new.profile_id), 0) where id = new.profile_id;
  update public.servers set total_points = total_points + v_points, updated_at = now() where id in (select server_id from public.server_members where user_id = new.profile_id);
  return new;
end; $$ language plpgsql;
drop trigger if exists on_match_result_player_insert_power on public.match_result_players;
create trigger on_match_result_player_insert_power after insert on public.match_result_players for each row execute procedure public.update_power_ratings_on_match();

-- ---------------------------------------------------------------------------
-- SEED
-- ---------------------------------------------------------------------------
insert into public.servers (id, name) values ('00000000-0000-0000-0000-000000000001', 'KillCam Community') on conflict (id) do update set name = excluded.name;
insert into public.channels (server_id, name, type) values
  ('00000000-0000-0000-0000-000000000001','general','text'),
  ('00000000-0000-0000-0000-000000000001','highlights','clips'),
  ('00000000-0000-0000-0000-000000000001','clips','clips')
on conflict (server_id, name) do nothing;

insert into public.redeem_codes (code, tier, months, max_uses, note) values
  ('KILLCAM-EHP6-9SX9','pro',1,1,'founder pass'),('KILLCAM-HAK5-M5MG','pro',1,1,'founder pass'),
  ('KILLCAM-77FC-DZJ9','pro',1,1,'founder pass'),('KILLCAM-JFYA-GTJQ','pro',1,1,'founder pass'),
  ('KILLCAM-C8EJ-PE72','pro',1,1,'founder pass'),('KILLCAM-PDT2-UJKV','pro',1,1,'founder pass'),
  ('KILLCAM-66R8-SL8U','pro',1,1,'founder pass'),('KILLCAM-EDAT-NDQE','pro',1,1,'founder pass'),
  ('KILLCAM-H3CF-NYKL','pro',1,1,'founder pass'),('KILLCAM-TLY7-DUZQ','pro',1,1,'founder pass'),
  ('KILLCAM-JDE2-6S6C','pro',1,1,'founder pass'),('KILLCAM-9A3R-RHH2','pro',1,1,'founder pass')
on conflict (code) do nothing;
