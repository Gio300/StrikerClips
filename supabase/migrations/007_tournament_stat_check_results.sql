-- Tournament Stat Check, Submit Results, Hall of Fame
-- tournament_admins, stat_check tournament_id, tournament_results, RLS

create table if not exists public.tournament_admins (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid references public.tournaments(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(tournament_id, user_id)
);

alter table public.stat_check_submissions add column if not exists tournament_id uuid references public.tournaments(id) on delete set null;
alter table public.stat_check_submissions add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;

create table if not exists public.tournament_results (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid references public.tournaments(id) on delete cascade not null,
  winner_profile_id uuid references public.profiles(id) on delete cascade not null,
  team_name text,
  submitted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_tournament_admins_tournament on public.tournament_admins(tournament_id);
create index if not exists idx_stat_check_tournament on public.stat_check_submissions(tournament_id);
create index if not exists idx_tournament_results_tournament on public.tournament_results(tournament_id);

alter table public.tournament_admins enable row level security;
alter table public.tournament_results enable row level security;

-- tournament_admins: select by anyone; insert/delete by tournament owner (created_by)
create policy "Tournament admins viewable" on public.tournament_admins for select using (true);
create policy "Tournament owner add admins" on public.tournament_admins for insert with check (
  exists (select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid())
);
create policy "Tournament owner remove admins" on public.tournament_admins for delete using (
  exists (select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid())
);

-- stat_check_submissions: update by tournament owner or admin (approve/reject)
drop policy if exists "Tournament owner admins update stat check" on public.stat_check_submissions;
create policy "Tournament owner admins update stat check" on public.stat_check_submissions for update using (
  tournament_id is not null and (
    exists (select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid())
    or exists (select 1 from public.tournament_admins ta where ta.tournament_id = stat_check_submissions.tournament_id and ta.user_id = auth.uid())
  )
);

-- tournament_results: select by anyone; insert by tournament owner or admin
create policy "Tournament results viewable" on public.tournament_results for select using (true);
create policy "Tournament owner admins insert results" on public.tournament_results for insert with check (
  exists (select 1 from public.tournaments t where t.id = tournament_id and t.created_by = auth.uid())
  or exists (select 1 from public.tournament_admins ta where ta.tournament_id = tournament_id and ta.user_id = auth.uid())
);

-- trophies: allow insert for authenticated (app restricts to tournament result flow)
drop policy if exists "Trophies insert authenticated" on public.trophies;
create policy "Trophies insert authenticated" on public.trophies for insert with check (auth.uid() is not null);
