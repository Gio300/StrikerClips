import { describe, it, expect } from 'vitest'
import {
  earned, newlyEarned, nextMilestone, canCraft, makeGiftCode, LEGEND_MONTHLY_CRAFTS,
} from './artifacts'

describe('artifact economy', () => {
  it('earns upload milestones cumulatively', () => {
    expect(earned('uploads', 0)).toHaveLength(0)
    expect(earned('uploads', 1).map((d) => d.slug)).toEqual(['first-blood'])
    expect(earned('uploads', 15).map((d) => d.slug))
      .toEqual(['first-blood', 'clip-collector', 'highlight-hunter'])
    expect(earned('uploads', 999)).toHaveLength(5)
  })

  it('reports only NEWLY earned on a counter jump', () => {
    expect(newlyEarned('uploads', 4, 5).map((d) => d.slug)).toEqual(['clip-collector'])
    expect(newlyEarned('uploads', 5, 5)).toHaveLength(0)
    expect(newlyEarned('referrals', 0, 3).map((d) => d.slug)).toEqual(['recruiter', 'squad-builder'])
  })

  it('tracks progress to the next milestone', () => {
    const n = nextMilestone('uploads', 3)
    expect(n?.def.slug).toBe('clip-collector')
    expect(n?.remaining).toBe(2)
    expect(n?.progress).toBeCloseTo((3 - 1) / (5 - 1))
    expect(nextMilestone('uploads', 100)).toBeNull()
  })

  it('gift-earning milestones carry the gift capability', () => {
    expect(earned('uploads', 100).at(-1)?.capability).toBe('gift_starter')
    expect(earned('referrals', 15).at(-1)?.capability).toBe('gift_starter')
  })

  it('limits Legend crafts per month', () => {
    expect(canCraft(true, 0)).toBe(true)
    expect(canCraft(true, LEGEND_MONTHLY_CRAFTS)).toBe(false)
    expect(canCraft(false, 0)).toBe(false)
  })

  it('makes stable, well-formed gift codes', () => {
    expect(makeGiftCode('abc')).toBe(makeGiftCode('abc'))
    expect(makeGiftCode('abc')).toMatch(/^TKO-GIFT-[A-Z0-9]{6}$/)
  })
})
