import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAdsHidden } from '@/hooks/useAdsHidden'
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
 * Anyone entitled to ad-free — a paid MEMBER tier (ad_free / pro / supporter /
 * creator / founder) OR a member of a league on a plan carrying `member_ad_free`
 * — skips the gate entirely and sees the content directly (useAdsHidden()).
 *
 * While the league half of that answer is still in flight the gate holds a thin
 * placeholder rather than rendering: showing the interstitial first and hiding
 * it a moment later would flash an ad at someone who paid not to see one, and
 * showing the content first and THEN dropping an interstitial over it would
 * interrupt someone mid-read.
 */
export function AdGate({ children, slotId = 'feed-inline', label, className = '' }: AdGateProps) {
  const { adsHidden, resolved } = useAdsHidden()
  const [closed, setClosed] = useState(false)
  const dismissed = closed || adsHidden
  const setDismissed = setClosed

  if (!resolved) return <div className={`h-24 rounded-xl bg-dark-card/40 ${className}`} aria-hidden />
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
        {/* Prices live in ONE place (src/pages/Upgrade.tsx) and the $1.99
            Ad-Free rung was retired, so this pitches the destination, not a
            figure. A CTA quoting a dead price is how the last one drifted. */}
        {!IS_MOBILE_STORE_BUILD && (
          <Link to="/upgrade" className="text-xs text-accent hover:underline">
            Go ad-free with Pro
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
 * Site-level house-ad slot that only renders for free users. Kept as a thin
 * wrapper for the existing call sites; AdSlot self-gates on the same
 * useAdsHidden() answer, so this is belt-and-braces rather than the gate.
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
  const { adsHidden, resolved } = useAdsHidden()
  if (!resolved || adsHidden) return null
  return <AdSlot slotId={slotId} shape="banner" dismissable={dismissable} className={className} />
}
