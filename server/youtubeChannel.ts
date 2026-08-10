/* eslint-disable @typescript-eslint/no-explicit-any */
// =============================================================================
// Shared YouTube channel-id resolution for the two background scanners
// ([auto-live] server/autoLive.ts and [auto-youtube] server/autoYouTube.ts).
//
// WHY (operator audit 2026-08-03): user_youtube_links stores the member's
// @handle URL (that is what Connect saves and what creditProduced matches on),
// so every scan cycle used to SCRAPE the handle page just to find the UC…
// channel id before it could fetch the zero-quota Atom feed. From a cloud
// egress IP YouTube intermittently answers those page/feed hits with
// 404/500/timeouts, which produced an error line for every member on every
// cycle — the stored links themselves were verified healthy. The fix:
//
//   • resolve the handle ONCE and persist the UC… id on the member's
//     user_youtube_links row (channel_id column, added at boot), so the
//     steady state is one feed fetch per member per cycle;
//   • a renamed handle (dead @url, e.g. a member rebrands their channel) can
//     still be scanned through its persisted channel id;
//   • genuinely dead/unresolvable channels log a once-per-day notice instead
//     of a per-cycle error (shouldLogDailyNotice below).
// =============================================================================

export type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

type FetchLike = typeof fetch

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'])

/** Canonical https://www.youtube.com form of a member's channel/handle URL. */
export function normalizeYouTubeChannelUrl(raw: string): string | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null
    if (url.hostname.toLowerCase() === 'youtu.be') return `https://www.youtube.com/watch?v=${url.pathname.slice(1)}`
    url.protocol = 'https:'
    url.hostname = 'www.youtube.com'
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Extract the UC… channel id from a /channel/UC… URL path or from a YouTube
 * page's HTML. The path match is case-SENSITIVE on purpose: channel ids are
 * case-sensitive, so a lowercased "uc…" stored by some import path must fall
 * through to the HTML scrape rather than produce an id whose feed 404s.
 */
export function youtubeChannelIdFromPage(url: string, html: string): string | null {
  try {
    const path = new URL(url).pathname
    const direct = path.match(/^\/channel\/(UC[\w-]{20,})/)?.[1]
    if (direct) return direct
  } catch { /* inspect page text */ }
  return html.match(/"channelId"\s*:\s*"(UC[\w-]{20,})"/)?.[1]
    || html.match(/"externalId"\s*:\s*"(UC[\w-]{20,})"/)?.[1]
    || html.match(/<meta\s+itemprop=["']channelId["']\s+content=["'](UC[\w-]{20,})["']/i)?.[1]
    || null
}

/** UC… id straight from the URL path, without any network or DB access. */
export function directChannelId(rawUrl: string): string | null {
  const normalized = normalizeYouTubeChannelUrl(rawUrl)
  return normalized ? youtubeChannelIdFromPage(normalized, '') : null
}

/**
 * Fetch the channel/handle page and scrape the UC… id out of it. Network
 * errors PROPAGATE (the caller owns per-user error accounting); a non-OK
 * response or an unrecognizable page resolves to null.
 */
export async function scrapeYouTubeChannelId(
  rawUrl: string,
  fetchFn: FetchLike,
): Promise<string | null> {
  const normalized = normalizeYouTubeChannelUrl(rawUrl)
  if (!normalized) return null
  const direct = youtubeChannelIdFromPage(normalized, '')
  if (direct) return direct
  const response = await fetchFn(normalized, {
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; TKOcamUploadScanner/1.0; +https://tko.cam)',
      'accept-language': 'en-US,en;q=0.9',
    },
  })
  if (!response.ok) return null
  return youtubeChannelIdFromPage(response.url || normalized, await response.text())
}

const CHANNEL_ID_RE = /^UC[\w-]{20,}$/

/**
 * The persisted channel id for one member link — DB only, never the network.
 * Used by [auto-live] as a fallback when the stored handle URL itself 404s
 * (renamed handle): a previously successful resolution still finds the show.
 */
export async function cachedUserChannelId(
  db: Queryable,
  userId: string,
  rawUrl: string,
): Promise<string | null> {
  const direct = directChannelId(rawUrl)
  if (direct) return direct
  try {
    const row = (await db.query(
      'select channel_id from user_youtube_links where user_id=$1 and url=$2 limit 1',
      [userId, rawUrl],
    )).rows[0]
    const id = String(row?.channel_id || '').trim()
    return CHANNEL_ID_RE.test(id) ? id : null
  } catch {
    // Slim test schema without the column — behave like an empty cache.
    return null
  }
}

/**
 * Resolve a member's stored URL to its UC… channel id: persisted cache first,
 * then a page scrape whose result is written back to user_youtube_links.
 * `forceRefresh` bypasses the cached value (used after a feed 404 to heal a
 * stale id, e.g. a deleted-and-recreated channel).
 */
export async function resolveUserChannelId(
  db: Queryable,
  userId: string,
  rawUrl: string,
  fetchFn: FetchLike,
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  const direct = directChannelId(rawUrl)
  if (direct) return direct
  if (!options.forceRefresh) {
    const cached = await cachedUserChannelId(db, userId, rawUrl)
    if (cached) return cached
  }
  const scraped = await scrapeYouTubeChannelId(rawUrl, fetchFn)
  if (!scraped) return null
  try {
    await db.query(
      'update user_youtube_links set channel_id=$3 where user_id=$1 and url=$2',
      [userId, rawUrl, scraped],
    )
  } catch { /* slim schema without the column — resolve again next cycle */ }
  return scraped
}

// ---------------------------------------------------------------------------
// Once-per-day notice gate. A channel that is genuinely dead (renamed handle,
// deleted account) fails IDENTICALLY on every cycle; repeating that line every
// 90s/5min is pure log spam. Keyed by caller-chosen string (scanner + user +
// message) so a NEW failure mode for the same user still logs immediately.
// In-memory on purpose: the distributed lease keeps one scanning instance at a
// time, and a fresh revision logging each known failure once is a feature.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000
const noticeLog = new Map<string, number>()

export function shouldLogDailyNotice(key: string, now = Date.now()): boolean {
  const last = noticeLog.get(key)
  if (last != null && now - last < DAY_MS) return false
  if (noticeLog.size > 1000) {
    for (const [k, at] of noticeLog) { if (now - at >= DAY_MS) noticeLog.delete(k) }
  }
  noticeLog.set(key, now)
  return true
}

/** Test hook — clears the daily-notice memory. */
export function resetDailyNotices(): void {
  noticeLog.clear()
}
