-- Live streams
create table if not exists public.live_streams (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  youtube_url text not null,
  title text,
  is_live boolean default true,
  created_at timestamptz default now()
);

-- Live groups for multi-view
create table if not exists public.live_groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists public.live_group_members (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid references public.live_groups(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  stream_id uuid references public.live_streams(id) on delete set null,
  accepted boolean default false,
  unique(group_id, user_id)
);

-- User YouTube links for saved sources
create table if not exists public.user_youtube_links (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  url text not null,
  title text,
  created_at timestamptz default now()
);

-- RLS
alter table public.live_streams enable row level security;
alter table public.live_groups enable row level security;
alter table public.live_group_members enable row level security;
alter table public.user_youtube_links enable row level security;

create policy "Live streams viewable" on public.live_streams for select using (true);
create policy "Users insert live streams" on public.live_streams for insert with check (auth.uid() = user_id);

create policy "Live groups viewable" on public.live_groups for select using (true);
create policy "Users create live groups" on public.live_groups for insert with check (auth.uid() is not null);

create policy "Live group members viewable" on public.live_group_members for select using (true);
create policy "Users insert live group members" on public.live_group_members for insert with check (auth.uid() = user_id);
create policy "Users update own live group members" on public.live_group_members for update using (auth.uid() = user_id);
create policy "Users delete own live group members" on public.live_group_members for delete using (auth.uid() = user_id);

create policy "User youtube links viewable by owner" on public.user_youtube_links for select using (auth.uid() = user_id);
create policy "Users insert youtube links" on public.user_youtube_links for insert with check (auth.uid() = user_id);
create policy "Users delete own youtube links" on public.user_youtube_links for delete using (auth.uid() = user_id);
