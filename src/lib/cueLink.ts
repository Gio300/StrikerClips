/**
 * Cued YouTube links — the "proof, instantly" mechanic.
 *
 * We NEVER re-encode or make a new clip. We point at a moment inside OUR
 * existing YouTube upload with the time parameter. The link:
 *   - starts playback at the referenced moment,
 *   - keeps the FULL video scrubbable (the segment is a reference, not a cut),
 *   - counts as a normal watch on our channel (watch-hours / view count).
 */
import type { ClipEvent } from './shinobiStriker'
import { labelForKind } from './shinobiStriker'

/** Normalize a YouTube id or URL to a bare 11-char video id. */
export function toVideoId(input: string): string {
  if (!input) return ''
  const m = input.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/)
  return m ? m[1] : input.trim()
}

/** A shareable watch link that STARTS at `startSec`. Full video stays scrubbable
 * and the view counts toward our channel. This is what gets copied to clipboard. */
export function buildCueUrl(videoOrId: string, startSec: number): string {
  const id = toVideoId(videoOrId)
  const t = Math.max(0, Math.floor(startSec))
  return `https://www.youtube.com/watch?v=${id}&t=${t}s`
}

/** In-app IFrame embed cued to the moment (start + optional soft end). Playback
 * still counts as a real view; the user can scrub the whole video. */
export function buildEmbedUrl(videoOrId: string, startSec: number, endSec?: number | null): string {
  const id = toVideoId(videoOrId)
  const start = Math.max(0, Math.floor(startSec))
  const end = endSec != null && endSec > startSec ? `&end=${Math.ceil(endSec)}` : ''
  return `https://www.youtube.com/embed/${id}?start=${start}${end}&rel=0`
}

/** Seconds → "m:ss" or "h:mm:ss". */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`
}

/** A single referenced moment ready to render/copy. */
export type Moment = {
  event: ClipEvent
  label: string
  t: number
  url: string
  embed: string
  time: string
}

export function toMoment(videoId: string, event: ClipEvent): Moment {
  const t = Number(event.t_seconds) || 0
  const label = event.label || describeEvent(event)
  return {
    event,
    label,
    t,
    url: buildCueUrl(videoId, t),
    embed: buildEmbedUrl(videoId, t, event.end_seconds ?? null),
    time: fmtTime(t),
  }
}

export function describeEvent(e: ClipEvent): string {
  const base = labelForKind(e.event_kind)
  const n = e.ordinal ? ` ${e.ordinal}` : ''
  const on = e.target ? ` on ${e.target}` : ''
  const by = e.actor ? `${e.actor}: ` : ''
  return `${by}${base}${n}${on}`.trim()
}

/**
 * YouTube chapters block for the video description. YouTube renders these as key
 * moments / a segmented scrub bar natively — the segmented-timeline look with
 * NO re-rendering. Requires a first chapter at 0:00.
 */
export function chaptersFromEvents(events: ClipEvent[]): string {
  const sorted = [...events].sort((a, b) => Number(a.t_seconds) - Number(b.t_seconds))
  const lines: string[] = []
  if (!sorted.length || Number(sorted[0].t_seconds) > 0) lines.push('0:00 Start')
  for (const e of sorted) lines.push(`${fmtTime(Number(e.t_seconds))} ${e.label || describeEvent(e)}`)
  return lines.join('\n')
}
