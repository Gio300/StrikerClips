-- Phase 1: Profiles extension - power_level for screenshot rankings
alter table public.profiles add column if not exists power_level integer default 0;
alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists dashboard_override jsonb;

-- Match results and power ratings (screenshot-based rankings)
create table if not exists public.match_results (
  id uuid default uuid_generate_v4() primary key,
  uploader_id uuid references public.profiles(id) on delete cascade not null,
  screenshot_url text,
  match_type text not null check (match_type in ('survival', 'quick_match', 'red_white', 'ninja_world_league', 'tournament')),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

create table if not exists public.match_result_players (
  id uuid default uuid_generate_v4() primary key,
  result_id uuid references public.match_results(id) on delete cascade not null,
  profile_id uuid references public.profiles(id) on delete cascade not null,
  role text not null check (role in ('winner', 'loser', 'participant')),
  score integer,
  team text check (team in ('red', 'white')),
  unique(result_id, profile_id)
);

create table if not exists public.power_ratings (
  profile_id uuid references public.profiles(id) on delete cascade not null,
  match_type text not null,
  rating integer not null default 1000,
  wins integer not null default 0,
  losses integer not null default 0,
  updated_at timestamptz default now(),
  primary key (profile_id, match_type)
);

create table if not exists public.trophies (
  id uuid default uuid_generate_v4() primary key,
  profile_id uuid references public.profiles(id) on delete cascade not null,
  trophy_type text not null,
  earned_at timestamptz default now(),
  metadata jsonb default '{}'
);

-- Stat Check (buff verification)
create table if not exists public.stat_check_submissions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  video_url text not null,
  character_name text,
  description text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- Ensure user_id exists BEFORE indices/policies (fixes 42703 if table was created elsewhere without it)
alter table public.stat_check_submissions add column if not exists user_id uuid references public.profiles(id) on delete cascade;

create index if not exists idx_match_results_uploader on public.match_results(uploader_id);
create index if not exists idx_match_results_status on public.match_results(status);
create index if not exists idx_power_ratings_profile on public.power_ratings(profile_id);
create index if not exists idx_trophies_profile on public.trophies(profile_id);
create index if not exists idx_stat_check_user on public.stat_check_submissions(user_id);
create index if not exists idx_stat_check_status on public.stat_check_submissions(status);

alter table public.match_results enable row level security;
alter table public.match_result_players enable row level security;
alter table public.power_ratings enable row level security;
alter table public.trophies enable row level security;
alter table public.stat_check_submissions enable row level security;

create policy "Match results viewable" on public.match_results for select using (true);
create policy "Users insert match results" on public.match_results for insert with check (auth.uid() = uploader_id);
create policy "Match result players viewable" on public.match_result_players for select using (true);
create policy "Power ratings viewable" on public.power_ratings for select using (true);
create policy "Trophies viewable" on public.trophies for select using (true);
create policy "Stat check viewable" on public.stat_check_submissions for select using (true);
create policy "Users insert stat check" on public.stat_check_submissions for insert with check (auth.uid() = user_id);
