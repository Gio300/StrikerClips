/**
 * BATTLE MEDIA — the watch links attached to one side of a tournament battle.
 *
 * Each side of a matchup ('a' = player_a, 'b' = player_b) may carry the
 * fighter's LIVE stream URL and up to MAX_BATTLE_CLIPS YouTube clip links,
 * stored together in `tournament_battles.media` as
 * `{ a?: { live_url, clip_urls }, b?: { ... } }`.
 *
 * Shared by the browser (dashboards + bracket badges) and the server (the
 * trusted /api/fn/tournament-battle-media handler), so the validation rules
 * can never drift between the two:
 *   - a clip must parse to a YouTube video id (stored canonicalized);
 *   - a live URL must be https;
 *   - writes go through the fn only — an entrant writes ONLY their own side,
 *     a tournament host writes either side.
 */
import { extractYouTubeId } from './youtubeApi'

export type BattleSide = 'a' | 'b'

export type BattleSideMedia = {
  live_url?: string | null
  clip_urls?: string[]
}

export type BattleMedia = Partial<Record<BattleSide, BattleSideMedia>>

/** Ceiling on clips per side — enough for a set, small enough to stay a card. */
export const MAX_BATTLE_CLIPS = 4

/** Hard cap so a "URL" can't be used to store a novel. */
export const MAX_LIVE_URL_LENGTH = 400

/** Which side of the battle a user fights on, or null when they're not in it. */
export function sideForPlayer(
  battle: { player_a?: unknown; player_b?: unknown },
  userId: string | null | undefined,
): BattleSide | null {
  if (!userId) return null
  if (battle.player_a != null && String(battle.player_a) === String(userId)) return 'a'
  if (battle.player_b != null && String(battle.player_b) === String(userId)) return 'b'
  return null
}

export type LiveUrlResult =
  | { ok: true; url: string | null }
  | { ok: false; error: string }

/**
 * Normalize a live-stream URL. Empty input CLEARS the live link (url: null).
 * Anything else must be a parseable https URL — http, javascript:, data: and
 * plain junk are refused, so nothing unsafe can reach a viewer's click.
 */
export function normalizeLiveUrl(input: unknown): LiveUrlResult {
  if (input == null) return { ok: true, url: null }
  if (typeof input !== 'string') return { ok: false, error: 'live URL must be text' }
  const s = input.trim()
  if (!s) return { ok: true, url: null }
  if (s.length > MAX_LIVE_URL_LENGTH) return { ok: false, error: 'live URL is too long' }
  let parsed: URL
  try {
    parsed = new URL(s)
  } catch {
    return { ok: false, error: 'live URL must be a full https:// link' }
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) {
    return { ok: false, error: 'live URL must be a full https:// link' }
  }
  return { ok: true, url: s }
}

export type ClipUrlsResult =
  | { ok: true; urls: string[] }
  | { ok: false; error: string }

/**
 * Normalize a clip list. Every entry must contain a YouTube video id (any of
 * the usual URL shapes, or a bare 11-char id); entries are canonicalized to
 * `https://www.youtube.com/watch?v=<id>` and de-duplicated. An empty array
 * clears the list. One junk entry refuses the whole write — silently dropping
 * a "clip" a fighter thinks they attached would be worse.
 */
export function normalizeClipUrls(input: unknown): ClipUrlsResult {
  if (input == null) return { ok: true, urls: [] }
  if (!Array.isArray(input)) return { ok: false, error: 'clips must be a list of YouTube links' }
  const ids: string[] = []
  for (const entry of input) {
    if (typeof entry !== 'string') return { ok: false, error: 'clips must be YouTube links' }
    const id = extractYouTubeId(entry)
    if (!id) return { ok: false, error: `not a YouTube link: ${entry.slice(0, 80)}` }
    if (!ids.includes(id)) ids.push(id)
  }
  if (ids.length > MAX_BATTLE_CLIPS) {
    return { ok: false, error: `a side carries at most ${MAX_BATTLE_CLIPS} clips` }
  }
  return { ok: true, urls: ids.map((id) => `https://www.youtube.com/watch?v=${id}`) }
}

/** Defensive read of one side out of a stored media value of unknown shape. */
export function readSideMedia(
  media: unknown,
  side: BattleSide,
): { live_url: string | null; clip_urls: string[] } {
  const parsed = parseMedia(media)
  const raw = parsed?.[side]
  const live = typeof raw?.live_url === 'string' && raw.live_url ? raw.live_url : null
  const clips = Array.isArray(raw?.clip_urls)
    ? raw.clip_urls.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : []
  return { live_url: live, clip_urls: clips }
}

/** True when either side of the stored media carries anything watchable. */
export function hasAnyBattleMedia(media: unknown): boolean {
  return (['a', 'b'] as const).some((side) => {
    const m = readSideMedia(media, side)
    return Boolean(m.live_url) || m.clip_urls.length > 0
  })
}

/**
 * Merge an ALREADY-VALIDATED patch for one side into the stored media value.
 * Keys absent from the patch keep their stored value; a side that ends up with
 * nothing is dropped, and an empty result collapses to `{}` (stored as such,
 * never null-vs-{} ambiguity for readers).
 */
export function mergeBattleMedia(
  existing: unknown,
  side: BattleSide,
  patch: { live_url?: string | null; clip_urls?: string[] },
): BattleMedia {
  const current = parseMedia(existing) ?? {}
  const before = readSideMedia(current, side)
  const live = 'live_url' in patch ? (patch.live_url ?? null) : before.live_url
  const clips = 'clip_urls' in patch ? (patch.clip_urls ?? []) : before.clip_urls

  const next: BattleMedia = {}
  const other: BattleSide = side === 'a' ? 'b' : 'a'
  const otherMedia = readSideMedia(current, other)
  if (otherMedia.live_url || otherMedia.clip_urls.length > 0) {
    next[other] = sideValue(otherMedia.live_url, otherMedia.clip_urls)
  }
  if (live || clips.length > 0) {
    next[side] = sideValue(live, clips)
  }
  return next
}

function sideValue(live: string | null, clips: string[]): BattleSideMedia {
  const value: BattleSideMedia = {}
  if (live) value.live_url = live
  if (clips.length > 0) value.clip_urls = clips
  return value
}

function parseMedia(media: unknown): BattleMedia | null {
  if (media == null) return null
  if (typeof media === 'string') {
    try {
      const parsed = JSON.parse(media)
      return typeof parsed === 'object' && parsed !== null ? (parsed as BattleMedia) : null
    } catch {
      return null
    }
  }
  return typeof media === 'object' ? (media as BattleMedia) : null
}
