import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  certifyCreatorTaxProfile,
  fetchCreatorFees,
  fetchConnectStatus,
  retryCreatorFees,
  startConnectOnboarding,
  type CreatorPlatformFee,
} from '@/lib/creatorCommerceApi'
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'

type ConnectStatus = NonNullable<Awaited<ReturnType<typeof fetchConnectStatus>>['data']>

/**
 * Stripe-hosted onboarding collects identity, bank, and tax information. TKO
 * stores only readiness flags and the user's electronic-delivery consent.
 */
export function CreatorPayoutsCard({
  paidTotalCents,
  pendingDonations,
}: {
  paidTotalCents: number
  pendingDonations: number
}) {
  const [status, setStatus] = useState<ConnectStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [taxFormType, setTaxFormType] = useState<'w9' | 'w8'>('w9')
  const [taxCertified, setTaxCertified] = useState(false)
  const [electronicConsent, setElectronicConsent] = useState(false)
  const [sellerFeeConsent, setSellerFeeConsent] = useState(false)
  const [fees, setFees] = useState<CreatorPlatformFee[]>([])

  const load = useCallback(async () => {
    if (IS_MOBILE_STORE_BUILD) {
      setLoading(false)
      return
    }
    setLoading(true)
    const [result, feeResult] = await Promise.all([
      fetchConnectStatus(),
      fetchCreatorFees(),
    ])
    if (result.ok) {
      setStatus(result.data)
      setError(null)
    } else {
      setError(result.error || 'Payout status is unavailable.')
    }
    if (feeResult.ok) setFees(feeResult.data?.fees ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function startOnboarding() {
    setBusy(true)
    setError(null)
    const result = await startConnectOnboarding()
    if (result.ok && result.data?.url) {
      window.location.href = result.data.url
      return
    }
    setError(result.error || 'Stripe onboarding could not start.')
    setBusy(false)
  }

  async function saveTaxConsent() {
    if (!taxCertified || !electronicConsent || !sellerFeeConsent) {
      setError('Confirm all seller payout statements to continue.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await certifyCreatorTaxProfile(taxFormType)
    if (!result.ok) {
      setError(result.error || 'Tax consent could not be saved.')
      setBusy(false)
      return
    }
    await load()
    setBusy(false)
  }

  async function retryFees() {
    setBusy(true)
    setError(null)
    const result = await retryCreatorFees()
    if (!result.ok) setError(result.error || 'Seller charges could not be retried.')
    await load()
    setBusy(false)
  }

  const connectReady = status?.transfers_enabled === true && status?.payouts_enabled === true
  const outstandingFees = fees
    .filter((fee) => fee.status === 'pending' || fee.status === 'failed')
    .reduce((sum, fee) => sum + Number(fee.seller_fee_cents || 0), 0)

  if (IS_MOBILE_STORE_BUILD) return null

  return (
    <section className="rounded-lg border border-accent/30 bg-dark-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-white">Creator payouts</h2>
          <p className="mt-1 text-sm text-gray-400">
            Pro keeps 50%, Elite keeps 65%, and Legend or Founder keeps 80% of eligible sales.
          </p>
        </div>
        <StatusPill loading={loading} status={status} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Metric label="Lifetime paid" value={`$${(paidTotalCents / 100).toFixed(2)}`} />
        <Metric label="Pending tips" value={String(pendingDonations)} />
      </div>

      {!loading && status?.seller_eligible === false && (
        <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-4">
          <p className="text-sm text-gray-200">Selling and Stripe payouts start with Pro.</p>
          <Link to="/upgrade" className="mt-3 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-semibold text-dark">
            View seller tiers
          </Link>
        </div>
      )}

      {!loading && status?.seller_eligible !== false && !connectReady && (
        <div className="mt-4">
          <p className="text-sm text-gray-300">
            Stripe securely collects your identity, payout bank, and W-9 or W-8 information.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={startOnboarding}
            className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-dark disabled:opacity-50"
          >
            {busy ? 'Opening Stripe...' : status?.connected ? 'Continue Stripe setup' : 'Connect Stripe'}
          </button>
        </div>
      )}

      {!loading && connectReady && !status?.ready && (
        <div className="mt-4 rounded-lg border border-chakra/30 bg-chakra/5 p-4">
          <h3 className="font-semibold text-white">Finish tax delivery setup</h3>
          <p className="mt-1 text-xs leading-5 text-gray-400">
            Complete your tax identity inside Stripe first. TKO never asks for or stores your SSN,
            EIN, or foreign tax ID.
          </p>
          <label className="mt-3 block text-xs font-semibold uppercase text-gray-400">
            Tax profile used in Stripe
            <select
              value={taxFormType}
              onChange={(event) => setTaxFormType(event.target.value as 'w9' | 'w8')}
              className="mt-1 block w-full rounded-md border border-dark-border bg-dark px-3 py-2 text-sm normal-case text-white"
            >
              <option value="w9">W-9 (US person or business)</option>
              <option value="w8">W-8 (non-US person or business)</option>
            </select>
          </label>
          <label className="mt-3 flex gap-3 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={taxCertified}
              onChange={(event) => setTaxCertified(event.target.checked)}
              className="mt-1 h-4 w-4 accent-accent"
            />
            <span>I certify that I completed and reviewed my tax identity information in Stripe.</span>
          </label>
          <label className="mt-3 flex gap-3 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={electronicConsent}
              onChange={(event) => setElectronicConsent(event.target.checked)}
              className="mt-1 h-4 w-4 accent-accent"
            />
            <span>I consent to electronic delivery of applicable tax forms, including Form 1099.</span>
          </label>
          <label className="mt-3 flex gap-3 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={sellerFeeConsent}
              onChange={(event) => setSellerFeeConsent(event.target.checked)}
              className="mt-1 h-4 w-4 accent-accent"
            />
            <span>
              I authorize TKO.cam to debit my Stripe account balance for disclosed seller costs,
              including payment processing, payouts, the active-account fee, and tax-form filing.
              These charges do not include my personal or business income taxes.
            </span>
          </label>
          <button
            type="button"
            disabled={busy || !taxCertified || !electronicConsent || !sellerFeeConsent}
            onClick={saveTaxConsent}
            className="mt-4 rounded-md bg-chakra px-4 py-2 text-sm font-semibold text-dark disabled:opacity-40"
          >
            {busy ? 'Saving...' : 'Enable seller payouts'}
          </button>
        </div>
      )}

      {!loading && status?.ready && (
        <div className="mt-4 text-sm text-leaf">
          <p>Payouts are active. Stripe handles your bank deposits and tax-form delivery.</p>
          <p className="mt-1 text-xs text-gray-400">
            Documented Stripe and tax-form filing costs are deducted from seller proceeds.
          </p>
        </div>
      )}

      {!loading && outstandingFees > 0 && (
        <div className="mt-4 rounded-lg border border-kunai/30 bg-kunai/5 p-4">
          <p className="text-sm font-semibold text-white">
            Seller charges due: ${(outstandingFees / 100).toFixed(2)}
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-400">
            These are documented external Stripe or tax-form filing costs. TKO will retry them
            against your connected-account balance without making that balance negative.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={retryFees}
            className="mt-3 rounded-md border border-kunai/50 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? 'Retrying...' : 'Retry seller charges'}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-kunai">{error}</p>}
    </section>
  )
}

function StatusPill({
  loading,
  status,
}: {
  loading: boolean
  status: ConnectStatus | null
}) {
  const label = loading
    ? 'Checking'
    : status?.ready
      ? `Active - ${status.seller_share_percent ?? 0}%`
      : status?.connected
        ? 'Setup needed'
        : 'Not connected'
  return (
    <span className="rounded-full border border-dark-border px-2.5 py-1 text-xs text-gray-300">
      {label}
    </span>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-dark-border bg-dark p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 font-mono text-lg text-white">{value}</p>
    </div>
  )
}
