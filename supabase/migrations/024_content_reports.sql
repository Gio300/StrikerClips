-- Durable, server-owned UGC moderation queue.
-- The application route validates the polymorphic target and derives both
-- reporter_id and target_owner_id; this table is not client writable.
create table if not exists public.content_reports (
  id uuid primary key default uuid_generate_v4(),
  reporter_id uuid references public.profiles(id) on delete set null,
  target_type text not null check (target_type in (
    'post','post_comment','reel','reel_comment','chat_message',
    'dm_message','stream_message','tournament_message','board_message'
  )),
  target_id uuid not null,
  target_owner_id uuid references public.profiles(id) on delete set null,
  target_is_ai boolean not null default false,
  reason text not null check (reason in (
    'harassment','hate','violence','sexual','spam','scam',
    'impersonation','self_harm','other'
  )),
  details text,
  source_path text,
  status text not null default 'open'
    check (status in ('open','reviewing','resolved','dismissed')),
  reviewer_id uuid references public.profiles(id) on delete set null,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_reports_queue_idx
  on public.content_reports(status, created_at);
create index if not exists content_reports_reporter_idx
  on public.content_reports(reporter_id, created_at desc);
create index if not exists content_reports_target_idx
  on public.content_reports(target_type, target_id, created_at desc);
create unique index if not exists content_reports_one_active_per_reporter_target
  on public.content_reports(reporter_id, target_type, target_id)
  where reporter_id is not null and status in ('open','reviewing');
