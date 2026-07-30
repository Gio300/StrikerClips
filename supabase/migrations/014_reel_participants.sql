-- Migration 014: reel_participants — the CAST of a combined/multi-angle reel.
--
-- The core product loop is that several players upload their own angle of the
-- SAME match and the app combines them into one reel. Until now a reel belonged
-- to exactly one person (`reels.user_id`, the uploader), so everyone else who
-- literally appears in the video was never told and never saw it in their own
-- clips list. This table is the cast list that fixes that, and it is what the
-- "you're in a new clip" notification fans out over.
--
-- Mirrors db/schema.sql (the Express/Cloud SQL path) and the server
-- TABLE_POLICY entry in server/app.ts. All operations are idempotent.

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

alter table public.reel_participants enable row level security;

-- A reel is public content, and so is who is in it.
drop policy if exists "Reel participants viewable" on public.reel_participants;
create policy "Reel participants viewable"
  on public.reel_participants for select
  using (true);

-- WRITES are keyed on the REEL's author, not on user_id. Note this is
-- deliberately NOT "auth.uid() = user_id": that would let anybody add
-- THEMSELVES to a stranger's reel, forging a credit and firing a notification
-- at its author. Only the person who assembled the reel may say who is in it.
drop policy if exists "Reel owner names the cast" on public.reel_participants;
create policy "Reel owner names the cast"
  on public.reel_participants for insert
  with check (
    exists (
      select 1 from public.reels r
      where r.id = reel_participants.reel_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "Reel owner updates the cast" on public.reel_participants;
create policy "Reel owner updates the cast"
  on public.reel_participants for update
  using (
    exists (
      select 1 from public.reels r
      where r.id = reel_participants.reel_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "Reel owner removes from the cast" on public.reel_participants;
create policy "Reel owner removes from the cast"
  on public.reel_participants for delete
  using (
    exists (
      select 1 from public.reels r
      where r.id = reel_participants.reel_id and r.user_id = auth.uid()
    )
  );
