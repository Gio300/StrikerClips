// Action-driven director for multi-angle YouTube reels.
//
// Rules (per user spec):
//   1. The reel switches when there's MORE ACTION on a different angle.
//   2. Minimum hold per shot: 12 seconds. Don't flicker.
//   3. If the action goes flat on the current angle, switch to whichever
//      angle has incoming action (don't stall on a quiet shot).
//   4. Even if one angle is consistently hottest, eventually rotate so
//      every contributor gets airtime (fairness pressure).
//   5. Use side-by-side and PiP for SECONDARY action, so we don't lose
//      a second hot moment to a single-screen cut.
//
// The engine is pure: feed it scores + state, get back a Shot. The player
// component owns the timer and renders it.

import type { ActionCurve } from './youtubeActionCurve'
import { sampleCurve } from './youtubeActionCurve'

export type ShotKind = 'single' | 'sxs' | 'pip' | 'grid'

export type Shot = {
  kind: ShotKind
  primary: number
  secondary?: number
  overlay?: number
  // For 2x2 grid: the four angles in reading order. Only set when kind='grid'.
  cells?: number[]
  reason: string
  startedAt: number
}

export type DirectorConfig = {
  minHoldSec: number
  // Even when scores favor staying, force a switch after this much time so
  // every angle gets airtime. The user wants "even if action is strong,
  // switch at some point so everyone is involved."
  fairnessForceSec: number
  // Score gap a contender needs over the current primary to trigger a switch.
  switchHysteresis: number
  // Minimum of the LEADER's score before we even consider a switch (anything
  // below is the "flat" regime and we go to fairness mode).
  flatThreshold: number
  // If 2 clips' scores are within this fraction of each other AND both above
  // flatThreshold, prefer side-by-side / PiP over single screen.
  closeFraction: number
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  minHoldSec: 12,
  fairnessForceSec: 28,
  switchHysteresis: 0.06,
  flatThreshold: 0.35,
  closeFraction: 0.18,
}

export type DirectorState = {
  shot: Shot
  // Per-angle: when was each clip last on screen as a primary? Used for
  // fairness — clips not shown for a while get a boost.
  lastPrimaryAt: number[]
  // Cumulative airtime per clip (seconds). Used when picking who to rotate
  // in for fairness.
  airtimeSec: number[]
}

/**
 * Smooth a clip's score around time `t` to avoid spikes from a single
 * heatmap bucket. We sample a few seconds before/after and average — the
 * "what's coming up" filter that lets us cut TO a hot moment a beat early
 * rather than reacting after it's over.
 */
export function lookaheadScore(curve: ActionCurve | null, t: number): number {
  if (!curve) return 0
  // Look ahead a touch (so we cut TO the moment), and back a tad for context.
  const offsets = [-2, 0, 2, 4, 6]
  let total = 0
  for (const o of offsets) total += sampleCurve(curve, Math.max(0, t + o))
  return total / offsets.length
}

/**
 * Compute the per-clip score vector. Each curve is sampled at its own
 * playback time (since each YouTube angle is a separate video with its
 * own timeline). `playTimes[i]` is the elapsed seconds inside curves[i].
 */
export function scoreAll(curves: (ActionCurve | null)[], playTimes: number[]): number[] {
  return curves.map((c, i) => lookaheadScore(c, playTimes[i] ?? 0))
}

/**
 * Decide whether to cut, and to what. Returns either the SAME shot (no
 * change) or a brand new Shot.
 *
 * `now` is monotonic seconds (e.g. performance.now() / 1000); `playT` is
 * playback time inside the synced reel.
 *
 * `boost` (optional) receives the raw heatmap scores and returns the
 * adjusted scores. Used to wire in game-profile clutch rules without
 * making this engine itself game-aware.
 */
