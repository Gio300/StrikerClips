// Durable source, segmentation, and player-identity evidence. Kept separate
// from the API bootstrap so the web service, detector worker, and pg-mem tests
// all install the exact same schema.
export const MEDIA_EVIDENCE_DDL = `
create table if not exists public.media_sources (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  live_stream_id uuid references public.live_streams(id) on delete set null,
  provider text not null check (provider in ('youtube','tko','external')),
  source_kind text not null check (source_kind in ('youtube_upload','youtube_live','direct_upload','external_live')),
  external_id text,
  source_url text not null,
  source_fingerprint text not null unique,
  status text not null default 'queued'
    check (status in ('recording','queued','processing','complete','failed')),
  recorded_at timestamptz,
  ended_at timestamptz,
  duration_sec numeric,
  analysis_cursor_sec numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.media_sources add column if not exists live_stream_id uuid references public.live_streams(id) on delete set null;
create index if not exists idx_media_sources_owner_time
  on public.media_sources(owner_id, recorded_at desc, created_at desc);
create index if not exists idx_media_sources_live_stream
  on public.media_sources(live_stream_id, updated_at desc);
create index if not exists idx_media_sources_status
  on public.media_sources(status, updated_at);
create unique index if not exists uq_media_sources_provider_external
  on public.media_sources(provider, external_id)
  where external_id is not null;

-- One authoritative, evidence-backed state for the match currently shown by a
-- live stream. Oracle reads this row instead of treating "YouTube is online"
-- as proof that betting is still open.
create table if not exists public.live_match_states (
  stream_id uuid primary key references public.live_streams(id) on delete cascade,
  source_id uuid references public.media_sources(id) on delete set null,
  phase text not null default 'uncertain'
    check (phase in ('waiting','active','result_pending','finished','uncertain')),
  match_sequence integer not null default 1,
  match_ref text not null,
  match_format text not null default 'unknown'
    check (match_format in ('unknown','1v1','2v2','team')),
  fighter_aliases text[] not null default '{}',
  fighter_profile_ids uuid[] not null default '{}',
  result_outcome text check (result_outcome in ('victory','defeat','draw')),
  winner_profile_id uuid references public.profiles(id) on delete set null,
  loser_profile_id uuid references public.profiles(id) on delete set null,
  confidence real not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  observed_at timestamptz not null default now(),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_live_match_states_match_ref
  on public.live_match_states(match_ref);
create index if not exists idx_live_match_states_phase
  on public.live_match_states(phase, observed_at desc);

create table if not exists public.media_analysis_jobs (
  id uuid primary key default uuid_generate_v4(),
  source_id uuid not null references public.media_sources(id) on delete cascade,
  job_kind text not null default 'match_boundaries_v1',
  status text not null default 'queued'
    check (status in ('queued','processing','complete','failed')),
  reason text,
  attempts integer not null default 0,
  ready_at timestamptz not null default now(),
  lease_until timestamptz,
  worker_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id, job_kind)
);
create index if not exists idx_media_analysis_jobs_claim
  on public.media_analysis_jobs(status, ready_at, lease_until);

-- Tournament integrity is deliberately isolated from ordinary media scoring.
-- A report can exist only for media attached to a tournament live stream, and
-- the server (not the vision model) decides whether its evidence may produce a
-- public-facing clip.
create table if not exists public.tournament_integrity_reports (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  source_id uuid not null references public.media_sources(id) on delete cascade,
  participant_id uuid not null references public.profiles(id) on delete cascade,
  detector_version text not null,
  verdict text not null
    check (verdict in ('clear','needs_review','confirmed_mod','skipped')),
  report jsonb not null default '{}'::jsonb,
  clip_windows jsonb not null default '[]'::jsonb,
  public_accusation_allowed boolean not null default false,
  clip_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tournament_id, source_id, participant_id, detector_version)
);
create index if not exists idx_tournament_integrity_reports_tournament
  on public.tournament_integrity_reports(tournament_id, created_at desc);
create index if not exists idx_tournament_integrity_reports_review
  on public.tournament_integrity_reports(verdict, clip_eligible, created_at desc);

create table if not exists public.match_segments (
  id uuid primary key default uuid_generate_v4(),
  source_id uuid not null references public.media_sources(id) on delete cascade,
  segment_index integer not null,
  segment_fingerprint text not null unique,
  start_sec numeric not null,
  end_sec numeric not null,
  start_reason text not null,
  end_reason text not null,
  boundary_confidence real not null default 0,
  first_timer_sec integer,
  last_timer_sec integer,
  mode text,
  map text,
  roster text[] not null default '{}',
  resolved_member_ids uuid[] not null default '{}',
  member_vs_member boolean not null default false,
  detector_version text not null default 'match-boundaries-v1',
  evidence jsonb not null default '[]'::jsonb,
  match_group_id uuid references public.match_groups(id) on delete set null,
  clip_record_id uuid references public.clip_records(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id, segment_index)
);
create index if not exists idx_match_segments_source
  on public.match_segments(source_id, segment_index);
create index if not exists idx_match_segments_group
  on public.match_segments(match_group_id);

alter table public.clip_records add column if not exists source_id uuid references public.media_sources(id) on delete set null;
alter table public.clip_records add column if not exists segment_id uuid references public.match_segments(id) on delete set null;
alter table public.clip_records add column if not exists source_start_sec numeric;
alter table public.clip_records add column if not exists source_end_sec numeric;
alter table public.clip_records add column if not exists segment_index integer;
alter table public.clip_records add column if not exists boundary_confidence real;
alter table public.clip_records add column if not exists score_verification_status text not null default 'legacy'
  check (score_verification_status in ('legacy','shadow','verified'));
create unique index if not exists uq_clip_records_source_segment_owner
  on public.clip_records(segment_id, player_id)
  where segment_id is not null and player_id is not null;
create unique index if not exists uq_clip_records_segment_owner_all
  on public.clip_records(segment_id, player_id);

create table if not exists public.player_aliases (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  game text not null default 'shinobi_striker',
  display_alias text not null,
  normalized_alias text not null,
  status text not null default 'candidate'
    check (status in ('candidate','verified','retired','ambiguous','rejected')),
  valid_from timestamptz not null,
  valid_to timestamptz,
  confidence real not null default 0,
  is_primary boolean not null default false,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_player_aliases_resolve
  on public.player_aliases(game, normalized_alias, status, valid_from, valid_to);
create index if not exists idx_player_aliases_profile
  on public.player_aliases(profile_id, game, is_primary, valid_from desc);

create table if not exists public.player_alias_evidence (
  id uuid primary key default uuid_generate_v4(),
  alias_id uuid not null references public.player_aliases(id) on delete cascade,
  source_id uuid not null references public.media_sources(id) on delete cascade,
  segment_id uuid references public.match_segments(id) on delete set null,
  evidence_type text not null,
  account_owned boolean not null default false,
  confidence real not null default 0,
  observed_at timestamptz not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(alias_id, source_id, evidence_type)
);
create index if not exists idx_player_alias_evidence_alias
  on public.player_alias_evidence(alias_id, account_owned, confidence, observed_at);

create table if not exists public.match_member_observations (
  id uuid primary key default uuid_generate_v4(),
  segment_id uuid not null references public.match_segments(id) on delete cascade,
  detected_alias text not null,
  normalized_alias text not null,
  resolved_profile_id uuid references public.profiles(id) on delete set null,
  resolution_status text not null default 'unresolved'
    check (resolution_status in ('resolved','unresolved','ambiguous')),
  team text,
  confidence real not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(segment_id, normalized_alias)
);
create index if not exists idx_match_member_observations_profile
  on public.match_member_observations(resolved_profile_id, observed_at desc);

create table if not exists public.combat_events (
  id uuid primary key default uuid_generate_v4(),
  source_id uuid not null references public.media_sources(id) on delete cascade,
  segment_id uuid not null references public.match_segments(id) on delete cascade,
  match_group_id uuid references public.match_groups(id) on delete set null,
  event_fingerprint text not null unique,
  event_type text not null default 'ko' check (event_type in ('ko','death','assist')),
  at_sec numeric not null,
  match_clock_sec integer,
  killer_alias text,
  victim_alias text,
  killer_profile_id uuid references public.profiles(id) on delete set null,
  victim_profile_id uuid references public.profiles(id) on delete set null,
  verification_status text not null default 'candidate'
    check (verification_status in ('candidate','single_camera','verified','ambiguous')),
  confidence real not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_combat_events_match_players
  on public.combat_events(match_group_id, killer_profile_id, victim_profile_id, match_clock_sec);

create table if not exists public.match_result_observations (
  id uuid primary key default uuid_generate_v4(),
  source_id uuid not null references public.media_sources(id) on delete cascade,
  segment_id uuid not null references public.match_segments(id) on delete cascade,
  match_group_id uuid references public.match_groups(id) on delete set null,
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  outcome text not null check (outcome in ('victory','defeat','draw')),
  kills integer,
  deaths integer,
  assists integer,
  score_line text,
  team text,
  at_sec numeric not null,
  explicit_evidence boolean not null default false,
  verification_status text not null default 'candidate'
    check (verification_status in ('candidate','single_camera','verified','ambiguous')),
  confidence real not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id, segment_id, outcome, at_sec)
);
create index if not exists idx_match_result_observations_group
  on public.match_result_observations(match_group_id, owner_profile_id, verification_status);

create table if not exists public.verified_combat_events (
  id uuid primary key default uuid_generate_v4(),
  match_group_id uuid not null references public.match_groups(id) on delete cascade,
  event_type text not null default 'ko' check (event_type in ('ko','death','assist')),
  killer_profile_id uuid not null references public.profiles(id) on delete cascade,
  victim_profile_id uuid not null references public.profiles(id) on delete cascade,
  match_clock_sec integer not null,
  source_ids uuid[] not null default '{}',
  source_owner_ids uuid[] not null default '{}',
  raw_event_ids uuid[] not null default '{}',
  evidence_count integer not null,
  confidence real not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_verified_combat_events_match
  on public.verified_combat_events(match_group_id, killer_profile_id, victim_profile_id, match_clock_sec);

create table if not exists public.verified_match_player_stats (
  id uuid primary key default uuid_generate_v4(),
  match_group_id uuid not null references public.match_groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kills integer not null default 0,
  deaths integer not null default 0,
  assists integer not null default 0,
  outcome text check (outcome in ('victory','defeat','draw')),
  outcome_verification text not null default 'shadow'
    check (outcome_verification in ('shadow','single_camera','verified')),
  source_count integer not null default 0,
  confidence real not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(match_group_id, profile_id)
);
create index if not exists idx_verified_match_player_stats_profile
  on public.verified_match_player_stats(profile_id, created_at desc);
`
