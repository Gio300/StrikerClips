import type { CSSProperties, ReactNode } from 'react'

/**
 * PlayerChrome — shared frame + slot label for every multi-angle player.
 *
 * One source of truth for "what does a slot look like": the border, the
 * label, the audio indicator, the active-primary glow. Used by:
 *   - SyncedGridPlayer      (2-up, 4-up squad)
 *   - PipPlayer             (overlay PiP frame)
 *   - DirectorPlayer        (animated single/sxs/pip/grid)
 *
 * Each slot gets its own accent color from a stable palette so viewers
 * can tell P1 from P2 from P3 at a glance, even when the layout shifts.
 */

const SLOT_PALETTE: { hex: string; rgb: string; name: string }[] = [
  { hex: '#ef4444', rgb: '239, 68, 68', name: 'kunai' },     // P1 — red
  { hex: '#00d4ff', rgb: '0, 212, 255', name: 'accent' },    // P2 — cyan
  { hex: '#22c55e', rgb: '34, 197, 94', name: 'leaf' },      // P3 — green
  { hex: '#f59e0b', rgb: '245, 158, 11', name: 'chakra' },   // P4 — amber
  { hex: '#a78bfa', rgb: '167, 139, 250', name: 'iris' },    // P5 — violet
  { hex: '#f472b6', rgb: '244, 114, 182', name: 'sakura' },  // P6 — pink
  { hex: '#38bdf8', rgb: '56, 189, 248', name: 'sky' },      // P7 — sky
  { hex: '#facc15', rgb: '250, 204, 21', name: 'sun' },      // P8 — yellow
]

export function slotColor(idx: number): { hex: string; rgb: string; name: string } {
  return SLOT_PALETTE[idx % SLOT_PALETTE.length]
}

export type SlotVariant =
  | 'main'         // a single big shot — minimal frame, mostly invisible
  | 'cell'         // a tile inside a 2x2 squad grid
  | 'sxs'          // half of a side-by-side
  | 'pip-overlay'  // the small inset on a PiP shot
  | 'thumb'        // the thumbnail strip in the angle picker

export type PlayerChromeProps = {
  slotIndex: number
  variant: SlotVariant
  /** Show audio indicator if this slot is currently driving the audio. */
  isAudio?: boolean
  /** Highlight more strongly if this is the directing primary right now. */
  isPrimary?: boolean
  /** Hide the label entirely (e.g. when slot is hidden). */
  hideLabel?: boolean
  /** Optional override label, e.g. clip title. Defaults to "P{idx+1}". */
  label?: string
  /** The actual player target div is the only child. */
  children: ReactNode
  /** Extra className for the outer wrapper. */
  className?: string
  /** Extra inline style on the outer wrapper. */
  style?: CSSProperties
}

/**
 * Wraps a player target div in a colored, labeled frame.
 *
 * Usage (inside SyncedGridPlayer):
 *   <PlayerChrome slotIndex={i} variant="cell" isAudio={muted === i}>
 *     <div ref={…} className="w-full h-full" />
 *   </PlayerChrome>
 *
 * The player target's ref MUST point at the inner div. The YouTube iframe
 * replaces that inner div on player init — the frame and label are
 * siblings of the target and are unaffected.
 */
export function PlayerChrome({
  slotIndex,
  variant,
  isAudio,
  isPrimary,
  hideLabel,
  label,
  children,
  className = '',
  style = {},
}: PlayerChromeProps) {
  const c = slotColor(slotIndex)
  const baseLabel = label ?? `P${slotIndex + 1}`

  // Border thickness + intensity per variant. Main = barely there;
  // cells/sxs = clear separation; pip-overlay = strong (it's the focal point).
  const frameStyle = framePresets(variant, c.rgb, isPrimary)

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        ...frameStyle,
        ...style,
      }}
    >
      {children}
      {!hideLabel && (
        <div
          className="absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold tracking-wide pointer-events-none"
          style={{
            background: 'rgba(0,0,0,0.65)',
            color: '#fff',
            backdropFilter: 'blur(2px)',
            boxShadow: `inset 0 0 0 1px rgba(${c.rgb},0.5)`,
          }}
        >
          <span
            className="inline-block rounded-full"
            style={{
              width: 7,
              height: 7,
              background: c.hex,
              boxShadow: `0 0 6px rgba(${c.rgb},0.85)`,
            }}
          />
          {baseLabel}
          {isAudio && (
            <span
              className="ml-0.5"
              title="Audio source"
              style={{ color: c.hex, fontSize: 12, lineHeight: 1 }}
            >
              ♪
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function framePresets(
  variant: SlotVariant,
  rgb: string,
  isPrimary: boolean | undefined,
): CSSProperties {
  const primaryGlow = isPrimary
    ? `, 0 0 0 1px rgba(${rgb},0.9), 0 0 24px rgba(${rgb},0.35)`
    : ''
  switch (variant) {
    case 'main':
      // Single big shot — frame just enough to see edges, no inner border.
      return {
        boxShadow: `inset 0 0 0 1px rgba(${rgb},0.18)${primaryGlow}`,
        borderRadius: 0,
      }
    case 'cell':
      // 2x2 squad cells — clear separation between angles.
      return {
        boxShadow: `inset 0 0 0 2px rgba(${rgb},0.7), 0 4px 12px rgba(0,0,0,0.45)${primaryGlow}`,
        borderRadius: 8,
      }
    case 'sxs':
      // Side-by-side — half-screen wide, deserves a clean colored edge.
      return {
        boxShadow: `inset 0 0 0 2px rgba(${rgb},0.55), 0 6px 18px rgba(0,0,0,0.5)${primaryGlow}`,
        borderRadius: 6,
      }
    case 'pip-overlay':
      // The PiP inset — most prominent frame in the comp.
      return {
        boxShadow: `0 0 0 2px rgba(${rgb},0.95), 0 12px 32px rgba(0,0,0,0.55)${primaryGlow}`,
        borderRadius: 10,
      }
    case 'thumb':
      return {
        boxShadow: isPrimary
          ? `0 0 0 2px rgba(${rgb},1), 0 0 18px rgba(${rgb},0.55)`
          : `inset 0 0 0 1px rgba(${rgb},0.4)`,
        borderRadius: 6,
      }
  }
}
