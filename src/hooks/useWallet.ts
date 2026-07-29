import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import {
  readWallet,
  loadWallet,
  claimDailySweeps,
  subscribeWallet,
  type Wallet,
} from '@/lib/wallet'

/**
 * Live view of the signed-in user's wallet.
 *
 * Balances come from the `wallets` table and are hydrated on mount / on user
 * change; the hook then follows the wallet event bus so every mounted surface
 * (balance chip, store header, shop grid) stays in sync after any server call
 * that moves a balance.
 *
 * There is deliberately NO `addTokens` / `addSweeps` here any more. Crediting a
 * wallet from the client is exactly the thing the migration removed: a balance
 * can only change through a trusted server handler (a purchase, the free daily
 * grant, a clan fee), and this hook reflects the result. `claimDaily` is the one
 * credit a user can initiate, and even it is guarded and applied server-side.
 */
export function useWallet(): Wallet & {
  /** Re-read the authoritative balances from the server. */
  refresh: () => Promise<void>
  /** Claim the free daily Sweeps points. Resolves false if already claimed. */
  claimDaily: () => Promise<boolean>
} {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const [wallet, setWallet] = useState<Wallet>(() => readWallet(userId))

  useEffect(() => {
    setWallet(readWallet(userId))
    const unsub = subscribeWallet(() => setWallet(readWallet(userId)))
    if (userId) void loadWallet(userId)
    return unsub
  }, [userId])

  const refresh = useCallback(async () => {
    if (!userId) return
    setWallet(await loadWallet(userId))
  }, [userId])

  const claimDaily = useCallback(async () => {
    if (!userId) return false
    const res = await claimDailySweeps(userId)
    setWallet(res.wallet)
    return res.ok
  }, [userId])

  return {
    tokens: wallet.tokens,
    sweeps: wallet.sweeps,
    paid_sweeps_cents: wallet.paid_sweeps_cents,
    refresh,
    claimDaily,
  }
}
