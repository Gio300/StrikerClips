import { describe, it, expect } from 'vitest'
import {
  artifactTierFor,
  holdDays,
  shouldVacate,
  applyBattle,
  captureMargin,
  dominanceCapture,
  VACATE_MARGIN,
  MAX_CAPTURE_MARGIN,
} from './conquestMechanics'

describe('artifactTierFor', () => {
  it('rises with hold time', () => {
    expect(artifactTierFor(0, 1)).toBe('common')
    expect(artifactTierFor(3, 1)).toBe('rare')
    expect(artifactTierFor(7, 1)).toBe('epic')
    expect(artifactTierFor(14, 1)).toBe('legendary')
    expect(artifactTierFor(30, 1)).toBe('mythic')
  })
  it('falls as more people crowd the land', () => {
    // 30d hold = mythic solo, but each 4 extra occupants drops a tier.
    expect(artifactTierFor(30, 1)).toBe('mythic')
    expect(artifactTierFor(30, 5)).toBe('legendary')
    expect(artifactTierFor(30, 9)).toBe('epic')
  })
  it('never drops below common', () => {
    expect(artifactTierFor(0, 40)).toBe('common')
  })
})

describe('captureMargin (clan size matters)', () => {
  it('is the base margin for tiny/even clans', () => {
    expect(captureMargin(1, 1)).toBe(VACATE_MARGIN)
    expect(captureMargin(5, 5)).toBe(VACATE_MARGIN)
  })
  it('rises with a bigger defender — a mega-clan is hard to dislodge', () => {
    expect(captureMargin(100, 20)).toBeGreaterThan(captureMargin(20, 20))
    // 100-person defender needs far more than a couple of wins.
    expect(captureMargin(100, 1)).toBeGreaterThanOrEqual(20)
  })
  it('a bigger attacker gets a modest edge', () => {
    expect(captureMargin(50, 100)).toBeLessThan(captureMargin(50, 1))
  })
  it('never below the base or above the ceiling', () => {
    expect(captureMargin(1, 999)).toBe(VACATE_MARGIN)
    expect(captureMargin(9999, 1)).toBe(MAX_CAPTURE_MARGIN)
  })
})

describe('dominanceCapture (video-verified balance, no agreement)', () => {
  it('needs a winning majority AND the size-weighted net — not one lucky win', () => {
    expect(dominanceCapture({ winsFor: 1, winsAgainst: 0, defenderSize: 1, attackerSize: 1 }).captured).toBe(false)
    // 3-0 over an even, tiny matchup clears it.
    expect(dominanceCapture({ winsFor: 3, winsAgainst: 0, defenderSize: 1, attackerSize: 1 }).captured).toBe(true)
  })
  it('a 100-clan pushes a 20-clan out only with sustained ~80% dominance', () => {
    const need = captureMargin(20, 100) // small margin — attacker is huge
    // A clear majority over enough battles pushes the small clan out.
    const big = dominanceCapture({ winsFor: 40, winsAgainst: 8, defenderSize: 20, attackerSize: 100 })
    expect(big.rate).toBeGreaterThan(0.8)
    expect(big.captured).toBe(true)
    expect(need).toBeLessThanOrEqual(big.net)
  })
  it('a near-even record never takes land (losses pull the net down)', () => {
    expect(dominanceCapture({ winsFor: 26, winsAgainst: 24, defenderSize: 20, attackerSize: 20 }).captured).toBe(false)
  })
  it('taking a mega-clan needs a huge sustained net', () => {
    const r = dominanceCapture({ winsFor: 10, winsAgainst: 1, defenderSize: 100, attackerSize: 20 })
    expect(r.captured).toBe(false) // 9 net isn't enough vs a 100-clan
    expect(r.need).toBeGreaterThanOrEqual(15)
  })
})

describe('holdDays', () => {
  it('counts whole days since claim', () => {
    const now = Date.parse('2026-07-20T00:00:00Z')
    expect(holdDays('2026-07-13T00:00:00Z', now)).toBe(7)
    expect(holdDays(null, now)).toBe(0)
  })
})

describe('rivalry → vacate', () => {
  it('forces a vacate once a rival wins by the margin', () => {
    expect(shouldVacate(VACATE_MARGIN)).toBe(true)
    expect(shouldVacate(VACATE_MARGIN - 1)).toBe(false)
  })
  it('applyBattle accrues the challenger margin and flags capture', () => {
    let r = { margin: 0, meetings: 0 }
    let captured = false
    for (let i = 0; i < VACATE_MARGIN; i++) {
      const res = applyBattle(r, 'challenger')
      r = res.rivalry
      captured = res.captured
    }
    expect(r.margin).toBe(VACATE_MARGIN)
    expect(r.meetings).toBe(VACATE_MARGIN)
    expect(captured).toBe(true)
  })
  it('holder wins pull the margin back down', () => {
    const res = applyBattle({ margin: 2, meetings: 5 }, 'holder')
    expect(res.rivalry.margin).toBe(1)
    expect(res.captured).toBe(false)
  })
})
