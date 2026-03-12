-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (extends auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  avatar_url text,
  bio text,
  social_links jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Clips
create table public.clips (
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
create table public.reels (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  clip_ids uuid[] default '{}',
  combined_video_url text,
  thumbnail text,
  created_at timestamptz default now()
);

-- Matches
create table public.matches (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text,
  reel_ids uuid[] default '{}',
  created_at timestamptz default now()
);

-- Servers (Discord-style communities)
create table public.servers (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  icon_url text,
  created_at timestamptz default now()
);

-- Server members
create table public.server_members (
  id uuid default uuid_generate_v4() primary key,
  server_id uuid references public.servers(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role text default 'member',
  created_at timestamptz default now(),
  unique(server_id, user_id)
);

-- Channels
create table public.channels (
  id uuid default uuid_generate_v4() primary key,
  server_id uuid references public.servers(id) on delete cascade not null,
  name text not null,
  type text check (type in ('text', 'clips')) default 'text',
  created_at timestamptz default now()
);

-- Messages
create table public.messages (
  id uuid default uuid_generate_v4() primary key,
  channel_id uuid references public.channels(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  content text not null default '',
  clip_id uuid references public.clips(id) on delete set null,
  created_at timestamptz default now()
);

-- Reactions
create table public.reactions (
  id uuid default uuid_generate_v4() primary key,
  message_id uuid references public.messages(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  emoji text not null,
  created_at timestamptz default now(),
  unique(message_id, user_id, emoji)
);

-- Follows (social)
create table public.follows (
  id uuid default uuid_generate_v4() primary key,
  follower_id uuid references public.profiles(id) on delete cascade not null,
  following_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(follower_id, following_id),
  check (follower_id != following_id)
);

-- Likes (reels)
create table public.reel_likes (
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
create policy "Profiles are viewable by everyone" on public.profiles for select using (true);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

-- RLS Policies: Clips
create policy "Clips are viewable by everyone" on public.clips for select using (true);
create policy "Users can insert own clips" on public.clips for insert with check (auth.uid() = user_id);
create policy "Users can update own clips" on public.clips for update using (auth.uid() = user_id);
create policy "Users can delete own clips" on public.clips for delete using (auth.uid() = user_id);

-- RLS Policies: Reels
create policy "Reels are viewable by everyone" on public.reels for select using (true);
create policy "Users can insert own reels" on public.reels for insert with check (auth.uid() = user_id);
create policy "Users can update own reels" on public.reels for update using (auth.uid() = user_id);
create policy "Users can delete own reels" on public.reels for delete using (auth.uid() = user_id);

-- RLS Policies: Matches
create policy "Matches are viewable by everyone" on public.matches for select using (true);
create policy "Users can insert matches" on public.matches for insert with check (auth.uid() is not null);
create policy "Users can update matches" on public.matches for update using (auth.uid() is not null);
create policy "Users can delete matches" on public.matches for delete using (auth.uid() is not null);

-- RLS Policies: Servers
create policy "Servers are viewable by everyone" on public.servers for select using (true);
create policy "Users can create servers" on public.servers for insert with check (auth.uid() is not null);
create policy "Users can update servers" on public.servers for update using (auth.uid() is not null);

-- RLS Policies: Server members
create policy "Server members viewable by everyone" on public.server_members for select using (true);
create policy "Users can join servers" on public.server_members for insert with check (auth.uid() = user_id);
create policy "Users can leave servers" on public.server_members for delete using (auth.uid() = user_id);

-- RLS Policies: Channels
create policy "Channels viewable by everyone" on public.channels for select using (true);
create policy "Users can create channels" on public.channels for insert with check (auth.uid() is not null);
create policy "Users can update channels" on public.channels for update using (auth.uid() is not null);

-- RLS Policies: Messages
create policy "Messages viewable by everyone" on public.messages for select using (true);
create policy "Users can insert messages" on public.messages for insert with check (auth.uid() = user_id);
create policy "Users can update own messages" on public.messages for update using (auth.uid() = user_id);
create policy "Users can delete own messages" on public.messages for delete using (auth.uid() = user_id);

-- RLS Policies: Reactions
create policy "Reactions viewable by everyone" on public.reactions for select using (true);
create policy "Users can add reactions" on public.reactions for insert with check (auth.uid() = user_id);
create policy "Users can remove own reactions" on public.reactions for delete using (auth.uid() = user_id);

-- RLS Policies: Follows
create policy "Follows viewable by everyone" on public.follows for select using (true);
create policy "Users can follow" on public.follows for insert with check (auth.uid() = follower_id);
create policy "Users can unfollow" on public.follows for delete using (auth.uid() = follower_id);

-- RLS Policies: Reel likes
create policy "Reel likes viewable by everyone" on public.reel_likes for select using (true);
create policy "Users can like reels" on public.reel_likes for insert with check (auth.uid() = user_id);
create policy "Users can unlike reels" on public.reel_likes for delete using (auth.uid() = user_id);

-- Function to create profile on signup (username made unique with suffix if needed)
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

-- Trigger for new user signup
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Storage bucket for videos and avatars
insert into storage.buckets (id, name, public) values ('videos', 'videos', true);
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);

create policy "Videos are viewable by everyone" on storage.objects for select using (bucket_id = 'videos');
create policy "Users can upload videos" on storage.objects for insert with check (bucket_id = 'videos' and auth.uid() is not null);
create policy "Users can update own videos" on storage.objects for update using (bucket_id = 'videos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Users can delete own videos" on storage.objects for delete using (bucket_id = 'videos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Avatars are viewable by everyone" on storage.objects for select using (bucket_id = 'avatars');
create policy "Users can upload avatars" on storage.objects for insert with check (bucket_id = 'avatars' and auth.uid() is not null);
create policy "Users can update own avatars" on storage.objects for update using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Users can delete own avatars" on storage.objects for delete using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
