-- Migration 011: tournament entrants flow + per-admin permissions + notifications.
--
-- Adds the missing organizer/player split:
--   * tournaments now have explicit start_at, end_at, and status.
--   * tournament_admins gets a per-admin `can_approve_stat_check` toggle.
--   * NEW tournament_entrants — players (solo or team) who entered & agreed to rules.
--   * NEW notifications  — generic in-app notification feed for invites,
--                          reviews, decisions, etc.
--
-- All operations are idempotent.

-- ─────────────────────────────────────────────────────────────────────
-- 1. tournaments: dates, status, prize_pool
-- ─────────────────────────────────────────────────────────────────────
alter table public.tournaments add column if not exists start_at timestamptz;
alter table public.tournaments add column if not exists end_at   timestamptz;
alter table public.tournaments add column if not exists status   text default 'draft';
alter table public.tournaments add column if not exists prize_pool text;

-- status: draft (organizer prepping) | open (players can enter) |
--         live (running) | closed (finished)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_status_check') then
    alter table public.tournaments
      add constraint tournaments_status_check
      check (status in ('draft', 'open', 'live', 'closed'));
  end if;
end $$;

create index if not exists idx_tournaments_start_at on public.tournaments(start_at);
create index if not exists idx_tournaments_status   on public.tournaments(status);

-- ─────────────────────────────────────────────────────────────────────
-- 2. tournament_admins: per-admin permissions
-- ─────────────────────────────────────────────────────────────────────
alter table public.tournament_admins
  add column if not exists can_approve_stat_check boolean default true;
alter table public.tournament_admins
  add column if not exists can_submit_results     boolean default true;

-- ─────────────────────────────────────────────────────────────────────
-- 3. tournament_entrants: who entered, solo or team
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.tournament_entrants (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid references public.tournaments(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  -- Optional team affiliation. If null, entrant is solo.
  team_name text,
  team_server_id uuid references public.servers(id) on delete set null,
  -- 'pending' = invited but hasn't accepted yet (e.g. invited as a teammate);
  -- 'accepted' = entered & agreed to rules;
  -- 'withdrawn' = pulled out.
  status text not null default 'accepted',
  agreed_to_rules_at timestamptz,
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  unique (tournament_id, user_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournament_entrants_status_check') then
    alter table public.tournament_entrants
      add constraint tournament_entrants_status_check
      check (status in ('pending', 'accepted', 'withdrawn'));
  end if;
end $$;

create index if not exists idx_tournament_entrants_tournament on public.tournament_entrants(tournament_id);
create index if not exists idx_tournament_entrants_user       on public.tournament_entrants(user_id);
create index if not exists idx_tournament_entrants_status     on public.tournament_entrants(status);

alter table public.tournament_entrants enable row level security;

drop policy if exists "Tournament entrants viewable" on public.tournament_entrants;
create policy "Tournament entrants viewable"
  on public.tournament_entrants for select using (true);

-- A user can self-enter (insert their own row). The frontend must set
-- agreed_to_rules_at when they accept the rules.
drop policy if exists "Users self-enter tournaments" on public.tournament_entrants;
create policy "Users self-enter tournaments"
  on public.tournament_entrants for insert
  with check (auth.uid() = user_id);

-- The tournament creator OR an existing accepted entrant can invite a teammate.
drop policy if exists "Creator or teammate invites entrants" on public.tournament_entrants;
create policy "Creator or teammate invites entrants"
  on public.tournament_entrants for insert
  with check (
    -- Tournament creator may add anyone.
    exists (
      select 1 from public.tournaments t
      where t.id = tournament_id and t.created_by = auth.uid()
    )
    or
    -- A user who is already an accepted entrant may invite a teammate
    -- with status='pending'.
    (
      status = 'pending' and exists (
        select 1 from public.tournament_entrants me
        where me.tournament_id = tournament_entrants.tournament_id
          and me.user_id = auth.uid()
          and me.status = 'accepted'
      )
    )
  );

-- A user updates their OWN row (accept invite, withdraw).
drop policy if exists "Users update own entrant row" on public.tournament_entrants;
create policy "Users update own entrant row"
  on public.tournament_entrants for update
  using (auth.uid() = user_id);

-- The tournament creator can also update / withdraw entrants (for moderation).
drop policy if exists "Creator updates entrants" on public.tournament_entrants;
create policy "Creator updates entrants"
  on public.tournament_entrants for update
  using (
    exists (
      select 1 from public.tournaments t
      where t.id = tournament_id and t.created_by = auth.uid()
    )
  );

drop policy if exists "Users delete own entrant row" on public.tournament_entrants;
create policy "Users delete own entrant row"
  on public.tournament_entrants for delete
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- 4. notifications: in-app feed
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  -- High-level kind so the UI can pick an icon / route.
  kind text not null,
  title text not null,
  body text,
  -- Optional client-side route to deep-link to (e.g. /tournaments/abc).
  link text,
  -- Optional related entity id (tournament, stat check submission, etc.).
  related_id uuid,
  -- Who triggered this notification (the inviter, the reviewer, etc.).
  actor_id uuid references public.profiles(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_notifications_user_unread
  on public.notifications(user_id, read_at);
create index if not exists idx_notifications_user_created
  on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

-- A user only sees their OWN notifications.
drop policy if exists "Users see own notifications" on public.notifications;
create policy "Users see own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

-- Authenticated users can insert notifications targeted at anyone (the
-- frontend writes them on behalf of triggers like "I invited you as admin").
-- Future hardening: move these inserts to a SECURITY DEFINER function or
-- a server-side trigger so clients can't spam each other.
drop policy if exists "Authenticated users insert notifications" on public.notifications;
create policy "Authenticated users insert notifications"
  on public.notifications for insert
  with check (auth.uid() is not null);

-- A user marks their OWN notifications as read.
drop policy if exists "Users update own notifications" on public.notifications;
create policy "Users update own notifications"
  on public.notifications for update
  using (auth.uid() = user_id);

-- A user deletes their own notifications (dismissable feed).
drop policy if exists "Users delete own notifications" on public.notifications;
create policy "Users delete own notifications"
  on public.notifications for delete
  using (auth.uid() = user_id);
