/**
 * conquestMechanics — the pure rules of Shinobi Conquest land + artifacts.
 *
 * The map is an ongoing struggle: clans hold land, and held land PRODUCES
 * artifacts over time. Two rules the product asked for:
 *   • the LONGER a clan holds a territory, the better the artifact it earns;
 *   • the MORE people occupy that land, the LOWER the per-person artifact tier
 *     (a big clan spreads the yield thin; a lean holder concentrates it).
 * Also: repeated defeats by the SAME rival erode a clan's grip — once the loss
 * margin crosses a threshold the clan is pushed off the land and must relocate.
 *
 * All pure functions so they unit-test with no DB, no video, no network.
 */

export type ArtifactTier = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'

export const ARTIFACT_TIERS: ArtifactTier[] = ['common', 'rare', 'epic', 'legendary', 'mythic']

/** Days a territory must be held to reach each tier ceiling (index = tier). */
const HOLD_DAYS_FOR_TIER = [0, 3, 7, 14, 30]

/**
 * The artifact tier a territory currently yields, from how long it's been held
 * and how many occupy it. Longer hold pushes the tier UP; more occupants pull it
 * DOWN (every ~4 occupants over the first drops one tier). Never below common.
 */
export function artifactTierFor(holdDays: number, occupants: number): ArtifactTier {
  let idx = 0
  for (let i = HOLD_DAYS_FOR_TIER.length - 1; i >= 0; i--) {
    if (holdDays >= HOLD_DAYS_FOR_TIER[i]) { idx = i; break }
  }
  // Crowding penalty: every 4 occupants past the first lowers the tier by one.
  const penalty = Math.floor(Math.max(0, occupants - 1) / 4)
  idx = Math.max(0, idx - penalty)
  return ARTIFACT_TIERS[idx]
}

/** Whole days a territory has been held, from an ISO claim timestamp. */
export function holdDays(claimedAt: string | null | undefined, now = Date.now()): number {
  if (!claimedAt) return 0
  const t = new Date(claimedAt).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

/** Supported challenge formats. Videos of these decide who holds the land. */
export type BattleFormat = '1v1' | '2v2' | '3v3' | '4v4'
export const BATTLE_FORMATS: BattleFormat[] = ['1v1', '2v2', '3v3', '4v4']

export interface Rivalry {
  /** net wins of the holder MINUS the challenger across their meetings. */
  margin: number
  meetings: number
}

/**
 * How many net defeats by one rival forces the holder off the land. A clan that
 * loses to the same rival by this margin has to vacate and relocate.
 */
export const VACATE_MARGIN = 3

/** True once a rival has beaten the holder by enough to seize the territory. */
export function shouldVacate(rivalNetWinsOverHolder: number): boolean {
  return rivalNetWinsOverHolder >= VACATE_MARGIN
}

/** Hard ceiling so a mega-clan's land is very hard — but not impossible — to take. */
export const MAX_CAPTURE_MARGIN = 40

/**
 * How many NET wins an attacking clan needs to seize an OCCUPIED territory,
 * scaled by roster sizes. A bigger defender is harder to dislodge (you must beat
 * a growing share of their shinobi more often than they beat you); a bigger
 * attacker gets a modest edge. So 20 people can't take a 100-clan's land off a
 * couple of wins — they have to out-fight the majority, repeatedly.
 *
 *   required = clamp( ceil(defenderSize / 5) − floor(attackerSize / 10),
 *                     VACATE_MARGIN, MAX_CAPTURE_MARGIN )
 */
export function captureMargin(defenderSize: number, attackerSize: number): number {
  const d = Math.max(1, Math.floor(defenderSize || 1))
  const a = Math.max(1, Math.floor(attackerSize || 1))
  const raw = Math.ceil(d / 5) - Math.floor(a / 10)
  return Math.min(MAX_CAPTURE_MARGIN, Math.max(VACATE_MARGIN, raw))
}

/** The share of head-to-head battles an attacker must win to push a rival out. */
export const DOMINANCE_RATE = 0.65

export interface DominanceInput {
  /** verified wins the ATTACKER has over the defender (from match videos). */
  winsFor: number
  /** verified wins the DEFENDER has over the attacker. */
  winsAgainst: number
  defenderSize: number
  attackerSize: number
}

export interface DominanceResult {
  captured: boolean
  /** attacker win rate 0..1 across their head-to-head. */
  rate: number
  /** net wins (attacker − defender). */
  net: number
  /** the size-weighted net margin required. */
  need: number
  total: number
}

/**
 * Does the attacker DOMINATE the defender enough to take the land? Land moves on
 * the balance of VIDEO-VERIFIED wins/losses between the two clans — no
 * agreement needed. To push a rival out you must (1) have fought them enough
 * times, (2) be winning a clear majority of those battles (DOMINANCE_RATE), and
 * (3) clear the size-weighted net margin — so a 100-clan pushing a 20-clan out
 * needs a high, sustained win rate over many matches, and a small clan taking a
 * big one needs an even larger net. Losing battles pull the net back down, so a
 * clan that starts losing steadily gives ground.
 */
export function dominanceCapture(input: DominanceInput): DominanceResult {
  const winsFor = Math.max(0, Math.floor(input.winsFor || 0))
  const winsAgainst = Math.max(0, Math.floor(input.winsAgainst || 0))
  const total = winsFor + winsAgainst
  const net = winsFor - winsAgainst
  const rate = total > 0 ? winsFor / total : 0
  const need = captureMargin(input.defenderSize, input.attackerSize)
  const captured = total >= need && rate >= DOMINANCE_RATE && net >= need
  return { captured, rate, net, need, total }
}

/**
 * Apply one battle result to a holder↔challenger rivalry margin (from the
 * CHALLENGER's point of view: +1 challenger win, −1 holder win). Returns the new
 * margin and whether the challenger has now earned the land.
 */
export function applyBattle(
  rivalry: Rivalry,
  winner: 'holder' | 'challenger',
): { rivalry: Rivalry; captured: boolean } {
  const delta = winner === 'challenger' ? 1 : -1
  const margin = rivalry.margin + delta
  const next: Rivalry = { margin, meetings: rivalry.meetings + 1 }
  return { rivalry: next, captured: shouldVacate(margin) }
}

/** A short human label for a tier (for badges / unlock screens). */
export function tierLabel(t: ArtifactTier): string {
  return t.charAt(0).toUpperCase() + t.slice(1)
}
