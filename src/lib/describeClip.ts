/**
 * Describe-a-clip search — the "just tell TKO what you want" feature.
 *
 * A player connects their YouTube once; every video becomes a searchable
 * record. Instead of pasting a URL and scrubbing, they type a plain sentence:
 *
 *   "my ultimate against Rekt last night"
 *   "flag run vs auryn on friday"
 *   "his last 10 kills"
 *   "the K.O. yesterday"
 *
 * We parse WHO (opponent), WHEN (a time window), WHAT (category), and HOW MANY,
 * then filter + rank the connected library. Pure functions over a normalized
 * record so it's fully testable offline; the YouTube layer just supplies videos.
 *
 * Builds on parseClipQuery (opponent + category + limit); adds temporal parsing
 * which the URL-era clip search never needed.
 */

import { parseClipQuery, type ClipCategory } from './clipSearch'

export type LibraryVideo = {
  id: string // youtube video id
  title: string
  description: string
  publishedAt: number // epoch ms (upload time; our best "when it happened")
  channelTitle?: string
}

export type WhenWindow = {
  /** inclusive lower bound, epoch ms; undefined = no lower bound */
  fromMs?: number
  /** exclusive upper bound, epoch ms; undefined = no upper bound */
  toMs?: number
  /** human label we matched, for UI ("yesterday", "last week", "friday") */
  label?: string
}

export type DescribeQuery = {
  opponent?: string
  category?: ClipCategory
  limit: number
  when?: WhenWindow
  /** true when opponent came from a pronoun (his/my) not a name */
  pronoun?: boolean
  /** the leftover words we treated as free-text (matched against title/desc) */
  keywords: string[]
}

const DAY = 86_400_000

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** Start of local day for an epoch ms. */
function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Parse the WHEN portion. `now` is injectable so tests are deterministic.
 * Returns undefined when no temporal phrase is present.
 */
export function parseWhen(text: string, now: number = Date.now()): WhenWindow | undefined {
  const t = text.toLowerCase()
  const today0 = startOfDay(now)

  // Explicit relative days
  if (/\btoday\b/.test(t)) return { fromMs: today0, toMs: today0 + DAY, label: 'today' }
  if (/\byesterday\b/.test(t)) return { fromMs: today0 - DAY, toMs: today0, label: 'yesterday' }
  if (/\b(last night|tonight)\b/.test(t)) {
    // "last night" ≈ yesterday evening → this morning; keep it simple: yesterday.
    const isTonight = /\btonight\b/.test(t)
    return isTonight
      ? { fromMs: today0, toMs: today0 + DAY, label: 'tonight' }
      : { fromMs: today0 - DAY, toMs: today0 + DAY / 2, label: 'last night' }
  }

  // "last week" / "this week"
  if (/\blast week\b/.test(t)) return { fromMs: today0 - 7 * DAY, toMs: today0, label: 'last week' }
  if (/\bthis week\b/.test(t)) return { fromMs: today0 - 7 * DAY, toMs: today0 + DAY, label: 'this week' }
  if (/\blast month\b/.test(t)) return { fromMs: today0 - 30 * DAY, toMs: today0, label: 'last month' }

  // "N days/weeks ago"
  const ago = t.match(/\b(\d{1,3})\s+(day|days|week|weeks|month|months)\s+ago\b/)
  if (ago) {
    const n = parseInt(ago[1], 10)
    const unit = ago[2].startsWith('day') ? DAY : ago[2].startsWith('week') ? 7 * DAY : 30 * DAY
    const center = startOfDay(now - n * unit)
    return { fromMs: center, toMs: center + (ago[2].startsWith('day') ? DAY : unit), label: ago[0] }
  }

  // A named weekday → the most recent past occurrence (incl. today).
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const re = new RegExp(`\\b(?:on\\s+|last\\s+)?${WEEKDAYS[i]}\\b`)
    if (re.test(t)) {
      const todayDow = new Date(today0).getDay()
      let diff = (todayDow - i + 7) % 7
      if (diff === 0 && /\blast\b/.test(t)) diff = 7
      const day0 = today0 - diff * DAY
      return { fromMs: day0, toMs: day0 + DAY, label: WEEKDAYS[i] }
    }
  }

  return undefined
}

