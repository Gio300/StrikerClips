-- DMs (private and group messages)
create table if not exists public.dm_conversations (
  id uuid default uuid_generate_v4() primary key,
  name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.dm_participants (
  id uuid default uuid_generate_v4() primary key,
  conversation_id uuid references public.dm_conversations(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  joined_at timestamptz default now(),
  unique(conversation_id, user_id)
);

create table if not exists public.dm_messages (
  id uuid default uuid_generate_v4() primary key,
  conversation_id uuid references public.dm_conversations(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  content text not null default '',
  created_at timestamptz default now()
);

-- Polls
create table if not exists public.polls (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  question text not null,
  created_at timestamptz default now(),
  ends_at timestamptz
);

create table if not exists public.poll_options (
  id uuid default uuid_generate_v4() primary key,
  poll_id uuid references public.polls(id) on delete cascade not null,
  text text not null,
  "order" int default 0
);

create table if not exists public.poll_votes (
  id uuid default uuid_generate_v4() primary key,
  poll_id uuid references public.polls(id) on delete cascade not null,
  poll_option_id uuid references public.poll_options(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(poll_id, user_id)
);

-- Reel reactions (emoticons on reels)
create table if not exists public.reel_reactions (
  id uuid default uuid_generate_v4() primary key,
  reel_id uuid references public.reels(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  emoji text not null,
  created_at timestamptz default now(),
  unique(reel_id, user_id, emoji)
);
alter table public.reel_reactions enable row level security;
create policy "Reel reactions viewable" on public.reel_reactions for select using (true);
create policy "Users add reel reactions" on public.reel_reactions for insert with check (auth.uid() = user_id);
create policy "Users remove own reel reactions" on public.reel_reactions for delete using (auth.uid() = user_id);

-- Activity feed (denormalized for fast reads)
create table if not exists public.activities (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  type text not null check (type in ('reel_created', 'follow', 'reel_like', 'poll_created')),
  target_id uuid,
  target_meta jsonb default '{}',
  created_at timestamptz default now()
);

create index if not exists idx_activities_user_created on public.activities(user_id, created_at desc);
create index if not exists idx_dm_messages_conversation on public.dm_messages(conversation_id, created_at desc);
create index if not exists idx_dm_participants_user on public.dm_participants(user_id);

alter table public.dm_conversations enable row level security;
alter table public.dm_participants enable row level security;
alter table public.dm_messages enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.activities enable row level security;

-- DM policies: participants can read their conversations and messages
create policy "Users see own DM conversations" on public.dm_conversations for select
  using (exists (select 1 from public.dm_participants p where p.conversation_id = id and p.user_id = auth.uid()));
create policy "Users create DM conversations" on public.dm_conversations for insert with check (auth.uid() is not null);

create policy "Users see own DM participants" on public.dm_participants for select
  using (exists (select 1 from public.dm_participants p2 where p2.conversation_id = conversation_id and p2.user_id = auth.uid()));
create policy "Users add self to DM" on public.dm_participants for insert with check (auth.uid() = user_id);

create policy "Users see DM messages in own conversations" on public.dm_messages for select
  using (exists (select 1 from public.dm_participants p where p.conversation_id = conversation_id and p.user_id = auth.uid()));
create policy "Users send DM messages" on public.dm_messages for insert with check (auth.uid() = user_id);

-- Poll policies
create policy "Polls viewable by everyone" on public.polls for select using (true);
create policy "Users create polls" on public.polls for insert with check (auth.uid() = user_id);
create policy "Poll options viewable" on public.poll_options for select using (true);
create policy "Users create poll options" on public.poll_options for insert with check (auth.uid() is not null);
create policy "Poll votes viewable" on public.poll_votes for select using (true);
create policy "Users vote on polls" on public.poll_votes for insert with check (auth.uid() = user_id);
create policy "Users remove own vote" on public.poll_votes for delete using (auth.uid() = user_id);

-- Activity policies
create policy "Activities viewable by everyone" on public.activities for select using (true);
create policy "Users create activities" on public.activities for insert with check (auth.uid() = user_id);

-- Triggers to populate activity feed
create or replace function public.record_reel_activity()
returns trigger as $$
begin
  insert into public.activities (user_id, type, target_id, target_meta)
  values (new.user_id, 'reel_created', new.id, jsonb_build_object('title', new.title));
  return new;
end;
$$ language plpgsql security definer;

create or replace function public.record_follow_activity()
returns trigger as $$
begin
  insert into public.activities (user_id, type, target_id, target_meta)
  values (new.follower_id, 'follow', new.following_id, '{}');
  return new;
end;
$$ language plpgsql security definer;

create or replace function public.record_reel_like_activity()
returns trigger as $$
begin
  insert into public.activities (user_id, type, target_id)
  values (new.user_id, 'reel_like', new.reel_id);
  return new;
end;
$$ language plpgsql security definer;

create or replace function public.record_poll_activity()
returns trigger as $$
begin
  insert into public.activities (user_id, type, target_id, target_meta)
  values (new.user_id, 'poll_created', new.id, jsonb_build_object('question', new.question));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_reel_created_activity on public.reels;
create trigger on_reel_created_activity after insert on public.reels
  for each row execute procedure public.record_reel_activity();

drop trigger if exists on_follow_activity on public.follows;
create trigger on_follow_activity after insert on public.follows
  for each row execute procedure public.record_follow_activity();

drop trigger if exists on_reel_like_activity on public.reel_likes;
create trigger on_reel_like_activity after insert on public.reel_likes
  for each row execute procedure public.record_reel_like_activity();

drop trigger if exists on_poll_created_activity on public.polls;
create trigger on_poll_created_activity after insert on public.polls
  for each row execute procedure public.record_poll_activity();
