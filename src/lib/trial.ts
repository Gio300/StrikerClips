/**
 * 7-day free trial — pure state machine + user-metadata persistence helpers.
 *
 * A trial lets a user try any PAID tier for one week. During the trial they get
 * that tier's full entitlements (we reuse the SAME `reelone_tier` +
 * `reelone_tier_expires` path the redeem flow writes, so `useEntitlements`
 * already grants the tier while the trial runs — no new entitlement wiring). At
 * `endsAt` the trial resolves ONE of two ways:
 *   • cardOnFile  → CONVERTS to a paid monthly subscription (expiry pushed +30d)
 *   • no card     → LAPSES to free (the `reelone_tier_expires` we set == endsAt,
 *                    so the tier auto-drops the moment the week is up)
 * A user may also DECLINE mid-trial to drop straight back to free.
 *
 * This file is deliberately React- and Supabase-free (mirrors entitlements.ts /
 * assets.ts) so the state machine is unit-testable in isolation. The UI layer
 * (Upgrade.tsx) calls `supabase.auth.updateUser({ data: <patch> })` with the
 * patch builders below, then `refreshUser()`.
 *
 * ── AUTO-CHARGE ──────────────────────────────────────────────────────────────
 * The real money movement at conversion is NOT here. `convertTrialMeta()` only
 * builds the entitlement patch; the actual card charge is a clearly-marked stub
 * in src/lib/payments.ts (`chargeTrialConversion`) that Upgrade.tsx awaits before
 * writing the conversion patch. Flip that stub on when Stripe is live.
 */

import type { TierKey } from './tiers'

/** Trials are only for PAID tiers (everything except free ''). */
export type TrialTier = Exclude<TierKey, ''>

export type TrialStatus = 'active' | 'converted' | 'declined' | 'expired'

export interface TrialRecord {
  tier: TrialTier
  /** ISO timestamp the trial began. */
  startedAt: string
  /** ISO timestamp the trial ends (= startedAt + TRIAL_DAYS). */
  endsAt: string
  /** Whether the user attached a card (SetupIntent stub). Drives conversion. */
  cardOnFile: boolean
  status: TrialStatus
}

/** Metadata key the trial record lives under on `user.user_metadata`. */
export const TRIAL_META_KEY = 'reelone_trial'

export const TRIAL_DAYS = 7
/** Paid subscriptions run monthly; conversion pushes the expiry out this far. */
export const MONTH_DAYS = 30
const MS_PER_DAY = 24 * 60 * 60 * 1000

// ─────────────────────────────────────────────────────────────────────────
//  PURE RECORD LOGIC (no user object, no persistence) — easy to unit test.
// ─────────────────────────────────────────────────────────────────────────

/** Begin a fresh trial for `tier`. Ends 7 days out. */
export function startTrial(tier: TrialTier, cardOnFile = false, now: number = Date.now()): TrialRecord {
  return {
    tier,
    startedAt: new Date(now).toISOString(),
    endsAt: new Date(now + TRIAL_DAYS * MS_PER_DAY).toISOString(),
    cardOnFile,
    status: 'active',
  }
}

/** Epoch ms of a record's end, or NaN if unparseable. */
function endMs(record: TrialRecord): number {
  return Date.parse(record.endsAt)
}

/** True while the trial is still running (active AND before endsAt). */
export function isTrialActive(record: TrialRecord | null | undefined, now: number = Date.now()): boolean {
  if (!record || record.status !== 'active') return false
  const end = endMs(record)
  return Number.isFinite(end) ? end > now : true
}

/** Whole days left in an active trial (ceil, never negative). */
export function trialDaysLeft(record: TrialRecord | null | undefined, now: number = Date.now()): number {
  if (!record) return 0
  const end = endMs(record)
  if (!Number.isFinite(end)) return 0
  return Math.max(0, Math.ceil((end - now) / MS_PER_DAY))
}

/**
 * Resolve a trial at/after its end. An ACTIVE trial that has reached `endsAt`
 * becomes `converted` (card on file → auto-charge path) or `expired` (no card).
 * Terminal states (converted / declined / expired) and still-running actives are
 * returned unchanged. Pure — persistence + the real charge happen elsewhere.
 */
export function resolveTrial(record: TrialRecord, now: number = Date.now()): TrialRecord {
  if (record.status !== 'active') return record
  const end = endMs(record)
  const ended = Number.isFinite(end) ? end <= now : false
  if (!ended) return record
  return { ...record, status: record.cardOnFile ? 'converted' : 'expired' }
}

