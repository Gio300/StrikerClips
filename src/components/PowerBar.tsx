import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import { Zap } from 'lucide-react'
import { topBadge, type BadgeMeta } from '@/lib/badges'
import { BadgeChip } from '@/components/BadgeChip'
import NotificationBell from '@/components/NotificationBell'

/**
 * PowerBar — a sticky top bar that always shows the signed-in user's power
 * level as a big, obvious score. Mounted once in Layout.tsx above every page.
 * Power level comes off the `profile` row useAuth already fetches.
 */
// Rank titles keyed off the power score. These are deliberately DISTINCT from
// the membership-tier names (Pro / Elite / Legend) so the earned rank never
// gets confused with a paid tier. Climbs as the number climbs.
function rankTitle(power: number): string {
  if (power >= 250_000) return 'Grandmaster'
  if (power >= 100_000) return 'Master'
  if (power >= 25_000) return 'Pro-Am'
  if (power >= 5_000) return 'Challenger'
  if (power >= 1_000) return 'Contender'
  if (power >= 100) return 'Rookie'
  return 'Unranked'
}

/** Membership-tier key → user-facing badge label. Free shows no badge. */
const TIER_BADGE: Record<string, string> = {
  pro: 'Pro',
  supporter: 'Elite',
  creator: 'Legend',
}

export function PowerBar() {
  const { user, profile } = useAuth()
  // Use the entitlement tier (applies legacy fallback + expiry) rather than the
  // raw metadata, so the badge matches what the user can actually use.
  const { tier } = useEntitlements()
  if (!user) return null

  const powerLevel = (profile?.power_level ?? 0) as number
  const rank = rankTitle(powerLevel)
  const tierLabel = TIER_BADGE[tier]
  const showTier = Boolean(tierLabel)
  // The signed-in giver's highest-prestige badge, so their standing rides along
  // with their power level everywhere. `null` (no badges) today for everyone.
  const badge = topBadge(user.user_metadata as BadgeMeta)

  return (
    <div className="sticky top-0 z-40 flex min-h-14 items-center justify-between gap-3 border-b border-dark-border bg-dark/95 px-3 backdrop-blur-sm sm:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-chakra/10 text-chakra">
          <Zap size={17} fill="currentColor" />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="text-[10px] font-semibold uppercase text-gray-500">Power level</div>
          <div className="truncate text-lg font-bold tabular-nums text-white sm:text-xl">{powerLevel.toLocaleString()}</div>
        </div>
      </div>
      <div className="flex min-w-0 shrink items-center gap-2 text-right">
        {badge && <BadgeChip badge={badge} compact />}
        <div className="leading-tight">
          <div className="max-w-28 truncate text-xs font-semibold text-white sm:text-sm">{rank}</div>
          <div className="hidden text-[10px] text-gray-500 sm:block">earned rank</div>
        </div>
        {showTier && (
          <span className="rounded-md border border-kunai/40 bg-kunai/10 px-2 py-0.5 text-[10px] font-bold uppercase text-kunai">
            {tierLabel}
          </span>
        )}
        <NotificationBell />
      </div>
    </div>
  )
}
