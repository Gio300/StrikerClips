import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRIZE_SPLIT_BPS,
  parsePrizeSplitBps,
  splitPrizePool,
  splitPrizePoolEvenly,
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

describe('tie split (splitPrizePoolEvenly)', () => {
  it('splits an even pot exactly evenly', () => {
    expect(splitPrizePoolEvenly(50, 2)).toEqual([
      { placement: 1, amount: 25 },
      { placement: 2, amount: 25 },
    ])
  })

  it('conserves the pot and keeps every share within one unit on odd pots', () => {
    const payouts = splitPrizePoolEvenly(75, 2)
    expect(payouts.reduce((sum, payout) => sum + payout.amount, 0)).toBe(75)
    expect(payouts.map((payout) => payout.amount)).toEqual([38, 37])

    const threeWay = splitPrizePoolEvenly(100, 3)
    expect(threeWay.reduce((sum, payout) => sum + payout.amount, 0)).toBe(100)
    const amounts = threeWay.map((payout) => payout.amount)
    expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1)
  })

  it('stays within one unit on LARGE pots (where rounded basis points drift apart)', () => {
    const payouts = splitPrizePoolEvenly(1_000_000, 3)
    expect(payouts.reduce((sum, payout) => sum + payout.amount, 0)).toBe(1_000_000)
    const amounts = payouts.map((payout) => payout.amount)
    expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1)
  })

  it('degrades to winner-take-all for a single leader and rejects bad input', () => {
    expect(splitPrizePoolEvenly(45, 1)).toEqual([{ placement: 1, amount: 45 }])
    expect(splitPrizePoolEvenly(0, 2)).toEqual([
      { placement: 1, amount: 0 },
      { placement: 2, amount: 0 },
    ])
    expect(() => splitPrizePoolEvenly(-1, 2)).toThrow()
    expect(() => splitPrizePoolEvenly(10, 0)).toThrow()
  })
})
