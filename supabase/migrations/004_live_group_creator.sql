-- Add creator to live groups so they can invite members
alter table public.live_groups
  add column if not exists creator_id uuid references public.profiles(id) on delete cascade;

-- Allow creator to update their group
create policy "Creators update live groups" on public.live_groups for update
  using (creator_id = auth.uid());

-- Allow creator to delete their group
create policy "Creators delete live groups" on public.live_groups for delete
  using (creator_id = auth.uid());

-- Allow group creator to insert members (invite)
drop policy if exists "Users insert live group members" on public.live_group_members;
create policy "Users insert live group members" on public.live_group_members for insert
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.live_groups g
      where g.id = group_id and g.creator_id = auth.uid()
    )
  );
