-- 018_match_consent_and_versions.sql
-- Canonical recorded matches, immutable render history, and player consent.

alter table public.profiles
  add column if not exists auto_merge_opt_out boolean not null default false;

alter table public.match_versions
  add column if not exists participant_ids uuid[] not null default '{}';
alter table public.match_versions
  add column if not exists clip_ids uuid[] not null default '{}';
alter table public.match_versions
  add column if not exists reason text not null default 'render';

alter table public.match_angles
  add column if not exists clip_record_id uuid references public.clip_records(id) on delete set null;
alter table public.match_angles
  add column if not exists status text not null default 'active';
alter table public.match_angles
  add column if not exists removed_at timestamptz;
alter table public.match_angles
  add column if not exists removal_reason text;

do $$ begin
  alter table public.match_angles
    add constraint match_angles_status_check
    check (status in ('active', 'removed'));
exception when duplicate_object then null; end $$;

create index if not exists match_angles_user_status_idx
  on public.match_angles(user_id, status);
