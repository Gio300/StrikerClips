import { describe, it, expect } from 'vitest'
import {
  GUIDES,
  getGuide,
  guideIds,
  clampStepIndex,
  nextStepIndex,
  prevStepIndex,
  isLastStep,
  suggestGuideId,
  suggestGuide,
} from './guides'

describe('guides — registry shape', () => {
  it('exposes the five authored guides', () => {
    expect(guideIds()).toEqual([
      'tko-king',
      'connect-youtube',
      'make-clip',
      'go-live',
      'join-clan',
    ])
  })

  it('has unique ids and at least one step each', () => {
    const ids = GUIDES.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const g of GUIDES) {
      expect(g.steps.length).toBeGreaterThan(0)
      expect(g.title.length).toBeGreaterThan(0)
      expect(g.summary.length).toBeGreaterThan(0)
    }
  })

  it('every step has a title + body, and every CTA has a label + in-app route', () => {
    for (const g of GUIDES) {
      for (const step of g.steps) {
        expect(step.title.trim().length).toBeGreaterThan(0)
        expect(step.body.trim().length).toBeGreaterThan(0)
        if (step.cta) {
          expect(step.cta.label.trim().length).toBeGreaterThan(0)
          expect(step.cta.to.startsWith('/')).toBe(true)
        }
      }
    }
  })

  it('models the always-open TKO King ladder in order', () => {
    const king = getGuide('tko-king')!
    expect(king).toBeDefined()
    const titles = king.steps.map((s) => s.title.toLowerCase())
    expect(titles).toHaveLength(3)
    expect(titles[0]).toContain('enter')
    expect(titles[1]).toContain('time')
    expect(titles[2]).toContain('result')
    expect(king.steps.every((step) => step.cta?.to === '/king')).toBe(true)
  })
})

describe('guides — getGuide', () => {
  it('finds by id, and returns undefined for null/unknown', () => {
    expect(getGuide('go-live')?.title).toBe('Go live')
    expect(getGuide(null)).toBeUndefined()
    expect(getGuide(undefined)).toBeUndefined()
    expect(getGuide('nope')).toBeUndefined()
  })
})

describe('guides — step bounds', () => {
  it('clamps into range and floors fractions', () => {
    expect(clampStepIndex(-3, 5)).toBe(0)
    expect(clampStepIndex(0, 5)).toBe(0)
    expect(clampStepIndex(4, 5)).toBe(4)
    expect(clampStepIndex(9, 5)).toBe(4)
    expect(clampStepIndex(2.9, 5)).toBe(2)
    expect(clampStepIndex(1, 0)).toBe(0) // empty guide
    expect(clampStepIndex(NaN, 5)).toBe(0)
  })

  it('next never runs past the last step', () => {
    expect(nextStepIndex(0, 5)).toBe(1)
    expect(nextStepIndex(3, 5)).toBe(4)
    expect(nextStepIndex(4, 5)).toBe(4) // already last
  })

  it('prev never goes below the first step', () => {
    expect(prevStepIndex(2)).toBe(1)
    expect(prevStepIndex(1)).toBe(0)
    expect(prevStepIndex(0)).toBe(0) // already first
  })

  it('isLastStep detects the final step', () => {
    expect(isLastStep(4, 5)).toBe(true)
    expect(isLastStep(3, 5)).toBe(false)
    expect(isLastStep(0, 0)).toBe(false)
  })

  it('walking forward then back stays inside a real guide', () => {
    const total = getGuide('make-clip')!.steps.length
    let i = 0
    for (let k = 0; k < total + 3; k++) i = nextStepIndex(i, total)
    expect(i).toBe(total - 1)
    for (let k = 0; k < total + 3; k++) i = prevStepIndex(i)
    expect(i).toBe(0)
  })
})

describe('guides — route → guide suggestion', () => {
  it('suggests the matching guide for each known route', () => {
    expect(suggestGuideId('/king')).toBe('tko-king')
    expect(suggestGuideId('/stat-check')).toBe('tko-king')
    expect(suggestGuideId('/connect')).toBe('connect-youtube')
    expect(suggestGuideId('/highlight/create')).toBe('make-clip')
    expect(suggestGuideId('/reels/create')).toBe('make-clip')
    expect(suggestGuideId('/go-live')).toBe('go-live')
    expect(suggestGuideId('/clans/discover')).toBe('join-clan')
  })

  it('matches sub-paths and tolerates a trailing slash', () => {
    expect(suggestGuideId('/king/')).toBe('tko-king')
    expect(suggestGuideId('/connect/extra')).toBe('connect-youtube')
  })

  it('prefers the longest (most specific) prefix', () => {
    // /clans/discover must beat a broader /clans match (there is none, but the
    // discover route should never be mistaken for a generic clans page).
    expect(suggestGuideId('/clans/discover')).toBe('join-clan')
  })

  it('returns null for routes with no guide', () => {
    expect(suggestGuideId('/')).toBeNull()
    expect(suggestGuideId('/profile')).toBeNull()
    expect(suggestGuideId('/tournaments')).toBeNull()
    expect(suggestGuideId('')).toBeNull()
  })

  it('suggestGuide returns the full guide object or undefined', () => {
    expect(suggestGuide('/go-live')?.id).toBe('go-live')
    expect(suggestGuide('/profile')).toBeUndefined()
  })
})
