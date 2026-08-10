export type BracketSeedMode = 'registration' | 'shuffle'

export type BracketAssignment = {
  round: 1
  bracketSlot: number
  playerA: string
  playerB: string | null
  winner: string | null
  status: 'scheduled' | 'complete'
}

export type BracketPosition = {
  round: number
  bracketSlot: number
  side: 'player_a' | 'player_b'
}

export function bracketSizeForEntrants(count: number): number {
  const entrants = Math.max(0, Math.floor(count))
  if (entrants < 2) return entrants
  return 2 ** Math.ceil(Math.log2(entrants))
}

export function totalBracketRounds(count: number): number {
  const size = bracketSizeForEntrants(count)
  return size > 1 ? Math.log2(size) : 0
}

/**
 * How many rounds a bracket will play once it is complete, derived from the
 * battles currently on the board.
 *
 * Only SEEDED rounds exist as rows, so counting them is wrong: a freshly
 * seeded four-player bracket holds one round of two matchups, and calling that
 * round "the Final" — which both the bracket header and the match boards did —
 * is a lie the players can see. The opening round's WIDTH fixes the depth.
 * Falls back to the shallowest round present when round 1 has been pruned, and
 * never reports fewer rounds than actually exist.
 */
export function expectedRoundsFromBattles(
  battles: readonly { round?: number | null }[],
): number {
  const widths = new Map<number, number>()
  let deepest = 0
  for (const battle of battles) {
    const raw = Number(battle?.round ?? 1)
    const round = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1
    widths.set(round, (widths.get(round) ?? 0) + 1)
    if (round > deepest) deepest = round
  }
  if (widths.size === 0) return 0
  const base = widths.has(1) ? 1 : Math.min(...widths.keys())
  const width = widths.get(base) ?? 1
  const depth = Math.ceil(Math.log2(Math.max(1, width))) + base
  return Math.max(depth, deepest)
}

/**
 * Build a complete first round without empty match rows. Every bracket slot has
 * at least one entrant; spare positions become explicit byes that are already
 * marked complete so the server can advance them as soon as their sibling
 * matchup is decided.
 */
export function firstRoundAssignments(playerIds: readonly string[]): BracketAssignment[] {
  const ids = Array.from(new Set(playerIds.filter(Boolean)))
  if (ids.length < 2) return []

  const matchCount = bracketSizeForEntrants(ids.length) / 2
  const slots: BracketAssignment[] = Array.from({ length: matchCount }, (_, bracketSlot) => ({
    round: 1 as const,
    bracketSlot,
    playerA: ids[bracketSlot],
    playerB: null as string | null,
    winner: ids[bracketSlot] as string | null,
    status: 'complete',
  }))

  const extras = ids.slice(matchCount)
  // Spread contested matches across the board instead of clustering every bye
  // at the end. That produces a more balanced, easier-to-read opening round.
  const slotOrder = Array.from({ length: matchCount }, (_, index) => {
    const half = Math.ceil(matchCount / 2)
    return index % 2 === 0 ? index / 2 : half + Math.floor(index / 2)
  })
  extras.forEach((playerB, index) => {
    const slot = slots[slotOrder[index]]
    slot.playerB = playerB
    slot.winner = null
    slot.status = 'scheduled'
  })
  return slots
}

export function nextBracketPosition(round: number, bracketSlot: number): BracketPosition {
  const slot = Math.max(0, Math.floor(bracketSlot))
  return {
    round: Math.max(1, Math.floor(round)) + 1,
    bracketSlot: Math.floor(slot / 2),
    side: slot % 2 === 0 ? 'player_a' : 'player_b',
  }
}

type LeaderBattle = {
  player_a?: unknown
  player_b?: unknown
  winner?: unknown
  round?: number | null
}

/**
 * Who is FURTHEST ADVANCED in a (possibly unfinished) bracket — the winner(s)
 * when a tournament hits its end time before the final is decided.
 *
 * Progress: appearing in a round-r matchup = r; winning one = r+1 (you advanced
 * into the next round, whether or not that matchup row exists yet). The leaders
 * are everyone tied at the maximum progress:
 *   - a decided final → exactly one leader (the champion);
 *   - an undecided final → both finalists (a 2-way tie);
 *   - a half-played round → the players who already won it.
 * Sorted by id so downstream placement/remainder math is deterministic.
 */
export function bracketProgress(battles: readonly LeaderBattle[]): Map<string, number> {
  const progress = new Map<string, number>()
  const bump = (id: unknown, value: number) => {
    if (id == null || id === '') return
    const key = String(id)
    progress.set(key, Math.max(progress.get(key) ?? 0, value))
  }
  for (const battle of battles) {
    const raw = Number(battle.round ?? 1)
    const round = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1
    bump(battle.player_a, round)
    bump(battle.player_b, round)
    if (battle.winner != null && battle.winner !== '') bump(battle.winner, round + 1)
  }
  return progress
}

/** Everyone tied at the top of a progress map, sorted by id (deterministic). */
function topOf(progress: Map<string, number>): string[] {
  if (progress.size === 0) return []
  const top = Math.max(...progress.values())
  return Array.from(progress.entries())
    .filter(([, value]) => value === top)
    .map(([id]) => id)
    .sort()
}

export function bracketLeaders(battles: readonly LeaderBattle[]): string[] {
  return topOf(bracketProgress(battles))
}

/**
 * The furthest-advanced players AMONG a restricted candidate set — the same
 * ranking as bracketLeaders, but scored only over the players who are eligible
 * for whatever is being awarded.
 *
 * This is what settles a prize pool whose pot nobody at the top of the bracket
 * paid into. The overall bracket winner may never have entered the pool; the
 * pot still belongs to the people who DID pay, so it goes to the best-placed of
 * THEM rather than being refunded to everybody (see server/tournamentEndSweep).
 * Candidates who never appear in the bracket at all score nothing and are
 * excluded — an empty result means "the bracket says nothing about anyone
 * eligible", which is the honest trigger for a refund.
 */
export function bracketLeadersAmong(
  battles: readonly LeaderBattle[],
  eligible: Iterable<string>,
): string[] {
  const allowed = new Set(Array.from(eligible, (id) => String(id)).filter(Boolean))
  if (allowed.size === 0) return []
  const progress = bracketProgress(battles)
  for (const key of Array.from(progress.keys())) {
    if (!allowed.has(key)) progress.delete(key)
  }
  return topOf(progress)
}

export function roundLabel(round: number, totalRounds: number): string {
  const remaining = Math.max(0, Math.floor(totalRounds) - Math.max(1, Math.floor(round)))
  if (remaining === 0) return 'Final'
  if (remaining === 1) return 'Semifinal'
  if (remaining === 2) return 'Quarterfinal'
  return `Round of ${2 ** (remaining + 1)}`
}
