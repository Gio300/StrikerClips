/**
 * Pure entitlement resolution — no React, no Supabase imports — so it can be
 * unit-tested in isolation and reused by the `useEntitlements` hook.
 *
 * A paid tier lives on `user.user_metadata`:
 *   • `reelone_tier`          — current brand key ('' | 'ad_free' | 'pro' | 'supporter' | 'creator')
 *   • `clutchlens_tier`       — legacy key kept so pre-rebrand grants still count
 *   • `reelone_tier_expires`  — ISO date; once it passes, the tier lapses
 *
 * A redeem code (see the redeem-code edge function / Express /fn/redeem-code)
 * writes `reelone_tier` + `reelone_tier_expires` onto the user record, which is
 * exactly what this reads back — so a redeemed grant persists across reloads.
 */

export interface Entitlements {
  isPremium: boolean
  tier: string
  tierExpiresAt: string | null
}

export interface EntitlementOpts {
  /** Founder / reviewer bypass — grants the highest tier. */
  founder?: boolean
  /** VITE_DEV_PREMIUM dev flag — mocks a paid account. */
  devPremium?: boolean
  /** Injectable clock for tests; defaults to `Date.now()`. */
  now?: number
}

type MaybeUser = { user_metadata?: Record<string, unknown> | null } | null | undefined

/** Resolve a user's paid entitlement from their metadata. */
export function entitlementsFromUser(user: MaybeUser, opts: EntitlementOpts = {}): Entitlements {
  const { founder = false, devPremium = false, now = Date.now() } = opts
  const md = (user?.user_metadata ?? undefined) as Record<string, unknown> | undefined

  const reeloneTier = typeof md?.reelone_tier === 'string' ? md.reelone_tier : ''
  const legacyTier = typeof md?.clutchlens_tier === 'string' ? md.clutchlens_tier : ''

  // A grant can carry an expiry. Once it passes, the tier no longer counts.
  // Codeless legacy tiers (no expiry) never lapse. An unparseable date is
  // treated as "not expired" so a bad value never silently revokes access.
  const expiresRaw = typeof md?.reelone_tier_expires === 'string' ? md.reelone_tier_expires : ''
  const expiresAt = expiresRaw ? new Date(expiresRaw).getTime() : NaN
  const expired = Number.isFinite(expiresAt) ? expiresAt < now : false

  const rawTier = expired ? '' : (reeloneTier || legacyTier)

  // Founder bypass wins over everything: highest tier + premium.
  const tier = founder ? 'creator' : rawTier
  // `ad_free` grants NO streaming perks, so it stays out of isPremium.
  const isPremium =
    founder || devPremium || tier === 'pro' || tier === 'supporter' || tier === 'creator'

  return {
    isPremium,
    tier: tier || (devPremium ? 'pro' : ''),
    // Don't advertise a stale expiry once the grant has lapsed.
    tierExpiresAt: expired ? null : (expiresRaw || null),
  }
}

/**
 * True when a resolved entitlement carries ANY paid tier (free / '' excluded).
 *
 * Deliberately broader than `isPremium`: the low `ad_free` tier grants no
 * streaming perks (so it's absent from `isPremium`) but IS a paid subscription,
 * so it counts here. Founder / dev-premium resolve to a paid `tier` string, so
 * they count too.
 */
export function hasPaidTier(ent: Pick<Entitlements, 'tier'>): boolean {
  const t = ent.tier ?? ''
  return t !== '' && t !== 'free'
}

/** The paid CONTENT tiers — "Basic and up". */
export const CONTENT_TIERS = ['pro', 'supporter', 'creator'] as const

/**
 * True when a resolved entitlement carries a paid CONTENT tier
 * (pro/supporter/creator).
 *
 * NARROWER than `hasPaidTier`: the ad-only `ad_free` tier IS a paid
 * subscription (so `hasPaidTier` counts it) but grants NO content pipeline, so
 * it does NOT count here. This is the threshold the cross-user auto-merge /
 * auto-build pipeline requires — mirror of the server's `paidContentTier`
 * (server/app.ts). `hasPaidTier` is left untouched for features that gate on
 * "any paid subscription" (e.g. no-ads).
 */
export function hasContentTier(ent: Pick<Entitlements, 'tier'>): boolean {
  return (CONTENT_TIERS as readonly string[]).includes(ent.tier ?? '')
}

/**
 * AUTO-MERGE unlock — the entitlement that lets a member's uploaded clips be
 * auto-matched + merged with OTHER users' clips of the same match.
 *
 * Gated on BOTH:
 *   (a) the user has connected their YouTube account, AND
 *   (b) the user holds an active paid CONTENT tier (pro/supporter/creator — see
 *       `hasContentTier`; free AND the ad-only `ad_free` tier never qualify).
 *
 * Posting your OWN single match is never gated by this — only the cross-user
 * auto-merge pipeline is. Mirror of the server gate in server/app.ts
 * (`isAutoMergeEntitled`).
 */
export function autoMergeEnabled(input: {
  youtubeConnected: boolean
  entitlements: Pick<Entitlements, 'tier'>
}): boolean {
  return input.youtubeConnected === true && hasContentTier(input.entitlements)
}