/** Flip a trial to declined (user chose to keep the free version). */
export function declineTrial(record: TrialRecord): TrialRecord {
  return { ...record, status: 'declined' }
}

/** Set / clear the card-on-file flag on a record. */
export function withCardOnFile(record: TrialRecord, cardOnFile: boolean): TrialRecord {
  return { ...record, cardOnFile }
}

// ─────────────────────────────────────────────────────────────────────────
//  USER-METADATA READERS (mirror entitlementsFromUser).
// ─────────────────────────────────────────────────────────────────────────

type MaybeUser = { user_metadata?: Record<string, unknown> | null } | null | undefined

function isTrialTier(v: unknown): v is TrialTier {
  return v === 'ad_free' || v === 'pro' || v === 'supporter' || v === 'creator'
}

function isTrialStatus(v: unknown): v is TrialStatus {
  return v === 'active' || v === 'converted' || v === 'declined' || v === 'expired'
}

/** Read the raw trial record off a user's metadata, or null if none/invalid. */
export function trialFromUser(user: MaybeUser): TrialRecord | null {
  const md = (user?.user_metadata ?? undefined) as Record<string, unknown> | undefined
  const raw = md?.[TRIAL_META_KEY]
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isTrialTier(r.tier) || !isTrialStatus(r.status)) return null
  if (typeof r.startedAt !== 'string' || typeof r.endsAt !== 'string') return null
  return {
    tier: r.tier,
    startedAt: r.startedAt,
    endsAt: r.endsAt,
    cardOnFile: r.cardOnFile === true,
    status: r.status,
  }
}

/** The trial record with its status RESOLVED to `now` (converted/expired if due). */
export function trialState(user: MaybeUser, now: number = Date.now()): TrialRecord | null {
  const r = trialFromUser(user)
  return r ? resolveTrial(r, now) : null
}

/** True if the signed-in user is currently inside an active trial window. */
export function isUserTrialActive(user: MaybeUser, now: number = Date.now()): boolean {
  return isTrialActive(trialFromUser(user), now)
}

// ─────────────────────────────────────────────────────────────────────────
//  METADATA PATCH BUILDERS — feed straight into supabase.auth.updateUser({data}).
//  Each returns the user_metadata delta to write; the entitlement fields
//  (reelone_tier / reelone_tier_expires) are set so useEntitlements reflects the
//  trial immediately and lapses cleanly at endsAt.
// ─────────────────────────────────────────────────────────────────────────

export type TrialMetaPatch = {
  reelone_tier: string
  reelone_tier_expires: string
  [TRIAL_META_KEY]: TrialRecord
}

/**
 * Patch to START a trial: grant the tier now, set the entitlement expiry to the
 * trial end (so it auto-lapses if never converted), and stash the trial record.
 */
export function startTrialMeta(tier: TrialTier, cardOnFile = false, now: number = Date.now()): TrialMetaPatch {
  const record = startTrial(tier, cardOnFile, now)
  return {
    reelone_tier: record.tier,
    reelone_tier_expires: record.endsAt,
    [TRIAL_META_KEY]: record,
  }
}

/**
 * Patch to CONVERT a trial to a paid month. This is the ENTITLEMENT side of the
 * conversion — call the payments stub (chargeTrialConversion) FIRST and only
 * write this on a successful (or simulated) charge. Pushes the expiry out +30d.
 */
export function convertTrialMeta(record: TrialRecord, now: number = Date.now()): TrialMetaPatch {
  return {
    reelone_tier: record.tier,
    reelone_tier_expires: new Date(now + MONTH_DAYS * MS_PER_DAY).toISOString(),
    [TRIAL_META_KEY]: { ...record, status: 'converted' },
  }
}

/** Patch to DECLINE/CANCEL a trial: drop to free immediately, mark declined. */
export function declineTrialMeta(record: TrialRecord): TrialMetaPatch {
  return {
    reelone_tier: '',
    reelone_tier_expires: '',
    [TRIAL_META_KEY]: { ...record, status: 'declined' },
  }
}

/** Patch to mark a lapsed (no-card) trial as expired. Tier already dropped via expiry. */
export function expireTrialMeta(record: TrialRecord): { [TRIAL_META_KEY]: TrialRecord } {
  return { [TRIAL_META_KEY]: { ...record, status: 'expired' } }
}

/** User-facing label for a trial tier (Pro / Elite / Legend / Ad-Free). */
export function trialTierName(tier: TrialTier): string {
  switch (tier) {
    case 'pro': return 'Pro'
    case 'supporter': return 'Elite'
    case 'creator': return 'Legend'
    case 'ad_free': return 'Ad-Free'
  }
}
