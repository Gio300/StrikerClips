/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto'
import {
  closeExternalLiveSource,
  queueMediaAnalysis,
  registerMediaSource,
} from './mediaEvidence'
import { finishLiveMatchStates } from './liveMatchState'
import { withDistributedLease } from './distributedLease'
import {
  cachedUserChannelId,
  normalizeYouTubeChannelUrl,
  shouldLogDailyNotice,
} from './youtubeChannel'
import { normalizeConnectedYouTubeChannelUrl } from '../src/lib/signupYouTube'

// URL normalization moved to the shared resolver module (server/youtubeChannel.ts,
// also used by [auto-youtube]); re-exported so existing importers keep working.
export { normalizeYouTubeChannelUrl } from './youtubeChannel'

export type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

export type YouTubeLiveProbe = {
  status: 'live' | 'offline' | 'unknown'
  channelUrl: string
  watchUrl: string | null
  externalStreamId: string | null
  title: string | null
  confidence: number
  method: 'youtube-data-api' | 'youtube-live-page' | 'error'
  detail?: string
}

type FetchLike = typeof fetch

export type YouTubeProbeTrace = {
  endpoint: string
  finalUrl: string
  httpStatus: number
  directVideoEndpoint: boolean
  channelId: string | null
  videoId: string | null
  explicitLiveNow: boolean
  explicitNotLiveNow: boolean
  playableNow: boolean
  hasLiveStreamability: boolean
  hasOfflineSlate: boolean
  innerTubeAvailable?: boolean
  innerTubeStatus?: 'live' | 'offline' | 'unknown'
  dataApiStatus?: 'live' | 'offline' | 'unknown'
}

function parseMetadata(value: unknown): Record<string, any> {
  if (typeof value !== 'string') return (value && typeof value === 'object') ? value as Record<string, any> : {}
  try { return JSON.parse(value) } catch { return {} }
}

/**
 * A connected account is eligible from signup day. Paid tiers control render
 * quality/allowances later in the pipeline; they must not prevent discovery,
 * combat verification, or the member's evidence-backed power from updating.
 * Per-member switches such as auto_detect_live and auto_merge_opt_out are
 * enforced by the callers before this shared eligibility check.
 */
export function automaticLiveEligible(_metadata: unknown, _now = Date.now()): boolean {
  return true
}

export function youtubeLiveEndpoint(raw: string): string | null {
  const normalized = normalizeYouTubeChannelUrl(raw)
  if (!normalized) return null
  const url = new URL(normalized)
  if (url.pathname === '/watch' || url.pathname.startsWith('/shorts/')) return normalized
  const path = url.pathname.replace(/\/$/, '')
  if (path.endsWith('/live')) return `https://www.youtube.com${path}`
  return `https://www.youtube.com${path}/live`
}

function decodeJsonString(raw: string | undefined): string | null {
  if (!raw) return null
  try { return JSON.parse(`"${raw}"`) } catch { return raw.replace(/\\u0026/g, '&').replace(/\\n/g, ' ') }
}

function videoIdFrom(url: string, html: string): string | null {
  try {
    const parsed = new URL(url)
    const direct = parsed.searchParams.get('v')
      || (parsed.pathname.startsWith('/shorts/') ? parsed.pathname.split('/')[2] : null)
      || (parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1) : null)
    if (direct && /^[\w-]{6,20}$/.test(direct)) return direct
  } catch { /* parse HTML below */ }
  const canonical = html.match(/(?:canonicalURL|canonicalUrl)"\s*:\s*"https?:\\?\/\\?\/www\.youtube\.com\\?\/watch\?v=([\w-]{6,20})/i)?.[1]
  if (canonical) return canonical
  return html.match(/"videoId"\s*:\s*"([\w-]{6,20})"/)?.[1] || null
}

function titleFrom(html: string): string | null {
  const playerTitle = html.match(/"videoDetails"\s*:\s*\{[\s\S]{0,2500}?"title"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1]
  if (playerTitle) return decodeJsonString(playerTitle)
  const og = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/i)?.[1]
  return og ? og.replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null
}