export function step(opts: {
  state: DirectorState
  now: number
  playTimes: number[]
  curves: (ActionCurve | null)[]
  config?: DirectorConfig
  boost?: (scores: number[]) => number[]
}): { state: DirectorState; switched: boolean } {
  const cfg = opts.config ?? DEFAULT_DIRECTOR_CONFIG
  const { state, now, playTimes, curves } = opts
  const n = curves.length
  if (n === 0) return { state, switched: false }

  const heldSec = now - state.shot.startedAt

  // Always tick airtime so fairness data stays current even when we don't
  // switch.
  const tickedAirtime = state.airtimeSec.slice()
  const STEP_SEC = 0.25 // matches typical caller cadence; harmless if off.
  if (state.shot.primary >= 0 && state.shot.primary < n) {
    tickedAirtime[state.shot.primary] = (tickedAirtime[state.shot.primary] ?? 0) + STEP_SEC
  }
  const updatedState: DirectorState = { ...state, airtimeSec: tickedAirtime }

  // Honor min hold.
  if (heldSec < cfg.minHoldSec) {
    return { state: updatedState, switched: false }
  }

  const baseScores = scoreAll(curves, playTimes)
  const scores = opts.boost ? opts.boost(baseScores) : baseScores
  const ranked = scores
    .map((s, i) => ({ idx: i, score: s }))
    .sort((a, b) => b.score - a.score)

  const top = ranked[0]
  const second = ranked[1]
  const third = ranked[2]
  const currentPrimaryScore = scores[state.shot.primary] ?? 0

  // Fairness pressure builds with both hold time AND inverse airtime —
  // angles that have been on screen the most get a penalty so we cycle.
  const totalAirtime = tickedAirtime.reduce((a, b) => a + b, 0) || 1
  const fairnessBoost = (i: number) => {
    const share = (tickedAirtime[i] ?? 0) / totalAirtime
    // Low share -> big boost. Cap so it can't dwarf real signal.
    return Math.min(0.25, Math.max(0, 0.15 - share * 0.6))
  }

  // Adjusted scores: action + fairness boost (so under-shown angles win
  // ties and break flat draws).
  const adjusted = scores.map((s, i) => s + fairnessBoost(i))
  const adjRanked = adjusted
    .map((s, i) => ({ idx: i, score: s }))
    .sort((a, b) => b.score - a.score)

  const adjTop = adjRanked[0]
  const adjSecond = adjRanked[1]
  const adjThird = adjRanked[2]

  // Hard fairness override: even a leading angle gives up the spotlight
  // after fairnessForceSec so everyone gets airtime.
  const forceFairness = heldSec >= cfg.fairnessForceSec

  // Decide whether to switch.
  let shouldSwitch = false

  if (forceFairness) {
    shouldSwitch = true
  } else if (top.score < cfg.flatThreshold) {
    // Action is flat on the leader. Per spec: if it goes flat, switch to a
    // clip with action. So we fairness-rotate, biasing toward whichever
    // contender has the highest adjusted score that ISN'T the current primary.
    if (adjTop.idx !== state.shot.primary) shouldSwitch = true
  } else if (top.idx !== state.shot.primary) {
    // Real action on a different angle. Switch only if the gap is meaningful.
    if (top.score - currentPrimaryScore >= cfg.switchHysteresis) shouldSwitch = true
  }
  // If the current primary is still the action leader by a real margin, hold.

  if (!shouldSwitch) {
    return { state: updatedState, switched: false }
  }

  // Pick the new shot. Prefer composing primary + secondary action when
  // multiple angles are hot at the same time — that's the user's "PiP for
  // secondary action / side-by-side for parallel action" rule.
  const targetIdx = forceFairness && adjTop.idx === state.shot.primary
    ? (adjSecond?.idx ?? adjTop.idx)
    : adjTop.idx

  const newPrimary = targetIdx
  const primaryScore = scores[newPrimary]

  // Find the next-best different angle for secondary.
  const otherCandidates = adjRanked.filter((r) => r.idx !== newPrimary)
  const candA = otherCandidates[0]
  const candB = otherCandidates[1]

  let next: Shot

  // ≥ 3 hot at once -> 2x2 grid (rare but visceral).
  const hotCount = scores.filter((s) => s >= cfg.flatThreshold + 0.1).length
  if (n >= 4 && hotCount >= 3) {
    const cells = adjRanked.slice(0, 4).map((r) => r.idx)
    next = mkShot('grid', { primary: newPrimary, cells, reason: `${hotCount} angles hot` }, now)
  } else if (candA && candA.score >= cfg.flatThreshold) {
    const candAScore = scores[candA.idx]
    const ratio = primaryScore > 0 ? Math.min(candAScore, primaryScore) / Math.max(candAScore, primaryScore) : 0
    const closeEnough = ratio >= 1 - cfg.closeFraction

    if (closeEnough) {
      // Two angles both popping → side-by-side, equal real estate.
      next = mkShot('sxs', {
        primary: newPrimary,
        secondary: candA.idx,
        reason: 'parallel action',
      }, now)
    } else if (candAScore >= cfg.flatThreshold + 0.05) {
      // One leader + a meaningful secondary → PiP. Don't lose the second hit.
      next = mkShot('pip', {
        primary: newPrimary,
        overlay: candA.idx,
        reason: 'secondary action',
      }, now)
    } else {
      next = mkShot('single', { primary: newPrimary, reason: forceFairness ? 'fairness' : 'lead action' }, now)
    }
  } else {
    next = mkShot('single', { primary: newPrimary, reason: forceFairness ? 'fairness' : 'lead action' }, now)
  }

  // Record fairness state.
  const lastPrimaryAt = state.lastPrimaryAt.slice()
  lastPrimaryAt[next.primary] = now
  // Reset airtime for the new primary's competitors? No — we want a long
  // memory so a clip that's been hogging gets de-prioritized for a while.
  // Just keep ticking.

  return {
    state: { shot: next, lastPrimaryAt, airtimeSec: tickedAirtime },
    switched: true,
  }

  // (avoid unused warnings on candB / third in some configs)
  void candB
  void second
  void third
  void adjThird
}

