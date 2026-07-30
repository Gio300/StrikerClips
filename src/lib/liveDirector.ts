/**
 * Pure camera-director rules for a linked 1-8 feed stage.
 *
 * The browser cannot inspect cross-origin YouTube pixels. A timer supplies the
 * safe fallback plan, while an OBS/plugin/server detector may submit small
 * gameplay events to temporarily override that plan.
 */

export const MAX_DIRECTOR_FEEDS = 8

export type ShotLayout = 'single' | 'split' | 'grid'

export interface Shot {
  layout: ShotLayout
  featured: number
  secondary?: number
  feeds?: number[]
}

export const SHOT_MS = 7000

export type LiveDirectorEventKind =
  | 'knockout'
  | 'flag_pickup'
  | 'flag_capture'
  | 'base_capture'
  | 'objective'
  | 'ultimate'

export interface LiveDirectorEvent {
  angle: number
  kind: LiveDirectorEventKind
  atMs: number
  confidence?: number
}

const EVENT_WEIGHT: Record<LiveDirectorEventKind, number> = {
  knockout: 100,
  flag_capture: 95,
  base_capture: 88,
  flag_pickup: 82,
  objective: 74,
  ultimate: 68,
}

export const EVENT_HOLD_MS = 6500

/** Singles, adjacent pairs, then a full-stage beat. */
export function directorPlan(n: number): Shot[] {
  const count = Math.max(0, Math.min(MAX_DIRECTOR_FEEDS, Math.floor(n)))
  if (count <= 1) return [{ layout: 'single', featured: 0 }]

  const shots: Shot[] = []
  for (let index = 0; index < count; index += 1) {
    shots.push({ layout: 'single', featured: index })
  }
  for (let index = 0; index < count - 1; index += 2) {
    shots.push({ layout: 'split', featured: index, secondary: index + 1 })
  }
  if (count >= 3) {
    shots.push({
      layout: 'grid',
      featured: 0,
      feeds: Array.from({ length: count }, (_, index) => index),
    })
  }
  return shots
}

export function shotAt(plan: Shot[], beat: number): Shot {
  if (plan.length === 0) return { layout: 'single', featured: 0 }
  const index = ((beat % plan.length) + plan.length) % plan.length
  return plan[index]
}

export function beatFromElapsed(elapsedMs: number, shotMs: number = SHOT_MS): number {
  if (shotMs <= 0) return 0
  return Math.floor(Math.max(0, elapsedMs) / shotMs)
}

/** Valid, unique camera indexes for a shot. */
export function shotFeeds(shot: Shot, count: number): number[] {
  const max = Math.max(0, Math.min(MAX_DIRECTOR_FEEDS, Math.floor(count)))
  if (max === 0) return []
  const raw =
    shot.layout === 'grid'
      ? shot.feeds ?? []
      : shot.layout === 'split'
        ? [shot.featured, shot.secondary]
        : [shot.featured]
  const out: number[] = []
  for (const value of raw) {
    if (value == null || value < 0 || value >= max || out.includes(value)) continue
    out.push(value)
  }
  return out.length ? out : [0]
}

/** A balanced 16:9 stage grid for one through eight feeds. */
export function cameraGrid(count: number): { columns: number; rows: number } {
  const normalized = Math.max(1, Math.min(MAX_DIRECTOR_FEEDS, Math.floor(count)))
  if (normalized === 1) return { columns: 1, rows: 1 }
  if (normalized === 2) return { columns: 2, rows: 1 }
  if (normalized <= 4) return { columns: 2, rows: 2 }
  if (normalized <= 6) return { columns: 3, rows: 2 }
  return { columns: 4, rows: 2 }
}

/** Toggle one camera in a hold-to-combine selection. */
export function toggleCastSelection(
  selected: number[],
  index: number,
  count: number,
  max: number = MAX_DIRECTOR_FEEDS,
): number[] {
  if (index < 0 || index >= count) return selected
  if (selected.includes(index)) return selected.filter((value) => value !== index)
  if (selected.length >= Math.min(max, MAX_DIRECTOR_FEEDS)) return selected
  return [...selected, index]
}

/**
 * Let recent gameplay events override a timer shot. Two nearly simultaneous,
 * similarly important events become a split; otherwise the strongest feed gets
 * the full stage.
 */
export function eventAwareShot(
  fallback: Shot,
  events: LiveDirectorEvent[],
  nowMs: number,
  count: number,
): Shot {
  const recent = events
    .filter((event) => (
      event.angle >= 0 &&
      event.angle < count &&
      nowMs - event.atMs >= 0 &&
      nowMs - event.atMs <= EVENT_HOLD_MS
    ))
    .map((event) => ({
      ...event,
      score: EVENT_WEIGHT[event.kind] * Math.max(0, Math.min(1, event.confidence ?? 1)),
    }))
    .sort((a, b) => b.score - a.score || b.atMs - a.atMs)

  const first = recent[0]
  if (!first) return fallback
  const second = recent.find((event) => (
    event.angle !== first.angle &&
    Math.abs(event.atMs - first.atMs) <= 1600 &&
    first.score - event.score <= 15
  ))
  return second
    ? { layout: 'split', featured: first.angle, secondary: second.angle }
    : { layout: 'single', featured: first.angle }
}

export function shotLabel(shot: Shot, handles: string[]): string {
  if (shot.layout === 'grid') return `${shotFeeds(shot, handles.length).length} cameras`
  if (shot.layout === 'split') {
    const first = handles[shot.featured]
    const second = shot.secondary == null ? null : handles[shot.secondary]
    return first && second ? `${first} + ${second}` : 'Two cameras'
  }
  const handle = handles[shot.featured]
  return handle ? `Featuring ${handle}` : 'Featuring the action'
}
