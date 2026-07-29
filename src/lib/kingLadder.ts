/**
 * kingLadder — the never-ending TKO King ladder.
 *
 * The TKO King isn't a bracket that ends; it's a LADDER that always runs. You
 * register, you're auto-matched against someone in your rank band, your verified
 * footage decides the result, and your rating moves. The single highest-rated
 * Shinobi holds the "TKO King" status until someone climbs past them. Newcomers
 * can join any time — they just start at the bottom. The higher you climb, the
 * more you're matched only with upper-rank Shinobi, so the top stays sharp.
 *
 * Pure + deterministic (Elo), so it unit-tests with no DB, no video, no network.
 * The impure parts (registration, pulling verified footage from a player's linked
 * YouTube, persisting ratings) wire on top of this.
 */

export const START_RATING = 1000
/** Elo K-factor — how much one result swings a rating. */
export const K_FACTOR = 32

/** Elo expected score of `me` vs `opp` (0..1). */
export function expectedScore(me: number, opp: number): number {
  return 1 / (1 + Math.pow(10, (opp - me) / 400))
}

/** Apply one decided match to both ratings. Ratings never go below 0. */
export function applyLadderResult(
  winnerRating: number,
  loserRating: number,
): { winner: number; loser: number } {
  const ew = expectedScore(winnerRating, loserRating)
  const el = expectedScore(loserRating, winnerRating)
  return {
    winner: Math.max(0, Math.round(winnerRating + K_FACTOR * (1 - ew))),
    loser: Math.max(0, Math.round(loserRating + K_FACTOR * (0 - el))),
  }
}

export interface RankTier { name: string; min: number; color: string }

/** Rank bands by rating. The King is a STATUS on top of the ladder, not a tier. */
export const RANK_TIERS: RankTier[] = [
  { name: 'Academy', min: 0, color: '#9aa4b2' },
  { name: 'Genin', min: 900, color: '#16db93' },
  { name: 'Chūnin', min: 1050, color: '#00e5ff' },
  { name: 'Jōnin', min: 1200, color: '#a855f7' },
  { name: 'Elite Jōnin', min: 1350, color: '#ff8a1e' },
  { name: 'Kage-class', min: 1500, color: '#ffd700' },
  { name: 'Legend', min: 1700, color: '#ff3b6b' },
]

export function tierFor(rating: number): RankTier {
  let out = RANK_TIERS[0]
  for (const t of RANK_TIERS) if (rating >= t.min) out = t
  return out
}

export interface LadderPlayer {
  id: string
  rating: number
}

/** Players sorted King-first (highest rating), ties broken by id for stability. */
export function ranked(players: LadderPlayer[]): LadderPlayer[] {
  return [...players].sort((a, b) => (b.rating - a.rating) || a.id.localeCompare(b.id))
}

/** The current TKO King's id (top of the ladder), or null if nobody's ranked. */
export function kingOf(players: LadderPlayer[]): string | null {
  return ranked(players)[0]?.id ?? null
}

/** 0-based ladder position of a player (0 = King). -1 if not on the ladder. */
export function rankOf(playerId: string, players: LadderPlayer[]): number {
  return ranked(players).findIndex((p) => p.id === playerId)
}

export interface MatchmakeOpts {
  /** Base rating window for a candidate opponent. */
  window?: number
  /** Players in the top `topGuard` positions only match other top-`topGuard`. */
  topGuard?: number
}

/**
 * Candidate opponents for `playerId`, rank-banded. Everyone is matched within a
 * rating window; but a player near the TOP (inside `topGuard`) is matched ONLY
 * with other top players — so climbing into contention means facing the best,
 * and the King defends against real challengers, not newcomers.
 */
export function candidatesFor(
  playerId: string,
  players: LadderPlayer[],
  opts: MatchmakeOpts = {},
): LadderPlayer[] {
  const window = opts.window ?? 150
  const topGuard = opts.topGuard ?? 3
  const order = ranked(players)
  const meIdx = order.findIndex((p) => p.id === playerId)
  if (meIdx < 0) return []
  const me = order[meIdx]
  const meIsTop = meIdx < topGuard
  return order.filter((p, i) => {
    if (p.id === playerId) return false
    if (meIsTop || i < topGuard) {
      // Top players only face other top players.
      return meIsTop && i < topGuard
    }
    return Math.abs(p.rating - me.rating) <= window
  })
}

/** Days holding King → an artifact reward tier (mirrors Conquest's hold reward). */
export function kingRewardTier(daysHeld: number): 'rare' | 'epic' | 'legendary' | 'mythic' | null {
  if (daysHeld >= 30) return 'mythic'
  if (daysHeld >= 14) return 'legendary'
  if (daysHeld >= 7) return 'epic'
  if (daysHeld >= 3) return 'rare'
  return null
}
