import { Link } from 'react-router-dom'
import { topBadge, type Badge, type BadgeMeta } from '@/lib/badges'

/**
 * BadgeChip — renders a single prestige badge as a small pill.
 *
 * `compact` shows just the emoji (with a title tooltip) so it fits inline in a
 * dense chat line; the default shows emoji + label. Colors come from the
 * badge's own tier class in the catalog.
 */
export function BadgeChip({
  badge,
  compact = false,
  className = '',
}: {
  badge: Badge
  compact?: boolean
  className?: string
}) {
  if (compact) {
    return (
      <span
        title={badge.title}
        aria-label={badge.label}
        className={`inline-flex items-center align-middle text-[0.9em] leading-none ${className}`}
      >
        {badge.emoji}
      </span>
    )
  }

  return (
    <span
      title={badge.title}
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide align-middle ${badge.colorClass} ${className}`}
    >
      <span aria-hidden>{badge.emoji}</span>
      <span>{badge.label}</span>
    </span>
  )
}

/**
 * UserTag — a reusable inline identity tag for chat lines:
 *
 *     [top badge emoji] username [·PL power]
 *
 * The badge (highest-prestige the user holds) is shown compactly before the
 * name; when the user has no badges — the default today — it's simply omitted.
 * Pass `to` to make the username a profile link. Everything after the name is
 * optional and degrades gracefully.
 */
export function UserTag({
  username,
  meta,
  powerLevel,
  to,
  nameClassName = 'text-accent font-semibold hover:underline',
  className = '',
}: {
  username?: string | null
  meta?: BadgeMeta
  powerLevel?: number | null
  to?: string
  nameClassName?: string
  className?: string
}) {
  const badge = topBadge(meta)
  const name = username ?? 'someone'
  const showPower = typeof powerLevel === 'number' && powerLevel > 0

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {badge && <BadgeChip badge={badge} compact />}
      {to ? (
        <Link to={to} className={nameClassName}>
          {name}
        </Link>
      ) : (
        <span className={nameClassName}>{name}</span>
      )}
      {showPower && (
        <span className="text-gray-500 font-normal text-[0.9em]">· PL {powerLevel!.toLocaleString()}</span>
      )}
    </span>
  )
}

export default BadgeChip
