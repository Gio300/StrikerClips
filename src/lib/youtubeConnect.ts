/**
 * Connect YouTube — pull a creator's own uploads so they never paste a link.
 *
 * Two modes, same UI:
 *
 *  1. CONNECTED (full auto): if a Google OAuth Client ID is configured
 *     (VITE_YT_CLIENT_ID), we use Google Identity Services' token client to get
 *     a read-only access token *entirely client-side* — no backend, no secret —
 *     then call YouTube Data API v3 to list the user's uploads playlist. The
 *     `youtube.readonly` scope only lets us READ their videos.
 *
 *  2. MANUAL (works today, zero setup): the user adds their channel handle or a
 *     few video links once; we build the same LibraryVideo[] and cache it. Every
 *     video still gets a real thumbnail. This is the fallback until the Client ID
 *     is set on tko.cam.
 *
 * Thumbnails need no API key: https://i.ytimg.com/vi/<id>/hqdefault.jpg is public.
 */

import type { LibraryVideo } from './describeClip'
import { extractYouTubeId } from './youtubeApi'
import {
  normalizeConnectedYouTubeChannelUrl,
  youtubeHandleFromChannelUrl,
} from './signupYouTube'

const CLIENT_ID = import.meta.env.VITE_YT_CLIENT_ID as string | undefined
const API_KEY = import.meta.env.VITE_YT_API_KEY as string | undefined
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly'

/** True when tko.cam has a Google OAuth Client ID wired up. */
export function isYouTubeConnectConfigured(): boolean {
  return typeof CLIENT_ID === 'string' && CLIENT_ID.length > 0
}

export function thumbUrl(videoId: string, quality: 'default' | 'mq' | 'hq' | 'maxres' = 'hq'): string {
  const name =
    quality === 'default' ? 'default'
    : quality === 'mq' ? 'mqdefault'
    : quality === 'maxres' ? 'maxresdefault'
    : 'hqdefault'
  return `https://i.ytimg.com/vi/${videoId}/${name}.jpg`
}

// ---- Google Identity Services loader ---------------------------------------

type TokenClient = { requestAccessToken: (opts?: { prompt?: string }) => void }
declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (cfg: {
            client_id: string
            scope: string
            callback: (resp: { access_token?: string; error?: string }) => void
          }) => TokenClient
        }
      }
    }
  }
}

let gisPromise: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisPromise) return gisPromise
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Google sign-in'))
    document.head.appendChild(s)
  })
  return gisPromise
}

/** Run the OAuth popup and resolve with a read-only access token. */
export async function connectYouTube(): Promise<string> {
  if (!isYouTubeConnectConfigured()) {
    throw new Error('YouTube Connect is not configured yet (missing VITE_YT_CLIENT_ID).')
  }
  await loadGis()
  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new Error('Google sign-in unavailable')
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID!,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) reject(new Error(resp.error || 'Authorization cancelled'))
        else resolve(resp.access_token)
      },
    })
    client.requestAccessToken({ prompt: '' })
  })
}

// ---- YouTube Data API v3 ----------------------------------------------------

async function ytFetch(path: string, params: Record<string, string>, accessToken?: string) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  if (!accessToken && API_KEY) url.searchParams.set('key', API_KEY)
  const res = await fetch(url.toString(), {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  })
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

type PlaylistItem = {
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
    videoOwnerChannelTitle?: string
    resourceId?: { videoId?: string }
  }
}

/**
 * Pull the connected account's uploads (newest first). Requires a token from
 * connectYouTube(). Pages until `max` videos or the playlist ends.
 */
export async function fetchMyUploads(accessToken: string, max = 200): Promise<LibraryVideo[]> {
  const ch = await ytFetch('channels', { part: 'contentDetails', mine: 'true' }, accessToken)
  const uploads: string | undefined = ch?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!uploads) return []

  const out: LibraryVideo[] = []
  let pageToken = ''
  while (out.length < max) {
    const page = await ytFetch(
      'playlistItems',
      { part: 'snippet', playlistId: uploads, maxResults: '50', ...(pageToken ? { pageToken } : {}) },
      accessToken,
    )
    for (const it of (page.items ?? []) as PlaylistItem[]) {
      const id = it.snippet?.resourceId?.videoId
      if (!id) continue
      out.push({
        id,
        title: it.snippet?.title ?? '',
        description: it.snippet?.description ?? '',
        publishedAt: it.snippet?.publishedAt ? Date.parse(it.snippet.publishedAt) : Date.now(),
        channelTitle: it.snippet?.videoOwnerChannelTitle,
      })
      if (out.length >= max) break
    }
    if (!page.nextPageToken) break
    pageToken = page.nextPageToken
  }
  return out
}

// ---- Handle mode (no OAuth — works inside the mobile WebView) ---------------

