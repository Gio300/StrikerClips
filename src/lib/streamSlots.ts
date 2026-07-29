/**
 * Live-stream slots. Our YouTube channel can only restream a limited number of
 * live streams at once, so channel airtime is a scarce resource: first-come-
 * first-serve to go live now, or schedule a future window. Hosting on the
 * TKO channel (our audience + our ads) is a Pro perk; free users can still
 * stream on their OWN channel and link it.
 */

export const CHANNEL_SLOTS = 3

export type SlotClaim = { userId: string; startsAt: number; endsAt: number }

/** Free users can't take a channel slot; they link their own stream instead. */
export function tierCanHostOnChannel(isPremium: boolean): boolean {
  return isPremium
}

/** Claims occupying a slot at instant t. */
export function activeAt(claims: SlotClaim[], t: number): number {
  return claims.filter((c) => c.startsAt <= t && t < c.endsAt).length
}

export function slotsOpenAt(claims: SlotClaim[], t: number, total = CHANNEL_SLOTS): number {
  return Math.max(0, total - activeAt(claims, t))
}

/** Peak concurrent claims across the window [start, end). */
function maxActiveDuring(claims: SlotClaim[], start: number, end: number): number {
  const boundaries = [start, ...claims.map((c) => c.startsAt).filter((s) => s > start && s < end)]
  return boundaries.reduce((mx, b) => Math.max(mx, activeAt(claims, b)), 0)
}

/** First-come-first-serve: can this user go live right now? */
export function canGoLiveNow(
  isPremium: boolean,
  claims: SlotClaim[],
  now: number,
  total = CHANNEL_SLOTS,
): { ok: boolean; reason?: string } {
  if (!tierCanHostOnChannel(isPremium)) {
    return { ok: false, reason: 'Going live on the TKO channel is a Pro feature — link your own stream on free.' }
  }
  if (slotsOpenAt(claims, now, total) <= 0) {
    return { ok: false, reason: 'All live slots are full right now — schedule a window instead.' }
  }
  return { ok: true }
}

/**
 * Earliest start time ≥ `from` where a `durationMs` window has a free slot.
 * Used by the scheduler ("if you want our platform + viewers, book a slot").
 */
export function nextOpenSlot(
  claims: SlotClaim[],
  from: number,
  durationMs: number,
  total = CHANNEL_SLOTS,
): number {
  const candidates = [from, ...claims.map((c) => c.endsAt).filter((t) => t >= from)].sort((a, b) => a - b)
  for (const start of candidates) {
    if (maxActiveDuring(claims, start, start + durationMs) < total) return start
  }
  return from
}
