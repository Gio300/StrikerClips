/**
 * Director Mode engine — the DVR clock behind a KillCam watch party.
 *
 * The host runs a "program": a YouTube video playing on a timeline the host
 * controls. Viewers watch the SAME video, their player following the host's
 * clock a fixed delay behind (so the host always stays ahead and can pause /
 * rewind / slow-mo without the audience getting there first). Because it's
 * synced *playback* of already-uploaded footage — not a live video restream —
 * this is cheap and reliable, and the whole model is pure + unit-testable. The
 * realtime layer just broadcasts ProgramState; every client renders from it.
 *
 * Key idea: ProgramState is a small "anchor" — position at a moment in time,
 * plus play state and rate. Any client derives the live position from the
 * anchor + elapsed wall-clock, so we broadcast rarely (on host actions) rather
 * than every frame.
 */

export type ProgramState = {
  videoId: string
  /** playhead position, in seconds, AT `anchorAt` */
  anchorSec: number
  /** wall-clock (epoch ms) the anchor was set */
  anchorAt: number
  playing: boolean
  /** 1 = normal, 0.5 = slow-mo replay */
  rate: number
}

export type DirectorAction =
  | { type: 'load'; videoId: string; atSec?: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; toSec: number }
  | { type: 'runBack'; seconds: number }
  | { type: 'slowmo'; fromSec?: number; rate?: number }
  | { type: 'normalSpeed' }
  | { type: 'jumpTo'; toSec: number }

/** Default gap the audience trails the host, in seconds. */
export const DEFAULT_VIEWER_DELAY_SEC = 5

export function initProgram(videoId: string, now: number = Date.now()): ProgramState {
  return { videoId, anchorSec: 0, anchorAt: now, playing: false, rate: 1 }
}

/** Live playhead of the *host* program at time `now`. */
export function programPosition(s: ProgramState, now: number = Date.now()): number {
  if (!s.playing) return s.anchorSec
  const elapsed = Math.max(0, (now - s.anchorAt) / 1000)
  return s.anchorSec + elapsed * s.rate
}

/** Re-anchor to the current position so play-state/rate changes are seamless. */
function reanchor(s: ProgramState, now: number): ProgramState {
  return { ...s, anchorSec: programPosition(s, now), anchorAt: now }
}

/** Apply a host action, returning the new ProgramState. Pure; `now` injectable. */
export function applyAction(s: ProgramState, a: DirectorAction, now: number = Date.now()): ProgramState {
  switch (a.type) {
    case 'load':
      return { videoId: a.videoId, anchorSec: Math.max(0, a.atSec ?? 0), anchorAt: now, playing: false, rate: 1 }
    case 'play':
      return { ...reanchor(s, now), playing: true }
    case 'pause':
      return { ...reanchor(s, now), playing: false }
    case 'seek':
    case 'jumpTo':
      return { ...s, anchorSec: Math.max(0, a.toSec), anchorAt: now }
    case 'runBack': {
      const pos = Math.max(0, programPosition(s, now) - Math.max(0, a.seconds))
      return { ...s, anchorSec: pos, anchorAt: now }
    }
    case 'slowmo': {
      const from = a.fromSec !== undefined ? Math.max(0, a.fromSec) : programPosition(s, now)
      return { ...s, anchorSec: from, anchorAt: now, playing: true, rate: a.rate ?? 0.5 }
    }
    case 'normalSpeed':
      return { ...reanchor(s, now), rate: 1 }
    default:
      return s
  }
}

/**
 * What a viewer's player should show: the same program, `delaySec` behind the
 * host, clamped so we never go negative. Returns the target position + whether
 * to be playing + the rate to match.
 */
export function viewerTarget(
  s: ProgramState,
  now: number = Date.now(),
  delaySec: number = DEFAULT_VIEWER_DELAY_SEC,
): { positionSec: number; playing: boolean; rate: number } {
  const hostPos = programPosition(s, now)
  const target = Math.max(0, hostPos - delaySec)
  // If the host hasn't played `delaySec` worth yet, the viewer waits at 0.
  const playing = s.playing && hostPos > delaySec
  return { positionSec: target, playing, rate: s.rate }
}

/**
 * Given tagged highlight moments (start seconds, sorted asc), find the next one
 * strictly after the current host position — for the "jump to next K.O." button.
 * Returns null when there's nothing ahead.
 */
export function nextMomentAfter(momentsSec: number[], s: ProgramState, now: number = Date.now()): number | null {
  const pos = programPosition(s, now)
  for (const m of momentsSec) if (m > pos + 0.25) return m
  return null
}

/** Whether a viewer is far enough off target that we should hard-seek (vs let it ride). */
export function shouldResync(playerSec: number, targetSec: number, toleranceSec = 1.5): boolean {
  return Math.abs(playerSec - targetSec) > toleranceSec
}
