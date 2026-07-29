import { useAuth } from '@/hooks/useAuth'
import { isFounder } from '@/lib/founder'
import { entitlementsFromUser, type Entitlements } from '@/lib/entitlements'

/**
 * Pro / supporter tier, resolved from the signed-in user's `user_metadata`
 * (set by a redeem code or Stripe). Dev: `VITE_DEV_PREMIUM=1` mocks a paid
 * account; founder mode (splash passphrase) opens every paid gate.
 *
 * The actual resolution lives in `@/lib/entitlements` (pure, unit-tested). This
 * hook just feeds it the live user + the founder / dev flags. Because it reads
 * straight off `user.user_metadata`, a redeemed grant that was persisted to the
 * user record shows up here immediately after redeem AND after a fresh reload.
 */
export function useEntitlements(): Entitlements {
  const { user } = useAuth()
  const devPremium = import.meta.env.VITE_DEV_PREMIUM === '1'
  return entitlementsFromUser(user, { founder: isFounder(), devPremium })
}
