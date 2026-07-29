import { describe, it, expect } from 'vitest'
import {
  canAddAngle, canHostAnywhere, canHostOwnTournament, canHostOnVideo,
  withinRenderBudget, shouldRerender, budgetCostUsd, isContentTier,
  RERENDER_BUDGET, MIN_RERENDER_GAP_MS, JOIN_BATCH_WINDOW_MS, MAX_MATCH_VERSIONS,
} from './hosting'

describe('hosting + re-render limits', () => {
  it('only paid content tiers with YouTube may add an angle', () => {
    expect(canAddAngle('pro', true)).toBe(true)
    expect(canAddAngle('creator', true)).toBe(true)
    expect(canAddAngle('pro', false)).toBe(false)     // no YouTube
    expect(canAddAngle('ad_free', true)).toBe(false)  // ad-only tier excluded
    expect(canAddAngle('free', true)).toBe(false)
    expect(isContentTier('ad_free')).toBe(false)
  })

  it('Legend hosts anywhere; tournament throwers host only their own', () => {
    expect(canHostAnywhere('creator')).toBe(true)
    expect(canHostAnywhere('supporter')).toBe(false)
    expect(canHostOwnTournament('supporter', true)).toBe(true)
    expect(canHostOwnTournament('supporter', false)).toBe(false)
    expect(canHostOwnTournament('free', true)).toBe(false)   // must be paid
    // creator can host any video
    expect(canHostOnVideo({ tier: 'creator' })).toBe(true)
    // supporter can host only their tournament's video
    expect(canHostOnVideo({ tier: 'supporter', isTournamentHost: true, videoFromTheirTournament: true })).toBe(true)
    expect(canHostOnVideo({ tier: 'supporter', isTournamentHost: true, videoFromTheirTournament: false })).toBe(false)
    expect(canHostOnVideo({ tier: 'pro' })).toBe(false)
  })

  it('enforces monthly re-render budgets by tier', () => {
    expect(withinRenderBudget('pro', 0)).toBe(true)
    expect(withinRenderBudget('pro', RERENDER_BUDGET.pro)).toBe(false)
    expect(withinRenderBudget('free', 0)).toBe(false)
    expect(RERENDER_BUDGET.creator).toBeGreaterThan(RERENDER_BUDGET.pro)
  })

  it('batches bursts, respects the min gap, caps versions', () => {
    const now = 1_000_000_000_000
    // fresh join, nothing rendered yet, burst still settling -> wait
    expect(shouldRerender({ now, lastRenderAt: null, versions: 1, pendingSince: now - 1000 }))
      .toMatchObject({ render: false, reason: 'batching' })
    // burst window elapsed -> render
    expect(shouldRerender({ now, lastRenderAt: null, versions: 1, pendingSince: now - JOIN_BATCH_WINDOW_MS - 1 }))
      .toMatchObject({ render: true })
    // rendered moments ago -> min gap blocks
    expect(shouldRerender({ now, lastRenderAt: now - 1000, versions: 1, pendingSince: now - JOIN_BATCH_WINDOW_MS - 1 }))
      .toMatchObject({ render: false, reason: 'min_gap' })
    // gap satisfied -> render
    expect(shouldRerender({ now, lastRenderAt: now - MIN_RERENDER_GAP_MS - 1, versions: 1, pendingSince: now - JOIN_BATCH_WINDOW_MS - 1 }))
      .toMatchObject({ render: true })
    // too many versions -> never
    expect(shouldRerender({ now, lastRenderAt: null, versions: MAX_MATCH_VERSIONS, pendingSince: now - JOIN_BATCH_WINDOW_MS - 1 }))
      .toMatchObject({ render: false, reason: 'max_versions' })
  })

  it('reports budget cost in dollars', () => {
    expect(budgetCostUsd('pro')).toBeCloseTo(RERENDER_BUDGET.pro * 0.05)
  })
})
