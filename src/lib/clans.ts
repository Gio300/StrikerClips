/**
 * Clans — the rules engine for TKO clans.
 *
 * A clan is a `servers` row (`kind='clan'`) with an economy attached (see
 * docs/economy-clans-villages.md §5). This module is the PURE, unit-tested core:
 * the role/permission matrix, the 100-member cap math, the join-fee / dues model
 * and the 80/20 platform split, plus the small `clanSummary` helpers the
 * discovery UI reads. None of the pure helpers touch the DOM, storage or a
 * backend — mirroring the shape of `tiers.ts` / `predictions.ts`.
 *
 * The SETTLEMENT section at the bottom is the one impure part. `payClanFee()`
 * runs the whole join-fee / dues transaction server-side (/api/fn/clan-pay):
 * wallet debit, `servers.treasury_tokens` credit, `clan_dues_payments` receipt
 * and a `wallet_ledger` row, in one request. The `record*`/`read*` helpers
 * beside it are LOCAL MODE only — they take a required store and back the unit
 * tests and the offline demo path.
 */

import { callFn } from './backend'
import { applyWalletSnapshot } from './wallet'

// ───────────────────────────────────────────────────────────────────────────
//  Constants (config-ready; mirror the design doc pegs)
// ───────────────────────────────────────────────────────────────────────────

/** Hard cap on clan membership (founder spec, §5.1). */
export const MAX_CLAN_MEMBERS = 100

/** Platform fee taken on every user→user money-moving action (§0, §2). */
export const PLATFORM_FEE = 0.2

// ───────────────────────────────────────────────────────────────────────────
//  Roles & the permission matrix (§5.2)
// ───────────────────────────────────────────────────────────────────────────

/** Clan ranks, highest → lowest authority. `owner_id` maps to the single Leader. */
export type ClanRole = 'leader' | 'officer' | 'recruiter' | 'member'

export const CLAN_ROLES: ClanRole[] = ['leader', 'officer', 'recruiter', 'member']

/**
 * Every gated capability. `can(role, action)` answers "is this role allowed to
 * do this at all"; rank-relative checks (promote/demote/kick a *specific*
 * member) additionally go through `canManageMember` / `canAssignRank`.
 */
export type ClanAction =
  | 'edit_settings' // edit clan profile / rules
  | 'set_dues' // set join fee + recurring dues
  | 'toggle_recruiting' // flip is_recruiting / adjust spots
  | 'invite' // invite / approve joiners
  | 'approve' // approve a pending join request
  | 'kick' // remove a member
  | 'promote' // raise a member's rank
  | 'demote' // lower a member's rank
  | 'manage_channels' // create / delete channels & categories
  | 'post_announcement' // post in announcement channels
  | 'spend_treasury' // spend the clan treasury / activate clan artifacts
  | 'post' // post in normal channels

/**
 * The permission matrix. Stored in code (DB only keeps the rank string), exactly
 * like `FEATURE`/`canUse` in tiers.ts. Reconciles §5.2 of the design doc:
 *   - Leader: everything.
 *   - Officer: everything except editing settings / dues.
 *   - Recruiter: recruiting-facing only (toggle recruiting, invite, approve) + post.
 *   - Member: post in normal channels.
 */
export const CLAN_RANK_PERMS: Record<ClanRole, ReadonlySet<ClanAction>> = {
  leader: new Set<ClanAction>([
    'edit_settings',
    'set_dues',
    'toggle_recruiting',
    'invite',
    'approve',
    'kick',
    'promote',
    'demote',
    'manage_channels',
    'post_announcement',
    'spend_treasury',
    'post',
  ]),
  officer: new Set<ClanAction>([
    'toggle_recruiting',
    'invite',
    'approve',
    'kick',
    'promote',
    'demote',
    'manage_channels',
    'post_announcement',
    'spend_treasury',
    'post',
  ]),
  recruiter: new Set<ClanAction>([
    'toggle_recruiting',
    'invite',
    'approve',
    'post',
  ]),
  member: new Set<ClanAction>(['post']),
}

/** Can a role perform an action at all? The single gate the UI checks. */
export function can(role: ClanRole, action: ClanAction): boolean {
  return CLAN_RANK_PERMS[role]?.has(action) ?? false
}

