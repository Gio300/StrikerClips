/**
 * Game knowledge for *Naruto to Boruto: Shinobi Striker* — the vocabulary the
 * moment-matcher uses to turn a chat claim ("I grabbed the flag on the second
 * run") into an event query against the clip event index.
 *
 * HONESTY NOTE: this powers the *matching* (claim → indexed event), which is
 * reliable. It does NOT auto-detect events from raw video — that comes from the
 * event index, whose most reliable source is the uploader's own tags.
 */

export type ClipEvent = {
  id: string
  video_id: string
  clip_id?: string | null
  game: string
  mode?: string | null
  event_kind: string
  actor?: string | null
  target?: string | null
  ordinal?: number | null
  t_seconds: number
  end_seconds?: number | null
  label?: string | null
  source?: string
  created_at?: string
}

export const MODES = ['flag_battle', 'barrier_battle', 'base_battle', 'combat'] as const
export const CLASSES = ['attack', 'defense', 'heal', 'range'] as const

/** Canonical event kinds + the words players actually use for them. */
export const EVENT_KINDS: { kind: string; label: string; synonyms: string[] }[] = [
  { kind: 'kill', label: 'Kill', synonyms: ['kill', 'killed', 'kills', 'dropped', 'downed', 'took out', 'took him out', 'took them out', 'eliminated', 'ko', 'knockout', 'knocked out', 'destroyed', 'clapped', 'bodied'] },
  { kind: 'death', label: 'Death', synonyms: ['death', 'died', 'got killed', 'i died', 'downed me', 'killed me', 'got me'] },
  { kind: 'flag_grab', label: 'Flag grab', synonyms: ['grab', 'grabbed', 'flag grab', 'flag run', 'ran the flag', 'ran it in', 'took the flag', 'picked up the flag', 'snagged the flag', 'grabbed the flag', 'got the flag'] },
  { kind: 'flag_capture', label: 'Flag capture', synonyms: ['capture', 'captured', 'capped', 'cap', 'scored', 'flag cap', 'brought it back', 'returned the flag', 'ran it in for the point', 'point'] },
  { kind: 'base_taken', label: 'Base taken', synonyms: ['base', 'took the base', 'captured the base', 'cap the base', 'capped the base', 'base capture'] },
  { kind: 'barrier', label: 'Barrier', synonyms: ['barrier', 'barrier battle', 'broke the barrier', 'barrier down'] },
  { kind: 'round_win', label: 'Round win', synonyms: ['round win', 'won the round', 'round'] },
  { kind: 'match_win', label: 'Match win', synonyms: ['win', 'won', 'victory', 'clutch', 'clutched', 'carried', 'won the match', 'gg', 'we won'] },
  { kind: 'combo', label: 'Combo', synonyms: ['combo', 'comboed', "combo'd", 'combo string', 'full combo'] },
]

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  once: 1, twice: 2, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
}
const ORDINAL_WORDS = new Set(['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'])

/** Parse "4 times" / "four times" / "4x" → count; "second run" / "2nd" → ordinal. */
export function parseCountOrdinal(text: string): { count?: number; ordinal?: number } {
  const t = text.toLowerCase()
  let count: number | undefined
  let ordinal: number | undefined

  // ordinal words (first/second/...) or 2nd/3rd
  const ordDigit = t.match(/\b(\d+)(st|nd|rd|th)\b/)
  if (ordDigit) ordinal = parseInt(ordDigit[1], 10)
  for (const w of ORDINAL_WORDS) if (new RegExp(`\\b${w}\\b`).test(t)) ordinal = WORD_NUMBERS[w]

  // counts: "4 times", "x4", "4x", or a bare number word before an event
  const timesDigit = t.match(/\b(\d+)\s*(?:times|x|kills?)\b/) || t.match(/\bx\s*(\d+)\b/)
  if (timesDigit) count = parseInt(timesDigit[1], 10)
  else {
    for (const [w, n] of Object.entries(WORD_NUMBERS)) {
      if (!ORDINAL_WORDS.has(w) && w !== 'first' && new RegExp(`\\b${w}\\s+(times|kills?)`).test(t)) count = n
    }
  }
  return { count, ordinal }
}

/**
 * Detect the event kind a phrase refers to. Phrase-aware and tolerant of natural
 * wording like "flag on the second run" or "when he ran in the flag" — not just
 * exact synonyms. Order matters (capture beats grab; flag/run beats kill).
 */
export function detectEventKind(text: string): string | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')} `
  const has = (w: string) => new RegExp(`\\b${w}`).test(t)
  const any = (...ws: string[]) => ws.some(has)

  const flag = has('flag')
  // Capture beats grab when both are implied.
  if ((flag && any('captur', 'capp', 'scor', 'point', 'return')) || any('captur', 'capp', 'scored')) return 'flag_capture'
  // Flag grab / flag run — "run"/"ran" in this game almost always means a flag run.
  if (flag || any('grab', 'grabb', 'snag')) return 'flag_grab'
  if (/\b(ran|run|runs|running)\b/.test(t)) return 'flag_grab'
  if (has('base')) return 'base_taken'
  if (has('barrier')) return 'barrier'
  if (any('kill', 'dropp', 'downed', 'eliminat', 'ko', 'knockout', 'clapp', 'bodied', 'destroy')) {
    return has('died') || has('death') ? 'death' : 'kill'
  }
  if (any('death', 'died')) return 'death'
  if (any('combo')) return 'combo'
  if (any('round')) return 'round_win'
  if (any('win', 'won', 'victor', 'clutch', 'carried', 'gg')) return 'match_win'
  return null
}

export function labelForKind(kind: string): string {
  return EVENT_KINDS.find((e) => e.kind === kind)?.label ?? kind
}
