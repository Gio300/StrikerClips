import { describe, it, expect } from 'vitest'
import { canUse, isFree, proFeatures } from './tiers'

describe('tiers', () => {
  it('free features are always usable', () => {
    for (const f of ['watch', 'basic_reel', 'clans_chat', 'browser', 'redeem'] as const) {
      expect(canUse(f, false)).toBe(true)
      expect(isFree(f)).toBe(true)
    }
  })

  it('pro features are gated for free users', () => {
    for (const f of ['multi_angle', 'voice_director', 'slow_mo', 'auto_publish', 'music_library', 'live_studio'] as const) {
      expect(canUse(f, false)).toBe(false)
      expect(canUse(f, true)).toBe(true)
      expect(isFree(f)).toBe(false)
    }
  })

  it('proFeatures lists only paid features with labels', () => {
    const pf = proFeatures()
    expect(pf.length).toBeGreaterThan(3)
    expect(pf.every((p) => !isFree(p.id) && p.label.length > 0)).toBe(true)
    expect(pf.find((p) => p.id === 'watch')).toBeUndefined()
    expect(pf.find((p) => p.id === 'voice_director')).toBeTruthy()
  })
})