function channelIdFrom(html: string): string | null {
  return html.match(/"channelId"\s*:\s*"(UC[\w-]{20,})"/)?.[1]
    || html.match(/"externalId"\s*:\s*"(UC[\w-]{20,})"/)?.[1]
    || null
}

type DataApiLiveEvidence = {
  status: 'live' | 'offline' | 'unknown'
  title: string | null
}

let youtubeOAuthTokenCache: { token: string; expiresAt: number } | null = null
const youtubeChannelCache = new Map<string, {
  channelId: string
  uploadsPlaylistId: string
  channelTitle: string | null
}>()

async function youtubeOAuthAccessToken(fetchFn: FetchLike): Promise<string | null> {
  if (youtubeOAuthTokenCache && youtubeOAuthTokenCache.expiresAt > Date.now() + 60_000) {
    return youtubeOAuthTokenCache.token
  }
  const clientId = String(process.env.YOUTUBE_CLIENT_ID || '').trim()
  const clientSecret = String(process.env.YOUTUBE_CLIENT_SECRET || '').trim()
  const refreshToken = String(process.env.YOUTUBE_REFRESH_TOKEN || '').trim()
  if (!clientId || !clientSecret || !refreshToken) return null
  try {
    const response = await fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    if (!response.ok) return null
    const body = await response.json() as any
    const token = String(body?.access_token || '').trim()
    if (!token) return null
    const expiresIn = Math.max(300, Number(body?.expires_in) || 3600)
    youtubeOAuthTokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 }
    return token
  } catch {
    return null
  }
}

/** Verify one already-discovered candidate. videos.list costs one quota unit. */
async function probeVideoWithDataApi(
  videoId: string,
  apiKey: string | undefined,
  oauthToken: string | undefined,
  fetchFn: FetchLike,
): Promise<DataApiLiveEvidence> {
  if (!apiKey && !oauthToken) return { status: 'unknown', title: null }
  try {
    const endpoint = new URL('https://www.googleapis.com/youtube/v3/videos')
    const query: Record<string, string> = {
      part: 'snippet,liveStreamingDetails',
      id: videoId,
    }
    if (apiKey) query.key = apiKey
    endpoint.search = new URLSearchParams(query).toString()
    const response = await fetchFn(endpoint, {
      signal: AbortSignal.timeout(10_000),
      headers: oauthToken ? { authorization: `Bearer ${oauthToken}` } : undefined,
    })
    if (!response.ok) return { status: 'unknown', title: null }
    const body = await response.json() as any
    const item = Array.isArray(body?.items) ? body.items[0] : null
    if (!item) return { status: 'unknown', title: null }
    const title = String(item?.snippet?.title || '').trim() || null
    const broadcastState = String(item?.snippet?.liveBroadcastContent || '').toLowerCase()
    const liveDetails = item?.liveStreamingDetails || {}
    const active = broadcastState === 'live'
      || (Boolean(liveDetails?.actualStartTime) && !liveDetails?.actualEndTime
        && liveDetails?.concurrentViewers != null)
    if (active) return { status: 'live', title }
    const offline = broadcastState === 'upcoming'
      || broadcastState === 'none'
      || Boolean(liveDetails?.actualEndTime)
    return { status: offline ? 'offline' : 'unknown', title }
  } catch {
    return { status: 'unknown', title: null }
  }
}

function channelLookupFromUrl(raw: string): { parameter: 'id' | 'forHandle' | 'forUsername'; value: string } | null {
  const normalized = normalizeYouTubeChannelUrl(raw)
  if (!normalized) return null
  const parsed = new URL(normalized)
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parts[0] === 'channel' && parts[1]) return { parameter: 'id', value: parts[1] }
  if (parts[0]?.startsWith('@')) return { parameter: 'forHandle', value: parts[0] }
  if (parts[0] === 'user' && parts[1]) return { parameter: 'forUsername', value: parts[1] }
  return null
}

