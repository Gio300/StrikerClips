/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared in-memory API harness for tests. Builds a pg-mem Postgres with the
// tables the API touches and returns a live Express app wired to it, so every
// test (unit journeys AND the concurrent chaos sim) exercises the REAL createApp
// authorization + handlers against a real SQL engine — just an ephemeral one.
//
// Extracted verbatim from server/app.test.ts so the two suites can never drift.
import { newDb, DataType } from 'pg-mem'
import { randomUUID } from 'node:crypto'
import { createApp } from './app'
import { PHYSICAL_MERCH_DDL } from './physicalMerchSchema'
import { MEDIA_EVIDENCE_DDL } from './mediaEvidenceSchema'
import { CHAT_FOUNDATION_STATEMENTS } from './chatFoundationSchema'
import { PUSH_SCHEMA_STATEMENTS } from './pushSchema'
import { AUTH_SECURITY_STATEMENTS } from './authSecuritySchema'
import { ORGANIZER_DDL } from './organizerSchema'
import { ONBOARDING_DDL } from './onboardingSchema'
import { CONTENT_REPORTS_DDL } from './contentReportsSchema'

// Build the in-memory database and return a live pg Pool bound to it. Exposed
// so the full-stack E2E server (server/e2eServer.ts) can serve the real built
// frontend against the real createApp handlers with no external Postgres.
export function makeDb() {
  const db = newDb()
  // `impure: true` matters: without it pg-mem treats the generator as pure and
  // caches one uuid, so every inserted row collides on the primary key.
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() })
  db.public.registerFunction({ name: 'uuid_generate_v4', returns: DataType.uuid, impure: true, implementation: () => randomUUID() })
  db.public.none(`
    create table users (
      id uuid primary key default gen_random_uuid(),
      email text unique not null, password_hash text,
      user_metadata jsonb default '{}', stripe_customer_id text,
      created_at timestamptz default now()
    );
    create table stripe_events (
      id text primary key, type text not null default '',
      received_at timestamptz default now()
    );
    create table payments (
      id uuid primary key default gen_random_uuid(), user_id uuid,
      stripe_event_id text, stripe_session_id text, stripe_invoice_id text,
      stripe_subscription_id text, stripe_customer_id text,
      kind text not null default 'subscription', tier text, pack text,
      amount_cents integer not null default 0, currency text not null default 'usd',
      tokens_credited integer not null default 0, sweeps_credited integer not null default 0,
      status text not null default 'paid', created_at timestamptz default now()
    );
    create table creator_stripe_accounts (
      user_id uuid primary key, stripe_account_id text not null,
      charges_enabled boolean not null default false, payouts_enabled boolean not null default false,
      transfers_enabled boolean not null default false,
      tax_certified_at timestamptz, tax_form_type text,
      electronic_1099_consent_at timestamptz, tax_consent_version text,
      platform_fee_debit_consent_at timestamptz, platform_fee_debit_consent_version text,
      onboarded_at timestamptz, updated_at timestamptz, created_at timestamptz default now()
    );
    create table profiles (
      id uuid primary key, username text unique not null,
      avatar_url text, bio text, power_level integer default 0, country text,
      oracle_points integer not null default 0,
      auto_link_mode text not null default 'auto',
      auto_detect_live boolean not null default true,
      auto_merge_opt_out boolean not null default false,
      reel_usage_privacy text not null default 'followers_of_followers'
    );
    create table king_ratings (
      user_id uuid primary key, rating integer not null default 1000,
      matches integer not null default 0, wins integer not null default 0,
      updated_at timestamptz not null default now()
    );
    create table king_matches (
      id uuid primary key default gen_random_uuid(),
      player_a uuid not null, player_b uuid not null,
      proposals_a jsonb default '[]', proposals_b jsonb default '[]',
      agreed_time timestamptz, winner_id uuid,
      report_a_winner_id uuid, report_b_winner_id uuid,
      status text not null default 'proposing',
      created_at timestamptz not null default now()
    );
    create index idx_king_matches_open on king_matches(status);
    create table follows (
      id uuid primary key default gen_random_uuid(),
      follower_id uuid not null, following_id uuid not null,
      created_at timestamptz default now(), unique(follower_id, following_id)
    );
    create table posts (
      id uuid primary key default gen_random_uuid(), user_id uuid not null,
      body text not null default '', created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table post_attachments (
      id uuid primary key default gen_random_uuid(), post_id uuid not null,
      type text not null, url_or_id text not null, sort_order integer default 0,
      created_at timestamptz default now()
    );
    create table post_comments (
      id uuid primary key default gen_random_uuid(), post_id uuid not null, user_id uuid not null,
      body text not null, created_at timestamptz default now()
    );
    create table post_likes (
      id uuid primary key default gen_random_uuid(), post_id uuid not null, user_id uuid not null,
      created_at timestamptz default now(), unique(post_id, user_id)
    );
    create table dm_conversations (
      id uuid primary key default gen_random_uuid(), name text, pair_key text unique,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table dm_participants (
      id uuid primary key default gen_random_uuid(), conversation_id uuid not null,
      user_id uuid not null, joined_at timestamptz default now(),
      unique(conversation_id, user_id)
    );
    create table dm_messages (
      id uuid primary key default gen_random_uuid(), conversation_id uuid not null,
      user_id uuid not null, content text not null default '',
      created_at timestamptz default now(),
      -- Structural @mentions + reply-to (server/ensureSchema.ts, chat slice).
      mentions jsonb not null default '[]', reply_to uuid
    );
    create index idx_dm_messages_conversation on dm_messages(conversation_id, created_at);
    create index idx_dm_participants_user on dm_participants(user_id);
    create table blocks (
      id uuid primary key default gen_random_uuid(),
      blocker_id uuid not null, blocked_id uuid not null,
      hide_in_shared_lives boolean not null default false,
      created_at timestamptz default now()
    );
    create table clips (
      id uuid primary key default gen_random_uuid(), user_id uuid,
      source_type text, url_or_path text, title text, category text,
      subject_profile_id uuid, youtube_video_id text, start_sec integer,
      created_at timestamptz default now()
    );
    create table notifications (
      id uuid primary key default gen_random_uuid(), user_id uuid not null,
      kind text not null default 'generic', title text not null, body text, link text,
      related_id uuid, actor_id uuid, read_at timestamptz, created_at timestamptz default now()
    );
    create table redeem_codes (
      code text primary key, tier text not null default 'pro', months integer not null default 1,
      max_uses integer not null default 1, uses integer not null default 0,
      active boolean not null default true, note text, expires_at timestamptz, created_at timestamptz default now()
    );
    create table code_redemptions (
      id uuid primary key default gen_random_uuid(), code text not null, user_id uuid not null,
      tier_granted text not null, grant_expires_at timestamptz not null, redeemed_at timestamptz not null default now()
    );
    create table redeemed_codes (
      code text primary key, redeemed_by uuid not null,
      redeemed_at timestamptz not null default now()
    );
    create table servers (
      id uuid primary key default gen_random_uuid(), name text not null, owner_id uuid,
      kind text not null default 'open', treasury_tokens integer not null default 0,
      join_fee_tokens integer not null default 0, dues_tokens integer not null default 0,
      max_members integer not null default 100,
      is_recruiting boolean not null default false,
      total_points integer default 0,
      -- Production has this (db/schema.sql:142, plus the idempotent
      -- add-column-if-not-exists at :1502). It was missing here, so a clan's
      -- TAG was untestable -- which matters now that the render roster reads it
      -- to stop Coach Dee inventing clan names.
      clan_tag text,
      created_at timestamptz default now()
    );
    create table clan_dues_payments (
      id uuid primary key default gen_random_uuid(), server_id uuid not null, user_id uuid not null,
      kind text not null default 'join', gross_tokens integer not null,
      clan_tokens integer not null, platform_tokens integer not null,
      created_at timestamptz default now()
    );
    create table server_members (
      id uuid primary key default gen_random_uuid(), server_id uuid not null, user_id uuid not null,
      role text default 'member', created_at timestamptz default now()
    );
    create table clan_members (
      id uuid primary key default gen_random_uuid(), server_id uuid not null, user_id uuid not null,
      role text not null default 'member', joined_at timestamptz default now()
    );
    -- Legacy clan boards remain part of the real player journey. Keep these in
    -- the full-stack harness so creating a clan can prove that its default
    -- #general channel exists instead of silently exercising a missing table.
    create table channels (
      id uuid primary key default gen_random_uuid(), server_id uuid not null,
      name text not null, type text default 'text', created_at timestamptz default now(),
      unique(server_id, name)
    );
    create table messages (
      id uuid primary key default gen_random_uuid(), channel_id uuid not null,
      user_id uuid not null, content text not null default '', clip_id uuid,
      created_at timestamptz default now()
    );
    create table leagues (
      id uuid primary key default gen_random_uuid(),
      slug text unique not null, name text not null, domain text,
      colors jsonb not null default '{}', logo_url text, tagline text,
      music jsonb not null default '{}',
      video_ownership text not null default 'tko',
      tier text not null default 'starter', owner_id uuid,
      -- League URL identity, rung 3 (src/lib/leagueUrls.ts, LEAGUE_URL_DDL in
      -- server/leagueUrl.ts). The domain column above stays the DISPLAY value;
      -- these are the claimed SERVING domain and its TXT ownership challenge.
      custom_domain text unique, custom_domain_token text,
      custom_domain_status text not null default 'none',
      custom_domain_verified_at timestamptz,
      -- LEAGUE BILLING: tier says WHICH plan, plan_status says whether it was
      -- PAID for. Both are webhook-only (PRIVILEGE_COLS in server/app.ts).
      plan_status text not null default 'none',
      plan_since timestamptz, plan_expires_at timestamptz,
      stripe_subscription_id text, stripe_customer_id text,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table league_plan_purchases (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null, league_id uuid,
      league_slug text not null, league_name text not null default '',
      plan text not null, status text not null default 'pending',
      stripe_checkout_session_id text unique, stripe_subscription_id text,
      stripe_customer_id text,
      amount_cents integer not null default 0, currency text not null default 'usd',
      paid_at timestamptz,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table league_leads (
      id uuid primary key default gen_random_uuid(),
      email text not null, plan text not null,
      league_name text not null default '', league_slug text not null default '',
      user_id uuid, note text,
      source text not null default 'enterprise',
      status text not null default 'new',
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table league_members (
      id uuid primary key default gen_random_uuid(),
      league_id uuid not null, user_id uuid not null,
      role text not null default 'member', joined_at timestamptz default now(),
      unique(league_id, user_id)
    );
    create table tournaments (
      id uuid primary key default gen_random_uuid(), name text not null, created_by uuid,
      description text, rules text,
      format text not null default 'standard', status text not null default 'open',
      league_slug text not null default 'tko',
      start_at timestamptz, end_at timestamptz,
      created_at timestamptz default now()
    );
    create table tournament_admins (
      id uuid primary key default gen_random_uuid(), tournament_id uuid not null, user_id uuid not null,
      created_at timestamptz default now()
    );
    create table tournament_entrants (
      id uuid primary key default gen_random_uuid(), tournament_id uuid not null, user_id uuid not null,
      team_name text, team_server_id uuid, status text not null default 'pending',
      agreed_to_rules_at timestamptz, invited_by uuid, created_at timestamptz default now()
    );
    create table stat_check_submissions (
      id uuid primary key default gen_random_uuid(), user_id uuid not null,
      video_url text not null, character_name text, description text,
      status text not null default 'pending',
      tournament_id uuid, invited_admin_id uuid,
      reviewed_by uuid, reviewed_at timestamptz, review_notes text,
      creator_decision text, creator_notes text, creator_decided_at timestamptz,
      created_at timestamptz default now()
    );
    create table tournament_registrations (
      id uuid primary key default gen_random_uuid(), tournament_id uuid not null, user_id uuid not null,
      streamed boolean not null default false, no_mod_ack boolean not null default false,
      membership_granted boolean not null default false, registered_at timestamptz default now()
    );
    create table tournament_battles (
      id uuid primary key default gen_random_uuid(), tournament_id uuid not null,
      player_a uuid not null, player_b uuid, scheduled_at timestamptz,
      status text not null default 'scheduled', winner uuid, round integer, bracket_slot integer,
      media jsonb,
      decided_at timestamptz, media_updated_at timestamptz,
      created_at timestamptz default now()
    );
    create unique index uq_tournament_battle_bracket_slot
      on tournament_battles(tournament_id, round, bracket_slot);
    create table battle_meetups (
      id uuid primary key default gen_random_uuid(), battle_id uuid not null, user_id uuid not null,
      in_game_name text, platform text, lobby text, notes text, created_at timestamptz default now()
    );
    create table shinobi_defeats (
      id uuid primary key default gen_random_uuid(), user_id uuid not null, opponent_id uuid not null,
      beat_count integer not null default 1, updated_at timestamptz,
      created_at timestamptz default now()
    );
    create table host_commentaries (
      id uuid primary key default gen_random_uuid(), host_id uuid not null,
      match_id uuid, reel_id uuid,
      mode text not null default 'past', capture_source text not null default 'camera',
      title text, commentary_url text, status text not null default 'ready',
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table tournament_results (
      id uuid primary key default gen_random_uuid(), tournament_id uuid not null,
      winner_profile_id uuid not null, team_name text, submitted_by uuid,
      created_at timestamptz default now()
    );
    create table artifacts (
      id uuid primary key default gen_random_uuid(), owner_id uuid not null,
      slug text not null, name text not null, rarity text not null default 'common',
      capability text not null default 'none', code text unique, image_url text,
      price_cents integer, redeemed_by uuid, redeemed_at timestamptz,
      recipe_code text, forge_tier text, power_payload jsonb not null default '[]',
      power_score integer not null default 0, slot_cost integer not null default 0,
      official_override boolean not null default false, clan_id uuid,
      -- Provenance of the artifact. Only 'forge' (paid-to-create) and 'purchase'
      -- are BETTABLE in the Oracle economy; 'free'/'seed'/'reward'/'prize' are
      -- earned/granted items and are NEVER stakeable (Oracle Rule 3). Defaults to
      -- 'forge' so existing forged (Legend monthly) artifacts stay bettable.
      origin text not null default 'forge',
      -- Unified-forge paid extras (src/lib/forgeTiers.ts): creator-authored
      -- powers (Pro+) and the bundled shirt reference (Legend). Written only by
      -- /api/fn/forge-artifact-save; PRIVILEGE_COLS on the generic data API.
      powers jsonb not null default '[]', shirt_ref text,
      used_at timestamptz, created_at timestamptz default now()
    );
    create table territories (
      id uuid primary key default gen_random_uuid(), name text not null,
      col integer not null, row integer not null, owner_clan_id uuid,
      captured_at timestamptz, protected_until timestamptz,
      protected_by_artifact_id uuid, created_at timestamptz default now(),
      unique(col, row)
    );
    create table clan_battles (
      id uuid primary key default gen_random_uuid(), winner_clan_id uuid,
      loser_clan_id uuid, match_key text, territory_id uuid,
      created_at timestamptz default now()
    );
    create table conquest_artifact_activations (
      id uuid primary key default gen_random_uuid(), artifact_id uuid not null unique,
      user_id uuid not null, clan_id uuid not null, recipe_code text not null,
      effects jsonb not null default '[]', slot_cost integer not null default 0,
      official_override boolean not null default false, target_territory_id uuid,
      status text not null default 'active', activated_at timestamptz default now(),
      expires_at timestamptz
    );
    create table clan_conquest_state (
      clan_id uuid primary key, rivalry_reset_at timestamptz,
      reset_count integer not null default 0, updated_at timestamptz default now()
    );
    create table clan_basic_pass_pools (
      id uuid primary key default gen_random_uuid(), clan_id uuid not null,
      source_artifact_id uuid not null unique, total_count integer not null,
      remaining_count integer not null, duration_days integer not null default 30,
      created_at timestamptz default now()
    );
    create table clan_basic_pass_entitlements (
      id uuid primary key default gen_random_uuid(), source_pool_id uuid not null,
      clan_id uuid not null, user_id uuid not null, starts_at timestamptz default now(),
      expires_at timestamptz not null, created_at timestamptz default now(),
      unique(source_pool_id, user_id)
    );
    create table tournament_prize_pools (
      id uuid primary key default gen_random_uuid(), tournament_id uuid not null,
      currency text not null, entry_amount integer not null,
      paid_places integer not null default 3, prize_split_bps jsonb not null default '[7000,2000,1000]',
      status text not null default 'open', provider text not null default 'internal_sweeps',
      compliance_approved boolean not null default false, minimum_age integer not null default 18,
      allowed_regions jsonb not null default '[]', created_by uuid not null,
      created_at timestamptz default now(), updated_at timestamptz default now(),
      locked_at timestamptz, settled_at timestamptz, cancelled_at timestamptz
    );
    create table tournament_prize_entries (
      id uuid primary key default gen_random_uuid(), pool_id uuid not null, user_id uuid not null,
      amount integer not null, status text not null default 'pending',
      provider_payment_id text, entered_at timestamptz default now(), updated_at timestamptz default now(),
      unique(pool_id, user_id)
    );
    create table tournament_prize_payouts (
      id uuid primary key default gen_random_uuid(), pool_id uuid not null, user_id uuid not null,
      placement integer not null, gross_amount integer not null, net_amount integer not null,
      provider_payout_id text, status text not null default 'paid',
      created_at timestamptz default now(), paid_at timestamptz,
      unique(pool_id, placement), unique(pool_id, user_id)
    );
    create table assets (
      id text primary key, name text not null, team_name text not null default '',
      image_url text not null default '', price_tokens integer not null default 0,
      kind text not null default 'jersey', created_by uuid, origin text not null default 'user',
      seller_type text not null default 'creator', clan_id uuid, price_cents integer,
      cash_enabled boolean not null default false,
      paid_sweeps_enabled boolean not null default false,
      created_at timestamptz default now()
    );
    create table asset_ownership (
      id uuid primary key default gen_random_uuid(), user_id uuid not null, asset_id text not null,
      source text not null default 'purchase', ref_id text, acquired_at timestamptz default now(),
      unique(user_id, asset_id)
    );
    create table wallets (
      user_id uuid primary key, tokens integer not null default 0, sweeps integer not null default 0,
      paid_sweeps_cents integer not null default 0,
      -- ORACLE-USE-ONLY tickets. The repurposed daily free grant credits these
      -- (default 3/day). They are BETTABLE in the Oracle economy but contribute
      -- $0 to any streamer payout — they are NEVER part of the money ($) flow.
      oracle_tickets integer not null default 0,
      daily_sweeps_claimed_on date,
      updated_at timestamptz, created_at timestamptz default now()
    );
    create table wallet_ledger (
      id uuid primary key default gen_random_uuid(), user_id uuid not null,
      kind text not null default 'adjustment', tokens_delta integer not null default 0,
      sweeps_delta integer not null default 0, paid_sweeps_delta_cents integer not null default 0,
      event text, result text, prize text,
      status text not null default 'Paid', reason text, ref_id text,
      created_at timestamptz default now()
    );
    create table creator_offers (
      id uuid primary key default gen_random_uuid(), seller_user_id uuid not null,
      seller_type text not null default 'creator', clan_id uuid, offer_type text not null,
      name text not null, description text not null default '', image_url text,
      price_cents integer not null, billing_interval text not null default 'month',
      cash_enabled boolean not null default true, paid_sweeps_enabled boolean not null default true,
      giftable boolean not null default true, active boolean not null default true,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table creator_orders (
      id uuid primary key default gen_random_uuid(), buyer_id uuid not null, recipient_id uuid,
      seller_user_id uuid not null, seller_type text not null, clan_id uuid,
      asset_id text, offer_id uuid, payment_method text not null,
      list_price_cents integer not null, buyer_charge_cents integer not null,
      discount_cents integer not null default 0, seller_share_cents integer not null,
      seller_tier text not null default 'pro', seller_share_percent integer not null default 50,
      platform_share_cents integer not null, currency text not null default 'usd',
      status text not null default 'pending', stripe_checkout_session_id text,
      stripe_payment_intent_id text, stripe_subscription_id text, stripe_transfer_id text,
      idempotency_key text not null unique, created_at timestamptz default now(),
      paid_at timestamptz, updated_at timestamptz default now()
    );
    create table creator_earnings (
      id uuid primary key default gen_random_uuid(), order_id uuid not null unique,
      seller_user_id uuid not null, amount_cents integer not null,
      status text not null default 'pending', stripe_transfer_id text,
      created_at timestamptz default now(), available_at timestamptz,
      transferred_at timestamptz, updated_at timestamptz default now()
    );
    create table creator_included_passes (
      id uuid primary key default gen_random_uuid(), member_user_id uuid not null,
      offer_id uuid not null, seller_user_id uuid not null, membership_tier text not null,
      cycle_key text not null, status text not null default 'active',
      starts_at timestamptz default now(), expires_at timestamptz not null,
      created_at timestamptz default now(), updated_at timestamptz default now(),
      unique(member_user_id, cycle_key)
    );
    create table creator_platform_fees (
      id uuid primary key default gen_random_uuid(), seller_user_id uuid not null,
      fee_type text not null, period_key text not null, source_ref text,
      total_fee_cents integer not null, seller_fee_cents integer not null,
      platform_fee_cents integer not null, included_pass_id uuid,
      status text not null default 'pending', stripe_payment_id text, error text,
      created_at timestamptz default now(), updated_at timestamptz default now(),
      unique(seller_user_id, fee_type, period_key)
    );
    create table creator_entitlements (
      id uuid primary key default gen_random_uuid(), order_id uuid, included_pass_id uuid,
      user_id uuid not null, offer_id uuid not null, status text not null default 'active',
      stripe_subscription_id text, starts_at timestamptz default now(), expires_at timestamptz,
      created_at timestamptz default now(), updated_at timestamptz default now(),
      unique(order_id, user_id)
    );
    create table paid_sweeps_purchases (
      id uuid primary key default gen_random_uuid(), user_id uuid not null,
      amount_cents integer not null, status text not null default 'pending',
      stripe_checkout_session_id text, stripe_payment_intent_id text,
      idempotency_key text not null unique, created_at timestamptz default now(),
      paid_at timestamptz, updated_at timestamptz default now()
    );
    create table predictions (
      id uuid primary key default gen_random_uuid(), user_id uuid not null, tournament_id uuid not null,
      winner_id text not null, pick_label text not null default '', status text not null default 'open',
      reward_asset_id text, resolved_at timestamptz, created_at timestamptz default now()
    );
    insert into assets (id, name, team_name, price_tokens, kind, origin) values
      ('seed-akatsuki-jersey','Akatsuki Home Jersey','Akatsuki',250,'jersey','seed'),
      ('oracle-reward-crystal-emote','Crystal Ball Emote','Oracle',0,'emote','reward');
    create table chat_spaces (
      id uuid primary key default gen_random_uuid(), kind text not null default 'open',
      name text not null, owner_id uuid, clan_id uuid, created_at timestamptz default now()
    );
    create table chat_channels (
      id uuid primary key default gen_random_uuid(), space_id uuid not null, name text not null,
      category text, position integer not null default 0,
      is_announcement boolean not null default false, created_at timestamptz default now()
    );
    create table chat_messages (
      id uuid primary key default gen_random_uuid(), channel_id uuid not null, user_id uuid,
      body text not null default '', created_at timestamptz default now(),
      mentions jsonb not null default '[]', reply_to uuid
    );
    create table reels (
      id uuid primary key default gen_random_uuid(), user_id uuid not null,
      title text not null default '', clip_ids uuid[] default '{}',
      combined_video_url text, thumbnail text,
      -- Front-page visibility + factory provenance (db/schema.sql, and the boot
      -- DDL in server/index.ts). promoted defaults TRUE so an ordinary reel is
      -- unaffected; the video factory writes false for free-member weeklies.
      promoted boolean not null default true, league_slug text,
      created_at timestamptz default now()
    );
    create table reel_participants (
      id uuid primary key default gen_random_uuid(), reel_id uuid not null,
      user_id uuid not null, clip_id uuid, created_at timestamptz default now()
    );
    create table live_streams (
      id uuid primary key default gen_random_uuid(), user_id uuid not null,
      youtube_url text not null, title text, is_live boolean default true,
      placement text not null default 'profile',
      game text default 'Shinobi Striker',
      chat_enabled boolean not null default true,
      is_paid boolean not null default false,
      price_cents integer,
      tournament_id uuid,
      show_bracket boolean not null default false,
      host_share text not null default 'both',
      background_url text,
      team_a text,
      team_b text,
      score_a integer not null default 0,
      score_b integer not null default 0,
      score_revision integer not null default 0,
      layout text not null default 'auto',
      host_feed_status text not null default 'live',
      source text not null default 'manual',
      external_stream_id text,
      detected_live_at timestamptz,
      host_action_level integer,
      host_action_at timestamptz,
      host_fight_detected boolean not null default false,
      host_fight_mode text,
      host_fight_at timestamptz,
      host_view jsonb,
      updated_at timestamptz default now(), created_at timestamptz default now()
    );
    create table auto_live_discoveries (
      id uuid primary key default gen_random_uuid(), user_id uuid not null,
      provider text not null default 'youtube', external_stream_id text not null,
      channel_url text not null, watch_url text not null, title text,
      status text not null default 'live', detection_method text not null,
      confidence real not null default 0, live_stream_id uuid,
      first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
      ended_at timestamptz, details jsonb not null default '{}',
      unique(user_id, provider, external_stream_id)
    );
    create table shadow_match_analyses (
      id uuid primary key default gen_random_uuid(), source_fingerprint text not null unique,
      source_kind text not null default 'footage_group', source_ref text,
      status text not null default 'queued', match_signature text,
      game text not null default 'shinobi_striker', mode text,
      verdict jsonb not null default '{}', confidence real not null default 0,
      evidence_quality real not null default 0, analyzer text not null default 'local',
      model text, analyzer_version text, evidence jsonb not null default '[]',
      analysis jsonb not null default '{}', error text,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      completed_at timestamptz
    );
    create table shadow_match_participants (
      id uuid primary key default gen_random_uuid(), analysis_id uuid not null,
      profile_id uuid, detected_name text not null, team text,
      outcome text not null default 'unknown', kills integer, deaths integer, assists integer,
      confidence real not null default 0, evidence jsonb not null default '{}',
      unique(analysis_id, detected_name)
    );
    create table live_stream_angles (
      id uuid primary key default gen_random_uuid(),
      live_stream_id uuid not null, user_id uuid,
      label text, youtube_url text,
      status text not null default 'live',
      action_level integer,
      action_at timestamptz,
      fight_detected boolean not null default false,
      fight_mode text,
      fight_at timestamptz,
      created_at timestamptz default now()
    );
    create table live_director_state (
      live_stream_id uuid primary key,
      mode text not null default 'auto',
      angle_ids jsonb not null default '[]',
      last_action text not null default 'status',
      last_payload jsonb not null default '{}',
      revision bigint not null default 0,
      updated_at timestamptz not null default now()
    );
    create table live_stream_invites (
      id uuid primary key default gen_random_uuid(),
      live_stream_id uuid not null,
      inviter_id uuid not null, invitee_id uuid not null,
      role text, status text not null default 'pending',
      created_at timestamptz default now(),
      unique (live_stream_id, invitee_id)
    );
    create table stream_messages (
      id uuid primary key default gen_random_uuid(),
      stream_id uuid not null,
      user_id uuid,
      content text not null,
      created_at timestamptz default now(),
      mentions jsonb not null default '[]', reply_to uuid
    );
    create table live_groups (
      id uuid primary key default gen_random_uuid(), name text not null, creator_id uuid,
      link_reason text, battle_id uuid, tournament_id uuid, clan_id uuid,
      confidence real, notified_at timestamptz,
      started_at timestamptz default now(), ended_at timestamptz,
      created_at timestamptz default now()
    );
    create table live_group_members (
      id uuid primary key default gen_random_uuid(), group_id uuid not null,
      user_id uuid not null, stream_id uuid, accepted boolean default false
    );
    create table live_sessions (
      id uuid primary key default gen_random_uuid(), host_id uuid not null,
      kind text not null default 'host', title text, status text not null default 'live',
      match_id uuid, reel_id uuid, battle_id uuid, tournament_id uuid,
      watch_url text, youtube_id text,
      started_at timestamptz default now(), ended_at timestamptz,
      created_at timestamptz default now()
    );
    create table live_group_sessions (
      id uuid primary key default gen_random_uuid(), group_id uuid not null,
      creator_id uuid, stream_ids jsonb not null default '[]'::jsonb,
      user_ids jsonb not null default '[]'::jsonb, link_reason text,
      battle_id uuid, tournament_id uuid,
      started_at timestamptz not null default now(), ended_at timestamptz not null default now(),
      duration_ms bigint not null default 0, assembled_reel_id uuid,
      created_at timestamptz default now()
    );
    -- ---- auto-match: grouping + render queue ----
    create table match_groups (
      id uuid primary key default gen_random_uuid(),
      signature text not null default '', sig_hash text not null default '' unique,
      participants text[] default '{}', outcome text, score_line text, mode text, map text,
      confidence numeric, time_window_start timestamptz, time_window_end timestamptz,
      game text not null default 'shinobi_striker', created_at timestamptz default now()
    );
    create table clip_records (
      id uuid primary key default gen_random_uuid(),
      clip_id uuid, player_id uuid, player_handle text,
      lobby_id text, participants text[] default '{}',
      category text, outcome text,
      kills integer, deaths integer, assists integer, score_line text, map text, mode text,
      youtube_id text, composite_youtube_id text, duration_sec integer, recorded_at timestamptz, ocr_confidence numeric,
      match_id uuid, created_at timestamptz default now()
    );
    create table render_jobs (
      id uuid primary key default gen_random_uuid(),
      match_id uuid, match_key text unique,
      status text not null default 'pending',
      clip_ids uuid[] default '{}', participant_ids uuid[] default '{}',
      youtube_id text, combined_video_url text, error text,
      attempts integer not null default 0,
      ready_at timestamptz not null default now(),
      rerender_requested boolean not null default false,
      created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table match_versions (
      id uuid primary key default gen_random_uuid(),
      match_key text not null, version integer not null default 1,
      youtube_id text, angle_count integer not null default 2,
      participant_ids uuid[] not null default '{}', clip_ids uuid[] not null default '{}',
      source_angles jsonb not null default '[]'::jsonb,
      reason text not null default 'render', created_at timestamptz default now(),
      unique(match_key, version)
    );
    create table match_angles (
      id uuid primary key default gen_random_uuid(),
      match_key text not null, user_id uuid not null, youtube_video_id text not null,
      clip_record_id uuid, joined_at timestamptz default now(),
      included_in_version integer, status text not null default 'active',
      removed_at timestamptz, removal_reason text,
      unique(match_key, user_id)
    );
    -- Connected-YouTube links. A row here means "YouTube connected", one of the
    -- two conditions the auto-merge entitlement gate checks (server/app.ts
    -- isAutoMergeEntitled).
    create table user_youtube_links (
      id uuid primary key default gen_random_uuid(), user_id uuid not null,
      url text not null, title text, created_at timestamptz default now(),
      -- Persisted UC… channel-id cache (server/youtubeChannel.ts) so the
      -- scanners resolve a @handle once instead of every cycle.
      channel_id text
    );
    -- ---- artifact tags (a clan tag a user EQUIPS to show off everywhere) ----
    create table artifact_tags (
      id uuid primary key default gen_random_uuid(),
      clan_id uuid not null, creator_id uuid not null,
      tag_text text not null, price integer not null default 0,
      rarity text not null default 'common', created_at timestamptz not null default now()
    );
    create table user_artifact_tags (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null, artifact_tag_id uuid not null,
      granted_at timestamptz not null default now(), unique (user_id, artifact_tag_id)
    );
    create table user_equipped_tag (
      user_id uuid primary key, artifact_tag_id uuid not null,
      equipped_at timestamptz not null default now()
    );
    -- ---- Oracle voting (a 30s in-match outcome vote worth +10 power) ----
    create table oracle_votes (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null, match_ref text not null, choice text not null,
      correct boolean, resolved_at timestamptz,
      created_at timestamptz not null default now(), unique (user_id, match_ref)
    );
    -- ---- CHAT FOUNDATION ----
    -- NOT declared here. tournament_messages, chat_reactions, the mentions /
    -- reply_to columns, the created_at NOT NULL constraint and the
    -- (room, created_at) composites are applied below by the REAL migration
    -- (server/chatFoundationSchema.ts), so a broken migration fails a test
    -- instead of surfacing in production. See the loop at the end of makeDb.
    -- ---- TKO-BETA tester chat membership ----
    create table chat_space_members (
      id uuid primary key default gen_random_uuid(),
      space_id uuid not null, user_id uuid not null,
      joined_at timestamptz not null default now(), unique (space_id, user_id)
    );
    -- ---- WAGERING (sweeps-only, in-app prediction pools) ----
    create table wager_pools (
      id uuid primary key default gen_random_uuid(),
      match_ref text not null, title text not null default '',
      options jsonb not null default '[]', status text not null default 'open',
      winning_option text, created_by uuid,
      created_at timestamptz not null default now(), resolved_at timestamptz
    );
    create table wagers (
      id uuid primary key default gen_random_uuid(),
      pool_id uuid not null, user_id uuid not null,
      option text not null, sweeps integer not null,
      status text not null default 'active', payout integer not null default 0,
      created_at timestamptz not null default now(), unique (pool_id, user_id)
    );
    create table creator_goals (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null, kind text not null default 'custom',
      label text not null default '', target integer not null default 0,
      active boolean not null default true, created_at timestamptz default now()
    );
    -- ---- ORACLE BETTING ECONOMY (live-only, host-tier-only, money-safe) ----
    -- A bet stakes ONE of: oracle tickets (stake_cents=0, no $), PAID sweeps
    -- (stake_cents = the real-cent value, the ONLY thing that drives the streamer
    -- share), or a FORGED/PURCHASED artifact (stake_cents=0). One bet per game.
    create table oracle_bets (
      id uuid primary key default gen_random_uuid(),
      match_ref text not null, stream_id uuid,
      user_id uuid not null, choice text not null,
      stake_kind text not null,            -- 'ticket' | 'sweeps' | 'artifact'
      stake_amount integer not null default 0,
      stake_cents integer not null default 0,
      artifact_id uuid,
      status text not null default 'active',  -- active | won | lost | refunded
      payout integer not null default 0,
      payout_cents integer not null default 0,
      created_at timestamptz not null default now(),
      unique (match_ref, user_id)
    );
    create table oracle_live_rounds (
      id uuid primary key default gen_random_uuid(),
      stream_id uuid not null,
      match_ref text not null unique,
      status text not null default 'open',
      choices jsonb not null default '[]',
      opened_by uuid not null,
      opened_at timestamptz not null default now(),
      locks_at timestamptz not null,
      winning_choice text,
      losing_choice text,
      resolved_at timestamptz,
      updated_at timestamptz not null default now()
    );
    create index oracle_live_rounds_stream_idx on oracle_live_rounds(stream_id, opened_at);
    -- Per-stream minimum bet the streamer/organizer sets in their control room.
    create table oracle_stream_config (
      stream_id uuid primary key,
      min_bet integer not null default 1,
      min_stake_kind text not null default 'ticket',
      updated_at timestamptz default now()
    );
    -- Per-stream running tally that ENFORCES the profit cap: cumulative streamer
    -- payout can never exceed 25% of the real sweeps-cents ever bet on the stream.
    create table oracle_stream_tally (
      stream_id uuid primary key,
      sweeps_cents_in integer not null default 0,
      streamer_cents_paid integer not null default 0,
      updated_at timestamptz default now()
    );
    -- One settlement row per resolved match — the idempotent claim for resolve.
    create table oracle_bet_settlements (
      match_ref text primary key,
      stream_id uuid, winning_choice text,
      sweeps_cents_in integer not null default 0,
      streamer_cents_paid integer not null default 0,
      resolved_at timestamptz not null default now()
    );
    insert into redeem_codes (code, tier, months, max_uses) values ('KILLCAM-TEST-CODE','pro',1,1);
  `)
  db.public.none(PHYSICAL_MERCH_DDL)
  db.public.none(MEDIA_EVIDENCE_DDL)
  db.public.none(ORGANIZER_DDL)
  db.public.none(ONBOARDING_DDL)
  db.public.none(CONTENT_REPORTS_DDL)
  // THE REAL CHAT MIGRATION, RUN FOR REAL. Every statement server/ensureSchema.ts
  // applies at boot is applied here too, in the same order, against the same
  // tables — so a statement that cannot execute (a typo, a stray control
  // character, a clause the database refuses) fails a TEST rather than being
  // discovered in production by a chat room that quietly stopped moving.
  //
  // Note the tables above deliberately already carry `mentions`, `reply_to` and
  // the dm composite index: that makes this run the SECOND-run, already-migrated
  // path, which is the one that executes on every boot forever after.
  //
  // Unlike the boot path this THROWS. At boot a refused statement is a degraded
  // feature; in a test it is a defect, and it names itself.
  //
  // Applied as ONE batch on the happy path — makeDb runs in a beforeEach across
  // the whole server suite, and thirty separate round trips per test is a cost
  // the suite feels. A failure replays them one at a time to name the culprit,
  // which is the only moment precision is worth anything.
  //
  // INDEX CREATION IS THE ONE THING LEFT OUT, and only here. pg-mem maintains an
  // index on every insert, and four more composites on the message tables turn
  // the concurrency simulation (server/chaos.test.ts) from ~18s of work into
  // ~60s — a self-inflicted timeout, in a function that runs in a beforeEach for
  // the entire server suite. Those statements are still EXECUTED in test:
  // server/chatFoundationSchema.test.ts applies every statement in the list,
  // indexes included, against a database this function built. What the rest of
  // the suite needs from the migration is the SHAPE — tables, columns,
  // constraints — and that is applied here in full.
  const shape = CHAT_FOUNDATION_STATEMENTS.filter((st) => !/^create index/i.test(st.sql) && process.env.SKIP_CHAT_DDL !== '1')
  try {
    db.public.none(shape.map((statement) => statement.sql).join(';\n'))
  } catch {
    for (const statement of shape) {
      try {
        db.public.none(statement.sql)
      } catch (error: any) {
        throw new Error(
          `[testHarness] chat foundation statement "${statement.name}" failed: ${error?.message || error}`,
        )
      }
    }
  }
  // THE PUSH MIGRATION, RUN FOR REAL, for the same reason as the chat one above:
  // a statement that cannot execute should fail a TEST, not be discovered in
  // production by a phone that never buzzes. Same index caveat, same treatment —
  // the shape is what the suite needs; server/pushSchema.test.ts applies every
  // statement including the index against a database this function built.
  const pushShape = PUSH_SCHEMA_STATEMENTS.filter((st) => !/^create index/i.test(st.sql))
  for (const statement of pushShape) {
    try {
      db.public.none(statement.sql)
    } catch (error: any) {
      throw new Error(
        `[testHarness] push schema statement "${statement.name}" failed: ${error?.message || error}`,
      )
    }
  }
  for (const statement of AUTH_SECURITY_STATEMENTS) {
    try {
      db.public.none(statement.sql)
    } catch (error: any) {
      throw new Error(
        `[testHarness] auth security statement "${statement.name}" failed: ${error?.message || error}`,
      )
    }
  }
  const pg = (db.adapters as any).createPg()
  return new pg.Pool()
}

