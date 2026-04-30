-- Migration 012 — live chat, donations, auto-upload queue, soundboard, CV labels
--
-- One mega-migration so the next "paste this in the Dashboard" block stays a
-- single round-trip. Everything is idempotent.

-- ─────────────────────────────────────────────────────────────────────
-- 1. stream_messages — realtime chat tied to a live_streams row
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.stream_messages (
  id uuid primary key default uuid_generate_v4(),
  stream_id uuid references public.live_streams(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete set null,
  content text not null,
  created_at timestamptz default now()
);

create index if not exists idx_stream_messages_stream
  on public.stream_messages(stream_id, created_at desc);

alter table public.stream_messages enable row level security;

drop policy if exists "Stream messages viewable" on public.stream_messages;
create policy "Stream messages viewable"
  on public.stream_messages for select using (true);

drop policy if exists "Authenticated users post messages" on public.stream_messages;
create policy "Authenticated users post messages"
  on public.stream_messages for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own messages" on public.stream_messages;
create policy "Users delete own messages"
  on public.stream_messages for delete
  using (auth.uid() = user_id);

-- Make this table broadcastable on Supabase Realtime so the app can
-- subscribe to inserts without polling.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'stream_messages'
  ) then
    alter publication supabase_realtime add table public.stream_messages;
  end if;
exception
  when undefined_object then null;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. creator_stripe_accounts — one row per creator that has onboarded
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.creator_stripe_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stripe_account_id text unique,
  charges_enabled boolean default false,
  payouts_enabled boolean default false,
  onboarded_at timestamptz,
  updated_at timestamptz default now()
);

alter table public.creator_stripe_accounts enable row level security;

-- A creator's onboarding state is public-read so a tipper can see whether the
-- creator can actually accept tips.
drop policy if exists "Creator stripe accounts viewable" on public.creator_stripe_accounts;
create policy "Creator stripe accounts viewable"
  on public.creator_stripe_accounts for select using (true);

drop policy if exists "Creator manages own stripe row" on public.creator_stripe_accounts;
create policy "Creator manages own stripe row"
  on public.creator_stripe_accounts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Creator updates own stripe row" on public.creator_stripe_accounts;
create policy "Creator updates own stripe row"
  on public.creator_stripe_accounts for update
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. donations — one row per tip
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.donations (
  id uuid primary key default uuid_generate_v4(),
  donor_id   uuid references public.profiles(id) on delete set null,
  creator_id uuid references public.profiles(id) on delete cascade not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text default 'usd',
  message text,
  -- Stripe ids — null while the donation is local-only or before Stripe is wired up.
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  -- 'pending' (PI created), 'paid' (webhook delivered), 'failed' (declined/canceled).
  status text default 'pending',
  created_at timestamptz default now(),
  paid_at timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'donations_status_check') then
    alter table public.donations
      add constraint donations_status_check
      check (status in ('pending', 'paid', 'failed', 'refunded'));
  end if;
end $$;

create index if not exists idx_donations_creator_paid
  on public.donations(creator_id, paid_at desc);
create index if not exists idx_donations_donor
  on public.donations(donor_id, created_at desc);

alter table public.donations enable row level security;

-- Anyone can read paid donations (public tip feed). Pending / failed only the
-- donor and creator see.
drop policy if exists "Paid donations viewable" on public.donations;
create policy "Paid donations viewable"
  on public.donations for select
  using (
    status = 'paid'
    or auth.uid() = donor_id
    or auth.uid() = creator_id
  );

-- The Edge Function inserts donations server-side; we still allow logged-in
-- users to insert their own pending donation row as a fallback.
drop policy if exists "Donor inserts pending donation" on public.donations;
create policy "Donor inserts pending donation"
  on public.donations for insert
  with check (auth.uid() = donor_id and status = 'pending');

-- ─────────────────────────────────────────────────────────────────────
-- 4. pending_uploads — auto-upload queue for our YouTube channel
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.pending_uploads (
  id uuid primary key default uuid_generate_v4(),
  reel_id uuid references public.reels(id) on delete cascade not null,
  requested_by uuid references public.profiles(id) on delete set null,
  -- queued -> processing -> uploaded | failed
  status text default 'queued',
  youtube_video_id text,
  error text,
  attempts integer default 0,
  queued_at timestamptz default now(),
  uploaded_at timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pending_uploads_status_check') then
    alter table public.pending_uploads
      add constraint pending_uploads_status_check
      check (status in ('queued', 'processing', 'uploaded', 'failed'));
  end if;
end $$;

create index if not exists idx_pending_uploads_status_queued
  on public.pending_uploads(status, queued_at);
create unique index if not exists uq_pending_uploads_reel_open
  on public.pending_uploads(reel_id) where status in ('queued', 'processing');

alter table public.pending_uploads enable row level security;

drop policy if exists "Uploads viewable" on public.pending_uploads;
create policy "Uploads viewable"
  on public.pending_uploads for select using (true);

drop policy if exists "Authenticated queue uploads" on public.pending_uploads;
create policy "Authenticated queue uploads"
  on public.pending_uploads for insert
  with check (auth.uid() is not null);

-- Note: the worker uses the service-role key (bypasses RLS) to update
-- status, so we don't need an UPDATE policy for ordinary users.

-- ─────────────────────────────────────────────────────────────────────
-- 5. soundboard_pads — per-user soundboard
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.soundboard_pads (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  label text not null,
  storage_path text not null,
  hotkey text,
  position integer default 0,
  created_at timestamptz default now()
);

create index if not exists idx_soundboard_pads_user
  on public.soundboard_pads(user_id, position);

alter table public.soundboard_pads enable row level security;

drop policy if exists "Pads viewable to owner" on public.soundboard_pads;
create policy "Pads viewable to owner"
  on public.soundboard_pads for select
  using (auth.uid() = user_id);

drop policy if exists "Owner manages pads" on public.soundboard_pads;
create policy "Owner manages pads"
  on public.soundboard_pads for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- 6. frame_labels — Shinobi Striker (and later other games) event labels
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.frame_labels (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  source_url text not null,
  game text default 'shinobi_striker',
  -- ultimate_used | jutsu_impact | flag_taken | player_killed | teabag | scroll_grabbed
  event_kind text not null,
  t_seconds numeric not null,
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_frame_labels_source on public.frame_labels(source_url);
create index if not exists idx_frame_labels_event  on public.frame_labels(game, event_kind);

alter table public.frame_labels enable row level security;

-- Labels are public read so a future pipeline can pull a community dataset.
drop policy if exists "Frame labels viewable" on public.frame_labels;
create policy "Frame labels viewable"
  on public.frame_labels for select using (true);

drop policy if exists "Users insert own labels" on public.frame_labels;
create policy "Users insert own labels"
  on public.frame_labels for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own labels" on public.frame_labels;
create policy "Users delete own labels"
  on public.frame_labels for delete
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- 7. Extend match_results with parsed OCR fields (idempotent)
-- ─────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'match_results') then
    execute 'alter table public.match_results add column if not exists outcome text';
    execute 'alter table public.match_results add column if not exists kills integer';
    execute 'alter table public.match_results add column if not exists deaths integer';
    execute 'alter table public.match_results add column if not exists ocr_confidence real';
    execute 'alter table public.match_results add column if not exists screenshot_url text';
  end if;
end $$;

-- Ping PostgREST so the schema cache reloads without waiting.
notify pgrst, 'reload schema';
