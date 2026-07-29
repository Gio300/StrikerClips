import type { JSX } from 'react'

/**
 * NinjaIcon — an inline SVG icon set with ORIGINAL ninja-themed glyphs plus the
 * everyday app icons (home, camera, trophy, …). No third-party icon dep, no
 * copyrighted characters — just crisp, currentColor-driven line/solid art that a
 * button or nav item can drop in with `<NinjaIcon name="shuriken" />`.
 *
 *   • Colour follows `currentColor`, so `text-chakra` / `text-trust` on a parent
 *     tints the icon. Set it once on the button.
 *   • `size` (px) drives both width & height (default 24). `strokeWidth` tunes
 *     the line weight for the outline glyphs (default 1.8).
 *   • Solid glyphs (shuriken, flame, kunai blade…) paint with fill=currentColor;
 *     outline glyphs stroke with currentColor. Each glyph decides for itself, so
 *     the set reads consistently at nav size.
 */

export type NinjaIconName =
  // ninja-flavoured
  | 'shuriken'
  | 'kunai'
  | 'headband'
  | 'scroll'
  | 'flame'
  | 'torii'
  | 'sword'
  | 'clan'
  // app / navigation
  | 'home'
  | 'watch'
  | 'create'
  | 'play'
  | 'user'
  | 'more'
  | 'camera'
  | 'trophy'
  | 'chat'
  | 'search'
  | 'shop'
  | 'live'
  | 'bolt'
  | 'lock'
  | 'check'
  | 'plus'
  | 'chevron-right'
  | 'chevron-down'
  | 'ticket'
  | 'sparkle'

export type NinjaIconProps = {
  name: NinjaIconName
  /** px — sets width & height. Default 24. */
  size?: number
  /** Line weight for outline glyphs. Default 1.8. */
  strokeWidth?: number
  className?: string
  title?: string
}

