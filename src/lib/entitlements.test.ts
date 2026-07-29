import { describe, it, expect } from 'vitest'
import { entitlementsFromUser, hasPaidTier, hasContentTier, autoMergeEnabled } from './entitlements'

const userWith = (md: Record<string, unknown>) => ({ user_metadata: md })
const HOUR = 3600 * 1000

describe('entitlementsFromUser', () => {
  it('free user with no tier is not premium', () => {
    const e = entitlementsFromUser(userWith({ reelone_tier: '' }))
    expect(e.isPremium).toBe(false)
    expect(e.tier).toBe('')
    expect(e.tierExpiresAt).toBeNull()
  })

  it('null / missing user is not premium', () => {
    expect(entitlementsFromUser(null).isPremium).toBe(false)
    expect(entitlementsFromUser(undefined).isPremium).toBe(false)
  })

  it('a redeemed pro grant with a future expiry reads premium', () => {
    const expires = new Date(Date.now() + 30 * 24 * HOUR).toISOString()
    const e = entitlementsFromUser(userWith({ reelone_tier: 'pro', reelone_tier_expires: expires }))
    expect(e.isPremium).toBe(true)
    expect(e.tier).toBe('pro')
    expect(e.tierExpiresAt).toBe(expires)
  })

  it('an EXPIRED grant reads as NOT premium and drops the stale expiry', () => {
    const expires = new Date(Date.now() - HOUR).toISOString()
    const e = entitlementsFromUser(userWith({ reelone_tier: 'pro', reelone_tier_expires: expires }))
    expect(e.isPremium).toBe(false)
    expect(e.tier).toBe('')
    expect(e.tierExpiresAt).toBeNull()
  })

  it('honors an injected clock for expiry', () => {
    const expires = new Date(1_000_000).toISOString()
    expect(entitlementsFromUser(userWith({ reelone_tier: 'pro', reelone_tier_expires: expires }), { now: 500_000 }).isPremium).toBe(true)
    expect(entitlementsFromUser(userWith({ reelone_tier: 'pro', reelone_tier_expires: expires }), { now: 2_000_000 }).isPremium).toBe(false)
  })

  it('legacy clutchlens_tier (no expiry) still grants premium', () => {
    const e = entitlementsFromUser(userWith({ clutchlens_tier: 'supporter' }))
    expect(e.isPremium).toBe(true)
    expect(e.tier).toBe('supporter')
  })

  it('ad_free is NOT premium (no streaming perks)', () => {
    const e = entitlementsFromUser(userWith({ reelone_tier: 'ad_free' }))
    expect(e.isPremium).toBe(false)
    expect(e.tier).toBe('ad_free')
  })

  it('founder + devPremium bypasses win', () => {
    expect(entitlementsFromUser(null, { founder: true }).isPremium).toBe(true)
    expect(entitlementsFromUser(null, { founder: true }).tier).toBe('creator')
    expect(entitlementsFromUser(null, { devPremium: true }).isPremium).toBe(true)
  })

  it('an unparseable expiry does not silently revoke the tier', () => {
    const e = entitlementsFromUser(userWith({ reelone_tier: 'pro', reelone_tier_expires: 'not-a-date' }))
    expect(e.isPremium).toBe(true)
  })
})

describe('hasPaidTier', () => {
  it('free / empty tier is not paid', () => {
    expect(hasPaidTier({ tier: '' })).toBe(false)
    expect(hasPaidTier({ tier: 'free' })).toBe(false)
  })

  it('any streaming tier is paid', () => {
    expect(hasPaidTier({ tier: 'pro' })).toBe(true)
    expect(hasPaidTier({ tier: 'supporter' })).toBe(true)
    expect(hasPaidTier({ tier: 'creator' })).toBe(true)
  })

  it('the ad_free tier counts as a paid subscription', () => {
    expect(hasPaidTier({ tier: 'ad_free' })).toBe(true)
  })
})

describe('hasContentTier', () => {
  it('free / empty tier is not a content tier', () => {
    expect(hasContentTier({ tier: '' })).toBe(false)
    expect(hasContentTier({ tier: 'free' })).toBe(false)
  })

  it('the ad-only ad_free tier is NOT a content tier', () => {
    expect(hasContentTier({ tier: 'ad_free' })).toBe(false)
  })

  it('pro / supporter / creator ARE content tiers', () => {
    expect(hasContentTier({ tier: 'pro' })).toBe(true)
    expect(hasContentTier({ tier: 'supporter' })).toBe(true)
    expect(hasContentTier({ tier: 'creator' })).toBe(true)
  })
})

describe('autoMergeEnabled', () => {
  const paid = { tier: 'pro' }
  const free = { tier: '' }

  it('unlocks only when YouTube is connected AND a paid CONTENT tier is held', () => {
    expect(autoMergeEnabled({ youtubeConnected: true, entitlements: paid })).toBe(true)
  })

  it('is blocked for a free tier even with YouTube connected', () => {
    expect(autoMergeEnabled({ youtubeConnected: true, entitlements: free })).toBe(false)
  })

  it('is blocked when YouTube is NOT connected even on a paid tier', () => {
    expect(autoMergeEnabled({ youtubeConnected: false, entitlements: paid })).toBe(false)
  })

  it('is blocked when neither condition is met', () => {
    expect(autoMergeEnabled({ youtubeConnected: false, entitlements: free })).toBe(false)
  })

  it('is BLOCKED for an ad_free subscriber even with YouTube connected (not a content tier)', () => {
    expect(autoMergeEnabled({ youtubeConnected: true, entitlements: { tier: 'ad_free' } })).toBe(false)
  })

  it('unlocks for supporter / creator content tiers with YouTube connected', () => {
    expect(autoMergeEnabled({ youtubeConnected: true, entitlements: { tier: 'supporter' } })).toBe(true)
    expect(autoMergeEnabled({ youtubeConnected: true, entitlements: { tier: 'creator' } })).toBe(true)
  })
})
