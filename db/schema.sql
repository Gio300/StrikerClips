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
  auto_merge_opt_out boolean not null default false,
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
-- BACKFILL for databases created before these columns existed. `create table if
-- not exists` above is a no-op on an existing table, so without these the index
-- below fails with `column "subject_profile_id" does not exist`.
alter table public.clips add column if not exists category text;
do $$ begin
  alter table public.clips add constraint clips_category_check
    check (category is null or category in ('kill','death','ultimate','flag','win','clutch','opening','closing'));
exception when duplicate_object then null; end $$;
alter table public.clips add column if not exists subject_profile_id uuid references public.profiles(id) on delete set null;
alter table public.clips add column if not exists youtube_video_id text;
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

-- The CAST of a combined/multi-angle reel: every player who appears in it, not
-- just the uploader (`reels.user_id`). This is what makes the core loop close —
-- several players upload their own angle of one match, the app combines them,
-- and then everyone in the result can be told about it and see it in their own
-- clips list. Written only by the trusted path that creates the reel
-- (reel_participants is insert/write 'deny' in the server TABLE_POLICY), so a
-- client can never write itself into somebody else's reel.
create table if not exists public.reel_participants (
  id uuid primary key default uuid_generate_v4(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- The participant's own clip that fed the combined reel, when known.
  clip_id uuid references public.clips(id) on delete set null,
  created_at timestamptz default now(),
  -- One row per person per reel: nobody is listed (or notified) twice.
  unique(reel_id, user_id)
);
create index if not exists idx_reel_participants_user on public.reel_participants(user_id, created_at desc);
create index if not exists idx_reel_participants_reel on public.reel_participants(reel_id);

create table if not exists public.matches (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  reel_ids uuid[] default '{}',
  scheduled_at timestamptz,
  created_at timestamptz default now()
);
alter table public.matches add column if not exists scheduled_at timestamptz;   -- backfill (pre-existing DBs)

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
-- backfill (pre-existing DBs). clan_tag is also added again further down next to
-- its format constraint; `if not exists` makes the repeat harmless.
alter table public.servers add column if not exists clan_tag text;
alter table public.servers add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.servers add column if not exists join_mode text default 'open';
alter table public.servers add column if not exists total_points integer default 0;
alter table public.servers add column if not exists updated_at timestamptz default now();

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
  -- Where the "Go Live" flow placed this stream (see src/lib/tiers.ts Placement).
  -- Higher placements are tier-gated: profile < clan < front_page. 'tournament'
  -- streams to the tournament the user is in. Defaults to 'profile'.
  placement text not null default 'profile'
    check (placement in ('profile','clan','front_page','tournament')),
  -- Heartbeat: bumped while the host is live (see /api/fn/live-heartbeat). A row
  -- still is_live=true whose updated_at (else created_at) is older than the TTL
  -- is treated as NOT live — it stops blocking new go-lives and drops off the
  -- public "who is live now" reads. See STALE_LIVE_STREAM_TTL_MINUTES.
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
-- backfill (pre-existing DBs)
alter table public.live_streams add column if not exists placement text not null default 'profile';
alter table public.live_streams add column if not exists updated_at timestamptz default now();
alter table public.live_streams add column if not exists tournament_id uuid;
alter table public.live_streams add column if not exists show_bracket boolean not null default false;
do $$ begin
  alter table public.live_streams add constraint live_streams_placement_check
    check (placement in ('profile','clan','front_page','tournament'));
exception when duplicate_object then null; end $$;
-- Host-curated ANGLES of a single live_streams "show": the host's own stream is
-- angle 1; added players are further angles (their linked YouTube live or a
-- pasted url). Public to read (viewers switch between angles); written only by
-- the trusted /api/fn/live-angle-* handlers after checking the caller owns the
-- parent stream.
create table if not exists public.live_stream_angles (
  id uuid primary key default uuid_generate_v4(),
  live_stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  label text,
  youtube_url text,
  created_at timestamptz default now()
);
create index if not exists idx_live_stream_angles_stream
  on public.live_stream_angles(live_stream_id, created_at);
create table if not exists public.stream_messages (
  id uuid primary key default uuid_generate_v4(),
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  content text not null,
  created_at timestamptz default now()
);
create index if not exists idx_stream_messages_stream
  on public.stream_messages(stream_id, created_at desc);
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

-- LIVE LINKING (see src/lib/liveLink.ts). When several people are live at once
-- and the engine decides they belong together (a scheduled battle, a clan, a
-- tournament), their streams are LINKED into one multi-angle stage — which is
-- just a `live_groups` row plus its members. These columns record WHY the link
-- exists, so the combined view can explain itself and the notifier can pick the
-- right copy / audience. `notified_at` is the dedupe latch: a link notifies
-- exactly once, no matter how many clients notice it.
alter table public.live_groups add column if not exists link_reason text;
alter table public.live_groups add column if not exists battle_id uuid;
alter table public.live_groups add column if not exists tournament_id uuid;
alter table public.live_groups add column if not exists clan_id uuid;
alter table public.live_groups add column if not exists confidence real;
alter table public.live_groups add column if not exists notified_at timestamptz;
alter table public.live_groups add column if not exists started_at timestamptz default now();
alter table public.live_groups add column if not exists ended_at timestamptz;

-- MARK THE SESSION FOR LATER ASSEMBLY. When a linked live group ends we snapshot
-- everything a combined multi-angle highlight would need to be produced from it
-- afterwards: which streams were in it, who was in it, the window in which ALL
-- of them were live at once (see liveOverlapWindow), and the match context. The
-- renderer is NOT built here — this is purely the durable record so it CAN be.
-- stream_ids / user_ids are snapshotted as jsonb rather than joined out of
-- live_group_members because a member may re-point their `stream_id` later.
create table if not exists public.live_group_sessions (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references public.live_groups(id) on delete cascade,
  -- who owns this record for write purposes (the group creator).
  creator_id uuid references public.profiles(id) on delete set null,
  stream_ids jsonb not null default '[]'::jsonb,
  user_ids jsonb not null default '[]'::jsonb,
  link_reason text,
  battle_id uuid,
  tournament_id uuid,
  -- the ALL-members-live overlap window (epoch-backed timestamps + the span).
  started_at timestamptz not null default now(),
  ended_at timestamptz not null default now(),
  duration_ms bigint not null default 0,
  -- set once a combined highlight has actually been produced from this session.
  assembled_reel_id uuid,
  created_at timestamptz default now(),
  unique(group_id)
);
create index if not exists idx_live_group_sessions_group on public.live_group_sessions(group_id);
create index if not exists idx_live_group_sessions_created on public.live_group_sessions(created_at desc);
-- LIVE-LINK CONSENT. Auto-linking is the DEFAULT — the loop only works if links
-- form on their own — but it is a preference, not a fact of life:
--   'auto' (default) links form automatically on a strong signal
--   'ask'            the link is proposed; the stream joins only once approved
--   'off'            never auto-linked (they can still join a stage by hand)
-- It lives on `profiles` rather than a private settings table on purpose: the
-- engine has to check BOTH people's preference before linking them, so the other
-- party's client must be able to read it. `profiles` is already public-read /
-- owner-write, and this column is NOT in PRIVILEGE_COLS, so its owner (and only
-- its owner) may set it through the generic API. See src/lib/liveLinkPrefs.ts.
alter table public.profiles add column if not exists auto_link_mode text not null default 'auto';
do $$ begin
  alter table public.profiles add constraint profiles_auto_link_mode_check
    check (auto_link_mode in ('auto','ask','off'));
exception when duplicate_object then null; end $$;

-- BLOCKS. One user blocking another (see src/lib/blocking.ts).
--
-- Directional as DATA, symmetric as a RULE: once a row exists in either
-- direction the pair is never auto-linked and never lands in the same
-- multi-angle clip. `hide_in_shared_lives` is how far it reaches in LIVE:
--   false (default) they may still co-appear on a stage set up by a tournament
--                   or a third party — they are just never auto-linked;
--   true            they may not share a live stage at all.
--
-- PRIVACY: TABLE_POLICY makes this owner = blocker_id, select 'owner'. A client
-- can only ever read the blocks IT created — nobody may discover who blocked
-- them. That means the client can only enforce the "I blocked them" direction;
-- the other direction is enforced server-side on insert (reel_participants and
-- live_group_members both refuse a blocked pair), so a block can't be defeated
-- by having the other person assemble the reel or start the stage.
create table if not exists public.blocks (
  id uuid primary key default uuid_generate_v4(),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  hide_in_shared_lives boolean not null default false,
  created_at timestamptz default now(),
  unique(blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists idx_blocks_blocker on public.blocks(blocker_id);
create index if not exists idx_blocks_blocked on public.blocks(blocked_id);

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
create table if not exists public.dm_conversations (id uuid primary key default uuid_generate_v4(), name text, pair_key text unique, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.dm_participants (id uuid primary key default uuid_generate_v4(), conversation_id uuid not null references public.dm_conversations(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, joined_at timestamptz default now(), unique(conversation_id, user_id));
create table if not exists public.dm_messages (id uuid primary key default uuid_generate_v4(), conversation_id uuid not null references public.dm_conversations(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, content text not null default '', created_at timestamptz default now());
alter table public.dm_conversations add column if not exists pair_key text;
create table if not exists public.polls (id uuid primary key default uuid_generate_v4(), user_id uuid not null references public.profiles(id) on delete cascade, question text not null, created_at timestamptz default now(), ends_at timestamptz);
create table if not exists public.poll_options (id uuid primary key default uuid_generate_v4(), poll_id uuid not null references public.polls(id) on delete cascade, text text not null, "order" int default 0);
create table if not exists public.poll_votes (id uuid primary key default uuid_generate_v4(), poll_id uuid not null references public.polls(id) on delete cascade, poll_option_id uuid not null references public.poll_options(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz default now(), unique(poll_id, user_id));
create table if not exists public.reel_reactions (id uuid primary key default uuid_generate_v4(), reel_id uuid not null references public.reels(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, emoji text not null, created_at timestamptz default now(), unique(reel_id, user_id, emoji));
create table if not exists public.activities (id uuid primary key default uuid_generate_v4(), user_id uuid not null references public.profiles(id) on delete cascade, type text not null check (type in ('reel_created','follow','reel_like','poll_created')), target_id uuid, target_meta jsonb default '{}', created_at timestamptz default now());
create index if not exists idx_activities_user_created on public.activities(user_id, created_at desc);
create index if not exists idx_dm_messages_conversation on public.dm_messages(conversation_id, created_at desc);
create index if not exists idx_dm_participants_user on public.dm_participants(user_id);
create unique index if not exists uq_dm_conversations_pair on public.dm_conversations(pair_key);

create table if not exists public.posts (id uuid primary key default uuid_generate_v4(), user_id uuid not null references public.profiles(id) on delete cascade, body text not null default '', created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.post_attachments (id uuid primary key default uuid_generate_v4(), post_id uuid not null references public.posts(id) on delete cascade, type text not null check (type in ('image','reel')), url_or_id text not null, sort_order integer default 0, created_at timestamptz default now());
create table if not exists public.post_comments (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);
create index if not exists idx_post_comments_post on public.post_comments(post_id, created_at);
create table if not exists public.post_likes (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique(post_id, user_id)
);
create index if not exists idx_post_likes_post on public.post_likes(post_id);
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

-- ---------------------------------------------------------------------------
-- TOURNAMENT PRIZE POOLS
-- ---------------------------------------------------------------------------
-- `sweeps` pools are live, internal, non-cashable points escrowed in TKO's
-- wallet. `cash` is deliberately present in the data contract for an approved
-- tournament-payment partner, but the application refuses to open or join a
-- cash pool until that provider is implemented and compliance-approved. Stripe
-- must not be used for paid-entry gaming tournaments.
create table if not exists public.tournament_prize_pools (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  currency text not null check (currency in ('sweeps','cash')),
  entry_amount integer not null check (entry_amount > 0),
  paid_places integer not null default 3 check (paid_places between 1 and 3),
  prize_split_bps jsonb not null default '[7000,2000,1000]'::jsonb,
  status text not null default 'open'
    check (status in ('draft','open','locked','settled','cancelled')),
  provider text not null default 'internal_sweeps',
  compliance_approved boolean not null default false,
  minimum_age integer not null default 18,
  allowed_regions jsonb not null default '[]'::jsonb,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  settled_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists idx_tournament_prize_pools_tournament
  on public.tournament_prize_pools(tournament_id, created_at desc);
create unique index if not exists uq_tournament_prize_pool_active
  on public.tournament_prize_pools(tournament_id, currency)
  where status in ('draft','open','locked');

create table if not exists public.tournament_prize_entries (
  id uuid primary key default uuid_generate_v4(),
  pool_id uuid not null references public.tournament_prize_pools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending','escrowed','refunded','paid','forfeited')),
  provider_payment_id text,
  entered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(pool_id, user_id)
);
create index if not exists idx_tournament_prize_entries_pool
  on public.tournament_prize_entries(pool_id, status, entered_at);
create index if not exists idx_tournament_prize_entries_user
  on public.tournament_prize_entries(user_id, entered_at desc);

create table if not exists public.tournament_prize_payouts (
  id uuid primary key default uuid_generate_v4(),
  pool_id uuid not null references public.tournament_prize_pools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  placement integer not null check (placement between 1 and 3),
  gross_amount integer not null check (gross_amount >= 0),
  net_amount integer not null check (net_amount >= 0),
  provider_payout_id text,
  status text not null default 'paid'
    check (status in ('pending','paid','failed','refunded')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique(pool_id, placement),
  unique(pool_id, user_id)
);
create index if not exists idx_tournament_prize_payouts_user
  on public.tournament_prize_payouts(user_id, created_at desc);

do $$ begin
  alter table public.stat_check_submissions add constraint stat_check_tournament_fk foreign key (tournament_id) references public.tournaments(id) on delete set null;
exception when duplicate_object then null; end $$;
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

-- GLOBAL SINGLE-USE code ledger. A founder HOST code OR a redeem_codes tier pass
-- may be consumed EXACTLY ONCE, by EXACTLY ONE profile (founder requirement).
-- The UNIQUE(code) constraint (here a primary key) IS the guard: the
-- /api/fn/redeem-code handler claims a code by inserting a row here BEFORE it
-- grants anything. The first insert wins; every later attempt — a different
-- profile, the SAME profile retrying, or a concurrent race — violates the
-- constraint and is rejected ("code already used"). `code` stores the canonical
-- identity of the code (upper-cased host code, or the redeem_codes.code key), so
-- case variants of one code cannot each be claimed. Written ONLY by the trusted
-- redeem-code server path (insert/write 'deny' in the API TABLE_POLICY); a
-- profile may read its OWN claims.
create table if not exists public.redeemed_codes (
  code        text primary key,
  redeemed_by uuid not null references public.profiles(id) on delete cascade,
  redeemed_at timestamptz not null default now()
);
create index if not exists idx_redeemed_codes_by on public.redeemed_codes(redeemed_by);

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS / SOUNDBOARD / FRAME LABELS
-- (ported from the frontend: src/lib/notifications.ts, src/components/Soundboard.tsx,
--  src/pages/AILabel.tsx — columns inferred from the reads/writes there)
-- ---------------------------------------------------------------------------

-- In-app notification feed (invites, reviews, decisions, mentions).
create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,   -- recipient
  kind text not null default 'generic',                                     -- NotificationKind
  title text not null,
  body text,
  link text,
  related_id uuid,                                                          -- opaque target (tournament, reel, ...)
  actor_id uuid references public.profiles(id) on delete set null,          -- who triggered it
  read_at timestamptz,                                                      -- null == unread
  created_at timestamptz default now()
);
create index if not exists idx_notifications_user_unread on public.notifications(user_id, read_at, created_at desc);

-- Six-pad soundboard for the live page; audio blobs live in storage, metadata here.
create table if not exists public.soundboard_pads (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  storage_path text not null,               -- path inside the 'soundboard' bucket
  hotkey text,                              -- '1'..'6'
  position integer not null default 0,      -- pad slot 0..5
  created_at timestamptz default now(),
  unique(user_id, position)
);
create index if not exists idx_soundboard_pads_user on public.soundboard_pads(user_id, position);

-- CV/AI frame labels: timestamped event tags a user places on a source video.
create table if not exists public.frame_labels (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_url text not null,                 -- the video being labeled (e.g. YouTube URL)
  game text not null default 'shinobi_striker',
  event_kind text not null,                 -- FrameLabelEvent ('player_killed', 'ultimate_used', ...)
  t_seconds numeric not null,               -- timestamp within the video
  notes text,
  created_at timestamptz default now()
);
create index if not exists idx_frame_labels_user_source on public.frame_labels(user_id, source_url, t_seconds);

-- ---------------------------------------------------------------------------
-- MATCH GROUPING  (auto-categorize + "bunch clips of the SAME match")
-- Mirrors the client engine in src/lib/matchGrouping.ts + src/lib/clipRecords.ts.
-- `match_groups` is the deterministic bunch; `clip_records` is the per-clip
-- analysis (category + outcome/stats) a clip gets bunched by. Both are additive
-- and harmless to existing tables. The future cloud vision reader (see
-- docs/ai-video-system.md) writes richer outcome/stats into the same columns.
-- ---------------------------------------------------------------------------

-- A bunch of clips determined to be the same match. `signature` is the merged,
-- normalized fingerprint; `sig_hash` is hash(signature) — NOT unique yet (loose
-- dedup, like match_signatures in the AI design doc).
create table if not exists public.match_groups (
  id                 uuid primary key default uuid_generate_v4(),
  signature          text not null,                 -- normalized "participants|score|mode|map|..." string
  sig_hash           text not null,                 -- stable hash of signature (matchId in the client)
  participants       text[] default '{}',           -- sorted, normalized handles
  outcome            text check (outcome in ('victory','defeat','draw')),
  score_line         text,
  mode               text,
  map                text,
  confidence         numeric,                        -- 0..1, how many signals agreed
  time_window_start  timestamptz,
  time_window_end    timestamptz,
  game               text not null default 'shinobi_striker',
  created_at         timestamptz default now()
);
create index if not exists idx_match_groups_hash on public.match_groups(game, sig_hash);
-- One group per match signature: the server auto-match uses sig_hash as the
-- deterministic match key, so this unique key makes two simultaneous triggers
-- for the same match converge on ONE group instead of racing to create two.
create unique index if not exists uq_match_groups_sig on public.match_groups(sig_hash);

-- Per-clip auto-analysis produced at add/upload time by the client OCR
-- (ocrMatchResult.ts) + category detector. One row per analyzed clip; the row a
-- clip gets bunched by (match_id -> match_groups).
create table if not exists public.clip_records (
  id             uuid primary key default uuid_generate_v4(),
  clip_id        uuid references public.clips(id) on delete set null,
  player_id      uuid references public.profiles(id) on delete cascade,
  player_handle  text,                              -- in-game / display handle used for grouping
  -- The join keys that let TWO STRANGERS' clips of one match find each other:
  -- a shared lobby/match id (strongest), and/or the other handles seen in the
  -- clip (teammates + opponents) so overlapping rosters link angles. Either is
  -- enough for the metadata grouper; the clock+audio detector covers the case
  -- where a clip has neither.
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
  ocr_confidence numeric,                            -- 0..1 from the client OCR read; low = stored, not trusted
  match_id       uuid references public.match_groups(id) on delete set null,
  created_at     timestamptz default now()
);
create index if not exists idx_clip_records_match on public.clip_records(match_id);
create index if not exists idx_clip_records_player on public.clip_records(player_id, recorded_at desc);
create index if not exists idx_clip_records_youtube on public.clip_records(youtube_id);
-- Additive for existing databases (the create-table only runs on a fresh DB).
alter table public.clip_records add column if not exists lobby_id text;
alter table public.clip_records add column if not exists participants text[] default '{}';

-- ---------------------------------------------------------------------------
-- AUTO-MATCH RENDER QUEUE
-- When the server groups ≥2 clips into the same match, it enqueues ONE render
-- job here. A worker (server/renderWorker.ts) picks up 'pending' jobs, renders
-- the multi-angle video, uploads it to YouTube, writes the youtube_id back, and
-- marks the job 'done' — at which point every participant is notified with the
-- link. Reached only by trusted server code (insert:'deny' in TABLE_POLICY);
-- clients never write it.
-- ---------------------------------------------------------------------------
create table if not exists public.render_jobs (
  id               uuid primary key default uuid_generate_v4(),
  match_id         uuid references public.match_groups(id) on delete cascade,
  -- Deterministic natural key (the client-engine matchId) so re-running
  -- auto-match for the same bunch of clips never enqueues a duplicate job.
  match_key        text unique,
  status           text not null default 'pending'
                     check (status in ('pending','rendering','uploading','done','failed')),
  clip_ids         uuid[] default '{}',
  participant_ids  uuid[] default '{}',
  youtube_id       text,
  combined_video_url text,
  error            text,
  attempts         integer not null default 0,
  -- Do not render the first pair immediately. This collection deadline gives
  -- player three/four time to join; four distinct players shorten the wait.
  ready_at         timestamptz not null default now(),
  -- If another angle arrives after a worker claims the row, complete the
  -- current attempt without publishing it and immediately queue the fuller cut.
  rerender_requested boolean not null default false,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
alter table public.render_jobs add column if not exists ready_at timestamptz not null default now();
alter table public.render_jobs add column if not exists rerender_requested boolean not null default false;
create index if not exists idx_render_jobs_status on public.render_jobs(status, ready_at, created_at);

-- Every completed render is immutable history. The app displays the newest
-- allowed version, while older YouTube uploads remain intact.
create table if not exists public.match_versions (
  id uuid primary key default uuid_generate_v4(),
  match_key text not null,
  version integer not null default 1,
  youtube_id text,
  angle_count integer not null default 2,
  participant_ids uuid[] not null default '{}',
  clip_ids uuid[] not null default '{}',
  source_angles jsonb not null default '[]'::jsonb,
  reason text not null default 'render',
  created_at timestamptz not null default now(),
  unique (match_key, version)
);
alter table public.match_versions add column if not exists participant_ids uuid[] not null default '{}';
alter table public.match_versions add column if not exists clip_ids uuid[] not null default '{}';
alter table public.match_versions add column if not exists source_angles jsonb not null default '[]'::jsonb;
alter table public.match_versions add column if not exists reason text not null default 'render';
create index if not exists match_versions_key_idx on public.match_versions(match_key);

-- One canonical camera per player per recorded match. Removing an angle never
-- deletes an old upload; it queues a reduced-angle current version.
create table if not exists public.match_angles (
  id uuid primary key default uuid_generate_v4(),
  match_key text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  youtube_video_id text not null,
  clip_record_id uuid references public.clip_records(id) on delete set null,
  joined_at timestamptz not null default now(),
  included_in_version integer,
  status text not null default 'active' check (status in ('active','removed')),
  removed_at timestamptz,
  removal_reason text,
  unique (match_key, user_id)
);
alter table public.match_angles add column if not exists clip_record_id uuid references public.clip_records(id) on delete set null;
alter table public.match_angles add column if not exists status text not null default 'active';
alter table public.match_angles add column if not exists removed_at timestamptz;
alter table public.match_angles add column if not exists removal_reason text;
create index if not exists match_angles_key_idx on public.match_angles(match_key);
create index if not exists match_angles_user_status_idx on public.match_angles(user_id, status);

-- ---------------------------------------------------------------------------
-- CLANS  (a clan IS a `servers` row with kind='clan' + an economy attached)
-- Mirrors docs/economy-clans-villages.md §5. All additive & idempotent — safe to
-- re-run against an existing DB with live `servers` / `server_members` data.
-- ---------------------------------------------------------------------------

-- Clan settings live as columns on `servers` (the design doc §5.1 shape).
alter table public.servers add column if not exists kind text not null default 'open';       -- 'clan' | 'open' | 'official'
alter table public.servers add column if not exists max_members integer not null default 100; -- hard cap (founder spec)
alter table public.servers add column if not exists is_recruiting boolean not null default false;
alter table public.servers add column if not exists join_fee_tokens integer not null default 0; -- one-time join fee (Tokens)
alter table public.servers add column if not exists dues_tokens integer not null default 0;     -- recurring dues (Tokens)
alter table public.servers add column if not exists dues_period text not null default 'none';   -- 'none' | 'monthly'
alter table public.servers add column if not exists rules text;                                 -- clan-set rules (shown on join)
alter table public.servers add column if not exists treasury_tokens integer not null default 0; -- accrued 80% clan share

-- Clan membership + rank. Kept distinct from the looser `server_members` so the
-- rank enum (leader|officer|recruiter|member) and the 100-cap are enforced here.
-- (`server_members` stays for existing chat/host-dropdown reads.)
-- LEGACY SHAPE MIGRATION: an earlier deploy created clan_members with a
-- `clan_id` column. The app (and everything below) expects `server_id`. Rename
-- in place — it preserves any existing rows and is a no-op once done.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='clan_members' and column_name='clan_id')
     and not exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='clan_members' and column_name='server_id')
  then
    alter table public.clan_members rename column clan_id to server_id;
  end if;
end $$;

create table if not exists public.clan_members (
  id uuid primary key default uuid_generate_v4(),
  server_id uuid not null references public.servers(id) on delete cascade,   -- the clan
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('leader','officer','recruiter','member')),
  joined_at timestamptz default now(),
  unique(server_id, user_id)
);
create index if not exists idx_clan_members_server on public.clan_members(server_id);
create index if not exists idx_clan_members_user on public.clan_members(user_id);

-- Settlement audit trail for join fees / dues (the 80/20 split, §2). The clan's
-- 80% is added to servers.treasury_tokens; the 20% is platform revenue.
create table if not exists public.clan_dues_payments (
  id uuid primary key default uuid_generate_v4(),
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'join' check (kind in ('join','dues')),
  gross_tokens integer not null,
  clan_tokens integer not null,        -- 80% -> treasury
  platform_tokens integer not null,    -- 20% -> TKO
  created_at timestamptz default now()
);
create index if not exists idx_clan_dues_payments_server on public.clan_dues_payments(server_id, created_at desc);

-- ---------------------------------------------------------------------------
-- CHAT SPACES (Discord-style: Space -> Category -> Channel -> Message)
-- docs/economy-clans-villages.md §4. A "chat" a user makes is a SPACE holding
-- many channels (grouped by category text) with a default #general. Kept as a
-- parallel, self-contained set of tables (chat_spaces/chat_channels/
-- chat_messages) so the legacy servers/channels/messages clan board keeps
-- working untouched. All idempotent.
-- ---------------------------------------------------------------------------
create table if not exists public.chat_spaces (
  id uuid primary key default uuid_generate_v4(),
  kind text not null default 'open' check (kind in ('clan','open','tko')), -- clan|open|tko (§4.2)
  name text not null,
  owner_id uuid references public.profiles(id) on delete set null,          -- creator (open spaces)
  clan_id uuid references public.servers(id) on delete cascade,             -- bound clan (clan spaces)
  created_at timestamptz default now()
);
create index if not exists idx_chat_spaces_owner on public.chat_spaces(owner_id);
create index if not exists idx_chat_spaces_clan on public.chat_spaces(clan_id);
-- One chat space per clan (a clan's dedicated space).
create unique index if not exists chat_spaces_clan_uniq on public.chat_spaces(clan_id) where clan_id is not null;

create table if not exists public.chat_channels (
  id uuid primary key default uuid_generate_v4(),
  space_id uuid not null references public.chat_spaces(id) on delete cascade,
  name text not null,
  category text,                        -- null/empty = ungrouped (top-level)
  position integer not null default 0,  -- sort order within the space
  is_announcement boolean not null default false, -- read-mostly / post-restricted
  created_at timestamptz default now()
);
create index if not exists idx_chat_channels_space on public.chat_channels(space_id, position);
create unique index if not exists chat_channels_space_name_idx on public.chat_channels(space_id, name);

-- Messages for the chat spaces. Same (id, channel_id, user_id, body, created_at)
-- shape the design doc §4.1 calls for — distinct from the legacy `messages`
-- table (which uses `content` + clip_id) so both can coexist.
create table if not exists public.chat_messages (
  id uuid primary key default uuid_generate_v4(),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  body text not null default '',
  created_at timestamptz default now()
);
create index if not exists idx_chat_messages_channel on public.chat_messages(channel_id, created_at);

-- Seed the official TKO Space + its channels (§4.2). Fixed ids so re-running is
-- idempotent and the client can deep-link the official space.
insert into public.chat_spaces (id, kind, name, owner_id, clan_id) values
  ('00000000-0000-0000-0000-0000000c4a70', 'tko', 'TKO Official', null, null)
on conflict (id) do update set name = excluded.name, kind = excluded.kind;
insert into public.chat_channels (space_id, name, category, position, is_announcement) values
  ('00000000-0000-0000-0000-0000000c4a70','announcements','INFO',0,true),
  ('00000000-0000-0000-0000-0000000c4a70','general','COMMUNITY',1,false),
  ('00000000-0000-0000-0000-0000000c4a70','find-a-clan','COMMUNITY',2,false),
  ('00000000-0000-0000-0000-0000000c4a70','tournaments','COMMUNITY',3,false),
  ('00000000-0000-0000-0000-0000000c4a70','help','COMMUNITY',4,false)
on conflict (space_id, name) do nothing;

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
  -- Collision check must be CASE-INSENSITIVE to match the
  -- `profiles_username_lower_uniq` index (see IDENTITY UNIQUENESS below);
  -- a case-sensitive `=` here would let "Rekt" past the loop and then blow up
  -- on the index when "rekt" already exists.
  while exists (select 1 from public.profiles where lower(username) = lower(final_username)) loop
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

-- ---------------------------------------------------------------------------
-- TKO KING — featured 1-on-1, pit-based, play-anytime tournament format.
-- All idempotent & additive (safe to re-run against a live DB). See
-- src/lib/tkoKing.ts for the pure format/phase/host/closet logic.
-- ---------------------------------------------------------------------------

-- Format + prime-placement flags on the existing tournaments table.
--   format='king_pit'      marks the featured TKO King format.
--   is_featured            gives a tournament PRIME front-page placement.
--   streams_to_youtube     SCAFFOLD flag: its battles are meant to auto-stream
--                          to our YouTube + the front page. The real YT
--                          auto-streaming is a LATER integration — this only
--                          records intent so the placement/UX is wired now.
--   enroll_opens/closes    the open-ENROLLMENT window; after it closes the
--                          SCHEDULING phase begins, then battles at start_at.
alter table public.tournaments add column if not exists format text not null default 'standard';
alter table public.tournaments add column if not exists is_featured boolean not null default false;
alter table public.tournaments add column if not exists streams_to_youtube boolean not null default false;
alter table public.tournaments add column if not exists enroll_opens timestamptz;
alter table public.tournaments add column if not exists enroll_closes timestamptz;
create index if not exists idx_tournaments_featured on public.tournaments(is_featured, format);

-- A Shinobi who registered for a (King) tournament through the entry gate.
--   streamed     agreed to LIVE-STREAM their battles on TKO.
--   no_mod_ack   accepted the no-modding attestation.
--   membership_granted  the +30-day ad_free "everyone who competes" grant applied.
create table if not exists public.tournament_registrations (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  registered_at timestamptz default now(),
  streamed boolean not null default false,
  no_mod_ack boolean not null default false,
  membership_granted boolean not null default false,
  unique(tournament_id, user_id)
);
create index if not exists idx_tournament_registrations_tournament on public.tournament_registrations(tournament_id);
create index if not exists idx_tournament_registrations_user on public.tournament_registrations(user_id);

-- A 1-on-1 battle (matchup) in a tournament. Registered Shinobi self-schedule
-- `scheduled_at` (play anytime). status walks scheduled → live → complete, or
-- → forfeit when a Shinobi no-shows at the stat check / isn't present.
create table if not exists public.tournament_battles (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_a uuid not null references public.profiles(id) on delete cascade,
  player_b uuid references public.profiles(id) on delete set null,
  scheduled_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','live','complete','forfeit')),
  winner uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists idx_tournament_battles_tournament on public.tournament_battles(tournament_id, scheduled_at);
-- Bracket round (1 = first round). Optional: the board derives a round when
-- this is null, so older rows keep rendering. See src/lib/tkoKing.ts.
alter table public.tournament_battles add column if not exists round integer;
alter table public.tournament_battles add column if not exists bracket_slot integer;
create unique index if not exists uq_tournament_battle_bracket_slot
  on public.tournament_battles(tournament_id, round, bracket_slot)
  where round is not null and bracket_slot is not null;

-- PIT MEET-UP: the private per-battle info exchange between the two fighters.
-- Each fighter posts one card (in-game name / platform / lobby / notes); both
-- see each other's. Readable ONLY by the two fighters in the battle and hosts.
create table if not exists public.battle_meetups (
  id uuid primary key default uuid_generate_v4(),
  battle_id uuid not null references public.tournament_battles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  in_game_name text,
  platform text,
  lobby text,
  notes text,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique(battle_id, user_id)
);
create index if not exists idx_battle_meetups_battle on public.battle_meetups(battle_id);

-- Shinobi Trophy Closet: each defeated opponent becomes a "Shinobi" entry on the
-- victor's closet with a running beat_count. Upsert-incremented on each win.
create table if not exists public.shinobi_defeats (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,      -- the victor
  opponent_id uuid not null references public.profiles(id) on delete cascade,  -- the defeated Shinobi
  beat_count integer not null default 1,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique(user_id, opponent_id)
);
create index if not exists idx_shinobi_defeats_user on public.shinobi_defeats(user_id);

-- ---------------------------------------------------------------------------
-- HOST COMMENTARY / HOSTING LANE  (docs/TKO-BUILD-PLAN.md §3 versioning + §4)
--
-- A HOST (global tko_host capability) narrates matches. Two ways in:
--   • HOST A LIVE MATCH — the host goes live now, captured either through their
--     local OBS (obs-websocket, source='obs') or straight from the phone/browser
--     camera+mic (source='camera'). mode='live'.
--   • ADD COMMENTARY TO A PAST MATCH — the host picks an existing match (or reel)
--     and records commentary over it (camera+mic, or mic-only source='mic').
--     mode='past'; match_id / reel_id point at what is being commentated.
--
-- Each row IS the "with host" version marker for its match/reel (§3): the player
-- / version picker looks a match up here to offer with-host vs without-host.
-- Only a host may create one (TABLE_POLICY: insert 'custom', host_id forced to
-- the caller); everyone may READ (a produced host cut is public content).
-- All additive & idempotent — safe to re-run against a live DB.
-- ---------------------------------------------------------------------------
create table if not exists public.host_commentaries (
  id uuid primary key default uuid_generate_v4(),
  host_id uuid not null references public.profiles(id) on delete cascade,   -- the commentator
  -- What this is the "with host" version OF. A past-match commentary sets one of
  -- these; a freshly-hosted LIVE match may set neither until a reel is produced.
  match_id uuid references public.matches(id) on delete cascade,
  reel_id  uuid references public.reels(id) on delete cascade,
  mode   text not null default 'past'   check (mode in ('live','past')),
  -- Named `capture_source` (not `source`): `source` is a global PRIVILEGE_COL in
  -- server/app.ts, so a column literally called `source` would be stripped from
  -- every client write.
  capture_source text not null default 'camera' check (capture_source in ('obs','camera','mic')),
  title text,
  -- The produced commentary track / video URL, when known (the "with host" output).
  commentary_url text,
  status text not null default 'ready' check (status in ('draft','live','ready')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_host_commentaries_match on public.host_commentaries(match_id);
create index if not exists idx_host_commentaries_reel  on public.host_commentaries(reel_id);
create index if not exists idx_host_commentaries_host  on public.host_commentaries(host_id);

-- ---------------------------------------------------------------------------
-- LIVE SESSIONS  (the unified "who's live RIGHT NOW" indicator)
--
-- The pieces of "live" already exist scattered across the schema — a broadcaster
-- flips live_streams.is_live, a host records a host_commentaries row with
-- mode='live'/status='live', a battle walks tournament_battles.status='live' —
-- but there was no single, uniform record the Live surfaces (home + profiles)
-- can read with ONE query and that a session can flip on and off. `live_sessions`
-- IS that record: one row per thing that is currently on air, with who is live,
-- a way to open the live view (`watch_url`), and a `status` that walks
-- 'live' -> 'ended'. When it ends a video of it may be posted after — the
-- `youtube_id` path already covers that (the render worker stamps it, same as
-- clip_records / render_jobs), so an ended session with a youtube_id becomes a
-- normal produced video in the Recent feed.
--
-- `host_id` is the person who went live (a host, or a fighter). It is FORCED to
-- the caller by TABLE_POLICY (insert/write 'owner', exactly like live_streams):
-- you may only mark YOURSELF live and only you (or a global host) may end your
-- session — the row can never be forged for somebody else. Reads are PUBLIC (a
-- session nobody can see is not live). Additive & idempotent.
-- ---------------------------------------------------------------------------
create table if not exists public.live_sessions (
  id             uuid primary key default uuid_generate_v4(),
  host_id        uuid not null references public.profiles(id) on delete cascade,  -- who is live
  -- What kind of live thing this is: a host going live, a player battle, or a
  -- plain solo stream. Purely descriptive (drives the card copy / icon).
  kind           text not null default 'host' check (kind in ('host','battle','stream')),
  title          text,
  status         text not null default 'live' check (status in ('live','ended')),
  -- What this session is OF, when known (any subset may be set).
  match_id       uuid references public.matches(id) on delete set null,
  reel_id        uuid references public.reels(id) on delete set null,
  battle_id      uuid references public.tournament_battles(id) on delete set null,
  tournament_id  uuid references public.tournaments(id) on delete set null,
  -- Where to open the live view — a YouTube live URL, or an in-app route like
  -- /live-stage/<id>. The client picks external vs internal by the scheme.
  watch_url      text,
  -- The produced video of the session, posted AFTER it ends (render worker path).
  youtube_id     text,
  started_at     timestamptz default now(),
  ended_at       timestamptz,
  created_at     timestamptz default now()
);
create index if not exists idx_live_sessions_status on public.live_sessions(status, started_at desc);
create index if not exists idx_live_sessions_host on public.live_sessions(host_id, status);

-- ---------------------------------------------------------------------------
-- IDENTITY UNIQUENESS  (usernames, clan names, clan tags)
-- Additive & idempotent. Mirrors the pure rules in src/lib/identity.ts.
--
-- Uniqueness is CASE-INSENSITIVE, so "Rekt" and "rekt" are one identity and
-- only one account can hold it. Enforced with functional unique indexes on
-- lower(...) rather than a citext column, so no extension is required and the
-- rule is visible in the schema.
--
-- RELEASE ON DELETE: uniqueness is a property of the ROW EXISTING. Deleting a
-- profile or a clan (hard delete) drops the index entry and the name/tag
-- returns to the pool immediately. NOTE: if a soft-delete flag is ever added to
-- profiles or servers, these indexes MUST gain a `where deleted_at is null`
-- clause (and the app must null out the unique fields on soft-delete) —
-- otherwise a "deleted" row keeps its name reserved forever.
-- ---------------------------------------------------------------------------

-- Clan tag: the short `[AI]` badge. 2-5 letters/digits, stored UPPERCASE.
alter table public.servers add column if not exists clan_tag text;
do $$ begin
  alter table public.servers
    add constraint servers_clan_tag_format
    check (clan_tag is null or clan_tag ~ '^[A-Za-z0-9]{2,5}$');
exception when duplicate_object then null; end $$;

-- Username: case-insensitively unique across all profiles. (The plain
-- `username text unique` on the table stays; this adds the case-folded rule.)
create unique index if not exists profiles_username_lower_uniq
  on public.profiles (lower(username));

-- Clan name: unique among CLANS only — non-clan servers/boards ('open',
-- 'official') keep their existing names and aren't part of the identity pool.
create unique index if not exists servers_clan_name_lower_uniq
  on public.servers (lower(name))
  where kind = 'clan';

-- Clan tag: unique across every server that has one (partial index, so the many
-- rows with a null tag don't collide with each other).
create unique index if not exists servers_clan_tag_lower_uniq
  on public.servers (lower(clan_tag))
  where clan_tag is not null;

-- HOST FLAG PATH: the global TKO host capability is NOT a column — it lives on
-- users.user_metadata as `{"tko_host": true}`, set by redeeming one of the 3
-- founder HOST codes (see the redeem-code function in server/app.ts and
-- src/lib/tkoKing.ts TKO_HOST_CODES). A host passes every tournament
-- host/admin permission check everywhere. Host codes grant NO tier, just the
-- run-anything capability, so they are handled by the redeem function directly
-- rather than seeded into redeem_codes (whose tier CHECK excludes 'host').

-- ---------------------------------------------------------------------------
-- THE PRESTIGE ECONOMY  (was: four localStorage scaffolds)
--
-- Wallets, the artifact catalogue + ownership, and Oracle predictions used to
-- live in localStorage, which meant a TKO King's crown existed only in their own
-- browser. These are the real tables behind them. All additive and idempotent.
--
-- THE ONE RULE THAT SHAPES ALL OF THIS: **value is minted server-side only.**
--   * `wallets.tokens` / `wallets.sweeps` are NEVER client-writable (the balance
--     columns are in PRIVILEGE_COLS, and the table's policy is insert/write
--     'deny'). Every balance change goes through a trusted /api/fn/* handler
--     which also books the matching `wallet_ledger` row.
--   * `asset_ownership` is insert-'deny' too: you get an artifact by BUYING it
--     (server debits tokens), by EARNING it (server grades your prediction) or
--     by WINNING it (server verifies the host declared you the battle winner).
--     There is no generic insert a client could forge.
--   * `predictions.status` is set only by the server against a recorded
--     tournament_results row, so two users can no longer grade the same
--     tournament differently.
--
-- NO CASH. Tokens are a bought utility currency, never cashable. Sweeps are free
-- promotional points. Prize artifacts are prestige. Nothing here pays out money.
-- ---------------------------------------------------------------------------

-- The SHARED artifact catalogue (jerseys, banners, emotes, badge skins) plus the
-- earned-only reward + King prize artifacts. Publicly readable — a cosmetic a
-- team lists must be visible to everyone, which the per-browser `kc_assets` key
-- never was. `id` is TEXT (not uuid) because reward/prize artifacts have stable,
-- deterministic ids ('oracle-reward-crystal-emote', 'king-crown') that the pure
-- client logic derives; user-listed gear gets an 'a_<ts>_<rand>' id.
create table if not exists public.assets (
  id text primary key,
  name text not null,
  team_name text not null default '',
  image_url text not null default '',
  price_tokens integer not null default 0 check (price_tokens >= 0),
  kind text not null default 'jersey' check (kind in ('jersey','banner','emote','badge_skin')),
  -- null = a platform artifact (seed gear, Oracle reward, King prize). Only a
  -- real creator id can edit a row; platform rows are server-only by having none.
  created_by uuid references public.profiles(id) on delete set null,
  -- 'user' listed it for sale | 'seed' demo gear | 'reward' Oracle | 'prize' King
  origin text not null default 'user' check (origin in ('user','seed','reward','prize')),
  -- Which storefront owns the listing. Clan listings must point at a real clan
  -- and are accepted by the API only from that clan's leader/officer.
  seller_type text not null default 'creator' check (seller_type in ('official','creator','clan')),
  clan_id uuid references public.servers(id) on delete set null,
  -- Creator/clan listings can be sold for real money. The amount is one of the
  -- server-approved price packages; the old Token price remains for official
  -- and legacy utility-currency listings.
  price_cents integer check (price_cents is null or price_cents >= 0),
  cash_enabled boolean not null default false,
  paid_sweeps_enabled boolean not null default false,
  created_at timestamptz default now()
);
alter table public.assets add column if not exists seller_type text not null default 'creator';
alter table public.assets add column if not exists clan_id uuid references public.servers(id) on delete set null;
alter table public.assets add column if not exists price_cents integer;
alter table public.assets add column if not exists cash_enabled boolean not null default false;
alter table public.assets add column if not exists paid_sweeps_enabled boolean not null default false;
update public.assets
set seller_type = case
  when origin in ('seed','reward','prize') or created_by is null then 'official'
  else coalesce(nullif(seller_type,''), 'creator')
end;
create index if not exists idx_assets_created_by on public.assets(created_by);
create index if not exists idx_assets_origin on public.assets(origin, created_at desc);
create index if not exists idx_assets_seller on public.assets(seller_type, clan_id, created_at desc);

-- Who owns what. `source` records HOW, which is the audit trail that makes a
-- crown defensible: 'prize' rows carry the battle they were won in.
create table if not exists public.asset_ownership (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  asset_id text not null references public.assets(id) on delete cascade,
  source text not null default 'purchase' check (source in ('purchase','reward','prize','grant')),
  -- what earned it: a tournament_battles.id for a prize, a tournaments.id for a
  -- prediction reward. Free text so a deleted battle doesn't delete the trophy.
  ref_id text,
  acquired_at timestamptz default now(),
  unique(user_id, asset_id)
);
create index if not exists idx_asset_ownership_user on public.asset_ownership(user_id, acquired_at desc);
create index if not exists idx_asset_ownership_asset on public.asset_ownership(asset_id);

-- One wallet row per user. Balances are server-only (see PRIVILEGE_COLS).
create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  tokens integer not null default 0 check (tokens >= 0),
  sweeps integer not null default 0 check (sweeps >= 0),
  -- Dollar-backed marketplace credits, stored as integer USD cents. These are
  -- bought through a paid Stripe checkout and are NEVER mixed with the free
  -- promotional Give Points in `sweeps`.
  paid_sweeps_cents integer not null default 0 check (paid_sweeps_cents >= 0),
  -- UTC date of the user's last claimed daily Sweeps grant. The claim is a
  -- single guarded UPDATE (see /api/fn/sweeps-daily) so a concurrent double-tap
  -- cannot bank the bonus twice — Postgres row-locks the wallet during the
  -- update and the second claim re-checks this date against today.
  daily_sweeps_claimed_on date,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
-- Additive for existing databases (the create-table above only runs on a fresh DB).
alter table public.wallets add column if not exists daily_sweeps_claimed_on date;
alter table public.wallets add column if not exists paid_sweeps_cents integer not null default 0;
-- ORACLE-USE-ONLY tickets. The repurposed daily free grant credits these (default
-- 3/day). Bettable in the Oracle economy, but they contribute $0 to any streamer
-- payout — they are NEVER part of the money ($) flow.
alter table public.wallets add column if not exists oracle_tickets integer not null default 0 check (oracle_tickets >= 0);

-- Every balance movement AND every settled prize/prediction, in one append-only
-- table. The token/sweeps columns cover src/lib/wallet.ts; the event/result/
-- prize/status columns cover the "Winnings & Prizes" card (src/lib/ledger.ts).
create table if not exists public.wallet_ledger (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'adjustment'
    check (kind in ('purchase','grant','spend','prediction','tournament','clan_dues','adjustment')),
  tokens_delta integer not null default 0,
  sweeps_delta integer not null default 0,
  paid_sweeps_delta_cents integer not null default 0,
  -- human label for the Winnings ledger, e.g. 'Weekly Shinobi Cup'
  event text,
  result text check (result is null or result in ('Win','Loss')),
  prize text,
  status text not null default 'Paid' check (status in ('Pending','Paid')),
  reason text,
  ref_id text,
  created_at timestamptz default now()
);
alter table public.wallet_ledger add column if not exists paid_sweeps_delta_cents integer not null default 0;
alter table public.wallet_ledger drop constraint if exists wallet_ledger_kind_check;
alter table public.wallet_ledger add constraint wallet_ledger_kind_check
  check (kind in ('purchase','grant','spend','prediction','tournament','clan_dues','marketplace','adjustment','wager'));
create index if not exists idx_wallet_ledger_user on public.wallet_ledger(user_id, created_at desc);

-- Oracle predictions. Graded SERVER-SIDE against tournament_results, so the
-- result is the same for every user (the localStorage version graded per-browser).
create table if not exists public.predictions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  -- the picked winner: a profiles.id when picking a known entrant, else the
  -- typed free-text name (which simply never auto-matches).
  winner_id text not null,
  pick_label text not null default '',
  status text not null default 'open' check (status in ('open','correct','wrong')),
  -- the cosmetic a correct prediction earned (assets.id), null otherwise
  reward_asset_id text references public.assets(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_predictions_user on public.predictions(user_id, created_at desc);
create index if not exists idx_predictions_tournament on public.predictions(tournament_id, status);
-- At most ONE open prediction per user per tournament (the 'exists' refusal in
-- src/lib/predictions.ts, now enforced by the database rather than by a filter).
create unique index if not exists predictions_one_open_per_tournament
  on public.predictions (user_id, tournament_id) where status = 'open';

-- ---- platform artifacts -----------------------------------------------------
-- Seed gear so the Shop is never empty, the four Oracle reward cosmetics, and
-- the King prize artifacts. Idempotent: re-running the schema updates the copy
-- but never duplicates a row or disturbs anyone's ownership.
insert into public.assets (id, name, team_name, image_url, price_tokens, kind, origin) values
  ('seed-akatsuki-jersey',      'Akatsuki Home Jersey',       'Akatsuki',      'https://placehold.co/400x400/1a1a2e/e94560?text=Akatsuki',    250, 'jersey',     'seed'),
  ('seed-leaf-village-jersey',  'Hidden Leaf Away Jersey',    'Hidden Leaf',   'https://placehold.co/400x400/0f3460/16db93?text=Hidden+Leaf', 200, 'jersey',     'seed'),
  ('seed-sand-jersey',          'Sand Siblings Pro Kit',      'Sand Siblings', 'https://placehold.co/400x400/2d1b0e/f9c74f?text=Sand',        300, 'jersey',     'seed'),
  ('oracle-reward-crystal-emote','Crystal Ball Emote',        'Oracle',        'https://placehold.co/400x400/2a1a3e/c084fc?text=Oracle+Emote',  0, 'emote',      'reward'),
  ('oracle-reward-violet-skin', 'Violet Oracle Badge Skin',   'Oracle',        'https://placehold.co/400x400/1e1b4b/a78bfa?text=Oracle+Skin',   0, 'badge_skin', 'reward'),
  ('oracle-reward-starfall-emote','Starfall Emote',           'Oracle',        'https://placehold.co/400x400/3b2f0b/fde68a?text=Starfall',      0, 'emote',      'reward'),
  ('oracle-reward-astral-skin', 'Astral Oracle Badge Skin',   'Oracle',        'https://placehold.co/400x400/0b1e3b/93c5fd?text=Astral',        0, 'badge_skin', 'reward'),
  -- King prize artifacts (src/lib/tkoKing.ts). The per-round tokens
  -- ('king-prize-round-N') depend on the bracket size, so the server upserts
  -- those on grant; the three headline artifacts are seeded so the prize table
  -- on the King board renders before anyone has won anything.
  ('king-prize-crown',          'TKO King Crown',            'TKO King',      'https://placehold.co/400x400/1a1400/f9c74f?text=KING',          0, 'badge_skin', 'prize'),
  ('king-prize-finalist',       'Finalist Banner',           'TKO King',      'https://placehold.co/400x400/1a1a2e/e94560?text=FINALIST',      0, 'banner',     'prize'),
  ('king-prize-semifinalist',   'Semifinalist Sigil',        'TKO King',      'https://placehold.co/400x400/0f3460/16db93?text=SEMI',          0, 'badge_skin', 'prize')
on conflict (id) do update set
  name = excluded.name, team_name = excluded.team_name, image_url = excluded.image_url,
  price_tokens = excluded.price_tokens, kind = excluded.kind, origin = excluded.origin;

-- ---------------------------------------------------------------------------
-- BILLING  (Stripe)
--
-- Three concerns, three tables, all additive and idempotent:
--
--   users.stripe_customer_id  one Stripe Customer per user, so a returning buyer
--                             keeps one payment-method book and one subscription
--                             history instead of a new Customer per checkout.
--   stripe_events             the IDEMPOTENCY LEDGER. Stripe guarantees AT LEAST
--                             ONCE delivery and retries any non-2xx for up to 3
--                             days, so "credit 550 Tokens" WILL be delivered
--                             twice sooner or later. The event id is the primary
--                             key: the webhook claims it before doing any work
--                             and a replay hits the PK and no-ops.
--   payments                  the audit trail. One row per fulfilled purchase,
--                             recording what Stripe charged and what the server
--                             actually delivered, so a dispute can be answered
--                             from our own database rather than the dashboard.
--
-- NOTE ON TRUST: `payments.tokens_credited` records what was delivered, but it
-- is DERIVED from the server's own pack catalogue (SERVER_TOKEN_PACKS in
-- server/app.ts), never from the Checkout Session metadata. Metadata carries the
-- pack ID only; the amount is always re-derived server-side.
-- ---------------------------------------------------------------------------

alter table public.users add column if not exists stripe_customer_id text;
create unique index if not exists users_stripe_customer_uniq
  on public.users (stripe_customer_id) where stripe_customer_id is not null;

-- Processed Stripe event ids. A row here means "already fulfilled — do nothing".
-- Rows are inserted BEFORE fulfilment and deleted if fulfilment throws, so a
-- failed delivery is retried by Stripe and succeeds, while a successful one can
-- never be applied twice.
create table if not exists public.stripe_events (
  id text primary key,                 -- evt_...
  type text not null default '',
  received_at timestamptz default now()
);
create index if not exists idx_stripe_events_received on public.stripe_events(received_at desc);

-- Every fulfilled purchase. `kind` distinguishes the two money paths.
create table if not exists public.payments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete set null,
  -- The Stripe objects this receipt came from (all nullable — a subscription
  -- renewal has an invoice but no checkout session, and vice versa).
  stripe_event_id text,
  stripe_session_id text,
  stripe_invoice_id text,
  stripe_subscription_id text,
  stripe_customer_id text,
  kind text not null default 'subscription'
    check (kind in ('subscription','token_pack')),
  -- what was bought
  tier text,
  pack text,
  amount_cents integer not null default 0,
  currency text not null default 'usd',
  -- what the SERVER delivered (0 when the session was not paid)
  tokens_credited integer not null default 0,
  sweeps_credited integer not null default 0,
  -- 'paid' fulfilled | 'unpaid' session completed without payment (nothing
  -- delivered) | 'failed' a charge/invoice failed | 'refunded' reserved
  status text not null default 'paid'
    check (status in ('paid','unpaid','failed','refunded')),
  created_at timestamptz default now()
);
create index if not exists idx_payments_user on public.payments(user_id, created_at desc);
create index if not exists idx_payments_session on public.payments(stripe_session_id);

-- Stripe Connect Express accounts for creator payouts (80/20 split). Referenced
-- by TABLE_POLICY and /api/connect/* in server/app.ts; the `on conflict
-- (user_id)` upsert there requires user_id to be the primary key.
create table if not exists public.creator_stripe_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stripe_account_id text not null,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  transfers_enabled boolean not null default false,
  tax_certified_at timestamptz,
  tax_form_type text,
  electronic_1099_consent_at timestamptz,
  tax_consent_version text,
  onboarded_at timestamptz,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table public.creator_stripe_accounts add column if not exists created_at timestamptz default now();  -- backfill
alter table public.creator_stripe_accounts add column if not exists transfers_enabled boolean not null default false;
alter table public.creator_stripe_accounts add column if not exists tax_certified_at timestamptz;
alter table public.creator_stripe_accounts add column if not exists tax_form_type text;
alter table public.creator_stripe_accounts add column if not exists electronic_1099_consent_at timestamptz;
alter table public.creator_stripe_accounts add column if not exists tax_consent_version text;
alter table public.creator_stripe_accounts add column if not exists platform_fee_debit_consent_at timestamptz;
alter table public.creator_stripe_accounts add column if not exists platform_fee_debit_consent_version text;

-- Creator/clan subscriptions and premium supporter benefits that are not a
-- one-off artifact. Money-bearing writes use dedicated /api/creator/* routes;
-- this table is a catalogue, never a balance.
create table if not exists public.creator_offers (
  id uuid primary key default uuid_generate_v4(),
  seller_user_id uuid not null references public.profiles(id) on delete cascade,
  seller_type text not null default 'creator' check (seller_type in ('creator','clan')),
  clan_id uuid references public.servers(id) on delete cascade,
  offer_type text not null check (offer_type in ('creator_subscription','clan_subscription','premium_highlight')),
  name text not null,
  description text not null default '',
  image_url text,
  price_cents integer not null check (price_cents > 0),
  billing_interval text not null default 'month' check (billing_interval in ('one_time','month')),
  cash_enabled boolean not null default true,
  paid_sweeps_enabled boolean not null default true,
  giftable boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_creator_offers_seller on public.creator_offers(seller_user_id, active, created_at desc);
create index if not exists idx_creator_offers_clan on public.creator_offers(clan_id, active, created_at desc);

-- One server-priced order for every cash or paid-Sweeps purchase. Amounts are
-- copied here only after the server derives them from the catalogue row.
create table if not exists public.creator_orders (
  id uuid primary key default uuid_generate_v4(),
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  recipient_id uuid references public.profiles(id) on delete set null,
  seller_user_id uuid not null references public.profiles(id) on delete restrict,
  seller_type text not null check (seller_type in ('creator','clan')),
  clan_id uuid references public.servers(id) on delete set null,
  asset_id text references public.assets(id) on delete set null,
  offer_id uuid references public.creator_offers(id) on delete set null,
  payment_method text not null check (payment_method in ('cash','paid_sweeps')),
  list_price_cents integer not null,
  buyer_charge_cents integer not null,
  discount_cents integer not null default 0,
  seller_tier text not null check (seller_tier in ('pro','supporter','creator')),
  seller_share_percent integer not null check (seller_share_percent between 0 and 100),
  seller_share_cents integer not null,
  platform_share_cents integer not null,
  currency text not null default 'usd',
  status text not null default 'pending'
    check (status in ('pending','paid','payout_pending','transferred','canceled','failed','refunded','reversed')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_subscription_id text,
  stripe_transfer_id text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((asset_id is not null)::int + (offer_id is not null)::int = 1)
);
create unique index if not exists uq_creator_orders_idempotency on public.creator_orders(idempotency_key);
create unique index if not exists uq_creator_orders_checkout
  on public.creator_orders(stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create index if not exists idx_creator_orders_buyer on public.creator_orders(buyer_id, created_at desc);
create index if not exists idx_creator_orders_seller on public.creator_orders(seller_user_id, created_at desc);

create table if not exists public.creator_earnings (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null unique references public.creator_orders(id) on delete cascade,
  seller_user_id uuid not null references public.profiles(id) on delete restrict,
  amount_cents integer not null,
  status text not null default 'pending'
    check (status in ('pending','available','transferred','reversed')),
  stripe_transfer_id text,
  created_at timestamptz not null default now(),
  available_at timestamptz,
  transferred_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists idx_creator_earnings_seller on public.creator_earnings(seller_user_id, created_at desc);

-- Elite and Legend members receive one no-charge basic creator/channel access
-- pass in each UTC calendar month. A pass is locked to one offer for the month
-- so it cannot be rapidly moved between creators.
create table if not exists public.creator_included_passes (
  id uuid primary key default uuid_generate_v4(),
  member_user_id uuid not null references public.profiles(id) on delete cascade,
  offer_id uuid not null references public.creator_offers(id) on delete cascade,
  seller_user_id uuid not null references public.profiles(id) on delete cascade,
  membership_tier text not null check (membership_tier in ('supporter','creator')),
  cycle_key text not null,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_user_id, cycle_key)
);
create index if not exists idx_creator_included_passes_seller
  on public.creator_included_passes(seller_user_id, cycle_key, status);

-- Actual, documented external seller costs. The seller reimburses 100% of
-- Stripe processing, payout, active-account, and tax-form filing costs. These
-- rows never represent seller income tax, customer sales tax, or TKO corporate
-- tax. Account debits require separate, versioned seller authorization.
create table if not exists public.creator_platform_fees (
  id uuid primary key default uuid_generate_v4(),
  seller_user_id uuid not null references public.profiles(id) on delete cascade,
  fee_type text not null
    check (fee_type in ('active_account','payment_processing','payout_processing','tax_reporting')),
  period_key text not null,
  source_ref text,
  total_fee_cents integer not null check (total_fee_cents >= 0),
  seller_fee_cents integer not null check (seller_fee_cents >= 0),
  platform_fee_cents integer not null check (platform_fee_cents >= 0),
  included_pass_id uuid references public.creator_included_passes(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','sponsored','collected','failed')),
  stripe_payment_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_user_id, fee_type, period_key)
);
create index if not exists idx_creator_platform_fees_seller
  on public.creator_platform_fees(seller_user_id, status, period_key desc);
alter table public.creator_platform_fees
  drop constraint if exists creator_platform_fees_fee_type_check;
alter table public.creator_platform_fees
  add constraint creator_platform_fees_fee_type_check
  check (fee_type in ('active_account','payment_processing','payout_processing','tax_reporting'));

create table if not exists public.creator_entitlements (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid references public.creator_orders(id) on delete cascade,
  included_pass_id uuid references public.creator_included_passes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  offer_id uuid not null references public.creator_offers(id) on delete cascade,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  stripe_subscription_id text,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, user_id),
  unique (included_pass_id, user_id),
  check ((order_id is not null)::int + (included_pass_id is not null)::int = 1)
);
alter table public.creator_entitlements alter column order_id drop not null;
alter table public.creator_entitlements add column if not exists included_pass_id uuid references public.creator_included_passes(id) on delete cascade;
create unique index if not exists uq_creator_entitlements_included_pass
  on public.creator_entitlements(included_pass_id, user_id) where included_pass_id is not null;
create index if not exists idx_creator_entitlements_user on public.creator_entitlements(user_id, status, expires_at);
create index if not exists idx_creator_entitlements_subscription
  on public.creator_entitlements(stripe_subscription_id) where stripe_subscription_id is not null;

-- Paid Sweeps Credit funding is independently auditable and only a verified
-- Stripe webhook can turn a pending row into wallet balance.
create table if not exists public.paid_sweeps_purchases (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  amount_cents integer not null,
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_paid_sweeps_checkout
  on public.paid_sweeps_purchases(stripe_checkout_session_id) where stripe_checkout_session_id is not null;
create index if not exists idx_paid_sweeps_user on public.paid_sweeps_purchases(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- CONQUEST ARTIFACT POWERS
--
-- A browser submits only a source-controlled recipe code. All fields below are
-- written by trusted /api/fn/conquest-artifact-* handlers and are blocked from
-- the generic data API. Normal membership recipes are capped by tier, active
-- slots, monthly forge count, and monthly effect totals. Only source-controlled
-- official TKO tournament recipes may exceed those caps.
-- ---------------------------------------------------------------------------

create table if not exists public.artifacts (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  slug text not null,
  name text not null,
  rarity text not null default 'common',
  capability text not null default 'none',
  code text unique,
  image_url text,
  price_cents integer,
  redeemed_by uuid references public.profiles(id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists artifacts_owner_idx on public.artifacts(owner_id);

create table if not exists public.territories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  col integer not null,
  row integer not null,
  owner_clan_id uuid references public.servers(id) on delete set null,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  unique(col, row)
);
create index if not exists territories_owner_idx on public.territories(owner_clan_id);

create table if not exists public.clan_battles (
  id uuid primary key default uuid_generate_v4(),
  winner_clan_id uuid references public.servers(id) on delete set null,
  loser_clan_id uuid references public.servers(id) on delete set null,
  match_key text,
  territory_id uuid references public.territories(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.artifacts add column if not exists recipe_code text;
alter table public.artifacts add column if not exists forge_tier text;
-- Provenance. Only 'forge' (paid-to-create) and 'purchase' are BETTABLE in the
-- Oracle economy; 'free'/'seed'/'reward'/'prize' are never stakeable (Rule 3).
alter table public.artifacts add column if not exists origin text not null default 'forge';
alter table public.artifacts add column if not exists power_payload jsonb not null default '[]'::jsonb;
alter table public.artifacts add column if not exists power_score integer not null default 0;
alter table public.artifacts add column if not exists slot_cost integer not null default 0;
alter table public.artifacts add column if not exists official_override boolean not null default false;
alter table public.artifacts add column if not exists clan_id uuid references public.servers(id) on delete set null;
alter table public.artifacts add column if not exists used_at timestamptz;
create index if not exists artifacts_recipe_idx
  on public.artifacts(owner_id, recipe_code, created_at);

-- ===========================================================================
-- ORACLE BETTING ECONOMY — live-only, host-tier-only, money-safe.
--
-- A bet stakes exactly ONE of: oracle tickets (no $), PAID sweeps (stake_cents =
-- real-cent value — the ONLY thing that drives the streamer share), or a
-- FORGED/PURCHASED artifact (no $). One bet per game. Winners split the pot,
-- conserved; the streamer earns a HARD-CAPPED 25% of the real sweeps-cents bet,
-- paid from the platform's cut (see server/app.ts oracle-bet-resolve).
-- ===========================================================================
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

-- Per-stream minimum bet the streamer sets in their live setup / control room.
create table if not exists public.oracle_stream_config (
  stream_id uuid primary key,
  min_bet integer not null default 1 check (min_bet >= 0),
  min_stake_kind text not null default 'ticket',
  updated_at timestamptz default now()
);

-- Per-stream running tally that ENFORCES the profit cap: cumulative streamer
-- payout can never exceed 25% of the real sweeps-cents ever bet on the stream.
create table if not exists public.oracle_stream_tally (
  stream_id uuid primary key,
  sweeps_cents_in integer not null default 0 check (sweeps_cents_in >= 0),
  streamer_cents_paid integer not null default 0 check (streamer_cents_paid >= 0),
  updated_at timestamptz default now()
);

-- One settlement row per resolved match — the idempotent claim for resolve.
create table if not exists public.oracle_bet_settlements (
  match_ref text primary key,
  stream_id uuid,
  winning_choice text,
  sweeps_cents_in integer not null default 0,
  streamer_cents_paid integer not null default 0,
  resolved_at timestamptz not null default now()
);

alter table public.territories add column if not exists protected_until timestamptz;
alter table public.territories add column if not exists protected_by_artifact_id uuid;

create table if not exists public.conquest_artifact_activations (
  id uuid primary key default uuid_generate_v4(),
  artifact_id uuid not null references public.artifacts(id) on delete restrict unique,
  user_id uuid not null references public.profiles(id) on delete restrict,
  clan_id uuid not null references public.servers(id) on delete cascade,
  recipe_code text not null,
  effects jsonb not null default '[]'::jsonb,
  slot_cost integer not null default 0 check (slot_cost >= 0),
  official_override boolean not null default false,
  target_territory_id uuid references public.territories(id) on delete set null,
  status text not null default 'active'
    check (status in ('active','consumed','expired')),
  activated_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists conquest_activations_clan_idx
  on public.conquest_artifact_activations(clan_id, status, activated_at);

create table if not exists public.clan_conquest_state (
  clan_id uuid primary key references public.servers(id) on delete cascade,
  rivalry_reset_at timestamptz,
  reset_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.clan_basic_pass_pools (
  id uuid primary key default uuid_generate_v4(),
  clan_id uuid not null references public.servers(id) on delete cascade,
  source_artifact_id uuid not null references public.artifacts(id) on delete restrict unique,
  total_count integer not null check (total_count > 0),
  remaining_count integer not null check (remaining_count >= 0),
  duration_days integer not null default 30 check (duration_days between 1 and 365),
  created_at timestamptz not null default now()
);
create index if not exists clan_pass_pools_clan_idx
  on public.clan_basic_pass_pools(clan_id, remaining_count, created_at);

create table if not exists public.clan_basic_pass_entitlements (
  id uuid primary key default uuid_generate_v4(),
  source_pool_id uuid not null references public.clan_basic_pass_pools(id) on delete restrict,
  clan_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(source_pool_id, user_id)
);
create index if not exists clan_pass_entitlements_user_idx
  on public.clan_basic_pass_entitlements(user_id, clan_id, expires_at);

-- ---- STRIPE-FIRST PHYSICAL MERCHANDISE ----------------------------------
-- TKO owns the catalogue, orders and earnings. Shopify is an unpublished
-- operations mirror; print-provider orders stay drafts until separately
-- released. The same DDL is also used by production boot and pg-mem tests.
create table if not exists public.physical_merch_products (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.artifacts(id) on delete restrict,
  seller_user_id uuid not null references public.profiles(id) on delete restrict,
  seller_type text not null default 'creator',
  clan_id uuid,
  title text not null,
  description text not null default '',
  product_type text not null default 'tshirt',
  artwork_url text not null,
  ai_brief jsonb not null default '{}',
  print_specs jsonb not null default '{}',
  status text not null default 'pending_review',
  shopify_shop_domain text,
  shopify_product_gid text unique,
  fulfillment_provider text not null default 'printful',
  provider_template_id text,
  sale_price_cents integer not null,
  manufacturing_cents integer not null default 1200,
  shipping_cents integer not null default 499,
  payment_fee_cents integer not null default 150,
  refund_reserve_cents integer not null default 200,
  creator_share_percent integer not null default 50,
  last_error text,
  ip_attested_at timestamptz not null,
  approved_by uuid,
  approved_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artifact_id, product_type)
);
create index if not exists physical_merch_products_seller_idx
  on public.physical_merch_products(seller_user_id, status, created_at desc);

create table if not exists public.physical_merch_variants (
  id uuid primary key default gen_random_uuid(),
  physical_product_id uuid not null references public.physical_merch_products(id) on delete cascade,
  size text not null,
  color text not null default 'Black',
  sku text not null unique,
  shopify_variant_gid text unique,
  provider_variant_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (physical_product_id, size, color)
);

create table if not exists public.physical_merch_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'checkout_pending',
  currency text not null default 'usd',
  item_subtotal_cents integer not null,
  shipping_charge_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null,
  refunded_cents integer not null default 0,
  shipping_name text,
  shipping_email text,
  shipping_address jsonb not null default '{}',
  stripe_customer_id text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  shopify_order_gid text unique,
  shopify_order_name text,
  provider text not null default 'printful',
  provider_order_id text unique,
  provider_status text,
  provider_cost_cents integer,
  provider_confirmed_at timestamptz,
  tracking_company text,
  tracking_number text,
  tracking_url text,
  idempotency_key text not null unique,
  dry_run boolean not null default false,
  hold_reason text,
  last_error text,
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists physical_merch_orders_buyer_idx
  on public.physical_merch_orders(buyer_id, created_at desc);
create index if not exists physical_merch_orders_status_idx
  on public.physical_merch_orders(status, updated_at);

create table if not exists public.physical_merch_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.physical_merch_orders(id) on delete cascade,
  physical_product_id uuid not null references public.physical_merch_products(id) on delete restrict,
  variant_id uuid not null references public.physical_merch_variants(id) on delete restrict,
  seller_user_id uuid not null references public.profiles(id) on delete restrict,
  quantity integer not null default 1,
  unit_price_cents integer not null,
  manufacturing_cents integer not null default 0,
  provider_shipping_cents integer not null default 0,
  payment_fee_cents integer not null default 0,
  refund_reserve_cents integer not null default 0,
  creator_share_percent integer not null,
  creator_share_cents integer not null default 0,
  platform_share_cents integer not null default 0,
  shopify_line_item_gid text unique,
  created_at timestamptz not null default now(),
  unique (order_id, variant_id)
);

create table if not exists public.physical_merch_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  topic text not null,
  provider_event_id text not null,
  order_id uuid references public.physical_merch_orders(id) on delete set null,
  payload jsonb not null default '{}',
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  processed_at timestamptz,
  error text,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);
create index if not exists physical_merch_events_pending_idx
  on public.physical_merch_events(status, next_attempt_at, received_at);

create table if not exists public.physical_merch_earnings (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null unique references public.physical_merch_order_items(id) on delete restrict,
  seller_user_id uuid not null references public.profiles(id) on delete restrict,
  amount_cents integer not null,
  status text not null default 'held',
  available_at timestamptz,
  stripe_transfer_id text unique,
  transferred_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists physical_merch_earnings_seller_idx
  on public.physical_merch_earnings(seller_user_id, status, available_at);
