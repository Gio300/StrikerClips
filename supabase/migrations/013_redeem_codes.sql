-- 013_redeem_codes.sql
-- Comp / promo codes: a user redeems a code to get a full (Pro) month without paying.
-- Redemption runs through the `redeem-code` edge function (service role) so codes
-- are never exposed to the client and grants are tamper-proof.

create table if not exists public.redeem_codes (
  code         text primary key,
  tier         text not null default 'pro' check (tier in ('pro','supporter','creator')),
  months       integer not null default 1,
  max_uses     integer not null default 1,
  uses         integer not null default 0,
  active       boolean not null default true,
  note         text,
  expires_at   timestamptz,            -- code itself stops working after this (optional)
  created_at   timestamptz not null default now()
);

create table if not exists public.code_redemptions (
  id                uuid default uuid_generate_v4() primary key,
  code              text not null references public.redeem_codes(code) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  tier_granted      text not null,
  grant_expires_at  timestamptz not null,
  redeemed_at       timestamptz not null default now(),
  unique (code, user_id)              -- a user can't redeem the same code twice
);

-- Lock the tables down. Only the service-role edge function touches redeem_codes;
-- users may read their own redemption history.
alter table public.redeem_codes    enable row level security;
alter table public.code_redemptions enable row level security;

drop policy if exists "own redemptions viewable" on public.code_redemptions;
create policy "own redemptions viewable" on public.code_redemptions
  for select using (auth.uid() = user_id);
-- (no client insert/update policies: writes happen via service role only)

-- Seed the first dozen full-access passes (1 Pro month each, single use).
insert into public.redeem_codes (code, tier, months, max_uses, note) values
  ('KILLCAM-EHP6-9SX9','pro',1,1,'founder pass'),
  ('KILLCAM-HAK5-M5MG','pro',1,1,'founder pass'),
  ('KILLCAM-77FC-DZJ9','pro',1,1,'founder pass'),
  ('KILLCAM-JFYA-GTJQ','pro',1,1,'founder pass'),
  ('KILLCAM-C8EJ-PE72','pro',1,1,'founder pass'),
  ('KILLCAM-PDT2-UJKV','pro',1,1,'founder pass'),
  ('KILLCAM-66R8-SL8U','pro',1,1,'founder pass'),
  ('KILLCAM-EDAT-NDQE','pro',1,1,'founder pass'),
  ('KILLCAM-H3CF-NYKL','pro',1,1,'founder pass'),
  ('KILLCAM-TLY7-DUZQ','pro',1,1,'founder pass'),
  ('KILLCAM-JDE2-6S6C','pro',1,1,'founder pass'),
  ('KILLCAM-9A3R-RHH2','pro',1,1,'founder pass')
on conflict (code) do nothing;
