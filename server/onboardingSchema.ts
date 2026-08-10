import type { Pool } from 'pg'

/**
 * Durable chat-first onboarding state and its proposal audit trail.
 *
 * Domain data deliberately remains in the existing tables (profiles,
 * user_youtube_links, servers, clan_members, clan_rosters, follows, ...).
 * These tables remember the conversation, confirmations, and ownership
 * disputes; they are not a second profile/clan model.
 */
export const ONBOARDING_DDL = `
alter table public.profiles add column if not exists game_tag text;

alter table public.user_youtube_links add column if not exists claim_status text not null default 'legacy';
alter table public.user_youtube_links add column if not exists claim_method text;
alter table public.user_youtube_links add column if not exists claimed_at timestamptz;

create unique index if not exists servers_clan_name_lower_uniq
  on public.servers(lower(name)) where kind='clan';
create unique index if not exists servers_clan_tag_lower_uniq
  on public.servers(lower(clan_tag)) where clan_tag is not null;

create unique index if not exists user_youtube_links_claimed_channel_uniq
  on public.user_youtube_links(channel_id)
  where channel_id is not null and claim_status='claimed';

create table if not exists public.member_onboarding (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  flow_version text not null default 'chat_v1',
  status text not null default 'new'
    check (status in ('new','active','deferred','ready','complete')),
  current_step text not null default 'identity',
  lane text check (lane is null or lane in ('solo','member','leader','organizer')),
  roles jsonb not null default '[]'::jsonb,
  facts jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  revision integer not null default 0 check (revision >= 0),
  deferred_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists member_onboarding_status_idx
  on public.member_onboarding(status, updated_at);

create table if not exists public.onboarding_actions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  status text not null default 'proposed'
    check (status in ('proposed','confirmed','processing','done','failed')),
  label text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  idempotency_key text not null,
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index if not exists onboarding_actions_user_idx
  on public.onboarding_actions(user_id, status, created_at);

create table if not exists public.onboarding_video_reports (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_url text not null,
  video_id text not null,
  channel_id text not null,
  channel_url text not null,
  channel_title text,
  video_title text,
  thumbnail_url text,
  media_source_id uuid references public.media_sources(id) on delete set null,
  status text not null default 'resolved',
  extraction jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, video_id)
);
create index if not exists onboarding_video_reports_user_idx
  on public.onboarding_video_reports(user_id, created_at desc);

create table if not exists public.identity_claim_disputes (
  id uuid primary key default uuid_generate_v4(),
  kind text not null check (kind in ('youtube_channel','clan')),
  subject_key text not null,
  current_owner_id uuid references public.profiles(id) on delete set null,
  challenger_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'open'
    check (status in ('open','confirmed_current','transferred','rejected','cancelled')),
  freeze_state text not null default 'future_writes',
  evidence jsonb not null default '{}'::jsonb,
  reviewer_id uuid references public.profiles(id) on delete set null,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists identity_claim_disputes_open_uniq
  on public.identity_claim_disputes(kind, subject_key, challenger_id)
  where status='open';
create index if not exists identity_claim_disputes_review_idx
  on public.identity_claim_disputes(status, created_at);
`

export async function applyOnboardingSchema(pool: Pick<Pool, 'query'>): Promise<void> {
  await pool.query(ONBOARDING_DDL)
}