/**
 * Resolve a member channel through the official uploads playlist, then inspect
 * its recent broadcasts in one videos.list call. This avoids the altered HTML
 * YouTube serves to cloud IPs and costs two quota units after the channel is
 * cached (three on first lookup).
 */
async function probeChannelWithDataApi(
  rawChannelUrl: string,
  apiKey: string,
  fetchFn: FetchLike,
): Promise<YouTubeLiveProbe | null> {
  const lookup = channelLookupFromUrl(rawChannelUrl)
  if (!lookup) return null
  const cacheKey = `${lookup.parameter}:${lookup.value.toLowerCase()}`
  let channel = youtubeChannelCache.get(cacheKey)
  try {
    if (!channel) {
      const channelEndpoint = new URL('https://www.googleapis.com/youtube/v3/channels')
      channelEndpoint.search = new URLSearchParams({
        part: 'contentDetails,snippet',
        [lookup.parameter]: lookup.value,
        key: apiKey,
      }).toString()
      const response = await fetchFn(channelEndpoint, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) return null
      const body = await response.json() as any
      const item = Array.isArray(body?.items) ? body.items[0] : null
      const channelId = String(item?.id || '').trim()
      const uploadsPlaylistId = String(item?.contentDetails?.relatedPlaylists?.uploads || '').trim()
      if (!channelId || !uploadsPlaylistId) return null
      channel = {
        channelId,
        uploadsPlaylistId,
        channelTitle: String(item?.snippet?.title || '').trim() || null,
      }
      youtubeChannelCache.set(cacheKey, channel)
    }

    const playlistEndpoint = new URL('https://www.googleapis.com/youtube/v3/playlistItems')
    playlistEndpoint.search = new URLSearchParams({
      part: 'contentDetails',
      playlistId: channel.uploadsPlaylistId,
      maxResults: '25',
      key: apiKey,
    }).toString()
    const playlistResponse = await fetchFn(playlistEndpoint, { signal: AbortSignal.timeout(10_000) })
    if (!playlistResponse.ok) return null
    const playlistBody = await playlistResponse.json() as any
    const ids = (Array.isArray(playlistBody?.items) ? playlistBody.items : [])
      .map((item: any) => String(item?.contentDetails?.videoId || '').trim())
      .filter(Boolean)
    if (!ids.length) {
      return {
        status: 'offline',
        channelUrl: `https://www.youtube.com/channel/${channel.channelId}`,
        watchUrl: null,
        externalStreamId: null,
        title: channel.channelTitle,
        confidence: 0.97,
        method: 'youtube-data-api',
      }
    }

    const videosEndpoint = new URL('https://www.googleapis.com/youtube/v3/videos')
    videosEndpoint.search = new URLSearchParams({
      part: 'snippet,liveStreamingDetails',
      id: ids.join(','),
      key: apiKey,
    }).toString()
    const videosResponse = await fetchFn(videosEndpoint, { signal: AbortSignal.timeout(10_000) })
    if (!videosResponse.ok) return null
    const videosBody = await videosResponse.json() as any
    const items = Array.isArray(videosBody?.items) ? videosBody.items : []
    const live = items.find((item: any) => {
      const state = String(item?.snippet?.liveBroadcastContent || '').toLowerCase()
      const details = item?.liveStreamingDetails || {}
      return state === 'live'
        || (Boolean(details?.actualStartTime) && !details?.actualEndTime
          && details?.concurrentViewers != null)
    })
    if (live?.id) {
      const videoId = String(live.id)
      return {
        status: 'live',
        channelUrl: `https://www.youtube.com/channel/${channel.channelId}`,
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
        externalStreamId: videoId,
        title: String(live?.snippet?.title || '').trim() || null,
        confidence: 0.99,
        method: 'youtube-data-api',
        detail: 'verified from the official channel uploads feed',
      }
    }
    return {
      status: 'offline',
      channelUrl: `https://www.youtube.com/channel/${channel.channelId}`,
      watchUrl: null,
      externalStreamId: null,
      title: channel.channelTitle,
      confidence: 0.98,
      method: 'youtube-data-api',
    }
  } catch {
    return null
  }
}

