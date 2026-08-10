/* eslint-disable @typescript-eslint/no-explicit-any */
import { automaticLiveEligible, type Queryable } from './autoLive'
import { queueMediaAnalysis, registerMediaSource } from './mediaEvidence'
import { isOnOrAfterSignupDay } from './mediaSignupEligibility'
import { withDistributedLease } from './distributedLease'
import { resolveUserChannelId, shouldLogDailyNotice } from './youtubeChannel'
import { normalizeConnectedYouTubeChannelUrl } from '../src/lib/signupYouTube'

// Channel-id extraction lives in the shared resolver now (server/youtubeChannel.ts,
// also used by [auto-live]); re-exported so existing importers keep working.
export { youtubeChannelIdFromPage } from './youtubeChannel'

type FetchLike = typeof fetch

export type YouTubeFeedEntry = {
  videoId: string
  watchUrl: string
  title: string | null
  publishedAt: string | null
}

const SHINOBI_TITLE_SIGNAL = /\b(?:shinobi(?:\s+striker)?|naruto(?:\s+to\s+boruto)?|ninja\s+world\s+league|combat\s+battle|flag\s+battle|base\s+battle|barrier\s+battle|survival\s+exercise)\b/i
const CLEARLY_OTHER_GAME_SIGNAL = /\b(?:fortnite|marvel(?:\s+rivals)?|x[ -]?men|spider[ -]?man|power\s+rangers?|overwatch|destiny\s*2|dragon\s*ball|dbs|pokemon|warzone|call\s+of\s+duty)\b/i

/**
 * Title metadata is only a cheap negative filter. Vague titles continue to
 * frame analysis; an explicit other-game title is skipped unless it also says
 * Shinobi/Naruto. Final upload eligibility is based on detected match frames,
 * never this title heuristic.
 */
export function isClearlyNonShinobiUploadTitle(title: unknown): boolean {
  const value = String(title || '').trim()
  return Boolean(value) && CLEARLY_OTHER_GAME_SIGNAL.test(value) && !SHINOBI_TITLE_SIGNAL.test(value)
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function tag(block: string, name: string): string | null {
  const escaped = name.replace(':', '\\:')
  const value = block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'))?.[1]
  return value == null ? null : decodeXml(value.replace(/<!\[CDATA\[|\]\]>/g, '').trim())
}

export function parseYouTubeFeed(xml: string): YouTubeFeedEntry[] {
  const entries = String(xml || '').match(/<entry\b[\s\S]*?<\/entry>/gi) || []
  const seen = new Set<string>()
  const parsed: YouTubeFeedEntry[] = []
  for (const entry of entries) {
    const videoId = String(tag(entry, 'yt:videoId') || '').trim()
    if (!/^[\w-]{6,20}$/.test(videoId) || seen.has(videoId)) continue
    seen.add(videoId)
    const href = entry.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1]
    parsed.push({
      videoId,
      watchUrl: decodeXml(href || `https://www.youtube.com/watch?v=${videoId}`),
      title: tag(entry, 'title'),
      publishedAt: tag(entry, 'published'),
    })
  }
  return parsed
}

export type AutoYouTubeSummary = {
  scanned: number
  eligible: number
  feeds: number
  discovered: number
  queued: number
  existing: number
  skippedPreSignup: number
  skippedNonCombat: number
  errors: Array<{ userId: string; error: string }>
  /** Repeats of an already-logged per-user failure (once-per-day gate). */
  muted: number
}

