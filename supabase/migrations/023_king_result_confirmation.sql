-- A participant's King result submission is a claim, not an authoritative
-- settlement. Keep each side's claim separately so Elo moves only after both
-- players independently name the same winner. Conflicts remain disputed for a
-- trusted host/media decision.
alter table if exists public.king_matches
  add column if not exists report_a_winner_id uuid;

alter table if exists public.king_matches
  add column if not exists report_b_winner_id uuid;
