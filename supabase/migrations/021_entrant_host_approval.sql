-- Migration 021: tournament entries require explicit HOST approval.
--
-- Operator evidence (2026-08-02): an entrant ("MrJerry") showed up APPROVED
-- without any host/admin action, because self-entry wrote status='accepted'
-- directly (the client chose its own status and migration 011's column default
-- was 'accepted'). Kissa/Hammy — invited teammates — correctly sat 'pending'.
--
-- New model (mirrors the Express backend in server/app.ts):
--   * EVERY entry lands status='pending' (self-entry AND teammate invites).
--   * Only the tournament creator/admins flip it to 'accepted' or 'rejected'
--     (server fn /api/fn/tournament-entrant-review on the real backend).
--   * An entrant may still self-withdraw (status='withdrawn').
--   * 'rejected' joins the status vocabulary.
--
-- Idempotent.

-- 1. Default + constraint: 'pending' default, 'rejected' allowed.
alter table public.tournament_entrants alter column status set default 'pending';

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'tournament_entrants_status_check') then
    alter table public.tournament_entrants drop constraint tournament_entrants_status_check;
  end if;
  alter table public.tournament_entrants
    add constraint tournament_entrants_status_check
    check (status in ('pending', 'accepted', 'withdrawn', 'rejected'));
end $$;

-- 2. Self-inserts can no longer be born 'accepted'.
drop policy if exists "Users self-enter tournaments" on public.tournament_entrants;
create policy "Users self-enter tournaments"
  on public.tournament_entrants for insert
  with check (auth.uid() = user_id and status = 'pending');

-- 3. A user updating their OWN row may only keep it pending or withdraw —
--    never self-approve. (Migration 011's policy had no WITH CHECK beyond
--    USING, letting the owner write status='accepted' onto their own row.)
drop policy if exists "Users update own entrant row" on public.tournament_entrants;
create policy "Users update own entrant row"
  on public.tournament_entrants for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and status in ('pending', 'withdrawn'));

-- 4. The tournament creator (moderation) keeps full control — unchanged
--    "Creator updates entrants" policy from migration 011 still applies.