export async function runAutoYouTubeScan(
  db: Queryable,
  options: { fetchFn?: FetchLike; now?: number; maxEntries?: number } = {},
): Promise<AutoYouTubeSummary> {
  const fetchFn = options.fetchFn || fetch
  const maxEntries = Math.max(1, Math.min(30, Math.round(options.maxEntries || 15)))
  const summary: AutoYouTubeSummary = {
    scanned: 0,
    eligible: 0,
    feeds: 0,
    discovered: 0,
    queued: 0,
    existing: 0,
    skippedPreSignup: 0,
    skippedNonCombat: 0,
    errors: [],
    muted: 0,
  }
  const fetchFeed = (channelId: string) => fetchFn(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
    {
      signal: AbortSignal.timeout(12_000),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; TKOcamUploadScanner/1.0; +https://tko.cam)',
        'accept-language': 'en-US,en;q=0.9',
      },
    },
  )
  const rows = (await db.query(
    `select yl.user_id,yl.url,yl.created_at,u.user_metadata,u.created_at as user_created_at,
            coalesce(p.auto_merge_opt_out,false) as auto_merge_opt_out
       from user_youtube_links yl
       join users u on u.id=yl.user_id
       left join profiles p on p.id=yl.user_id
      order by yl.created_at desc`,
  )).rows
  const seenUsers = new Set<string>()
  for (const row of rows) {
    const userId = String(row.user_id || '').trim()
    const channelUrl = normalizeConnectedYouTubeChannelUrl(row.url)
    if (!channelUrl) continue
    if (!userId || seenUsers.has(userId)) continue
    seenUsers.add(userId)
    summary.scanned++
    if (row.auto_merge_opt_out === true || !automaticLiveEligible(row.user_metadata, options.now)) continue
    summary.eligible++
    try {
      // Persisted cache first (user_youtube_links.channel_id): steady state is
      // ONE feed fetch per member per cycle — the handle page is only scraped
      // on first sight, which is what stopped the per-cycle 404/timeout noise
      // YouTube feeds cloud egress IPs under request pressure.
      let channelId = await resolveUserChannelId(db, userId, channelUrl, fetchFn)
      if (!channelId) throw new Error('could not resolve YouTube channel id')
      let feedResponse = await fetchFeed(channelId)
      if (feedResponse.status === 404) {
        // Either the persisted id went stale (channel deleted + recreated) or
        // YouTube served a transient cloud-IP 404. Re-resolve fresh from the
        // page once and retry before declaring the feed dead.
        const fresh = await resolveUserChannelId(db, userId, channelUrl, fetchFn, { forceRefresh: true })
          .catch(() => null)
        if (fresh && fresh !== channelId) {
          channelId = fresh
          feedResponse = await fetchFeed(channelId)
        }
      }
      if (!feedResponse.ok) throw new Error(`YouTube feed HTTP ${feedResponse.status}`)
      summary.feeds++
      const liveIds = new Set((await db.query(
        `select external_stream_id from auto_live_discoveries
          where user_id=$1 and provider='youtube' and status='live'`,
        [userId],
      )).rows.map((item) => String(item.external_stream_id || '')))
      for (const entry of parseYouTubeFeed(await feedResponse.text()).slice(0, maxEntries)) {
        if (liveIds.has(entry.videoId)) continue
        summary.discovered++
        if (!isOnOrAfterSignupDay(entry.publishedAt, row.user_created_at)) {
          summary.skippedPreSignup++
          continue
        }
        if (isClearlyNonShinobiUploadTitle(entry.title)) {
          summary.skippedNonCombat++
          continue
        }
        const source = await registerMediaSource(db, {
          ownerId: userId,
          provider: 'youtube',
          sourceKind: 'youtube_upload',
          externalId: entry.videoId,
          sourceUrl: entry.watchUrl,
          status: 'queued',
          recordedAt: entry.publishedAt,
          metadata: { title: entry.title, channel_id: channelId, discovery: 'youtube_atom_feed' },
        })
        if (String(source.status) === 'complete') {
          summary.existing++
          continue
        }
        await queueMediaAnalysis(db, String(source.id), 'auto_youtube_upload_discovered')
        summary.queued++
      }
    } catch (error) {
      // A dead channel fails identically every cycle; log it once per day per
      // user per failure mode instead of spamming every 5 minutes.
      const message = (error as Error).message
      if (shouldLogDailyNotice(`auto-youtube:${userId}:${message}`, options.now)) {
        summary.errors.push({ userId, error: message })
      } else {
        summary.muted++
      }
    }
  }
  return summary
}

export function startAutoYouTubeScanner(db: Queryable): { stop: () => void } {
  if (/^(1|true|yes)$/i.test(String(process.env.AUTO_YOUTUBE_SCAN_DISABLED || ''))) {
    return { stop() {} }
  }
  const requested = Number(process.env.AUTO_YOUTUBE_SCAN_INTERVAL_SECONDS || 300)
  const intervalMs = Math.max(60, Number.isFinite(requested) ? requested : 300) * 1000
  let running = false
  const scan = async () => {
    if (running) return
    running = true
    try {
      const leased = await withDistributedLease(db, 'auto-youtube-scan', 20 * 60, async () => {
        const result = await runAutoYouTubeScan(db)
        console.log('[auto-youtube] scan', JSON.stringify(result))
        return result
      })
      if (!leased.acquired) console.log('[auto-youtube] scan skipped; another instance owns the lease')
    } catch (error) {
      console.warn('[auto-youtube] scan failed:', (error as Error).message)
    } finally {
      running = false
    }
  }
  const first = setTimeout(() => void scan(), 20_000)
  const timer = setInterval(() => void scan(), intervalMs)
  timer.unref?.()
  first.unref?.()
  return { stop() { clearTimeout(first); clearInterval(timer) } }
}