type InnerTubeLiveEvidence = {
  status: 'live' | 'offline' | 'unknown'
  title: string | null
}

/**
 * Cloud providers often receive a reduced YouTube watch page with the correct
 * video id but without the public isLiveNow marker. The page still carries the
 * public WEB player configuration, so ask that same player endpoint for the
 * video's current state. This is not a private API key or a user credential.
 */
async function probeWithInnerTube(
  videoId: string,
  html: string,
  fetchFn: FetchLike,
): Promise<InnerTubeLiveEvidence> {
  const apiKey = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/i)?.[1]
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/i)?.[1]
  if (!apiKey || !clientVersion) return { status: 'unknown', title: null }

  try {
    const response = await fetchFn(
      `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Mozilla/5.0 (compatible; TKOcamLiveScanner/1.0; +https://tko.cam)',
          'accept-language': 'en-US,en;q=0.9',
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: 'WEB',
              clientVersion,
              hl: 'en',
              gl: 'US',
            },
          },
        }),
      },
    )
    if (!response.ok) return { status: 'unknown', title: null }
    const body = await response.json() as any
    const details = body?.videoDetails || {}
    const liveDetails = body?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails || {}
    const playability = body?.playabilityStatus || {}
    const offlineSlate = playability?.liveStreamability?.liveStreamabilityRenderer?.offlineSlate
    const liveNow = liveDetails?.isLiveNow === true
      || details?.isLive === true
      || (details?.isLiveContent === true
        && playability?.status === 'OK'
        && typeof body?.streamingData?.hlsManifestUrl === 'string')
    if (liveNow) {
      return {
        status: 'live',
        title: String(details?.title || '').trim() || null,
      }
    }

    const offline = liveDetails?.isLiveNow === false
      || Boolean(liveDetails?.endTimestamp)
      || playability?.status === 'LIVE_STREAM_OFFLINE'
      || Boolean(offlineSlate)
    return {
      status: offline ? 'offline' : 'unknown',
      title: String(details?.title || '').trim() || null,
    }
  } catch {
    return { status: 'unknown', title: null }
  }
}

/**
 * Read YouTube's public /live page. Positive markers are required for LIVE;
 * a fetch failure is UNKNOWN, never OFFLINE, so transient network trouble cannot
 * tear down a legitimate TKO stream.
 */
export async function probeYouTubeLive(
  rawChannelUrl: string,
  options: {
    fetchFn?: FetchLike
    apiKey?: string
    oauthAccessToken?: string
    followDepth?: number
    trace?: YouTubeProbeTrace[]
  } = {},
): Promise<YouTubeLiveProbe> {
  const channelUrl = normalizeYouTubeChannelUrl(rawChannelUrl) || rawChannelUrl
  const endpoint = youtubeLiveEndpoint(rawChannelUrl)
  if (!endpoint) {
    return { status: 'unknown', channelUrl, watchUrl: null, externalStreamId: null, title: null, confidence: 0, method: 'error', detail: 'invalid YouTube URL' }
  }
  const fetchFn = options.fetchFn || fetch
  const followDepth = options.followDepth || 0
  try {
    if (options.apiKey && followDepth === 0) {
      const channelProbe = await probeChannelWithDataApi(rawChannelUrl, options.apiKey, fetchFn)
      if (channelProbe) return channelProbe
    }
    const requestedUrl = new URL(endpoint)
    const directVideoEndpoint = requestedUrl.pathname === '/watch'
      || requestedUrl.pathname.startsWith('/shorts/')
    const response = await fetchFn(endpoint, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; TKOcamLiveScanner/1.0; +https://tko.cam)',
        'accept-language': 'en-US,en;q=0.9',
      },
    })
    if (!response.ok) {
      return { status: 'unknown', channelUrl, watchUrl: null, externalStreamId: null, title: null, confidence: 0, method: 'error', detail: `YouTube HTTP ${response.status}` }
    }
    const html = await response.text()
    const finalUrl = response.url || endpoint
    const channelId = channelIdFrom(html)

    // Archived livestreams keep `isLiveContent`, `isLiveBroadcast`, and
    // `liveBroadcastDetails` in their watch-page metadata. Those fields only
    // describe the video's type; they do not mean the broadcast is live now.
    // Requiring YouTube's explicit real-time marker prevents an ended host
    // feed from sitting forever in a TKO stage as a frozen "live" angle.
    const explicitLiveNow = /"isLiveNow"\s*:\s*true/i.test(html)
    const explicitNotLiveNow = /"isLiveNow"\s*:\s*false/i.test(html)
    const playableNow = /"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"OK"/i.test(html)
    const hasLiveStreamability = /"liveStreamability"\s*:/i.test(html)
    const hasOfflineSlate = /"offlineSlate"\s*:/i.test(html)
    const id = videoIdFrom(finalUrl, html)
    const traceEntry: YouTubeProbeTrace = {
      endpoint,
      finalUrl,
      httpStatus: response.status,
      directVideoEndpoint,
      channelId,
      videoId: id,
      explicitLiveNow,
      explicitNotLiveNow,
      playableNow,
      hasLiveStreamability,
      hasOfflineSlate,
      innerTubeAvailable: /"INNERTUBE_API_KEY"\s*:/i.test(html),
    }
    options.trace?.push(traceEntry)
    // Cloud-hosted requests sometimes receive a smaller player payload that
    // omits isLiveNow. On a DIRECT watch page, OK + liveStreamability without
    // an offline slate is YouTube's equivalent active-player signal. Scheduled
    // shows are LIVE_STREAM_OFFLINE; archives lack liveStreamability and/or
    // explicitly carry isLiveNow:false.
    const playableLiveFallback = directVideoEndpoint
      && !explicitNotLiveNow
      && playableNow
      && hasLiveStreamability
      && !hasOfflineSlate
    const positiveLiveEvidence = explicitLiveNow || playableLiveFallback
    if (positiveLiveEvidence && id) {
      return {
        status: 'live', channelUrl,
        watchUrl: `https://www.youtube.com/watch?v=${id}`,
        externalStreamId: id,
        title: titleFrom(html), confidence: 0.94, method: 'youtube-live-page',
      }
    }

    if (directVideoEndpoint && id && !explicitNotLiveNow) {
      const oauthAccessToken = options.oauthAccessToken
        || (!options.apiKey ? await youtubeOAuthAccessToken(fetchFn) : null)
        || undefined
      const dataApi = await probeVideoWithDataApi(
        id,
        options.apiKey,
        oauthAccessToken,
        fetchFn,
      )
      traceEntry.dataApiStatus = dataApi.status
      if (dataApi.status === 'live') {
        return {
          status: 'live', channelUrl,
          watchUrl: `https://www.youtube.com/watch?v=${id}`,
          externalStreamId: id,
          title: dataApi.title || titleFrom(html),
          confidence: 0.99,
          method: 'youtube-data-api',
          detail: 'verified by YouTube videos.list',
        }
      }

      const innerTube = await probeWithInnerTube(id, html, fetchFn)
      traceEntry.innerTubeStatus = innerTube.status
      if (innerTube.status === 'live') {
        return {
          status: 'live', channelUrl,
          watchUrl: `https://www.youtube.com/watch?v=${id}`,
          externalStreamId: id,
          title: innerTube.title || titleFrom(html),
          confidence: 0.96,
          method: 'youtube-live-page',
          detail: 'verified by YouTube WEB player metadata',
        }
      }
    }

    // YouTube's channel /live page identifies its current candidate video but
    // does not consistently include `isLiveNow`. Verify that candidate's watch
    // page before accepting it; this separates an active show from a scheduled
    // "starting soon" placeholder or an archived broadcast.
    if (!directVideoEndpoint && id && followDepth < 2) {
      const result = await probeYouTubeLive(`https://www.youtube.com/watch?v=${id}`, {
        ...options,
        followDepth: followDepth + 1,
      })
      return { ...result, channelUrl }
    }

    // A member may have connected TKO using a specific broadcast URL instead
    // of their channel URL. Once that broadcast ends, follow its channel to the
    // current /live page so people-search can still find the member's next
    // stream without making them reconnect YouTube for every show.
    if (directVideoEndpoint && channelId && followDepth < 2) {
      return probeYouTubeLive(`https://www.youtube.com/channel/${channelId}`, {
        ...options,
        followDepth: followDepth + 1,
      })
    }

    // A successfully rendered YouTube channel/live page with no positive live
    // marker is explicit OFFLINE evidence. A consent/challenge page is UNKNOWN.
    const renderedYouTubePage = /ytInitialData|ytInitialPlayerResponse|youtube\.com\/channel|channelId/i.test(html)
    if (renderedYouTubePage) {
      return { status: 'offline', channelUrl, watchUrl: null, externalStreamId: null, title: null, confidence: 0.86, method: 'youtube-live-page' }
    }
    return { status: 'unknown', channelUrl, watchUrl: null, externalStreamId: null, title: null, confidence: 0.1, method: 'error', detail: 'YouTube returned an unrecognized page' }
  } catch (error) {
    return { status: 'unknown', channelUrl, watchUrl: null, externalStreamId: null, title: null, confidence: 0, method: 'error', detail: (error as Error).message }
  }
}

