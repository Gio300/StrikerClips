import { describe, it, expect } from 'vitest'
import {
  applyLadderResult,
  expectedScore,
  tierFor,
  kingOf,
  rankOf,
  candidatesFor,
  kingRewardTier,
  START_RATING,
} from './kingLadder'

describe('elo', () => {
  it('even players have a 50% expected score', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5)
  })
  it('a win raises the winner and lowers the loser', () => {
    const { winner, loser } = applyLadderResult(1000, 1000)
    expect(winner).toBeGreaterThan(1000)
    expect(loser).toBeLessThan(1000)
    expect(winner - 1000).toBe(1000 - loser) // symmetric at even ratings
  })
  it('beating a much stronger player is worth more', () => {
    const upset = applyLadderResult(1000, 1400).winner - 1000
    const expected = applyLadderResult(1400, 1000).winner - 1400
    expect(upset).toBeGreaterThan(expected)
  })
  it('ratings never go below zero', () => {
    expect(applyLadderResult(1000, 5).loser).toBeGreaterThanOrEqual(0)
  })
})

describe('ranking + King status', () => {
  const players = [
    { id: 'a', rating: 1200 },
    { id: 'b', rating: 1500 },
    { id: 'c', rating: 900 },
  ]
  it('King is the highest-rated player', () => {
    expect(kingOf(players)).toBe('b')
    expect(rankOf('b', players)).toBe(0)
    expect(rankOf('c', players)).toBe(2)
  })
  it('a newcomer starts at the bottom', () => {
    const withNew = [...players, { id: 'new', rating: START_RATING }]
    expect(kingOf(withNew)).toBe('b')
    expect(rankOf('new', withNew)).toBeGreaterThan(0)
  })
  it('tiers rise with rating', () => {
    expect(tierFor(0).name).toBe('Academy')
    expect(tierFor(1500).name).toBe('Kage-class')
    expect(tierFor(1800).name).toBe('Legend')
  })
})

describe('rank-banded matchmaking', () => {
  const pool = [
    { id: 'king', rating: 1800 },
    { id: 'chal', rating: 1750 },
    { id: 'third', rating: 1700 },
    { id: 'mid', rating: 1200 },
    { id: 'mid2', rating: 1150 },
    { id: 'low', rating: 900 },
  ]
  it('top players only face other top players', () => {
    const c = candidatesFor('king', pool, { topGuard: 3, window: 150 })
    expect(c.map((p) => p.id).sort()).toEqual(['chal', 'third'])
    expect(c.some((p) => p.id === 'mid')).toBe(false)
  })
  it('mid players face those within their window, never the top guard', () => {
    const c = candidatesFor('mid', pool, { topGuard: 3, window: 150 })
    expect(c.some((p) => p.id === 'mid2')).toBe(true)
    expect(c.some((p) => p.id === 'king')).toBe(false)
  })
})

describe('king reward tier by hold time', () => {
  it('escalates the longer you hold the crown', () => {
    expect(kingRewardTier(0)).toBeNull()
    expect(kingRewardTier(3)).toBe('rare')
    expect(kingRewardTier(7)).toBe('epic')
    expect(kingRewardTier(14)).toBe('legendary')
    expect(kingRewardTier(30)).toBe('mythic')
  })
})