/** True when a YouTube Data API key is configured (enables handle → uploads). */
export function isYouTubeApiConfigured(): boolean {
  return typeof API_KEY === 'string' && API_KEY.length > 0
}

function cleanHandle(raw: string): string {
  const s = raw.trim()
  const m = s.match(/@([A-Za-z0-9._-]+)/)
  if (m) return m[1]
  return s.replace(/^@/, '').replace(/\/.*$/, '')
}

/**
 * Pull a channel's public uploads from just a @handle — no OAuth, so it works in
 * the installed mobile app (where Google blocks the OAuth popup). Needs a
 * YouTube Data API key (VITE_YT_API_KEY). Resolves handle → uploads playlist →
 * videos. Returns [] (and callers surface a hint) when no key is configured.
 */
export async function fetchUploadsByHandle(handle: string, max = 200): Promise<LibraryVideo[]> {
  if (!isYouTubeApiConfigured()) return []
  const h = cleanHandle(handle)
  if (!h) return []
  const ch = await ytFetch('channels', { part: 'contentDetails', forHandle: `@${h}` }, undefined)
  const uploads: string | undefined = ch?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!uploads) return []
  const out: LibraryVideo[] = []
  let pageToken = ''
  while (out.length < max) {
    const page = await ytFetch(
      'playlistItems',
      { part: 'snippet', playlistId: uploads, maxResults: '50', ...(pageToken ? { pageToken } : {}) },
      undefined,
    )
    for (const it of (page.items ?? []) as PlaylistItem[]) {
      const id = it.snippet?.resourceId?.videoId
      if (!id) continue
      out.push({
        id,
        title: it.snippet?.title ?? '',
        description: it.snippet?.description ?? '',
        publishedAt: it.snippet?.publishedAt ? Date.parse(it.snippet.publishedAt) : Date.now(),
        channelTitle: it.snippet?.videoOwnerChannelTitle,
      })
      if (out.length >= max) break
    }
    if (!page.nextPageToken) break
    pageToken = page.nextPageToken
  }
  return out
}

// ---- TKO's own channel (the produced-video showcase) -----------------------

/**
 * TKO's YouTube uploads playlist. Every auto-matched multi-angle video the
 * pipeline assembles is posted to the TKO channel, so this playlist IS the
 * catalogue of produced videos. Fetching it (public Data API, no OAuth) is how
 * the in-app feed showcases the TKO channel — every play drives views there,
 * and a user's own raw upload can never sneak in because it's not on this
 * channel. Channel UCNyS_K597LOfc-dJwKjRgBg → uploads UUNyS_K597LOfc-dJwKjRgBg.
 */
export const TKO_UPLOADS_PLAYLIST = 'UUNyS_K597LOfc-dJwKjRgBg'

export interface TkoUpload {
  id: string
  title: string
  description: string
  publishedAt: number
}

/** Recent uploads on the TKO channel, newest first. [] if no API key / on error. */
export async function fetchTkoUploads(max = 24): Promise<TkoUpload[]> {
  if (!isYouTubeApiConfigured()) return []
  const out: TkoUpload[] = []
  let pageToken = ''
  while (out.length < max) {
    let page: { items?: PlaylistItem[]; nextPageToken?: string }
    try {
      page = await ytFetch(
        'playlistItems',
        { part: 'snippet', playlistId: TKO_UPLOADS_PLAYLIST, maxResults: '50', ...(pageToken ? { pageToken } : {}) },
        undefined,
      )
    } catch {
      break // key/quota/network — caller falls back gracefully
    }
    for (const it of (page.items ?? []) as PlaylistItem[]) {
      const id = it.snippet?.resourceId?.videoId
      if (!id) continue
      out.push({
        id,
        title: it.snippet?.title ?? '',
        description: it.snippet?.description ?? '',
        publishedAt: it.snippet?.publishedAt ? Date.parse(it.snippet.publishedAt) : Date.now(),
      })
      if (out.length >= max) break
    }
    if (!page.nextPageToken) break
    pageToken = page.nextPageToken
  }
  return out
}

// ---- Manual mode (no OAuth needed) -----------------------------------------

/**
 * Turn pasted URLs/IDs into library records. Titles/dates aren't available
 * without the API, so we leave them blank (thumbnails still resolve from the id)
 * and stamp `now` so recency sorting still works. When VITE_YT_API_KEY is set we
 * enrich titles/descriptions/dates via the public `videos` endpoint.
 */
export function videosFromLinks(links: string[]): LibraryVideo[] {
  const seen = new Set<string>()
  const out: LibraryVideo[] = []
  for (const raw of links) {
    const id = extractYouTubeId(raw.trim())
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, title: '', description: '', publishedAt: Date.now() })
  }
  return out
}

