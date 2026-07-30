/**
 * Sweepstakes economics — the 60/40 fixed-prize model.
 *
 * Spec: docs/sweepstakes-economics.md. The platform keeps ~60% and distributes
 * ~40% as prize value via FIXED, guaranteed prizes (never a percentage rake on a
 * single match — that would look like pari-mutuel gambling). 1 Sweeps Point =
 * $0.01 USD. Sweeps Points are the only prize-redeemable currency; Tokens are a
 * bought utility currency with no cash value.
 *
 * This module is display/config + a free daily grant only. It intentionally does
 * NOT place wagers or move cash — payouts + redemption are gated on compliance
 * sign-off (see terms-and-conditions-DRAFT.md). Not legal advice.
 */

import { claimDailySweeps } from '@/lib/wallet'

// ─────────────────────────────────────────────────────────────────────────
//  Core constant + conversions (1 Sweeps Point = $0.01)
// ─────────────────────────────────────────────────────────────────────────

/** Static baseline: 1 Sweeps Point = $0.01 USD (100 points = $1.00). */
export const POINT_VALUE_USD = 0.01

/** Cash value (USD) of a Sweeps Point amount. */
export function pointsToUsd(pts: number): number {
  return pts * POINT_VALUE_USD
}

/** How many Sweeps Points a USD amount is worth (rounded to whole points). */
export function usdToPoints(usd: number): number {
  return Math.round(usd / POINT_VALUE_USD)
}

/** Convenience: "$4.00"-style string for a Sweeps Point amount. */
export function pointsToUsdLabel(pts: number): string {
  return `$${pointsToUsd(pts).toFixed(2)}`
}

// ─────────────────────────────────────────────────────────────────────────
//  Tournament prize tiers (Rule 2 — fixed guaranteed prizes)
// ─────────────────────────────────────────────────────────────────────────

export interface PrizeTier {
  id: string
  name: string
  /** Sweeps Points it costs to enter. */
  entryPoints: number
  /** Expected full-lobby entrant count the guaranteed prize is sized against. */
  targetEntrants: number
  /** FIXED guaranteed prize in Sweeps Points — paid regardless of turnout. */
  guaranteedPrizePoints: number
  /** Cash-redemption value of the guaranteed prize in USD. */
  cashValueUsd: number
}

/**
 * Config-ready tier table from the spec. `guaranteedPrizePoints` is
 * `guaranteedPrize(entryPoints, targetEntrants)` (40% of a full lobby's entry
 * points) and `cashValueUsd` is its $0.01/point cash value.
 */
export const PRIZE_TIERS: PrizeTier[] = [
  { id: 'skirmish',     name: 'Skirmish',     entryPoints: 100,  targetEntrants: 10, guaranteedPrizePoints: 400,  cashValueUsd: 4 },
  { id: 'clash',        name: 'Clash',        entryPoints: 250,  targetEntrants: 10, guaranteedPrizePoints: 1000, cashValueUsd: 10 },
  { id: 'showdown',     name: 'Showdown',     entryPoints: 500,  targetEntrants: 10, guaranteedPrizePoints: 2000, cashValueUsd: 20 },
  { id: 'championship', name: 'Championship', entryPoints: 1000, targetEntrants: 16, guaranteedPrizePoints: 6400, cashValueUsd: 64 },
]

/** Fallback tier used when a tournament has no stored tier. */
export const DEFAULT_TIER: PrizeTier = PRIZE_TIERS[0]

/** Look up a tier by its id. */
export function tierById(id: string | null | undefined): PrizeTier | undefined {
  if (!id) return undefined
  return PRIZE_TIERS.find((t) => t.id === id)
}

/**
 * Fixed guaranteed prize in Sweeps Points for a tier:
 *   guaranteedPrizePoints = round(targetEntrants × entryPoints × 0.40)
 * Paid in full regardless of how many actually enter — this is what keeps it a
 * promotional sweepstakes rather than pari-mutuel betting.
 */
export function guaranteedPrize(entryPoints: number, targetEntrants: number): number {
  return Math.round(entryPoints * targetEntrants * 0.4)
}

// ─────────────────────────────────────────────────────────────────────────
//  Daily free bonus (Rule 3 — "no purchase necessary" free method of entry)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Free Sweeps Points granted per day, no purchase required.
 * Keep in sync with DAILY_BONUS_SWEEPS in the `sweeps-daily` handler in
 * server/app.ts — the server's value is the one that is actually credited.
 */
export const DAILY_BONUS_SWEEPS = 25

/**
 * Free ORACLE-USE-ONLY tickets granted per day (Oracle Rule 1). The daily grant
 * was REPURPOSED from free Sweeps to these tickets — they can be BET in the
 * Oracle economy but are tracked separately and are NEVER part of the money ($)
 * flow. Keep in sync with ORACLE_DAILY_TICKETS in server/app.ts (the server's
 * value is the one actually credited).
 */
export const DAILY_ORACLE_TICKETS = 3

/**
 * Claim today's free Sweeps Points.
 *
 * The once-a-day guard used to be a `kc_daily_sweeps:<user>:<date>` localStorage
 * key, which anyone could delete from devtools for unlimited points. The guard
 * is now a `wallet_ledger` row on the server (kind='grant', reason='daily',
 * ref_id=today), and the credit is applied server-side — the client cannot add
 * a single Sweeps point to its own balance.
 *
 * Resolves true when points were granted, false when today's claim was already
 * taken (or the backend is unreachable).
 */
export async function claimDaily(userId: string): Promise<boolean> {
  if (!userId) return false
  const res = await claimDailySweeps(userId)
  return res.ok
}
