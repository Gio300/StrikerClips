import type { Pool } from 'pg'

/**
 * Durable queue for player-submitted UGC reports.
 *
 * Targets are polymorphic (post, reel, one of the chat tables), so target_id
 * intentionally is not a foreign key. The trusted report route verifies the
 * target and derives target_owner_id before inserting. Reports survive target
 * deletion so moderators retain the abuse/audit record.
 */
export const CONTENT_REPORTS_DDL = `
create table if not exists public.content_reports (
  id uuid primary key default uuid_generate_v4(),
  reporter_id uuid references public.profiles(id) on delete set null,
  target_type text not null check (target_type in (
    'profile','post','post_comment','reel','reel_comment','chat_message',
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

-- CREATE TABLE IF NOT EXISTS does not update an older check constraint. Keep
-- the boot-time schema path able to accept profile reports on already-running
-- installations as well as fresh databases.
alter table public.content_reports
  drop constraint if exists content_reports_target_type_check;
alter table public.content_reports
  add constraint content_reports_target_type_check check (target_type in (
    'profile','post','post_comment','reel','reel_comment','chat_message',
    'dm_message','stream_message','tournament_message','board_message'
  ));
`

export async function applyContentReportsSchema(pool: Pick<Pool, 'query'>): Promise<void> {
  await pool.query(CONTENT_REPORTS_DDL)
}
