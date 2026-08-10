import { describe, expect, it } from 'vitest'
import {
  bracketLeaders,
  bracketLeadersAmong,
  bracketSizeForEntrants,
  expectedRoundsFromBattles,
  firstRoundAssignments,
  nextBracketPosition,
  roundLabel,
  totalBracketRounds,
} from './tournamentBracket'

describe('tournament bracket', () => {
  it('sizes single-elimination fields to the next power of two', () => {
    expect(bracketSizeForEntrants(2)).toBe(2)
    expect(bracketSizeForEntrants(5)).toBe(8)
    expect(bracketSizeForEntrants(8)).toBe(8)
    expect(totalBracketRounds(8)).toBe(3)
  })

  it('creates balanced first-round matches and explicit byes', () => {
    const assignments = firstRoundAssignments(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(assignments).toHaveLength(4)
    expect(assignments.filter((match) => match.playerB)).toHaveLength(2)
    expect(assignments.filter((match) => match.status === 'complete')).toHaveLength(2)
    expect(assignments.flatMap((match) => [match.playerA, match.playerB]).filter(Boolean).sort())
      .toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('maps feeder slots to the correct side of the next matchup', () => {
    expect(nextBracketPosition(1, 0)).toEqual({ round: 2, bracketSlot: 0, side: 'player_a' })
    expect(nextBracketPosition(1, 1)).toEqual({ round: 2, bracketSlot: 0, side: 'player_b' })
    expect(nextBracketPosition(2, 3)).toEqual({ round: 3, bracketSlot: 1, side: 'player_b' })
  })

  it('labels the rounds relative to the final', () => {
    expect(roundLabel(1, 4)).toBe('Round of 16')
    expect(roundLabel(2, 4)).toBe('Quarterfinal')
    expect(roundLabel(3, 4)).toBe('Semifinal')
    expect(roundLabel(4, 4)).toBe('Final')
  })
})

describe('bracketLeaders (the end-time winner rule)', () => {
  it('names the champion of a decided final as the sole leader', () => {
    expect(
      bracketLeaders([
        { round: 1, player_a: 'a', player_b: 'b', winner: 'a' },
        { round: 1, player_a: 'c', player_b: 'd', winner: 'd' },
        { round: 2, player_a: 'a', player_b: 'd', winner: 'd' },
      ]),
    ).toEqual(['d'])
  })

  it('ties the two finalists of an undecided final', () => {
    expect(
      bracketLeaders([
        { round: 1, player_a: 'a', player_b: 'b', winner: 'a' },
        { round: 1, player_a: 'c', player_b: 'd', winner: 'd' },
        { round: 2, player_a: 'a', player_b: 'd', winner: null },
      ]),
    ).toEqual(['a', 'd'])
  })

  it('leads with a round winner even before the next matchup row exists', () => {
    expect(
      bracketLeaders([
        { round: 1, player_a: 'a', player_b: 'b', winner: 'b' },
        { round: 1, player_a: 'c', player_b: 'd', winner: null },
      ]),
    ).toEqual(['b'])
  })

  it('ties everyone in a completely unplayed round and handles missing rounds', () => {
    expect(
      bracketLeaders([
        { player_a: 'a', player_b: 'b', winner: null }, // legacy row without round
        { round: 1, player_a: 'c', player_b: 'd', winner: null },
      ]),
    ).toEqual(['a', 'b', 'c', 'd'])
    expect(bracketLeaders([])).toEqual([])
  })
})

// A freshly seeded bracket only has the rounds that were SEEDED, so counting
// the rounds on the board named the opening round "the Final" — a lie players
// could read straight off the bracket header on a live tournament.
describe('expectedRoundsFromBattles', () => {
  const round = (n: number, count: number) =>
    Array.from({ length: count }, () => ({ round: n }))

  it('derives the full depth from the opening round’s width', () => {
    expect(expectedRoundsFromBattles(round(1, 1))).toBe(1)
    expect(expectedRoundsFromBattles(round(1, 2))).toBe(2)
    expect(expectedRoundsFromBattles(round(1, 4))).toBe(3)
    expect(expectedRoundsFromBattles(round(1, 8))).toBe(4)
  })

  it('names a two-matchup opening round the SEMIFINAL, not the final', () => {
    const battles = round(1, 2)
    expect(roundLabel(1, expectedRoundsFromBattles(battles))).toBe('Semifinal')
    // The old behaviour — counting the rounds present — produced this instead.
    expect(roundLabel(1, 1)).toBe('Final')
  })

  it('keeps counting once later rounds are seeded', () => {
    const battles = [...round(1, 2), ...round(2, 1)]
    expect(expectedRoundsFromBattles(battles)).toBe(2)
    expect(roundLabel(2, expectedRoundsFromBattles(battles))).toBe('Final')
  })

  it('never reports fewer rounds than the board actually holds', () => {
    // A hand-built board: one opening matchup but three rounds of play.
    const battles = [...round(1, 1), ...round(2, 1), ...round(3, 1)]
    expect(expectedRoundsFromBattles(battles)).toBe(3)
  })

  it('falls back to the shallowest round when round 1 was pruned', () => {
    expect(expectedRoundsFromBattles(round(2, 2))).toBe(3)
  })

  it('treats missing / junk round numbers as round 1, and an empty board as zero', () => {
    expect(expectedRoundsFromBattles([])).toBe(0)
    expect(expectedRoundsFromBattles([{ round: null }, { round: null }])).toBe(2)
    expect(expectedRoundsFromBattles([{ round: 0 }])).toBe(1)
  })
})

// Who takes a prize pot the overall winner never paid into — see
// server/tournamentEndSweep.ts. Ranking is the same as bracketLeaders, scored
// only over the players who are eligible for the thing being awarded.
describe('bracketLeadersAmong', () => {
  // champ beat runnerUp in the final; runnerUp beat early in the semi;
  // champ beat sat in the other semi. Progress: champ 3, runnerUp 2, others 1.
  const board = [
    { player_a: 'champ', player_b: 'sat', winner: 'champ', round: 1 },
    { player_a: 'runnerUp', player_b: 'early', winner: 'runnerUp', round: 1 },
    { player_a: 'champ', player_b: 'runnerUp', winner: 'champ', round: 2 },
  ]

  it('returns the overall leader when they are eligible', () => {
    expect(bracketLeaders(board)).toEqual(['champ'])
    expect(bracketLeadersAmong(board, ['champ', 'early'])).toEqual(['champ'])
  })

  it('drops to the best-placed ELIGIBLE player when the leader is not one', () => {
    expect(bracketLeadersAmong(board, ['runnerUp', 'early', 'sat'])).toEqual(['runnerUp'])
    expect(bracketLeadersAmong(board, ['early', 'sat'])).toEqual(['early', 'sat'])
  })

  it('returns nothing when no eligible player appears on the board at all', () => {
    // The honest trigger for a refund: the bracket says nothing about anyone
    // who paid, so there is no one to hand the pot to.
    expect(bracketLeadersAmong(board, ['spectator'])).toEqual([])
    expect(bracketLeadersAmong(board, [])).toEqual([])
    expect(bracketLeadersAmong([], ['champ'])).toEqual([])
  })

  it('is deterministic and ignores blank candidate ids', () => {
    expect(bracketLeadersAmong(board, ['sat', 'early', ''])).toEqual(['early', 'sat'])
  })
})
