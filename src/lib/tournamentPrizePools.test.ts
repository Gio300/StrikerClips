import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRIZE_SPLIT_BPS,
  parsePrizeSplitBps,
  splitPrizePool,
} from './tournamentPrizePools'

describe('tournament prize pool math', () => {
  it('uses a 70/20/10 default split and conserves the pot', () => {
    const payouts = splitPrizePool(101, DEFAULT_PRIZE_SPLIT_BPS)

    expect(payouts).toEqual([
      { placement: 1, amount: 71 },
      { placement: 2, amount: 20 },
      { placement: 3, amount: 10 },
    ])
    expect(payouts.reduce((sum, payout) => sum + payout.amount, 0)).toBe(101)
  })

  it('supports a winner-take-all pool', () => {
    expect(splitPrizePool(45, [10_000], 1)).toEqual([
      { placement: 1, amount: 45 },
    ])
  })

  it('rejects invalid totals and splits', () => {
    expect(() => splitPrizePool(-1)).toThrow()
    expect(() => splitPrizePool(10, [5000, 4000], 2)).toThrow()
    expect(() => splitPrizePool(10, [10_000], 2)).toThrow()
  })

  it('parses JSON and array split values', () => {
    expect(parsePrizeSplitBps('[7000,2000,1000]')).toEqual([7000, 2000, 1000])
    expect(parsePrizeSplitBps([10_000])).toEqual([10_000])
    expect(parsePrizeSplitBps('not-json')).toEqual([])
  })
})
