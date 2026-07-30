/**
 * stageLayout — which multi-angle compositions are legible at a given viewport
 * width, and how to degrade gracefully when they aren't.
 *
 * Founder question that drove this file: "how will we fit all those screens so
 * people can view them on mobile?" The answer is that we DON'T fit them all.
 * Multi-angle is the product, but four 1080p feeds tiled into a 390 px phone
 * gives four ~190 px panes — illegible, and it burns four concurrent decoders
 * on the weakest hardware we ship to.
 *
 * So the rule is: on a phone you get ONE focused angle at full width plus a
 * scrollable strip of thumbnails, and the auto-director keeps choosing the best
 * angle for you. That's the real answer to a small screen — the AI picks, the
 * viewer watches one good feed. Quad/8-up unlock at tablet width and up.
 *
 * Everything here is pure so the breakpoint rules can be unit-tested without a
 * DOM; the components just call these and render.
 */

export type StageBreakpoint = 'phone' | 'tablet' | 'desktop'

/** Manual layout a viewer can force. 'auto' hands control to the director. */
export type StageLayout = 'auto' | 'single' | 'sxs' | 'quad'

/**
 * Tailwind's `sm` (640) and `lg` (1024) so CSS classes and JS agree.
 * < 640  → phone   (focused + strip only)
 * < 1024 → tablet  (quad becomes legible)
 * ≥ 1024 → desktop (everything)
 */
export const PHONE_MAX_WIDTH = 640
export const TABLET_MAX_WIDTH = 1024

export function breakpointForWidth(width: number): StageBreakpoint {
  if (!Number.isFinite(width) || width <= 0) return 'phone'
  if (width < PHONE_MAX_WIDTH) return 'phone'
  if (width < TABLET_MAX_WIDTH) return 'tablet'
  return 'desktop'
}

export function isPhoneWidth(width: number): boolean {
  return breakpointForWidth(width) === 'phone'
}

/**
 * How many video panes we're willing to put on screen at once.
 * Phones get exactly one; the rest of the angles live in the thumbnail strip.
 */
export function maxVisiblePanes(bp: StageBreakpoint): number {
  if (bp === 'phone') return 1
  if (bp === 'tablet') return 4
  return 8
}

/**
 * The layouts a viewer may actually choose, given the viewport and how many
 * angles exist. Controls must be built from this — we never offer "Quad" on a
 * 390 px screen, because tapping it could only make things worse.
 *
 * `composites` is false for the Action-cam player, which is single-shot by
 * design and therefore never offers Split/Quad at any width.
 */
export function allowedLayouts(
  bp: StageBreakpoint,
  angleCount: number,
  composites = true,
): StageLayout[] {
  const out: StageLayout[] = ['auto', 'single']
  if (!composites) return out
  // 2-up is explicitly allowed on phones — two 16:9 panes stacked still read.
  if (angleCount >= 2) out.push('sxs')
  // Quad needs real estate. Below tablet width the tiles are unreadable.
  if (angleCount >= 3 && bp !== 'phone') out.push('quad')
  return out
}

/**
 * Coerce a requested layout into something legible at this width.
 *
 * The important case: a viewer picks Quad on a desktop, then loads the same
 * share link on their phone (or just rotates/resizes). Rather than render four
 * unreadable tiles we fall back to 'auto' — focused single feed with the
 * director still choosing the angle, which is strictly the better small-screen
 * experience.
 */
export function coerceLayout(
  requested: StageLayout,
  bp: StageBreakpoint,
  angleCount: number,
  composites = true,
): StageLayout {
  const allowed = allowedLayouts(bp, angleCount, composites)
  if (allowed.includes(requested)) return requested
  // Quad (or split with too few angles) on a phone → focused + auto-director.
  return 'auto'
}

/**
 * Whether the director engine is allowed to emit composite shots (sxs / pip /
 * grid) at this width. On phones it is not: the director keeps running and
 * keeps picking the hottest angle, but it always presents that pick as a single
 * full-width feed.
 */
export function allowsCompositeShots(bp: StageBreakpoint): boolean {
  return bp !== 'phone'
}

/**
 * Cycle to the next/previous angle, wrapping at both ends. Backs the swipe
 * gesture and the arrow keys on the focused stage.
 */
export function nextAngleIndex(current: number, count: number, delta: number): number {
  if (count <= 0) return 0
  const safe = Number.isFinite(current) ? Math.trunc(current) : 0
  return (((safe + delta) % count) + count) % count
}

/** Minimum horizontal travel (px) before we treat a touch drag as a swipe. */
export const SWIPE_THRESHOLD_PX = 44

/**
 * Classify a horizontal touch drag. Returns -1 (swipe right → previous angle),
 * +1 (swipe left → next angle), or 0 (not a swipe — too short, or the gesture
 * was mostly vertical, which must stay a page scroll).
 */
export function swipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0
  if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return 0
  // Vertical-dominant drags belong to the scroller, not the angle switcher.
  if (Math.abs(dx) <= Math.abs(dy)) return 0
  return dx < 0 ? 1 : -1
}