function mkShot(
  kind: ShotKind,
  parts: Omit<Shot, 'kind' | 'startedAt'>,
  now: number,
): Shot {
  return { kind, ...parts, startedAt: now }
}

/**
 * Initial state — the first shot is always the squad-view 4-man grid
 * (when we have ≥4 angles) so viewers see everyone before the director
 * cuts in. With 2-3 angles we open on a side-by-side / single instead.
 */
export function initialState(angleCount: number, now: number): DirectorState {
  let opener: Shot
  if (angleCount >= 4) {
    opener = {
      kind: 'grid',
      primary: 0,
      cells: [0, 1, 2, 3],
      reason: 'cold open: squad view',
      startedAt: now,
    }
  } else if (angleCount === 3) {
    opener = {
      kind: 'sxs',
      primary: 0,
      secondary: 1,
      reason: 'cold open: split',
      startedAt: now,
    }
  } else if (angleCount === 2) {
    opener = {
      kind: 'sxs',
      primary: 0,
      secondary: 1,
      reason: 'cold open: split',
      startedAt: now,
    }
  } else {
    opener = {
      kind: 'single',
      primary: 0,
      reason: 'cold open',
      startedAt: now,
    }
  }
  return {
    shot: opener,
    lastPrimaryAt: new Array(angleCount).fill(now),
    airtimeSec: new Array(angleCount).fill(0),
  }
}

/**
 * Convenience: which clip should currently carry the audio for this shot?
 * For composite shots the "primary" wins so we don't get an echo.
 */
export function audioIndex(shot: Shot): number {
  return shot.primary
}

/**
 * Used by the player to render a small action-meter HUD: returns each
 * clip's score at its own playback time, normalized. Pass an optional
 * `boost` to apply game-profile clutch rules — same one as `step()`.
 */
export function scoreSnapshot(
  curves: (ActionCurve | null)[],
  playTimes: number[],
  boost?: (scores: number[]) => number[],
): number[] {
  const s = scoreAll(curves, playTimes)
  return boost ? boost(s) : s
}
