-- 015_artifacts_economy.sql
-- The TKO ARTIFACT ECONOMY: earned/crafted collectibles, referrals that feed
-- the reward tracks, and the anti-abuse ledger for gifted subscriptions.
-- Additive + idempotent. Rules live in src/lib/artifacts.ts.

-- ── artifacts ────────────────────────────────────────────────────────────────
-- One row per artifact a player earned (milestones) or a Legend crafted. A
-- giftable artifact carries a unique `code` + capability; when redeemed we set
-- redeemed_by/redeemed_at so it can only be used once.
create table if not exists public.artifacts (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  slug         text not null,                       -- ArtifactDef.slug
  name         text not null,
  rarity       text not null default 'common',
  capability   text not null default 'none',        -- none | gift_pro_month | profile_flair | clan_tag | event_badge
  code         text unique,                          -- set for shareable/giftable artifacts (TKO-GIFT-XXXXXX)
  image_url    text,
  price_cents  integer,                              -- set when the Legend lists it for sale
  redeemed_by  uuid references auth.users(id) on delete set null,
  redeemed_at  timestamptz,
  recipe_code  text,                                 -- server-owned Conquest recipe id
  forge_tier   text,                                 -- tier held when the server forged it
  power_payload jsonb not null default '[]'::jsonb,  -- server-derived; never client-authored
  power_score  integer not null default 0,
  slot_cost    integer not null default 0,
  official_override boolean not null default false,  -- TKO-host source recipe only
  clan_id      uuid,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);
alter table public.artifacts add column if not exists recipe_code text;
alter table public.artifacts add column if not exists forge_tier text;
alter table public.artifacts add column if not exists power_payload jsonb not null default '[]'::jsonb;
alter table public.artifacts add column if not exists power_score integer not null default 0;
alter table public.artifacts add column if not exists slot_cost integer not null default 0;
alter table public.artifacts add column if not exists official_override boolean not null default false;
alter table public.artifacts add column if not exists clan_id uuid;
alter table public.artifacts add column if not exists used_at timestamptz;
create index if not exists artifacts_owner_idx on public.artifacts(owner_id);
create index if not exists artifacts_code_idx on public.artifacts(code) where code is not null;
create index if not exists artifacts_recipe_idx on public.artifacts(owner_id, recipe_code, created_at);

alter table public.artifacts enable row level security;
do $$ begin
  create policy artifacts_owner_read on public.artifacts
    for select using (auth.uid() = owner_id or auth.uid() = redeemed_by);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy artifacts_owner_write on public.artifacts
    for insert with check (auth.uid() = owner_id);
exception when duplicate_object then null; end $$;

-- ── referrals ────────────────────────────────────────────────────────────────
-- A referred signup credits the referrer. `went_paid` flips when the referred
-- user first buys a paid tier (feeds the paid_referrals reward track).
create table if not exists public.referrals (
  id           uuid primary key default gen_random_uuid(),
  referrer_id  uuid not null references auth.users(id) on delete cascade,
  referred_id  uuid not null references auth.users(id) on delete cascade,
  went_paid    boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (referred_id)                              -- a user is referred at most once
);
create index if not exists referrals_referrer_idx on public.referrals(referrer_id);

alter table public.referrals enable row level security;
do $$ begin
  create policy referrals_referrer_read on public.referrals
    for select using (auth.uid() = referrer_id or auth.uid() = referred_id);
exception when duplicate_object then null; end $$;

-- ── gifted_subs (anti-abuse ledger) ──────────────────────────────────────────
-- Enforces "a giver can gift the same person at most once" — no farming free
-- months to one alt. The (giver_id, recipient_id) unique constraint is the guard;
-- the redeem edge function inserts here inside the same transaction as the grant.
create table if not exists public.gifted_subs (
  id            uuid primary key default gen_random_uuid(),
  giver_id      uuid not null references auth.users(id) on delete cascade,
  recipient_id  uuid not null references auth.users(id) on delete cascade,
  artifact_id   uuid references public.artifacts(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (giver_id, recipient_id)
);
create index if not exists gifted_subs_giver_idx on public.gifted_subs(giver_id);

alter table public.gifted_subs enable row level security;
do $$ begin
  create policy gifted_subs_party_read on public.gifted_subs
    for select using (auth.uid() = giver_id or auth.uid() = recipient_id);
exception when duplicate_object then null; end $$;

-- monthly craft budget for Legends is enforced in the edge function by counting
-- artifacts where owner_id = giver and created_at >= date_trunc('month', now()).
