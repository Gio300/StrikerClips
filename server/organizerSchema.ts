import type { Pool } from 'pg'

/**
 * Clan and tournament organizer state.
 *
 * These tables intentionally sit beside `tournament_entrants`: entrants remain
 * the per-player competition gate, while tournament_rosters are immutable team
 * snapshots with their own approval and revision trail.
 */
export const ORGANIZER_DDL = `
create table if not exists public.clan_applications (
  id uuid primary key default uuid_generate_v4(),
  server_id uuid not null references public.servers(id) on delete cascade,
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','withdrawn')),
  message text not null default '',
  fee_tokens_snapshot integer not null default 0 check (fee_tokens_snapshot >= 0),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (server_id, applicant_id)
);
create index if not exists clan_applications_review_idx
  on public.clan_applications(server_id, status, created_at);
create index if not exists clan_applications_applicant_idx
  on public.clan_applications(applicant_id, updated_at desc);

-- A village is the durable result of an accepted clan alliance. The old
-- clan_alliances table only recorded a pair, which left the UI with no shared
-- object to open and no safe way to claim a home on the Conquest map.
create table if not exists public.villages (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  chief_profile_id uuid references public.profiles(id) on delete set null,
  home_territory_id uuid unique,
  status text not null default 'active',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists villages_status_idx
  on public.villages(status, updated_at desc);

create table if not exists public.village_clans (
  village_id uuid not null references public.villages(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  joined_by uuid references public.profiles(id) on delete set null,
  under_strength boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (village_id, server_id),
  unique (server_id)
);
create index if not exists village_clans_village_idx
  on public.village_clans(village_id, joined_at);

create table if not exists public.clan_alliance_requests (
  id uuid primary key default uuid_generate_v4(),
  from_clan_id uuid not null references public.servers(id) on delete cascade,
  to_clan_id uuid not null references public.servers(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete restrict,
  proposed_village_name text not null default '',
  status text not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_clan_id, to_clan_id)
);
alter table public.clan_alliance_requests
  add column if not exists proposed_village_name text not null default '';
alter table public.clan_alliance_requests
  add column if not exists reviewed_by uuid;
alter table public.clan_alliance_requests
  add column if not exists reviewed_at timestamptz;
alter table public.clan_alliance_requests
  add column if not exists updated_at timestamptz not null default now();
create index if not exists clan_alliance_requests_target_idx
  on public.clan_alliance_requests(to_clan_id, status, updated_at desc);

create table if not exists public.clan_alliances (
  id uuid primary key default uuid_generate_v4(),
  clan_id uuid not null references public.servers(id) on delete cascade,
  ally_clan_id uuid not null references public.servers(id) on delete cascade,
  village_id uuid references public.villages(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (clan_id, ally_clan_id)
);
alter table public.clan_alliances add column if not exists village_id uuid;
create index if not exists clan_alliances_village_idx
  on public.clan_alliances(village_id, created_at);

alter table public.servers add column if not exists village_id uuid;
alter table public.territories add column if not exists owner_village_id uuid;
alter table public.tournaments add column if not exists server_id uuid;
alter table public.tournaments add column if not exists entry_scope text not null default 'public';
alter table public.tournaments add column if not exists village_id uuid;
alter table public.tournaments add column if not exists clan_entry_mode text not null default 'open';

create table if not exists public.tournament_clan_invitations (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  clan_id uuid not null references public.servers(id) on delete cascade,
  source_clan_roster_id uuid,
  status text not null default 'invited'
    check (status in ('invited','accepted','declined')),
  invited_by uuid not null references public.profiles(id) on delete restrict,
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, clan_id)
);
alter table public.tournament_clan_invitations
  add column if not exists source_clan_roster_id uuid;
create index if not exists tournament_clan_invitations_event_idx
  on public.tournament_clan_invitations(tournament_id, status, updated_at desc);
create index if not exists tournament_clan_invitations_clan_idx
  on public.tournament_clan_invitations(clan_id, status, updated_at desc);

create table if not exists public.clan_rosters (
  id uuid primary key default uuid_generate_v4(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null,
  game text not null default 'Shinobi Striker',
  max_members integer not null default 4 check (max_members between 1 and 100),
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (server_id, name)
);
create index if not exists clan_rosters_server_idx
  on public.clan_rosters(server_id, status, updated_at desc);

create table if not exists public.clan_roster_members (
  id uuid primary key default uuid_generate_v4(),
  roster_id uuid not null references public.clan_rosters(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'starter'
    check (member_role in ('captain','starter','substitute','coach')),
  added_by uuid not null references public.profiles(id) on delete restrict,
  added_at timestamptz not null default now(),
  unique (roster_id, user_id)
);
create index if not exists clan_roster_members_user_idx
  on public.clan_roster_members(user_id, added_at desc);

create table if not exists public.clan_roster_invites (
  id uuid primary key default uuid_generate_v4(),
  roster_id uuid not null references public.clan_rosters(id) on delete cascade,
  email text not null,
  invitee_id uuid references public.profiles(id) on delete set null,
  member_role text not null default 'starter'
    check (member_role in ('captain','starter','substitute','coach')),
  token_hash text not null unique,
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','revoked','expired')),
  fee_tokens_snapshot integer not null default 0 check (fee_tokens_snapshot >= 0),
  invited_by uuid not null references public.profiles(id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists clan_roster_invites_roster_idx
  on public.clan_roster_invites(roster_id, status, created_at desc);
create index if not exists clan_roster_invites_invitee_idx
  on public.clan_roster_invites(invitee_id, status, created_at desc);

create table if not exists public.tournament_rosters (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  clan_id uuid references public.servers(id) on delete set null,
  source_clan_roster_id uuid references public.clan_rosters(id) on delete set null,
  name text not null,
  captain_id uuid references public.profiles(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','changes_requested','rejected','withdrawn')),
  version integer not null default 1 check (version > 0),
  locked_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  change_request text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, name)
);
create index if not exists tournament_rosters_event_idx
  on public.tournament_rosters(tournament_id, status, updated_at desc);
create index if not exists tournament_rosters_clan_idx
  on public.tournament_rosters(clan_id, tournament_id);

create table if not exists public.tournament_roster_members (
  id uuid primary key default uuid_generate_v4(),
  tournament_roster_id uuid not null references public.tournament_rosters(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'starter'
    check (member_role in ('captain','starter','substitute','coach')),
  source_clan_roster_member_id uuid references public.clan_roster_members(id) on delete set null,
  added_at timestamptz not null default now(),
  unique (tournament_roster_id, user_id)
);
create index if not exists tournament_roster_members_user_idx
  on public.tournament_roster_members(user_id, added_at desc);

create table if not exists public.tournament_roster_revisions (
  id uuid primary key default uuid_generate_v4(),
  tournament_roster_id uuid not null references public.tournament_rosters(id) on delete cascade,
  version integer not null,
  action text not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  reason text,
  before_members jsonb not null default '[]'::jsonb,
  after_members jsonb not null default '[]'::jsonb,
  entitlement_source text,
  entitlement_ref text,
  mutation_id text not null,
  created_at timestamptz not null default now(),
  unique (tournament_roster_id, version),
  unique (mutation_id)
);
create index if not exists tournament_roster_revisions_idx
  on public.tournament_roster_revisions(tournament_roster_id, version desc);

create table if not exists public.tournament_perk_packs (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  organizer_id uuid not null references public.profiles(id) on delete restrict,
  offer_id uuid references public.creator_offers(id) on delete set null,
  qualifying_asset_id text references public.assets(id) on delete set null,
  name text not null,
  description text not null default '',
  image_url text,
  price_cents integer not null default 0 check (price_cents >= 0),
  benefits jsonb not null default '{"roster_changes":1,"artifact_slots":0}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tournament_perk_packs_event_idx
  on public.tournament_perk_packs(tournament_id, active, created_at);
create unique index if not exists tournament_perk_packs_offer_idx
  on public.tournament_perk_packs(offer_id) where offer_id is not null;

create table if not exists public.tournament_perk_grants (
  id uuid primary key default uuid_generate_v4(),
  pack_id uuid not null references public.tournament_perk_packs(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  tournament_roster_id uuid references public.tournament_rosters(id) on delete cascade,
  granted_by uuid not null references public.profiles(id) on delete restrict,
  note text,
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  check (user_id is not null or tournament_roster_id is not null)
);
create index if not exists tournament_perk_grants_lookup_idx
  on public.tournament_perk_grants(pack_id, user_id, tournament_roster_id, status);

create table if not exists public.tournament_roster_artifacts (
  id uuid primary key default uuid_generate_v4(),
  tournament_roster_id uuid not null references public.tournament_rosters(id) on delete cascade,
  asset_id text not null references public.assets(id) on delete restrict,
  attached_by uuid not null references public.profiles(id) on delete restrict,
  entitlement_source text not null check (entitlement_source in ('purchase','artifact','grant','host_override')),
  entitlement_ref text not null,
  reason text,
  mutation_id text not null unique,
  attached_at timestamptz not null default now(),
  unique (tournament_roster_id, asset_id)
);
create index if not exists tournament_roster_artifacts_roster_idx
  on public.tournament_roster_artifacts(tournament_roster_id, attached_at);

create table if not exists public.tournament_perk_usage (
  id uuid primary key default uuid_generate_v4(),
  pack_id uuid not null references public.tournament_perk_packs(id) on delete restrict,
  tournament_roster_id uuid not null references public.tournament_rosters(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  source_kind text not null check (source_kind in ('purchase','artifact','grant')),
  source_ref text not null,
  benefit text not null,
  units integer not null default 1 check (units > 0),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists tournament_perk_usage_source_idx
  on public.tournament_perk_usage(source_kind, source_ref, benefit);
create index if not exists tournament_perk_usage_roster_idx
  on public.tournament_perk_usage(tournament_roster_id, created_at desc);
`

const OFFER_TYPE_UPGRADE = [
  'alter table public.creator_offers drop constraint if exists creator_offers_offer_type_check',
  `alter table public.creator_offers add constraint creator_offers_offer_type_check
     check (offer_type in ('creator_subscription','clan_subscription','premium_highlight','tournament_pack'))`,
]

export async function applyOrganizerSchema(pool: Pick<Pool, 'query'>): Promise<void> {
  await pool.query(ORGANIZER_DDL)
  for (const statement of OFFER_TYPE_UPGRADE) await pool.query(statement)
}
