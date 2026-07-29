/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TKO API — the backend that replaces Supabase in front of the plain SQL
 * database (db/schema.sql). Own auth (bcrypt + JWT HS256), a generic
 * PostgREST-style data API, edge-function shims and storage shims. Written
 * against the `pg` Pool interface so the same app runs on real Postgres in
 * production (Cloud SQL) and an in-memory Postgres (pg-mem) in tests.
 *
 * PROTOCOL: every route lives under /api and is same-origin. A thin frontend
 * shim (src/lib/*) translates the Supabase client calls the app already makes
 * into these endpoints. index.ts adds the static SPA + fallback; createApp
 * here is API-only.
 */
import express, { type Request, type Response, type NextFunction, type Router } from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto'
import { runAutoMatch } from './autoMatch'
import { applyConquestBattle } from './conquestBattle'
import { pairNext, proposeTime, reportResult, ensureRating, openMatchFor } from './kingMatch'
import { creditProduced, type CreditAngle, type OwnerMap } from './creditProduced'
import { MatchConsentError, removeRecordedMatchAngle } from './matchConsent'
import {
  CREATOR_ACTIVE_ACCOUNT_FEE_CENTS,
  CREATOR_PRICE_CENTS,
  creatorSplit,
  hasIncludedCreatorPass,
  isCreatorPriceCents,
  sellerExternalCostAllocation,
  sellerSharePercent,
  type CreatorSellerTier,
} from '../src/lib/creatorCommerce'
import { PRIVACY_VERSION, TERMS_VERSION } from '../src/lib/legalVersions'
import {
  DEFAULT_PRIZE_SPLIT_BPS,
  parsePrizeSplitBps,
  splitPrizePool,
} from '../src/lib/tournamentPrizePools'
import {
  CONQUEST_ARTIFACT_RECIPES,
  CONQUEST_TIER_LIMITS,
  OFFICIAL_CONQUEST_ARTIFACT_RECIPES,
  canActivateConquestArtifact,
  canUseConquestEffects,
  conquestPowerScore,
  conquestRecipe,
  conquestTierAllows,
  type ConquestEffect,
  type ConquestMembershipTier,
} from '../src/lib/conquestArtifacts'
import { canStreamTo, type Placement } from '../src/lib/tiers'

type PoolClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>
  release: () => void
}
type Pooly = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>
  connect?: () => Promise<PoolClient>
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'

// ===========================================================================
// TABLE POLICY — the row-level authorization model for the generic /api/db API.
// ---------------------------------------------------------------------------
// The generic endpoint refuses any table not listed in TABLE_POLICY, so a
// malicious `table` value can never reach SQL. Beyond that, EVERY table declares
// explicitly who may read it and who may write which rows. There is no default
// "authenticated == allowed" any more.
//
// DELIBERATELY ABSENT (and they must stay absent):
//   * `users`        — holds password_hash + the entitlement/role metadata
//                      (reelone_tier, tko_host). Reachable only via /api/auth/*
//                      and the trusted server functions below.
//   * `redeem_codes` — the code catalogue. Reachable only via /api/fn/redeem-code.
//
// The three enforcement rules the handler applies:
//   UPDATE/DELETE — the ownership predicate is added SERVER-SIDE. Client filters
//                   are never trusted; rows are read back first and every matched
//                   row must be owned (or role-permitted), else 403.
//   INSERT        — the owner column is FORCED to the authenticated user id, so a
//                   row can never be created "as" somebody else.
//   SELECT        — genuinely public content stays public; private tables are
//                   scoped to the caller or their membership.
// ===========================================================================

/**
 * The authenticated caller. `host` is users.user_metadata.tko_host (the founder
 * host capability); `topTier` is true when the account holds an ACTIVE top-tier
 * ("creator"/Legend) membership. Together they gate the HOST lane (see
 * host_commentaries below) — either one may host; neither is needed to view.
 */
type Actor = { id: string; host: boolean; topTier: boolean; tier: string }

/** Who may READ a table's rows. */
type SelectRule =
  | 'public' // anyone, signed in or not (public content)
  | 'auth' // any signed-in user (semi-public: tournament rosters)
  | 'owner' // only rows the caller owns (hosts see all)
  | 'scoped' // only rows reachable through `scope()` (hosts see all)

/** Who may CREATE rows. */
type InsertRule =
  | 'deny' // never through the generic API — trusted server code only
  | 'auth' // any signed-in user, owner column not forced
  | 'owner' // owner column FORCED to the caller
  | 'ownerOrElevated' // owner forced to the caller unless `elevate()` passes
  | 'elevated' // privileged role only (host / tournament admin / clan officer)
  | 'custom' // `insertCheck()` decides

/** Who may UPDATE / DELETE rows. */
type WriteRule = 'deny' | 'owner' | 'ownerOrElevated' | 'elevated'

interface TablePolicy {
  /** Column holding the owning user id (`id` for profiles, `user_id` for most). */
  owner?: string
  /** Extra columns that also count as ownership (e.g. both fighters in a battle). */
  ownerAny?: string[]
  /** Primary key used to re-target an authorized write. Defaults to `id`. */
  idCol?: string
  select: SelectRule
  insert: InsertRule
  write: WriteRule
  /** For select:'scoped' — the id set the caller may see, computed server-side. */
  scope?: (pool: Pooly, a: Actor) => Promise<{ col: string; ids: any[] }>
  /** Privileged-role check for a specific row (host, tournament admin, clan officer). */
  elevate?: (pool: Pooly, a: Actor, row: any) => Promise<boolean>
  /** For insert:'custom' — may this exact row be created by this caller? */
  insertCheck?: (pool: Pooly, a: Actor, row: any) => Promise<boolean>
  /** Columns only a privileged role may write (e.g. declaring a battle winner). */
  elevatedCols?: string[]
  /** Columns accepted at insert time but never changed through the generic API. */
  immutableCols?: string[]
}

/**
 * Columns NO client-driven write may ever set through the generic API, on ANY
 * table. This is the anti-privilege-escalation net: tiers, the host flag, the
 * raw metadata blobs and the money-bearing balances are writable ONLY by the
 * trusted server paths (redeem-code, the Stripe webhook, King registration).
 */
const PRIVILEGE_COLS = new Set<string>([
  'user_metadata', 'app_metadata', 'password_hash', 'email_verified', 'provider',
  'reelone_tier', 'reelone_tier_expires', 'tko_host', 'is_admin', 'is_host', 'artifact_unlimited',
  'stripe_account_id', 'charges_enabled', 'payouts_enabled', 'onboarded_at',
  'tax_certified_at', 'tax_form_type', 'electronic_1099_consent_at', 'tax_consent_version',
  'platform_fee_debit_consent_at', 'platform_fee_debit_consent_version',
  'treasury_tokens', 'tier_granted', 'grant_expires_at',
  // ---- billing (see the BILLING block in db/schema.sql) -------------------
  // The Stripe identity of a user and every column of a payment receipt. A
  // receipt is written ONLY by the webhook, from a signature-verified event; if
  // these were writable a user could book themselves a paid subscription, or
  // re-point their account at somebody else's Stripe customer.
  'stripe_customer_id', 'stripe_subscription_id', 'stripe_session_id',
  'stripe_invoice_id', 'stripe_event_id', 'amount_cents',
  'tokens_credited', 'sweeps_credited',
  // ---- the prestige economy (see the ECONOMY block in db/schema.sql) -------
  // Balances and the movements that produce them. A wallet is credited ONLY by
  // a trusted /api/fn/* handler; if these were writable a user could type
  // themselves a million Tokens with one curl.
  'tokens', 'sweeps', 'paid_sweeps_cents',
  'tokens_delta', 'sweeps_delta', 'paid_sweeps_delta_cents',
  // Creator-marketplace prices and settlement columns are accepted only by the
  // dedicated /api/creator/* routes, where the server validates a fixed tier
  // and derives every split. The generic data API may never set them.
  'price_cents', 'cash_enabled', 'paid_sweeps_enabled',
  'list_price_cents', 'buyer_charge_cents', 'discount_cents',
  'seller_tier', 'seller_share_percent', 'seller_share_cents', 'platform_share_cents', 'payment_method',
  'stripe_checkout_session_id', 'stripe_payment_intent_id',
  'stripe_transfer_id', 'transfers_enabled',
  // How an artifact was obtained and what kind of artifact it is. Without these
  // a user could list their own gear as a King 'prize' or an Oracle 'reward'.
  'origin', 'source',
  // Conquest powers are always derived from a source-controlled server recipe.
  // A generic artifact write may never mint land, a shield, a lead, or an
  // operator-only override.
  'recipe_code', 'forge_tier', 'power_payload', 'power_score', 'slot_cost',
  'official_override', 'clan_id', 'used_at', 'protected_until',
  'protected_by_artifact_id',
  // Prediction grading — set by the server against tournament_results only.
  'resolved_at', 'reward_asset_id',
])

// ---- role helpers (all parameterized, all server-side) --------------------

const one = async (pool: Pooly, sql: string, params: any[]): Promise<any> =>
  (await pool.query(sql, params)).rows[0] ?? null

/** uuid/text-safe identity compare (pg drivers hand back strings or objects). */
const same = (a: any, b: any): boolean => a != null && b != null && String(a) === String(b)

/** Global TKO host, the tournament's creator, or a listed tournament admin. */
async function isTournamentHost(pool: Pooly, a: Actor, tournamentId: any): Promise<boolean> {
  if (a.host) return true
  if (!tournamentId) return false
  const t = await one(pool, 'select created_by from tournaments where id=$1', [tournamentId])
  if (t && same(t.created_by, a.id)) return true
  return !!(await one(pool, 'select 1 from tournament_admins where tournament_id=$1 and user_id=$2', [tournamentId, a.id]))
}

/**
 * Tournament placement has one gate beyond membership tier: the broadcaster
 * must currently have a durable relationship to a tournament. Older installs
 * use tournament_entrants while the King flow uses registrations/battles, so
 * accept either representation. A pending/withdrawn entrant is not involved.
 */
async function hasCurrentTournamentInvolvement(pool: Pooly, a: Actor): Promise<boolean> {
  if (await one(pool, 'select 1 from tournaments where created_by=$1 limit 1', [a.id])) return true
  if (await one(pool, 'select 1 from tournament_admins where user_id=$1 limit 1', [a.id])) return true
  if (await one(pool, 'select 1 from tournament_registrations where user_id=$1 limit 1', [a.id])) return true
  if (await one(
    pool,
    "select 1 from tournament_battles where (player_a=$1 or player_b=$1) and status in ('scheduled','live') limit 1",
    [a.id],
  )) return true
  try {
    return !!(await one(
      pool,
      "select 1 from tournament_entrants where user_id=$1 and status='accepted' limit 1",
      [a.id],
    ))
  } catch {
    // tournament_entrants is absent from newer slim schemas.
    return false
  }
}

const LIVE_PLACEMENTS = new Set<Placement>(['profile', 'clan', 'front_page', 'tournament'])

/** Server-side mirror of src/lib/tiers.ts plus the tournament involvement gate. */
async function canStartLiveStream(pool: Pooly, a: Actor, row: any): Promise<boolean> {
  const placement = String(row?.placement || 'profile') as Placement
  if (!LIVE_PLACEMENTS.has(placement)) return false
  if (!a.host && !canStreamTo(placement, a.tier)) return false
  if (placement === 'tournament' && !(await hasCurrentTournamentInvolvement(pool, a))) return false
  return true
}

/** Host of any tournament, used for cross-tournament bookkeeping rows. */
async function isAnyHost(pool: Pooly, a: Actor): Promise<boolean> {
  if (a.host) return true
  return !!(await one(pool, 'select 1 from tournament_admins where user_id=$1', [a.id]))
}

/** Clan leader/officer (see src/lib/clans.ts) or the underlying server's owner. */
async function isClanManager(pool: Pooly, a: Actor, serverId: any): Promise<boolean> {
  if (a.host) return true
  if (!serverId) return false
  const s = await one(pool, 'select owner_id from servers where id=$1', [serverId])
  if (s && same(s.owner_id, a.id)) return true
  const m = await one(pool, 'select role from clan_members where server_id=$1 and user_id=$2', [serverId, a.id])
  return !!m && (m.role === 'leader' || m.role === 'officer')
}

/** Any member of the clan (clan_members or the looser server_members). */
async function isClanMember(pool: Pooly, a: Actor, serverId: any): Promise<boolean> {
  if (!serverId) return false
  if (await isClanManager(pool, a, serverId)) return true
  const m = await one(pool, 'select 1 from clan_members where server_id=$1 and user_id=$2', [serverId, a.id])
  if (m) return true
  return !!(await one(pool, 'select 1 from server_members where server_id=$1 and user_id=$2', [serverId, a.id]))
}

/** Owner/moderator of a chat space: its owner_id, or a manager of its clan. */
async function isSpaceManager(pool: Pooly, a: Actor, spaceId: any): Promise<boolean> {
  if (a.host) return true
  if (!spaceId) return false
  const s = await one(pool, 'select owner_id, clan_id from chat_spaces where id=$1', [spaceId])
  if (!s) return false
  if (same(s.owner_id, a.id)) return true
  return s.clan_id ? isClanManager(pool, a, s.clan_id) : false
}

/** Same, reached through a chat_channels row. */
async function isChatChannelManager(pool: Pooly, a: Actor, channelId: any): Promise<boolean> {
  if (a.host) return true
  if (!channelId) return false
  const c = await one(pool, 'select space_id from chat_channels where id=$1', [channelId])
  return c ? isSpaceManager(pool, a, c.space_id) : false
}

/** Legacy board channel -> its server's clan managers. */
async function isBoardChannelManager(pool: Pooly, a: Actor, channelId: any): Promise<boolean> {
  if (a.host) return true
  if (!channelId) return false
  const c = await one(pool, 'select server_id from channels where id=$1', [channelId])
  return c ? isClanManager(pool, a, c.server_id) : false
}

/** Host of the tournament a battle belongs to. */
async function isBattleHost(pool: Pooly, a: Actor, battleId: any): Promise<boolean> {
  if (a.host) return true
  if (!battleId) return false
  const b = await one(pool, 'select tournament_id from tournament_battles where id=$1', [battleId])
  return b ? isTournamentHost(pool, a, b.tournament_id) : false
}

/** Author of the post a nested row hangs off. */
async function ownsPost(pool: Pooly, a: Actor, postId: any): Promise<boolean> {
  if (!postId) return false
  const p = await one(pool, 'select user_id from posts where id=$1', [postId])
  return !!p && same(p.user_id, a.id)
}

/** Author of the reel a comment/upload hangs off. */
async function ownsReel(pool: Pooly, a: Actor, reelId: any): Promise<boolean> {
  if (!reelId) return false
  const r = await one(pool, 'select user_id from reels where id=$1', [reelId])
  return !!r && same(r.user_id, a.id)
}

/**
 * Is there a block between these two, in EITHER direction? (see src/lib/blocking)
 *
 * The client can only read its OWN blocks — nobody may discover who blocked
 * them — so the symmetric half of the rule has to be enforced here, where the
 * write lands. This is what stops a block being defeated by having the other
 * person assemble the reel or create the stage. It answers a boolean and never
 * reveals the direction to anyone.
 */
async function blockedEitherWay(pool: Pooly, x: any, y: any): Promise<boolean> {
  if (!x || !y || same(x, y)) return false
  const r = await one(
    pool,
    'select 1 from blocks where (blocker_id=$1 and blocked_id=$2) or (blocker_id=$2 and blocked_id=$1) limit 1',
    [x, y],
  )
  return !!r
}

/**
 * As above, but only for a block that asks to be hidden in shared lives — the
 * stricter reach, which forbids sharing a live stage at all.
 */
async function hiddenEitherWay(pool: Pooly, x: any, y: any): Promise<boolean> {
  if (!x || !y || same(x, y)) return false
  const r = await one(
    pool,
    'select 1 from blocks where hide_in_shared_lives = true and ((blocker_id=$1 and blocked_id=$2) or (blocker_id=$2 and blocked_id=$1)) limit 1',
    [x, y],
  )
  return !!r
}

const ownerOnly = (owner: string, select: SelectRule = 'public'): TablePolicy =>
  ({ owner, select, insert: 'owner', write: 'owner' })

// ---------------------------------------------------------------------------
// The policy table itself. One entry per reachable table — the entry IS the
// whitelist, so adding a table without a policy is impossible by construction.
// ---------------------------------------------------------------------------
const TABLE_POLICY: Record<string, TablePolicy> = {
  // ---- identity -----------------------------------------------------------
  // A profile row IS the public identity; the private half lives on `users`,
  // which is not reachable here at all.
  profiles: { owner: 'id', select: 'public', insert: 'owner', write: 'owner' },

  // ---- artifact economy + hosting (migrations 015/016) --------------------
  // Collectibles a player earned/forged. Public read (a collection is shown on
  // profiles); a player inserts their own (owner_id forced to the caller).
  artifacts: { owner: 'owner_id', select: 'public', insert: 'owner', write: 'owner' },
  // Referral credits — only the parties see them; created by a trusted path.
  referrals: { owner: 'referrer_id', select: 'owner', insert: 'deny', write: 'deny' },
  // Anti-abuse gift ledger — created server-side during redemption only.
  gifted_subs: { owner: 'giver_id', select: 'owner', insert: 'deny', write: 'deny' },
  // Rendered match versions (public content); the cloud renderer writes these.
  match_versions: { owner: 'match_key', select: 'public', insert: 'deny', write: 'deny' },
  // A player registering their OWN angle to a match (join → re-render).
  match_angles: { owner: 'user_id', select: 'public', insert: 'deny', write: 'deny' },
  // Hosting/commentary sessions over a match video.
  video_hosts: { owner: 'host_id', select: 'public', insert: 'owner', write: 'owner' },
  // Per-user re-render/host budget ledger — private; server writes it.
  render_ledger: { owner: 'user_id', select: 'owner', insert: 'deny', write: 'deny' },

  // ---- Shinobi Conquest (public map; server mutates via battle results) ----
  territories: { owner: 'owner_clan_id', select: 'public', insert: 'deny', write: 'deny' },
  clan_battles: { owner: 'winner_clan_id', select: 'public', insert: 'deny', write: 'deny' },

  // ---- content (public by design) ----------------------------------------
  // Reels and clips ARE the product's public content: everyone can read them,
  // only the author can create/change their own.
  clips: { owner: 'user_id', select: 'public', insert: 'owner', write: 'owner' },
  reels: { owner: 'user_id', select: 'public', insert: 'owner', write: 'owner' },
  // The CAST of a multi-angle reel — every player who appears in it, which is
  // what lets a combined reel show up in each participant's clips list.
  //
  // READ is public (a reel is public content, and its cast is part of it).
  // WRITES are owner-controlled the other way round from most tables: the owner
  // that matters is the REEL's author, not `user_id`. Note that insert must NOT
  // be 'owner' here — that would force user_id to the caller and let anybody add
  // THEMSELVES to a stranger's reel, forging a credit and firing a notification
  // at its author. insertCheck instead demands the caller own the reel, so only
  // the person who assembled the reel may name who is in it, and only they (or
  // a host) may correct it afterwards.
  //
  // BLOCKS ARE ENFORCED HERE. A cast row naming somebody the reel's author has
  // blocked — or who has blocked the author — is refused. That is the founder's
  // stated consequence of blocking, made durable: with no participant row the
  // combined clip never appears in that person's list and never notifies them,
  // even for a match they were in and lost. The check is symmetric so a block
  // can't be sidestepped by having the other side assemble the reel, and it
  // returns a plain refusal, so neither party learns the direction.
  reel_participants: {
    owner: 'user_id', select: 'public', insert: 'custom', write: 'elevated',
    insertCheck: async (pool, a, row) => {
      if (!(await ownsReel(pool, a, row.reel_id))) return false
      const author = await one(pool, 'select user_id from reels where id=$1', [row.reel_id])
      if (author && (await blockedEitherWay(pool, author.user_id, row.user_id))) return false
      return true
    },
    elevate: (pool, a, row) => ownsReel(pool, a, row.reel_id),
  },
  // Counts must be visible to everyone; you may only add/remove your own.
  reel_likes: { owner: 'user_id', select: 'public', insert: 'owner', write: 'owner' },
  reel_reactions: { owner: 'user_id', select: 'public', insert: 'owner', write: 'owner' },
  reel_comments: {
    owner: 'user_id', select: 'public', insert: 'owner', write: 'ownerOrElevated',
    // A reel's author may remove comments on their own reel.
    elevate: (pool, a, row) => ownsReel(pool, a, row.reel_id),
  },
  // Follower lists/counts are public; you may only create/remove your own follow.
  follows: { owner: 'follower_id', select: 'public', insert: 'owner', write: 'owner' },
  //
  // BLOCKS — the one table here that is private in BOTH directions.
  //
  // owner = blocker_id with select 'owner' means a client reads only the blocks
  // IT created. Nobody may see who blocked them: there is no query through this
  // API that answers "who has blocked me", and the row can't be inferred from a
  // failed write either (the insert checks on reel_participants and
  // live_group_members return a flat refusal, never the direction).
  //
  // insert/write 'owner' forces blocker_id to the caller, so a block can never
  // be created on somebody else's behalf, and only the blocker can lift or
  // re-scope it (`hide_in_shared_lives`). See src/lib/blocking.ts for what a
  // block actually does; the enforcement lives in the two insertCheck hooks
  // above and in the live-link engine.
  blocks: { owner: 'blocker_id', select: 'owner', insert: 'owner', write: 'owner' },
  posts: { owner: 'user_id', select: 'public', insert: 'owner', write: 'owner' },
  post_attachments: {
    select: 'public', insert: 'elevated', write: 'elevated',
    elevate: (pool, a, row) => ownsPost(pool, a, row.post_id),
  },
  post_comments: { owner: 'user_id', select: 'public', insert: 'owner', write: 'owner' },
  post_likes: { owner: 'user_id', select: 'public', insert: 'owner', write: 'owner' },
  post_polls: {
    select: 'public', insert: 'elevated', write: 'elevated',
    elevate: (pool, a, row) => ownsPost(pool, a, row.post_id),
  },
  post_poll_options: {
    select: 'public', insert: 'elevated', write: 'elevated',
    elevate: async (pool, a, row) => {
      const pp = await one(pool, 'select post_id from post_polls where id=$1', [row.poll_id])
      return pp ? ownsPost(pool, a, pp.post_id) : false
    },
  },
  // Poll tallies are public; a vote may only be cast/changed by its owner.
  post_poll_votes: { owner: 'user_id', select: 'public', insert: 'owner', write: 'owner' },
  polls: { owner: 'user_id', select: 'public', insert: 'owner', write: 'owner' },
  poll_options: {
    select: 'public', insert: 'elevated', write: 'elevated',
    elevate: async (pool, a, row) => {
      const p = await one(pool, 'select user_id from polls where id=$1', [row.poll_id])
      return !!p && same(p.user_id, a.id)
    },
  },
  poll_votes: { owner: 'user_id', select: 'public', insert: 'owner', write: 'owner' },
  activities: { owner: 'user_id', select: 'public', insert: 'auth', write: 'owner' },
  files: ownerOnly('owner_id'),
  matches: { select: 'public', insert: 'auth', write: 'elevated', elevate: async (_p, a) => a.host },
  // The shared clip catalogue used to find co-stars of the same match — this
  // MUST be publicly readable or multi-angle participant matching can't work.
  clip_records: { owner: 'player_id', select: 'public', insert: 'owner', write: 'owner' },
  match_groups: { select: 'public', insert: 'auth', write: 'deny' },
  // The auto-match render queue. Publicly readable so a participant can watch
  // "your match is assembling → here's the video", but only trusted server code
  // (runAutoMatch / the render worker) ever writes it.
  render_jobs: { select: 'public', insert: 'deny', write: 'deny' },

  // ---- boards / clans -----------------------------------------------------
  servers: {
    owner: 'owner_id', select: 'public', insert: 'owner', write: 'ownerOrElevated',
    elevate: (pool, a, row) => isClanManager(pool, a, row.id),
  },
  server_members: {
    owner: 'user_id', select: 'public', insert: 'ownerOrElevated', write: 'ownerOrElevated',
    elevate: (pool, a, row) => isClanManager(pool, a, row.server_id),
  },
  clan_members: {
    owner: 'user_id', select: 'public', insert: 'custom', write: 'ownerOrElevated',
    // Join yourself as a plain member; a clan leader/officer (or the server's
    // owner, i.e. the founder creating their own clan) may add any user at any rank.
    insertCheck: async (pool, a, row) => {
      if (await isClanManager(pool, a, row.server_id)) return true
      return same(row.user_id, a.id) && (row.role == null || row.role === 'member')
    },
    elevate: (pool, a, row) => isClanManager(pool, a, row.server_id),
  },
  // A dues payment is a RECEIPT for tokens that actually left a wallet, so it is
  // issued by /api/fn/clan-pay, not inserted by the client. (It used to be
  // insert:'owner', which let anyone book a payment they never made and — once
  // the treasury became real — credit a clan for free.)
  clan_dues_payments: { owner: 'user_id', select: 'owner', insert: 'deny', write: 'deny' },
  channels: {
    select: 'public', insert: 'elevated', write: 'elevated',
    elevate: (pool, a, row) => isClanManager(pool, a, row.server_id),
  },
  messages: {
    owner: 'user_id', select: 'public', insert: 'owner', write: 'ownerOrElevated',
    elevate: (pool, a, row) => isBoardChannelManager(pool, a, row.channel_id),
  },
  reactions: ownerOnly('user_id'),

  // ---- chat spaces --------------------------------------------------------
  chat_spaces: {
    owner: 'owner_id', select: 'public', insert: 'custom', write: 'ownerOrElevated',
    // open space -> you own it; clan space -> you must be in that clan;
    // the official 'tko' space -> hosts only.
    insertCheck: async (pool, a, row) => {
      const kind = String(row.kind || 'open')
      if (kind === 'tko') return a.host
      if (kind === 'clan') return isClanMember(pool, a, row.clan_id)
      return same(row.owner_id, a.id)
    },
    elevate: (pool, a, row) => (row.clan_id ? isClanManager(pool, a, row.clan_id) : Promise.resolve(a.host)),
  },
  chat_channels: {
    select: 'public', insert: 'elevated', write: 'elevated',
    elevate: (pool, a, row) => isSpaceManager(pool, a, row.space_id),
  },
  chat_messages: {
    owner: 'user_id', select: 'public', insert: 'owner', write: 'ownerOrElevated',
    elevate: (pool, a, row) => isChatChannelManager(pool, a, row.channel_id),
  },

  // ---- private to the user ------------------------------------------------
  // notifications: INSERT is deliberately open (one user legitimately notifies
  // another — "your battle is scheduled"), but READ/UPDATE/DELETE are yours only.
  notifications: { owner: 'user_id', select: 'owner', insert: 'auth', write: 'owner' },
  soundboard_pads: ownerOnly('user_id', 'owner'),
  frame_labels: ownerOnly('user_id', 'owner'),
  pending_uploads: ownerOnly('requested_by', 'owner'),
  code_redemptions: { owner: 'user_id', select: 'owner', insert: 'deny', write: 'deny' },
  creator_stripe_accounts: { owner: 'user_id', select: 'owner', insert: 'deny', write: 'deny' },
  donations: { owner: 'creator_id', select: 'owner', insert: 'deny', write: 'deny' },
  creator_offers: { owner: 'seller_user_id', select: 'public', insert: 'deny', write: 'deny' },
  creator_orders: { select: 'deny', insert: 'deny', write: 'deny' },
  creator_earnings: { owner: 'seller_user_id', select: 'owner', insert: 'deny', write: 'deny' },
  creator_included_passes: { owner: 'member_user_id', select: 'owner', insert: 'deny', write: 'deny' },
  creator_platform_fees: { owner: 'seller_user_id', select: 'owner', insert: 'deny', write: 'deny' },
  creator_entitlements: { owner: 'user_id', select: 'owner', insert: 'deny', write: 'deny' },
  paid_sweeps_purchases: { owner: 'user_id', select: 'owner', insert: 'deny', write: 'deny' },

  // ---- DMs (membership-scoped) -------------------------------------------
  dm_conversations: {
    select: 'scoped', insert: 'deny', write: 'elevated',
    scope: async (pool, a) => ({
      col: 'id',
      ids: (await pool.query('select conversation_id from dm_participants where user_id=$1', [a.id])).rows.map((r) => r.conversation_id),
    }),
    elevate: async (pool, a, row) =>
      !!(await one(pool, 'select 1 from dm_participants where conversation_id=$1 and user_id=$2', [row.id, a.id])),
  },
  dm_participants: {
    owner: 'user_id', select: 'scoped', insert: 'deny', write: 'owner',
    scope: async (pool, a) => ({
      col: 'conversation_id',
      ids: (await pool.query('select conversation_id from dm_participants where user_id=$1', [a.id])).rows.map((r) => r.conversation_id),
    }),
  },
  dm_messages: {
    owner: 'user_id', select: 'scoped', insert: 'custom', write: 'owner',
    scope: async (pool, a) => ({
      col: 'conversation_id',
      ids: (await pool.query('select conversation_id from dm_participants where user_id=$1', [a.id])).rows.map((r) => r.conversation_id),
    }),
    insertCheck: async (pool, a, row) => {
      row.user_id = a.id
      row.content = String(row.content || '').trim()
      if (!row.conversation_id || !row.content || row.content.length > 1000) return false
      const members = (await pool.query(
        'select user_id from dm_participants where conversation_id=$1',
        [row.conversation_id],
      )).rows.map((member) => String(member.user_id))
      if (!members.some((memberId) => same(memberId, a.id))) return false
      for (const memberId of members) {
        if (!same(memberId, a.id) && (await blockedEitherWay(pool, a.id, memberId))) return false
      }
      return true
    },
  },

  // ---- live ---------------------------------------------------------------
  // NOTE: live content is PUBLIC to read by design — a stream nobody else can
  // see is not a stream. Only the broadcaster may create/modify their own rows.
  live_streams: {
    owner: 'user_id', select: 'public', insert: 'custom', write: 'owner',
    immutableCols: ['placement'],
    insertCheck: async (pool, a, row) => {
      row.user_id = a.id
      row.placement = String(row.placement || 'profile')
      if (row.is_live == null) row.is_live = true
      return canStartLiveStream(pool, a, row)
    },
  },
  live_groups: { owner: 'creator_id', select: 'public', insert: 'owner', write: 'owner' },
  //
  // A HIDDEN BLOCK PAIR MAY NEVER SHARE A STAGE. The new member is checked
  // against everyone already in the group; if any pair has a block asking to be
  // hidden in shared lives, the row is refused. (A plain block only forbids
  // AUTO-linking, which the engine handles — being pulled onto a stage by a
  // tournament or a third party is still allowed there.) The client inserts
  // members one at a time precisely so this check sees its siblings.
  live_group_members: {
    owner: 'user_id', select: 'public', insert: 'custom', write: 'ownerOrElevated',
    insertCheck: async (pool, a, row) => {
      // Replicates 'ownerOrElevated': you may add yourself; the group's creator
      // may add any angle's owner. A non-creator's user_id is forced to them.
      const g = await one(pool, 'select creator_id from live_groups where id=$1', [row.group_id])
      const isCreator = !!g && same(g.creator_id, a.id)
      if (!isCreator || !row.user_id) row.user_id = a.id
      const members = await pool.query(
        'select user_id from live_group_members where group_id=$1',
        [row.group_id],
      )
      for (const m of members.rows) {
        if (await hiddenEitherWay(pool, m.user_id, row.user_id)) return false
      }
      return true
    },
    elevate: async (pool, a, row) => {
      const g = await one(pool, 'select creator_id from live_groups where id=$1', [row.group_id])
      return !!g && same(g.creator_id, a.id)
    },
  },
  // The post-mortem record of a linked multi-angle session: which streams were
  // in it and the window where all of them were live, kept so a combined
  // highlight can be produced from it later. Public to read (same reasoning as
  // the group itself); written by the group's creator or any of its members.
  live_group_sessions: {
    owner: 'creator_id', select: 'public', insert: 'custom', write: 'ownerOrElevated',
    // Only the group's CREATOR or one of its members may record the session —
    // a stranger can't fabricate a session for a group they were never in. The
    // recorder is stamped as the owner regardless of what the client sent.
    insertCheck: async (pool, a, row) => {
      if (!row?.group_id) return false
      row.creator_id = a.id
      const g = await one(pool, 'select creator_id from live_groups where id=$1', [row.group_id])
      if (g && same(g.creator_id, a.id)) return true
      const m = await one(
        pool,
        'select 1 from live_group_members where group_id=$1 and user_id=$2',
        [row.group_id, a.id],
      )
      return !!m
    },
    // Updating an existing record (e.g. stamping `assembled_reel_id` once the
    // combined highlight exists) is the owner's, or the group creator's.
    elevate: async (pool, a, row) => {
      if (!row?.group_id) return false
      const g = await one(pool, 'select creator_id from live_groups where id=$1', [row.group_id])
      return !!g && same(g.creator_id, a.id)
    },
  },
  // The unified "who's live right now" indicator (see db/schema.sql LIVE
  // SESSIONS + src/lib/liveSessions.ts). READ is PUBLIC — a session nobody can
  // see is not live — so the Live surfaces on home + profiles can list it
  // without signing in. WRITE is owner-forced (same trusted path as
  // live_streams): host_id is FORCED to the caller on insert, so you can only
  // mark YOURSELF live, and only you (or a global host) may end/edit your own
  // session — the row can never be forged for somebody else. The youtube_id of a
  // video posted after the session ends is stamped by the trusted render worker
  // via direct pool access, not through this API.
  live_sessions: { owner: 'host_id', select: 'public', insert: 'owner', write: 'owner' },
  // Public YouTube URLs shown on profiles / used as stream angles.
  user_youtube_links: { owner: 'user_id', select: 'public', insert: 'owner', write: 'owner' },
  // Angles of a live multi-cam stage — viewers must be able to read them.
  stream_slots: { owner: 'user_id', select: 'public', insert: 'owner', write: 'owner' },
  // Live chat: everyone in the stream reads it; any signed-in user may post;
  // you may only edit/delete your own message.
  stream_messages: { owner: 'user_id', select: 'public', insert: 'owner', write: 'owner' },

  // ---- rankings / results -------------------------------------------------
  match_results: {
    owner: 'uploader_id', select: 'public', insert: 'owner', write: 'ownerOrElevated',
    elevate: (_p, a) => Promise.resolve(a.host),
  },
  match_result_players: {
    select: 'public', insert: 'elevated', write: 'elevated',
    elevate: async (pool, a, row) => {
      if (a.host) return true
      const r = await one(pool, 'select uploader_id from match_results where id=$1', [row.result_id])
      return !!r && same(r.uploader_id, a.id)
    },
  },
  // Maintained by the schema trigger on match_result_players — never by a client.
  power_ratings: { select: 'public', insert: 'deny', write: 'deny' },
  trophies: {
    owner: 'profile_id', select: 'public', insert: 'ownerOrElevated', write: 'elevated',
    elevate: (pool, a) => isAnyHost(pool, a),
  },
  stat_check_submissions: {
    owner: 'user_id', select: 'public', insert: 'owner', write: 'ownerOrElevated',
    elevate: (pool, a, row) => isTournamentHost(pool, a, row.tournament_id),
  },

  // ---- tournaments --------------------------------------------------------
  tournaments: {
    owner: 'created_by', select: 'public', insert: 'owner', write: 'ownerOrElevated',
    elevate: (pool, a, row) => isTournamentHost(pool, a, row.id),
  },
  tournament_admins: {
    select: 'public', insert: 'elevated', write: 'elevated',
    elevate: (pool, a, row) => isTournamentHost(pool, a, row.tournament_id),
  },
  tournament_results: {
    owner: 'submitted_by', select: 'public', insert: 'elevated', write: 'elevated',
    elevate: (pool, a, row) => isTournamentHost(pool, a, row.tournament_id),
  },
  tournament_entrants: {
    owner: 'user_id', select: 'auth', insert: 'ownerOrElevated', write: 'ownerOrElevated',
    elevate: (pool, a, row) => isTournamentHost(pool, a, row.tournament_id),
  },
  tournament_messages: {
    owner: 'user_id', select: 'public', insert: 'owner', write: 'ownerOrElevated',
    elevate: (pool, a, row) => isTournamentHost(pool, a, row.tournament_id),
  },
  tournament_registrations: {
    owner: 'user_id', select: 'auth', insert: 'owner', write: 'ownerOrElevated',
    elevate: (pool, a, row) => isTournamentHost(pool, a, row.tournament_id),
  },
  tournament_battles: {
    // Either fighter may self-schedule their battle (play-anytime format), but
    // only the HOST may set the status or declare the winner.
    ownerAny: ['player_a', 'player_b'], select: 'public', insert: 'elevated', write: 'ownerOrElevated',
    elevate: (pool, a, row) => isTournamentHost(pool, a, row.tournament_id),
    elevatedCols: ['status', 'winner', 'round', 'tournament_id', 'player_a', 'player_b'],
  },
  battle_meetups: {
    // The private pit card: readable only by the two fighters (and hosts).
    owner: 'user_id', select: 'scoped', insert: 'owner', write: 'owner',
    scope: async (pool, a) => ({
      col: 'battle_id',
      ids: (await pool.query('select id from tournament_battles where player_a=$1 or player_b=$1', [a.id])).rows.map((r) => r.id),
    }),
  },
  shinobi_defeats: {
    // Trophy-closet entries are awarded by the host when a battle is decided,
    // never self-issued — otherwise anyone could farm their own closet.
    owner: 'user_id', select: 'public', insert: 'elevated', write: 'elevated',
    elevate: (pool, a) => isAnyHost(pool, a),
  },

  // The HOST COMMENTARY / "with host" version markers (see db/schema.sql +
  // src/pages/Host.tsx). READ is public — a produced host cut is public content,
  // and the player's version picker has to see whether a match has a host cut to
  // offer with-host / without-host (VIEWING IS OPEN TO ANYONE, by design).
  //
  // CREATING a host cut is gated: only someone who may HOST may insert one —
  // EITHER a global tko_host (a founder host code) OR an active top-tier
  // ("creator"/Legend) member (mirror of canHost in src/lib/tkoKing.ts). insert
  // 'custom' both gates on that capability AND forces host_id to the caller, so a
  // host can't attribute a commentary to somebody else. Editing/removing stays
  // the owning host's (via ownerOrElevated — the forced host_id owns the row) or
  // any global host's.
  host_commentaries: {
    owner: 'host_id', select: 'public', insert: 'custom', write: 'ownerOrElevated',
    insertCheck: async (_pool, a, row) => {
      if (!a.host && !a.topTier) return false
      row.host_id = a.id
      return true
    },
    elevate: (_pool, a) => Promise.resolve(a.host),
  },

  // ---- the prestige economy ----------------------------------------------
  // READ paths only. Everything that MINTS value — a token credit, an artifact
  // grant, a prediction payout, a treasury settlement — is insert/write 'deny'
  // here and lives in a trusted /api/fn/* handler further down this file, where
  // the amount is computed from server state rather than taken from the client.

  // The artifact CATALOGUE is public (that is the entire point — a cosmetic one
  // team lists must be visible to everyone). Only the creator may edit their own
  // listing; platform artifacts (seed gear, Oracle rewards, King prizes) have a
  // null created_by, so no client owns them and none can be edited from here.
  // `origin` is in PRIVILEGE_COLS, so a listing can never claim to be a prize.
  assets: {
    owner: 'created_by',
    select: 'public',
    insert: 'custom',
    write: 'owner',
    // Storefront ownership is fixed when a listing is created. A creator may
    // edit the art/name/price later, but cannot move it between storefronts or
    // transfer authorship through the generic API.
    immutableCols: ['created_by', 'seller_type', 'clan_id'],
    insertCheck: async (pool, a, row) => {
      const sellerType = String(row.seller_type || 'creator')
      if (sellerType !== 'creator' && sellerType !== 'clan') return false
      row.created_by = a.id
      row.seller_type = sellerType
      if (sellerType === 'creator') {
        row.clan_id = null
        return true
      }
      const clanId = String(row.clan_id || '')
      if (!clanId || !(await isClanManager(pool, a, clanId))) return false
      const clan = await one(pool, 'select name from servers where id=$1', [clanId])
      if (!clan) return false
      row.clan_id = clanId
      row.team_name = String(clan.name || row.team_name || 'Clan')
      return true
    },
  },

  // OWNERSHIP is yours alone to read and NOBODY's to write. Buying goes through
  // /api/fn/asset-buy (which debits the wallet in the same request); earning
  // goes through /api/fn/prediction-resolve; winning goes through
  // /api/fn/king-prize (host-verified). There is no forgeable insert.
  asset_ownership: { owner: 'user_id', select: 'owner', insert: 'deny', write: 'deny' },

  // Balances. Read your own; write none. /api/fn/wallet creates the row.
  wallets: { owner: 'user_id', idCol: 'user_id', select: 'owner', insert: 'deny', write: 'deny' },

  // Append-only audit trail of every balance movement and settled prize.
  wallet_ledger: { owner: 'user_id', select: 'owner', insert: 'deny', write: 'deny' },

  // Billing receipts. A user may read their own purchase history; NOBODY may
  // write one. Rows are created only by the signature-verified Stripe webhook.
  // (`stripe_events`, the idempotency ledger, has no policy at all on purpose —
  // it is internal bookkeeping and reads as "unknown table" here.)
  payments: { owner: 'user_id', select: 'owner', insert: 'deny', write: 'deny' },

  // Predictions are made/cancelled/graded through /api/fn/prediction-*, so the
  // tier quota, the one-open-per-tournament rule and (critically) the GRADE are
  // all decided server-side against tournament_results.
  predictions: { owner: 'user_id', select: 'owner', insert: 'deny', write: 'deny' },

  // GLOBAL SINGLE-USE code ledger (db/schema.sql redeemed_codes). A founder HOST
  // code or a redeem_codes tier pass is claimed here — insert-with-unique-key —
  // by the trusted /api/fn/redeem-code handler BEFORE it grants anything, so a
  // code can be consumed exactly once by exactly one profile. It is NEVER written
  // through this generic API (insert/write 'deny'); a profile may read its OWN
  // claims (select 'owner' on redeemed_by), and a global host sees all.
  redeemed_codes: { owner: 'redeemed_by', select: 'owner', insert: 'deny', write: 'deny' },

  // ---- artifact tags (a clan tag a user EQUIPS to show off everywhere) -----
  // The artifact-tag CATALOGUE is public (the point is that everyone can see a
  // clan's tags to buy them), but a listing is created ONLY by its clan's leader
  // through /api/fn/artifact-tag-create — never inserted from the client, so the
  // server-side price can't be forged. `user_equipped_tag` is public too (an
  // equipped tag shows in chat/profiles/lists for everyone), set ONLY by the
  // equip/buy handlers. `user_artifact_tags` is the private grant ledger of the
  // tags a user owns/was granted — read your own, written only by the buy/grant
  // path. All three are insert/write 'deny' here: value + equipping go through
  // the trusted /api/fn/artifact-tag-* handlers.
  artifact_tags: { owner: 'creator_id', select: 'public', insert: 'deny', write: 'deny' },
  user_artifact_tags: { owner: 'user_id', select: 'owner', insert: 'deny', write: 'deny' },
  user_equipped_tag: { owner: 'user_id', idCol: 'user_id', select: 'public', insert: 'deny', write: 'deny' },

  // ---- Oracle voting (a 30s in-match outcome vote worth +10 power if right) -
  // A player reads their OWN votes; casting/resolving go through
  // /api/fn/oracle-vote and /api/fn/oracle-resolve (the grade + the +10 power
  // are decided server-side), so it is insert/write 'deny' here.
  oracle_votes: { owner: 'user_id', select: 'owner', insert: 'deny', write: 'deny' },

  // ---- TKO-BETA tester chat membership ------------------------------------
  // Who belongs to a chat space (currently the global TKO-BETA tester space). A
  // user reads their OWN memberships; membership is written only by the trusted
  // /api/fn/redeem-code TKO-BETA path.
  chat_space_members: { owner: 'user_id', select: 'owner', insert: 'deny', write: 'deny' },

}

