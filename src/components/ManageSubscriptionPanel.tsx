import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard, ExternalLink } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import {
  requestBillingPortal,
  fetchBillingSubscription,
  describeRenewal,
  tierLabel,
  BILLING_UNKNOWN,
  type BillingSubscription,
} from '@/lib/payments'
import { DIGITAL_CHECKOUT_ENABLED } from '@/lib/storeBuild'

/**
 * "Manage or cancel subscription" — the self-serve cancellation control.
 *
 * WHY THIS EXISTS. Until this shipped, a paid subscriber had no way to cancel
 * inside the app: the only in-app control ended a free TRIAL, and the Terms had
 * to honestly say paid cancellation was by email. The FTC negative-option rule
 * and the state auto-renewal statutes (CA ARL, NY GBL §527-a and friends)
 * require cancellation to be at least as easy as the signup that created the
 * obligation — and in practice a subscriber who cannot find "cancel" files a
 * chargeback instead, which costs more than the subscription ever earned.
 *
 * WHAT IT DOES. One button, which opens Stripe's hosted Customer Portal:
 * cancel, swap the card, download invoices. Stripe then fires
 * customer.subscription.updated / .deleted at our webhook, which lapses the
 * tier — so a cancel here really does end access rather than leaving the tier
 * granted forever.
 *
 * Rendered anywhere a user would go looking for it: the membership page
 * (/upgrade) and the account area of their own profile. The BUTTON SAYS
 * "cancel", deliberately — a control labelled only "manage" is the pattern
 * regulators call out.
 */

export function ManageSubscriptionPanel({
  className = '',
  returnTo = '/upgrade',
}: {
  className?: string
  /** In-app path Stripe returns to. Server-clamped to a same-site path. */
  returnTo?: string
}) {
  const { user } = useAuth()
  const { tier: entitledTier, tierExpiresAt } = useEntitlements()
  const [billing, setBilling] = useState<BillingSubscription>(BILLING_UNKNOWN)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!DIGITAL_CHECKOUT_ENABLED) {
      setLoading(false)
      return
    }
    if (!user) {
      setLoading(false)
      return
    }
    let alive = true
    void fetchBillingSubscription().then((data) => {
      if (!alive) return
      setBilling(data)
      setLoading(false)
    })
    return () => { alive = false }
  }, [user])

  if (!DIGITAL_CHECKOUT_ENABLED) return null
  if (!user) return null

  // Prefer the server's record; fall back to the locally-resolved entitlement so
  // the panel still names the plan while /billing/subscription is in flight.
  const tier = billing.tier || entitledTier || ''
  const renewal = describeRenewal({
    subscription: billing.subscription,
    tierExpiresAt: billing.tierExpiresAt || tierExpiresAt,
  })
  // Anyone with a Stripe customer gets the button, even if their tier has
  // already lapsed — they may still need to stop a subscription, fix a failed
  // card, or pull an invoice. Never hide the exit.
  const canManage = billing.hasBillingAccount

  async function openPortal() {
    setBusy(true)
    setNotice('')
    const result = await requestBillingPortal({ returnTo })
    if (result.ok) {
      window.location.href = result.url
      return
    }
    setNotice(result.message)
    setBusy(false)
  }

  return (
    <div className={`rounded-xl border border-dark-border bg-dark-card p-5 ${className}`}>
      <div className="flex items-start gap-3">
        <CreditCard size={18} className="mt-0.5 shrink-0 text-kunai" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-white">Your subscription</h2>

          <p className="mt-1 text-sm text-gray-400">
            <span className="font-semibold text-white">{tierLabel(tier)}</span>
            {renewal && <> · {renewal}</>}
          </p>

          {loading ? (
            <p className="mt-4 text-sm text-gray-500">Checking your billing account…</p>
          ) : canManage ? (
            <>
              <button
                type="button"
                onClick={openPortal}
                disabled={busy}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-kunai/60 px-4 py-2 text-sm font-semibold text-kunai hover:bg-kunai/10 disabled:opacity-50"
              >
                {busy ? 'Opening…' : 'Manage or cancel subscription'}
                {!busy && <ExternalLink size={14} />}
              </button>
              <p className="mt-2 text-xs text-gray-500">
                Opens your secure Stripe billing page, where you can cancel, change your payment
                method, or download invoices. Cancelling takes effect at the end of the period you
                have already paid for — no email and no phone call needed.
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm text-gray-500">
              You have no paid subscription on this account, so there is nothing to cancel.{' '}
              <Link to="/upgrade" className="text-accent hover:underline">See the tiers</Link>.
            </p>
          )}

          {notice && <p className="mt-3 text-sm text-chakra">{notice}</p>}
        </div>
      </div>
    </div>
  )
}