/** Numeric authority level for rank-relative comparisons (higher = stronger). */
export function rankLevel(role: ClanRole): number {
  switch (role) {
    case 'leader':
      return 3
    case 'officer':
      return 2
    case 'recruiter':
      return 1
    case 'member':
      return 0
    default:
      return -1
  }
}

/**
 * Can `actor` moderate `target` (kick / promote / demote)? You may only act on a
 * member STRICTLY below your own rank — no peer or upward moderation, and the
 * Leader can never be touched.
 */
export function canManageMember(
  actor: ClanRole,
  action: 'kick' | 'promote' | 'demote',
  target: ClanRole,
): boolean {
  if (!can(actor, action)) return false
  return rankLevel(actor) > rankLevel(target)
}

/**
 * Can `actor` set a member's rank to `newRank`? "Assign ranks ≤ own rank" (§5.2)
 * — the target rank must be strictly below the actor's own (an officer can make
 * recruiters/members, never another officer; the leader can make officers down).
 */
export function canAssignRank(actor: ClanRole, current: ClanRole, newRank: ClanRole): boolean {
  const raising = rankLevel(newRank) > rankLevel(current)
  const action: 'promote' | 'demote' = raising ? 'promote' : 'demote'
  if (!canManageMember(actor, action, current)) return false
  return rankLevel(newRank) < rankLevel(actor)
}

// ───────────────────────────────────────────────────────────────────────────
//  Membership cap (§5.3)
// ───────────────────────────────────────────────────────────────────────────

/** The fields the cap/join helpers need — a subset of a clan row. */
export interface ClanLike {
  /** Hard cap (defaults to MAX_CLAN_MEMBERS). */
  maxMembers?: number
  /** Shows in Discovery + allows joining when true. */
  isRecruiting: boolean
  /** One-time join fee, in Tokens (0 = free). */
  joinFeeTokens: number
}

function capOf(clan: Pick<ClanLike, 'maxMembers'>): number {
  const m = clan.maxMembers
  return Number.isFinite(m) && (m as number) > 0 ? (m as number) : MAX_CLAN_MEMBERS
}

/** Open seats remaining, clamped ≥ 0. */
export function spotsLeft(memberCount: number, maxMembers: number = MAX_CLAN_MEMBERS): number {
  const cap = Number.isFinite(maxMembers) && maxMembers > 0 ? maxMembers : MAX_CLAN_MEMBERS
  return Math.max(0, cap - Math.max(0, memberCount))
}

/** Is the clan at (or over) its cap? */
export function isFull(memberCount: number, maxMembers: number = MAX_CLAN_MEMBERS): boolean {
  return spotsLeft(memberCount, maxMembers) === 0
}

// ───────────────────────────────────────────────────────────────────────────
//  Join eligibility (cap ∩ recruiting ∩ affordability)
// ───────────────────────────────────────────────────────────────────────────

export type JoinBlockReason = 'full' | 'closed' | 'insufficient'

export type JoinCheck = { ok: true } | { ok: false; reason: JoinBlockReason }

/**
 * May a user join this clan right now? Enforces, in order: the 100-cap, the
 * recruiting flag, then fee affordability against the user's Token balance.
 * A full clan fails even when `isRecruiting` (it auto-drops from Discovery).
 */
export function canJoin(clan: ClanLike, memberCount: number, userTokens: number): JoinCheck {
  if (isFull(memberCount, capOf(clan))) return { ok: false, reason: 'full' }
  if (!clan.isRecruiting) return { ok: false, reason: 'closed' }
  if (userTokens < Math.max(0, clan.joinFeeTokens)) return { ok: false, reason: 'insufficient' }
  return { ok: true }
}