export type AutoLiveScanSummary = {
  scanned: number
  eligible: number
  live: number
  started: number
  refreshed: number
  suppressed: number
  ended: number
  offline: number
  unknown: number
  errors: Array<{ userId: string; error: string }>
  /** Repeats of an already-logged per-user failure (once-per-day gate). */
  muted: number
}

function safeExternalId(probe: YouTubeLiveProbe): string {
  if (probe.externalStreamId) return probe.externalStreamId
  return createHash('sha256').update(probe.watchUrl || probe.channelUrl).digest('hex').slice(0, 24)
}

async function markOffline(db: Queryable, userId: string): Promise<number> {
  const activeDiscoveries = (await db.query(
    `select distinct external_stream_id, live_stream_id from auto_live_discoveries
      where user_id=$1 and provider='youtube' and status='live'`,
    [userId],
  )).rows
  const closed = await db.query(
    `update live_streams
        set is_live=false, host_feed_status='stopped', updated_at=now()
      where user_id=$1 and is_live=true
        and (
          source='auto_youtube'
          or id in (
            select live_stream_id from auto_live_discoveries
             where user_id=$1 and provider='youtube' and status='live'
               and live_stream_id is not null
          )
        )
      returning id`,
    [userId],
  )
  await db.query(
    `update auto_live_discoveries
        set status='ended', ended_at=coalesce(ended_at,now()), last_seen_at=now()
      where user_id=$1 and status='live'`,
    [userId],
  )
  for (const discovery of activeDiscoveries) {
    const externalId = String(discovery.external_stream_id || '').trim()
    if (externalId) await closeExternalLiveSource(db, 'youtube', externalId)
  }
  const streamIds = closed.rows.map((row) => String(row.id || '')).filter(Boolean)
  for (const streamId of streamIds) {
    await db.query(
      "update live_stream_angles set status='stopped' where live_stream_id=$1 and status <> 'stopped'",
      [streamId],
    )
  }
  await finishLiveMatchStates(db, streamIds)
  return closed.rows.length
}

