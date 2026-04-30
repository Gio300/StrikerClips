import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { donationsEnabled } from '@/lib/featureFlags'
import type { CreatorStripeAccount } from '@/types/database'

/**
 * CreatorPayoutsCard — drops on /dashboard.
 *
 * Three states:
 *   1. Donations not enabled at deploy level (no `VITE_STRIPE_PUBLISHABLE_KEY`):
 *      explain politely; no buttons.
 *   2. Donations enabled, creator hasn't onboarded with Stripe Connect:
 *      "Connect Stripe" button hits the `stripe-connect-link` edge function
 *      and redirects to Stripe.
 *   3. Onboarded: show charges/payouts state + lifetime tip total.
 */
export function CreatorPayoutsCard({
  paidTotalCents,
  pendingDonations,
}: {
  paidTotalCents: number
  pendingDonations: number
}) {
  const { user } = useAuth()
  const [account, setAccount] = useState<CreatorStripeAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('creator_stripe_accounts')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle()
      if (cancelled) return
      setAccount((data ?? null) as CreatorStripeAccount | null)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [user])

  async function startOnboarding() {
    setBusy(true)
    setError(null)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('stripe-connect-link', {
        body: { return_url: window.location.href },
      })
      if (fnErr) throw fnErr
      const url = (data as { url?: string } | null)?.url
      if (!url) throw new Error('No onboarding URL returned')
      window.location.href = url
    } catch (e) {
      setError(humanize(e))
      setBusy(false)
    }
  }

  if (!donationsEnabled) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark-card p-5">
        <h2 className="font-semibold mb-1">Payouts</h2>
        <p className="text-sm text-gray-400">
          Donations are not enabled on this deploy yet. The dashboard, donations table, and tip-history
          UI are in place — when the operator sets <code className="text-accent">VITE_STRIPE_PUBLISHABLE_KEY</code>
          {' '}and the Stripe edge function secrets, this card will let you connect your bank for payouts.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-5">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-semibold">Payouts via Stripe</h2>
        {account?.charges_enabled && account.payouts_enabled ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-leaf/40 bg-leaf/10 text-leaf">
            Active
          </span>
        ) : account?.stripe_account_id ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-chakra/40 bg-chakra/10 text-chakra">
            Onboarding
          </span>
        ) : (
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-dark-border text-gray-400">
            Not connected
          </span>
        )}
      </div>
      <p className="text-sm text-gray-300 mb-3">
        Lifetime tips: <strong className="font-mono">${(paidTotalCents / 100).toFixed(2)}</strong>
        {pendingDonations > 0 && (
          <span className="text-gray-500 ml-2">
            ({pendingDonations} pending)
          </span>
        )}
      </p>

      {loading ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : !account?.charges_enabled ? (
        <button
          type="button"
          disabled={busy}
          onClick={startOnboarding}
          className="px-4 py-2 rounded-lg bg-accent text-dark text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Redirecting…' : account?.stripe_account_id ? 'Continue onboarding' : 'Connect Stripe'}
        </button>
      ) : (
        <p className="text-xs text-gray-500">
          You can receive tips. Stripe pays out on its standard schedule.
        </p>
      )}
      {error && <p className="text-kunai text-xs mt-2">{error}</p>}
    </div>
  )
}

function humanize(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('Function not found') || msg.includes('FUNCTION_INVOCATION_FAILED')) {
    return 'Stripe edge function not deployed yet. See docs/stripe-setup.md.'
  }
  return msg
}