export function makeApp() {
  return createApp(makeDb())
}

/**
 * Make a user AUTO-MERGE ENTITLED for tests: grant an active paid CONTENT tier
 * (default 'pro') on their user_metadata AND insert a user_youtube_links row.
 * These are exactly the two conditions the server gate in the auto-match
 * handler enforces (paid content tier + YouTube connected), so any test that
 * needs the auto-merge pipeline to RUN should call this for the trigger user.
 * Read-modify-writes the metadata so username / date_of_birth attestations set
 * at signup are preserved.
 */
export async function entitleForAutoMerge(pool: any, userId: string, tier: string = 'pro') {
  const cur = await pool.query('select user_metadata from users where id=$1', [userId])
  const meta = (() => {
    const m = cur.rows[0]?.user_metadata
    return typeof m === 'string' ? (() => { try { return JSON.parse(m) } catch { return {} } })() : (m || {})
  })()
  meta.reelone_tier = tier
  await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), userId])
  // Auto-match tests exercise the open grouping engine, not social privacy.
  // Opt these fixtures into the pre-privacy behavior explicitly.
  await pool.query("update profiles set reel_usage_privacy='anyone' where id=$1", [userId])
  await pool.query('insert into user_youtube_links (user_id, url) values ($1,$2)', [userId, 'https://www.youtube.com/@tester'])
}