async function recordLive(
  db: Queryable,
  row: any,
  probe: YouTubeLiveProbe,
): Promise<'started' | 'refreshed' | 'suppressed'> {
  const userId = String(row.user_id)
  const externalId = safeExternalId(probe)
  const watchUrl = probe.watchUrl || probe.channelUrl
  const priorDiscovery = (await db.query(
    `select status,details from auto_live_discoveries
      where user_id=$1 and provider='youtube' and external_stream_id=$2`,
    [userId, externalId],
  )).rows[0]
  if (priorDiscovery?.status === 'ended' && parseMetadata(priorDiscovery.details).manual_stop === true) {
    return 'suppressed'
  }
  await db.query(
    `update live_streams
        set is_live=false, host_feed_status='stopped', updated_at=now()
      where user_id=$1 and is_live=true and source='auto_youtube'
        and coalesce(external_stream_id,'') <> $2`,
    [userId, externalId],
  )

  let active = (await db.query(
    `select id, source from live_streams
      where user_id=$1 and is_live=true
      order by coalesce(updated_at,created_at) desc limit 1`,
    [userId],
  )).rows[0]
  let result: 'started' | 'refreshed' = 'refreshed'
  if (active) {
    await db.query(
      `update live_streams
          set updated_at=now(), host_feed_status='live',
              youtube_url=$2,
              title=case when source='auto_youtube' then coalesce($3,title) else title end,
              external_stream_id=$4
        where id=$1`,
      [active.id, watchUrl, probe.title, externalId],
    )
  } else {
    const inserted = await db.query(
      `insert into live_streams
         (user_id,youtube_url,title,is_live,placement,source,external_stream_id,detected_live_at,updated_at)
       values ($1,$2,$3,true,'profile','auto_youtube',$4,now(),now()) returning id, source`,
      [userId, watchUrl, probe.title || `${row.username || 'TKO player'} is live`, externalId],
    )
    active = inserted.rows[0]
    result = 'started'
  }

  // A manually assembled show may already have this member reserved as an
  // angle. Replace a stale channel/handle URL with the concrete watch URL as
  // soon as the scanner finds the broadcast.
  await db.query(
    `update live_stream_angles
        set youtube_url=$2, status='live'
      where user_id=$1
        and live_stream_id in (select id from live_streams where is_live=true)`,
    [userId, watchUrl],
  )

  await db.query(
    `insert into auto_live_discoveries
       (user_id,provider,external_stream_id,channel_url,watch_url,title,status,
        detection_method,confidence,live_stream_id,first_seen_at,last_seen_at,ended_at,details)
     values ($1,'youtube',$2,$3,$4,$5,'live',$6,$7,$8,now(),now(),null,$9::jsonb)
     on conflict (user_id,provider,external_stream_id) do update set
       watch_url=excluded.watch_url, title=coalesce(excluded.title,auto_live_discoveries.title),
       status='live', detection_method=excluded.detection_method, confidence=excluded.confidence,
       live_stream_id=excluded.live_stream_id, last_seen_at=now(), ended_at=null,
       details=excluded.details`,
    [userId, externalId, probe.channelUrl, watchUrl, probe.title, probe.method, probe.confidence,
      active.id, JSON.stringify({ scanner: 'tko-server-v1' })],
  )
  const mediaSource = await registerMediaSource(db, {
    ownerId: userId,
    liveStreamId: String(active.id),
    provider: 'youtube',
    sourceKind: 'youtube_live',
    externalId,
    sourceUrl: watchUrl,
    status: 'recording',
    recordedAt: new Date(),
    metadata: {
      title: probe.title,
      channel_url: probe.channelUrl,
      detection_method: probe.method,
      detection_confidence: probe.confidence,
      live_stream_id: String(active.id),
    },
  })
  await queueMediaAnalysis(
    db,
    String(mediaSource.id),
    result === 'started' ? 'auto_live_started' : 'auto_live_snapshot',
  )
  return result
}

