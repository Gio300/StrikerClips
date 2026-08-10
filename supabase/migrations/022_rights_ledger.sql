-- 022_rights_ledger.sql
-- USAGE RIGHTS for video, music and synthetic voice — the capture and
-- ATTRIBUTION layer. Operator 2026-08-06, for the breaking league:
--   "i need to make a pipeline for this system for video usage rights and music
--    usage rights.. i need to connect with the api's for system that get these
--    royalties for users and then have users use them.. but that part we dont
--    want to build out right now."
--
-- WHY THIS SHIPS BEFORE THE ROYALTY INTEGRATIONS, AND NOT AFTER
-- -------------------------------------------------------------
-- Royalty collection is deferred, deliberately. This is not, because the two
-- have opposite deadlines: a collection API can be added the day you sign with
-- one, but you can only capture a right AT THE MOMENT THE CONTENT ARRIVES.
-- Every clip ingested before this table exists is a clip you can never
-- retroactively prove you were allowed to monetise, and never honestly split.
-- Rights capture is therefore urgent precisely BECAUSE collection is not: it is
-- the part that becomes impossible later rather than merely unbuilt.
--
-- WHAT THIS IS NOT. There are no royalty_statements / royalty_lines tables here
-- on purpose. An empty ledger with no code writing to it reads as "covered"
-- when nothing is covered — the same defect class as a detector that never
-- fires. The attach point is documented at the bottom instead.
--
-- SCOPE. Everything is league-scoped and additive. Shinobi Striker writes no
-- rows here and is unaffected.

