-- Stat Check player-invites-admin flow + tournament-creator-report fields.
--
-- Flow refresher:
--   1. Player creates a submission (video URL, tournament_id, character).
--   2. Player invites a specific tournament admin to review (invited_admin_id).
--   3. Admin reviews and either approves or rejects with notes (reviewed_by + review_notes + status).
--   4. After approval, the tournament creator sees the report and records their decision
--      (allow the player, disqualify, no action) in creator_decision + creator_notes.
--
-- New columns are all nullable so existing rows from migration 006/007 keep working.
-- Idempotent: every alter uses `add column if not exists`.

alter table public.stat_check_submissions
  add column if not exists invited_admin_id uuid references public.profiles(id) on delete set null;

alter table public.stat_check_submissions
  add column if not exists review_notes text;

alter table public.stat_check_submissions
  add column if not exists creator_decision text;

alter table public.stat_check_submissions
  add column if not exists creator_notes text;

alter table public.stat_check_submissions
  add column if not exists creator_decided_at timestamptz;

-- creator_decision is a free-text string but constrained to a known set when present.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stat_check_creator_decision_check'
  ) then
    alter table public.stat_check_submissions
      add constraint stat_check_creator_decision_check
      check (creator_decision is null or creator_decision in ('allow', 'disqualify', 'no_action'));
  end if;
end $$;

create index if not exists idx_stat_check_invited_admin on public.stat_check_submissions(invited_admin_id);
create index if not exists idx_stat_check_creator_decision on public.stat_check_submissions(creator_decision);

-- RLS: the invited admin (in addition to ANY tournament admin / owner) can update.
-- This keeps the existing "any tournament admin can grab a pending review" mode
-- working but ALSO lets a player explicitly route a review to one specific admin.
drop policy if exists "Tournament owner admins update stat check" on public.stat_check_submissions;
create policy "Tournament owner admins update stat check"
  on public.stat_check_submissions for update
  using (
    -- The tournament owner can always update.
    (tournament_id is not null and exists (
      select 1 from public.tournaments t
      where t.id = stat_check_submissions.tournament_id
        and t.created_by = auth.uid()
    ))
    or
    -- Any registered tournament admin can update (catch-all reviewers).
    (tournament_id is not null and exists (
      select 1 from public.tournament_admins ta
      where ta.tournament_id = stat_check_submissions.tournament_id
        and ta.user_id = auth.uid()
    ))
    or
    -- The specifically-invited admin can update.
    (invited_admin_id is not null and invited_admin_id = auth.uid())
  );

-- Allow the SUBMITTER (the player) to update their own submission while it's
-- still pending — they may want to swap which admin they invited or fix the
-- video URL before review starts.
drop policy if exists "Submitter updates pending stat check" on public.stat_check_submissions;
create policy "Submitter updates pending stat check"
  on public.stat_check_submissions for update
  using (auth.uid() = user_id and status = 'pending');
