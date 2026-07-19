import { useAuth } from '@/hooks/useAuth'

/**
 * Pro / supporter tier. Wire to Supabase `user.user_metadata` or Stripe later.
 * Dev: set `VITE_DEV_PREMIUM=1` in `.env.local` to mock a paid account.
 */
export function useEntitlements() {
  const { user } = useAuth()
  const devPremium = import.meta.env.VITE_DEV_PREMIUM === '1'
  const md = user?.user_metadata as Record<string, unknown> | undefined
  // Read both `reelone_tier` (current) and `clutchlens_tier` (legacy) so users
  // upgraded under the old brand keep their entitlement after the rebrand.
  const reeloneTier = typeof md?.reelone_tier === 'string' ? md.reelone_tier : ''
  const legacyTier = typeof md?.clutchlens_tier === 'string' ? md.clutchlens_tier : ''
  // A grant (e.g. from a redeem code) can carry an expiry. Once it passes,
  // the tier no longer counts. Codeless legacy tiers (no expiry) never lapse.
  const expiresRaw = typeof md?.reelone_tier_expires === 'string' ? md.reelone_tier_expires : ''
  const expired = expiresRaw ? new Date(expiresRaw) < new Date() : false
  const tier = expired ? '' : (reeloneTier || legacyTier)
  const isPremium = devPremium || tier === 'pro' || tier === 'supporter' || tier === 'creator'

  return {
    isPremium,
    tier: tier || (devPremium ? 'pro' : ''),
    tierExpiresAt: expiresRaw || null,
  }
}