-- ───────────────────────────────────────────────────────────────────────────
--  Who can be owed something
-- ───────────────────────────────────────────────────────────────────────────
-- Separate from `profiles` because a rights holder frequently has NO account:
-- the producer of a track, a dancer's estate, a crew's LLC, a videographer who
-- filmed one battle. Tying payability to signup would silently drop them.
create table if not exists public.rights_holders (
  id            uuid primary key default gen_random_uuid(),
  league_slug   text not null,
  display_name  text not null,
  kind          text not null default 'person'
                check (kind in ('person','group','company','estate')),
  -- Optional link to a TKO account. Null = known, payable, not signed up.
  user_id       uuid references public.profiles(id) on delete set null,
  contact_email text,
  -- Society/PRO affiliations, IPI/CAE, payout handles. Free-form because every
  -- society names its identifiers differently.
  identifiers   jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists rights_holders_league_idx
  on public.rights_holders(league_slug, display_name);
create index if not exists rights_holders_user_idx
  on public.rights_holders(user_id) where user_id is not null;

-- ───────────────────────────────────────────────────────────────────────────
--  MUSIC
-- ───────────────────────────────────────────────────────────────────────────
-- `track_file` IS THE JOIN KEY to the render factory. The renderer picks a file
-- out of the league's music_dir by NAME (tko_engage.music_pool) and records it;
-- nothing else about a track crosses that boundary. Matching on the filename is
-- what lets a finished video be traced back to a licence without the factory
-- needing a database connection at all.
create table if not exists public.music_works (
  id           uuid primary key default gen_random_uuid(),
  league_slug  text not null,
  track_file   text not null,
  title        text not null default '',
  artist       text not null default '',

  -- WHERE THE RECORDING CAME FROM. This drives whether it is safe to publish
  -- at all, and it is the single most important column here.
  --   original    recorded/commissioned for us; we hold or licensed the master
  --   ai_generated  Suno/etc. Check the generator's terms for the plan it was
  --                 made on — output rights usually depend on the paid tier at
  --                 GENERATION time, and are not retroactive.
  --   licensed    a real third-party record with a written licence on file
  --   library     production/stock library under a blanket subscription
  --   unknown     NOT PUBLISHABLE. The honest default; see the check below.
  source       text not null default 'unknown'
               check (source in ('original','ai_generated','licensed','library','unknown')),
  license_type          text not null default '',
  license_evidence_url  text not null default '',
  license_expires_at    timestamptz,

  -- Registered identifiers. ISRC = this RECORDING, ISWC = the underlying
  -- COMPOSITION. They are different rights owned by different people and a
  -- system that conflates them pays the wrong party.
  isrc text not null default '',
  iswc text not null default '',

  -- Per-platform clearance. Not derivable from the licence: a sync licence for
  -- YouTube says nothing about TikTok's Commercial Music Library.
  cleared_platforms text[] not null default '{}',

  -- Does using this earn, or merely not get us sued? A track can be perfectly
  -- legal and still be claimed by Content ID, which routes 100% of the revenue
  -- to the claimant. That is the difference between "cleared" and "monetisable"
  -- and it is why they are two columns.
  monetizable       boolean not null default false,
  content_id_risk   text not null default 'unknown'
                    check (content_id_risk in ('none','low','high','unknown')),
  notes             text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists music_works_league_file_key
  on public.music_works(league_slug, track_file);

-- WHO OWNS THE TRACK, in percent. Rows per ROLE because the recording and the
-- composition are split differently and paid by different collectors.
create table if not exists public.music_splits (
  id            uuid primary key default gen_random_uuid(),
  work_id       uuid not null references public.music_works(id) on delete cascade,
  holder_id     uuid not null references public.rights_holders(id) on delete cascade,
  role          text not null
                check (role in ('writer','publisher','master','performer')),
  percent       numeric(6,3) not null check (percent >= 0 and percent <= 100),
  created_at    timestamptz not null default now()
);
create index if not exists music_splits_work_idx on public.music_splits(work_id);
-- One row per (work, holder, role): a second row is an edit, not a second share.
create unique index if not exists music_splits_unique
  on public.music_splits(work_id, holder_id, role);

-- ───────────────────────────────────────────────────────────────────────────
--  VIDEO
-- ───────────────────────────────────────────────────────────────────────────
-- A breaking clip carries at least TWO rights that are not the same person's:
-- the FILMER owns the footage (copyright in the recording) and the DANCER owns
-- the performance and their likeness. Publishing needs both. `clip_records`
-- already knows who uploaded; it does not know who is IN the frame, and for
-- this sport that is the person the audience came for.
create table if not exists public.video_grants (
  id             uuid primary key default gen_random_uuid(),
  league_slug    text not null,
  clip_record_id uuid references public.clip_records(id) on delete cascade,
  -- Null clip_record_id + a match_key = a grant covering a whole battle,
  -- which is how a signed event release is actually scoped in practice.
  match_key      text,
  holder_id      uuid not null references public.rights_holders(id) on delete cascade,
  role           text not null
                 check (role in ('filmer','performer','crew','venue','organizer')),

  -- THE GRANTS, one boolean each, defaulting to FALSE. Silence is not consent:
  -- an unanswered question must read as "not granted", never as "probably fine".
  may_publish    boolean not null default false,
  may_monetize   boolean not null default false,
  -- Sublicensing is what lets a clip appear on the sister site, in an ad, or in
  -- a compilation. It is the grant most often assumed and least often asked for.
  may_sublicense boolean not null default false,
  may_ai_train   boolean not null default false,

  territory      text not null default 'worldwide',
  term_starts_at timestamptz not null default now(),
  term_ends_at   timestamptz,
  exclusive      boolean not null default false,

  -- EVIDENCE. A right you cannot prove you were granted is a right you do not
  -- have the day someone disputes it.
  terms_version  text not null default '',
  evidence_url   text not null default '',
  signed_at      timestamptz,
  signed_ip      text,

  -- Withdrawal. Mirrors match_angles.status so the two consent surfaces read
  -- the same way; a withdrawn grant is never deleted, because what was legal to
  -- publish LAST year is a question you still have to be able to answer.
  status         text not null default 'active'
                 check (status in ('active','withdrawn','expired')),
  withdrawn_at   timestamptz,
  withdrawal_reason text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists video_grants_clip_idx on public.video_grants(clip_record_id);
create index if not exists video_grants_match_idx on public.video_grants(match_key);
create index if not exists video_grants_league_status_idx
  on public.video_grants(league_slug, status);

-- ───────────────────────────────────────────────────────────────────────────
--  SYNTHETIC VOICE
-- ───────────────────────────────────────────────────────────────────────────
-- Operator: "the use of eleven labs is different". The commentary voice is a
-- licensed asset like any other, and it carries a right the other two do not:
-- if a voice is CLONED from a real person, that person's consent is required
-- and is revocable — and ElevenLabs' own terms require it independently of
-- ours. A stock//generated voice carries no such consent but still carries the
-- generator's commercial-use terms, which depend on the PLAN the audio was
-- generated on, at generation time.
create table if not exists public.voice_works (
  id            uuid primary key default gen_random_uuid(),
  league_slug   text not null,
  provider      text not null default 'elevenlabs',
  voice_id      text not null,
  label         text not null default '',
  kind          text not null default 'stock'
                check (kind in ('stock','generated','cloned')),
  -- Required when kind='cloned', and enforced below.
  cloned_from_holder_id uuid references public.rights_holders(id) on delete restrict,
  consent_evidence_url  text not null default '',
  consent_signed_at     timestamptz,
  commercial_license    text not null default '',
  -- The provider plan the audio was generated under. ElevenLabs' commercial
  -- terms attach to the plan AT GENERATION TIME and do not apply retroactively
  -- when you upgrade, so the value must be recorded per voice, not inferred.
  generated_on_plan     text not null default '',
  status        text not null default 'active'
                check (status in ('active','revoked')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists voice_works_league_voice_key
  on public.voice_works(league_slug, provider, voice_id);

-- A cloned voice with no named human and no signed consent is the one state
-- this table exists to make unrepresentable.
do $$ begin
  alter table public.voice_works
    add constraint voice_works_cloned_needs_consent
    check (kind <> 'cloned'
           or (cloned_from_holder_id is not null and consent_signed_at is not null));
exception when duplicate_object then null; end $$;

-- ───────────────────────────────────────────────────────────────────────────
--  THE JOIN — what actually went into a published video
-- ───────────────────────────────────────────────────────────────────────────
-- THIS IS THE TABLE THE WHOLE FILE EXISTS FOR. Everything above is a registry
-- of rights; this is the record of USE. When a royalty statement arrives months
-- from now it names a VIDEO and an amount, and the only way to turn that into
-- an honest split is a per-video list of what went into it, written at render
-- time and never recomputed. Recomputing it later cannot work: the music pool
-- rotates, grants get withdrawn, and the cut that earned the money no longer
-- exists to be re-derived.
create table if not exists public.production_credits (
  id            uuid primary key default gen_random_uuid(),
  league_slug   text not null,
  -- The published artifact. render_job_id is our id; platform_video_id is
  -- theirs (a YouTube id), and the statement will arrive keyed by THEIRS.
  render_job_id uuid references public.render_jobs(id) on delete set null,
  platform      text not null default 'youtube',
  platform_video_id text not null default '',

  kind          text not null check (kind in ('clip','music','voice')),
  -- Exactly one of these is set, per `kind`.
  clip_record_id uuid references public.clip_records(id) on delete set null,
  music_work_id  uuid references public.music_works(id) on delete set null,
  voice_work_id  uuid references public.voice_works(id) on delete set null,

  -- How much of the finished video this contribution accounts for. Seconds is
  -- the honest unit for video (a 20s clip in a 45s reel), and it is what a
  -- per-use split should be computed from rather than a stored percentage that
  -- silently goes stale when the cut changes.
  seconds_used  numeric(8,3),
  created_at    timestamptz not null default now()
);
create index if not exists production_credits_video_idx
  on public.production_credits(platform, platform_video_id);
create index if not exists production_credits_job_idx
  on public.production_credits(render_job_id);
create index if not exists production_credits_music_idx
  on public.production_credits(music_work_id) where music_work_id is not null;

-- ───────────────────────────────────────────────────────────────────────────
--  WHERE ROYALTY COLLECTION ATTACHES LATER  (deliberately NOT built)
-- ───────────────────────────────────────────────────────────────────────────
-- When a collection integration is signed, it attaches HERE and needs exactly
-- two new tables — a statement header (source, period, currency, gross) and a
-- line per (statement, platform_video_id, amount). Splitting a line is then a
-- join against production_credits + music_splits/video_grants for that video,
-- with no new information required from anywhere else. That is the entire
-- reason the credits above are written at render time.
--
-- The reality of those APIs, so the plan is not built on an assumption:
-- most royalty and rights systems (YouTube Content ID, Facebook Rights
-- Manager, TikTok's commercial catalogue, and the PRO/collection societies)
-- are PARTNER-GATED — access is granted under an agreement, not by signing up
-- for an API key. Which ones we can reach is a business-development question
-- to answer before any engineering time is spent here. Do not scope this work
-- against an assumed open API.
