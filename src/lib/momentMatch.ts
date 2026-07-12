/**
 * Moment matcher — turns a natural-language claim into referenced moments in an
 * indexed video. Rule-based and grounded in the Shinobi Striker vocabulary, so
 * it's instant and predictable (no LLM round-trip). An LLM can be layered later
 * for fuzzier phrasing; the reliable core is here.
 */
import { supabase } from './supabase'
import type { ClipEvent } from './shinobiStriker'
import { detectEventKind, parseCountOrdinal, labelForKind } from './shinobiStriker'
import { toMoment, toVideoId, type Moment } from './cueLink'

export type MatchResult = {
  kind: string | null
  ordinal?: number
  count?: number
  moments: Moment[]
  note: string
}

/** Load the event index for a video (by YouTube id) from the DB. */
export async function fetchEvents(videoOrId: string): Promise<ClipEvent[]> {
  const videoId = toVideoId(videoOrId)
  const { data } = await supabase
    .from('clip_events')
    .select('*')
    .eq('video_id', videoId)
    .order('t_seconds', { ascending: true })
  return Array.isArray(data) ? (data as ClipEvent[]) : []
}

/** Match a claim ("I killed him 4 times", "flag on the second run") to moments. */
export function matchClaim(phrase: string, videoId: string, events: ClipEvent[]): MatchResult {
  const kind = detectEventKind(phrase)
  const { count, ordinal } = parseCountOrdinal(phrase)

  if (!kind) {
    return { kind: null, moments: [], note: 'No game event recognized in that phrase.' }
  }

  const matching = events
    .filter((e) => e.event_kind === kind)
    .sort((a, b) => Number(a.t_seconds) - Number(b.t_seconds))
    // assign a running ordinal if the index didn't set one
    .map((e, i) => (e.ordinal ? e : { ...e, ordinal: i + 1 }))

  if (matching.length === 0) {
    return { kind, ordinal, count, moments: [], note: `No “${labelForKind(kind)}” moments are indexed on this video yet.` }
  }

  let picked: ClipEvent[]
  let note: string
  if (ordinal) {
    const one = matching.find((e) => e.ordinal === ordinal)
    picked = one ? [one] : []
    note = one
      ? `The ${ordinalWord(ordinal)} ${labelForKind(kind).toLowerCase()}.`
      : `Couldn't find the ${ordinalWord(ordinal)} ${labelForKind(kind).toLowerCase()} — only ${matching.length} indexed.`
  } else if (count && count > 0) {
    picked = matching.slice(0, count)
    note = `${picked.length} of ${matching.length} “${labelForKind(kind)}” moment${picked.length === 1 ? '' : 's'}.`
    if (matching.length < count) note += ` (only ${matching.length} indexed.)`
  } else {
    picked = matching
    note = `${matching.length} “${labelForKind(kind)}” moment${matching.length === 1 ? '' : 's'}.`
  }

  return { kind, ordinal, count, moments: picked.map((e) => toMoment(videoId, e)), note }
}

function ordinalWord(n: number): string {
  return ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][n] || `${n}th`
}
