import type { CSSProperties, ReactNode } from 'react'

/**
 * CroppedFrame — the reusable "make a YouTube pane look native" wrapper.
 *
 * The problem: a raw YouTube embed (iframe OR IFrame-API player) shows the
 * giant center play/pause overlay, the "YouTube" logo bottom-right, the title
 * gradient up top, and black letterbox bars when the pane isn't 16:9. That
 * reads as "someone dropped a YouTube video in a box", not a broadcast feed.
 *
 * The fix, all in CSS so it works for BOTH a raw <iframe> and an API player
 * div (the API replaces the div with a 100%×100% iframe):
 *
 *   1. `overflow:hidden` viewport clipped to the pane.
 *   2. An OVERSCAN layer sized to `overscan` (default 135%) and centered, so
 *      the video FILLS the pane cover-style — no letterbox — and YouTube's
 *      bottom chrome (logo + control gradient) and top title are pushed
 *      outside the clip.
 *   3. `pointerEvents:none` on the video layer (a "shield") so a stray click
 *      can't trigger YouTube's own pause — which is what pops the center
 *      overlay back up. Playback is driven by our own unified controls via
 *      the IFrame API instead. Parents that need a click (focus a pane) still
 *      receive it because the shield only covers the video layer.
 *
 * Pass `shield={false}` when the pane genuinely needs the user to click the
 * video itself (e.g. tap-to-unmute on the single concat player).
 */
export function CroppedFrame({
  children,
  overscan = 1.35,
  shield = true,
  className = '',
  style,
}: {
  children: ReactNode
  /** How much to scale the video past the pane. 1.35 ≈ crop 13% off each edge. */
  overscan?: number
  /** Swallow pointer events on the video layer so YouTube chrome never shows. */
  shield?: boolean
  className?: string
  style?: CSSProperties
}) {
  const pct = `${Math.round(overscan * 100)}%`
  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`} style={style}>
      <div
        className="absolute top-1/2 left-1/2"
        style={{
          width: pct,
          height: pct,
          transform: 'translate(-50%, -50%)',
          pointerEvents: shield ? 'none' : 'auto',
        }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * TkoWatermark — a small TKO wordmark pinned to a corner of the STAGE (not
 * per-iframe), standing in for YouTube's own logo. Purely decorative.
 */
export function TkoWatermark({
  corner = 'br',
  className = '',
}: {
  corner?: 'br' | 'bl' | 'tr' | 'tl'
  className?: string
}) {
  const pos =
    corner === 'br'
      ? 'bottom-2 right-2'
      : corner === 'bl'
        ? 'bottom-2 left-2'
        : corner === 'tr'
          ? 'top-2 right-2'
          : 'top-2 left-2'
  return (
    <div
      className={`absolute ${pos} z-20 pointer-events-none select-none flex items-center gap-1 px-1.5 py-0.5 rounded ${className}`}
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
      aria-hidden
    >
      <span className="text-[11px] font-black tracking-wider leading-none text-white">TKO</span>
      <span className="text-[11px] font-black tracking-wider leading-none text-accent">.cam</span>
    </div>
  )
}
