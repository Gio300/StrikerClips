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
 *     is set on killcam.app.
 *
 * Thumbnails need no API key: https://i.ytimg.com/vi/<id>/hqdefault.jpg is public.
 */

import type { LibraryVideo } from './describeClip'
import { extractYouTubeId } from './youtubeApi'

const CLIENT_ID = import.meta.env.VITE_YT_CLIENT_ID as string | undefined
const API_KEY = import.meta.env.VITE_YT_API_KEY as string | undefined
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly'

/** True when killcam.app has a Google OAuth Client ID wired up. */
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
