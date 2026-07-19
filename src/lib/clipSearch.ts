/**
 * Clip search — the "show me his last 10 kills" feature. Every clip we archive
 * to our YouTube is tagged (player, category, timestamp), which makes the
 * footage queryable so players (or the AI, to settle a dispute) can pull the
 * exact moments on demand.
 *
 * Pure functions over a normalized ClipRecord so they're fully testable
 * offline; the DB/YouTube layer just supplies the records.
 */

export type ClipCategory = 'kill' | 'death' | 'ultimate' | 'flag' | 'win' | 'clutch'

export type ClipRecord = {
  id: string
  playerId: string
  playerName: string
  category: ClipCategory
  youtubeId: string
  startSec: number
  createdAt: number // epoch ms
  matchId?: string
}

export type ClipQuery = {
  category?: ClipCategory
  limit: number
  /** raw name/handle the phrase referred to, e.g. "@rekt" or "auryn"; empty = "me/mine/his" resolved by caller */
  playerHint?: string
  /** true when the phrase used a pronoun (his/her/their/my) rather than a name */
  pronoun?: boolean
}

const CATEGORY_WORDS: [RegExp, ClipCategory][] = [
  [/\b(kills?|k\.?o\.?s?|knockouts?)\b/, 'kill'],
  [/\b(deaths?|got (killed|clipped)|times? i died)\b/, 'death'],
  [/\b(ultimates?|ougis?|jutsus?)\b/, 'ultimate'],
  [/\b(flags?|scrolls?|captures?)\b/, 'flag'],
  [/\b(wins?|victor(y|ies))\b/, 'win'],
  [/\b(clutch(es)?|comebacks?)\b/, 'clutch'],
]

/** Parse a natural phrase into a structured query. */
export function parseClipQuery(text: string): ClipQuery {
  const t = text.toLowerCase().trim()

  let limit = 10
  const lastN = t.match(/\blast\s+(\d{1,3})\b/) || t.match(/\btop\s+(\d{1,3})\b/) || t.match(/\b(\d{1,3})\b/)
  if (lastN) limit = Math.max(1, Math.min(100, parseInt(lastN[1], 10)))

  let category: ClipCategory | undefined
  for (const [rx, cat] of CATEGORY_WORDS) if (rx.test(t)) { category = cat; break }

  const pronoun = /\b(his|her|their|my|mine|him|them)\b/.test(t)
  let playerHint: string | undefined
  const at = t.match(/@([a-z0-9_]+)/)
  if (at) playerHint = at[1]
  else {
    const named = text.match(/\b([A-Z][a-zA-Z0-9_]{2,})\b/) // a capitalised name in the ORIGINAL casing
    if (named && !/^(Show|Get|Find|Pull|Last|Top|His|Her|Their)$/.test(named[1])) playerHint = named[1].toLowerCase()
  }

  return { category, limit, playerHint, pronoun }
}

/**
 * Rank clips for a query: filter by category + player, newest first, cap at
 * `limit`. `resolvePronounTo` supplies who "his/my" means when no name given.
 */
export function rankClips(
  clips: ClipRecord[],
  q: ClipQuery,
  resolvePronounTo?: string,
): ClipRecord[] {
  const target = q.playerHint || (q.pronoun ? resolvePronounTo : undefined)
  return clips
    .filter((c) => (q.category ? c.category === q.category : true))
    .filter((c) => (target ? c.playerName.toLowerCase().includes(target.toLowerCase()) || c.playerId === target : true))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, q.limit)
}

/** Deep link to the exact tagged moment on our YouTube. */
export function clipLink(c: ClipRecord): string {
  return `https://youtu.be/${c.youtubeId}?t=${Math.max(0, Math.floor(c.startSec))}`
}