const TABLES = new Set<string>(Object.keys(TABLE_POLICY))

// The 3 founder HOST codes. Redeeming one flips user_metadata.tko_host = true
// (the global run-anything host capability). Keep in sync with
// src/lib/tkoKing.ts TKO_HOST_CODES + src/lib/mockSupabase.ts.
const TKO_HOST_CODES = new Set<string>([
  'TKO-HOST-K9F3QX',
  'TKO-HOST-M4R7PZ',
  'TKO-HOST-B2X8LT',
  'TKO-HOST-3P9K2J',
  'TKO-HOST-7X4M8Q',
])

// Reusable BETA TESTER pass. Unlike the single-use founder passes in the
// redeem_codes table, this is ONE TKO-branded code the whole beta shares — it
// grants top-tier access (so testers can exercise every feature) and has no
// per-code use limit. Redeem is idempotent per user (re-redeeming just re-grants
// the same tier). Rotate/retire by editing this set.
const TKO_TESTER_CODES = new Set<string>(['TKO-BETA'])
const TKO_TESTER_TIER = 'creator'
const TKO_TESTER_MONTHS = 12
// The single global TKO-BETA tester chat space every beta redeemer is joined to.
// Fixed id so it is idempotent to create and the client can deep-link it.
const TKO_BETA_SPACE_ID = '00000000-0000-0000-0000-0000000be7a0'

// FOUNDER ULTRA — the owner's personal code. Grants PERMANENT top tier (never
// expires = never charged), UNLIMITED artifacts (bypasses the monthly craft
// cap), and the global host flag. Idempotent per user, no single-use limit.
// Compared upper-cased, so any casing of TKO-PatternAft3rError matches.
const TKO_ULTRA_CODES = new Set<string>(['TKO-PATTERNAFT3RERROR'])

// ── Ask TKO (real chat via Vertex AI Gemini) ─────────────────────────────────
const TKO_SYSTEM = `You are "Ask TKO", the in-app assistant for TKO.cam, a multi-angle gaming highlight, tournament, clan, live-event, and creator platform. Players upload their own gameplay clips; TKO can detect when different players were in the same match and assemble their angles into one video.
Features you can explain: Power Level; tournaments and TKO King; Stat Checks; making clips and reels; Artifacts and the Forge; the official, creator, and clan marketplace; Shinobi Conquest; live broadcasts; clans and villages; the social wall; membership tiers; Give Points; and redeem codes. TKO does not offer cash wagering. Give Points are non-cash support and prestige.
Official match scores and MVP results require full-match footage. A short clip can support highlights and a provisional Highlight MVP, but you must tell the player to upload the complete match when they ask for full results.
You may receive public live TKO totals and a private snapshot for the signed-in player. Use only the supplied facts. Never expose or infer another user's private information, credentials, email address, payment data, or secrets.
Style: friendly, concise gamer tone, usually 2-4 sentences. If the user wants to do something, point them to the right place in the app. If unsure, say so briefly. Never invent features or figures.`
const ASK_TKO_MODEL = process.env.VERTEX_MODEL || 'gemini-2.5-flash'

/**
 * A snapshot of live TKO numbers so Ask TKO can answer "how many clans are
 * there?", "who holds the most land?", etc. instead of guessing. Best-effort —
 * any table that isn't there just gets skipped.
 */
export async function liveStats(pool: Pooly): Promise<string> {
  const bits: string[] = []
  const one = async (label: string, sql: string) => {
    try { const r = await pool.query(sql); const n = Number(r.rows[0]?.n ?? 0); bits.push(`${label}: ${n}`) } catch { /* skip */ }
  }
  await one('registered players', 'select count(*)::int n from profiles')
  await one('clans', 'select count(*)::int n from servers')
  await one('tournaments', 'select count(*)::int n from tournaments')
  await one('produced multi-angle videos', 'select count(distinct composite_youtube_id)::int n from clip_records where composite_youtube_id is not null')
  await one('territories on the Conquest map', 'select count(*)::int n from territories')
  await one('territories currently held', 'select count(*)::int n from territories where owner_clan_id is not null')
  // Top land-holding clans (name + count) for "who's winning Conquest".
  try {
    const r = await pool.query(
      `select s.name, s.clan_tag, count(t.id)::int held
         from territories t join servers s on s.id=t.owner_clan_id
        group by s.name, s.clan_tag order by held desc limit 5`,
    )
    const tops = (r.rows || []).map((x: any) => `${x.clan_tag ? '[' + x.clan_tag + '] ' : ''}${x.name} (${x.held})`)
    if (tops.length) bits.push(`top land-holding clans: ${tops.join(', ')}`)
  } catch { /* skip */ }
  return bits.length ? `Live TKO numbers right now — ${bits.join('; ')}.` : ''
}

/** Safe, signed-in-user-only grounding for personalized Ask TKO answers. */
export async function userStats(pool: Pooly, userId: string): Promise<string> {
  const bits: string[] = []

  try {
    const r = await pool.query(
      `select p.username, p.power_level, u.user_metadata
         from profiles p join users u on u.id=p.id
        where p.id=$1 limit 1`,
      [userId],
    )
    const row = r.rows[0]
    if (row) {
      const metadata =
        row.user_metadata && typeof row.user_metadata === 'object' ? row.user_metadata : {}
      bits.push(`username: ${String(row.username || 'player')}`)
      bits.push(`power level: ${Number(row.power_level || 0)}`)
      bits.push(`membership: ${String(metadata.reelone_tier || 'free')}`)
    }
  } catch { /* optional table/column on older databases */ }

  try {
    const r = await pool.query('select tokens, sweeps from wallets where user_id=$1 limit 1', [userId])
    const row = r.rows[0]
    if (row) {
      bits.push(`utility Tokens: ${Number(row.tokens || 0)}`)
      bits.push(`Give Points: ${Number(row.sweeps || 0)}`)
    }
  } catch { /* wallet may not exist yet */ }

  try {
    const r = await pool.query(
      `select s.name, cm.role
         from clan_members cm join servers s on s.id=cm.server_id
        where cm.user_id=$1 order by cm.joined_at desc limit 8`,
      [userId],
    )
    if (r.rows.length) {
      bits.push(
        `clans: ${r.rows
          .map((row: any) => `${String(row.name)} (${String(row.role || 'member')})`)
          .join(', ')}`,
      )
    }
  } catch { /* clan tables are additive */ }

  try {
    const r = await pool.query(
      `select count(*)::int total,
              count(*) filter (where outcome='victory')::int wins,
              count(*) filter (where outcome='defeat')::int losses,
              coalesce(sum(kills),0)::int kills
         from clip_records where player_id=$1`,
      [userId],
    )
    const row = r.rows[0]
    if (row) {
      bits.push(
        `clip records: ${Number(row.total || 0)} total, ${Number(row.wins || 0)} wins, ` +
        `${Number(row.losses || 0)} losses, ${Number(row.kills || 0)} recorded K.O.s`,
      )
    }
  } catch { /* clip analysis may not be installed */ }

  try {
    const r = await pool.query(
      'select count(*)::int n from tournament_registrations where user_id=$1',
      [userId],
    )
    bits.push(`tournament registrations: ${Number(r.rows[0]?.n || 0)}`)
  } catch { /* tournament registration is additive */ }

  try {
    const r = await pool.query(
      'select count(*)::int n from asset_ownership where user_id=$1',
      [userId],
    )
    bits.push(`owned artifacts: ${Number(r.rows[0]?.n || 0)}`)
  } catch { /* marketplace may not be installed */ }

  return bits.length
    ? `Private snapshot for the signed-in player only - ${bits.join('; ')}.`
    : ''
}

async function askTko(question: string, context = ''): Promise<string> {
  // SA access token straight from the Cloud Run metadata server — no key, no lib.
  const tokRes = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  )
  if (!tokRes.ok) throw new Error('metadata token unavailable (not on Cloud Run?)')
  const { access_token } = (await tokRes.json()) as { access_token: string }
  const project = process.env.GOOGLE_CLOUD_PROJECT || 'reelone-498406'
  // gemini-1.5-flash / 2.0-flash 404 in this project+region; 2.5-flash is the
  // available Flash model. Overridable via env if it moves again.
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models/${ASK_TKO_MODEL}:generateContent`
  const system = context ? `${TKO_SYSTEM}\n\n${context}\nUse these live numbers when the user asks about them; don't invent figures.` : TKO_SYSTEM
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: question }] }],
      // gemini-2.5-flash spends "thinking" tokens out of maxOutputTokens — with a
      // small cap that left only a truncated fragment (which then fell back to
      // the canned KB). Disable thinking for a fast, concise assistant and give
      // the answer real room.
      generationConfig: { temperature: 0.5, maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 } },
    }),
  })
  if (!r.ok) throw new Error(`vertex ${r.status}: ${(await r.text()).slice(0, 160)}`)
  const j = (await r.json()) as any
  const text: string = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim()
  if (!text) throw new Error('empty answer')
  return text
}

// ── Power level ──────────────────────────────────────────────────────────────
// Power was never actually computed — the column sat at 0. It's derived from
// real activity so it MOVES both ways:
//   • a clip you WON (outcome 'victory')        → +250
//   • a clip you LOST (outcome 'defeat')        → −75  (losing costs you power)
//   • a clip with no result yet (or a draw)     → +100 (just uploading)
//   • every produced multi-angle you appear in  → +150 (your angle got merged)
// Floored at 0. Recomputing (rather than incrementing) is idempotent and
// self-backfills existing users. Losses pulling power DOWN is the point: people
// should feel a loss. (clip_records.outcome comes from the tagged result screen.)
const POWER_WIN = 250
const POWER_LOSS = 75
const POWER_UPLOAD = 100
const POWER_PRODUCED = 150

/** Recompute + store a player's power level from their clip_records. Returns it. */
export async function recomputePower(pool: Pooly, playerId: string): Promise<number> {
  if (!playerId) return 0
  try {
    const r = await pool.query(
      `select
         coalesce(sum(case when outcome='victory' then 1 else 0 end),0)::int as wins,
         coalesce(sum(case when outcome='defeat' then 1 else 0 end),0)::int  as losses,
         coalesce(sum(case when outcome is null or outcome='draw' then 1 else 0 end),0)::int as neutral,
         count(distinct case when composite_youtube_id is not null then composite_youtube_id end)::int as produced
       from clip_records where player_id=$1`,
      [playerId],
    )
    const row = r.rows[0] || {}
    const wins = Number(row.wins ?? 0)
    const losses = Number(row.losses ?? 0)
    const neutral = Number(row.neutral ?? 0)
    const produced = Number(row.produced ?? 0)
    // ORACLE POINTS — a persistent bonus banked by correct Oracle votes (+10
    // each; see the oracle-resolve handler). Read resiliently: on a slim schema
    // without the column the read fails and contributes 0 rather than throwing
    // the whole recompute (which would floor power to 0 via the outer catch).
    let oraclePoints = 0
    try {
      const pr = await pool.query('select coalesce(oracle_points,0)::int as pts from profiles where id=$1', [playerId])
      oraclePoints = Number(pr.rows[0]?.pts ?? 0)
    } catch { oraclePoints = 0 }
    const power = Math.max(
      0,
      wins * POWER_WIN - losses * POWER_LOSS + neutral * POWER_UPLOAD + produced * POWER_PRODUCED + oraclePoints,
    )
    await pool.query('update profiles set power_level=$1 where id=$2', [power, playerId])
    return power
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// TOP TIER — the single highest paid plan. Hosting (the with-host commentary
// lane) is open to EITHER a founder host code (tko_host) OR an active member of
// this tier; VIEWING stays public. Mirror of TOP_TIER in src/lib/tiers.ts and
// the entitlement resolution in src/lib/entitlements.ts.
// ---------------------------------------------------------------------------
export const TOP_TIER = 'creator'

/**
 * Resolve the ACTIVE (non-expired) paid tier from a parsed user_metadata blob.
 * Mirrors src/lib/entitlements.ts: an expired `reelone_tier_expires` lapses the
 * tier; an unparseable/absent expiry never revokes access. Legacy
 * `clutchlens_tier` is honoured for pre-rebrand grants.
 */
export function activeTierFromMeta(meta: any, now: number = Date.now()): string {
  const tier = typeof meta?.reelone_tier === 'string' ? meta.reelone_tier : ''
  const legacy = typeof meta?.clutchlens_tier === 'string' ? meta.clutchlens_tier : ''
  const expiresRaw = typeof meta?.reelone_tier_expires === 'string' ? meta.reelone_tier_expires : ''
  const expiresAt = expiresRaw ? new Date(expiresRaw).getTime() : NaN
  const expired = Number.isFinite(expiresAt) ? expiresAt < now : false
  return expired ? '' : (tier || legacy)
}

/** True if a parsed metadata blob resolves to an ACTIVE top-tier membership. */
export function isTopTierMeta(meta: any, now: number = Date.now()): boolean {
  return activeTierFromMeta(meta, now) === TOP_TIER
}

// ---------------------------------------------------------------------------
// AUTO-MERGE ENTITLEMENT — the cross-user auto-match / auto-build pipeline.
//
// The paid CONTENT tiers. The auto-merge pipeline is "Basic and up": it runs
// only for members on one of these. Deliberately EXCLUDES the ad-only `ad_free`
// tier (it removes ads but grants no content pipeline) and of course free ('').
// Mirror of hasAutoMergeTier / autoMergeEnabled in src/lib/entitlements.ts.
// ---------------------------------------------------------------------------
export const PAID_CONTENT_TIERS = ['pro', 'supporter', 'creator'] as const

/** The ACTIVE paid CONTENT tier from a parsed metadata blob, or '' when the
 *  member is free, expired, or on the ad-only `ad_free` tier. */
export function paidContentTier(meta: any, now: number = Date.now()): string {
  const tier = activeTierFromMeta(meta, now)
  return (PAID_CONTENT_TIERS as readonly string[]).includes(tier) ? tier : ''
}

/**
 * AUTO-MERGE unlock — server mirror of src/lib/entitlements.ts `autoMergeEnabled`.
 * A caller may trigger the cross-user auto-match/auto-build pipeline ONLY when
 * they hold an active paid CONTENT tier (pro/supporter/creator — not ad_free,
 * not free) AND have connected YouTube. Self single-uploads are never gated by
 * this; only the auto-MATCH trigger is.
 */
export function isAutoMergeEntitled(meta: any, hasYouTube: boolean, now: number = Date.now()): boolean {
  return hasYouTube === true && paidContentTier(meta, now) !== ''
}

// ---------------------------------------------------------------------------
// AGE GATE (13+) — server-side mirror of src/lib/age.ts.
//
// Duplicated rather than imported: server/ is run by tsx / built independently
// of the Vite app, and reaching across into src/ would couple the API build to
// the frontend's alias + bundler config. It is ~10 lines; keep MIN_AGE_YEARS
// and the parsing rule in sync with src/lib/age.ts.
// ---------------------------------------------------------------------------
export const MIN_AGE_YEARS = 13
const MAX_AGE_YEARS = 120
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Whole years old on `now`, or null if the value isn't a real, past date. */
export function ageFromDob(dob: unknown, now: Date = new Date()): number | null {
  const m = ISO_DATE.exec(String(dob ?? '').trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const probe = new Date(Date.UTC(y, mo - 1, d))
  // Rejects both out-of-range parts and dates that roll over (2011-02-30).
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null
  const [nY, nM, nD] = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()]
  let age = nY - y
  if (nM < mo || (nM === mo && nD < d)) age -= 1
  if (age < 0 || age > MAX_AGE_YEARS) return null
  return age
}

/** True only for an explicit acceptance of the legal versions in this build. */
export function isLegalAcceptanceCurrent(body: any): boolean {
  return body?.terms_accepted === true
    && body?.privacy_accepted === true
    && String(body?.terms_version || '') === TERMS_VERSION
    && String(body?.privacy_version || '') === PRIVACY_VERSION
}

// ===========================================================================
// THE PRESTIGE ECONOMY — server-side value minting.
//
// Everything below decides an AMOUNT or an ENTITLEMENT from server state, never
// from the request body. The client says "buy this artifact" / "grade my
// prediction" / "this battle is decided"; the server works out what that costs,
// what it earns, and whether the caller is allowed to ask.
//
// The artifact derivations mirror the pure functions in src/lib/tkoKing.ts
// (advancementPrize, roundLabel) and src/lib/predictions.ts (rewardForCorrect).
// They are DUPLICATED here for the same reason ageFromDob is: server/ is built
// by tsx independently of the Vite app, and reaching into src/ would couple the
// API build to the frontend's alias + bundler config. They are ~40 lines and
// deterministic; keep the IDS in sync, because those ids are primary keys in
// the `assets` table and therefore what a user's crown actually IS.
// ===========================================================================

/** A row of the shared `assets` catalogue. */
export type ArtifactRow = {
  id: string
  name: string
  team_name: string
  image_url: string
  price_tokens: number
  kind: 'jersey' | 'banner' | 'emote' | 'badge_skin'
  origin: 'user' | 'seed' | 'reward' | 'prize'
}

const KING_PRIZE_ID_PREFIX = 'king-prize-'
const KING_PRIZE_TEAM = 'TKO King'

const kingArtifact = (
  slug: string, name: string, kind: ArtifactRow['kind'], colors: string, caption: string,
): ArtifactRow => ({
  id: `${KING_PRIZE_ID_PREFIX}${slug}`,
  name,
  team_name: KING_PRIZE_TEAM,
  image_url: `https://placehold.co/400x400/${colors}?text=${encodeURIComponent(caption)}`,
  price_tokens: 0,
  kind,
  origin: 'prize',
})

/** Mirror of src/lib/tkoKing.ts roundLabel. */
export function roundLabelFor(round: number, totalRounds: number): string {
  const r = Math.max(1, Math.floor(round))
  const total = Math.floor(totalRounds)
  if (!Number.isFinite(total) || total < r) return `Round ${r}`
  const remaining = total - r
  if (remaining === 0) return 'Final'
  if (remaining === 1) return 'Semifinal'
  if (remaining === 2) return 'Quarterfinal'
  return `Round of ${2 ** (remaining + 1)}`
}

/**
 * The artifact a fighter earns for WINNING a battle in `round` of a bracket with
 * `totalRounds` rounds. Mirror of src/lib/tkoKing.ts advancementPrize.
 */
export function advancementArtifact(round: number, totalRounds: number): ArtifactRow {
  const r = Math.max(1, Math.floor(round))
  const total = Math.max(r, Math.floor(totalRounds) || r)
  const remaining = total - r
  if (remaining === 0) return kingArtifact('crown', 'TKO King Crown', 'badge_skin', '1a1400/f9c74f', 'KING')
  if (remaining === 1) return kingArtifact('finalist', 'Finalist Banner', 'banner', '1a1a2e/e94560', 'FINALIST')
  if (remaining === 2) return kingArtifact('semifinalist', 'Semifinalist Sigil', 'badge_skin', '0f3460/16db93', 'SEMI')
  const label = roundLabelFor(r, total)
  return kingArtifact(`round-${r}`, `${label} Token`, 'emote', '241a2e/c084fc', label)
}

/**
 * The Oracle reward pool, in the same cycle order as PREDICTION_REWARDS in
 * src/lib/predictions.ts. These rows are seeded by db/schema.sql.
 */
export const ORACLE_REWARD_IDS = [
  'oracle-reward-crystal-emote',
  'oracle-reward-violet-skin',
  'oracle-reward-starfall-emote',
  'oracle-reward-astral-skin',
]

/** Mirror of src/lib/predictions.ts rewardForCorrect — returns the assets.id. */
export function rewardAssetIdFor(correctCountAfter: number): string {
  const n = Number.isFinite(correctCountAfter) ? Math.max(1, Math.floor(correctCountAfter)) : 1
  return ORACLE_REWARD_IDS[(n - 1) % ORACLE_REWARD_IDS.length]
}

/** Mirror of PREDICTION_QUOTA in src/lib/tiers.ts — open predictions per tier. */
const PREDICTION_QUOTA: Record<string, number> = {
  '': 1, free: 1, ad_free: 2, pro: 3, supporter: 6, creator: Infinity,
}
export function predictionQuotaFor(tier: string | null | undefined): number {
  const q = PREDICTION_QUOTA[String(tier ?? '')]
  return typeof q === 'number' ? q : 1
}

/** The clan's 80/20 split — mirror of feeSplit in src/lib/clans.ts (20% platform). */
export function feeSplitFor(amountTokens: number): { clan: number; platform: number } {
  const gross = Math.max(0, Math.round(Number(amountTokens) || 0))
  const platform = Math.round(gross * 0.2)
  return { clan: gross - platform, platform }
}

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const q = (name: string) => {
  if (!IDENT.test(name)) throw new Error(`invalid identifier: ${name}`)
  return `"${name}"`
}

// ---------------------------------------------------------------------------
// Stripe — DIRECT REST calls via node's global `fetch` (deliberately NO `stripe`
// npm dependency, so nothing new lands in package.json / the lockfile). Every
// endpoint degrades to a clean 503 { error: 'stripe_not_configured' } when
// STRIPE_SECRET_KEY is unset, so the app never crashes before billing is on.
//
// Env the OPERATOR sets on the SERVER to switch payments on:
//   STRIPE_SECRET_KEY      sk_live_... (or sk_test_...)   — REQUIRED
//   STRIPE_WEBHOOK_SECRET  whsec_...  — verifies /api/stripe/webhook signatures
//   APP_URL                https://tko.cam — success/cancel + Connect URLs
//   STRIPE_PRICE_<TIER>      subscription price ids (AD_FREE / PRO / SUPPORTER / CREATOR)
//   STRIPE_PRICE_PACK_<PACK> one-time token-pack price ids (SMALL / MEDIUM / LARGE / MEGA)
// Get the price ids by running:  npx tsx scripts/stripe-setup.ts
// ---------------------------------------------------------------------------
const STRIPE_API = 'https://api.stripe.com/v1'
const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY
const appUrl = () => process.env.APP_URL || 'https://tko.cam'

/** The free-trial length offered on the Upgrade page (Stripe-managed). */
export const TRIAL_DAYS = 7
/** Hard ceiling on a client-requested trial, so nobody asks for a free year. */
export const MAX_TRIAL_DAYS = 30

async function stripeFetch(
  path: string,
  params?: URLSearchParams,
  method: 'GET' | 'POST' = 'POST',
  connectedAccountId?: string,
): Promise<{ ok: boolean; status: number; json: any }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY || ''}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (connectedAccountId) headers['Stripe-Account'] = connectedAccountId
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers,
    body: method === 'POST' && params ? params.toString() : undefined,
  })
  let json: any = {}
  try { json = await res.json() } catch { json = {} }
  return { ok: res.ok, status: res.status, json }
}

/** Resolve a tier/pack key to a configured Stripe price id (env-driven). */
const envKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '_')
const priceForTier = (tier: string): string => process.env[`STRIPE_PRICE_${envKey(tier)}`] || ''
const priceForPack = (pack: string): string => process.env[`STRIPE_PRICE_PACK_${envKey(pack)}`] || ''

/** The subscription ladder, cheapest first. Mirrors TIERS in src/pages/Upgrade.tsx. */
export const SUBSCRIPTION_TIERS = ['ad_free', 'pro', 'supporter', 'creator'] as const

/**
 * Reverse the price->tier map: which of our tiers does this Stripe price id
 * belong to? Used by the subscription lifecycle events, whose payload names a
 * price rather than a tier.
 */
export function tierForPrice(priceId: string): string {
  const id = String(priceId || '')
  if (!id) return ''
  return SUBSCRIPTION_TIERS.find((t) => priceForTier(t) === id) ?? ''
}

/**
 * SERVER-SIDE TOKEN PACK CATALOGUE — the mirror of src/lib/tokenPacks.ts.
 *
 * This, and not the Checkout Session metadata, decides how many Tokens a paid
 * pack delivers. The session carries only the pack ID; the amount is looked up
 * here, so tampering with metadata cannot inflate a credit.
 *
 * Duplicated rather than imported for the same reason as ageFromDob and the King
 * artifact derivations: server/ is built by tsx independently of the Vite app.
 * server/app.test.ts asserts this list is identical to the client's.
 */
export type ServerTokenPack = { id: string; tokens: number; bonusSweeps: number; priceUsd: number }

export const SERVER_TOKEN_PACKS: readonly ServerTokenPack[] = [
  { id: 'starter', tokens: 100, bonusSweeps: 40, priceUsd: 0.99 },
  { id: 'plus', tokens: 550, bonusSweeps: 200, priceUsd: 4.99 },
  { id: 'pro', tokens: 1200, bonusSweeps: 400, priceUsd: 9.99 },
  { id: 'mega', tokens: 3000, bonusSweeps: 800, priceUsd: 19.99 },
]

/** Look a pack up by id. Null for anything not in the catalogue — never credit. */
export function serverPackById(id: string | null | undefined): ServerTokenPack | null {
  const key = String(id ?? '')
  return SERVER_TOKEN_PACKS.find((p) => p.id === key) ?? null
}

/** Verify a Stripe-Signature header ("t=...,v1=...") against the raw payload. */
function verifyStripeSignature(payload: Buffer, header: string, secret: string): boolean {
  const parts = String(header || '').split(',').map((p) => p.trim())
  const t = parts.find((p) => p.startsWith('t='))?.slice(2)
  const sigs = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3))
  if (!t || !sigs.length) return false
  const expected = createHmac('sha256', secret).update(`${t}.${payload.toString('utf8')}`, 'utf8').digest('hex')
  const exp = Buffer.from(expected, 'hex')
  return sigs.some((s) => {
    const got = Buffer.from(s, 'hex')
    return got.length === exp.length && timingSafeEqual(got, exp)
  })
}

// ---------------------------------------------------------------------------
// CORS — the mobile app is NOT same-origin.
//
// The web build is served by this very container, so its calls carry no Origin
// that matters. The Capacitor APK is different: its WebView serves the bundle
// from `https://localhost` (capacitor.config.ts androidScheme:'https') and calls
// the absolute VITE_API_BASE origin, so every request is cross-origin and needs
// a matching Access-Control-Allow-Origin plus a preflight that permits the
// Authorization header we send the JWT in.
//
// We allow-list rather than reflect `*`, because `*` is incompatible with
// credentials and would also let any website on the internet drive the API with
// a user's browser. Extra origins can be added at deploy time:
//   APP_ORIGINS=https://staging.tko.cam,https://foo.example
// ---------------------------------------------------------------------------
const STATIC_ALLOWED_ORIGINS = [
  'https://localhost', // Capacitor Android (androidScheme: 'https')
  'http://localhost', // Capacitor Android with the http scheme
  'capacitor://localhost', // Capacitor iOS
  'ionic://localhost',
  'https://tko.cam',
  'https://www.tko.cam',
  'https://killcam.app',
  'https://www.killcam.app',
]

