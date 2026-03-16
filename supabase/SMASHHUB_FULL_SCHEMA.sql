-- ============================================
-- SmashHub / StrikerClips - Complete Schema
-- Copy this entire file into Supabase SQL Editor and Run
-- ============================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  avatar_url text,
  bio text,
  social_links jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Clips
create table if not exists public.clips (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  source_type text check (source_type in ('youtube', 'upload')) not null,
  url_or_path text not null,
  start_sec integer,
  end_sec integer,
  thumbnail text,
  title text,
  created_at timestamptz default now()
);

-- Reels
create table if not exists public.reels (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  clip_ids uuid[] default '{}',
  combined_video_url text,
  thumbnail text,
  created_at timestamptz default now()
);

-- Matches
create table if not exists public.matches (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text,
  reel_ids uuid[] default '{}',
  created_at timestamptz default now()
);

-- Servers (Discord-style communities)
create table if not exists public.servers (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  icon_url text,
  created_at timestamptz default now()
);

-- Server members
create table if not exists public.server_members (
  id uuid default uuid_generate_v4() primary key,
  server_id uuid references public.servers(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role text default 'member',
  created_at timestamptz default now(),
  unique(server_id, user_id)
);

-- Channels
create table if not exists public.channels (
  id uuid default uuid_generate_v4() primary key,
  server_id uuid references public.servers(id) on delete cascade not null,
  name text not null,
  type text check (type in ('text', 'clips')) default 'text',
  created_at timestamptz default now()
);

-- Messages
create table if not exists public.messages (
  id uuid default uuid_generate_v4() primary key,
  channel_id uuid references public.channels(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  content text not null default '',
  clip_id uuid references public.clips(id) on delete set null,
  created_at timestamptz default now()
);

-- Reactions
create table if not exists public.reactions (
  id uuid default uuid_generate_v4() primary key,
  message_id uuid references public.messages(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  emoji text not null,
  created_at timestamptz default now(),
  unique(message_id, user_id, emoji)
);

-- Follows (social)
create table if not exists public.follows (
  id uuid default uuid_generate_v4() primary key,
  follower_id uuid references public.profiles(id) on delete cascade not null,
  following_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(follower_id, following_id),
  check (follower_id != following_id)
);

-- Likes (reels)
create table if not exists public.reel_likes (
  id uuid default uuid_generate_v4() primary key,
  reel_id uuid references public.reels(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(reel_id, user_id)
);

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.clips enable row level security;
alter table public.reels enable row level security;
alter table public.matches enable row level security;
alter table public.servers enable row level security;
alter table public.server_members enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;
alter table public.reactions enable row level security;
alter table public.follows enable row level security;
alter table public.reel_likes enable row level security;

-- RLS Policies: Profiles
drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Profiles are viewable by everyone" on public.profiles for select using (true);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

-- RLS Policies: Clips
drop policy if exists "Clips are viewable by everyone" on public.clips;
create policy "Clips are viewable by everyone" on public.clips for select using (true);
drop policy if exists "Users can insert own clips" on public.clips;
create policy "Users can insert own clips" on public.clips for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own clips" on public.clips;
create policy "Users can update own clips" on public.clips for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own clips" on public.clips;
create policy "Users can delete own clips" on public.clips for delete using (auth.uid() = user_id);

-- RLS Policies: Reels
drop policy if exists "Reels are viewable by everyone" on public.reels;
create policy "Reels are viewable by everyone" on public.reels for select using (true);
drop policy if exists "Users can insert own reels" on public.reels;
create policy "Users can insert own reels" on public.reels for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own reels" on public.reels;
create policy "Users can update own reels" on public.reels for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own reels" on public.reels;
create policy "Users can delete own reels" on public.reels for delete using (auth.uid() = user_id);

-- RLS Policies: Matches
drop policy if exists "Matches are viewable by everyone" on public.matches;
create policy "Matches are viewable by everyone" on public.matches for select using (true);
drop policy if exists "Users can insert matches" on public.matches;
create policy "Users can insert matches" on public.matches for insert with check (auth.uid() is not null);
drop policy if exists "Users can update matches" on public.matches;
create policy "Users can update matches" on public.matches for update using (auth.uid() is not null);
drop policy if exists "Users can delete matches" on public.matches;
create policy "Users can delete matches" on public.matches for delete using (auth.uid() is not null);

-- RLS Policies: Servers
drop policy if exists "Servers are viewable by everyone" on public.servers;
create policy "Servers are viewable by everyone" on public.servers for select using (true);
drop policy if exists "Users can create servers" on public.servers;
create policy "Users can create servers" on public.servers for insert with check (auth.uid() is not null);
drop policy if exists "Users can update servers" on public.servers;
create policy "Users can update servers" on public.servers for update using (auth.uid() is not null);

-- RLS Policies: Server members
drop policy if exists "Server members viewable by everyone" on public.server_members;
create policy "Server members viewable by everyone" on public.server_members for select using (true);
drop policy if exists "Users can join servers" on public.server_members;
create policy "Users can join servers" on public.server_members for insert with check (auth.uid() = user_id);
drop policy if exists "Users can leave servers" on public.server_members;
create policy "Users can leave servers" on public.server_members for delete using (auth.uid() = user_id);

-- RLS Policies: Channels
drop policy if exists "Channels viewable by everyone" on public.channels;
create policy "Channels viewable by everyone" on public.channels for select using (true);
drop policy if exists "Users can create channels" on public.channels;
create policy "Users can create channels" on public.channels for insert with check (auth.uid() is not null);
drop policy if exists "Users can update channels" on public.channels;
create policy "Users can update channels" on public.channels for update using (auth.uid() is not null);

-- RLS Policies: Messages
drop policy if exists "Messages viewable by everyone" on public.messages;
create policy "Messages viewable by everyone" on public.messages for select using (true);
drop policy if exists "Users can insert messages" on public.messages;
create policy "Users can insert messages" on public.messages for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own messages" on public.messages;
create policy "Users can update own messages" on public.messages for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own messages" on public.messages;
create policy "Users can delete own messages" on public.messages for delete using (auth.uid() = user_id);

-- RLS Policies: Reactions
drop policy if exists "Reactions viewable by everyone" on public.reactions;
create policy "Reactions viewable by everyone" on public.reactions for select using (true);
drop policy if exists "Users can add reactions" on public.reactions;
create policy "Users can add reactions" on public.reactions for insert with check (auth.uid() = user_id);
drop policy if exists "Users can remove own reactions" on public.reactions;
create policy "Users can remove own reactions" on public.reactions for delete using (auth.uid() = user_id);

-- RLS Policies: Follows
drop policy if exists "Follows viewable by everyone" on public.follows;
create policy "Follows viewable by everyone" on public.follows for select using (true);
drop policy if exists "Users can follow" on public.follows;
create policy "Users can follow" on public.follows for insert with check (auth.uid() = follower_id);
drop policy if exists "Users can unfollow" on public.follows;
create policy "Users can unfollow" on public.follows for delete using (auth.uid() = follower_id);

-- RLS Policies: Reel likes
drop policy if exists "Reel likes viewable by everyone" on public.reel_likes;
create policy "Reel likes viewable by everyone" on public.reel_likes for select using (true);
drop policy if exists "Users can like reels" on public.reel_likes;
create policy "Users can like reels" on public.reel_likes for insert with check (auth.uid() = user_id);
drop policy if exists "Users can unlike reels" on public.reel_likes;
create policy "Users can unlike reels" on public.reel_likes for delete using (auth.uid() = user_id);

-- Function to create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
declare
  base_username text;
  final_username text;
begin
  base_username := coalesce(
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    split_part(new.email, '@', 1),
    'user_' || substr(new.id::text, 1, 8)
  );
  base_username := regexp_replace(base_username, '[^a-zA-Z0-9_]', '_', 'g');
  final_username := base_username;
  while exists (select 1 from public.profiles where username = final_username) loop
    final_username := base_username || '_' || substr(md5(random()::text), 1, 4);
  end loop;
  insert into public.profiles (id, username)
  values (new.id, final_username);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Storage buckets (idempotent; skip if storage schema not ready)
do $$ begin
  insert into storage.buckets (id, name, public) values ('videos', 'videos', true) on conflict (id) do nothing;
  insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
  insert into storage.buckets (id, name, public) values ('stat-check-videos', 'stat-check-videos', true) on conflict (id) do nothing;
  insert into storage.buckets (id, name, public) values ('match-screenshots', 'match-screenshots', true) on conflict (id) do nothing;
exception when others then null;
end $$;

-- Storage policies - use auth.uid() and storage.foldername (NOT user_id - storage.objects has owner, not user_id)
drop policy if exists "Videos are viewable by everyone" on storage.objects;
create policy "Videos are viewable by everyone" on storage.objects for select using (bucket_id = 'videos');
drop policy if exists "Users can upload videos" on storage.objects;
create policy "Users can upload videos" on storage.objects for insert with check (bucket_id = 'videos' and auth.uid() is not null);
drop policy if exists "Users can update own videos" on storage.objects;
create policy "Users can update own videos" on storage.objects for update using (bucket_id = 'videos' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "Users can delete own videos" on storage.objects;
create policy "Users can delete own videos" on storage.objects for delete using (bucket_id = 'videos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "Avatars are viewable by everyone" on storage.objects;
create policy "Avatars are viewable by everyone" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "Users can upload avatars" on storage.objects;
create policy "Users can upload avatars" on storage.objects for insert with check (bucket_id = 'avatars' and auth.uid() is not null);
drop policy if exists "Users can update own avatars" on storage.objects;
create policy "Users can update own avatars" on storage.objects for update using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "Users can delete own avatars" on storage.objects;
create policy "Users can delete own avatars" on storage.objects for delete using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "Stat check videos viewable" on storage.objects;
create policy "Stat check videos viewable" on storage.objects for select using (bucket_id = 'stat-check-videos');
drop policy if exists "Users can upload stat check videos" on storage.objects;
create policy "Users can upload stat check videos" on storage.objects for insert with check (bucket_id = 'stat-check-videos' and auth.uid() is not null);
drop policy if exists "Users can update own stat check videos" on storage.objects;
create policy "Users can update own stat check videos" on storage.objects for update using (bucket_id = 'stat-check-videos' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "Users can delete own stat check videos" on storage.objects;
create policy "Users can delete own stat check videos" on storage.objects for delete using (bucket_id = 'stat-check-videos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "Match screenshots viewable" on storage.objects;
create policy "Match screenshots viewable" on storage.objects for select using (bucket_id = 'match-screenshots');
drop policy if exists "Users can upload match screenshots" on storage.objects;
create policy "Users can upload match screenshots" on storage.objects for insert with check (bucket_id = 'match-screenshots' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users can update own match screenshots" on storage.objects;
create policy "Users can update own match screenshots" on storage.objects for update using (bucket_id = 'match-screenshots' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "Users can delete own match screenshots" on storage.objects;
create policy "Users can delete own match screenshots" on storage.objects for delete using (bucket_id = 'match-screenshots' and auth.uid()::text = (storage.foldername(name))[1]);

-- Seed default server and channels (unique index for ON CONFLICT)
create unique index if not exists channels_server_name_idx on public.channels (server_id, name);

insert into public.servers (id, name) values ('00000000-0000-0000-0000-000000000001', 'StrikerClips Community') on conflict (id) do update set name = excluded.name;
insert into public.channels (server_id, name, type) values ('00000000-0000-0000-0000-000000000001', 'general', 'text'), ('00000000-0000-0000-0000-000000000001', 'highlights', 'clips'), ('00000000-0000-0000-0000-000000000001', 'clips', 'clips') on conflict (server_id, name) do nothing;

-- Live streams
create table if not exists public.live_streams (id uuid primary key default uuid_generate_v4(), user_id uuid references public.profiles(id) on delete cascade not null, youtube_url text not null, title text, is_live boolean default true, created_at timestamptz default now());
create table if not exists public.live_groups (id uuid primary key default uuid_generate_v4(), name text not null, created_at timestamptz default now());
create table if not exists public.live_group_members (id uuid primary key default uuid_generate_v4(), group_id uuid references public.live_groups(id) on delete cascade not null, user_id uuid references public.profiles(id) on delete cascade not null, stream_id uuid references public.live_streams(id) on delete set null, accepted boolean default false, unique(group_id, user_id));
create table if not exists public.user_youtube_links (id uuid primary key default uuid_generate_v4(), user_id uuid references public.profiles(id) on delete cascade not null, url text not null, title text, created_at timestamptz default now());

alter table public.live_streams enable row level security;
alter table public.live_groups enable row level security;
alter table public.live_group_members enable row level security;
alter table public.user_youtube_links enable row level security;

drop policy if exists "Live streams viewable" on public.live_streams;
create policy "Live streams viewable" on public.live_streams for select using (true);
drop policy if exists "Users insert live streams" on public.live_streams;
create policy "Users insert live streams" on public.live_streams for insert with check (auth.uid() = user_id);
drop policy if exists "Live groups viewable" on public.live_groups;
create policy "Live groups viewable" on public.live_groups for select using (true);
drop policy if exists "Users create live groups" on public.live_groups;
create policy "Users create live groups" on public.live_groups for insert with check (auth.uid() is not null);
drop policy if exists "Live group members viewable" on public.live_group_members;
create policy "Live group members viewable" on public.live_group_members for select using (true);
drop policy if exists "User youtube links viewable by owner" on public.user_youtube_links;
create policy "User youtube links viewable by owner" on public.user_youtube_links for select using (auth.uid() = user_id);
drop policy if exists "Users insert youtube links" on public.user_youtube_links;
create policy "Users insert youtube links" on public.user_youtube_links for insert with check (auth.uid() = user_id);
drop policy if exists "Users delete own youtube links" on public.user_youtube_links;
create policy "Users delete own youtube links" on public.user_youtube_links for delete using (auth.uid() = user_id);

-- Live group creator
alter table public.live_groups add column if not exists creator_id uuid references public.profiles(id) on delete cascade;
drop policy if exists "Creators update live groups" on public.live_groups;
create policy "Creators update live groups" on public.live_groups for update using (creator_id = auth.uid());
drop policy if exists "Creators delete live groups" on public.live_groups;
create policy "Creators delete live groups" on public.live_groups for delete using (creator_id = auth.uid());
drop policy if exists "Users insert live group members" on public.live_group_members;
create policy "Users insert live group members" on public.live_group_members for insert with check (auth.uid() = user_id or exists (select 1 from public.live_groups g where g.id = group_id and g.creator_id = auth.uid()));
drop policy if exists "Users update own live group members" on public.live_group_members;
create policy "Users update own live group members" on public.live_group_members for update using (auth.uid() = user_id);
drop policy if exists "Users delete own live group members" on public.live_group_members;
create policy "Users delete own live group members" on public.live_group_members for delete using (auth.uid() = user_id);

-- DMs, Polls, Activities
create table if not exists public.dm_conversations (id uuid default uuid_generate_v4() primary key, name text, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists public.dm_participants (id uuid default uuid_generate_v4() primary key, conversation_id uuid references public.dm_conversations(id) on delete cascade not null, user_id uuid references public.profiles(id) on delete cascade not null, joined_at timestamptz default now(), unique(conversation_id, user_id));
create table if not exists public.dm_messages (id uuid default uuid_generate_v4() primary key, conversation_id uuid references public.dm_conversations(id) on delete cascade not null, user_id uuid references public.profiles(id) on delete cascade not null, content text not null default '', created_at timestamptz default now());
create table if not exists public.polls (id uuid default uuid_generate_v4() primary key, user_id uuid references public.profiles(id) on delete cascade not null, question text not null, created_at timestamptz default now(), ends_at timestamptz);
create table if not exists public.poll_options (id uuid default uuid_generate_v4() primary key, poll_id uuid references public.polls(id) on delete cascade not null, text text not null, "order" int default 0);
create table if not exists public.poll_votes (id uuid default uuid_generate_v4() primary key, poll_id uuid references public.polls(id) on delete cascade not null, poll_option_id uuid references public.poll_options(id) on delete cascade not null, user_id uuid references public.profiles(id) on delete cascade not null, created_at timestamptz default now(), unique(poll_id, user_id));
create table if not exists public.reel_reactions (id uuid default uuid_generate_v4() primary key, reel_id uuid references public.reels(id) on delete cascade not null, user_id uuid references public.profiles(id) on delete cascade not null, emoji text not null, created_at timestamptz default now(), unique(reel_id, user_id, emoji));
create table if not exists public.activities (id uuid default uuid_generate_v4() primary key, user_id uuid references public.profiles(id) on delete cascade not null, type text not null check (type in ('reel_created', 'follow', 'reel_like', 'poll_created')), target_id uuid, target_meta jsonb default '{}', created_at timestamptz default now());

create index if not exists idx_activities_user_created on public.activities(user_id, created_at desc);
create index if not exists idx_dm_messages_conversation on public.dm_messages(conversation_id, created_at desc);
create index if not exists idx_dm_participants_user on public.dm_participants(user_id);

alter table public.dm_conversations enable row level security;
alter table public.dm_participants enable row level security;
alter table public.dm_messages enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.reel_reactions enable row level security;
alter table public.activities enable row level security;

drop policy if exists "Users see own DM conversations" on public.dm_conversations;
create policy "Users see own DM conversations" on public.dm_conversations for select using (exists (select 1 from public.dm_participants p where p.conversation_id = id and p.user_id = auth.uid()));
drop policy if exists "Users create DM conversations" on public.dm_conversations;
create policy "Users create DM conversations" on public.dm_conversations for insert with check (auth.uid() is not null);
drop policy if exists "Users see own DM participants" on public.dm_participants;
create policy "Users see own DM participants" on public.dm_participants for select using (exists (select 1 from public.dm_participants p2 where p2.conversation_id = conversation_id and p2.user_id = auth.uid()));
drop policy if exists "Users add self to DM" on public.dm_participants;
create policy "Users add self to DM" on public.dm_participants for insert with check (auth.uid() = user_id);
drop policy if exists "Users see DM messages in own conversations" on public.dm_messages;
create policy "Users see DM messages in own conversations" on public.dm_messages for select using (exists (select 1 from public.dm_participants p where p.conversation_id = conversation_id and p.user_id = auth.uid()));
drop policy if exists "Users send DM messages" on public.dm_messages;
create policy "Users send DM messages" on public.dm_messages for insert with check (auth.uid() = user_id);
drop policy if exists "Polls viewable by everyone" on public.polls;
create policy "Polls viewable by everyone" on public.polls for select using (true);
drop policy if exists "Users create polls" on public.polls;
create policy "Users create polls" on public.polls for insert with check (auth.uid() = user_id);
drop policy if exists "Poll options viewable" on public.poll_options;
create policy "Poll options viewable" on public.poll_options for select using (true);
drop policy if exists "Users create poll options" on public.poll_options;
create policy "Users create poll options" on public.poll_options for insert with check (auth.uid() is not null);
drop policy if exists "Poll votes viewable" on public.poll_votes;
create policy "Poll votes viewable" on public.poll_votes for select using (true);
drop policy if exists "Users vote on polls" on public.poll_votes;
create policy "Users vote on polls" on public.poll_votes for insert with check (auth.uid() = user_id);
drop policy if exists "Users remove own vote" on public.poll_votes;
create policy "Users remove own vote" on public.poll_votes for delete using (auth.uid() = user_id);
drop policy if exists "Reel reactions viewable" on public.reel_reactions;
create policy "Reel reactions viewable" on public.reel_reactions for select using (true);
drop policy if exists "Users add reel reactions" on public.reel_reactions;
create policy "Users add reel reactions" on public.reel_reactions for insert with check (auth.uid() = user_id);
drop policy if exists "Users remove own reel reactions" on public.reel_reactions;
create policy "Users remove own reel reactions" on public.reel_reactions for delete using (auth.uid() = user_id);
drop policy if exists "Activities viewable by everyone" on public.activities;
create policy "Activities viewable by everyone" on public.activities for select using (true);
drop policy if exists "Users create activities" on public.activities;
create policy "Users create activities" on public.activities for insert with check (auth.uid() = user_id);

-- Activity triggers
create or replace function public.record_reel_activity() returns trigger as $$ begin insert into public.activities (user_id, type, target_id, target_meta) values (new.user_id, 'reel_created', new.id, jsonb_build_object('title', new.title)); return new; end; $$ language plpgsql security definer;
create or replace function public.record_follow_activity() returns trigger as $$ begin insert into public.activities (user_id, type, target_id, target_meta) values (new.follower_id, 'follow', new.following_id, '{}'); return new; end; $$ language plpgsql security definer;
create or replace function public.record_reel_like_activity() returns trigger as $$ begin insert into public.activities (user_id, type, target_id) values (new.user_id, 'reel_like', new.reel_id); return new; end; $$ language plpgsql security definer;
create or replace function public.record_poll_activity() returns trigger as $$ begin insert into public.activities (user_id, type, target_id, target_meta) values (new.user_id, 'poll_created', new.id, jsonb_build_object('question', new.question)); return new; end; $$ language plpgsql security definer;
drop trigger if exists on_reel_created_activity on public.reels;
create trigger on_reel_created_activity after insert on public.reels for each row execute procedure public.record_reel_activity();
drop trigger if exists on_follow_activity on public.follows;
create trigger on_follow_activity after insert on public.follows for each row execute procedure public.record_follow_activity();
drop trigger if exists on_reel_like_activity on public.reel_likes;
create trigger on_reel_like_activity after insert on public.reel_likes for each row execute procedure public.record_reel_like_activity();
drop trigger if exists on_poll_created_activity on public.polls;
create trigger on_poll_created_activity after insert on public.polls for each row execute procedure public.record_poll_activity();

-- Profiles extension, match results, stat check
alter table public.profiles add column if not exists power_level integer default 0;
alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists dashboard_override jsonb;

create table if not exists public.match_results (id uuid default uuid_generate_v4() primary key, uploader_id uuid references public.profiles(id) on delete cascade not null, screenshot_url text, screenshot_hash text, match_type text not null check (match_type in ('survival', 'quick_match', 'red_white', 'ninja_world_league', 'tournament')), status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')), verified_at timestamptz, verified_by uuid references public.profiles(id), created_at timestamptz default now());
alter table public.match_results add column if not exists screenshot_hash text;
create table if not exists public.match_result_players (id uuid default uuid_generate_v4() primary key, result_id uuid references public.match_results(id) on delete cascade not null, profile_id uuid references public.profiles(id) on delete cascade not null, role text not null check (role in ('winner', 'loser', 'participant')), score integer, team text check (team in ('red', 'white')), unique(result_id, profile_id));
create table if not exists public.power_ratings (profile_id uuid references public.profiles(id) on delete cascade not null, match_type text not null, rating integer not null default 1000, wins integer not null default 0, losses integer not null default 0, updated_at timestamptz default now(), primary key (profile_id, match_type));
create table if not exists public.trophies (id uuid default uuid_generate_v4() primary key, profile_id uuid references public.profiles(id) on delete cascade not null, trophy_type text not null, earned_at timestamptz default now(), metadata jsonb default '{}');

create table if not exists public.stat_check_submissions (id uuid default uuid_generate_v4() primary key, user_id uuid references public.profiles(id) on delete cascade not null, video_url text not null, character_name text, description text, status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')), reviewed_at timestamptz, created_at timestamptz default now());

create index if not exists idx_match_results_uploader on public.match_results(uploader_id);
create index if not exists idx_match_results_status on public.match_results(status);
do $$ begin
  create unique index idx_match_results_screenshot_hash_unique on public.match_results (screenshot_hash) where screenshot_hash is not null;
exception when others then null;
end $$;
create index if not exists idx_power_ratings_profile on public.power_ratings(profile_id);
create index if not exists idx_trophies_profile on public.trophies(profile_id);
create index if not exists idx_stat_check_user on public.stat_check_submissions(user_id);
create index if not exists idx_stat_check_status on public.stat_check_submissions(status);

alter table public.match_results enable row level security;
alter table public.match_result_players enable row level security;
alter table public.power_ratings enable row level security;
alter table public.trophies enable row level security;
alter table public.stat_check_submissions enable row level security;

drop policy if exists "Match results viewable" on public.match_results;
create policy "Match results viewable" on public.match_results for select using (true);
drop policy if exists "Users insert match results" on public.match_results;
create policy "Users insert match results" on public.match_results for insert with check (auth.uid() = uploader_id);
drop policy if exists "Match result players viewable" on public.match_result_players;
create policy "Match result players viewable" on public.match_result_players for select using (true);
drop policy if exists "Users insert match result players for own results" on public.match_result_players;
create policy "Users insert match result players for own results" on public.match_result_players for insert with check (exists (select 1 from public.match_results mr where mr.id = result_id and mr.uploader_id = auth.uid()));
drop policy if exists "Power ratings viewable" on public.power_ratings;
create policy "Power ratings viewable" on public.power_ratings for select using (true);
drop policy if exists "Trophies viewable" on public.trophies;
create policy "Trophies viewable" on public.trophies for select using (true);
drop policy if exists "Stat check viewable" on public.stat_check_submissions;
create policy "Stat check viewable" on public.stat_check_submissions for select using (true);
drop policy if exists "Users insert stat check" on public.stat_check_submissions;
create policy "Users insert stat check" on public.stat_check_submissions for insert with check (auth.uid() = user_id);

-- Power ratings trigger: update power_ratings and profiles.power_level when verified match result players are inserted
create or replace function public.update_power_ratings_on_match() returns trigger as $$
declare
  v_match_type text;
  v_status text;
  v_rating_delta int;
begin
  select mr.match_type, mr.status into v_match_type, v_status
  from public.match_results mr where mr.id = new.result_id;

  if v_status != 'verified' then
    return new;
  end if;

  if new.role = 'winner' then
    v_rating_delta := 25;
  elsif new.role = 'loser' then
    v_rating_delta := -25;
  else
    return new;
  end if;

  insert into public.power_ratings (profile_id, match_type, rating, wins, losses, updated_at)
  values (
    new.profile_id,
    v_match_type,
    1000 + v_rating_delta,
    case when new.role = 'winner' then 1 else 0 end,
    case when new.role = 'loser' then 1 else 0 end,
    now()
  )
  on conflict (profile_id, match_type) do update set
    rating = power_ratings.rating + v_rating_delta,
    wins = power_ratings.wins + case when new.role = 'winner' then 1 else 0 end,
    losses = power_ratings.losses + case when new.role = 'loser' then 1 else 0 end,
    updated_at = now();

  update public.profiles
  set power_level = coalesce(
    (select max(rating) from public.power_ratings where profile_id = new.profile_id),
    0
  )
  where id = new.profile_id;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_match_result_player_insert_power on public.match_result_players;
create trigger on_match_result_player_insert_power
  after insert on public.match_result_players
  for each row execute procedure public.update_power_ratings_on_match();