/** Human copy for a blocked join, for the Discovery card / toast. */
export function joinBlockMessage(reason: JoinBlockReason): string {
  switch (reason) {
    case 'full':
      return 'This clan is full (100 / 100).'
    case 'closed':
      return 'This clan isn’t recruiting right now.'
    case 'insufficient':
      return 'Not enough Tokens — grab more in the Store.'
    default:
      return 'You can’t join this clan right now.'
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Fee / dues split (§2 — 80% clan treasury / 20% platform)
// ───────────────────────────────────────────────────────────────────────────

export interface FeeSplit {
  /** Tokens credited to the clan treasury (the 80% clan share). */
  clan: number
  /** Tokens recognized as platform revenue (the 20% fee). */
  platform: number
}

/**
 * Split a Token amount 80/20 (clan / platform). Platform fee is rounded so the
 * two shares always sum back to the gross (no leaked tokens). Mirrors
 * `applySplit` in the design doc §9.2.
 */
export function feeSplit(amountTokens: number): FeeSplit {
  const gross = Math.max(0, Math.round(amountTokens))
  const platform = Math.round(gross * PLATFORM_FEE)
  return { clan: gross - platform, platform }
}

// ───────────────────────────────────────────────────────────────────────────
//  Discovery summary helpers (§5.3)
// ───────────────────────────────────────────────────────────────────────────

export interface ClanSummary {
  name: string
  /** Open seats (clamped ≥ 0). */
  spotsLeft: number
  /** Max members / cap. */
  maxMembers: number
  /** Current member count. */
  memberCount: number
  /** One-time join fee in Tokens (0 = free). */
  joinFeeTokens: number
  /** True when the join fee is 0. */
  free: boolean
  isRecruiting: boolean
  isFull: boolean
}

export interface ClanRow extends ClanLike {
  name: string
}

/** Shape a clan row + its live member count into the fields a Discovery card renders. */
export function clanSummary(clan: ClanRow, memberCount: number): ClanSummary {
  const cap = capOf(clan)
  return {
    name: clan.name,
    spotsLeft: spotsLeft(memberCount, cap),
    maxMembers: cap,
    memberCount: Math.max(0, memberCount),
    joinFeeTokens: Math.max(0, clan.joinFeeTokens),
    free: Math.max(0, clan.joinFeeTokens) === 0,
    isRecruiting: clan.isRecruiting,
    isFull: isFull(memberCount, cap),
  }
}

/**
 * Does a clan belong in the Discovery list? Recruiting AND has at least one open
 * seat (a full clan auto-drops from Discovery even while `isRecruiting`, §5.3).
 */
export function isDiscoverable(clan: ClanLike, memberCount: number): boolean {
  return clan.isRecruiting && !isFull(memberCount, capOf(clan))
}

/** Short "47 / 100" cap-usage label for the member roster header. */
export function capUsageLabel(memberCount: number, maxMembers: number = MAX_CLAN_MEMBERS): string {
  const cap = Number.isFinite(maxMembers) && maxMembers > 0 ? maxMembers : MAX_CLAN_MEMBERS
  return `${Math.max(0, memberCount)} / ${cap}`
}

// ═══════════════════════════════════════════════════════════════════════════
//  TOKEN SETTLEMENT — the clan join fee / dues 80/20 split.
// ───────────────────────────────────────────────────────────────────────────
//  This is now REAL and server-side. `payClanFee()` calls /api/fn/clan-pay,
//  which does the whole settlement in one request:
//
//      debit the payer's wallet by the CLAN'S OWN fee   (wallets)
//      credit  servers.treasury_tokens += split.clan     (the 80%)
//      insert  clan_dues_payments(gross, clan, platform) (the receipt)
//      insert  wallet_ledger(kind='clan_dues', ...)      (the audit trail)
//
//  The amount is read from `servers.join_fee_tokens` / `dues_tokens`, never from
//  the request, so a client cannot name its own price — and `treasury_tokens` is
//  in PRIVILEGE_COLS, so it cannot be written through the generic API at all.
//  Each member used to see their OWN imaginary treasury in localStorage; there
//  is now one treasury per clan, and it is the same number for everybody.
//
//  The local helpers below (readTreasury / readClanLedger / recordClanPayment)
//  are LOCAL MODE — they take a REQUIRED store and are used by the unit tests
//  and the offline demo path. Nothing they write reaches the server.
//
//  (See docs/economy-clans-villages.md §9.1/§9.2.)
// ═══════════════════════════════════════════════════════════════════════════

/** Injectable storage (matches wallet.ts / assets.ts) so tests can pass a fake. */
export interface ClanStorage {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

const TREASURY_PREFIX = 'kc_clan_treasury:'
const LEDGER_PREFIX = 'kc_clan_ledger:'

export interface ClanLedgerEntry {
  id: string
  serverId: string
  userId: string
  kind: 'join' | 'dues'
  grossTokens: number
  clanTokens: number
  platformTokens: number
  at: number
}

/**
 * LOCAL MODE. Read a clan's accrued treasury from a local store. The real
 * treasury is `servers.treasury_tokens`, which every client reads straight off
 * the public `servers` row.
 */
export function readTreasury(
  serverId: string,
  storage: ClanStorage | null,
): number {
  if (!storage) return 0
  try {
    const raw = storage.getItem(TREASURY_PREFIX + serverId)
    const n = raw == null ? 0 : Number(raw)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

function creditTreasury(
  serverId: string,
  tokens: number,
  storage: ClanStorage | null,
): number {
  if (!storage) return 0
  const next = readTreasury(serverId, storage) + Math.max(0, tokens)
  try {
    storage.setItem(TREASURY_PREFIX + serverId, String(next))
  } catch {
    /* quota / private mode */
  }
  return next
}

/** LOCAL MODE. Read a clan's local settlement ledger (newest-first). */
export function readClanLedger(
  serverId: string,
  storage: ClanStorage | null,
): ClanLedgerEntry[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(LEDGER_PREFIX + serverId)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as ClanLedgerEntry[]) : []
  } catch {
    return []
  }
}

/**
 * LOCAL MODE. Book a join/dues split into a local store: credit the treasury 80%
 * and append a ledger row. `storage` is REQUIRED — the server path is
 * `payClanFee()`, which debits the wallet and credits the treasury in ONE
 * request so the two can never disagree.
 */
export function recordClanPayment(
  serverId: string,
  userId: string,
  grossTokens: number,
  kind: 'join' | 'dues',
  storage: ClanStorage | null,
): FeeSplit {
  const split = feeSplit(grossTokens)
  if (grossTokens > 0) {
    creditTreasury(serverId, split.clan, storage)
    if (storage) {
      const entry: ClanLedgerEntry = {
        id: 'clj-' + Math.random().toString(36).slice(2, 10),
        serverId,
        userId,
        kind,
        grossTokens: Math.max(0, Math.round(grossTokens)),
        clanTokens: split.clan,
        platformTokens: split.platform,
        at: Date.now(),
      }
      try {
        const list = readClanLedger(serverId, storage)
        list.unshift(entry)
        storage.setItem(LEDGER_PREFIX + serverId, JSON.stringify(list))
      } catch {
        /* noop */
      }
    }
  }
  return split
}

// ───────────────────────────────────────────────────────────────────────────
//  SERVER PATH — the real settlement.
// ───────────────────────────────────────────────────────────────────────────

export type ClanPayResult =
  | { ok: true; charged: number; split: FeeSplit; wallet: { tokens: number; sweeps: number } }
  | { ok: false; reason: 'insufficient' | 'not-found' | 'unavailable' }

/**
 * Pay a clan's join fee or dues.
 *
 * Note what this function does NOT take: an amount. The server reads
 * `servers.join_fee_tokens` / `servers.dues_tokens` for that clan, so a client
 * can neither undercharge itself nor mint treasury for a clan it likes. The
 * debit, the 80% treasury credit, the `clan_dues_payments` receipt and the
 * `wallet_ledger` row all happen in the one request, so a failure part-way
 * cannot leave a member paid-up with an uncredited clan (or vice versa).
 *
 * A 0-fee clan returns ok with `charged: 0` and moves nothing.
 */
export async function payClanFee(
  serverId: string,
  userId: string,
  kind: 'join' | 'dues' = 'join',
): Promise<ClanPayResult> {
  const data = await callFn<{
    ok: boolean
    reason?: string
    charged?: number
    split?: FeeSplit
    wallet?: { tokens: number; sweeps: number }
    error?: string
  }>('clan-pay', { serverId, kind })
  if (!data) return { ok: false, reason: 'unavailable' }
  if (!data.ok) {
    return { ok: false, reason: data.reason === 'insufficient' ? 'insufficient' : 'not-found' }
  }
  const wallet = data.wallet ?? { tokens: 0, sweeps: 0 }
  // Mirror the authoritative balance the server just returned into the cache so
  // the balance chip updates without a round-trip.
  if (userId) applyWalletSnapshot(userId, wallet)
  return {
    ok: true,
    charged: Number(data.charged ?? 0),
    split: data.split ?? { clan: 0, platform: 0 },
    wallet,
  }
}
