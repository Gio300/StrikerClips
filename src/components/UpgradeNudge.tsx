import { Link } from 'react-router-dom'
import { useEntitlements } from '@/hooks/useEntitlements'

type UpgradeNudgeProps = {
  /** Headline of the nudge. Defaults to a friendly generic. */
  title?: string
  /** One-line explanation of what upgrading unlocks. */
  message?: string
  /** CTA label on the button. */
  cta?: string
  /** Hide the nudge for users who already have a paid tier. Default true. */
  hideForPaid?: boolean
  className?: string
}

/**
 * UpgradeNudge — the small, on-brand "unlock this with a paid tier" prompt that
 * links straight to /upgrade. Drop it on any locked / gated surface so there's
 * always a one-tap path to the tier comparison.
 *
 *   <UpgradeNudge message="Multi-angle director cuts are a Pro perk." />
 *
 * By default it renders nothing for users who already pay (isPremium), so it
 * never nags a subscriber. Pass hideForPaid={false} to always show it (e.g. the
 * ad-free upsell, which even Pro-but-still-sees-ads accounts shouldn't need).
 */
export function UpgradeNudge({
  title = 'Unlock more with a membership',
  message,
  cta = 'Go Pro',
  hideForPaid = true,
  className = '',
}: UpgradeNudgeProps) {
  const { isPremium } = useEntitlements()
  if (hideForPaid && isPremium) return null

  return (
    <div
      className={`rounded-xl border border-chakra/40 bg-chakra/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${className}`}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white">{title}</div>
        {message && <div className="text-xs text-gray-400 mt-0.5">{message}</div>}
      </div>
      <Link
        to="/upgrade"
        className="shrink-0 inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-accent text-dark text-sm font-semibold hover:shadow-glow transition-shadow"
      >
        {cta}
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
        </svg>
      </Link>
    </div>
  )
}

export default UpgradeNudge
