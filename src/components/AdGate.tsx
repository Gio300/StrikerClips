import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useEntitlements } from '@/hooks/useEntitlements'
import { hidesAds } from '@/lib/tiers'
import { AdSlot } from '@/components/AdSlot'
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'

type AdGateProps = {
  /** Content revealed once the free user dismisses the house ad. */
  children: ReactNode
  /** Logical ad slot id (looked up in adConfig, else a house ad). */
  slotId?: string
  /** Short line describing what's behind the gate (e.g. "comments"). */
  label?: string
  className?: string
}

/**
 * Interstitial house ad shown to FREE users before some content (e.g. a reel's
 * comments / chat). It is NOT timed — the user can click "Continue" or "✕"
 * immediately; the point is only that they see an ad first, then the content is
 * revealed in place.
 *
 * Paid users — anyone where hidesAds(tier) is true (ad_free / pro / supporter /
 * creator / founder) — skip the gate entirely and see the content directly.
 */
export function AdGate({ children, slotId = 'feed-inline', label, className = '' }: AdGateProps) {
  const { tier } = useEntitlements()
  // Paid (or founder) users never see the gate.
  const [dismissed, setDismissed] = useState(() => hidesAds(tier))

  if (dismissed) return <>{children}</>

  return (
    <div className={`rounded-xl border border-dark-border bg-dark-card p-4 space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">
          {label ? `A quick word before ${label}` : 'A quick word from our sponsor'}
        </h2>
        <button
          type="button"
          aria-label="Close ad"
          onClick={() => setDismissed(true)}
          className="text-gray-500 hover:text-white text-sm px-2 py-1 rounded"
        >
          ✕ close
        </button>
      </div>

      <AdSlot slotId={slotId} shape="square" className="w-full" />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        {!IS_MOBILE_STORE_BUILD && (
          <Link to="/upgrade" className="text-xs text-accent hover:underline">
            Go Ad-Free for $1.99/mo
          </Link>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="px-4 py-2 rounded-lg bg-accent text-dark text-sm font-semibold hover:shadow-glow"
        >
          Continue
        </button>
      </div>
    </div>
  )
}

/**
 * Site-level house-ad slot that only renders for free users (hidesAds(tier) is
 * false). Paid users get nothing. Drop it anywhere a lightweight banner fits.
 */
export function FreeUserAdSlot({
  slotId = 'feed-inline',
  dismissable = false,
  className = '',
}: {
  slotId?: string
  dismissable?: boolean
  className?: string
}) {
  const { tier } = useEntitlements()
  if (hidesAds(tier)) return null
  return <AdSlot slotId={slotId} shape="banner" dismissable={dismissable} className={className} />
}