/** Parse a full plain-language description into a structured query. */
export function parseDescribe(text: string, now: number = Date.now()): DescribeQuery {
  const base = parseClipQuery(text)
  const when = parseWhen(text, now)

  // Leftover keywords: strip out words we already understood so the free-text
  // match doesn't double-count "kill"/"yesterday"/opponent etc.
  const consumed = new Set<string>([
    'my', 'mine', 'his', 'her', 'their', 'me', 'him', 'them', 'the', 'a', 'an',
    'last', 'top', 'against', 'vs', 'versus', 'fighting', 'when', 'who', 'im', "i'm",
    'clip', 'clips', 'show', 'get', 'find', 'pull', 'from', 'of', 'on', 'at',
    'today', 'yesterday', 'tonight', 'night', 'week', 'month', 'day', 'days',
    'weeks', 'months', 'ago', ...WEEKDAYS,
  ])
  if (base.playerHint) consumed.add(base.playerHint)
  const keywords = text
    .toLowerCase()
    .replace(/@[a-z0-9_]+/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !consumed.has(w) && !/^\d+$/.test(w))

  return {
    opponent: base.playerHint,
    category: base.category,
    limit: base.limit,
    when,
    pronoun: base.pronoun,
    keywords,
  }
}

const CATEGORY_HINTS: Record<ClipCategory, RegExp> = {
  kill: /\b(kill|k\.?o|knockout|elimination|frag)\b/i,
  death: /\b(death|died|got clipped)\b/i,
  ultimate: /\b(ultimate|ougi|jutsu|ult)\b/i,
  flag: /\b(flag|scroll|capture|objective)\b/i,
  win: /\b(win|victory|won)\b/i,
  clutch: /\b(clutch|comeback|1v|last stand)\b/i,
}

/**
 * Score a single video against the query. Higher = better. Returns -1 to reject
 * (hard filter failed, e.g. outside the WHEN window or wrong opponent).
 */
export function scoreVideo(
  v: LibraryVideo,
  q: DescribeQuery,
  resolvePronounTo?: string,
): number {
  const hay = `${v.title} ${v.description}`.toLowerCase()

  // Hard filter: WHEN window.
  if (q.when) {
    if (q.when.fromMs !== undefined && v.publishedAt < q.when.fromMs) return -1
    if (q.when.toMs !== undefined && v.publishedAt >= q.when.toMs) return -1
  }

  // Opponent: soft-but-strong. If a name was given and the metadata clearly
  // names a DIFFERENT known opponent we still keep it (metadata is noisy), but
  // a direct name hit is a big boost.
  const target = q.opponent || (q.pronoun ? resolvePronounTo : undefined)
  let score = 0
  if (target) {
    if (hay.includes(target.toLowerCase())) score += 10
    else if (q.opponent) score -= 2 // named someone we can't find in the text
  }

  // Category hint present in metadata.
  if (q.category && CATEGORY_HINTS[q.category].test(hay)) score += 6

  // Free-text keyword overlap.
  for (const k of q.keywords) if (hay.includes(k)) score += 3

  // Recency tiebreaker (newer slightly preferred), tiny so it never dominates.
  score += Math.max(0, 1 - (Date.now() - v.publishedAt) / (365 * DAY))

  return score
}

/**
 * Match + rank a connected library against a plain-language description.
 * Videos failing a hard filter (WHEN) are dropped; the rest sort by score,
 * newest-first as a tiebreak, capped at the query limit.
 */
export function matchLibrary(
  videos: LibraryVideo[],
  q: DescribeQuery,
  resolvePronounTo?: string,
): LibraryVideo[] {
  return videos
    .map((v) => ({ v, s: scoreVideo(v, q, resolvePronounTo) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => (b.s - a.s) || (b.v.publishedAt - a.v.publishedAt))
    .slice(0, q.limit)
    .map((x) => x.v)
}

/** A short human summary of what we understood — shown under the search box. */
export function describeSummary(q: DescribeQuery): string {
  const parts: string[] = []
  if (q.category) parts.push(`${q.category}s`)
  else parts.push('clips')
  if (q.opponent) parts.push(`vs ${q.opponent}`)
  else if (q.pronoun) parts.push('vs the tagged player')
  if (q.when?.label) parts.push(`from ${q.when.label}`)
  if (q.keywords.length) parts.push(`matching "${q.keywords.join(' ')}"`)
  return `Looking for ${q.limit} ${parts.join(' ')}`
}
