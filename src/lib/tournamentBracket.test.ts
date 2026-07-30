import { describe, expect, it } from 'vitest'
import {
  bracketSizeForEntrants,
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