/** The inner markup for each glyph. Solid glyphs fill; outline glyphs stroke. */
const GLYPHS: Record<NinjaIconName, (sw: number) => JSX.Element> = {
  // ── Ninja set ─────────────────────────────────────────────────────────────
  shuriken: () => (
    <>
      <path
        d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2z"
        fill="currentColor"
        stroke="none"
      />
      <circle cx="12" cy="12" r="2.1" fill="#0a0814" stroke="none" />
    </>
  ),
  kunai: (sw) => (
    <>
      <path d="M12 3l3 6-3 8-3-8 3-6z" fill="currentColor" stroke="none" />
      <path d="M12 17v3" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      <circle cx="12" cy="21" r="1.4" fill="none" stroke="currentColor" strokeWidth={sw} />
    </>
  ),
  headband: (sw) => (
    <>
      <path
        d="M2.5 9.5c6.5-2.5 12.5-2.5 19 0v3c-6.5 2.5-12.5 2.5-19 0v-3z"
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      <rect x="8.5" y="8.6" width="7" height="6.8" rx="1" fill="currentColor" stroke="none" />
      <path d="M20 12.5l2.5 5M4 12.5l-2.5 5" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
    </>
  ),
  scroll: (sw) => (
    <>
      <rect x="5" y="6" width="14" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth={sw} />
      <path d="M5 6a2 2 0 010 4M19 14a2 2 0 010 4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      <path d="M8.5 10h7M8.5 13h5" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
    </>
  ),
  flame: () => (
    <path
      d="M12 2c1.5 3 4 4.2 4 8a4 4 0 01-8 0c0-1.2.4-2 .9-2.7-.1 1.3.6 2.2 1.4 2.4-.6-1.8.3-3.8 1.7-5.7z"
      fill="currentColor"
      stroke="none"
    />
  ),
  torii: (sw) => (
    <>
      <path d="M3 6c6-1.6 12-1.6 18 0" stroke="currentColor" strokeWidth={sw + 0.4} strokeLinecap="round" />
      <path d="M4 9h16" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      <path d="M6.5 6.5V20M17.5 6.5V20" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
    </>
  ),
  sword: (sw) => (
    <>
      <path d="M20 4l-9 9" stroke="currentColor" strokeWidth={sw + 0.6} strokeLinecap="round" />
      <path d="M20 4l0 4-4-0" fill="currentColor" stroke="none" />
      <path d="M11 13l-2 2 2 2 2-2" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" fill="none" />
      <path d="M8 16l-4 4M6.5 14.5l3 3" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
    </>
  ),
  clan: (sw) => (
    <>
      <circle cx="8.5" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth={sw} />
      <circle cx="16.5" cy="9" r="2.3" fill="none" stroke="currentColor" strokeWidth={sw} />
      <path d="M3.5 19a5 5 0 0110 0M14 19a4.5 4.5 0 016.5-4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" fill="none" />
    </>
  ),

  // ── App / nav set ───────────────────────────────────────────────────────────
  home: (sw) => (
    <path
      d="M3 11.5 12 4l9 7.5M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  watch: (sw) => (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth={sw} />
      <path d="M16 10l4.5-2.3A1 1 0 0122 8.6v6.8a1 1 0 01-1.5.9L16 14" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
    </>
  ),
  create: (sw) => (
    <>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth={sw} />
      <path d="M12 8.2v7.6M8.2 12h7.6" stroke="currentColor" strokeWidth={sw + 0.3} strokeLinecap="round" />
    </>
  ),
  play: (sw) => (
    <>
      <rect x="4" y="7" width="16" height="10" rx="4" fill="none" stroke="currentColor" strokeWidth={sw} />
      <path d="M8 10v4M6 12h4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      <circle cx="16" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="17.6" cy="13.4" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  user: (sw) => (
    <path
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  more: () => (
    <>
      <circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
  camera: (sw) => (
    <>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" strokeWidth={sw} />
    </>
  ),
  trophy: (sw) => (
    <>
      <path d="M7 4h10v4a5 5 0 01-10 0V4z" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
      <path d="M7 5H4.5a2 2 0 002 4M17 5h2.5a2 2 0 01-2 4M12 13v4M9 20h6M10 17h4v3h-4z" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  chat: (sw) => (
    <path
      d="M4 5h16a1 1 0 011 1v9a1 1 0 01-1 1H9l-4 4v-4H4a1 1 0 01-1-1V6a1 1 0 011-1z"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinejoin="round"
    />
  ),
  search: (sw) => (
    <>
      <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth={sw} />
      <path d="M20 20l-4.5-4.5" stroke="currentColor" strokeWidth={sw + 0.3} strokeLinecap="round" />
    </>
  ),
  shop: (sw) => (
    <>
      <path d="M4 8h16l-1 3H5L4 8z" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
      <path d="M5 11v8a1 1 0 001 1h12a1 1 0 001-1v-8" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
      <path d="M4 8l1.5-3h13L20 8" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
      <path d="M10 20v-5h4v5" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
    </>
  ),
  live: (sw) => (
    <>
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <path d="M8 8a5.5 5.5 0 000 8M16 8a5.5 5.5 0 010 8M5.5 5.5a9 9 0 000 13M18.5 5.5a9 9 0 010 13" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
    </>
  ),
  bolt: () => (
    <path d="M13 2L4 13h6l-1 9 9-11h-6l1-9z" fill="currentColor" stroke="none" />
  ),
  lock: (sw) => (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth={sw} />
      <path d="M8 10V7a4 4 0 018 0v3" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      <circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  check: (sw) => (
    <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth={sw + 0.6} strokeLinecap="round" strokeLinejoin="round" />
  ),
  plus: (sw) => (
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth={sw + 0.4} strokeLinecap="round" />
  ),
  'chevron-right': (sw) => (
    <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth={sw + 0.4} strokeLinecap="round" strokeLinejoin="round" />
  ),
  'chevron-down': (sw) => (
    <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth={sw + 0.4} strokeLinecap="round" strokeLinejoin="round" />
  ),
  ticket: (sw) => (
    <>
      <path d="M4 8a1 1 0 011-1h14a1 1 0 011 1v2a2 2 0 000 4v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2a2 2 0 000-4V8z" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
      <path d="M14 7v10" stroke="currentColor" strokeWidth={sw} strokeDasharray="1.5 2" strokeLinecap="round" />
    </>
  ),
  sparkle: () => (
    <path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2z" fill="currentColor" stroke="none" />
  ),
}

export function NinjaIcon({
  name,
  size = 24,
  strokeWidth = 1.8,
  className,
  title,
}: NinjaIconProps) {
  const glyph = GLYPHS[name]
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {glyph(strokeWidth)}
    </svg>
  )
}

/** Every glyph name — handy for menus / demos / iterating the set. */
export const NINJA_ICON_NAMES = Object.keys(GLYPHS) as NinjaIconName[]

export default NinjaIcon
