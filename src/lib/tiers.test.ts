import { describe, it, expect } from 'vitest'
import { canUse, isFree, proFeatures, artUploadLimit, canUploadArt, ART_UPLOAD_LIMIT } from './tiers'

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

describe('art upload limits', () => {
  it('caps free (and ad_free) at a small number', () => {
    expect(artUploadLimit('')).toBe(ART_UPLOAD_LIMIT[''])
    expect(artUploadLimit('free')).toBe(ART_UPLOAD_LIMIT['']) // literal 'free' falls back
    expect(artUploadLimit('ad_free')).toBe(ART_UPLOAD_LIMIT.ad_free)
    expect(artUploadLimit('')).toBeLessThan(artUploadLimit('pro'))
  })

  it('raises the cap on higher tiers, unlimited on Legend (creator)', () => {
    expect(artUploadLimit('pro')).toBeGreaterThan(artUploadLimit(''))
    expect(artUploadLimit('supporter')).toBeGreaterThan(artUploadLimit('pro'))
    expect(artUploadLimit('creator')).toBe(Infinity)
  })

  it('canUploadArt enforces the per-tier cap', () => {
    const freeCap = artUploadLimit('')
    expect(canUploadArt(freeCap - 1, '')).toBe(true)
    expect(canUploadArt(freeCap, '')).toBe(false) // at the cap → blocked
    expect(canUploadArt(freeCap + 5, '')).toBe(false)
  })

  it('is never blocked on the unlimited top tier', () => {
    expect(canUploadArt(0, 'creator')).toBe(true)
    expect(canUploadArt(10_000, 'creator')).toBe(true)
  })

  it('unknown / null tiers fall back to the free cap', () => {
    expect(artUploadLimit(null)).toBe(ART_UPLOAD_LIMIT[''])
    expect(artUploadLimit('mystery')).toBe(ART_UPLOAD_LIMIT[''])
  })
})
