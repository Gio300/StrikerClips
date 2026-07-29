import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { NinjaIcon, type NinjaIconName } from './NinjaIcon'

/**
 * ActionCard — the button-first primitive. A big, tappable card with an icon (or
 * small art tile), a ONE-WORD label, an optional one-line sublabel, and clear
 * selected / locked states. Use it anywhere you'd otherwise stack text buttons
 * or a radio list: home launcher grids, mode pickers, placement choosers.
 *
 *   <ActionCard icon="shuriken" label="Create" sublabel="Turn plays into a reel" to="/highlight/create" />
 *   <ActionCard icon="torii" label="Front" locked lockTag="Legend" onClick={…} accent="blue" />
 *
 * Notes
 *   • Renders as a <Link> when `to` is set (and not locked), else a <button>.
 *   • `orientation="vertical"` centres the icon on top for grid tiles; the
 *     default horizontal lays the icon at the left for full-width rows.
 *   • Selected shows an orange (or blue, via `accent`) ring + gradient tile.
 *   • Locked dims the card, overlays a lock, and shows a small tier tag
 *     ("Elite" / "Legend") — the card stays visible so users see what's next.
 *   • Big tap target by design (min-height), phone-first, grid- and
 *     full-width-friendly.
 */

export type ActionCardAccent = 'orange' | 'blue'

export type ActionCardProps = {
  /** ONE-WORD (or very short) label — the main thing the user reads. */
  label: string
  /** Optional single line under the label. */
  sublabel?: ReactNode
  /** A named ninja/app glyph rendered in the tile. */
  icon?: NinjaIconName
  /** An emoji fallback if you don't have a glyph yet. */
  emoji?: string
  /** Fully custom art for the tile (image, svg…). Wins over icon/emoji. */
  art?: ReactNode
  /** Selected / active — draws the accent ring + gradient tile. */
  selected?: boolean
  /** Ring + tile accent colour. Default orange. */
  accent?: ActionCardAccent
  /** Locked/disabled — dims, blocks nav, shows a lock + tag. */
  locked?: boolean
  /** Small tag shown on a locked card, e.g. "Elite" / "Legend". */
  lockTag?: string
  /** Layout: horizontal (icon left) or vertical (icon on top, centred). */
  orientation?: 'horizontal' | 'vertical'
  /** Navigate here on tap (ignored when locked). */
  to?: string
  onClick?: () => void
  /** Optional right-aligned adornment (a chevron is added automatically). */
  trailing?: ReactNode
  /** Hide the auto trailing chevron (horizontal only). */
  hideChevron?: boolean
  className?: string
  'aria-label'?: string
}

const ACCENT = {
  orange: {
    ring: 'ring-chakra border-chakra/60',
    tileSel: 'bg-gradient-kunai text-dark',
    tileIdle: 'text-chakra',
    hover: 'hover:border-chakra/50',
    chevron: 'group-hover:text-chakra',
  },
  blue: {
    ring: 'ring-trust border-trust/60',
    tileSel: 'bg-trust text-white',
    tileIdle: 'text-trust',
    hover: 'hover:border-trust/50',
    chevron: 'group-hover:text-trust',
  },
} as const

function Tile({
  icon,
  emoji,
  art,
  selected,
  locked,
  accent,
  large,
}: {
  icon?: NinjaIconName
  emoji?: string
  art?: ReactNode
  selected: boolean
  locked: boolean
  accent: ActionCardAccent
  large: boolean
}) {
  const a = ACCENT[accent]
  const box = large ? 'w-16 h-16' : 'w-14 h-14'
  const iconSize = large ? 34 : 28
  return (
    <span
      className={`relative shrink-0 ${box} rounded-2xl flex items-center justify-center ${
        selected ? a.tileSel : `bg-dark-elevated border border-dark-border ${locked ? 'text-gray-500' : a.tileIdle}`
      }`}
      aria-hidden
    >
      {art ? (
        art
      ) : icon ? (
        <NinjaIcon name={icon} size={iconSize} />
      ) : emoji ? (
        <span className={large ? 'text-3xl' : 'text-2xl'}>{emoji}</span>
      ) : null}
      {locked && (
        <span className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-dark border border-dark-border flex items-center justify-center text-gray-300">
          <NinjaIcon name="lock" size={13} />
        </span>
      )}
    </span>
  )
}

export function ActionCard({
  label,
  sublabel,
  icon,
  emoji,
  art,
  selected = false,
  accent = 'orange',
  locked = false,
  lockTag,
  orientation = 'horizontal',
  to,
  onClick,
  trailing,
  hideChevron = false,
  className = '',
  'aria-label': ariaLabel,
}: ActionCardProps) {
  const a = ACCENT[accent]
  const vertical = orientation === 'vertical'

  const base =
    'group relative w-full rounded-2xl border text-left transition-all select-none ' +
    (vertical
      ? 'flex flex-col items-center text-center gap-3 px-4 py-5 min-h-[128px] justify-center'
      : 'flex items-center gap-4 px-4 py-4 min-h-[76px]')

  const state = locked
    ? 'border-dark-border bg-dark opacity-70 cursor-not-allowed'
    : selected
      ? `bg-dark-elevated ring-2 ${a.ring}`
      : `bg-dark-card border-dark-border ${a.hover} hover:bg-dark-elevated active:scale-[0.99]`

  const tile = (
    <Tile icon={icon} emoji={emoji} art={art} selected={selected && !locked} locked={locked} accent={accent} large={vertical} />
  )

  const body = (
    <span className={vertical ? 'min-w-0' : 'min-w-0 flex-1'}>
      <span className="flex items-center gap-2 justify-center sm:justify-start">
        <span className={`block font-semibold text-white leading-tight ${vertical ? 'text-base' : 'text-[15px]'}`}>
          {label}
        </span>
        {locked && lockTag && (
          <span className="inline-flex items-center gap-1 rounded-full bg-dark-elevated border border-chakra/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-chakra">
            <NinjaIcon name="lock" size={10} />
            {lockTag}
          </span>
        )}
      </span>
      {sublabel && (
        <span className={`block text-gray-400 mt-0.5 ${vertical ? 'text-xs' : 'text-xs'}`}>{sublabel}</span>
      )}
    </span>
  )

  const chevron =
    !vertical && !hideChevron ? (
      trailing ?? (
        <span className={`shrink-0 text-gray-600 ${locked ? '' : a.chevron} transition-colors`} aria-hidden>
          <NinjaIcon name={locked ? 'lock' : 'chevron-right'} size={20} />
        </span>
      )
    ) : (
      trailing ?? null
    )

  const inner = (
    <>
      {tile}
      {body}
      {chevron}
    </>
  )

  const cls = `${base} ${state} ${className}`

  if (to && !locked) {
    return (
      <Link to={to} onClick={onClick} className={cls} aria-label={ariaLabel ?? label}>
        {inner}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={locked ? undefined : onClick}
      aria-disabled={locked || undefined}
      aria-pressed={selected || undefined}
      className={cls}
      aria-label={ariaLabel ?? label}
    >
      {inner}
    </button>
  )
}

export default ActionCard