export async function runAutoLiveScan(
  db: Queryable,
  options: { fetchFn?: FetchLike; apiKey?: string; now?: number } = {},
): Promise<AutoLiveScanSummary> {
  const summary: AutoLiveScanSummary = {
    scanned: 0, eligible: 0, live: 0, started: 0, refreshed: 0,
    suppressed: 0, ended: 0, offline: 0, unknown: 0, errors: [], muted: 0,
  }
  // A permanently dead channel link produces the SAME probe failure every 90s;
  // record it once per day per user per failure mode, count the repeats.
  const noteError = (userId: string, message: string) => {
    if (shouldLogDailyNotice(`auto-live:${userId}:${message}`, options.now)) {
      summary.errors.push({ userId, error: message })
    } else {
      summary.muted++
    }
  }
  const rows = (await db.query(
    `select yl.user_id, yl.url, yl.created_at, p.username,
            coalesce(p.auto_detect_live,true) as auto_detect_live,
            u.user_metadata
       from user_youtube_links yl
       join users u on u.id=yl.user_id
       left join profiles p on p.id=yl.user_id
      order by yl.created_at desc`,
  )).rows
  const seen = new Set<string>()
  for (const row of rows) {
    const userId = String(row.user_id || '')
    const channelUrl = normalizeConnectedYouTubeChannelUrl(row.url)
    // Individual watch links are saved here too; they are clip sources, not
    // the member's account channel, even when they are the newest row.
    if (!channelUrl) continue
    if (!userId || seen.has(userId)) continue
    seen.add(userId)
    summary.scanned++
    if (row.auto_detect_live === false || !automaticLiveEligible(row.user_metadata, options.now)) continue
    summary.eligible++
    try {
      const probeOptions = {
        fetchFn: options.fetchFn,
        apiKey: options.apiKey || process.env.YOUTUBE_API_KEY,
      }
      let probe = await probeYouTubeLive(channelUrl, probeOptions)
      if (probe.status === 'unknown' && /^YouTube HTTP 404$/.test(probe.detail || '')) {
        // The stored handle/custom URL itself is gone (typically a renamed
        // handle). If a previous successful resolution persisted the UC… id
        // (shared cache with [auto-youtube]), the member's show is still
        // findable through the immutable channel URL.
        const channelId = await cachedUserChannelId(db, userId, channelUrl)
        if (channelId) {
          probe = await probeYouTubeLive(`https://www.youtube.com/channel/${channelId}`, probeOptions)
        }
      }
      if (probe.status === 'live') {
        summary.live++
        const outcome = await recordLive(db, row, probe)
        summary[outcome]++
      } else if (probe.status === 'offline') {
        summary.offline++
        summary.ended += await markOffline(db, userId)
      } else {
        summary.unknown++
        if (probe.detail) noteError(userId, probe.detail)
      }
    } catch (error) {
      summary.unknown++
      noteError(userId, (error as Error).message)
    }
  }
  return summary
}

export function startAutoLiveScanner(db: Queryable): { stop: () => void } {
  if (/^(1|true|yes)$/i.test(String(process.env.AUTO_LIVE_SCAN_DISABLED || ''))) {
    return { stop() {} }
  }
  const requested = Number(process.env.AUTO_LIVE_SCAN_INTERVAL_SECONDS || 90)
  const intervalMs = Math.max(30, Number.isFinite(requested) ? requested : 90) * 1000
  let running = false
  const scan = async () => {
    if (running) return
    running = true
    try {
      const leased = await withDistributedLease(db, 'auto-live-scan', 10 * 60, async () => {
        const result = await runAutoLiveScan(db)
        console.log('[auto-live] scan', JSON.stringify(result))
        return result
      })
      if (!leased.acquired) console.log('[auto-live] scan skipped; another instance owns the lease')
    } catch (error) {
      console.warn('[auto-live] scan failed:', (error as Error).message)
    } finally {
      running = false
    }
  }
  const first = setTimeout(() => void scan(), 8_000)
  const timer = setInterval(() => void scan(), intervalMs)
  timer.unref?.()
  first.unref?.()
  return { stop() { clearTimeout(first); clearInterval(timer) } }
}