/** Any localhost/127.0.0.1 port — the Vite dev server and device port-forwards. */
const LOCAL_DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export function isAllowedOrigin(origin: string | undefined, extra: string[] = []): boolean {
  // No Origin header at all: curl, server-to-server, same-origin navigations and
  // supertest. Nothing to protect — the browser only enforces what it sends.
  if (!origin) return true
  if (STATIC_ALLOWED_ORIGINS.includes(origin)) return true
  if (extra.includes(origin)) return true
  return LOCAL_DEV_ORIGIN.test(origin)
}

const configuredOrigins = (): string[] =>
  String(process.env.APP_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export function createApp(pool: Pooly) {
  const app = express()
  app.use(
    cors({
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin, configuredOrigins())),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
      exposedHeaders: ['Content-Length'],
      maxAge: 86400,
    }),
  )
  // The Stripe webhook needs the UNPARSED body for HMAC signature verification,
  // so mount a raw parser on that exact path BEFORE the global JSON parser.
  // express.json() then skips it (the body stream is already consumed).
  app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }))
  app.use(express.json({ limit: '8mb' }))

  const sign = (u: { id: string; email: string }) =>
    jwt.sign({ sub: u.id, email: u.email }, JWT_SECRET, { expiresIn: '30d' })

  const readToken = (req: Request): any | null => {
    const h = req.headers.authorization || ''
    const t = h.startsWith('Bearer ') ? h.slice(7) : ''
    if (!t) return null
    try { return jwt.verify(t, JWT_SECRET) } catch { return null }
  }
  function auth(req: Request, res: Response, next: NextFunction) {
    const p = readToken(req)
    if (!p) return res.status(401).json({ error: 'unauthorized' })
    ;(req as any).user = p
    next()
  }
  const uid = (req: Request) => (req as any).user.sub as string
  const withTransaction = async <T>(fn: (db: Pooly) => Promise<T>): Promise<T> => {
    if (!pool.connect) {
      // Test doubles should expose connect(), but keep a narrow fallback for
      // callers that provide only Pool#query.
      await pool.query('begin')
      try {
        const value = await fn(pool)
        await pool.query('commit')
        return value
      } catch (error) {
        await pool.query('rollback')
        throw error
      }
    }
    const client = await pool.connect()
    try {
      await client.query('begin')
      const value = await fn(client)
      await client.query('commit')
      return value
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  class ActiveLiveStreamConflict extends Error {
    constructor() {
      super('active live stream already exists')
      this.name = 'ActiveLiveStreamConflict'
    }
  }

  /*
   * pg-mem does not model concurrent row locks reliably, so serialize starts in
   * this app instance as well as taking a database row lock. In production the
   * users-row FOR UPDATE lock coordinates every API instance sharing Postgres.
   */
  const liveStreamMutationTails = new Map<string, Promise<void>>()
  const serializeLiveStreamMutation = async <T>(userId: string, fn: () => Promise<T>): Promise<T> => {
    const previous = liveStreamMutationTails.get(userId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    liveStreamMutationTails.set(userId, current)
    await previous
    try {
      return await fn()
    } finally {
      release()
      if (liveStreamMutationTails.get(userId) === current) liveStreamMutationTails.delete(userId)
    }
  }

  const withLiveStreamStartSlot = async <T>(
    userId: string,
    excludeIds: any[],
    fn: (db: Pooly) => Promise<T>,
  ): Promise<T> => serializeLiveStreamMutation(userId, () => withTransaction(async (db) => {
    await db.query('select id from users where id=$1 for update', [userId])
    const params: any[] = [userId]
    let sql = 'select id from live_streams where user_id=$1 and is_live=true'
    if (excludeIds.length) {
      sql += ` and id not in (${excludeIds.map((id) => {
        params.push(id)
        return `$${params.length}`
      }).join(', ')})`
    }
    sql += ' limit 1'
    if ((await db.query(sql, params)).rows.length) throw new ActiveLiveStreamConflict()
    return fn(db)
  }))

  const sendActiveLiveStreamConflict = (res: Response) =>
    res.status(409).json({
      data: null,
      count: null,
      error: 'active live stream already exists',
    })

  // Normalize a users row into the Supabase-compatible `user` object the
  // frontend expects (user_metadata / app_metadata / aud / created_at).
  const parseMeta = (m: any) => (typeof m === 'string' ? (() => { try { return JSON.parse(m) } catch { return {} } })() : (m || {}))
  const toUser = (row: any) => {
    const meta = parseMeta(row.user_metadata)
    return {
      id: row.id,
      email: row.email,
      user_metadata: {
        username: meta.username ?? row.username ?? null,
        reelone_tier: meta.reelone_tier ?? '',
        reelone_tier_expires: meta.reelone_tier_expires ?? null,
        // Global TKO host capability (set by a founder host code). Surfaced so
        // the client host/admin checks (src/lib/tkoKing.ts isTkoHost) see it.
        tko_host: meta.tko_host === true,
        // Beta tester flag (set by the reusable TKO-BETA code). Surfaced so the
        // client can show tester-only surfaces / the TKO-BETA chat.
        tko_beta: meta.tko_beta === true,
        // Founder ULTRA: unlimited artifact crafting (bypasses the monthly cap).
        artifact_unlimited: meta.artifact_unlimited === true,
      },
      app_metadata: {},
      aud: 'authenticated',
      created_at: row.created_at ?? null,
    }
  }

  // ---- ops (root, not under /api — used by Cloud Run health checks) ----
  app.get('/health', (_req, res) => res.json({ ok: true }))

  const api: Router = express.Router()

  api.get('/health', (_req, res) => res.json({ ok: true }))

  // ==========================================================================
  // AUTH  (JWT HS256, bcrypt, Bearer header)
  // ==========================================================================
  api.post('/auth/signup', async (req, res) => {
    const { email, password, username } = req.body || {}
    if (!email || !password || String(password).length < 6) {
      return res.status(400).json({ error: 'email + 6+ char password required' })
    }

    // ---- 13+ AGE GATE ----------------------------------------------------
    // Re-checked HERE and not only in the UI: the client is not a trust
    // boundary, and "the Terms say 13+" is not enforcement. A date of birth is
    // only accepted when it is present, real, in the past and old enough.
    // Mirrors src/lib/age.ts (MIN_AGE_YEARS) — keep the two in sync.
    const dobRaw = (req.body || {}).date_of_birth ?? (req.body || {}).dob ?? null
    const age = ageFromDob(dobRaw)
    if (age === null) {
      return res.status(400).json({ error: 'a valid date of birth (YYYY-MM-DD) is required' })
    }
    if (age < MIN_AGE_YEARS) {
      return res.status(403).json({ error: `you must be at least ${MIN_AGE_YEARS} years old to create an account` })
    }

    // ---- VERSIONED TERMS + PRIVACY ACCEPTANCE ----------------------------
    // A checked box in the browser is useful UX, but the API is the trust
    // boundary. New accounts are created only when the caller explicitly
    // accepts the exact legal versions currently published by this build.
    const legal = req.body || {}
    const enforceLegalAcceptance = process.env.NODE_ENV !== 'test'
      || process.env.REQUIRE_LEGAL_ACCEPTANCE === 'true'
    if (enforceLegalAcceptance && !isLegalAcceptanceCurrent(legal)) {
      return res.status(400).json({
        error: 'legal_acceptance_required',
        detail: 'You must accept the current Terms of Service and Privacy Policy.',
        terms_version: TERMS_VERSION,
        privacy_version: PRIVACY_VERSION,
      })
    }

    const exists = await pool.query('select id from users where email=$1', [email])
    if (exists.rows.length) return res.status(409).json({ error: 'email already registered' })
    const hash = await bcrypt.hash(String(password), 10)
    const base = (username || String(email).split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '_') || 'user'
    // Persist the signup attestations (terms + age) alongside the handle. Only
    // the known-safe keys are copied through — never a client-supplied tier or
    // host flag (see PRIVILEGE_COLS).
    const attestations: Record<string, any> = {
      terms_accepted: true,
      terms_version: TERMS_VERSION,
      terms_accepted_at: new Date().toISOString(),
      privacy_accepted: true,
      privacy_version: PRIVACY_VERSION,
    }
    attestations.date_of_birth = String(dobRaw).trim()
    attestations.age_at_signup = age
    attestations.age_verified_13_plus = true
    attestations.age_attested_at = new Date().toISOString()
    const meta = JSON.stringify({ username: base, reelone_tier: '', ...attestations })
    const u = await pool.query(
      'insert into users (email, password_hash, user_metadata) values ($1,$2,$3) returning id, email, user_metadata, created_at',
      [email, hash, meta],
    )
    const row = u.rows[0]
    // Create the profile row (the schema trigger does this on real Postgres;
    // pg-mem has no trigger, so do it here too — idempotent either way).
    let uname = base
    // Case-insensitive, matching the `profiles_username_lower_uniq` index in
    // db/schema.sql — usernames are one identity regardless of casing. Exclude
    // THIS user's own row (a schema trigger may have pre-created it) so we don't
    // falsely treat their own name as a clash.
    const clash = await pool.query(
      'select 1 from profiles where lower(username)=lower($1) and id<>$2', [uname, row.id])
    if (clash.rows.length) uname = base + '_' + String(row.id).slice(0, 4)
    // On real Postgres a trigger creates the profile row (often with no
    // username) BEFORE this runs, so `do nothing` would leave the handle blank
    // and the player unsearchable in Discover. Write the username either way.
    await pool.query(
      'insert into profiles (id, username) values ($1,$2) on conflict (id) do update set username = excluded.username',
      [row.id, uname])
    res.json({ token: sign(row), user: toUser(row) })
  })

  api.post('/auth/login', async (req, res) => {
    const { email, password } = req.body || {}
    const r = await pool.query('select id, email, password_hash, user_metadata, created_at from users where email=$1', [email])
    const u = r.rows[0]
    if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash || ''))) {
      return res.status(401).json({ error: 'invalid credentials' })
    }
    res.json({ token: sign(u), user: toUser(u) })
  })

  api.get('/auth/me', async (req, res) => {
    const p = readToken(req)
    if (!p) return res.status(401).json({ error: 'unauthorized' })
    const r = await pool.query(
      'select u.id, u.email, u.user_metadata, u.created_at, p.username from users u left join profiles p on p.id=u.id where u.id=$1',
      [p.sub],
    )
    if (!r.rows[0]) return res.status(401).json({ error: 'unauthorized' })
    res.json({ user: toUser(r.rows[0]) })
  })

  // ==========================================================================
  // GENERIC DATA API  — POST /api/db
  // { table, action, columns?, filters?, order?, limit?, single?, count?, values? }
  // Always parameterized; identifiers validated + whitelisted.
  // ==========================================================================
  const OPS: Record<string, string> = {
    eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike',
  }
  function buildWhere(filters: any[], params: any[]): string {
    if (!Array.isArray(filters) || !filters.length) return ''
    const parts: string[] = []
    for (const f of filters) {
      if (!f || typeof f.col !== 'string' || !IDENT.test(f.col)) throw new Error('invalid filter column')
      const col = q(f.col)
      const op = String(f.op)
      if (op === 'is') {
        if (f.val === null || f.val === undefined) parts.push(`${col} is null`)
        else if (typeof f.val === 'boolean') parts.push(`${col} is ${f.val ? 'true' : 'false'}`)
        else { params.push(f.val); parts.push(`${col} is $${params.length}`) }
      } else if (op === 'in') {
        const arr = Array.isArray(f.val) ? f.val : [f.val]
        params.push(arr)
        parts.push(`${col} = ANY($${params.length})`)
      } else if (OPS[op]) {
        params.push(f.val)
        parts.push(`${col} ${OPS[op]} $${params.length}`)
      } else {
        throw new Error(`unsupported op: ${op}`)
      }
    }
    return ' where ' + parts.join(' and ')
  }

  function selectCols(columns: any): string {
    if (!columns || columns === '*') return '*'
    // Drop embedded-join syntax like "*, profiles(username)"; keep base columns.
    const parts = String(columns)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !s.includes('(') && !s.includes(')'))
    const valid = parts.filter((p) => p === '*' || IDENT.test(p))
    if (!valid.length) return '*'
    return valid.map((p) => (p === '*' ? '*' : q(p))).join(', ')
  }

  /** Resolve the caller into an Actor with its active tier and host capability. */
  const loadActor = async (req: Request): Promise<Actor | null> => {
    const p = readToken(req)
    if (!p?.sub) return null
    const r = await pool.query('select user_metadata from users where id=$1', [p.sub])
    if (!r.rows[0]) return null
    const meta = parseMeta(r.rows[0].user_metadata)
    const tier = activeTierFromMeta(meta)
    return {
      id: String(p.sub),
      host: meta.tko_host === true,
      topTier: tier === TOP_TIER,
      tier,
    }
  }

  /** Does this row belong to the caller, per the policy's owner column(s)? */
  const ownsRow = (pol: TablePolicy, a: Actor, row: any): boolean => {
    const cols = [...(pol.owner ? [pol.owner] : []), ...(pol.ownerAny ?? [])]
    return cols.some((c) => same(row?.[c], a.id))
  }

  const mayElevate = async (pol: TablePolicy, a: Actor, row: any): Promise<boolean> => {
    if (a.host) return true
    if (!pol.elevate) return false
    return pol.elevate(pool, a, row ?? {})
  }

  /**
   * Strip columns a client-driven write may never set. PRIVILEGE_COLS is global
   * (no tier / host / password / balance writes anywhere, ever); ownership and
   * immutableCols never change after insert; elevatedCols requires privilege.
   */
  const scrub = (
    pol: TablePolicy,
    values: any,
    elevated: boolean,
    action: 'insert' | 'update' = 'update',
  ): { values: any; blocked: string[] } => {
    const out: any = {}
    const blocked: string[] = []
    for (const k of Object.keys(values || {})) {
      if (!IDENT.test(k)) continue
      if (PRIVILEGE_COLS.has(k)) { blocked.push(k); continue }
      if (
        action === 'update' &&
        (pol.owner === k || pol.ownerAny?.includes(k) || pol.immutableCols?.includes(k))
      ) {
        blocked.push(k)
        continue
      }
      if (!elevated && pol.elevatedCols?.includes(k)) { blocked.push(k); continue }
      out[k] = values[k]
    }
    return { values: out, blocked }
  }

  const forbidden = (res: Response, detail: string) =>
    res.status(403).json({ data: null, count: null, error: `forbidden: ${detail}` })

  /**
   * Attach the EQUIPPED artifact tag to profile rows. A user equips one artifact
   * tag (see the /api/fn/artifact-tag-* handlers); this joins user_equipped_tag →
   * artifact_tags in ONE query keyed by profiles.id and stamps three fields onto
   * each row so the client renders the tag inline wherever it lists profiles:
   *   equipped_tag_text | equipped_tag_rarity | equipped_tag_id  (null when none)
   * Best-effort: on a slim schema without the tables it silently leaves them null.
   */
  const decorateProfilesWithTag = async (data: any): Promise<void> => {
    const list: any[] = Array.isArray(data) ? data : data ? [data] : []
    const ids = list.map((r) => r?.id).filter((x) => x != null).map((x) => String(x))
    if (!ids.length) return
    const byUser = new Map<string, any>()
    try {
      // Compare as text: profiles.id / user_equipped_tag.user_id are uuid, and a
      // uuid `= ANY(text[])` won't match (this also keeps pg-mem happy). Casting
      // the column to text and passing a text[] matches on both engines.
      const r = await pool.query(
        `select e.user_id, t.tag_text, t.rarity, t.id as artifact_tag_id
           from user_equipped_tag e join artifact_tags t on t.id = e.artifact_tag_id
          where e.user_id::text = ANY($1)`,
        [ids],
      )
      for (const row of r.rows) byUser.set(String(row.user_id), row)
    } catch { return /* tables absent — leave undecorated */ }
    for (const row of list) {
      const t = byUser.get(String(row?.id))
      row.equipped_tag_text = t?.tag_text ?? null
      row.equipped_tag_rarity = t?.rarity ?? null
      row.equipped_tag_id = t?.artifact_tag_id ?? null
    }
  }

  /**
   * Idempotently ensure the single global TKO-BETA tester chat space (and its
   * #general channel) exist, returning its id. Called when a user redeems
   * TKO-BETA so the space is present even on a fresh DB (tests don't run the boot
   * bootstrap). Reuses the existing chat_spaces/chat_channels mechanism.
   */
  const ensureBetaSpace = async (): Promise<string> => {
    await pool.query(
      `insert into chat_spaces (id, kind, name, owner_id, clan_id)
       values ($1,'tko','TKO-BETA',null,null)
       on conflict (id) do nothing`,
      [TKO_BETA_SPACE_ID],
    )
    const ch = await pool.query('select id from chat_channels where space_id=$1 and name=$2', [TKO_BETA_SPACE_ID, 'general'])
    if (!ch.rows.length) {
      try {
        await pool.query(
          `insert into chat_channels (space_id, name, category, position) values ($1,'general','COMMUNITY',0)`,
          [TKO_BETA_SPACE_ID],
        )
      } catch { /* raced — the channel exists either way */ }
    }
    return TKO_BETA_SPACE_ID
  }

  api.post('/db', async (req, res) => {
    const body = req.body || {}
    const table = String(body.table || '')
    const action = String(body.action || 'select')
    const pol = TABLE_POLICY[table]
    // `users` and `redeem_codes` have no policy on purpose — they read as
    // "unknown table" here, exactly like any other non-whitelisted name.
    if (!pol || !TABLES.has(table)) {
      return res.status(400).json({ data: null, count: null, error: `unknown table: ${table}` })
    }

    // Everything except a genuinely public select needs a real, resolvable user.
    const actor = await loadActor(req)
    const needsAuth = action !== 'select' || pol.select !== 'public'
    if (needsAuth && !actor) {
      return res.status(401).json({ data: null, count: null, error: 'unauthorized' })
    }

    try {
      const T = q(table)
      const idCol = pol.idCol ?? 'id'
      const filters: any[] = Array.isArray(body.filters) ? body.filters : []

      if (action === 'select') {
        // Server-side visibility predicate, appended to (never replaced by) the
        // client's filters. Hosts read everything the policy exposes at all.
        const scopeParams: any[] = []
        let scopeSql = ''
        if (actor && !actor.host) {
          if (pol.select === 'owner' && pol.owner) {
            scopeParams.push(actor.id)
            scopeSql = `${q(pol.owner)} = $#${scopeParams.length}`
          } else if (pol.select === 'scoped' && pol.scope) {
            const s = await pol.scope(pool, actor)
            scopeParams.push(s.ids)
            scopeSql = `${q(s.col)} = ANY($#${scopeParams.length})`
          }
        }
        // Re-number the scope placeholders after the client filter params.
        const renumber = (sql: string, offset: number) => sql.replace(/\$#(\d+)/g, (_m, n) => `$${offset + Number(n)}`)
        const clause = (params: any[]): string => {
          const w = buildWhere(filters, params)
          if (!scopeSql) return w
          const s = renumber(scopeSql, params.length)
          params.push(...scopeParams)
          return w ? `${w} and ${s}` : ` where ${s}`
        }

        let count: number | null = null
        if (body.count) {
          const cp: any[] = []
          const cr = await pool.query(`select count(*) as count from ${T}${clause(cp)}`, cp)
          count = Number(cr.rows[0]?.count ?? 0)
        }
        const params: any[] = []
        const where = clause(params)
        let sql = `select ${selectCols(body.columns)} from ${T}${where}`
        if (body.order && typeof body.order.col === 'string' && IDENT.test(body.order.col)) {
          sql += ` order by ${q(body.order.col)} ${body.order.ascending === false ? 'desc' : 'asc'}`
        }
        if (body.single) sql += ' limit 1'
        else if (body.limit != null && Number.isFinite(Number(body.limit))) sql += ` limit ${Number(body.limit)}`
        const r = await pool.query(sql, params)
        const data = body.single ? (r.rows[0] ?? null) : r.rows
        // Decorate profile rows with the caller's/others' EQUIPPED artifact tag
        // so the frontend can render it inline (chat, profile, lists) from the
        // same profiles read it already makes.
        if (table === 'profiles') await decorateProfilesWithTag(data)
        return res.json({ data, count, error: null })
      }

      const a = actor as Actor

      if (action === 'insert') {
        if (pol.insert === 'deny') return forbidden(res, `${table} is not writable through this API`)
        const raw: any[] = Array.isArray(body.values) ? body.values : [body.values]
        if (!raw.length || !raw[0] || typeof raw[0] !== 'object') throw new Error('insert requires values')
        if (
          table === 'live_streams' &&
          raw.some((row) => row && Object.prototype.hasOwnProperty.call(row, 'is_live') && typeof row.is_live !== 'boolean')
        ) {
          throw new Error('live_streams.is_live must be a boolean')
        }

        const rows: any[] = []
        for (const src of raw) {
          const elevated = await mayElevate(pol, a, src)
          const { values } = scrub(pol, src, elevated, 'insert')
          switch (pol.insert) {
            case 'auth':
              break
            case 'owner':
              // The owner column is FORCED — a client-sent owner is ignored.
              if (pol.owner) values[pol.owner] = a.id
              break
            case 'ownerOrElevated':
              if (!elevated && pol.owner) values[pol.owner] = a.id
              break
            case 'elevated':
              if (!elevated) return forbidden(res, `insert into ${table} requires a host/owner role`)
              break
            case 'custom':
              if (!(await pol.insertCheck!(pool, a, values))) {
                return forbidden(res, `not allowed to create this ${table} row`)
              }
              break
          }
          rows.push(values)
        }

        const keys = Object.keys(rows[0])
        if (!keys.length) throw new Error('insert requires at least one column')
        const params: any[] = []
        const tuples = rows.map((row) => {
          const ph = keys.map((k) => { params.push(row?.[k] ?? null); return `$${params.length}` })
          return `(${ph.join(', ')})`
        })
        const sql = `insert into ${T} (${keys.map(q).join(', ')}) values ${tuples.join(', ')} returning *`
        let r: { rows: any[] }
        if (table === 'live_streams' && rows.some((row) => row.is_live === true)) {
          if (rows.filter((row) => row.is_live === true).length > 1) {
            return sendActiveLiveStreamConflict(res)
          }
          try {
            r = await withLiveStreamStartSlot(a.id, [], (db) => db.query(sql, params))
          } catch (error) {
            if (error instanceof ActiveLiveStreamConflict) return sendActiveLiveStreamConflict(res)
            throw error
          }
        } else {
          r = await pool.query(sql, params)
        }
        const data = body.single ? (r.rows[0] ?? null) : r.rows
        return res.json({ data, count: r.rows.length, error: null })
      }

      if (action === 'update' || action === 'delete') {
        if (pol.write === 'deny') return forbidden(res, `${table} is not writable through this API`)
        if (
          action === 'update' &&
          table === 'live_streams' &&
          Object.prototype.hasOwnProperty.call(body.values || {}, 'is_live') &&
          typeof body.values.is_live !== 'boolean'
        ) {
          throw new Error('live_streams.is_live must be a boolean')
        }

        // AUTHORIZE FIRST. Read back exactly the rows the client's filters would
        // hit, then require that every one of them is owned (or role-permitted).
        // The write is then re-targeted at those primary keys, so a client filter
        // can only ever NARROW what is touched — never widen it.
        const rp: any[] = []
        const matched = (await pool.query(`select * from ${T}${buildWhere(filters, rp)}`, rp)).rows
        if (!matched.length) {
          return res.json({ data: body.single ? null : [], count: 0, error: null })
        }
        let anyElevated = false
        for (const row of matched) {
          const owned = pol.write !== 'elevated' && ownsRow(pol, a, row)
          const elevated = await mayElevate(pol, a, row)
          if (elevated) anyElevated = true
          if (!owned && !elevated) {
            return forbidden(res, `you do not own this ${table} row`)
          }
        }
        const ids = matched.map((r: any) => r[idCol])
        /** `"id" in ($n, $n+1, ...)` — an explicit list rather than `= ANY()`, which
         *  the in-memory Postgres used by the tests does not honour in UPDATE/DELETE. */
        const idIn = (params: any[]): string =>
          `${q(idCol)} in (${ids.map((v) => { params.push(v); return `$${params.length}` }).join(', ')})`

        if (action === 'update') {
          const { values, blocked } = scrub(pol, body.values || {}, anyElevated)
          const keys = Object.keys(values)
          if (!keys.length) {
            if (blocked.length) return forbidden(res, `cannot set ${blocked.join(', ')} through this API`)
            throw new Error('update requires values')
          }
          const params: any[] = []
          const set = keys.map((k) => { params.push(values[k] ?? null); return `${q(k)} = $${params.length}` }).join(', ')
          const sql = `update ${T} set ${set} where ${idIn(params)} returning *`
          let r: { rows: any[] }
          if (table === 'live_streams' && values.is_live === true) {
            if (matched.length !== 1) return sendActiveLiveStreamConflict(res)
            const stream = matched[0]
            if (!ownsRow(pol, a, stream)) {
              return forbidden(res, 'only the broadcaster may start this live_streams row')
            }
            if (!(await canStartLiveStream(pool, a, stream))) {
              return forbidden(res, 'not allowed to start this live_streams row')
            }
            try {
              r = await withLiveStreamStartSlot(
                String(stream.user_id),
                [stream[idCol]],
                (db) => db.query(sql, params),
              )
            } catch (error) {
              if (error instanceof ActiveLiveStreamConflict) return sendActiveLiveStreamConflict(res)
              throw error
            }
          } else {
            r = await pool.query(sql, params)
          }
          const data = body.single ? (r.rows[0] ?? null) : r.rows
          return res.json({ data, count: r.rows.length, error: null })
        }

        const dp: any[] = []
        const sql = `delete from ${T} where ${idIn(dp)} returning *`
        const r = await pool.query(sql, dp)
        const data = body.single ? (r.rows[0] ?? null) : r.rows
        return res.json({ data, count: r.rows.length, error: null })
      }

      return res.status(400).json({ data: null, count: null, error: `unknown action: ${action}` })
    } catch (e: any) {
      return res.status(400).json({ data: null, count: null, error: e?.message || 'db error' })
    }
  })

  // ==========================================================================
  // ECONOMY — the trusted paths that MINT value.
  //
  // These helpers are the only code in the process that increases a balance or
  // creates an ownership row. The generic /api/db API cannot do either (see the
  // 'deny' policies on wallets / wallet_ledger / asset_ownership / predictions),
  // so "can a user credit their own wallet?" has exactly one answer: only by
  // going through a handler below, which computes the amount from server state.
  // ==========================================================================

  /** Read a user's wallet, creating the zero row on first touch. */
  type WalletSnapshot = { tokens: number; sweeps: number; paid_sweeps_cents: number }
  const readWalletRow = async (userId: string): Promise<WalletSnapshot> => {
    const r = await pool.query('select tokens, sweeps, paid_sweeps_cents from wallets where user_id=$1', [userId])
    if (r.rows[0]) return {
      tokens: Number(r.rows[0].tokens ?? 0),
      sweeps: Number(r.rows[0].sweeps ?? 0),
      paid_sweeps_cents: Number(r.rows[0].paid_sweeps_cents ?? 0),
    }
    try {
      await pool.query('insert into wallets (user_id, tokens, sweeps, paid_sweeps_cents) values ($1,0,0,0)', [userId])
    } catch { /* raced with a concurrent create — the row exists either way */ }
    return { tokens: 0, sweeps: 0, paid_sweeps_cents: 0 }
  }

  type LedgerInput = {
    kind: 'purchase' | 'grant' | 'spend' | 'prediction' | 'tournament' | 'clan_dues' | 'marketplace' | 'adjustment' | 'wager'
    event?: string | null
    result?: 'Win' | 'Loss' | null
    prize?: string | null
    status?: 'Pending' | 'Paid'
    reason?: string | null
    refId?: string | null
  }

  /** Append-only audit row. Every balance move and every settled prize books one. */
  const bookLedger = async (
    userId: string,
    tokensDelta: number,
    sweepsDelta: number,
    l: LedgerInput,
    paidSweepsDeltaCents = 0,
  ): Promise<void> => {
    await pool.query(
      `insert into wallet_ledger
         (user_id, kind, tokens_delta, sweeps_delta, paid_sweeps_delta_cents,
          event, result, prize, status, reason, ref_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [userId, l.kind, tokensDelta, sweepsDelta, paidSweepsDeltaCents,
        l.event ?? null, l.result ?? null, l.prize ?? null,
        l.status ?? 'Paid', l.reason ?? null, l.refId ?? null],
    )
  }

  /** Apply a balance delta (clamped at zero, never negative) + book the ledger row. */
  const moveWallet = async (
    userId: string,
    d: { tokens?: number; sweeps?: number; paidSweepsCents?: number },
    l: LedgerInput,
  ): Promise<WalletSnapshot> => {
    const cur = await readWalletRow(userId)
    const next = {
      tokens: Math.max(0, cur.tokens + Math.round(d.tokens ?? 0)),
      sweeps: Math.max(0, cur.sweeps + Math.round(d.sweeps ?? 0)),
      paid_sweeps_cents: Math.max(0, cur.paid_sweeps_cents + Math.round(d.paidSweepsCents ?? 0)),
    }
    await pool.query(
      `update wallets
          set tokens=$1, sweeps=$2, paid_sweeps_cents=$3, updated_at=$4
        where user_id=$5`,
      [next.tokens, next.sweeps, next.paid_sweeps_cents, new Date().toISOString(), userId],
    )
    await bookLedger(
      userId,
      next.tokens - cur.tokens,
      next.sweeps - cur.sweeps,
      l,
      next.paid_sweeps_cents - cur.paid_sweeps_cents,
    )
    return next
  }

  /** Atomically credit utility Tokens and append the matching audit row. */
  const creditTokens = async (
    userId: string, amount: number, l: LedgerInput,
  ): Promise<WalletSnapshot> => {
    await readWalletRow(userId)
    const credit = Math.max(0, Math.round(amount))
    if (credit === 0) return readWalletRow(userId)
    const r = await pool.query(
      `update wallets
          set tokens = tokens + $2, updated_at = now()
        where user_id = $1
        returning tokens, sweeps, paid_sweeps_cents`,
      [userId, credit],
    )
    await bookLedger(userId, credit, 0, l)
    return {
      tokens: Number(r.rows[0]?.tokens ?? 0),
      sweeps: Number(r.rows[0]?.sweeps ?? 0),
      paid_sweeps_cents: Number(r.rows[0]?.paid_sweeps_cents ?? 0),
    }
  }

  /**
   * Atomically DEBIT tokens: subtract `amount` only if the wallet still holds it,
   * in one guarded UPDATE. Postgres row-locks the wallet for the update, so
   * concurrent debits serialize and the loser sees too few tokens — this is the
   * fix for the buy / clan-pay double-spend races (the old read-check-then-
   * moveWallet let a stampede all pass the check and each debit). Books the
   * ledger only when the debit actually happened. Never goes negative.
   */
  const spendTokens = async (
    userId: string, amount: number, l: LedgerInput,
  ): Promise<{ ok: boolean } & WalletSnapshot> => {
    await readWalletRow(userId) // ensure the wallet row exists to lock
    const spend = Math.max(0, Math.round(amount))
    if (spend === 0) return { ok: true, ...(await readWalletRow(userId)) }
    const r = await pool.query(
      `update wallets set tokens = tokens - $2, updated_at = now()
         where user_id = $1 and tokens >= $2
       returning tokens, sweeps, paid_sweeps_cents`,
      [userId, spend],
    )
    if (!r.rows[0]) return { ok: false, ...(await readWalletRow(userId)) }
    await bookLedger(userId, -spend, 0, l)
    return {
      ok: true,
      tokens: Number(r.rows[0].tokens ?? 0),
      sweeps: Number(r.rows[0].sweeps ?? 0),
      paid_sweeps_cents: Number(r.rows[0].paid_sweeps_cents ?? 0),
    }
  }

  /**
   * Atomically DEBIT sweeps: the SWEEPS twin of spendTokens above. Same guarded
   * single UPDATE (Postgres row-locks the wallet, so concurrent debits serialize
   * and only the debit that still fits succeeds), so a wager stake can never
   * over-draw a balance or be double-spent by a stampede. Books a ledger row
   * only when the debit actually landed. Never goes negative.
   *
   * WAGERS ARE SWEEPS-ONLY BY DESIGN. Sweeps are the in-app, NON-cashable
   * currency (they have no real-money redemption anywhere in the app), so staking
   * them is play, not gambling. Tokens are bought with real money and therefore
   * MUST NEVER be stakeable — there is deliberately no spendTokens call in any
   * wager handler, and the place handler rejects any token-stake attempt outright.
   */
  const spendSweeps = async (
    userId: string, amount: number, l: LedgerInput,
  ): Promise<{ ok: boolean } & WalletSnapshot> => {
    await readWalletRow(userId) // ensure the wallet row exists to lock
    const spend = Math.max(0, Math.round(amount))
    if (spend === 0) return { ok: true, ...(await readWalletRow(userId)) }
    const r = await pool.query(
      `update wallets set sweeps = sweeps - $2, updated_at = now()
         where user_id = $1 and sweeps >= $2
       returning tokens, sweeps, paid_sweeps_cents`,
      [userId, spend],
    )
    if (!r.rows[0]) return { ok: false, ...(await readWalletRow(userId)) }
    await bookLedger(userId, 0, -spend, l)
    return {
      ok: true,
      tokens: Number(r.rows[0].tokens ?? 0),
      sweeps: Number(r.rows[0].sweeps ?? 0),
      paid_sweeps_cents: Number(r.rows[0].paid_sweeps_cents ?? 0),
    }
  }

  /** Credit only the dollar-backed marketplace balance after Stripe verifies it. */
  const creditPaidSweeps = async (
    db: Pooly,
    userId: string,
    cents: number,
    l: LedgerInput,
  ): Promise<WalletSnapshot> => {
    const amount = Math.max(0, Math.round(cents))
    await db.query(
      `insert into wallets (user_id, tokens, sweeps, paid_sweeps_cents)
       values ($1,0,0,0) on conflict (user_id) do nothing`,
      [userId],
    )
    if (!amount) return readWalletRow(userId)
    const r = await db.query(
      `update wallets
          set paid_sweeps_cents = paid_sweeps_cents + $2, updated_at = now()
        where user_id = $1
        returning tokens, sweeps, paid_sweeps_cents`,
      [userId, amount],
    )
    await db.query(
      `insert into wallet_ledger
         (user_id, kind, tokens_delta, sweeps_delta, paid_sweeps_delta_cents,
          event, result, prize, status, reason, ref_id)
       values ($1,$2,0,0,$3,$4,$5,$6,$7,$8,$9)`,
      [userId, l.kind, amount, l.event ?? null, l.result ?? null, l.prize ?? null,
        l.status ?? 'Paid', l.reason ?? null, l.refId ?? null],
    )
    return {
      tokens: Number(r.rows[0]?.tokens ?? 0),
      sweeps: Number(r.rows[0]?.sweeps ?? 0),
      paid_sweeps_cents: Number(r.rows[0]?.paid_sweeps_cents ?? 0),
    }
  }

  /** Guarded debit used only by the paid-credit creator marketplace path. */
  const debitPaidSweeps = async (
    db: Pooly,
    userId: string,
    cents: number,
    l: LedgerInput,
  ): Promise<({ ok: boolean } & WalletSnapshot)> => {
    const amount = Math.max(0, Math.round(cents))
    await db.query(
      `insert into wallets (user_id, tokens, sweeps, paid_sweeps_cents)
       values ($1,0,0,0) on conflict (user_id) do nothing`,
      [userId],
    )
    const r = await db.query(
      `update wallets
          set paid_sweeps_cents = paid_sweeps_cents - $2, updated_at = now()
        where user_id = $1 and paid_sweeps_cents >= $2
        returning tokens, sweeps, paid_sweeps_cents`,
      [userId, amount],
    )
    if (!r.rows[0]) {
      const current = await db.query(
        'select tokens, sweeps, paid_sweeps_cents from wallets where user_id=$1',
        [userId],
      )
      const row = current.rows[0] || {}
      return {
        ok: false,
        tokens: Number(row.tokens ?? 0),
        sweeps: Number(row.sweeps ?? 0),
        paid_sweeps_cents: Number(row.paid_sweeps_cents ?? 0),
      }
    }
    await db.query(
      `insert into wallet_ledger
         (user_id, kind, tokens_delta, sweeps_delta, paid_sweeps_delta_cents,
          event, result, prize, status, reason, ref_id)
       values ($1,$2,0,0,$3,$4,$5,$6,$7,$8,$9)`,
      [userId, l.kind, -amount, l.event ?? null, l.result ?? null, l.prize ?? null,
        l.status ?? 'Paid', l.reason ?? null, l.refId ?? null],
    )
    return {
      ok: true,
      tokens: Number(r.rows[0].tokens ?? 0),
      sweeps: Number(r.rows[0].sweeps ?? 0),
      paid_sweeps_cents: Number(r.rows[0].paid_sweeps_cents ?? 0),
    }
  }

  /** Ensure a platform artifact (Oracle reward / King prize) exists in the catalogue. */
  const upsertArtifact = async (a: ArtifactRow): Promise<void> => {
    const ex = await pool.query('select id from assets where id=$1', [a.id])
    if (ex.rows.length) return
    await pool.query(
      `insert into assets (id, name, team_name, image_url, price_tokens, kind, created_by, origin)
       values ($1,$2,$3,$4,$5,$6,null,$7)`,
      [a.id, a.name, a.team_name, a.image_url, a.price_tokens, a.kind, a.origin],
    )
  }

  /** Does this user already own this asset? */
  const ownsAssetRow = async (userId: string, assetId: string): Promise<boolean> => {
    const ex = await pool.query('select id from asset_ownership where user_id=$1 and asset_id=$2', [userId, assetId])
    return ex.rows.length > 0
  }

  /** Record ownership. Idempotent — returns false when the user already owns it. */
  const grantOwnership = async (
    userId: string, assetId: string, source: 'purchase' | 'reward' | 'prize' | 'grant', refId?: string | null,
  ): Promise<boolean> => {
    const ex = await pool.query('select id from asset_ownership where user_id=$1 and asset_id=$2', [userId, assetId])
    if (ex.rows.length) return false
    try {
      await pool.query(
        'insert into asset_ownership (user_id, asset_id, source, ref_id) values ($1,$2,$3,$4)',
        [userId, assetId, source, refId ?? null],
      )
    } catch {
      // Raced with a concurrent grant of the SAME asset — the unique index
      // (uq_asset_ownership) rejected the duplicate. Treat as "already owned".
      return false
    }
    return true
  }

  /** Upsert-increment the victor's Shinobi Trophy Closet entry for a defeated foe. */
  const recordDefeat = async (winner: string, loser: string): Promise<void> => {
    if (!winner || !loser || String(winner) === String(loser)) return
    const ex = await pool.query(
      'select id, beat_count from shinobi_defeats where user_id=$1 and opponent_id=$2', [winner, loser],
    )
    if (ex.rows[0]) {
      await pool.query(
        'update shinobi_defeats set beat_count=$1, updated_at=$2 where id=$3',
        [Number(ex.rows[0].beat_count ?? 1) + 1, new Date().toISOString(), ex.rows[0].id],
      )
    } else {
      await pool.query(
        'insert into shinobi_defeats (user_id, opponent_id, beat_count) values ($1,$2,1)', [winner, loser],
      )
    }
  }

  const tournamentName = async (id: any): Promise<string> => {
    const t = await one(pool, 'select name from tournaments where id=$1', [id])
    return (t?.name as string) || 'Tournament'
  }

  const prizeSplitForPlaces = (paidPlaces: number): number[] => {
    if (paidPlaces === 1) return [10_000]
    if (paidPlaces === 2) return [7000, 3000]
    return [...DEFAULT_PRIZE_SPLIT_BPS]
  }

  const tournamentPrizePoolView = async (
    tournamentId: string,
    viewerId: string,
  ): Promise<any> => {
    const poolRow = await one(
      pool,
      `select * from tournament_prize_pools
        where tournament_id=$1
        order by created_at desc
        limit 1`,
      [tournamentId],
    )
    if (!poolRow) return null
    const entries = (await pool.query(
      `select e.id, e.user_id, e.amount, e.status, e.entered_at,
              p.username, p.avatar_url
         from tournament_prize_entries e
         left join profiles p on p.id=e.user_id
        where e.pool_id=$1
        order by e.entered_at asc, e.id asc`,
      [poolRow.id],
    )).rows
    const payouts = (await pool.query(
      `select o.id, o.user_id, o.placement, o.gross_amount, o.net_amount,
              o.status, o.paid_at, p.username, p.avatar_url
         from tournament_prize_payouts o
         left join profiles p on p.id=o.user_id
        where o.pool_id=$1
        order by o.placement asc`,
      [poolRow.id],
    )).rows
    const pot = entries
      .filter((entry: any) => entry.status !== 'refunded' && entry.status !== 'pending')
      .reduce((sum: number, entry: any) => sum + Number(entry.amount || 0), 0)
    return {
      ...poolRow,
      prize_split_bps: parsePrizeSplitBps(poolRow.prize_split_bps),
      entries,
      payouts,
      pot,
      mine: entries.find((entry: any) => same(entry.user_id, viewerId)) ?? null,
    }
  }

  const effectsFrom = (value: unknown): ConquestEffect[] => {
    let parsed = value
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed) } catch { return [] }
    }
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((effect: any) => ({
        kind: String(effect?.kind || ''),
        amount: Math.max(0, Math.floor(Number(effect?.amount || 0))),
      }))
      .filter((effect: any) => (
        ['kill_lead', 'base_shield_hours', 'territory_tiles', 'basic_clan_passes', 'rivalry_resets']
          .includes(effect.kind) &&
        effect.amount > 0
      )) as ConquestEffect[]
  }

  const conquestTierForUser = async (userId: string): Promise<ConquestMembershipTier | null> => {
    const row = await one(pool, 'select user_metadata from users where id=$1', [userId])
    const tier = paidContentTier(parseMeta(row?.user_metadata))
    return (['pro', 'supporter', 'creator'] as string[]).includes(tier)
      ? tier as ConquestMembershipTier
      : null
  }

  const expireConquestActivations = async (db: Pooly, clanId: string) => {
    await db.query(
      `update conquest_artifact_activations
          set status='expired'
        where clan_id=$1 and status='active'
          and expires_at is not null and expires_at <= now()`,
      [clanId],
    )
  }

  const claimConnectedTerritories = async (
    db: Pooly,
    clanId: string,
    requested: number,
  ): Promise<string[]> => {
    const count = Math.max(0, Math.floor(requested))
    if (!count) return []
    const rows = (await db.query(
      'select id, col, row, owner_clan_id from territories order by row asc, col asc',
    )).rows
    const occupied = rows
      .filter((row: any) => same(row.owner_clan_id, clanId))
      .map((row: any) => ({ col: Number(row.col), row: Number(row.row) }))
    const unowned = rows.filter((row: any) => row.owner_clan_id == null)
    const claimed: string[] = []

    while (claimed.length < count && unowned.length > 0) {
      let index = -1
      if (occupied.length > 0) {
        index = unowned.findIndex((candidate: any) => occupied.some((owned) => (
          Math.abs(Number(candidate.col) - owned.col) +
          Math.abs(Number(candidate.row) - owned.row) === 1
        )))
      }
      // A brand-new clan may plant its first flag on the first open map tile.
      if (index < 0 && occupied.length === 0) index = 0
      if (index < 0) break
      const candidate = unowned.splice(index, 1)[0]
      const updated = await db.query(
        `update territories
            set owner_clan_id=$1, captured_at=now()
          where id=$2 and owner_clan_id is null
          returning id, col, row`,
        [clanId, candidate.id],
      )
      if (!updated.rows.length) continue
      claimed.push(String(updated.rows[0].id))
      occupied.push({
        col: Number(updated.rows[0].col),
        row: Number(updated.rows[0].row),
      })
    }
    return claimed
  }

  const conquestArtifactStatus = async (clanId: string, viewerId: string) => {
    await expireConquestActivations(pool, clanId)
    const activations = (await pool.query(
      `select a.*, r.name as artifact_name
         from conquest_artifact_activations a
         left join artifacts r on r.id=a.artifact_id
        where a.clan_id=$1
        order by a.activated_at desc`,
      [clanId],
    )).rows
    const passPools = (await pool.query(
      `select id, total_count, remaining_count, duration_days, created_at
         from clan_basic_pass_pools
        where clan_id=$1
        order by created_at desc`,
      [clanId],
    )).rows
    const myPass = await one(
      pool,
      `select id, starts_at, expires_at
         from clan_basic_pass_entitlements
        where clan_id=$1 and user_id=$2 and expires_at > now()
        order by expires_at desc limit 1`,
      [clanId, viewerId],
    )
    const state = await one(pool, 'select * from clan_conquest_state where clan_id=$1', [clanId])
    const territories = (await pool.query(
      `select id, name, col, row, captured_at, protected_until
         from territories where owner_clan_id=$1 order by row, col`,
      [clanId],
    )).rows
    return {
      activations,
      pass_pools: passPools,
      my_pass: myPass,
      state,
      territories,
    }
  }

  /**
   * The economy function dispatcher. Returns true when it handled the call.
   * Business refusals answer 200 with { ok:false, reason } so the client gets a
   * structured result (the Supabase functions shim treats non-2xx as an error).
   */
  const handleEconomyFn = async (name: string, req: Request, res: Response): Promise<boolean> => {
    const body = req.body || {}
    const me = uid(req)

    // TKO's economy is giving and prestige only. Keep this guard ahead of every
    // legacy handler so an outdated client cannot reopen wagering.
    if (name.startsWith('wager-')) {
      res.status(410).json({
        ok: false,
        reason: 'feature-retired',
        error: 'Wagering is not available. TKO uses Give Points for support and prestige.',
      })
      return true
    }

    // ========================================================================
    // SHINOBI CONQUEST ARTIFACTS
    //
    // A client selects a source-controlled recipe code. It cannot submit power
    // amounts. Regular recipes are gated by tier, monthly forge/effect caps,
    // and active slots. Official over-cap recipes are source-controlled and
    // can only be forged by a global TKO host.
    // ========================================================================
    if (name === 'conquest-artifact-config') {
      const tier = await conquestTierForUser(me)
      const actor = await loadActor(req)
      res.json({
        ok: true,
        tier,
        limits: tier ? CONQUEST_TIER_LIMITS[tier] : null,
        recipes: CONQUEST_ARTIFACT_RECIPES,
        official_recipes: actor?.host ? OFFICIAL_CONQUEST_ARTIFACT_RECIPES : [],
      })
      return true
    }

    if (name === 'conquest-artifact-status') {
      const clanId = String(body.clanId || '')
      if (!clanId) {
        res.json({ ok: false, reason: 'invalid-clan' })
        return true
      }
      res.json({ ok: true, ...(await conquestArtifactStatus(clanId, me)) })
      return true
    }

    if (name === 'conquest-artifact-forge') {
      const actor = await loadActor(req)
      const clanId = String(body.clanId || '')
      const recipeCode = String(body.recipeCode || '')
      const requestedOfficial = body.official === true
      const recipe = conquestRecipe(recipeCode, requestedOfficial && actor?.host === true)
      if (!actor || !clanId || !recipe) {
        res.json({ ok: false, reason: 'invalid-recipe-or-clan' })
        return true
      }
      if (!(await isClanManager(pool, actor, clanId))) {
        res.status(403).json({ ok: false, error: 'only a clan leader or officer may forge clan powers' })
        return true
      }
      if (recipe.officialOnly && !actor.host) {
        res.status(403).json({ ok: false, error: 'official tournament artifacts are TKO-host issued' })
        return true
      }
      const tier = await conquestTierForUser(actor.id)
      if (!recipe.officialOnly && (!tier || !conquestTierAllows(tier, recipe))) {
        res.json({ ok: false, reason: 'membership-upgrade-required', minimum_tier: recipe.minimumTier })
        return true
      }
      if (!recipe.officialOnly && tier) {
        const monthStart = new Date()
        monthStart.setUTCDate(1)
        monthStart.setUTCHours(0, 0, 0, 0)
        const forged = await one(
          pool,
          `select count(*)::int n from artifacts
            where owner_id=$1 and recipe_code is not null
              and official_override=false and created_at >= $2`,
          [actor.id, monthStart.toISOString()],
        )
        if (Number(forged?.n || 0) >= CONQUEST_TIER_LIMITS[tier].monthlyForges) {
          res.json({
            ok: false,
            reason: 'monthly-forge-cap',
            limit: CONQUEST_TIER_LIMITS[tier].monthlyForges,
          })
          return true
        }
      }
      const imageUrl = String(body.imageUrl || '').slice(0, 6_000_000)
      const row = (await pool.query(
        `insert into artifacts
           (owner_id, slug, name, rarity, capability, image_url, price_cents,
            recipe_code, forge_tier, power_payload, power_score, slot_cost,
            official_override, clan_id)
         values ($1,$2,$3,$4,'conquest_power',$5,$6,$2,$7,$8,$9,$10,$11,$12)
         returning *`,
        [
          actor.id,
          recipe.code,
          recipe.name,
          recipe.rarity,
          imageUrl || null,
          recipe.listPriceCents || null,
          tier || 'creator',
          JSON.stringify(recipe.effects),
          conquestPowerScore(recipe.effects),
          recipe.slotCost,
          recipe.officialOnly === true,
          clanId,
        ],
      )).rows[0]
      res.json({ ok: true, artifact: row, recipe })
      return true
    }

    if (name === 'conquest-artifact-activate') {
      const actor = await loadActor(req)
      const artifactId = String(body.artifactId || '')
      const requestedTargetId = String(body.targetTerritoryId || '')
      if (!actor || !artifactId) {
        res.json({ ok: false, reason: 'invalid-artifact' })
        return true
      }
      const artifact = await one(
        pool,
        `select * from artifacts
          where id=$1 and (owner_id=$2 or redeemed_by=$2)`,
        [artifactId, actor.id],
      )
      if (!artifact?.recipe_code || artifact.used_at) {
        res.json({ ok: false, reason: artifact?.used_at ? 'already-used' : 'not-owned-or-not-powered' })
        return true
      }
      const recipe = conquestRecipe(String(artifact.recipe_code), artifact.official_override === true)
      const clanId = String(artifact.clan_id || '')
      if (!recipe || !clanId || !(await isClanManager(pool, actor, clanId))) {
        res.status(403).json({ ok: false, error: 'artifact cannot be activated for this clan' })
        return true
      }
      const tier = await conquestTierForUser(actor.id)
      if (!artifact.official_override && (!tier || !conquestTierAllows(tier, recipe))) {
        res.json({ ok: false, reason: 'membership-upgrade-required', minimum_tier: recipe.minimumTier })
        return true
      }

      const outcome = await withTransaction(async (db) => {
        const lockedArtifact = (await db.query(
          'select * from artifacts where id=$1 for update',
          [artifactId],
        )).rows[0]
        if (!lockedArtifact || lockedArtifact.used_at) return { ok: false, reason: 'already-used' }

        await expireConquestActivations(db, clanId)
        const activeRows = (await db.query(
          `select slot_cost, effects from conquest_artifact_activations
            where clan_id=$1 and status='active'`,
          [clanId],
        )).rows
        const activeSlotCost = activeRows.reduce(
          (sum: number, row: any) => sum + Number(row.slot_cost || 0),
          0,
        )
        if (
          !artifact.official_override &&
          (!tier || !canActivateConquestArtifact({ tier, activeSlotCost, recipe }))
        ) {
          return {
            ok: false,
            reason: 'active-slot-cap',
            used: activeSlotCost,
            limit: tier ? CONQUEST_TIER_LIMITS[tier].activeSlots : 0,
          }
        }

        if (!artifact.official_override && tier) {
          const monthStart = new Date()
          monthStart.setUTCDate(1)
          monthStart.setUTCHours(0, 0, 0, 0)
          const monthRows = (await db.query(
            `select effects from conquest_artifact_activations
              where clan_id=$1 and official_override=false and activated_at >= $2`,
            [clanId, monthStart.toISOString()],
          )).rows
          const usedThisMonth = monthRows.flatMap((row: any) => effectsFrom(row.effects))
          const effectCheck = canUseConquestEffects({
            tier,
            usedThisMonth,
            next: recipe.effects,
          })
          if (!effectCheck.allowed) {
            return {
              ok: false,
              reason: 'monthly-effect-cap',
              exceeded: effectCheck.exceeded,
            }
          }
        }

        const shield = recipe.effects.find((effect) => effect.kind === 'base_shield_hours')
        let targetTerritory: any = null
        if (shield) {
          if (requestedTargetId) {
            targetTerritory = (await db.query(
              'select * from territories where id=$1 and owner_clan_id=$2 for update',
              [requestedTargetId, clanId],
            )).rows[0]
          } else {
            targetTerritory = (await db.query(
              `select * from territories
                where owner_clan_id=$1
                order by captured_at asc nulls last, row asc, col asc
                limit 1 for update`,
              [clanId],
            )).rows[0]
          }
          if (!targetTerritory) return { ok: false, reason: 'clan-base-required' }
        }

        const expiresAt = recipe.durationHours > 0
          ? new Date(Date.now() + recipe.durationHours * 3_600_000)
          : null
        const status = expiresAt ? 'active' : 'consumed'
        const activation = (await db.query(
          `insert into conquest_artifact_activations
             (artifact_id, user_id, clan_id, recipe_code, effects, slot_cost,
              official_override, target_territory_id, status, expires_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           returning *`,
          [
            artifactId,
            actor.id,
            clanId,
            recipe.code,
            JSON.stringify(recipe.effects),
            recipe.slotCost,
            artifact.official_override === true,
            targetTerritory?.id ?? null,
            status,
            expiresAt?.toISOString() ?? null,
          ],
        )).rows[0]

        const territoryEffect = recipe.effects.find((effect) => effect.kind === 'territory_tiles')
        const claimedTerritoryIds = territoryEffect
          ? await claimConnectedTerritories(db, clanId, territoryEffect.amount)
          : []

        if (shield && targetTerritory) {
          const nextProtection = new Date(Date.now() + shield.amount * 3_600_000)
          const currentProtection = targetTerritory.protected_until
            ? new Date(targetTerritory.protected_until)
            : null
          const protectedUntil = (
            currentProtection && currentProtection.getTime() > nextProtection.getTime()
          ) ? currentProtection : nextProtection
          await db.query(
            `update territories
                set protected_until=$1, protected_by_artifact_id=$2
              where id=$3`,
            [protectedUntil.toISOString(), artifactId, targetTerritory.id],
          )
        }

        const passes = recipe.effects.find((effect) => effect.kind === 'basic_clan_passes')
        if (passes) {
          await db.query(
            `insert into clan_basic_pass_pools
               (clan_id, source_artifact_id, total_count, remaining_count, duration_days)
             values ($1,$2,$3,$3,30)`,
            [clanId, artifactId, passes.amount],
          )
        }

        const reset = recipe.effects.find((effect) => effect.kind === 'rivalry_resets')
        if (reset) {
          await db.query(
            `insert into clan_conquest_state
               (clan_id, rivalry_reset_at, reset_count, updated_at)
             values ($1,now(),$2,now())
             on conflict (clan_id) do update
               set rivalry_reset_at=now(),
                   reset_count=clan_conquest_state.reset_count+$2::integer,
                   updated_at=now()`,
            [clanId, reset.amount],
          )
        }

        await db.query('update artifacts set used_at=now() where id=$1', [artifactId])
        return {
          ok: true,
          activation,
          claimed_territory_ids: claimedTerritoryIds,
          protected_territory_id: targetTerritory?.id ?? null,
          pass_count: passes?.amount ?? 0,
          rivalry_reset: Boolean(reset),
        }
      })
      res.json(outcome)
      return true
    }

    if (name === 'conquest-pass-claim') {
      const clanId = String(body.clanId || '')
      const actor = await loadActor(req)
      if (!actor || !clanId || !(await isClanMember(pool, actor, clanId))) {
        res.status(403).json({ ok: false, error: 'an active clan member is required' })
        return true
      }
      const outcome = await withTransaction(async (db) => {
        const existing = await db.query(
          `select * from clan_basic_pass_entitlements
            where clan_id=$1 and user_id=$2 and expires_at > now()
            order by expires_at desc limit 1`,
          [clanId, actor.id],
        )
        if (existing.rows.length) {
          return { ok: true, claimed: false, reason: 'already-active', pass: existing.rows[0] }
        }
        const available = (await db.query(
          `select * from clan_basic_pass_pools
            where clan_id=$1 and remaining_count > 0
            order by created_at asc limit 1 for update`,
          [clanId],
        )).rows[0]
        if (!available) return { ok: false, reason: 'no-passes-available' }
        const expiresAt = new Date(Date.now() + Number(available.duration_days || 30) * 86_400_000)
        const pass = (await db.query(
          `insert into clan_basic_pass_entitlements
             (source_pool_id, clan_id, user_id, expires_at)
           values ($1,$2,$3,$4)
           returning *`,
          [available.id, clanId, actor.id, expiresAt.toISOString()],
        )).rows[0]
        await db.query(
          `update clan_basic_pass_pools
              set remaining_count=remaining_count-1
            where id=$1 and remaining_count > 0`,
          [available.id],
        )
        return { ok: true, claimed: true, pass }
      })
      res.json(outcome)
      return true
    }

    // ========================================================================
    // TOURNAMENT PRIZE POOLS
    //
    // Live settlement is intentionally limited to non-cashable Sweeps. The
    // cash contract is visible to the UI so the approved-provider integration
    // has a stable home, but this process never sends paid tournament entry
    // money through Stripe. Stripe classifies paid-entry gaming tournaments as
    // restricted gambling activity.
    // ========================================================================
    if (name === 'tournament-prize-config') {
      res.json({
        ok: true,
        sweeps: {
          available: true,
          currency: 'sweeps',
          cash_value: false,
          redeemable: false,
          minimum_age: 18,
        },
        cash: {
          available: false,
          currency: 'usd',
          provider: null,
          reason: 'approved-tournament-payment-provider-required',
          detail: 'Cash entry pools cannot use the platform Stripe account. An approved tournament-payment provider and legal review are required.',
        },
      })
      return true
    }

    if (name === 'tournament-prize-get') {
      const tournamentId = String(body.tournamentId || '')
      if (!tournamentId) {
        res.json({ ok: false, reason: 'invalid-tournament' })
        return true
      }
      res.json({
        ok: true,
        pool: await tournamentPrizePoolView(tournamentId, me),
        cash_available: false,
      })
      return true
    }

    if (name === 'tournament-prize-open') {
      const tournamentId = String(body.tournamentId || '')
      const currency = String(body.currency || 'sweeps').toLowerCase()
      const entryAmount = Number(body.entryAmount)
      const paidPlaces = Math.floor(Number(body.paidPlaces || 3))
      const actor = await loadActor(req)
      if (!actor || !(await isTournamentHost(pool, actor, tournamentId))) {
        res.status(403).json({ ok: false, error: 'only the tournament host may open its prize pool' })
        return true
      }
      if (currency === 'cash') {
        res.json({
          ok: false,
          reason: 'approved-tournament-payment-provider-required',
          error: 'Cash pools cannot be processed through Stripe and are not enabled yet.',
        })
        return true
      }
      if (currency !== 'sweeps') {
        res.json({ ok: false, reason: 'invalid-currency' })
        return true
      }
      if (
        !Number.isSafeInteger(entryAmount) ||
        entryAmount < 1 ||
        entryAmount > 1_000_000 ||
        ![1, 2, 3].includes(paidPlaces)
      ) {
        res.json({ ok: false, reason: 'invalid-settings' })
        return true
      }
      const split = body.prizeSplitBps == null
        ? prizeSplitForPlaces(paidPlaces)
        : parsePrizeSplitBps(body.prizeSplitBps)
      try {
        splitPrizePool(entryAmount, split, paidPlaces)
      } catch (error: any) {
        res.json({ ok: false, reason: 'invalid-split', error: error?.message || 'invalid prize split' })
        return true
      }
      const existing = await one(
        pool,
        `select id from tournament_prize_pools
          where tournament_id=$1 and currency='sweeps' and status in ('draft','open','locked')
          limit 1`,
        [tournamentId],
      )
      if (existing) {
        res.json({ ok: false, reason: 'active-pool-exists', poolId: existing.id })
        return true
      }
      const inserted = await pool.query(
        `insert into tournament_prize_pools
           (tournament_id, currency, entry_amount, paid_places, prize_split_bps,
            status, provider, compliance_approved, minimum_age, created_by)
         values ($1,'sweeps',$2,$3,$4,'open','internal_sweeps',true,18,$5)
         returning *`,
        [tournamentId, entryAmount, paidPlaces, JSON.stringify(split), actor.id],
      )
      res.json({
        ok: true,
        pool: await tournamentPrizePoolView(tournamentId, me),
        created: inserted.rows.length === 1,
      })
      return true
    }

    if (name === 'tournament-prize-join') {
      const poolId = String(body.poolId || '')
      if (!poolId) {
        res.json({ ok: false, reason: 'invalid-pool' })
        return true
      }
      const outcome = await withTransaction(async (db) => {
        const locked = await db.query(
          'select * from tournament_prize_pools where id=$1 for update',
          [poolId],
        )
        const poolRow = locked.rows[0]
        if (!poolRow) return { ok: false, reason: 'not-found' }
        if (poolRow.currency !== 'sweeps') {
          return { ok: false, reason: 'approved-tournament-payment-provider-required' }
        }
        if (poolRow.status !== 'open') return { ok: false, reason: 'not-open' }

        const account = await db.query('select user_metadata from users where id=$1', [me])
        const metadata = parseMeta(account.rows[0]?.user_metadata)
        const age = ageFromDob(metadata.date_of_birth)
        if (age === null || age < Number(poolRow.minimum_age || 18)) {
          return { ok: false, reason: 'age-verification-required' }
        }

        const duplicate = await db.query(
          'select id from tournament_prize_entries where pool_id=$1 and user_id=$2',
          [poolId, me],
        )
        if (duplicate.rows.length) return { ok: false, reason: 'duplicate' }
        const inserted = await db.query(
          `insert into tournament_prize_entries
             (pool_id, user_id, amount, status)
           values ($1,$2,$3,'pending')
           returning *`,
          [poolId, me, Number(poolRow.entry_amount)],
        )

        await db.query(
          `insert into wallets (user_id, tokens, sweeps, paid_sweeps_cents)
           values ($1,0,0,0) on conflict (user_id) do nothing`,
          [me],
        )
        const debited = await db.query(
          `update wallets
              set sweeps=sweeps-$2::integer, updated_at=now()
            where user_id=$1 and sweeps >= $2::integer
            returning tokens, sweeps, paid_sweeps_cents`,
          [me, Number(poolRow.entry_amount)],
        )
        if (!debited.rows.length) {
          await db.query('delete from tournament_prize_entries where id=$1', [inserted.rows[0].id])
          return { ok: false, reason: 'insufficient' }
        }
        await db.query(
          `insert into wallet_ledger
             (user_id, kind, tokens_delta, sweeps_delta, paid_sweeps_delta_cents,
              event, status, reason, ref_id)
           values ($1,'tournament',0,$2,0,$3,'Paid','tournament prize-pool entry',$4)`,
          [me, -Number(poolRow.entry_amount), await tournamentName(poolRow.tournament_id), poolId],
        )
        const entry = await db.query(
          `update tournament_prize_entries
              set status='escrowed', updated_at=now()
            where id=$1
            returning *`,
          [inserted.rows[0].id],
        )
        return { ok: true, entry: entry.rows[0], wallet: debited.rows[0] }
      })
      res.json(outcome)
      return true
    }

    if (name === 'tournament-prize-lock') {
      const poolId = String(body.poolId || '')
      const poolRow = await one(pool, 'select * from tournament_prize_pools where id=$1', [poolId])
      if (!poolRow) {
        res.status(404).json({ ok: false, error: 'prize pool not found' })
        return true
      }
      const actor = await loadActor(req)
      if (!actor || !(await isTournamentHost(pool, actor, poolRow.tournament_id))) {
        res.status(403).json({ ok: false, error: 'only the tournament host may lock its prize pool' })
        return true
      }
      const updated = await pool.query(
        `update tournament_prize_pools
            set status='locked', locked_at=now(), updated_at=now()
          where id=$1 and status='open'
          returning *`,
        [poolId],
      )
      res.json({
        ok: true,
        locked: updated.rows.length === 1,
        reason: updated.rows.length ? null : 'already-closed',
      })
      return true
    }

    if (name === 'tournament-prize-resolve') {
      const poolId = String(body.poolId || '')
      const poolRow = await one(pool, 'select * from tournament_prize_pools where id=$1', [poolId])
      if (!poolRow) {
        res.status(404).json({ ok: false, error: 'prize pool not found' })
        return true
      }
      const actor = await loadActor(req)
      if (!actor || !(await isTournamentHost(pool, actor, poolRow.tournament_id))) {
        res.status(403).json({ ok: false, error: 'only the tournament host may settle its prize pool' })
        return true
      }
      const requestedPlacements = Array.isArray(body.placements)
        ? body.placements.map((value: unknown) => String(value || '')).filter(Boolean)
        : []
      const outcome = await withTransaction(async (db) => {
        const locked = await db.query(
          'select * from tournament_prize_pools where id=$1 for update',
          [poolId],
        )
        const current = locked.rows[0]
        if (!current) return { ok: false, reason: 'not-found' }
        if (current.status === 'settled' || current.status === 'cancelled') {
          return { ok: true, settled: false, reason: 'already-settled' }
        }
        if (!['open', 'locked'].includes(current.status)) {
          return { ok: false, reason: 'not-settleable' }
        }
        if (current.currency !== 'sweeps') {
          return { ok: false, reason: 'approved-tournament-payment-provider-required' }
        }
        const paidPlaces = Number(current.paid_places || 3)
        const placements = requestedPlacements.slice(0, paidPlaces)
        if (
          placements.length !== paidPlaces ||
          new Set(placements).size !== placements.length
        ) {
          return { ok: false, reason: 'invalid-placements' }
        }
        const entries = (await db.query(
          `select * from tournament_prize_entries
            where pool_id=$1 and status='escrowed'
            order by entered_at asc, id asc`,
          [poolId],
        )).rows
        if (entries.length < paidPlaces) {
          return { ok: false, reason: 'not-enough-entrants' }
        }
        const entrantIds = new Set(entries.map((entry: any) => String(entry.user_id)))
        if (placements.some((userId: string) => !entrantIds.has(userId))) {
          return { ok: false, reason: 'placement-not-entered' }
        }

        const pot = entries.reduce(
          (sum: number, entry: any) => sum + Number(entry.amount || 0),
          0,
        )
        const split = parsePrizeSplitBps(current.prize_split_bps)
        let payouts
        try {
          payouts = splitPrizePool(pot, split, paidPlaces)
        } catch (error: any) {
          return { ok: false, reason: 'invalid-split', error: error?.message || 'invalid split' }
        }

        const paid: any[] = []
        for (let index = 0; index < placements.length; index += 1) {
          const userId = placements[index]
          const payout = payouts[index]
          await db.query(
            `insert into wallets (user_id, tokens, sweeps, paid_sweeps_cents)
             values ($1,0,0,0) on conflict (user_id) do nothing`,
            [userId],
          )
          if (payout.amount > 0) {
            await db.query(
              'update wallets set sweeps=sweeps+$2::integer, updated_at=now() where user_id=$1',
              [userId, payout.amount],
            )
            await db.query(
              `insert into wallet_ledger
                 (user_id, kind, tokens_delta, sweeps_delta, paid_sweeps_delta_cents,
                  event, result, prize, status, reason, ref_id)
               values ($1,'tournament',0,$2,0,$3,'Win',$4,'Paid',
                       'tournament prize-pool payout',$5)`,
              [
                userId,
                payout.amount,
                await tournamentName(current.tournament_id),
                `${payout.amount} Sweeps`,
                poolId,
              ],
            )
          }
          await db.query(
            `insert into tournament_prize_payouts
               (pool_id, user_id, placement, gross_amount, net_amount, status, paid_at)
             values ($1,$2,$3,$4,$4,'paid',now())`,
            [poolId, userId, payout.placement, payout.amount],
          )
          await db.query(
            `update tournament_prize_entries
                set status='paid', updated_at=now()
              where pool_id=$1 and user_id=$2`,
            [poolId, userId],
          )
          await db.query(
            `insert into notifications (user_id, kind, title, body, link, related_id)
             values ($1,'tournament','Tournament prize paid',$2,$3,$4)`,
            [
              userId,
              `You placed #${payout.placement} and received ${payout.amount} Sweeps.`,
              `/tournaments/${current.tournament_id}`,
              poolId,
            ],
          )
          paid.push({ user_id: userId, placement: payout.placement, amount: payout.amount })
        }
        await db.query(
          `update tournament_prize_entries
              set status='forfeited', updated_at=now()
            where pool_id=$1 and status='escrowed'`,
          [poolId],
        )
        await db.query(
          `update tournament_prize_pools
              set status='settled', settled_at=now(), updated_at=now()
            where id=$1`,
          [poolId],
        )
        return { ok: true, settled: true, pot, payouts: paid }
      })
      res.json(outcome)
      return true
    }

    if (name === 'tournament-prize-cancel') {
      const poolId = String(body.poolId || '')
      const poolRow = await one(pool, 'select * from tournament_prize_pools where id=$1', [poolId])
      if (!poolRow) {
        res.status(404).json({ ok: false, error: 'prize pool not found' })
        return true
      }
      const actor = await loadActor(req)
      if (!actor || !(await isTournamentHost(pool, actor, poolRow.tournament_id))) {
        res.status(403).json({ ok: false, error: 'only the tournament host may cancel its prize pool' })
        return true
      }
      const outcome = await withTransaction(async (db) => {
        const locked = await db.query(
          'select * from tournament_prize_pools where id=$1 for update',
          [poolId],
        )
        const current = locked.rows[0]
        if (!current) return { ok: false, reason: 'not-found' }
        if (current.status === 'settled' || current.status === 'cancelled') {
          return { ok: true, cancelled: false, reason: 'already-settled', refunds: [] }
        }
        const entries = (await db.query(
          "select * from tournament_prize_entries where pool_id=$1 and status='escrowed'",
          [poolId],
        )).rows
        const refunds: any[] = []
        for (const entry of entries) {
          await db.query(
            `insert into wallets (user_id, tokens, sweeps, paid_sweeps_cents)
             values ($1,0,0,0) on conflict (user_id) do nothing`,
            [entry.user_id],
          )
          await db.query(
            'update wallets set sweeps=sweeps+$2::integer, updated_at=now() where user_id=$1',
            [entry.user_id, Number(entry.amount)],
          )
          await db.query(
            `insert into wallet_ledger
               (user_id, kind, tokens_delta, sweeps_delta, paid_sweeps_delta_cents,
                event, status, reason, ref_id)
             values ($1,'tournament',0,$2,0,$3,'Paid',
                     'tournament prize-pool cancellation refund',$4)`,
            [
              entry.user_id,
              Number(entry.amount),
              await tournamentName(current.tournament_id),
              poolId,
            ],
          )
          await db.query(
            `update tournament_prize_entries
                set status='refunded', updated_at=now()
              where id=$1`,
            [entry.id],
          )
          refunds.push({ user_id: entry.user_id, amount: Number(entry.amount) })
        }
        await db.query(
          `update tournament_prize_pools
              set status='cancelled', cancelled_at=now(), updated_at=now()
            where id=$1`,
          [poolId],
        )
        return { ok: true, cancelled: true, refunds }
      })
      res.json(outcome)
      return true
    }

    // ---- wallet: read (creating the zero row on first sign-in) --------------
    if (name === 'wallet') {
      res.json({ ok: true, wallet: await readWalletRow(me) })
      return true
    }

    // ---- the free daily Sweeps grant ("no purchase necessary", Rule 3) -----
    // The once-a-day guard used to be a localStorage key, i.e. `localStorage
    // .removeItem(...)` was an infinite money button. The guard is the ledger:
    // one 'grant'/'daily' row per UTC day, per user.
    //
    // It MUST be claimed atomically. The old code read "is there a row for
    // today?" and only then wrote one, so ten simultaneous taps all saw no row
    // and each banked a day's Sweeps (250 for the price of 25). The claim is now
    // a single conditional insert: the row is written only if one does not
    // already exist, and we credit the balance only when THIS request is the one
    // that wrote it. A partial unique index in db/schema.sql
    // (uq_wallet_daily_grant) is the real-Postgres backstop for the rare case
    // two conditional inserts still race.
    if (name === 'sweeps-daily') {
      const DAILY_BONUS_SWEEPS = 25
      const today = new Date().toISOString().slice(0, 10)
      await readWalletRow(me) // ensure the wallet row exists to claim against
      // ATOMIC CLAIM + CREDIT in one statement. The credit and the "already
      // claimed today?" guard are the SAME update: it adds the Sweeps only when
      // this user has not already claimed today's date. The old code read the
      // ledger, saw no row, and only then credited — so ten simultaneous taps
      // all saw "not claimed" and each banked a day's Sweeps. Here Postgres
      // row-locks the wallet for the update, so a second concurrent claim
      // re-checks the guard against the just-written date and matches 0 rows.
      const claim = await pool.query(
        `update wallets
            set sweeps = coalesce(sweeps,0) + $2,
                daily_sweeps_claimed_on = $3,
                updated_at = now()
          where user_id = $1
            and (daily_sweeps_claimed_on is null or daily_sweeps_claimed_on <> $3)
        returning sweeps, tokens, paid_sweeps_cents`,
        [me, DAILY_BONUS_SWEEPS, today],
      )
      if (!claim.rows.length) {
        res.json({ ok: false, reason: 'already-claimed', wallet: await readWalletRow(me) })
        return true
      }
      // Book the append-only audit row for the grant we just made.
      await bookLedger(me, 0, DAILY_BONUS_SWEEPS, {
        kind: 'grant', reason: 'daily', refId: today, event: 'Daily free Sweeps', status: 'Paid',
      })
      const row = claim.rows[0]
      res.json({
        ok: true,
        granted: DAILY_BONUS_SWEEPS,
        wallet: {
          tokens: Number(row.tokens ?? 0),
          sweeps: Number(row.sweeps ?? 0),
          paid_sweeps_cents: Number(row.paid_sweeps_cents ?? 0),
        },
      })
      return true
    }

    // ---- buy a cosmetic: the PRICE comes from the catalogue row ------------
    if (name === 'asset-buy') {
      const assetId = String(body.assetId || '')
      const ar = await pool.query('select * from assets where id=$1', [assetId])
      const asset = ar.rows[0]
      if (!asset) { res.json({ ok: false, reason: 'not-found' }); return true }
      if (await ownsAssetRow(me, assetId)) { res.json({ ok: false, reason: 'already-owned' }); return true }
      // Earned-only artifacts are never purchasable, whatever price they carry.
      if (asset.origin === 'reward' || asset.origin === 'prize') {
        res.json({ ok: false, reason: 'not-for-sale' })
        return true
      }
      const price = Math.max(0, Number(asset.price_tokens ?? 0))
      // Atomic debit: only ONE of a concurrent stampede can take the tokens, so
      // the rest fall through as 'insufficient' rather than each buying a copy.
      const spend = await spendTokens(me, price, {
        kind: 'spend', event: asset.name, reason: 'artifact purchase', refId: assetId,
      })
      if (!spend.ok) {
        res.json({ ok: false, reason: 'insufficient', wallet: spend })
        return true
      }
      const granted = await grantOwnership(me, assetId, 'purchase', null)
      if (!granted && price > 0) {
        // Raced to buy the SAME asset twice (or already owned): refund the charge.
        await creditTokens(me, price, {
          kind: 'adjustment', event: asset.name, reason: 'duplicate purchase refund', refId: assetId,
        })
        res.json({ ok: false, reason: 'already-owned', wallet: await readWalletRow(me) })
        return true
      }
      // Creator and clan listings earn 80% of the Token price. This is utility
      // currency only: it cannot be redeemed for cash. The remaining 20% is the
      // platform share. Platform/reward listings do not generate a seller cut.
      const split = feeSplitFor(price)
      let sellerShare = 0
      try {
        if (asset.seller_type === 'creator' && asset.created_by && split.clan > 0) {
          await creditTokens(String(asset.created_by), split.clan, {
            kind: 'marketplace',
            event: asset.name,
            reason: 'creator marketplace sale',
            refId: assetId,
            status: 'Recorded',
          })
          sellerShare = split.clan
        } else if (asset.seller_type === 'clan' && asset.clan_id && split.clan > 0) {
          await pool.query(
            'update servers set treasury_tokens = coalesce(treasury_tokens,0) + $1 where id=$2',
            [split.clan, asset.clan_id],
          )
          sellerShare = split.clan
        }
      } catch {
        // Never leave a buyer charged if the seller settlement failed.
        await pool.query('delete from asset_ownership where user_id=$1 and asset_id=$2', [me, assetId])
        await creditTokens(me, price, {
          kind: 'adjustment',
          event: asset.name,
          reason: 'marketplace settlement refund',
          refId: assetId,
        })
        res.json({ ok: false, reason: 'unavailable', wallet: await readWalletRow(me) })
        return true
      }
      res.json({
        ok: true,
        asset,
        sellerShare,
        platformShare: sellerShare > 0 ? split.platform : price,
        wallet: await readWalletRow(me),
      })
      return true
    }

    // ---- Oracle: make / cancel / resolve ------------------------------------
    if (name === 'prediction-make') {
      const tournamentId = String(body.tournamentId || '')
      const winnerId = String(body.winnerId || '')
      if (!tournamentId || !winnerId) { res.json({ ok: false, reason: 'invalid' }); return true }
      const dupe = await pool.query(
        "select id from predictions where user_id=$1 and tournament_id=$2 and status='open'", [me, tournamentId],
      )
      if (dupe.rows.length) { res.json({ ok: false, reason: 'exists' }); return true }
      // THE QUOTA IS THE SERVER'S: the tier is read off the account, not the body.
      const ur = await pool.query('select user_metadata from users where id=$1', [me])
      const tier = parseMeta(ur.rows[0]?.user_metadata).reelone_tier ?? ''
      const openR = await pool.query("select count(*) as count from predictions where user_id=$1 and status='open'", [me])
      if (Number(openR.rows[0]?.count ?? 0) >= predictionQuotaFor(tier)) {
        res.json({ ok: false, reason: 'quota' })
        return true
      }
      const ins = await pool.query(
        'insert into predictions (user_id, tournament_id, winner_id, pick_label) values ($1,$2,$3,$4) returning *',
        [me, tournamentId, winnerId, String(body.label || '')],
      )
      res.json({ ok: true, prediction: ins.rows[0] })
      return true
    }

    if (name === 'prediction-cancel') {
      const tournamentId = String(body.tournamentId || '')
      const del = await pool.query(
        "delete from predictions where user_id=$1 and tournament_id=$2 and status='open' returning id",
        [me, tournamentId],
      )
      res.json({ ok: true, cancelled: del.rows.length > 0 })
      return true
    }

    if (name === 'prediction-resolve') {
      const tournamentId = String(body.tournamentId || '')
      const pr = await pool.query(
        "select * from predictions where user_id=$1 and tournament_id=$2 and status='open'", [me, tournamentId],
      )
      const p = pr.rows[0]
      if (!p) { res.json({ ok: true, resolved: false }); return true }
      // THE GRADE COMES FROM THE RECORDED RESULT. The client used to pass the
      // winner id in, which meant two users could grade the same tournament
      // differently (and a user could simply declare themselves correct).
      const tr = await pool.query(
        'select winner_profile_id from tournament_results where tournament_id=$1 order by created_at desc',
        [tournamentId],
      )
      const winner = tr.rows[0]?.winner_profile_id
      if (!winner) { res.json({ ok: true, resolved: false, reason: 'undecided' }); return true }

      const correct = String(p.winner_id) === String(winner)
      const now = new Date().toISOString()
      const label = await tournamentName(tournamentId)

      if (!correct) {
        await pool.query("update predictions set status='wrong', resolved_at=$1 where id=$2", [now, p.id])
        await bookLedger(me, 0, 0, {
          kind: 'prediction', event: label, result: 'Loss', status: 'Paid', refId: tournamentId,
        })
        res.json({ ok: true, resolved: true, status: 'wrong' })
        return true
      }

      // Nth correct prediction -> the Nth cosmetic in the reward cycle.
      const cc = await pool.query(
        "select count(*) as count from predictions where user_id=$1 and status='correct'", [me],
      )
      const rewardId = rewardAssetIdFor(Number(cc.rows[0]?.count ?? 0) + 1)
      await pool.query(
        "update predictions set status='correct', resolved_at=$1, reward_asset_id=$2 where id=$3",
        [now, rewardId, p.id],
      )
      await grantOwnership(me, rewardId, 'reward', tournamentId)
      const rr = await pool.query('select * from assets where id=$1', [rewardId])
      await bookLedger(me, 0, 0, {
        kind: 'prediction', event: label, result: 'Win', status: 'Paid',
        prize: (rr.rows[0]?.name as string) || 'Oracle cosmetic', refId: tournamentId,
      })
      res.json({ ok: true, resolved: true, status: 'correct', asset: rr.rows[0] ?? null })
      return true
    }

    // ---- TKO King: the advancement artifact + the trophy-closet entry -------
    // This is the one that has to be right: winning the Final must durably make
    // you the King. The caller supplies only a BATTLE ID; everything else — that
    // the caller is the host, that the battle is decided, who won, which artifact
    // that round is worth — is read from the database.
    if (name === 'king-prize') {
      const battleId = String(body.battleId || '')
      const battle = await one(pool, 'select * from tournament_battles where id=$1', [battleId])
      if (!battle) { res.status(404).json({ ok: false, error: 'battle not found' }); return true }
      const actor = await loadActor(req)
      if (!actor || !(await isTournamentHost(pool, actor, battle.tournament_id))) {
        res.status(403).json({ ok: false, error: 'only the tournament host may award a prize' })
        return true
      }
      const decided = battle.status === 'complete' || battle.status === 'forfeit'
      if (!decided || !battle.winner) { res.json({ ok: false, reason: 'undecided' }); return true }

      const winner = String(battle.winner)
      const loser = String(battle.player_a) === winner ? battle.player_b : battle.player_a
      if (loser) await recordDefeat(winner, String(loser))

      // BRACKET DEPTH IS DERIVED, not taken on trust: a shallower totalRounds
      // would turn a first-round win into a crown. The request may only make the
      // bracket DEEPER (i.e. the prize smaller), never shallower.
      const regs = await pool.query(
        'select count(*) as count from tournament_registrations where tournament_id=$1', [battle.tournament_id],
      )
      const entrants = Number(regs.rows[0]?.count ?? 0)
      const derived = entrants > 1 ? Math.ceil(Math.log2(entrants)) : 1
      const hintTotal = Number(body.totalRounds)
      const hintRound = Number(body.round)
      const roundFromRow = Number(battle.round)
      const round = Math.max(1, Math.floor(
        Number.isFinite(roundFromRow) && roundFromRow > 0 ? roundFromRow
          : (Number.isFinite(hintRound) && hintRound > 0 ? hintRound : 1),
      ))
      const totalRounds = Math.max(
        derived, round, Number.isFinite(hintTotal) && hintTotal > 0 ? Math.floor(hintTotal) : 0,
      )

      const artifact = advancementArtifact(round, totalRounds)
      await upsertArtifact(artifact)
      const fresh = await grantOwnership(winner, artifact.id, 'prize', battleId)
      if (fresh) {
        await bookLedger(winner, 0, 0, {
          kind: 'tournament', event: await tournamentName(battle.tournament_id),
          result: 'Win', prize: artifact.name, status: 'Paid', refId: battleId,
        })
      }
      res.json({ ok: true, artifact, alreadyOwned: !fresh, round, totalRounds })
      return true
    }

    // ---- clan join fee / dues: one transaction, server-priced --------------
    if (name === 'clan-pay') {
      const serverId = String(body.serverId || '')
      const kind: 'join' | 'dues' = body.kind === 'dues' ? 'dues' : 'join'
      const clan = await one(pool, 'select * from servers where id=$1', [serverId])
      if (!clan) { res.status(404).json({ ok: false, error: 'clan not found' }); return true }
      // THE PRICE IS THE CLAN'S. A client cannot name its own gross amount and
      // therefore cannot mint treasury for a clan it likes.
      const gross = Math.max(0, Number((kind === 'dues' ? clan.dues_tokens : clan.join_fee_tokens) ?? 0))
      if (gross === 0) {
        res.json({ ok: true, charged: 0, split: { clan: 0, platform: 0 }, wallet: await readWalletRow(me) })
        return true
      }
      const split = feeSplitFor(gross)
      // Atomic debit first: a concurrent stampede can only charge the payer ONCE,
      // so the treasury is credited once — no minting a clan's balance by racing.
      const spend = await spendTokens(me, gross, {
        kind: 'clan_dues', event: (clan.name as string) || 'Clan', reason: `${kind} fee`, refId: serverId,
      })
      if (!spend.ok) {
        res.json({ ok: false, reason: 'insufficient', wallet: spend })
        return true
      }
      await pool.query(
        'update servers set treasury_tokens = coalesce(treasury_tokens,0) + $1 where id=$2', [split.clan, serverId],
      )
      await pool.query(
        `insert into clan_dues_payments (server_id, user_id, kind, gross_tokens, clan_tokens, platform_tokens)
         values ($1,$2,$3,$4,$5,$6)`,
        [serverId, me, kind, gross, split.clan, split.platform],
      )
      res.json({ ok: true, charged: gross, split, wallet: spend })
      return true
    }

    // ---- ARTIFACT TAGS: a clan tag a user equips to show off everywhere -----
    // A clan LEADER lists a tag (server-priced); a member BUYS it (debited via
    // spendTokens), which grants + equips it; a user may equip/unequip any tag
    // they own. The price is the catalogue row's — never the client's.
    if (name === 'artifact-tag-create') {
      const clanId = String(body.clanId || body.serverId || '')
      const tagText = String(body.tagText || '').trim().slice(0, 40)
      if (!clanId || !tagText) { res.json({ ok: false, reason: 'invalid' }); return true }
      // ONLY a clan leader/officer (or the server's owner / a global host) may
      // list — and therefore charge for — their clan's artifact tag.
      const actor = await loadActor(req)
      if (!actor || !(await isClanManager(pool, actor, clanId))) {
        res.status(403).json({ ok: false, error: 'only a clan leader may create an artifact tag' })
        return true
      }
      const price = Math.max(0, Math.round(Number(body.price ?? 0)))
      const rarity = String(body.rarity || 'common').slice(0, 20)
      const ins = await pool.query(
        `insert into artifact_tags (clan_id, creator_id, tag_text, price, rarity)
         values ($1,$2,$3,$4,$5) returning *`,
        [clanId, me, tagText, price, rarity],
      )
      res.json({ ok: true, tag: ins.rows[0] })
      return true
    }

    if (name === 'artifact-tag-buy') {
      const tagId = String(body.tagId || '')
      const tr = await pool.query('select * from artifact_tags where id=$1', [tagId])
      const tag = tr.rows[0]
      if (!tag) { res.json({ ok: false, reason: 'not-found' }); return true }
      const already = await pool.query(
        'select 1 from user_artifact_tags where user_id=$1 and artifact_tag_id=$2', [me, tagId],
      )
      if (!already.rows.length) {
        // THE PRICE IS THE CATALOGUE'S. Atomic debit: a concurrent stampede can
        // only take the tokens once, so nobody buys the tag for free by racing.
        const price = Math.max(0, Number(tag.price ?? 0))
        const spend = await spendTokens(me, price, {
          kind: 'spend', event: `Artifact tag ${tag.tag_text}`, reason: 'artifact tag', refId: tagId,
        })
        if (!spend.ok) {
          res.json({ ok: false, reason: 'insufficient', wallet: spend })
          return true
        }
        // Record the grant (idempotent via the unique key), then credit the
        // selling clan's treasury — this is how a leader "charges" for the tag.
        try {
          await pool.query('insert into user_artifact_tags (user_id, artifact_tag_id) values ($1,$2)', [me, tagId])
        } catch { /* raced a duplicate grant — already owned, fine */ }
        if (price > 0 && tag.clan_id) {
          await pool.query(
            'update servers set treasury_tokens = coalesce(treasury_tokens,0) + $1 where id=$2', [price, tag.clan_id],
          )
        }
      }
      // Equip it (buying shows it off immediately).
      await pool.query(
        `insert into user_equipped_tag (user_id, artifact_tag_id, equipped_at) values ($1,$2, now())
         on conflict (user_id) do update set artifact_tag_id = excluded.artifact_tag_id, equipped_at = now()`,
        [me, tagId],
      )
      res.json({ ok: true, tag, wallet: await readWalletRow(me) })
      return true
    }

    if (name === 'artifact-tag-equip') {
      const tagId = String(body.tagId || '')
      // You may only equip a tag you own / were granted.
      const owned = await pool.query(
        'select 1 from user_artifact_tags where user_id=$1 and artifact_tag_id=$2', [me, tagId],
      )
      if (!owned.rows.length) { res.json({ ok: false, reason: 'not-owned' }); return true }
      await pool.query(
        `insert into user_equipped_tag (user_id, artifact_tag_id, equipped_at) values ($1,$2, now())
         on conflict (user_id) do update set artifact_tag_id = excluded.artifact_tag_id, equipped_at = now()`,
        [me, tagId],
      )
      res.json({ ok: true, equipped: tagId })
      return true
    }

    if (name === 'artifact-tag-unequip') {
      await pool.query('delete from user_equipped_tag where user_id=$1', [me])
      res.json({ ok: true })
      return true
    }

    // ---- ORACLE VOTING: a 30s in-match outcome vote worth +10 power if right -
    if (name === 'oracle-vote') {
      const matchRef = String(body.matchRef || '').trim()
      const choice = String(body.choice || '').trim()
      if (!matchRef || !choice) { res.json({ ok: false, reason: 'invalid' }); return true }
      // The 30s window is enforced client-side; if the client passes the epoch ms
      // it opened the vote, reject a clearly-late cast as a light server backstop.
      const openedAt = Number(body.openedAt)
      if (Number.isFinite(openedAt) && openedAt > 0 && Date.now() - openedAt > 30_000) {
        res.json({ ok: false, reason: 'late' })
        return true
      }
      const dupe = await pool.query('select 1 from oracle_votes where user_id=$1 and match_ref=$2', [me, matchRef])
      if (dupe.rows.length) { res.json({ ok: false, reason: 'exists' }); return true }
      let ins
      try {
        ins = await pool.query(
          'insert into oracle_votes (user_id, match_ref, choice) values ($1,$2,$3) returning *', [me, matchRef, choice],
        )
      } catch { res.json({ ok: false, reason: 'exists' }); return true } // unique(user,match) race
      res.json({ ok: true, vote: ins.rows[0] })
      return true
    }

    if (name === 'oracle-resolve') {
      const matchRef = String(body.matchRef || '').trim()
      const winningChoice = String(body.winningChoice || '').trim()
      if (!matchRef || !winningChoice) { res.json({ ok: false, reason: 'invalid' }); return true }
      // Resolving grades OTHER users' votes and mints power, so it is host-gated.
      const actor = await loadActor(req)
      if (!actor || !actor.host) {
        res.status(403).json({ ok: false, error: 'only a host may resolve a match' })
        return true
      }
      // IDEMPOTENT: only ever grade votes not yet resolved. A re-resolve sees an
      // empty set and adds nothing (no double +10, no double recompute).
      const votes = await pool.query('select * from oracle_votes where match_ref=$1 and resolved_at is null', [matchRef])
      const now = new Date().toISOString()
      let correct = 0
      for (const v of votes.rows) {
        const isCorrect = String(v.choice) === winningChoice
        await pool.query('update oracle_votes set correct=$1, resolved_at=$2 where id=$3', [isCorrect, now, v.id])
        if (isCorrect) {
          await pool.query('update profiles set oracle_points = coalesce(oracle_points,0) + 10 where id=$1', [v.user_id])
          await recomputePower(pool, String(v.user_id))
          correct++
        }
      }
      res.json({ ok: true, resolved: votes.rows.length, correct })
      return true
    }

    // ==========================================================================
    // WAGERING — a sweeps-only, in-app prediction pool over a match outcome.
    //
    // MONEY-SAFETY / NOT-GAMBLING invariants enforced here:
    //   • SWEEPS ONLY. Stakes are debited via spendSweeps (the trusted, atomic
    //     wallet path). Sweeps have NO cash value and no redemption, so this is
    //     play. Tokens are bought with real money and are NEVER stakeable — a
    //     token-stake attempt is rejected outright (reason 'tokens-not-allowed').
    //   • Artifacts are NOT stakeable in v1: the artifact/asset catalogues carry
    //     real-money-adjacent price fields (assets.price_tokens, artifacts.
    //     price_cents + redeem codes), so we cannot cleanly prove an artifact is
    //     non-cashable — sweeps-only is the safe choice (see the wager DDL notes).
    //   • Every debit AND every credit goes through the trusted wallet path
    //     (spendSweeps / moveWallet), clamped at zero, each booking a ledger row.
    //   • The payout math conserves the pot EXACTLY (sum of winner payouts ==
    //     total staked): pro-rata floors, integer remainder handed to the single
    //     largest winning staker (tie broken by earliest wager). Documented below.
    //   • resolve + cancel are idempotent via a guarded status UPDATE, so a
    //     re-call settles nothing twice.
    // ==========================================================================

    // Host gate for a pool: a global TKO host, or the host who opened the pool.
    const wagerActor = async (): Promise<Actor | null> => loadActor(req)
    const mayHostPool = (actor: Actor | null, poolRow: any): boolean =>
      !!actor && (actor.host === true || same(poolRow?.created_by, actor.id))
    const parseOptions = (v: any): string[] => {
      const raw = Array.isArray(v)
        ? v
        : typeof v === 'string'
          ? (() => { try { return JSON.parse(v) } catch { return [] } })()
          : []
      return (Array.isArray(raw) ? raw : []).map((x) => String(x))
    }

    // ---- wager-open (host) : create a pool ----------------------------------
    if (name === 'wager-open') {
      const actor = await wagerActor()
      if (!actor || actor.host !== true) {
        res.status(403).json({ ok: false, error: 'only a host may open a wager pool' })
        return true
      }
      const matchRef = String(body.matchRef || '').trim().slice(0, 200)
      const title = String(body.title || '').trim().slice(0, 200)
      const options = parseOptions(body.options)
        .map((o) => o.trim().slice(0, 120))
        .filter((o) => o.length > 0)
      // De-dupe options while preserving order; need at least two to bet on.
      const uniqueOptions = [...new Set(options)]
      if (!matchRef || uniqueOptions.length < 2) { res.json({ ok: false, reason: 'invalid' }); return true }
      const ins = await pool.query(
        `insert into wager_pools (match_ref, title, options, status, created_by)
         values ($1,$2,$3,'open',$4) returning *`,
        [matchRef, title, JSON.stringify(uniqueOptions), actor.id],
      )
      const row = ins.rows[0]
      res.json({ ok: true, pool: { ...row, options: parseOptions(row.options) } })
      return true
    }

    // ---- wager-place : stake SWEEPS on an option (escrow via the wallet) -----
    if (name === 'wager-place') {
      const poolId = String(body.poolId || '')
      const option = String(body.option ?? '')
      // TOKENS ARE NEVER STAKEABLE. The endpoint only reads `sweeps`, but a client
      // that tries to name tokens (a `tokens` amount or currency !== 'sweeps') is
      // rejected outright so staking real-money currency is impossible by contract.
      if (
        (body.currency != null && String(body.currency).toLowerCase() !== 'sweeps') ||
        (body.tokens != null && Number(body.tokens) > 0)
      ) {
        res.json({ ok: false, reason: 'tokens-not-allowed' })
        return true
      }
      const sweeps = Number(body.sweeps)
      if (!Number.isFinite(sweeps) || Math.floor(sweeps) !== sweeps || sweeps <= 0) {
        res.json({ ok: false, reason: 'invalid-amount' })
        return true
      }
      const poolRow = await one(pool, 'select * from wager_pools where id=$1', [poolId])
      if (!poolRow) { res.json({ ok: false, reason: 'not-found' }); return true }
      if (poolRow.status !== 'open') { res.json({ ok: false, reason: 'not-open' }); return true }
      if (!parseOptions(poolRow.options).includes(option)) { res.json({ ok: false, reason: 'invalid-option' }); return true }
      // One wager per user per pool — reject a duplicate BEFORE touching the wallet.
      const dupe = await one(pool, 'select id from wagers where pool_id=$1 and user_id=$2', [poolId, me])
      if (dupe) { res.json({ ok: false, reason: 'duplicate' }); return true }
      // Escrow the stake: atomic sweeps debit through the trusted path. Fails
      // closed on an insufficient balance (nothing is inserted).
      const spend = await spendSweeps(me, sweeps, {
        kind: 'wager', event: poolRow.title || 'Wager', reason: 'wager stake', refId: poolId,
      })
      if (!spend.ok) {
        res.json({ ok: false, reason: 'insufficient', wallet: spend })
        return true
      }
      let wager
      try {
        const ins = await pool.query(
          `insert into wagers (pool_id, user_id, option, sweeps, status)
           values ($1,$2,$3,$4,'active') returning *`,
          [poolId, me, option, sweeps],
        )
        wager = ins.rows[0]
      } catch {
        // Raced another place for the same (pool,user): refund the just-debited
        // stake through the trusted path and report the duplicate. Fail closed.
        await moveWallet(me, { sweeps }, {
          kind: 'wager', event: poolRow.title || 'Wager', reason: 'duplicate wager refund', refId: poolId,
        })
        res.json({ ok: false, reason: 'duplicate', wallet: await readWalletRow(me) })
        return true
      }
      res.json({ ok: true, wager, wallet: spend })
      return true
    }

    // ---- wager-lock (host) : freeze the pool, no more places ----------------
    if (name === 'wager-lock') {
      const poolId = String(body.poolId || '')
      const poolRow = await one(pool, 'select * from wager_pools where id=$1', [poolId])
      if (!poolRow) { res.status(404).json({ ok: false, error: 'pool not found' }); return true }
      const actor = await wagerActor()
      if (!mayHostPool(actor, poolRow)) {
        res.status(403).json({ ok: false, error: 'only the host may lock this pool' })
        return true
      }
      // Only an OPEN pool locks; re-locking (or locking a settled pool) is a no-op.
      const upd = await pool.query(
        "update wager_pools set status='locked' where id=$1 and status='open' returning *",
        [poolId],
      )
      const row = upd.rows[0] || poolRow
      res.json({ ok: true, locked: upd.rows.length > 0, pool: { ...row, options: parseOptions(row.options) } })
      return true
    }

    // ---- wager-resolve (host) : settle the pot pro-rata (idempotent) --------
    if (name === 'wager-resolve') {
      const poolId = String(body.poolId || '')
      const winningOption = String(body.winningOption ?? '')
      const poolRow = await one(pool, 'select * from wager_pools where id=$1', [poolId])
      if (!poolRow) { res.status(404).json({ ok: false, error: 'pool not found' }); return true }
      const actor = await wagerActor()
      if (!mayHostPool(actor, poolRow)) {
        res.status(403).json({ ok: false, error: 'only the host may resolve this pool' })
        return true
      }
      if (!parseOptions(poolRow.options).includes(winningOption)) {
        res.json({ ok: false, reason: 'invalid-option' })
        return true
      }
      // IDEMPOTENT CLAIM: flip an unsettled pool (open|locked) to resolved in ONE
      // guarded UPDATE. A second concurrent/duplicate resolve matches 0 rows and
      // settles nothing — no double payout. `winning_option` is stamped here so it
      // is decided exactly once.
      const claim = await pool.query(
        `update wager_pools set status='resolved', winning_option=$2, resolved_at=now()
           where id=$1 and status in ('open','locked')
         returning *`,
        [poolId, winningOption],
      )
      if (!claim.rows.length) {
        res.json({ ok: true, resolved: false, reason: 'already-settled', pot: 0, winners: [] })
        return true
      }
      // Read the active wagers AFTER the claim (they are still 'active' — only the
      // settlement below transitions them), then pay out.
      const active = (await pool.query(
        "select * from wagers where pool_id=$1 and status='active' order by created_at asc, id asc", [poolId],
      )).rows
      const pot = active.reduce((s: number, w: any) => s + Number(w.sweeps || 0), 0)
      const winners = active.filter((w: any) => String(w.option) === winningOption)
      const now = new Date().toISOString()

      // NO-WINNER EDGE: nobody picked the winning side → refund every stake in
      // full through the trusted path (sum of refunds == pot, trivially conserved).
      if (winners.length === 0) {
        const refunded: any[] = []
        for (const w of active) {
          const amt = Number(w.sweeps || 0)
          await moveWallet(String(w.user_id), { sweeps: amt }, {
            kind: 'wager', event: poolRow.title || 'Wager', result: null, reason: 'no-winner refund', refId: poolId,
          })
          await pool.query("update wagers set status='refunded', payout=$1 where id=$2", [amt, w.id])
          refunded.push({ user_id: w.user_id, sweeps: amt })
        }
        res.json({ ok: true, resolved: true, winningOption, noWinner: true, pot, winners: [], refunded })
        return true
      }

      // PRO-RATA PAYOUT over the WHOLE pot, integer-safe & pot-conserving.
      //   winnerStake = sum of winners' stakes
      //   payout_i    = floor(pot * stake_i / winnerStake)
      // The floors leave a remainder of (pot - sum(payouts)) in [0, winners-1];
      // it is handed to the SINGLE LARGEST winning staker (ties broken by the
      // earliest wager, since `active` is ordered by created_at,id). This makes
      // sum(payouts) == pot exactly — the pot is never minted or destroyed.
      const winnerStake = winners.reduce((s: number, w: any) => s + Number(w.sweeps || 0), 0)
      const payouts = winners.map((w: any) => Math.floor((pot * Number(w.sweeps || 0)) / winnerStake))
      let remainder = pot - payouts.reduce((s: number, p: number) => s + p, 0)
      // Index of the largest-stake winner (first wins ties → earliest wager).
      let topIdx = 0
      for (let i = 1; i < winners.length; i++) {
        if (Number(winners[i].sweeps || 0) > Number(winners[topIdx].sweeps || 0)) topIdx = i
      }
      payouts[topIdx] += remainder
      remainder = 0

      const wonList: any[] = []
      for (let i = 0; i < winners.length; i++) {
        const w = winners[i]
        const payout = payouts[i]
        await moveWallet(String(w.user_id), { sweeps: payout }, {
          kind: 'wager', event: poolRow.title || 'Wager', result: 'Win', status: 'Paid',
          prize: `${payout} sweeps`, reason: 'wager payout', refId: poolId,
        })
        await pool.query("update wagers set status='won', payout=$1 where id=$2", [payout, w.id])
        wonList.push({ user_id: w.user_id, stake: Number(w.sweeps || 0), payout })
      }
      // Losers forfeit their (already-escrowed) stake — mark them, credit nothing.
      for (const w of active) {
        if (String(w.option) === winningOption) continue
        await pool.query("update wagers set status='lost', payout=0 where id=$1", [w.id])
      }
      res.json({ ok: true, resolved: true, winningOption, noWinner: false, pot, winners: wonList })
      return true
    }

    // ---- wager-cancel (host) : refund every active wager (idempotent) -------
    if (name === 'wager-cancel') {
      const poolId = String(body.poolId || '')
      const poolRow = await one(pool, 'select * from wager_pools where id=$1', [poolId])
      if (!poolRow) { res.status(404).json({ ok: false, error: 'pool not found' }); return true }
      const actor = await wagerActor()
      if (!mayHostPool(actor, poolRow)) {
        res.status(403).json({ ok: false, error: 'only the host may cancel this pool' })
        return true
      }
      // IDEMPOTENT CLAIM: cancel only an unsettled pool (open|locked). A pool that
      // is already resolved or cancelled matches 0 rows and refunds nothing again.
      const claim = await pool.query(
        `update wager_pools set status='cancelled', resolved_at=now()
           where id=$1 and status in ('open','locked')
         returning *`,
        [poolId],
      )
      if (!claim.rows.length) {
        res.json({ ok: true, cancelled: false, reason: 'already-settled', refunded: [] })
        return true
      }
      const active = (await pool.query(
        "select * from wagers where pool_id=$1 and status='active'", [poolId],
      )).rows
      const refunded: any[] = []
      for (const w of active) {
        const amt = Number(w.sweeps || 0)
        await moveWallet(String(w.user_id), { sweeps: amt }, {
          kind: 'wager', event: poolRow.title || 'Wager', reason: 'wager cancel refund', refId: poolId,
        })
        await pool.query("update wagers set status='refunded', payout=$1 where id=$2", [amt, w.id])
        refunded.push({ user_id: w.user_id, sweeps: amt })
      }
      res.json({ ok: true, cancelled: true, refunded })
      return true
    }

    return false
  }

  // ==========================================================================
  // EDGE FUNCTIONS  — POST /api/fn/:name
  // ==========================================================================
  api.post('/fn/:name', auth, async (req, res) => {
    const name = req.params.name
    // Account deletion, reached through the frontend's functions.invoke() shim.
    // Same handler as DELETE /api/account — see the block below it.
    if (name === 'delete-account') return handleAccountDelete(req, res)
    if (name === 'dm-open') {
      const me = uid(req)
      const targetUserId = String((req.body || {}).targetUserId || '').trim()
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      if (!uuidPattern.test(targetUserId)) {
        return res.status(400).json({ ok: false, error: 'A valid player is required.' })
      }
      if (same(me, targetUserId)) {
        return res.status(400).json({ ok: false, error: 'Choose another player.' })
      }
      const target = await one(pool, 'select id from profiles where id=$1', [targetUserId])
      if (!target) return res.status(404).json({ ok: false, error: 'Player not found.' })
      if (await blockedEitherWay(pool, me, targetUserId)) {
        return res.status(403).json({ ok: false, error: 'This conversation is unavailable.' })
      }

      const pairKey = [me, targetUserId].sort().join(':')
      try {
        const conversationId = await withTransaction(async (db) => {
          let conversation = await one(db, 'select id from dm_conversations where pair_key=$1', [pairKey])

          // Adopt an older exact two-person thread created before pair_key
          // existed, so an upgrade cannot split one DM into duplicates.
          if (!conversation) {
            const mine = await db.query(
              'select conversation_id from dm_participants where user_id=$1',
              [me],
            )
            for (const membership of mine.rows) {
              const members = (await db.query(
                'select user_id from dm_participants where conversation_id=$1',
                [membership.conversation_id],
              )).rows.map((member) => String(member.user_id))
              if (
                members.length === 2
                && members.some((memberId) => same(memberId, me))
                && members.some((memberId) => same(memberId, targetUserId))
              ) {
                conversation = { id: membership.conversation_id }
                await db.query(
                  'update dm_conversations set pair_key=coalesce(pair_key,$1) where id=$2',
                  [pairKey, membership.conversation_id],
                )
                break
              }
            }
          }

          if (!conversation) {
            const inserted = await db.query(
              `insert into dm_conversations (pair_key, updated_at)
               values ($1, now())
               on conflict (pair_key) do update set pair_key=excluded.pair_key
               returning id`,
              [pairKey],
            )
            conversation = inserted.rows[0]
          }

          await db.query(
            `insert into dm_participants (conversation_id, user_id)
             values ($1,$2),($1,$3)
             on conflict (conversation_id, user_id) do nothing`,
            [conversation.id, me, targetUserId],
          )
          return String(conversation.id)
        })
        return res.json({ ok: true, conversation_id: conversationId })
      } catch (error: any) {
        return res.status(400).json({
          ok: false,
          error: error?.message || 'Could not open the conversation.',
        })
      }
    }
    // The economy handlers (wallet, artifacts, predictions, King prizes, clan
    // dues). Wrapped so a bad id / constraint violation is a clean 400 rather
    // than an unhandled rejection.
    try {
      if (await handleEconomyFn(name, req, res)) return
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e?.message || 'economy error' })
    }
    // ── Ask TKO: real conversational answers via Vertex AI (Gemini) ──────────
    // The client falls back to its built-in guide answers if this errors, so a
    // model/quota hiccup never leaves the assistant silent.
    if (name === 'ask') {
      const question = String((req.body || {}).question || '').trim().slice(0, 500)
      if (!question) return res.status(400).json({ ok: false, error: 'question required' })
      try {
        const [publicContext, privateContext] = await Promise.all([
          liveStats(pool).catch(() => ''),
          userStats(pool, uid(req)).catch(() => ''),
        ])
        const context = [publicContext, privateContext].filter(Boolean).join('\n')
        const answer = await askTko(question, context)
        return res.json({
          ok: true,
          answer,
          model: ASK_TKO_MODEL,
          grounded: Boolean(context),
        })
      } catch (e: any) {
        return res.status(200).json({ ok: false, error: e?.message || 'ask failed' })
      }
    }

    if (name === 'redeem-code') {
      const code = String((req.body || {}).code || '').trim()
      if (!code) return res.status(400).json({ ok: false, error: 'code required' })
      const upper = code.toUpperCase()

      // FOUNDER ULTRA (owner only): permanent top tier + unlimited artifacts +
      // host, never charged. Idempotent, not single-use. Handled first.
      if (TKO_ULTRA_CODES.has(upper)) {
        const ur = await pool.query('select user_metadata from users where id=$1', [uid(req)])
        const meta = parseMeta(ur.rows[0]?.user_metadata)
        meta.reelone_tier = 'creator'
        meta.reelone_tier_expires = null          // never expires => never charged
        meta.artifact_unlimited = true            // no monthly craft cap
        meta.tko_host = true                       // host anywhere
        await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), uid(req)])
        return res.json({ ok: true, tier: 'creator', ultra: true, host: true })
      }

      // Reusable BETA TESTER pass: intentionally SHARED — top-tier access,
      // unlimited redeemers (see TKO_TESTER_CODES). It is neither a founder host
      // code nor a redeem_codes tier pass, so it is deliberately NOT single-use;
      // handled first so it never consumes a redeemed_codes slot.
      if (TKO_TESTER_CODES.has(upper)) {
        const expires = new Date(Date.now() + TKO_TESTER_MONTHS * 30 * 24 * 60 * 60 * 1000).toISOString()
        const ur = await pool.query('select user_metadata from users where id=$1', [uid(req)])
        const meta = parseMeta(ur.rows[0]?.user_metadata)
        meta.reelone_tier = TKO_TESTER_TIER
        meta.reelone_tier_expires = expires
        // Mark the account as a beta tester (mirrors how host codes flip tko_host).
        meta.tko_beta = true
        await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), uid(req)])
        // Auto-join the single global TKO-BETA tester chat space. Idempotent:
        // re-redeeming just re-affirms membership. Non-fatal if chat tables are
        // absent (a slim schema) — the tier grant still succeeds.
        try {
          const spaceId = await ensureBetaSpace()
          await pool.query('insert into chat_space_members (space_id, user_id) values ($1,$2)', [spaceId, uid(req)])
        } catch { /* already a member (unique key) or chat tables absent — fine */ }
        return res.json({ ok: true, tier: TKO_TESTER_TIER, expires_at: expires, beta: true })
      }

      // Founder HOST codes AND redeem_codes tier passes are BOTH single-use: a
      // given code may be consumed EXACTLY ONCE, by EXACTLY ONE profile (founder
      // requirement). Resolve the code's identity FIRST, WITHOUT mutating
      // anything, so an invalid code never burns a redeemed_codes slot.
      const isHost = TKO_HOST_CODES.has(upper)

      let rc: any = null
      if (!isHost) {
        const cr = await pool.query('select * from redeem_codes where code=$1', [code])
        rc = cr.rows[0]
        if (!rc) return res.status(404).json({ ok: false, error: 'invalid code' })
      }

      // ATOMIC SINGLE-USE CLAIM. redeemed_codes.code is a UNIQUE key, and this
      // insert is the whole guard: the FIRST insert of a given code wins; every
      // later attempt — a DIFFERENT profile, the SAME profile retrying, or a
      // CONCURRENT race — violates the constraint and throws. Under a stampede of
      // N simultaneous redeems of one code, exactly one insert commits and the
      // other N-1 land in the catch, no matter how they interleave. We claim
      // BEFORE granting anything, so a lost race never grants a tier/host role.
      // `claimKey` is the code's canonical identity (upper-cased host code, or
      // the redeem_codes.code key) so case variants can't each be claimed.
      const claimKey = isHost ? upper : rc.code
      try {
        await pool.query(
          'insert into redeemed_codes (code, redeemed_by) values ($1,$2)',
          [claimKey, uid(req)],
        )
      } catch {
        return res.status(409).json({ ok: false, error: 'code already used' })
      }

      // ---- We are the sole, first claimer of this code. Grant. ----

      // Founder HOST code: grant the global run-anything host flag (no tier).
      if (isHost) {
        const ur = await pool.query('select user_metadata from users where id=$1', [uid(req)])
        const meta = parseMeta(ur.rows[0]?.user_metadata)
        meta.tko_host = true
        await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), uid(req)])
        return res.json({ ok: true, host: true })
      }

      // Redeem_codes tier pass. The redeemed_codes claim above already made this
      // single-use; the uses/max_uses counter + per-user code_redemptions ledger
      // are kept as a secondary guard and to preserve the existing audit trail.
      // If either refuses (e.g. a misconfigured/expired/inactive code), RELEASE
      // the redeemed_codes claim so a valid code is never silently burned.
      const claim = await pool.query(
        `update redeem_codes
            set uses = coalesce(uses,0) + 1
          where code=$1
            and coalesce(active, true) = true
            and (expires_at is null or expires_at > now())
            and coalesce(uses,0) < coalesce(max_uses,1)
        returning *`,
        [rc.code],
      )
      if (!claim.rows.length) {
        await pool.query('delete from redeemed_codes where code=$1', [claimKey])
        return res.status(409).json({ ok: false, error: 'code not redeemable' })
      }
      const claimed = claim.rows[0]

      const tier = claimed.tier || 'pro'
      const months = Number(claimed.months ?? 1)
      const expires = new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000).toISOString()

      // Record the per-user redemption (audit trail). A successful global claim
      // means this is the first redemption of the code, so the insert succeeds;
      // if it somehow throws, release both claims so the code is not burned.
      try {
        await pool.query(
          'insert into code_redemptions (code, user_id, tier_granted, grant_expires_at) values ($1,$2,$3,$4)',
          [rc.code, uid(req), tier, expires],
        )
      } catch (e) {
        await pool.query('update redeem_codes set uses = greatest(coalesce(uses,0) - 1, 0) where code=$1', [rc.code])
        await pool.query('delete from redeemed_codes where code=$1', [claimKey])
        return res.status(409).json({ ok: false, error: 'already redeemed' })
      }

      // Grant the tier on the user's account (stored in user_metadata).
      const ur = await pool.query('select user_metadata from users where id=$1', [uid(req)])
      const meta = parseMeta(ur.rows[0]?.user_metadata)
      meta.reelone_tier = tier
      meta.reelone_tier_expires = expires
      await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), uid(req)])

      return res.json({ ok: true, tier, expires_at: expires })
    }
    // AUTO-MATCH: the client calls this right after it inserts a clip_records
    // analysis row. The server groups the clip against everyone else's clips in
    // the same time neighbourhood and, when it finds ≥2 angles of one match,
    // records the bunch + enqueues a render job + notifies the participants.
    if (name === 'auto-match') {
      const clipRecordId = String((req.body || {}).clipRecordId || '')
      if (!clipRecordId) return res.status(400).json({ ok: false, error: 'clipRecordId required' })
      // You may only trigger auto-match for a clip record you own.
      const own = await pool.query('select id from clip_records where id=$1 and player_id=$2', [clipRecordId, uid(req)])
      if (!own.rows.length) return res.status(403).json({ ok: false, error: 'not your clip record' })

      // Uploading a clip earns power — gate or no gate. Recompute from all their
      // clips so it self-backfills on the first call for an existing user.
      await recomputePower(pool, uid(req))

      // ENTITLEMENT GATE — the cross-user auto-merge/auto-build pipeline runs
      // ONLY for a paying member on a CONTENT tier (pro/supporter/creator; the
      // ad-only ad_free tier and free do NOT qualify) who has connected YouTube.
      // This is the ONLY place the server enforces it; the client gate is
      // bypassable. A non-entitled caller gets a benign no-op — ok:true so the
      // client never errors, but nothing is matched, enqueued, or notified.
      const gateMeta = parseMeta((await pool.query('select user_metadata from users where id=$1', [uid(req)])).rows[0]?.user_metadata)
      const gateYt = await pool.query('select 1 from user_youtube_links where user_id=$1 limit 1', [uid(req)])
      if (!isAutoMergeEntitled(gateMeta, gateYt.rows.length > 0)) {
        return res.json({ ok: true, gated: true, matched: false })
      }

      try {
        const result = await runAutoMatch(pool, clipRecordId)
        return res.json({ ok: true, ...result })
      } catch (e: any) {
        return res.status(400).json({ ok: false, error: e?.message || 'auto-match error' })
      }
    }

    if (name === 'remove-match-angle') {
      const matchId = String((req.body || {}).matchId || '')
      const reason = String((req.body || {}).reason || 'player requested removal')
      if (!matchId) return res.status(400).json({ ok: false, error: 'matchId required' })
      try {
        const result = await removeRecordedMatchAngle(pool, uid(req), matchId, reason)
        return res.json({ ok: true, ...result })
      } catch (e: any) {
        const status = e instanceof MatchConsentError ? e.statusCode : 400
        return res.status(status).json({ ok: false, error: e?.message || 'camera removal failed' })
      }
    }

    // CONQUEST BATTLE: record a VERIFIED clan battle result (from a match video).
    // Land moves on the BALANCE of head-to-head wins/losses weighted by clan
    // size — no agreement needed. One report never captures land; you must
    // out-fight a rival across many verified matches (see server/conquestBattle
    // .ts / dominanceCapture), so a single self-report does nothing. `matchKey`
    // (the produced-match id) makes every battle count exactly once.
    if (name === 'conquest-battle') {
      const b = req.body || {}
      const territoryId = String(b.territoryId || '')
      const winnerClanId = String(b.winnerClanId || '')
      const loserClanId = b.loserClanId ? String(b.loserClanId) : null
      const matchKey = b.matchKey ? String(b.matchKey) : null
      if (!territoryId || !winnerClanId) {
        return res.status(400).json({ ok: false, error: 'territoryId and winnerClanId required' })
      }
      // The reporter must be a participant (member of one of the two clans).
      try {
        const clans = [winnerClanId, loserClanId].filter(Boolean) as string[]
        const roster = await pool.query('select user_id, clan_id from clan_members where clan_id = any($1)', [clans])
        if (roster.rows.length > 0 && !roster.rows.some((r: any) => String(r.user_id) === uid(req))) {
          return res.status(403).json({ ok: false, error: 'only a participant clan may report this battle' })
        }
      } catch { /* no clan_members table → skip the check (mock/scaffold) */ }
      try {
        const result = await applyConquestBattle(pool, { winnerClanId, loserClanId, territoryId, matchKey })
        return res.json({ ok: true, ...result })
      } catch (e: any) {
        return res.status(400).json({ ok: false, error: e?.message || 'conquest battle error' })
      }
    }

    // CLAN ALLIANCE: two clans AGREE to merge into a village. A leader of one
    // clan proposes; a leader of the other accepts. Once allied, their battles
    // don't count for land and their combined size defends their territory.
    if (name === 'clan-ally') {
      const b = req.body || {}
      const action = String(b.action || '')
      const fromClanId = String(b.fromClanId || '')
      const toClanId = String(b.toClanId || '')
      if (!fromClanId || !toClanId || fromClanId === toClanId) {
        return res.status(400).json({ ok: false, error: 'two distinct clans required' })
      }
      const isMemberOf = async (clanId: string): Promise<boolean> => {
        try {
          const r = await pool.query('select user_id from clan_members where clan_id=$1 or server_id=$1', [clanId])
          return r.rows.length === 0 || r.rows.some((x: any) => String(x.user_id) === uid(req))
        } catch { return true }
      }
      try {
        if (action === 'propose') {
          if (!(await isMemberOf(fromClanId))) return res.status(403).json({ ok: false, error: 'not your clan' })
          await pool.query(
            `insert into clan_alliance_requests (from_clan_id, to_clan_id, requester_id, status)
             values ($1,$2,$3,'pending') on conflict (from_clan_id, to_clan_id) do update set status='pending'`,
            [fromClanId, toClanId, uid(req)],
          )
          return res.json({ ok: true, status: 'proposed' })
        }
        if (action === 'accept') {
          if (!(await isMemberOf(toClanId))) return res.status(403).json({ ok: false, error: 'not your clan' })
          const reqRow = await pool.query(
            "select id from clan_alliance_requests where from_clan_id=$1 and to_clan_id=$2 and status='pending'",
            [fromClanId, toClanId],
          )
          if (!reqRow.rows.length) return res.status(400).json({ ok: false, error: 'no pending proposal to accept' })
          await pool.query(
            'insert into clan_alliances (clan_id, ally_clan_id) values ($1,$2) on conflict (clan_id, ally_clan_id) do nothing',
            [fromClanId, toClanId],
          )
          await pool.query("update clan_alliance_requests set status='accepted' where from_clan_id=$1 and to_clan_id=$2", [fromClanId, toClanId])
          return res.json({ ok: true, status: 'allied' })
        }
        return res.status(400).json({ ok: false, error: 'action must be propose or accept' })
      } catch (e: any) {
        return res.status(400).json({ ok: false, error: e?.message || 'alliance error' })
      }
    }

    // TKO KING ladder: register (auto-pair), propose a time, or report a result.
    // The ladder never ends — a result re-rates both and re-pairs them.
    if (name === 'king') {
      const b = req.body || {}
      const action = String(b.action || 'register')
      try {
        if (action === 'register') {
          const rating = await ensureRating(pool, uid(req))
          const match = await pairNext(pool, uid(req))
          return res.json({ ok: true, match: match ?? null, rating })
        }
        if (action === 'status') {
          const rating = await ensureRating(pool, uid(req))
          return res.json({ ok: true, match: await openMatchFor(pool, uid(req)), rating })
        }
        if (action === 'propose') {
          const matchId = String(b.matchId || '')
          const slots = Array.isArray(b.slots) ? b.slots.map(String) : []
          if (!matchId || slots.length === 0) return res.status(400).json({ ok: false, error: 'matchId and slots required' })
          const out = await proposeTime(pool, matchId, uid(req), slots)
          return res.json({ ok: true, match: out })
        }
        if (action === 'report') {
          const matchId = String(b.matchId || '')
          const winnerId = String(b.winnerId || '')
          if (!matchId || !winnerId) return res.status(400).json({ ok: false, error: 'matchId and winnerId required' })
          // Only a participant may report (until auto-detect from video lands).
          const m = (await pool.query('select player_a, player_b from king_matches where id=$1', [matchId])).rows[0]
          if (!m) return res.status(404).json({ ok: false, error: 'match not found' })
          if (![String(m.player_a), String(m.player_b)].includes(uid(req))) {
            return res.status(403).json({ ok: false, error: 'not your match' })
          }
          const out = await reportResult(pool, matchId, winnerId)
          return res.json(out)
        }
        return res.status(400).json({ ok: false, error: 'unknown king action' })
      } catch (e: any) {
        return res.status(400).json({ ok: false, error: e?.message || 'king error' })
      }
    }

    // SYNC POWER: recompute the caller's power level from their activity. The
    // client calls this on the profile/home so power reflects real uploads +
    // produced videos (and backfills users who predate power tracking).
    if (name === 'sync-power') {
      const power = await recomputePower(pool, uid(req))
      return res.json({ ok: true, power })
    }

    // Unknown function: no-op success so callers never break.
    return res.json({ ok: true })
  })

  // ==========================================================================
  // INTERNAL — POST /api/internal/credit-produced
  //
  // Called by the auto-merge pipeline (NOT a browser) right after it uploads a
  // multi-angle video to the TKO channel, so being in a produced video actually
  // raises the players' power level. This is the missing write that kept power
  // stuck at 0: the pipeline uploaded to YouTube but never told the app who was
  // in the match. Auth is a shared service key, NOT a user JWT — it credits
  // OTHER users, which no signed-in user is ever allowed to do. Refused outright
  // if TKO_SERVICE_KEY is unset (fail closed), so it can't be hit in the wild.
  //
  // Body: { composite_youtube_id, angles: [{ user_id?|handle?|channel_id?,
  //          source_youtube_id?, source_start?, source_end?,
  //          timeline_start?, timeline_end?, partial?, outcome? }] }
  // channel_id→user overrides come from TKO_CHANNEL_OWNERS (JSON env), so the
  // founding clan's channels can be mapped without a redeploy.
  // ==========================================================================
  api.post('/internal/credit-produced', async (req, res) => {
    const key = process.env.TKO_SERVICE_KEY || ''
    if (!key || String(req.headers['x-tko-service'] || '') !== key) {
      return res.status(401).json({ ok: false, error: 'unauthorized' })
    }
    const body = req.body || {}
    const composite = String(body.composite_youtube_id || '').trim()
    const matchKey = String(body.match_key || '').trim()
    const angles = Array.isArray(body.angles) ? (body.angles as CreditAngle[]) : []
    if (!composite || !angles.length) {
      return res.status(400).json({ ok: false, error: 'composite_youtube_id and angles required' })
    }
    // TKO_CHANNEL_OWNERS maps youtube channel_id → TKO user_id. Accepts JSON
    // ({"UC…":"uuid"}) OR a shell-friendly "UC…=uuid,UC…=uuid" list — the latter
    // survives Windows/gcloud quote-stripping, which silently mangles JSON.
    let ownerMap: OwnerMap = {}
    const rawOwners = (process.env.TKO_CHANNEL_OWNERS || '').trim()
    if (rawOwners) {
      try {
        ownerMap = JSON.parse(rawOwners)
      } catch {
        for (const pair of rawOwners.replace(/^[{]|[}]$/g, '').split(',')) {
          const [k, v] = pair.split(/[=:]/).map((s) => s.trim().replace(/^["']|["']$/g, ''))
          if (k && v) ownerMap[k] = v
        }
      }
    }
    try {
      const out = await creditProduced(pool, composite, angles, recomputePower, ownerMap)
      if (matchKey) {
        const already = await pool.query(
          'select version from match_versions where match_key=$1 and youtube_id=$2 limit 1',
          [matchKey, composite],
        )
        if (!already.rows.length) {
          const next = await pool.query(
            `select coalesce(max(version),0)::int + 1 as version
               from match_versions where match_key=$1`,
            [matchKey],
          )
          const sourceAngles = angles.map((angle) => {
            const finite = (value: unknown) => {
              const parsed = Number(value)
              return Number.isFinite(parsed) ? parsed : null
            }
            return {
              user_id: angle.user_id || null,
              handle: angle.handle || null,
              channel_id: angle.channel_id || null,
              source_youtube_id: angle.source_youtube_id || null,
              source_start: finite(angle.source_start),
              source_end: finite(angle.source_end),
              timeline_start: finite(angle.timeline_start),
              timeline_end: finite(angle.timeline_end),
              coverage_seconds: finite(angle.coverage_seconds),
              partial: Boolean(angle.partial),
            }
          })
          await pool.query(
            `insert into match_versions
               (match_key,version,youtube_id,angle_count,participant_ids,clip_ids,reason,source_angles)
             values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
            [
              matchKey,
              Number(next.rows[0]?.version ?? 1),
              composite,
              angles.length,
              out.credited.map((item) => item.user_id),
              out.credited.map((item) => item.clip_record_id).filter(Boolean),
              String(body.reason || 'verified_auto_merge'),
              JSON.stringify(sourceAngles),
            ],
          )
        }
      }
      return res.json({ ok: true, ...out })
    } catch (e: any) {
      return res.status(400).json({ ok: false, error: e?.message || 'credit failed' })
    }
  })

  // ==========================================================================
  // ACCOUNT DELETION — DELETE /api/account
  //                    POST   /api/account/delete   (same handler, for clients
  //                                                  that can't send a body on DELETE)
  //                    POST   /api/fn/delete-account (via the functions shim)
  //
  // Required by Google Play (account-deletion policy) and Apple 5.1.1(v), and
  // promised by src/pages/DataDeletion.tsx. This is a HARD delete of the `users`
  // row; db/schema.sql cascades profiles → clips, reels, posts, messages,
  // follows, registrations, trophies and the rest, so the account's username and
  // clan tag are freed immediately for someone else to claim.
  //
  // The caller can only ever delete THEMSELVES: the id comes from the verified
  // JWT (`uid(req)`) and no user id is read from the request body, so there is
  // no parameter to tamper with.
  // ==========================================================================

  /** Best-effort statement — a table missing from a slim test schema must not
   *  abort a deletion that is otherwise correct. */
  const tryQuery = async (sql: string, params: any[] = []): Promise<any[]> => {
    try { return (await pool.query(sql, params)).rows } catch { return [] }
  }

  const millis = (v: any): number => {
    const t = new Date(v ?? 0).getTime()
    return Number.isFinite(t) ? t : 0
  }

  /**
   * CLAN LEADER EDGE CASE — chosen behaviour: AUTOMATIC SUCCESSION, never a block.
   *
   * Refusing to delete a leader's account until they hand the clan over would
   * make deletion conditional, which is exactly what the store policies forbid
   * (and it strands anyone whose co-leaders have gone inactive). Blindly
   * disbanding is the opposite failure: it destroys other people's clan, which
   * is not the leaving user's data to delete.
   *
   * So we promote a successor and only disband when there is genuinely nobody
   * left. Order of succession: longest-serving OFFICER, else longest-serving
   * remaining MEMBER, else — a clan of one — the clan is disbanded.
   */
  const handOverClans = async (userId: string): Promise<{ transferred: number; disbanded: number }> => {
    const out = { transferred: 0, disbanded: 0 }
    const owned = await tryQuery('select id from servers where owner_id=$1', [userId])
    const led = await tryQuery("select server_id from clan_members where user_id=$1 and role='leader'", [userId])
    const ids = Array.from(new Set([
      ...owned.map((r) => String(r.id)),
      ...led.map((r) => String(r.server_id)),
    ]))

    for (const serverId of ids) {
      const others = await tryQuery(
        'select user_id, role, joined_at from clan_members where server_id=$1 and user_id<>$2',
        [serverId, userId],
      )
      const byTenure = [...others].sort((a, b) => millis(a.joined_at) - millis(b.joined_at))
      const successor = byTenure.find((m) => m.role === 'officer') ?? byTenure[0]
      if (successor) {
        await tryQuery(
          "update clan_members set role='leader' where server_id=$1 and user_id=$2",
          [serverId, successor.user_id],
        )
        await tryQuery('update servers set owner_id=$1 where id=$2', [successor.user_id, serverId])
        out.transferred += 1
      } else {
        // Sole member: the clan is the leaving user's own data. Disband it.
        await tryQuery('delete from servers where id=$1', [serverId])
        out.disbanded += 1
      }
    }
    // Whatever happened above, the leaver stops being a member anywhere.
    await tryQuery('delete from clan_members where user_id=$1', [userId])
    return out
  }

  const deleteOwnAccount = async (userId: string) => {
    const clans = await handOverClans(userId)
    // Delete the profile first: on real Postgres its ON DELETE CASCADE fan-out
    // removes every dependent row, and it frees the username straight away.
    await tryQuery('delete from profiles where id=$1', [userId])
    const r = await pool.query('delete from users where id=$1 returning id', [userId])
    return { deleted: r.rows.length > 0, clans }
  }

  const handleAccountDelete = async (req: Request, res: Response) => {
    const userId = uid(req)
    try {
      const r = await deleteOwnAccount(userId)
      if (!r.deleted) return res.status(404).json({ ok: false, error: 'account not found' })
      return res.json({ ok: true, deleted: true, user_id: userId, clans: r.clans })
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message || 'account deletion failed' })
    }
  }

  api.delete('/account', auth, handleAccountDelete)
  api.post('/account/delete', auth, handleAccountDelete)

  // ==========================================================================
  // STORAGE  — POST /api/storage/:bucket  (GCS deferred; return a stable path)
  // ==========================================================================
  api.post('/storage/:bucket', auth, async (req, res) => {
    const bucket = String(req.params.bucket || 'uploads').replace(/[^a-zA-Z0-9_-]/g, '') || 'uploads'
    const name = String((req.body || {}).name || 'file').replace(/[^\w.\-]+/g, '_')
    const path = `${bucket}/${randomUUID()}_${name}`
    return res.json({ path, publicUrl: '' })
  })

  // ==========================================================================
  // STRIPE PAYMENTS — checkout (subscriptions + token packs), webhook, and
  // Stripe Connect for creator payouts (platform keeps 20%, creator gets 80%).
  // Reuses the same "update user_metadata" grant pattern as redeem-code above.
  // ==========================================================================

  const getStripeAccountId = async (userId: string): Promise<string | null> => {
    const r = await pool.query('select stripe_account_id from creator_stripe_accounts where user_id=$1', [userId])
    return (r.rows[0]?.stripe_account_id as string) || null
  }
  const saveStripeAccountId = async (userId: string, accountId: string): Promise<void> => {
    const now = new Date().toISOString()
    await pool.query(
      `insert into creator_stripe_accounts
         (user_id, stripe_account_id, charges_enabled, payouts_enabled, transfers_enabled, updated_at)
       values ($1,$2,false,false,false,$3)
       on conflict (user_id) do update set stripe_account_id = excluded.stripe_account_id, updated_at = excluded.updated_at`,
      [userId, accountId, now],
    )
    // Mirror onto the user for quick reads elsewhere.
    const ur = await pool.query('select user_metadata from users where id=$1', [userId])
    if (ur.rows[0]) {
      const meta = parseMeta(ur.rows[0].user_metadata)
      meta.stripe_account_id = accountId
      await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), userId])
    }
  }
  const setStripeAccountFlags = async (
    userId: string,
    accountId: string,
    charges: boolean,
    payouts: boolean,
    transfers: boolean,
  ): Promise<void> => {
    const now = new Date().toISOString()
    const onboardedAt = transfers && payouts ? now : null
    await pool.query(
      `insert into creator_stripe_accounts
         (user_id, stripe_account_id, charges_enabled, payouts_enabled, transfers_enabled, onboarded_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (user_id) do update set
         stripe_account_id = excluded.stripe_account_id,
         charges_enabled = excluded.charges_enabled,
         payouts_enabled = excluded.payouts_enabled,
         transfers_enabled = excluded.transfers_enabled,
         onboarded_at = coalesce(creator_stripe_accounts.onboarded_at, excluded.onboarded_at),
         updated_at = excluded.updated_at`,
      [userId, accountId, charges, payouts, transfers, onboardedAt, now],
    )
  }
  /**
   * Grant a subscription tier until `expiresISO`. This is the ONE function that
   * writes an entitlement on the back of a payment, and it is reachable only
   * from the signature-verified webhook.
   */
  const grantTierUntil = async (userId: string, tier: string, expiresISO: string): Promise<void> => {
    const ur = await pool.query('select user_metadata from users where id=$1', [userId])
    if (!ur.rows[0]) return
    const meta = parseMeta(ur.rows[0].user_metadata)
    meta.reelone_tier = tier
    meta.reelone_tier_expires = expiresISO
    await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), userId])
  }

  /** Grant a tier for ~1 month — same effect as a redeem code. */
  const grantTier = (userId: string, tier: string): Promise<void> =>
    grantTierUntil(userId, tier, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString())

  /**
   * Drop a user back to Free. Used when a subscription is cancelled, expires, or
   * its renewal invoice fails. Deliberately immediate rather than "at period
   * end": Stripe already tells us the period end via subscription.updated, so by
   * the time a `deleted`/`payment_failed` arrives the access really is over.
   */
  const lapseTier = async (userId: string): Promise<void> => {
    const ur = await pool.query('select user_metadata from users where id=$1', [userId])
    if (!ur.rows[0]) return
    const meta = parseMeta(ur.rows[0].user_metadata)
    meta.reelone_tier = ''
    meta.reelone_tier_expires = new Date().toISOString()
    await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), userId])
  }

  /** Stripe sends period ends as unix SECONDS. Fall back to ~1 month out. */
  const periodEndISO = (unixSeconds: any): string => {
    const n = Number(unixSeconds)
    if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toISOString()
    return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }

  // ---- Stripe Customer <-> user mapping ------------------------------------
  // One Customer per user, stored on the user record. Without this every
  // checkout creates a fresh Customer, so a returning buyer's cards and
  // subscription history scatter across duplicates and the lifecycle webhooks
  // (which identify the account by customer id) cannot find the user.

  const savedCustomerId = async (userId: string): Promise<string> => {
    const r = await pool.query('select stripe_customer_id from users where id=$1', [userId])
    return (r.rows[0]?.stripe_customer_id as string) || ''
  }

  /** Which user owns this Stripe customer? The lifecycle events' only handle. */
  const userIdForCustomer = async (customerId: string): Promise<string> => {
    if (!customerId) return ''
    const r = await pool.query('select id from users where stripe_customer_id=$1', [String(customerId)])
    return (r.rows[0]?.id as string) || ''
  }

  /** Reuse the user's Stripe Customer, creating (and saving) one on first buy. */
  const ensureCustomer = async (userId: string, email: string): Promise<string> => {
    const existing = await savedCustomerId(userId)
    if (existing) return existing
    const r = await stripeFetch('/customers', new URLSearchParams({
      ...(email ? { email } : {}),
      'metadata[user_id]': userId,
    }))
    if (!r.ok || !r.json?.id) return ''
    const id = String(r.json.id)
    await pool.query('update users set stripe_customer_id=$1 where id=$2', [id, userId])
    return id
  }

  /**
   * Resolve the account a webhook event belongs to: metadata first (set by our
   * own checkout), then the customer mapping (the only handle a renewal has).
   */
  const resolveEventUser = async (obj: any): Promise<string> => {
    const fromMeta = obj?.metadata?.user_id || obj?.client_reference_id
    if (fromMeta) {
      const r = await pool.query('select id from users where id=$1', [String(fromMeta)])
      if (r.rows[0]) return String(r.rows[0].id)
    }
    return userIdForCustomer(String(obj?.customer || ''))
  }

  // ---- the audit trail -----------------------------------------------------

  type PaymentRow = {
    userId: string
    kind: 'subscription' | 'token_pack'
    status: 'paid' | 'unpaid' | 'failed' | 'refunded'
    eventId?: string | null
    sessionId?: string | null
    invoiceId?: string | null
    subscriptionId?: string | null
    customerId?: string | null
    tier?: string | null
    pack?: string | null
    amountCents?: number
    currency?: string
    tokens?: number
    sweeps?: number
  }

  /** One receipt row per fulfilment attempt. Best-effort: a slim test schema
   *  without the table must not fail an otherwise-correct credit. */
  const recordPayment = async (p: PaymentRow): Promise<void> => {
    try {
      await pool.query(
        `insert into payments
           (user_id, stripe_event_id, stripe_session_id, stripe_invoice_id,
            stripe_subscription_id, stripe_customer_id, kind, tier, pack,
            amount_cents, currency, tokens_credited, sweeps_credited, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [p.userId || null, p.eventId ?? null, p.sessionId ?? null, p.invoiceId ?? null,
          p.subscriptionId ?? null, p.customerId ?? null, p.kind, p.tier ?? null, p.pack ?? null,
          Math.max(0, Math.round(p.amountCents ?? 0)), p.currency || 'usd',
          Math.max(0, Math.round(p.tokens ?? 0)), Math.max(0, Math.round(p.sweeps ?? 0)), p.status],
      )
    } catch { /* audit is best-effort; never fail a fulfilled purchase on it */ }
  }

  // ---- idempotency ---------------------------------------------------------
  //
  // Stripe delivers AT LEAST ONCE and retries every non-2xx for up to 3 days, so
  // "credit 550 Tokens" will eventually arrive twice. The event id is the
  // primary key of `stripe_events`: we CLAIM it before doing any work, and a
  // replay collides with the key and no-ops.
  //
  // The claim is inserted BEFORE fulfilment and DELETED if fulfilment throws, so
  // a genuine failure is retried (and succeeds), while a success can never be
  // applied twice. The only gap is a hard process crash between the claim and
  // the work — which loses a delivery rather than double-charging, the correct
  // way round for money.

  /** True when this event id is new and we now own it. */
  const claimEvent = async (id: string, type: string): Promise<boolean> => {
    if (!id) return true // no id to dedupe on (hand-crafted test payloads)
    try {
      await pool.query('insert into stripe_events (id, type) values ($1,$2)', [id, String(type || '')])
      return true
    } catch {
      return false // primary-key collision == already processed
    }
  }

  const releaseEvent = async (id: string): Promise<void> => {
    if (!id) return
    try { await pool.query('delete from stripe_events where id=$1', [id]) } catch { /* ignore */ }
  }

  // ---- creator marketplace ------------------------------------------------

  type CreatorItem = {
    itemType: 'asset' | 'offer'
    itemId: string
    sellerUserId: string
    sellerType: 'creator' | 'clan'
    clanId: string | null
    name: string
    description: string
    imageUrl: string
    listPriceCents: number
    billingInterval: 'one_time' | 'month'
    cashEnabled: boolean
    paidSweepsEnabled: boolean
    giftable: boolean
  }

  const CREATOR_TAX_CONSENT_VERSION = '2026-07-25'
  const PLATFORM_FEE_DEBIT_CONSENT_VERSION = '2026-07-25'

  const creatorSellerTier = async (
    db: Pooly,
    userId: string,
  ): Promise<CreatorSellerTier | null> => {
    const r = await db.query('select user_metadata from users where id=$1', [userId])
    const tier = activeTierFromMeta(parseMeta(r.rows[0]?.user_metadata))
    return tier === 'pro' || tier === 'supporter' || tier === 'creator'
      ? tier
      : null
  }

  const creatorAccount = async (db: Pooly, sellerUserId: string): Promise<any | null> => {
    const r = await db.query(
      `select stripe_account_id, charges_enabled, payouts_enabled, transfers_enabled,
              tax_certified_at, tax_form_type, electronic_1099_consent_at, tax_consent_version,
              platform_fee_debit_consent_at, platform_fee_debit_consent_version
         from creator_stripe_accounts where user_id=$1`,
      [sellerUserId],
    )
    return r.rows[0] || null
  }

  const creatorPayoutReady = (account: any): boolean =>
    !!account?.stripe_account_id
    && account?.transfers_enabled === true
    && account?.payouts_enabled === true
    && !!account?.tax_certified_at
    && !!account?.electronic_1099_consent_at
    && account?.tax_consent_version === CREATOR_TAX_CONSENT_VERSION
    && !!account?.platform_fee_debit_consent_at
    && account?.platform_fee_debit_consent_version === PLATFORM_FEE_DEBIT_CONSENT_VERSION

  const creatorCycleKey = (date = new Date()): string =>
    date.toISOString().slice(0, 7)

  const creatorCycleEnd = (date = new Date()): string =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString()

  type CreatorPlatformFeeType =
    | 'active_account'
    | 'payment_processing'
    | 'payout_processing'
    | 'tax_reporting'

  /**
   * Record and, when authorized, collect an actual external platform cost from
   * the connected account's Stripe balance. This never represents income tax
   * or customer sales tax. Account debits cannot drive the account negative;
   * a failed debit remains visible and can be retried after earnings arrive.
   */
  const settleCreatorPlatformFee = async ({
    sellerUserId,
    feeType,
    periodKey,
    totalFeeCents,
    sourceRef,
  }: {
    sellerUserId: string
    feeType: CreatorPlatformFeeType
    periodKey: string
    totalFeeCents: number
    sourceRef?: string | null
  }): Promise<any> => {
    const total = Math.max(0, Math.round(totalFeeCents))
    const allocation = sellerExternalCostAllocation(total)
    const sellerFee = allocation.sellerFeeCents
    const platformFee = allocation.platformFeeCents

    let fee: any
    try {
      const inserted = await pool.query(
        `insert into creator_platform_fees
           (seller_user_id,fee_type,period_key,source_ref,total_fee_cents,
            seller_fee_cents,platform_fee_cents,included_pass_id,status,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
         returning *`,
        [
          sellerUserId,
          feeType,
          periodKey,
          sourceRef || null,
          total,
          sellerFee,
          platformFee,
          null,
          sellerFee === 0 ? 'collected' : 'pending',
        ],
      )
      fee = inserted.rows[0]
    } catch {
      const prior = await pool.query(
        `select * from creator_platform_fees
          where seller_user_id=$1 and fee_type=$2 and period_key=$3`,
        [sellerUserId, feeType, periodKey],
      )
      fee = prior.rows[0]
    }
    if (!fee || fee.status === 'collected' || fee.status === 'sponsored') return fee

    const account = await creatorAccount(pool, sellerUserId)
    const debitAuthorized = !!account?.platform_fee_debit_consent_at
      && account?.platform_fee_debit_consent_version === PLATFORM_FEE_DEBIT_CONSENT_VERSION
    if (!account?.stripe_account_id || !debitAuthorized || sellerFee <= 0) return fee

    const charge = await stripeFetch('/charges', new URLSearchParams({
      amount: String(sellerFee),
      currency: 'usd',
      source: String(account.stripe_account_id),
      description: feeType === 'active_account'
        ? `TKO creator active-account fee ${periodKey}`
        : feeType === 'tax_reporting'
          ? `TKO tax-form filing fee ${periodKey}`
          : feeType === 'payment_processing'
            ? `TKO payment processing fee ${periodKey}`
            : `TKO payout processing fee ${periodKey}`,
      'metadata[kind]': 'tko_creator_platform_fee',
      'metadata[fee_id]': String(fee.id),
      'metadata[seller_user_id]': sellerUserId,
      'metadata[fee_type]': feeType,
      'metadata[period_key]': periodKey,
    }))
    if (!charge.ok || !charge.json?.id) {
      const detail = String(charge.json?.error?.message || 'Stripe account debit failed').slice(0, 500)
      const failed = await pool.query(
        `update creator_platform_fees set status='failed', error=$2, updated_at=now()
          where id=$1 returning *`,
        [fee.id, detail],
      )
      return failed.rows[0] || fee
    }
    const collected = await pool.query(
      `update creator_platform_fees
          set status='collected', stripe_payment_id=$2, error=null, updated_at=now()
        where id=$1 returning *`,
      [fee.id, String(charge.json.id)],
    )
    return collected.rows[0] || fee
  }

  const stripeBalanceTransactionFeeCents = async (
    balanceTransaction: unknown,
    connectedAccountId?: string,
  ): Promise<number> => {
    if (balanceTransaction && typeof balanceTransaction === 'object') {
      return Math.max(0, Math.round(Number((balanceTransaction as any).fee || 0)))
    }
    const balanceTransactionId = String(balanceTransaction || '')
    if (!balanceTransactionId) return 0
    const result = await stripeFetch(
      `/balance_transactions/${encodeURIComponent(balanceTransactionId)}`,
      undefined,
      'GET',
      connectedAccountId,
    )
    return result.ok ? Math.max(0, Math.round(Number(result.json?.fee || 0))) : 0
  }

  const settleOrderProcessingFee = async ({
    sellerUserId,
    orderId,
    paymentIntentId,
    charge,
  }: {
    sellerUserId: string
    orderId: string
    paymentIntentId?: string | null
    charge?: any
  }): Promise<any | null> => {
    let resolvedCharge = charge
    if (!resolvedCharge && paymentIntentId) {
      const intent = await stripeFetch(
        `/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge.balance_transaction`,
        undefined,
        'GET',
      )
      if (intent.ok) resolvedCharge = intent.json?.latest_charge
    }
    if (typeof resolvedCharge === 'string') {
      const chargeResult = await stripeFetch(
        `/charges/${encodeURIComponent(resolvedCharge)}?expand[]=balance_transaction`,
        undefined,
        'GET',
      )
      resolvedCharge = chargeResult.ok ? chargeResult.json : null
    }
    const feeCents = await stripeBalanceTransactionFeeCents(resolvedCharge?.balance_transaction)
    if (feeCents <= 0) return null
    return settleCreatorPlatformFee({
      sellerUserId,
      feeType: 'payment_processing',
      periodKey: `order:${orderId}`,
      totalFeeCents: feeCents,
      sourceRef: String(resolvedCharge?.id || paymentIntentId || orderId),
    })
  }

  const resolveCreatorItem = async (db: Pooly, body: any): Promise<CreatorItem | null> => {
    const assetId = String(body?.asset_id || body?.assetId || '')
    const offerId = String(body?.offer_id || body?.offerId || '')
    if ((assetId ? 1 : 0) + (offerId ? 1 : 0) !== 1) return null

    if (assetId) {
      const r = await db.query(
        `select a.*, s.owner_id as clan_owner_id
           from assets a
           left join servers s on s.id = a.clan_id
          where a.id=$1`,
        [assetId],
      )
      const a = r.rows[0]
      if (!a || !isCreatorPriceCents(a.price_cents)) return null
      const sellerType = String(a.seller_type || 'creator')
      if (sellerType !== 'creator' && sellerType !== 'clan') return null
      const sellerUserId = sellerType === 'clan'
        ? String(a.clan_owner_id || '')
        : String(a.created_by || '')
      if (!sellerUserId) return null
      return {
        itemType: 'asset',
        itemId: String(a.id),
        sellerUserId,
        sellerType,
        clanId: a.clan_id ? String(a.clan_id) : null,
        name: String(a.name || 'TKO creator item'),
        description: `${String(a.team_name || 'TKO')} digital item`,
        imageUrl: String(a.image_url || ''),
        listPriceCents: Number(a.price_cents),
        billingInterval: 'one_time',
        cashEnabled: a.cash_enabled === true,
        paidSweepsEnabled: a.paid_sweeps_enabled === true,
        giftable: true,
      }
    }

    const r = await db.query('select * from creator_offers where id=$1 and active=true', [offerId])
    const o = r.rows[0]
    if (!o || !isCreatorPriceCents(o.price_cents)) return null
    const sellerType = String(o.seller_type || 'creator')
    if (sellerType !== 'creator' && sellerType !== 'clan') return null
    return {
      itemType: 'offer',
      itemId: String(o.id),
      sellerUserId: String(o.seller_user_id),
      sellerType,
      clanId: o.clan_id ? String(o.clan_id) : null,
      name: String(o.name || 'TKO creator membership'),
      description: String(o.description || 'Support a TKO creator or clan.'),
      imageUrl: String(o.image_url || ''),
      listPriceCents: Number(o.price_cents),
      billingInterval: o.billing_interval === 'month' ? 'month' : 'one_time',
      cashEnabled: o.cash_enabled !== false,
      paidSweepsEnabled: o.paid_sweeps_enabled !== false,
      giftable: o.giftable !== false,
    }
  }

  const validRecipient = async (
    db: Pooly,
    buyerId: string,
    requested: unknown,
    giftable: boolean,
  ): Promise<string | null> => {
    const recipient = String(requested || buyerId)
    if (recipient !== buyerId && !giftable) return null
    const r = await db.query('select id from profiles where id=$1', [recipient])
    return r.rows[0] ? recipient : null
  }

  const grantCreatorOrder = async (
    db: Pooly,
    order: any,
    stripeSubscriptionId?: string | null,
  ): Promise<void> => {
    const recipientId = String(order.recipient_id || order.buyer_id)
    if (order.asset_id) {
      await db.query(
        `insert into asset_ownership (user_id, asset_id, source, ref_id)
         values ($1,$2,'purchase',$3)
         on conflict (user_id, asset_id) do nothing`,
        [recipientId, order.asset_id, String(order.id)],
      )
      return
    }
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    await db.query(
      `insert into creator_entitlements
         (order_id, user_id, offer_id, status, stripe_subscription_id, starts_at, expires_at, updated_at)
       values ($1,$2,$3,'active',$4,now(),$5,now())
       on conflict (order_id, user_id) do update set
         status='active',
         stripe_subscription_id=coalesce(excluded.stripe_subscription_id, creator_entitlements.stripe_subscription_id),
         expires_at=excluded.expires_at,
         updated_at=now()`,
      [order.id, recipientId, order.offer_id, stripeSubscriptionId ?? null, expires],
    )
  }

  const settleCreatorOrder = async (
    db: Pooly,
    orderId: string,
    stripeData: {
      sessionId?: string | null
      paymentIntentId?: string | null
      subscriptionId?: string | null
      automaticTransfer?: boolean
    } = {},
  ): Promise<any | null> => {
    const updated = await db.query(
      `update creator_orders
          set status=$2,
              stripe_checkout_session_id=coalesce($3,stripe_checkout_session_id),
              stripe_payment_intent_id=coalesce($4,stripe_payment_intent_id),
              stripe_subscription_id=coalesce($5,stripe_subscription_id),
              paid_at=coalesce(paid_at,now()),
              updated_at=now()
        where id=$1 and status in ('pending','payout_pending')
        returning *`,
      [
        orderId,
        stripeData.automaticTransfer ? 'transferred' : 'payout_pending',
        stripeData.sessionId ?? null,
        stripeData.paymentIntentId ?? null,
        stripeData.subscriptionId ?? null,
      ],
    )
    const order = updated.rows[0]
    if (!order) return null
    await grantCreatorOrder(db, order, stripeData.subscriptionId)
    await db.query(
      `insert into creator_earnings
         (order_id, seller_user_id, amount_cents, status, available_at, transferred_at, updated_at)
       values ($1,$2,$3,$4,now(),$5,now())
       on conflict (order_id) do update set
         status=excluded.status,
         available_at=coalesce(creator_earnings.available_at,excluded.available_at),
         transferred_at=coalesce(creator_earnings.transferred_at,excluded.transferred_at),
         updated_at=now()`,
      [
        order.id,
        order.seller_user_id,
        Number(order.seller_share_cents),
        stripeData.automaticTransfer ? 'transferred' : 'available',
        stripeData.automaticTransfer ? new Date().toISOString() : null,
      ],
    )
    return order
  }

  const transferPaidSweepsEarning = async (
    order: any,
  ): Promise<{ transferred: boolean; transferId?: string }> => {
    const account = await creatorAccount(pool, String(order.seller_user_id))
    if (!creatorPayoutReady(account)) {
      return { transferred: false }
    }
    const transfer = await stripeFetch('/transfers', new URLSearchParams({
      amount: String(Math.max(0, Number(order.seller_share_cents))),
      currency: String(order.currency || 'usd'),
      destination: String(account.stripe_account_id),
      transfer_group: `TKO_ORDER_${String(order.id)}`,
      'metadata[kind]': 'tko_creator_order',
      'metadata[order_id]': String(order.id),
      'metadata[seller_user_id]': String(order.seller_user_id),
    }))
    if (!transfer.ok || !transfer.json?.id) return { transferred: false }
    const transferId = String(transfer.json.id)
    await pool.query(
      `update creator_orders
          set status='transferred', stripe_transfer_id=$2, updated_at=now()
        where id=$1`,
      [order.id, transferId],
    )
    await pool.query(
      `update creator_earnings
          set status='transferred', stripe_transfer_id=$2, transferred_at=now(), updated_at=now()
        where order_id=$1`,
      [order.id, transferId],
    )
    await settleCreatorPlatformFee({
      sellerUserId: String(order.seller_user_id),
      feeType: 'active_account',
      periodKey: creatorCycleKey(),
      totalFeeCents: CREATOR_ACTIVE_ACCOUNT_FEE_CENTS,
      sourceRef: transferId,
    })
    return { transferred: true, transferId }
  }

  const orderIdempotencyKey = (buyerId: string, raw: unknown): string =>
    `${buyerId}:${String(raw || randomUUID()).slice(0, 160)}`

  // Public money rules for the UI. No secret or Stripe account identifier is
  // exposed. Free Give Points are explicitly excluded from creator purchases.
  api.get('/creator/config', (_req, res) => res.json({
    configured: stripeConfigured(),
    price_cents: CREATOR_PRICE_CENTS,
    cash: {
      seller_percent_by_tier: { pro: 50, supporter: 65, creator: 80 },
      platform_percent_by_tier: { pro: 50, supporter: 35, creator: 20 },
    },
    paid_sweeps: {
      discount_percent: 30,
      seller_percent_of_discounted_price_by_tier: { pro: 50, supporter: 65, creator: 80 },
      free_give_points_eligible: false,
    },
    seller_costs: {
      seller_percent: 100,
      active_account_fee_cents: CREATOR_ACTIVE_ACCOUNT_FEE_CENTS,
      categories: ['payment_processing', 'payout_processing', 'active_account', 'tax_reporting'],
      excludes_income_tax: true,
    },
    minimum_seller_tier: 'pro',
    tax_consent_version: CREATOR_TAX_CONSENT_VERSION,
  }))

  api.get('/creator/included-pass', auth, async (req, res) => {
    const userId = uid(req)
    const tier = await creatorSellerTier(pool, userId)
    const cycleKey = creatorCycleKey()
    const result = await pool.query(
      `select p.*, o.name offer_name, o.description offer_description,
              o.offer_type, o.image_url
         from creator_included_passes p
         join creator_offers o on o.id=p.offer_id
        where p.member_user_id=$1 and p.cycle_key=$2
        order by p.created_at desc limit 1`,
      [userId, cycleKey],
    )
    return res.json({
      eligible: hasIncludedCreatorPass(tier),
      tier,
      cycle_key: cycleKey,
      expires_at: creatorCycleEnd(),
      pass: result.rows[0] || null,
    })
  })

  api.post('/creator/included-pass', auth, async (req, res) => {
    const userId = uid(req)
    const tier = await creatorSellerTier(pool, userId)
    if (!tier || !hasIncludedCreatorPass(tier)) {
      return res.status(403).json({ error: 'included_pass_requires_elite_or_legend' })
    }
    const offerId = String(req.body?.offer_id || '')
    if (!offerId) return res.status(400).json({ error: 'offer_id_required' })
    const offerResult = await pool.query(
      `select * from creator_offers
        where id=$1 and active=true and billing_interval='month'
          and offer_type in ('creator_subscription','clan_subscription')`,
      [offerId],
    )
    const offer = offerResult.rows[0]
    if (!offer) return res.status(404).json({ error: 'basic_channel_offer_not_found' })
    if (String(offer.seller_user_id) === userId) {
      return res.status(400).json({ error: 'self_subscription_not_allowed' })
    }
    const cycleKey = creatorCycleKey()
    const existing = await pool.query(
      `select * from creator_included_passes where member_user_id=$1 and cycle_key=$2`,
      [userId, cycleKey],
    )
    if (existing.rows[0]) {
      if (String(existing.rows[0].offer_id) === offerId) {
        return res.json({ ok: true, pass: existing.rows[0], reused: true })
      }
      return res.status(409).json({
        error: 'included_pass_already_used_this_month',
        pass: existing.rows[0],
      })
    }

    const userResult = await pool.query('select user_metadata from users where id=$1', [userId])
    const meta = parseMeta(userResult.rows[0]?.user_metadata)
    const membershipExpiryMs = Date.parse(String(meta.reelone_tier_expires || ''))
    const cycleEndMs = Date.parse(creatorCycleEnd())
    const expiresAt = Number.isFinite(membershipExpiryMs)
      ? new Date(Math.min(membershipExpiryMs, cycleEndMs)).toISOString()
      : new Date(cycleEndMs).toISOString()

    try {
      const pass = await withTransaction(async (db) => {
        const inserted = await db.query(
          `insert into creator_included_passes
             (member_user_id,offer_id,seller_user_id,membership_tier,cycle_key,expires_at)
           values ($1,$2,$3,$4,$5,$6)
           returning *`,
          [userId, offerId, offer.seller_user_id, tier, cycleKey, expiresAt],
        )
        const row = inserted.rows[0]
        await db.query(
          `insert into creator_entitlements
             (included_pass_id,user_id,offer_id,status,starts_at,expires_at,updated_at)
           values ($1,$2,$3,'active',now(),$4,now())`,
          [row.id, userId, offerId, expiresAt],
        )
        return row
      })
      return res.status(201).json({
        ok: true,
        pass,
        basic_access: ['view_subscriber_content', 'post', 'comment'],
        creator_payout_cents: 0,
      })
    } catch (error: any) {
      const raced = await pool.query(
        `select * from creator_included_passes where member_user_id=$1 and cycle_key=$2`,
        [userId, cycleKey],
      )
      if (raced.rows[0]) {
        return res.status(409).json({
          error: 'included_pass_already_used_this_month',
          pass: raced.rows[0],
        })
      }
      return res.status(500).json({
        error: 'included_pass_failed',
        detail: error?.message || 'pass could not be granted',
      })
    }
  })

  api.get('/creator/offers', async (req, res) => {
    const seller = String(req.query.seller_user_id || '')
    const clan = String(req.query.clan_id || '')
    const params: any[] = []
    const where = ['active=true']
    if (seller) { params.push(seller); where.push(`seller_user_id=$${params.length}`) }
    if (clan) { params.push(clan); where.push(`clan_id=$${params.length}`) }
    const r = await pool.query(
      `select * from creator_offers where ${where.join(' and ')} order by created_at desc limit 100`,
      params,
    )
    res.json({ offers: r.rows })
  })

  api.post('/creator/listings', auth, async (req, res) => {
    const body = req.body || {}
    const actorTier = await creatorSellerTier(pool, uid(req))
    if (!actorTier) {
      return res.status(403).json({ error: 'seller_membership_required', minimum_tier: 'pro' })
    }
    const price = Number(body.price_cents)
    if (!isCreatorPriceCents(price)) {
      return res.status(400).json({ error: 'invalid_price_tier', price_cents: CREATOR_PRICE_CENTS })
    }
    const sellerType = body.seller_type === 'clan' ? 'clan' : 'creator'
    const clanId = sellerType === 'clan' ? String(body.clan_id || '') : null
    const actor: Actor = {
      id: uid(req), host: false, topTier: actorTier === TOP_TIER, tier: actorTier,
    }
    if (sellerType === 'clan' && (!clanId || !(await isClanManager(pool, actor, clanId)))) {
      return res.status(403).json({ error: 'clan_manager_required' })
    }
    if (sellerType === 'clan') {
      const clan = await pool.query('select owner_id from servers where id=$1', [clanId])
      const ownerTier = await creatorSellerTier(pool, String(clan.rows[0]?.owner_id || ''))
      if (!ownerTier) {
        return res.status(403).json({ error: 'clan_owner_seller_membership_required', minimum_tier: 'pro' })
      }
    }
    const name = String(body.name || '').trim().slice(0, 120)
    const imageUrl = String(body.image_url || '').trim().slice(0, 2000)
    if (!name || !imageUrl) return res.status(400).json({ error: 'name_and_image_required' })
    const id = `creator-${randomUUID()}`
    const r = await pool.query(
      `insert into assets
         (id,name,team_name,image_url,price_tokens,kind,created_by,origin,seller_type,clan_id,
          price_cents,cash_enabled,paid_sweeps_enabled)
       values ($1,$2,$3,$4,0,$5,$6,'user',$7,$8,$9,$10,$11)
       returning *`,
      [
        id,
        name,
        String(body.team_name || (sellerType === 'clan' ? 'Clan' : 'Creator')).slice(0, 120),
        imageUrl,
        String(body.kind || 'badge_skin').slice(0, 60),
        uid(req),
        sellerType,
        clanId,
        price,
        body.cash_enabled !== false,
        body.paid_sweeps_enabled !== false,
      ],
    )
    return res.status(201).json({ listing: r.rows[0] })
  })

  api.post('/creator/offers', auth, async (req, res) => {
    const body = req.body || {}
    const actorTier = await creatorSellerTier(pool, uid(req))
    if (!actorTier) {
      return res.status(403).json({ error: 'seller_membership_required', minimum_tier: 'pro' })
    }
    const price = Number(body.price_cents)
    if (!isCreatorPriceCents(price)) {
      return res.status(400).json({ error: 'invalid_price_tier', price_cents: CREATOR_PRICE_CENTS })
    }
    const offerType = String(body.offer_type || '')
    if (!['creator_subscription', 'clan_subscription', 'premium_highlight'].includes(offerType)) {
      return res.status(400).json({ error: 'invalid_offer_type' })
    }
    const sellerType = offerType === 'clan_subscription'
      ? 'clan'
      : (body.seller_type === 'clan' ? 'clan' : 'creator')
    const clanId = sellerType === 'clan' ? String(body.clan_id || '') : null
    let sellerUserId = uid(req)
    if (sellerType === 'clan') {
      const actor: Actor = {
        id: uid(req), host: false, topTier: actorTier === TOP_TIER, tier: actorTier,
      }
      if (!clanId || !(await isClanManager(pool, actor, clanId))) {
        return res.status(403).json({ error: 'clan_manager_required' })
      }
      const clan = await pool.query('select owner_id from servers where id=$1', [clanId])
      sellerUserId = String(clan.rows[0]?.owner_id || '')
      if (!sellerUserId) return res.status(400).json({ error: 'clan_owner_missing' })
    }
    const payoutTier = await creatorSellerTier(pool, sellerUserId)
    if (!payoutTier) {
      return res.status(403).json({ error: 'payout_owner_seller_membership_required', minimum_tier: 'pro' })
    }
    const name = String(body.name || '').trim().slice(0, 120)
    if (!name) return res.status(400).json({ error: 'name_required' })
    const r = await pool.query(
      `insert into creator_offers
         (seller_user_id,seller_type,clan_id,offer_type,name,description,image_url,
          price_cents,billing_interval,cash_enabled,paid_sweeps_enabled,giftable)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning *`,
      [
        sellerUserId,
        sellerType,
        clanId,
        offerType,
        name,
        String(body.description || '').slice(0, 1000),
        body.image_url ? String(body.image_url).slice(0, 2000) : null,
        price,
        body.billing_interval === 'one_time' ? 'one_time' : 'month',
        body.cash_enabled !== false,
        body.paid_sweeps_enabled !== false,
        body.giftable !== false,
      ],
    )
    return res.status(201).json({ offer: r.rows[0] })
  })

  api.get('/creator/orders', auth, async (req, res) => {
    const r = await pool.query(
      `select * from creator_orders
        where buyer_id=$1 or seller_user_id=$1
        order by created_at desc limit 200`,
      [uid(req)],
    )
    res.json({ orders: r.rows })
  })

  api.get('/creator/earnings', auth, async (req, res) => {
    const r = await pool.query(
      `select e.*, o.payment_method, o.list_price_cents, o.buyer_charge_cents,
              o.asset_id, o.offer_id, o.created_at as order_created_at
         from creator_earnings e
         join creator_orders o on o.id=e.order_id
        where e.seller_user_id=$1
        order by e.created_at desc limit 200`,
      [uid(req)],
    )
    res.json({ earnings: r.rows })
  })

  api.post('/creator/credits/checkout', auth, async (req, res) => {
    if (!stripeConfigured()) return res.status(503).json({ error: 'stripe_not_configured' })
    const amount = Number((req.body || {}).amount_cents)
    if (!isCreatorPriceCents(amount)) {
      return res.status(400).json({ error: 'invalid_credit_package', price_cents: CREATOR_PRICE_CENTS })
    }
    const userId = uid(req)
    const key = orderIdempotencyKey(userId, (req.body || {}).idempotency_key)
    const existing = await pool.query(
      'select * from paid_sweeps_purchases where idempotency_key=$1',
      [key],
    )
    if (existing.rows[0]?.stripe_checkout_session_id) {
      const prior = await stripeFetch(
        `/checkout/sessions/${encodeURIComponent(existing.rows[0].stripe_checkout_session_id)}`,
        undefined,
        'GET',
      )
      if (prior.ok && prior.json?.url) {
        return res.json({ url: prior.json.url, sessionId: prior.json.id, reused: true })
      }
    }
    const purchaseId = existing.rows[0]?.id || randomUUID()
    if (!existing.rows[0]) {
      await pool.query(
        `insert into paid_sweeps_purchases (id,user_id,amount_cents,status,idempotency_key)
         values ($1,$2,$3,'pending',$4)`,
        [purchaseId, userId, amount, key],
      )
    }
    const email = ((req as any).user?.email as string) || ''
    const customerId = await ensureCustomer(userId, email)
    const params = new URLSearchParams({
      mode: 'payment',
      success_url: `${appUrl()}/store?credits=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/store?credits=cancel`,
      client_reference_id: userId,
      'metadata[kind]': 'paid_sweeps',
      'metadata[user_id]': userId,
      'metadata[purchase_id]': purchaseId,
      'payment_intent_data[metadata][kind]': 'paid_sweeps',
      'payment_intent_data[metadata][purchase_id]': purchaseId,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amount),
      'line_items[0][price_data][product_data][name]': 'TKO.cam Sweeps Credits',
      'line_items[0][price_data][product_data][description]': 'Paid marketplace credits. Free Give Points are separate.',
      'line_items[0][price_data][product_data][images][0]': `${appUrl()}/brand/tko-social-card.png`,
      'line_items[0][quantity]': '1',
    })
    if (customerId) params.set('customer', customerId)
    else if (email) params.set('customer_email', email)
    const checkout = await stripeFetch('/checkout/sessions', params)
    if (!checkout.ok || !checkout.json?.url) {
      await pool.query(
        `update paid_sweeps_purchases set status='failed', updated_at=now() where id=$1`,
        [purchaseId],
      )
      return res.status(502).json({
        error: 'stripe_error',
        detail: checkout.json?.error?.message || 'checkout failed',
      })
    }
    await pool.query(
      `update paid_sweeps_purchases
          set stripe_checkout_session_id=$2, updated_at=now() where id=$1`,
      [purchaseId, checkout.json.id],
    )
    return res.json({ url: checkout.json.url, sessionId: checkout.json.id })
  })

  api.post('/creator/checkout', auth, async (req, res) => {
    if (!stripeConfigured()) return res.status(503).json({ error: 'stripe_not_configured' })
    const body = req.body || {}
    const buyerId = uid(req)
    const item = await resolveCreatorItem(pool, body)
    if (!item || !item.cashEnabled) {
      return res.status(404).json({ error: 'item_not_available_for_cash' })
    }
    if (item.sellerUserId === buyerId) {
      return res.status(400).json({ error: 'self_purchase_not_allowed' })
    }
    const recipientId = await validRecipient(pool, buyerId, body.recipient_id, item.giftable)
    if (!recipientId) return res.status(400).json({ error: 'invalid_recipient' })
    const sellerTier = await creatorSellerTier(pool, item.sellerUserId)
    if (!sellerTier) {
      return res.status(409).json({ error: 'seller_membership_required', minimum_tier: 'pro' })
    }
    const account = await creatorAccount(pool, item.sellerUserId)
    if (!creatorPayoutReady(account)) {
      return res.status(409).json({ error: 'seller_payout_and_tax_setup_required' })
    }
    const sharePercent = sellerSharePercent(sellerTier)
    const split = creatorSplit(item.listPriceCents, 'cash', sellerTier)
    const key = orderIdempotencyKey(buyerId, body.idempotency_key)
    const old = await pool.query('select * from creator_orders where idempotency_key=$1', [key])
    if (old.rows[0]?.stripe_checkout_session_id) {
      const prior = await stripeFetch(
        `/checkout/sessions/${encodeURIComponent(old.rows[0].stripe_checkout_session_id)}`,
        undefined,
        'GET',
      )
      if (prior.ok && prior.json?.url) {
        return res.json({ url: prior.json.url, sessionId: prior.json.id, reused: true })
      }
    }
    const orderId = old.rows[0]?.id || randomUUID()
    if (!old.rows[0]) {
      await pool.query(
        `insert into creator_orders
           (id,buyer_id,recipient_id,seller_user_id,seller_type,clan_id,asset_id,offer_id,
            payment_method,list_price_cents,buyer_charge_cents,discount_cents,
            seller_tier,seller_share_percent,seller_share_cents,platform_share_cents,
            status,idempotency_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'cash',$9,$10,$11,$12,$13,$14,$15,'pending',$16)`,
        [
          orderId,
          buyerId,
          recipientId,
          item.sellerUserId,
          item.sellerType,
          item.clanId,
          item.itemType === 'asset' ? item.itemId : null,
          item.itemType === 'offer' ? item.itemId : null,
          split.listPriceCents,
          split.buyerChargeCents,
          split.discountCents,
          sellerTier,
          sharePercent,
          split.sellerShareCents,
          split.platformShareCents,
          key,
        ],
      )
    }
    const email = ((req as any).user?.email as string) || ''
    const customerId = await ensureCustomer(buyerId, email)
    const mode = item.billingInterval === 'month' ? 'subscription' : 'payment'
    const params = new URLSearchParams({
      mode,
      success_url: `${appUrl()}/shop?creator_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/shop?creator_checkout=cancel`,
      client_reference_id: buyerId,
      'metadata[kind]': 'creator_order',
      'metadata[user_id]': buyerId,
      'metadata[order_id]': orderId,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(split.buyerChargeCents),
      'line_items[0][price_data][product_data][name]': `TKO.cam - ${item.name}`,
      'line_items[0][price_data][product_data][description]': item.description,
      'line_items[0][quantity]': '1',
    })
    const image = /^https:\/\//i.test(item.imageUrl)
      ? item.imageUrl
      : `${appUrl()}/brand/tko-social-card.png`
    params.set('line_items[0][price_data][product_data][images][0]', image)
    if (customerId) params.set('customer', customerId)
    else if (email) params.set('customer_email', email)
    if (mode === 'subscription') {
      params.set('line_items[0][price_data][recurring][interval]', 'month')
      params.set('subscription_data[application_fee_percent]', String(100 - sharePercent))
      params.set('subscription_data[transfer_data][destination]', String(account.stripe_account_id))
      params.set('subscription_data[metadata][kind]', 'creator_order')
      params.set('subscription_data[metadata][order_id]', orderId)
      params.set('subscription_data[metadata][user_id]', buyerId)
    } else {
      params.set('payment_intent_data[application_fee_amount]', String(split.platformShareCents))
      params.set('payment_intent_data[transfer_data][destination]', String(account.stripe_account_id))
      params.set('payment_intent_data[metadata][kind]', 'creator_order')
      params.set('payment_intent_data[metadata][order_id]', orderId)
    }
    const checkout = await stripeFetch('/checkout/sessions', params)
    if (!checkout.ok || !checkout.json?.url) {
      await pool.query(`update creator_orders set status='failed', updated_at=now() where id=$1`, [orderId])
      return res.status(502).json({
        error: 'stripe_error',
        detail: checkout.json?.error?.message || 'checkout failed',
      })
    }
    await pool.query(
      `update creator_orders set stripe_checkout_session_id=$2, updated_at=now() where id=$1`,
      [orderId, checkout.json.id],
    )
    return res.json({ url: checkout.json.url, sessionId: checkout.json.id, orderId })
  })

  api.post('/creator/buy-with-sweeps', auth, async (req, res) => {
    const body = req.body || {}
    const buyerId = uid(req)
    const item = await resolveCreatorItem(pool, body)
    if (!item || !item.paidSweepsEnabled) {
      return res.status(404).json({ error: 'item_not_available_for_paid_sweeps' })
    }
    if (item.sellerUserId === buyerId) {
      return res.status(400).json({ error: 'self_purchase_not_allowed' })
    }
    const recipientId = await validRecipient(pool, buyerId, body.recipient_id, item.giftable)
    if (!recipientId) return res.status(400).json({ error: 'invalid_recipient' })
    const sellerTier = await creatorSellerTier(pool, item.sellerUserId)
    if (!sellerTier) {
      return res.status(409).json({ error: 'seller_membership_required', minimum_tier: 'pro' })
    }
    const account = await creatorAccount(pool, item.sellerUserId)
    if (!creatorPayoutReady(account)) {
      return res.status(409).json({ error: 'seller_payout_and_tax_setup_required' })
    }
    const sharePercent = sellerSharePercent(sellerTier)
    const split = creatorSplit(item.listPriceCents, 'paid_sweeps', sellerTier)
    const key = orderIdempotencyKey(buyerId, body.idempotency_key)
    let result: { order: any; wallet: WalletSnapshot; duplicate: boolean }
    try {
      result = await withTransaction(async (db) => {
        const prior = await db.query('select * from creator_orders where idempotency_key=$1', [key])
        if (prior.rows[0]) {
          const wallet = await db.query(
            'select tokens,sweeps,paid_sweeps_cents from wallets where user_id=$1',
            [buyerId],
          )
          return {
            order: prior.rows[0],
            wallet: {
              tokens: Number(wallet.rows[0]?.tokens ?? 0),
              sweeps: Number(wallet.rows[0]?.sweeps ?? 0),
              paid_sweeps_cents: Number(wallet.rows[0]?.paid_sweeps_cents ?? 0),
            },
            duplicate: true,
          }
        }
        const orderId = randomUUID()
        const debit = await debitPaidSweeps(db, buyerId, split.buyerChargeCents, {
          kind: 'marketplace',
          event: item.name,
          reason: 'creator purchase with paid Sweeps Credits',
          refId: orderId,
        })
        if (!debit.ok) {
          throw Object.assign(new Error('insufficient_paid_sweeps'), { wallet: debit })
        }
        const inserted = await db.query(
          `insert into creator_orders
             (id,buyer_id,recipient_id,seller_user_id,seller_type,clan_id,asset_id,offer_id,
              payment_method,list_price_cents,buyer_charge_cents,discount_cents,
              seller_tier,seller_share_percent,seller_share_cents,platform_share_cents,
              status,idempotency_key,paid_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,'paid_sweeps',$9,$10,$11,$12,$13,$14,$15,'payout_pending',$16,now())
           returning *`,
          [
            orderId,
            buyerId,
            recipientId,
            item.sellerUserId,
            item.sellerType,
            item.clanId,
            item.itemType === 'asset' ? item.itemId : null,
            item.itemType === 'offer' ? item.itemId : null,
            split.listPriceCents,
            split.buyerChargeCents,
            split.discountCents,
            sellerTier,
            sharePercent,
            split.sellerShareCents,
            split.platformShareCents,
            key,
          ],
        )
        const order = inserted.rows[0]
        await grantCreatorOrder(db, order)
        await db.query(
          `insert into creator_earnings
             (order_id,seller_user_id,amount_cents,status,available_at,updated_at)
           values ($1,$2,$3,'available',now(),now())`,
          [order.id, order.seller_user_id, order.seller_share_cents],
        )
        return { order, wallet: debit, duplicate: false }
      })
    } catch (error: any) {
      if (error?.message === 'insufficient_paid_sweeps') {
        return res.status(402).json({
          error: 'insufficient_paid_sweeps',
          detail: 'Free Give Points cannot be used for creator purchases.',
          wallet: error.wallet,
          required_cents: split.buyerChargeCents,
        })
      }
      return res.status(500).json({ error: 'creator_purchase_failed', detail: error?.message || 'purchase failed' })
    }
    const payout = result.duplicate
      ? { transferred: result.order.status === 'transferred' }
      : await transferPaidSweepsEarning(result.order)
    return res.json({
      ok: true,
      order: { ...result.order, status: payout.transferred ? 'transferred' : result.order.status },
      wallet: result.wallet,
      payout,
      duplicate: result.duplicate,
    })
  })

  api.post('/creator/payouts/retry', auth, async (req, res) => {
    if (!stripeConfigured()) return res.status(503).json({ error: 'stripe_not_configured' })
    const pending = await pool.query(
      `select * from creator_orders
        where seller_user_id=$1 and payment_method='paid_sweeps' and status='payout_pending'
        order by paid_at asc limit 20`,
      [uid(req)],
    )
    let transferred = 0
    for (const order of pending.rows) {
      const result = await transferPaidSweepsEarning(order)
      if (result.transferred) transferred += 1
    }
    return res.json({ ok: true, attempted: pending.rows.length, transferred })
  })

  api.get('/creator/fees', auth, async (req, res) => {
    const rows = await pool.query(
      `select * from creator_platform_fees
        where seller_user_id=$1 order by created_at desc limit 100`,
      [uid(req)],
    )
    return res.json({ fees: rows.rows })
  })

  api.post('/creator/fees/retry', auth, async (req, res) => {
    if (!stripeConfigured()) return res.status(503).json({ error: 'stripe_not_configured' })
    const rows = await pool.query(
      `select * from creator_platform_fees
        where seller_user_id=$1 and status in ('pending','failed')
        order by created_at asc limit 25`,
      [uid(req)],
    )
    const results = []
    for (const fee of rows.rows) {
      results.push(await settleCreatorPlatformFee({
        sellerUserId: String(fee.seller_user_id),
        feeType: fee.fee_type as CreatorPlatformFeeType,
        periodKey: String(fee.period_key),
        totalFeeCents: Number(fee.total_fee_cents),
        sourceRef: fee.source_ref ? String(fee.source_ref) : null,
      }))
    }
    return res.json({
      ok: true,
      attempted: rows.rows.length,
      collected: results.filter((fee) => fee?.status === 'collected').length,
      sponsored: results.filter((fee) => fee?.status === 'sponsored').length,
      fees: results,
    })
  })

  api.post('/creator/admin/tax-reporting-fee', auth, async (req, res) => {
    const actor = await pool.query('select user_metadata from users where id=$1', [uid(req)])
    if (parseMeta(actor.rows[0]?.user_metadata).tko_host !== true) {
      return res.status(403).json({ error: 'host_required' })
    }
    const sellerUserId = String(req.body?.seller_user_id || '')
    const totalFeeCents = Math.round(Number(req.body?.actual_external_fee_cents || 0))
    const taxYear = String(req.body?.tax_year || new Date().getUTCFullYear())
    const sourceRef = String(req.body?.source_ref || '').slice(0, 120)
    if (!sellerUserId || !Number.isSafeInteger(totalFeeCents) || totalFeeCents <= 0 || !sourceRef) {
      return res.status(400).json({
        error: 'seller_user_id_actual_external_fee_cents_tax_year_and_source_ref_required',
      })
    }
    const fee = await settleCreatorPlatformFee({
      sellerUserId,
      feeType: 'tax_reporting',
      periodKey: `${taxYear}:${sourceRef}`,
      totalFeeCents,
      sourceRef,
    })
    return res.json({
      ok: true,
      fee,
      note: 'The seller reimburses the documented external filing cost in full. Income-tax liability is not charged here.',
    })
  })

  // 0) GET /api/payments/config — may the UI show purchase buttons?
  //
  // The Store and Upgrade pages must never show a live "Buy" button that leads
  // nowhere, and must never quietly hand out a free credit when billing is off.
  // They ask here first. NOTHING SECRET IS RETURNED — only booleans saying which
  // prices the operator has configured.
  api.get('/payments/config', async (_req, res) => {
    const configured = stripeConfigured()
    return res.json({
      configured,
      tiers: Object.fromEntries(SUBSCRIPTION_TIERS.map((t) => [t, configured && !!priceForTier(t)])),
      packs: Object.fromEntries(SERVER_TOKEN_PACKS.map((p) => [p.id, configured && !!priceForPack(p.id)])),
      trialDays: TRIAL_DAYS,
    })
  })

  // 1) POST /api/checkout — create a Checkout Session, return { url }.
  //
  // Two modes, both tied to the authenticated user and both with a real
  // fulfilment path in the webhook below:
  //   subscription — a monthly tier. Optionally with a Stripe-managed free
  //                  trial (`trialDays`), in which case Stripe collects the card
  //                  now, charges nothing for N days, then auto-charges. That is
  //                  what makes trial conversion real instead of simulated.
  //   payment      — a one-time Token pack. Was refused with 501 while no
  //                  fulfilment existed; the webhook now credits the wallet
  //                  through the trusted moveWallet path, so it is open.
  api.post('/checkout', auth, async (req, res) => {
    if (!stripeConfigured()) return res.status(503).json({ error: 'stripe_not_configured' })
    const body = req.body || {}
    const tier = body.tier ? String(body.tier) : ''
    const packKey = body.pack ? String(body.pack) : ''

    // The PRICE IS THE SERVER'S. A client-supplied priceId is deliberately not
    // honoured any more: it would let a caller point a subscription checkout at
    // the $0.99 pack price and be granted Legend by the webhook.
    let priceId = ''
    let mode: 'subscription' | 'payment' = 'subscription'
    let pack: ServerTokenPack | null = null

    if (packKey) {
      pack = serverPackById(packKey)
      if (!pack) return res.status(400).json({ error: 'unknown_pack', detail: `no such token pack: ${packKey}` })
      mode = 'payment'
      priceId = priceForPack(pack.id)
    } else if (tier) {
      if (!SUBSCRIPTION_TIERS.includes(tier as (typeof SUBSCRIPTION_TIERS)[number])) {
        return res.status(400).json({ error: 'unknown_tier', detail: `no such tier: ${tier}` })
      }
      priceId = priceForTier(tier)
    } else {
      return res.status(400).json({ error: 'nothing_to_buy', detail: 'pass a tier or a pack' })
    }
    if (!priceId) {
      return res.status(400).json({
        error: 'no_price',
        detail: 'no Stripe price configured for this item — run scripts/stripe-setup.ts and set the price env vars',
      })
    }

    const userId = uid(req)
    const email = ((req as any).user?.email as string) || ''
    const customerId = await ensureCustomer(userId, email)

    const returnPath = mode === 'payment' ? '/store' : '/upgrade'
    const params = new URLSearchParams()
    params.set('mode', mode)
    params.set('line_items[0][price]', priceId)
    params.set('line_items[0][quantity]', '1')
    params.set('success_url', `${appUrl()}${returnPath}?checkout=success&session_id={CHECKOUT_SESSION_ID}`)
    params.set('cancel_url', `${appUrl()}${returnPath}?checkout=cancel`)
    params.set('client_reference_id', userId)
    params.set('metadata[user_id]', userId)
    if (customerId) params.set('customer', customerId)
    else if (email) params.set('customer_email', email)

    if (mode === 'subscription') {
      params.set('metadata[tier]', tier)
      // Copy the identifiers onto the SUBSCRIPTION too. checkout.session.completed
      // carries our metadata, but later lifecycle events (updated / deleted /
      // invoice.*) carry the subscription's — without this a renewal would arrive
      // with no idea whose account it belongs to beyond the customer mapping.
      params.set('subscription_data[metadata][user_id]', userId)
      params.set('subscription_data[metadata][tier]', tier)
      const requested = Math.floor(Number(body.trialDays))
      if (Number.isFinite(requested) && requested > 0) {
        params.set('subscription_data[trial_period_days]', String(Math.min(requested, MAX_TRIAL_DAYS)))
      }
    } else if (pack) {
      // Only the pack ID travels. The token/sweeps amounts are re-derived from
      // SERVER_TOKEN_PACKS at fulfilment, so tampering here changes nothing.
      params.set('metadata[pack]', pack.id)
      params.set('payment_intent_data[metadata][user_id]', userId)
      params.set('payment_intent_data[metadata][pack]', pack.id)
    }

    const r = await stripeFetch('/checkout/sessions', params)
    if (!r.ok) return res.status(502).json({ error: 'stripe_error', detail: r.json?.error?.message || 'checkout failed' })
    return res.json({ url: r.json.url, sessionId: r.json.id ?? null })
  })

  // 1b) POST /api/trial/convert — turn a running local trial into a real,
  // charged subscription using the card already on the user's Stripe customer.
  //
  // This is the fallback path for trials that were started BEFORE Stripe-managed
  // trials existed (the preferred flow is now `POST /api/checkout` with
  // `trialDays`, where Stripe itself auto-charges on day 7).
  //
  // FAILS CLOSED in every branch: no Stripe key, no customer, no saved payment
  // method, or a declined card all return { ok:false } and therefore never let
  // the client write a paid entitlement.
  api.post('/trial/convert', auth, async (req, res) => {
    if (!stripeConfigured()) return res.status(503).json({ ok: false, error: 'stripe_not_configured' })
    const tier = String((req.body || {}).tier || '')
    if (!SUBSCRIPTION_TIERS.includes(tier as (typeof SUBSCRIPTION_TIERS)[number])) {
      return res.status(400).json({ ok: false, error: 'unknown_tier' })
    }
    const priceId = priceForTier(tier)
    if (!priceId) return res.status(400).json({ ok: false, error: 'no_price' })

    const userId = uid(req)
    const customerId = await savedCustomerId(userId)
    // No customer means no card was ever collected — there is nothing to charge.
    if (!customerId) {
      return res.json({ ok: false, error: 'no_payment_method', detail: 'no card on file — use checkout instead' })
    }

    // error_if_incomplete: refuse rather than create a subscription stuck in
    // `incomplete`, which would otherwise look like success here.
    const r = await stripeFetch('/subscriptions', new URLSearchParams({
      customer: customerId,
      'items[0][price]': priceId,
      off_session: 'true',
      payment_behavior: 'error_if_incomplete',
      'metadata[user_id]': userId,
      'metadata[tier]': tier,
    }))
    if (!r.ok) {
      return res.json({ ok: false, error: 'charge_failed', detail: r.json?.error?.message || 'card was declined' })
    }
    const status = String(r.json?.status || '')
    if (status !== 'active' && status !== 'trialing') {
      return res.json({ ok: false, error: 'charge_failed', detail: `subscription is ${status || 'incomplete'}` })
    }
    // The entitlement itself is written by the webhook (customer.subscription.*),
    // but grant it here too so the caller sees it immediately rather than after
    // the round trip. Both paths write the same period end.
    await grantTierUntil(userId, tier, periodEndISO(r.json?.current_period_end))
    return res.json({ ok: true, tier, subscription_id: r.json?.id ?? null })
  })

  // 2) POST /api/stripe/webhook — RAW body (see express.raw mount above).
  api.post('/stripe/webhook', async (req, res) => {
    const raw: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}))
    // MONEY SAFETY — FAIL CLOSED. An unsigned webhook is just an HTTP POST, so
    // an unverified event must NEVER be able to grant an entitlement. Both the
    // secret key and the webhook secret are required: with either missing we
    // refuse the delivery outright rather than trusting the payload. (Stripe
    // will retry, which is the correct outcome — a visible backlog beats a
    // silent free-tier grant.)
    const secret = process.env.STRIPE_WEBHOOK_SECRET || ''
    if (!stripeConfigured() || !secret) {
      return res.status(503).json({ error: 'stripe_not_configured', detail: 'webhook refused: signing secret not set' })
    }
    const sig = String(req.headers['stripe-signature'] || '')
    if (!verifyStripeSignature(raw, sig, secret)) {
      return res.status(400).json({ error: 'invalid_signature' })
    }
    let event: any
    try { event = JSON.parse(raw.toString('utf8')) } catch { return res.status(400).json({ error: 'invalid_payload' }) }

    // IDEMPOTENCY GATE. Claim the event id before doing any work; a replay of an
    // already-fulfilled event stops here and can never double-credit.
    const eventId = String(event?.id || '')
    if (!(await claimEvent(eventId, String(event?.type || '')))) {
      return res.json({ received: true, duplicate: true })
    }

    try {
      const obj = event?.data?.object || {}

      // ---- one-off purchases and new subscriptions -------------------------
      if (event?.type === 'checkout.session.completed') {
        const meta = obj.metadata || {}
        const userId = await resolveEventUser(obj)
        // Only a session STRIPE ITSELF marks as paid may deliver anything.
        // 'no_payment_required' covers a 100%-off coupon and the start of a
        // Stripe-managed free trial, both of which are legitimately entitled.
        const paid = obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required'
        const customerId = obj.customer ? String(obj.customer) : null
        const amount = Number(obj.amount_total ?? 0)
        const currency = String(obj.currency || 'usd')

        if (meta.kind === 'paid_sweeps') {
          // Paid marketplace credits are distinct from free Give Points. The
          // stored package amount must match Stripe's paid total exactly.
          if (obj.mode === 'payment' && obj.payment_status === 'paid' && userId && meta.purchase_id) {
            await withTransaction(async (db) => {
              const claimed = await db.query(
                `update paid_sweeps_purchases
                    set status='paid',
                        stripe_checkout_session_id=coalesce(stripe_checkout_session_id,$4),
                        stripe_payment_intent_id=$5,
                        paid_at=now(),
                        updated_at=now()
                  where id=$1 and user_id=$2 and amount_cents=$3 and status='pending'
                  returning *`,
                [
                  String(meta.purchase_id),
                  userId,
                  amount,
                  obj.id ?? null,
                  obj.payment_intent ? String(obj.payment_intent) : null,
                ],
              )
              const purchase = claimed.rows[0]
              if (!purchase) return
              await creditPaidSweeps(db, userId, Number(purchase.amount_cents), {
                kind: 'purchase',
                event: 'TKO.cam Sweeps Credits',
                reason: 'verified Stripe marketplace credit purchase',
                refId: String(obj.id || eventId),
              })
            })
          }
        } else if (meta.kind === 'creator_order') {
          // Destination charges send the seller's share to their connected
          // account automatically. Fulfil only an exactly matching paid order.
          if (obj.payment_status === 'paid' && userId && meta.order_id) {
            const settled = await withTransaction(async (db) => {
              const match = await db.query(
                `select id from creator_orders
                  where id=$1 and buyer_id=$2 and buyer_charge_cents=$3 and status='pending'`,
                [String(meta.order_id), userId, amount],
              )
              if (!match.rows[0]) return null
              return settleCreatorOrder(db, String(meta.order_id), {
                sessionId: obj.id ? String(obj.id) : null,
                paymentIntentId: obj.payment_intent ? String(obj.payment_intent) : null,
                subscriptionId: obj.subscription ? String(obj.subscription) : null,
                automaticTransfer: true,
              })
            })
            if (settled?.seller_user_id) {
              await settleCreatorPlatformFee({
                sellerUserId: String(settled.seller_user_id),
                feeType: 'active_account',
                periodKey: creatorCycleKey(),
                totalFeeCents: CREATOR_ACTIVE_ACCOUNT_FEE_CENTS,
                sourceRef: obj.id ? String(obj.id) : eventId,
              })
              await settleOrderProcessingFee({
                sellerUserId: String(settled.seller_user_id),
                orderId: String(settled.id),
                paymentIntentId: obj.payment_intent ? String(obj.payment_intent) : null,
              })
            }
          }
        } else if (obj.mode === 'payment') {
          // ---- TOKEN PACK ---------------------------------------------------
          // The pack ID is the only thing taken from the payload; the AMOUNT of
          // Tokens is looked up in the server's own catalogue. The credit goes
          // through moveWallet — the same trusted path the daily grant and the
          // artifact purchase use — so it clamps at zero and books the
          // wallet_ledger row. Nothing here bypasses the ledger.
          const pack = serverPackById(meta.pack)
          if (!userId || !pack) {
            await recordPayment({
              userId, kind: 'token_pack', status: 'unpaid', eventId, sessionId: obj.id ?? null,
              customerId, pack: meta.pack ?? null, amountCents: amount, currency,
            })
          } else if (!paid) {
            // Completed but unpaid (e.g. an async payment still pending).
            // Recorded for audit; NOTHING is credited.
            await recordPayment({
              userId, kind: 'token_pack', status: 'unpaid', eventId, sessionId: obj.id ?? null,
              customerId, pack: pack.id, amountCents: amount, currency,
            })
          } else {
            await moveWallet(userId, { tokens: pack.tokens, sweeps: pack.bonusSweeps }, {
              kind: 'purchase',
              event: `${pack.tokens.toLocaleString()} Tokens`,
              reason: `token pack: ${pack.id}`,
              refId: String(obj.id || eventId),
              status: 'Paid',
            })
            await recordPayment({
              userId, kind: 'token_pack', status: 'paid', eventId, sessionId: obj.id ?? null,
              customerId, pack: pack.id, amountCents: amount, currency,
              tokens: pack.tokens, sweeps: pack.bonusSweeps,
            })
          }
        } else if (obj.mode === 'subscription') {
          // ---- SUBSCRIPTION -------------------------------------------------
          const tier = String(meta.tier || '')
          const valid = SUBSCRIPTION_TIERS.includes(tier as (typeof SUBSCRIPTION_TIERS)[number])
          if (userId && paid && valid) {
            // The precise period end arrives on customer.subscription.updated;
            // grant a month now so access starts the moment checkout returns.
            await grantTier(userId, tier)
            if (customerId) {
              await pool.query(
                'update users set stripe_customer_id=$1 where id=$2 and (stripe_customer_id is null or stripe_customer_id=$1)',
                [customerId, userId],
              )
            }
          }
          await recordPayment({
            userId, kind: 'subscription', status: userId && paid && valid ? 'paid' : 'unpaid',
            eventId, sessionId: obj.id ?? null, customerId,
            subscriptionId: obj.subscription ? String(obj.subscription) : null,
            tier: tier || null, amountCents: amount, currency,
          })
        }

      // Capture the exact Stripe processing fee from the platform balance
      // transaction. The seller authorized reimbursement during Connect setup.
      } else if (event?.type === 'charge.succeeded') {
        const meta = obj.metadata || {}
        const paymentIntentId = obj.payment_intent ? String(obj.payment_intent) : ''
        const orderResult = meta.order_id
          ? await pool.query('select * from creator_orders where id=$1 limit 1', [String(meta.order_id)])
          : paymentIntentId
            ? await pool.query(
                'select * from creator_orders where stripe_payment_intent_id=$1 limit 1',
                [paymentIntentId],
              )
            : { rows: [] as any[] }
        const order = orderResult.rows[0]
        if (order) {
          await settleOrderProcessingFee({
            sellerUserId: String(order.seller_user_id),
            orderId: String(order.id),
            paymentIntentId: paymentIntentId || null,
            charge: obj,
          })
        }

      // ---- subscription lifecycle -----------------------------------------
      } else if (event?.type === 'customer.subscription.updated' || event?.type === 'customer.subscription.created') {
        const status = String(obj.status || '')
        const live = status === 'active' || status === 'trialing'
        if (obj.metadata?.kind === 'creator_order' && obj.id) {
          const subscriptionId = String(obj.id)
          await pool.query(
            `update creator_orders
                set stripe_subscription_id=coalesce(stripe_subscription_id,$2), updated_at=now()
              where id=$1`,
            [String(obj.metadata.order_id || ''), subscriptionId],
          )
          await pool.query(
            `update creator_entitlements
                set status=$2, expires_at=$3, updated_at=now()
              where stripe_subscription_id=$1`,
            [subscriptionId, live ? 'active' : 'expired', periodEndISO(obj.current_period_end)],
          )
        } else {
          const userId = await resolveEventUser(obj)
          // Prefer the PRICE on the subscription item over the metadata tier:
          // that is what Stripe is actually billing.
          const priceId = String(obj.items?.data?.[0]?.price?.id || '')
          const tier = tierForPrice(priceId) || String(obj.metadata?.tier || '')
          if (userId && tier && SUBSCRIPTION_TIERS.includes(tier as (typeof SUBSCRIPTION_TIERS)[number])) {
            if (live) await grantTierUntil(userId, tier, periodEndISO(obj.current_period_end))
            else await lapseTier(userId)
          }
        }

      } else if (event?.type === 'customer.subscription.deleted') {
        if (obj.metadata?.kind === 'creator_order' && obj.id) {
          await pool.query(
            `update creator_entitlements set status='expired', updated_at=now()
              where stripe_subscription_id=$1`,
            [String(obj.id)],
          )
        } else {
          const userId = await resolveEventUser(obj)
          if (userId) await lapseTier(userId)
        }

      // ---- renewals --------------------------------------------------------
      } else if (event?.type === 'invoice.payment_failed') {
        // The renewal charge failed. Access ends; Stripe's own dunning will keep
        // retrying and a later invoice.paid restores the tier.
        const subscriptionId = obj.subscription ? String(obj.subscription) : ''
        const creatorSub = subscriptionId
          ? await pool.query('select id from creator_orders where stripe_subscription_id=$1 limit 1', [subscriptionId])
          : { rows: [] as any[] }
        const userId = await resolveEventUser(obj)
        if (creatorSub.rows[0]) {
          await pool.query(
            `update creator_entitlements set status='expired', updated_at=now()
              where stripe_subscription_id=$1`,
            [subscriptionId],
          )
        } else if (userId) {
          await lapseTier(userId)
          await recordPayment({
            userId, kind: 'subscription', status: 'failed', eventId,
            invoiceId: obj.id ?? null, customerId: obj.customer ? String(obj.customer) : null,
            subscriptionId: obj.subscription ? String(obj.subscription) : null,
            amountCents: Number(obj.amount_due ?? 0), currency: String(obj.currency || 'usd'),
          })
        }

      } else if (event?.type === 'invoice.paid' || event?.type === 'invoice.payment_succeeded') {
        // A successful renewal EXTENDS the tier to the new period end.
        const subscriptionId = obj.subscription ? String(obj.subscription) : ''
        const creatorBase = subscriptionId
          ? await pool.query(
              `select * from creator_orders
                where stripe_subscription_id=$1
                order by created_at asc limit 1`,
              [subscriptionId],
            )
          : { rows: [] as any[] }
        if (creatorBase.rows[0]) {
          const base = creatorBase.rows[0]
          const until = obj.lines?.data?.[0]?.period?.end
          await pool.query(
            `update creator_entitlements
                set status='active', expires_at=$2, updated_at=now()
              where stripe_subscription_id=$1`,
            [subscriptionId, periodEndISO(until)],
          )
          // The checkout event books the first period. Every later invoice gets
          // its own immutable order/earning row for a complete payout audit.
          if (String(obj.billing_reason || '') !== 'subscription_create' && obj.id) {
            const renewalKey = `stripe-invoice:${String(obj.id)}`
            const existing = await pool.query(
              'select id from creator_orders where idempotency_key=$1',
              [renewalKey],
            )
            if (!existing.rows[0]) {
              const renewal = await pool.query(
                `insert into creator_orders
                   (buyer_id,recipient_id,seller_user_id,seller_type,clan_id,asset_id,offer_id,
                    payment_method,list_price_cents,buyer_charge_cents,discount_cents,
                    seller_tier,seller_share_percent,seller_share_cents,platform_share_cents,
                    status,idempotency_key,
                    stripe_subscription_id,paid_at)
                 values ($1,$2,$3,$4,$5,$6,$7,'cash',$8,$9,$10,$11,$12,$13,$14,'pending',$15,$16,now())
                 returning id`,
                [
                  base.buyer_id,
                  base.recipient_id,
                  base.seller_user_id,
                  base.seller_type,
                  base.clan_id,
                  base.asset_id,
                  base.offer_id,
                  base.list_price_cents,
                  base.buyer_charge_cents,
                  base.discount_cents,
                  base.seller_tier,
                  base.seller_share_percent,
                  base.seller_share_cents,
                  base.platform_share_cents,
                  renewalKey,
                  subscriptionId,
                ],
              )
              const settledRenewal = await withTransaction(async (db) => {
                return settleCreatorOrder(db, String(renewal.rows[0].id), {
                  subscriptionId,
                  automaticTransfer: true,
                })
              })
              if (settledRenewal?.seller_user_id) {
                await settleCreatorPlatformFee({
                  sellerUserId: String(settledRenewal.seller_user_id),
                  feeType: 'active_account',
                  periodKey: creatorCycleKey(),
                  totalFeeCents: CREATOR_ACTIVE_ACCOUNT_FEE_CENTS,
                  sourceRef: String(obj.id),
                })
                await settleOrderProcessingFee({
                  sellerUserId: String(settledRenewal.seller_user_id),
                  orderId: String(settledRenewal.id),
                  paymentIntentId: obj.payment_intent ? String(obj.payment_intent) : null,
                  charge: obj.charge || null,
                })
              }
            }
          }
          return res.json({ received: true })
        }
        const userId = await resolveEventUser(obj)
        const priceId = String(obj.lines?.data?.[0]?.price?.id || '')
        const tier = tierForPrice(priceId)
        const until = obj.lines?.data?.[0]?.period?.end
        if (userId && tier) await grantTierUntil(userId, tier, periodEndISO(until))
        if (userId) {
          await recordPayment({
            userId, kind: 'subscription', status: 'paid', eventId,
            invoiceId: obj.id ?? null, customerId: obj.customer ? String(obj.customer) : null,
            subscriptionId: obj.subscription ? String(obj.subscription) : null,
            tier: tier || null, amountCents: Number(obj.amount_paid ?? 0),
            currency: String(obj.currency || 'usd'),
          })
        }

      // ---- Stripe Connect (creator payouts) --------------------------------
      } else if (event?.type === 'payout.paid' && event?.account) {
        const connectedAccountId = String(event.account)
        const seller = await pool.query(
          'select user_id from creator_stripe_accounts where stripe_account_id=$1',
          [connectedAccountId],
        )
        if (seller.rows[0]?.user_id) {
          const sellerUserId = String(seller.rows[0].user_id)
          await settleCreatorPlatformFee({
            sellerUserId,
            feeType: 'active_account',
            periodKey: creatorCycleKey(new Date(Number(obj.arrival_date || 0) * 1000 || Date.now())),
            totalFeeCents: CREATOR_ACTIVE_ACCOUNT_FEE_CENTS,
            sourceRef: obj.id ? String(obj.id) : eventId,
          })
          const payoutFeeCents = await stripeBalanceTransactionFeeCents(
            obj.balance_transaction,
            connectedAccountId,
          )
          if (payoutFeeCents > 0) {
            await settleCreatorPlatformFee({
              sellerUserId,
              feeType: 'payout_processing',
              periodKey: `payout:${String(obj.id || eventId)}`,
              totalFeeCents: payoutFeeCents,
              sourceRef: String(obj.id || eventId),
            })
          }
        }
      } else if (event?.type === 'account.updated') {
        const userId = obj.metadata?.user_id
        if (userId && obj.id) {
          await setStripeAccountFlags(
            String(userId),
            String(obj.id),
            !!obj.charges_enabled,
            !!obj.payouts_enabled,
            obj.capabilities?.transfers === 'active',
          )
        }
      }
    } catch (e: any) {
      // Fulfilment threw. RELEASE the idempotency claim and answer non-2xx so
      // Stripe retries — otherwise a transient database error would be recorded
      // as "processed" and the user would have paid for nothing.
      await releaseEvent(eventId)
      return res.status(500).json({ error: 'fulfilment_failed', detail: e?.message || 'fulfilment error' })
    }

    return res.json({ received: true })
  })

  // 3) Stripe Connect — creator payouts. The seller share is snapshotted on
  // every order from the seller's active membership (Pro 50%, Elite 65%,
  // Legend/Founder 80%).
  api.post('/connect/onboard', auth, async (req, res) => {
    if (!stripeConfigured()) return res.status(503).json({ error: 'stripe_not_configured' })
    const userId = uid(req)
    const sellerTier = await creatorSellerTier(pool, userId)
    if (!sellerTier) {
      return res.status(403).json({ error: 'seller_membership_required', minimum_tier: 'pro' })
    }
    const email = ((req as any).user?.email as string) || ''
    let accountId = await getStripeAccountId(userId)
    if (!accountId) {
      const acc = await stripeFetch('/accounts', new URLSearchParams({
        type: 'express',
        'capabilities[transfers][requested]': 'true',
        'metadata[user_id]': userId,
        email,
      }))
      if (!acc.ok) return res.status(502).json({ error: 'stripe_error', detail: acc.json?.error?.message || 'account create failed' })
      accountId = String(acc.json.id)
      await saveStripeAccountId(userId, accountId)
    }
    const link = await stripeFetch('/account_links', new URLSearchParams({
      account: accountId,
      refresh_url: `${appUrl()}/dashboard`,
      return_url: `${appUrl()}/dashboard`,
      type: 'account_onboarding',
    }))
    if (!link.ok) return res.status(502).json({ error: 'stripe_error', detail: link.json?.error?.message || 'account link failed' })
    return res.json({ url: link.json.url })
  })

  api.post('/connect/tax-consent', auth, async (req, res) => {
    const userId = uid(req)
    const sellerTier = await creatorSellerTier(pool, userId)
    if (!sellerTier) {
      return res.status(403).json({ error: 'seller_membership_required', minimum_tier: 'pro' })
    }
    const account = await creatorAccount(pool, userId)
    if (!account?.stripe_account_id) {
      return res.status(409).json({ error: 'stripe_onboarding_required' })
    }
    const body = req.body || {}
    if (
      body.tax_certified !== true
      || body.electronic_1099_consent !== true
      || body.platform_fee_debit_consent !== true
    ) {
      return res.status(400).json({
        error: 'tax_certification_delivery_and_seller_fee_consent_required',
      })
    }
    const formType = String(body.tax_form_type || 'w9').toLowerCase()
    if (!['w9', 'w8'].includes(formType)) {
      return res.status(400).json({ error: 'invalid_tax_form_type' })
    }
    const now = new Date().toISOString()
    await pool.query(
      `update creator_stripe_accounts
          set tax_certified_at=$2,
               tax_form_type=$3,
               electronic_1099_consent_at=$2,
               tax_consent_version=$4,
               platform_fee_debit_consent_at=$2,
               platform_fee_debit_consent_version=$5,
               updated_at=$2
         where user_id=$1`,
      [
        userId,
        now,
        formType,
        CREATOR_TAX_CONSENT_VERSION,
        PLATFORM_FEE_DEBIT_CONSENT_VERSION,
      ],
    )
    return res.json({
      ok: true,
      tax_certified: true,
      electronic_1099_consent: true,
      tax_form_type: formType,
      tax_consent_version: CREATOR_TAX_CONSENT_VERSION,
      platform_fee_debit_consent: true,
      platform_fee_debit_consent_version: PLATFORM_FEE_DEBIT_CONSENT_VERSION,
    })
  })

  api.get('/connect/status', auth, async (req, res) => {
    if (!stripeConfigured()) return res.status(503).json({ error: 'stripe_not_configured' })
    const userId = uid(req)
    const sellerTier = await creatorSellerTier(pool, userId)
    if (!sellerTier) {
      return res.json({
        connected: false,
        ready: false,
        seller_eligible: false,
        minimum_tier: 'pro',
        tax_consent_version: CREATOR_TAX_CONSENT_VERSION,
        platform_fee_debit_consent_version: PLATFORM_FEE_DEBIT_CONSENT_VERSION,
      })
    }
    const accountId = await getStripeAccountId(userId)
    if (!accountId) {
      return res.json({
        connected: false,
        ready: false,
        seller_eligible: true,
        seller_tier: sellerTier,
        seller_share_percent: sellerSharePercent(sellerTier),
        tax_consent_version: CREATOR_TAX_CONSENT_VERSION,
        platform_fee_debit_consent_version: PLATFORM_FEE_DEBIT_CONSENT_VERSION,
      })
    }
    const acc = await stripeFetch(`/accounts/${encodeURIComponent(accountId)}`, undefined, 'GET')
    if (!acc.ok) return res.status(502).json({ error: 'stripe_error', detail: acc.json?.error?.message || 'account fetch failed' })
    const charges = !!acc.json.charges_enabled
    const payouts = !!acc.json.payouts_enabled
    const transfers = acc.json.capabilities?.transfers === 'active'
    await setStripeAccountFlags(userId, accountId, charges, payouts, transfers)
    const account = await creatorAccount(pool, userId)
    const taxCertified = !!account?.tax_certified_at
    const electronicConsent = !!account?.electronic_1099_consent_at
      && account?.tax_consent_version === CREATOR_TAX_CONSENT_VERSION
    const platformFeeDebitConsent = !!account?.platform_fee_debit_consent_at
      && account?.platform_fee_debit_consent_version === PLATFORM_FEE_DEBIT_CONSENT_VERSION
    return res.json({
      connected: true,
      ready: creatorPayoutReady(account),
      seller_eligible: true,
      seller_tier: sellerTier,
      seller_share_percent: sellerSharePercent(sellerTier),
      charges_enabled: charges,
      payouts_enabled: payouts,
      transfers_enabled: transfers,
      tax_certified: taxCertified,
      tax_form_type: account?.tax_form_type || null,
      electronic_1099_consent: electronicConsent,
      tax_consent_version: CREATOR_TAX_CONSENT_VERSION,
      platform_fee_debit_consent: platformFeeDebitConsent,
      platform_fee_debit_consent_version: PLATFORM_FEE_DEBIT_CONSENT_VERSION,
      account_id: accountId,
    })
  })

  app.use('/api', api)
  return app
}
