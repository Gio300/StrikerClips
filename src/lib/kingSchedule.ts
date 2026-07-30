/**
 * kingSchedule — pairing + scheduling for the never-ending TKO King ladder.
 *
 * The ladder (kingLadder.ts) decides WHO should play WHOM (rank-banded Elo). This
 * module handles the AGREEMENT: two matched Shinobi each propose day/times, and
 * the match schedules itself the moment their proposals overlap. From there it
 * waits on the result (stat check → played match → verified footage decides the
 * winner), which re-rates both and frees them to be paired again.
 *
 * Pure + deterministic, so it unit-tests with no DB, no notifications, no clock
 * beyond what's passed in.
 */

export type MatchState =
  | 'proposing' // matched, waiting for both to propose overlapping times
  | 'scheduled' // both agreed on a time; it's on the calendar
  | 'awaiting_result' // the agreed time has passed; waiting on the verified result
  | 'done' // a winner is recorded

export interface KingMatch {
  id: string
  playerA: string
  playerB: string
  /** ISO slot strings each player is available for. */
  proposalsA: string[]
  proposalsB: string[]
  /** The agreed ISO time, once their proposals overlap. */
  agreedTime: string | null
  winnerId: string | null
}

/** The earliest time BOTH players proposed, or null if they don't overlap yet. */
export function commonSlot(a: string[], b: string[]): string | null {
  const setB = new Set(b)
  const common = a.filter((t) => setB.has(t)).sort()
  return common[0] ?? null
}

/** Add a player's proposed slots (deduped, sorted). Returns the new list. */
export function addProposals(existing: string[], slots: string[]): string[] {
  return [...new Set([...existing, ...slots.filter(Boolean)])].sort()
}

/** Resolve the lifecycle state of a match given the current time. */
export function matchState(match: Pick<KingMatch, 'agreedTime' | 'winnerId'>, now: number = Date.now()): MatchState {
  if (match.winnerId) return 'done'
  if (!match.agreedTime) return 'proposing'
  const t = new Date(match.agreedTime).getTime()
  return Number.isFinite(t) && t <= now ? 'awaiting_result' : 'scheduled'
}

/**
 * Fold a fresh proposal from one player into a match: store their slots and, if
 * that creates an overlap with the opponent, lock the agreed time. Pure — returns
 * a new match object.
 */
export function applyProposal(match: KingMatch, playerId: string, slots: string[]): KingMatch {
  const next: KingMatch = { ...match }
  if (playerId === match.playerA) next.proposalsA = addProposals(match.proposalsA, slots)
  else if (playerId === match.playerB) next.proposalsB = addProposals(match.proposalsB, slots)
  else return match // not a participant — ignore
  if (!next.agreedTime) next.agreedTime = commonSlot(next.proposalsA, next.proposalsB)
  return next
}

/** True once both sides have proposed and a common time was found. */
export function isScheduled(match: Pick<KingMatch, 'agreedTime'>): boolean {
  return !!match.agreedTime
}
