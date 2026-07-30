/**
 * conquest.ts — Shinobi Conquest: the land-ownership meta + power progression.
 *
 * Pure rules only (no React/DB), so it's easy to test and reuse on both the
 * client (the map + leaderboard) and the server (battle → land + power). The
 * map itself is DB-backed (territories rows); this module decides titles from
 * land held and how much power a win/loss/upload grants.
 *
 * The loop: clans/villages fight → wins take an opponent's territory (or an
 * unclaimed one) → holding land grants a title (Feudal Lord … Kage … Emperor).
 * The goal is to own the most land. It starts tiny and the board GROWS as it
 * fills, so there's always frontier to fight over.
 */

// ── power progression ────────────────────────────────────────────────────────
export const POWER = {
  UPLOAD: 100, // uploading a clip
  WIN: 250, // winning a tracked battle
  LOSS: 75, // losing still earns something (participation)
  CAPTURE: 150, // bonus for taking territory
} as const

export function powerForResult(result: 'win' | 'loss'): number {
  return result === 'win' ? POWER.WIN : POWER.LOSS
}

// ── titles by land held ──────────────────────────────────────────────────────
export interface Title {
  at: number // minimum territories to hold this title
  name: string
  color: string
}

/** Ascending Naruto-flavored ranks earned by holding land. */
export const LAND_TITLES: Title[] = [
  { at: 0, name: 'Wanderer', color: '#9aa4b2' }, // no land yet — must win to claim
  { at: 1, name: 'Feudal Lord', color: '#16db93' },
  { at: 3, name: 'Daimyo', color: '#00e5ff' },
  { at: 6, name: 'Jonin Commander', color: '#a855f7' },
  { at: 10, name: 'Kage', color: '#ff8a1e' },
  { at: 18, name: 'Sage', color: '#ffd700' },
  { at: 30, name: 'Shinobi Emperor', color: '#ff3b6b' },
]

/** The title a clan earns for the amount of land it holds. */
export function titleForLand(landCount: number): Title {
  let out = LAND_TITLES[0]
  for (const t of LAND_TITLES) if (landCount >= t.at) out = t
  return out
}

/** The Kage-style banner for a top clan (regional flavor by index). */
const KAGE_NAMES = ['Hokage', 'Raikage', 'Mizukage', 'Tsuchikage', 'Kazekage']
export function kageTitle(rankIndex: number): string {
  return KAGE_NAMES[rankIndex] ?? 'Kage'
}

// ── board sizing (dynamic growth) ────────────────────────────────────────────
/** The board grows when it gets too full, so there's always frontier. Returns
 *  the target territory count for a given number of clans holding land. */
export function targetBoardSize(clansWithLand: number, claimed: number, total: number): number {
  // grow by a ring once >70% claimed, so newcomers always have somewhere to fight for.
  if (total === 0) return Math.max(19, clansWithLand * 4)
  if (claimed / total > 0.7) return total + Math.max(7, clansWithLand * 2)
  return total
}

// ── land standings ───────────────────────────────────────────────────────────
export interface ClanLand {
  clanId: string
  clanName: string
  clanTag: string | null
  land: number
}

/** Sort clans by land (desc); the leader is the reigning power. */
export function standings(rows: ClanLand[]): (ClanLand & { title: Title; rank: number })[] {
  return [...rows]
    .sort((a, b) => b.land - a.land)
    .map((r, i) => ({ ...r, rank: i, title: titleForLand(r.land) }))
}
