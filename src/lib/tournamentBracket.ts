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

export function roundLabel(round: number, totalRounds: number): string {
  const remaining = Math.max(0, Math.floor(totalRounds) - Math.max(1, Math.floor(round)))
  if (remaining === 0) return 'Final'
  if (remaining === 1) return 'Semifinal'
  if (remaining === 2) return 'Quarterfinal'
  return `Round of ${2 ** (remaining + 1)}`
}
