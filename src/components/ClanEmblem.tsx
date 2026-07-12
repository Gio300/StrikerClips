import type { Clan } from '@/types/database'

/**
 * ClanEmblem — renders a clan's crest from a preset icon key + two colors.
 *
 * The icon set is a small library of inline SVGs drawn in a 24×24 box with
 * `fill: currentColor`, so the foreground color drives every path. Pass either
 * a whole `clan` or explicit `{ icon, bg, fg }`; `size` is the pixel square.
 *
 * `ICONS` is exported so the create form can offer a picker over the same keys.
 */

export const ICONS = [
  'skull',
  'crosshair',
  'flame',
  'crown',
  'bolt',
  'shield',
  'dragon',
  'wolf',
] as const

export type ClanIcon = (typeof ICONS)[number]

const ICON_PATHS: Record<string, JSX.Element> = {
  skull: (
    <path d="M12 2C7.6 2 4 5.3 4 9.4c0 2.4 1.1 4.2 2.8 5.5.5.4.7.9.7 1.5V18a1 1 0 0 0 1 1h1v-2h1.4v2h1.7v-2h1.7v2h1.6v-1.6c0-.6.2-1.1.7-1.5C18.9 13.6 20 11.8 20 9.4 20 5.3 16.4 2 12 2Zm-3.4 8.9a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Zm6.8 0a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z" />
  ),
  crosshair: (
    <>
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="1.8" />
    </>
  ),
  flame: (
    <path d="M12 2c.6 2.7 2.3 3.9 3.6 5.4C16.7 8.7 18 10.2 18 13a6 6 0 1 1-12 0c0-1.7.6-3 1.6-4.1.2 1 .8 1.8 1.7 2.1-.5-2.1.3-4.4 1.9-6C11.4 3.9 12 3 12 2Zm0 11.2c-1.4 0-2.4 1-2.4 2.3 0 1.3 1 2.5 2.4 2.5s2.4-1.1 2.4-2.5c0-.8-.4-1.4-1-2 .1.7-.2 1.3-.8 1.3-.5 0-.9-.4-.9-1 0-.3.1-.5.3-.6Z" />
  ),
  crown: (
    <>
      <path d="M3 8.5l3.6 3.2L12 5l5.4 6.7L21 8.5l-1.7 9H4.7L3 8.5Z" />
      <rect x="4.5" y="18.5" width="15" height="2.3" rx="1" />
    </>
  ),
  bolt: <path d="M13.2 2 4.5 13.4h5.4l-1.1 8.6 8.7-11.9H12l1.2-8.1Z" />,
  shield: (
    <path d="M12 2 4 5v6.2c0 4.9 3.3 8.6 8 10.8 4.7-2.2 8-5.9 8-10.8V5l-8-3Zm0 3.2 5 1.9v4.1c0 3.4-2.1 6.1-5 7.8-2.9-1.7-5-4.4-5-7.8V7.1l5-1.9Z" />
  ),
  dragon: (
    <>
      <path d="M2 13c2.1-.8 3.9-.4 5 1.2.6-3.3 2.9-5.6 6.1-5.6.9 0 1.7.2 2.4.6l1.3-2 .8 2.4 2.4 1.1-2.2 1c.2.6.3 1.3.3 2 0 3.5-2.8 6.3-6.3 6.3-2.4 0-4.5-1.4-5.6-3.4C5.6 17.5 3.3 15.8 2 13Z" />
      <circle cx="13.4" cy="12.4" r="1" fill="var(--emblem-eye, #0a0814)" />
    </>
  ),
  wolf: (
    <>
      <path d="M12 3 8.4 5.7 5 5l1.4 3.4L4 11l2.2 1.2L5 16.7l4-1.2 3 3 3-3 4 1.2-1.2-4.5L20 11l-2.4-2.6L19 5l-3.4.7L12 3Z" />
      <circle cx="10" cy="11" r="0.9" fill="var(--emblem-eye, #0a0814)" />
      <circle cx="14" cy="11" r="0.9" fill="var(--emblem-eye, #0a0814)" />
    </>
  ),
}

type EmblemProps =
  | { clan: Clan; size?: number }
  | { icon: string; bg: string; fg: string; size?: number }

export default function ClanEmblem(props: EmblemProps) {
  const icon = 'clan' in props ? props.clan.emblem_icon : props.icon
  const bg = 'clan' in props ? props.clan.emblem_bg : props.bg
  const fg = 'clan' in props ? props.clan.emblem_fg : props.fg
  const size = props.size ?? 48
  const glyph = ICON_PATHS[icon] ?? ICON_PATHS.skull

  return (
    <div
      className="inline-flex items-center justify-center rounded-xl border border-dark-border shrink-0 overflow-hidden"
      style={{ width: size, height: size, background: bg, color: fg }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
        style={{ width: Math.round(size * 0.62), height: Math.round(size * 0.62) }}
      >
        {glyph}
      </svg>
    </div>
  )
}