/** Optional metadata enrichment for manual mode when an API key is present. */
export async function enrichVideos(videos: LibraryVideo[]): Promise<LibraryVideo[]> {
  if (!API_KEY || videos.length === 0) return videos
  const byId = new Map(videos.map((v) => [v.id, v]))
  const ids = [...byId.keys()]
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    try {
      const page = await ytFetch('videos', { part: 'snippet', id: chunk.join(',') }, undefined)
      for (const it of (page.items ?? []) as (PlaylistItem & { id?: string })[]) {
        const rec = it.id ? byId.get(it.id) : undefined
        if (!rec) continue
        rec.title = it.snippet?.title ?? rec.title
        rec.description = it.snippet?.description ?? rec.description
        rec.publishedAt = it.snippet?.publishedAt ? Date.parse(it.snippet.publishedAt) : rec.publishedAt
      }
    } catch {
      /* enrichment is best-effort */
    }
  }
  return [...byId.values()]
}

// ---- Remembering the user's channel so they never re-paste ------------------

const handleKey = (userId: string) => `kc_yt_handle_${userId}`

/** Persist the user's YouTube @handle so Go Live can use it automatically. */
export function saveHandle(userId: string, handle: string): void {
  try {
    const clean = (handle || '').trim().replace(/^@/, '').replace(/\/.*$/, '')
    if (clean) localStorage.setItem(handleKey(userId), clean)
  } catch { /* ignore */ }
}

/** The user's saved YouTube @handle (no leading @), or null. */
export function loadHandle(userId: string): string | null {
  try { return localStorage.getItem(handleKey(userId)) || null } catch { return null }
}

/** The canonical "go live" URL for a channel handle — its live tab. */
export function youtubeLiveUrl(handle: string): string {
  return `https://www.youtube.com/@${handle.replace(/^@/, '')}/live`
}

const channelKey = (userId: string) => `kc_yt_channel_${userId}`

/** Persist the user's resolved YouTube channel id (UC…). */
export function saveChannelId(userId: string, id: string): void {
  try { if (id) localStorage.setItem(channelKey(userId), id) } catch { /* ignore */ }
}

/** The user's cached channel id, or null. */
export function loadChannelId(userId: string): string | null {
  try { return localStorage.getItem(channelKey(userId)) || null } catch { return null }
}

/** The channel's live URL — redirects to its current live broadcast when on air. */
export function channelLiveUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}/live`
}

/**
 * Resolve + cache the user's channel id from their already-cached library (we
 * ask the Data API which channel the first library video belongs to). Lets Go
 * Live use "your YouTube" automatically even for users who connected before we
 * started saving the @handle. Cached, best-effort, never throws.
 */
export async function resolveChannelId(userId: string): Promise<string | null> {
  const cached = loadChannelId(userId)
  if (cached) return cached
  if (!isYouTubeApiConfigured()) return null
  const vid = loadLibrary(userId)[0]?.id
  if (!vid) return null
  try {
    const page = await ytFetch('videos', { part: 'snippet', id: vid }, undefined)
    const ch: string | undefined = page?.items?.[0]?.snippet?.channelId
    if (ch) { saveChannelId(userId, ch); return ch }
  } catch { /* best-effort */ }
  return null
}

// ---- Local cache so a connect survives reloads ------------------------------

const cacheKey = (userId: string) => `kc_yt_library_${userId}`

export function saveLibrary(userId: string, videos: LibraryVideo[]): void {
  try { localStorage.setItem(cacheKey(userId), JSON.stringify({ at: Date.now(), videos })) } catch { /* ignore */ }
}

export function loadLibrary(userId: string): LibraryVideo[] {
  try {
    const raw = localStorage.getItem(cacheKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.videos) ? (parsed.videos as LibraryVideo[]) : []
  } catch {
    return []
  }
}

export function clearLibrary(userId: string): void {
  try { localStorage.removeItem(cacheKey(userId)) } catch { /* ignore */ }
}

/** Replace only the cached channel identity, preserving freshly loaded clips. */
export function rememberYouTubeChannel(userId: string, rawUrl: string): void {
  const normalized = normalizeConnectedYouTubeChannelUrl(rawUrl)
  if (!normalized) return
  try {
    localStorage.removeItem(handleKey(userId))
    localStorage.removeItem(channelKey(userId))
  } catch { /* ignore */ }
  const handle = youtubeHandleFromChannelUrl(normalized)
  if (handle) saveHandle(userId, handle)
  const parts = new URL(normalized).pathname.split('/').filter(Boolean)
  if (parts[0] === 'channel' && parts[1]) saveChannelId(userId, parts[1])
}

/** Remove every device-local trace of the old connected account. */
export function clearYouTubeConnection(userId: string): void {
  clearLibrary(userId)
  try {
    localStorage.removeItem(handleKey(userId))
    localStorage.removeItem(channelKey(userId))
  } catch { /* ignore */ }
}
