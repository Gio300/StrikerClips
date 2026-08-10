import { describe, expect, it } from 'vitest'
import {
  activeAutoReelTier,
  autoReelPolicyForParticipants,
  autoReelPolicyForTier,
} from './autoReelPolicy'

describe('auto reel membership policy', () => {
  it('keeps Free and Ad-Free on manual creation', () => {
    expect(autoReelPolicyForTier('').automatic).toBe(false)
    expect(autoReelPolicyForTier('ad_free').profile).toBe('manual_only')
  })

  it('gives Pro a cheap short-form vertical cut', () => {
    expect(autoReelPolicyForTier('pro')).toMatchObject({
      profile: 'quick_vertical',
      orientation: 'vertical',
      maxDurationSeconds: 24,
      maxAngles: 1,
      reactionCount: 1,
    })
  })

  it('gives Elite a richer short and reserves Coach Dee for Legend', () => {
    expect(autoReelPolicyForTier('supporter')).toMatchObject({
      profile: 'enhanced_vertical',
      maxDurationSeconds: 42,
      maxAngles: 2,
      reactionCount: 2,
    })
    expect(autoReelPolicyForTier('creator')).toMatchObject({
      profile: 'coach_dee_full',
      orientation: 'landscape',
      maxDurationSeconds: null,
      reactionCount: 3,
      commentary: 'coach_dee',
    })
  })

  it('fails closed when a membership expired', () => {
    const now = Date.parse('2026-07-31T12:00:00Z')
    expect(activeAutoReelTier({
      reelone_tier: 'creator',
      reelone_tier_expires: '2026-07-30T12:00:00Z',
    }, now)).toBe('')
  })

  it('uses the highest active plan represented in a shared match', () => {
    const policy = autoReelPolicyForParticipants([
      { reelone_tier: 'pro' },
      { reelone_tier: 'creator' },
      { reelone_tier: '' },
    ])
    expect(policy.profile).toBe('coach_dee_full')
  })
})
