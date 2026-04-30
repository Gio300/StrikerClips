// YouTube "most replayed" heatmap fetcher.
//
// YouTube embeds a per-second action curve in every public watch page —
// the "most replayed" graph that shows where viewers re-scrubbed. On a
// gameplay clip, those peaks ARE the action: explosions, ougis, KOs.
// Viewers told us where the highlights are by re-watching them.
//
// We can't read this from the IFrame API (cross-origin) and we can't fetch
// the watch page directly from the browser (CORS). We use a public CORS
// relay and cache aggressively so it's a one-shot per video.
//
// The data lives deep inside `ytInitialData` under
//   ...markersMap[].value.heatmap.heatMarkers[]
// where each marker is { timeRangeStartMillis, markerDurationMillis,
// heatMarkerIntensityScoreNormalized }.
//
// If a video has no heatmap (low view count, very recent upload) we fall
// back to a flat low-noise curve so the director engine still works — it
// just leans on fairness rotation instead.

export type ActionPoint = { t: number; score: number }

export type ActionCurve = {
  videoId: string
  durationSec: number | null
  points: ActionPoint[]
  source: 'heatmap' | 'flat-fallback'
  fetchedAt: number
}

const CACHE_PREFIX = 'clutchlens:actionCurve:'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// Free public CORS relays. We try each in order — if one is rate-limited or
// down, we fall through to the next. None of these cost anything to use.
const CORS_RELAYS: ((url: string) => string)[] = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
]

const inflight = new Map<string, Promise<ActionCurve>>()

export function getCachedCurve(videoId: string): ActionCurve | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + videoId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ActionCurve
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_PREFIX + videoId)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeCache(curve: ActionCurve) {
  try {
    localStorage.setItem(CACHE_PREFIX + curve.videoId, JSON.stringify(curve))
  } catch {
    // localStorage full — quietly skip.
  }
}

/**
 * Fetch (or load from cache) the action curve for a given YouTube video.
 * Always resolves — falls back to a flat curve if everything fails so the
 * caller can keep going.
 */
export function fetchActionCurve(videoId: string): Promise<ActionCurve> {
  const cached = getCachedCurve(videoId)
  if (cached) return Promise.resolve(cached)

  const existing = inflight.get(videoId)
  if (existing) return existing

  const promise = doFetch(videoId)
    .then((curve) => {
      writeCache(curve)
      return curve
    })
    .catch(() => {
      const fallback = makeFlatCurve(videoId)
      writeCache(fallback)
      return fallback
    })
    .finally(() => {
      inflight.delete(videoId)
    })

  inflight.set(videoId, promise)
  return promise
}

async function doFetch(videoId: string): Promise<ActionCurve> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`

  let html: string | null = null
  let lastErr: unknown = null
  for (const relay of CORS_RELAYS) {
    try {
      const res = await fetch(relay(watchUrl), { method: 'GET' })
      if (!res.ok) { lastErr = new Error(`relay ${res.status}`); continue }
      html = await res.text()
      if (html.length > 50_000) break // sanity: full pages are hundreds of KB
    } catch (err) {
      lastErr = err
    }
  }
  if (!html) throw lastErr ?? new Error('all relays failed')

  const initial = extractInitialData(html)
  if (!initial) throw new Error('ytInitialData not found')

  const heatMarkers = findHeatMarkers(initial)
  const durationSec = findDurationSec(initial)

  if (!heatMarkers || heatMarkers.length === 0) {
    return { ...makeFlatCurve(videoId), durationSec }
  }

  const points: ActionPoint[] = heatMarkers
    .map((m) => {
      const r = m?.heatMarkerRenderer
      if (!r) return null
      const t = (r.timeRangeStartMillis ?? 0) / 1000
      const score = r.heatMarkerIntensityScoreNormalized
      if (typeof t !== 'number' || typeof score !== 'number') return null
      return { t, score: clamp01(score) }
    })
    .filter((p): p is ActionPoint => !!p)
    .sort((a, b) => a.t - b.t)

  if (points.length === 0) return { ...makeFlatCurve(videoId), durationSec }

  return {
    videoId,
    durationSec,
    points,
    source: 'heatmap',
    fetchedAt: Date.now(),
  }
}

// Carve `var ytInitialData = {...};` (or the newer assignment form) out of
// the watch page. Both `var ytInitialData` and `window["ytInitialData"]`
// have shipped in recent years; we try both.
function extractInitialData(html: string): unknown | null {
  const patterns = [
    /var\s+ytInitialData\s*=\s*(\{[\s\S]*?\})\s*;/,
    /window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\})\s*;/,
    /ytInitialData\s*=\s*(\{[\s\S]*?\})\s*;<\/script>/,
  ]
  for (const pat of patterns) {
    const m = html.match(pat)
    if (!m) continue
    try {
      return JSON.parse(m[1])
    } catch {
      // The lazy regex above can stop at the first `};` inside a string;
      // fall through to a balanced-brace scan as a recovery.
      const start = html.indexOf(m[0])
      const eqIdx = html.indexOf('=', start)
      const objStart = html.indexOf('{', eqIdx)
      if (objStart === -1) continue
      const slice = readBalancedJson(html, objStart)
      if (!slice) continue
      try { return JSON.parse(slice) } catch { /* keep trying */ }
    }
  }
  return null
}

// Read a JSON object from a string starting at `start` (which must be `{`),
// respecting strings/escapes. Returns the substring or null.
function readBalancedJson(s: string, start: number): string | null {
  let depth = 0
  let inStr = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (escape) { escape = false; continue }
      if (c === '\\') { escape = true; continue }
      if (c === '"') { inStr = false }
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

// Walk the JSON tree looking for the heatmap. Layout has shifted across
// YouTube revisions, so we depth-first search for the `heatMarkers` array
// rather than hard-coding the path.
function findHeatMarkers(node: unknown): HeatMarker[] | null {
  if (!node || typeof node !== 'object') return null
  // Direct hit?
  const o = node as Record<string, unknown>
  if (Array.isArray(o.heatMarkers)) return o.heatMarkers as HeatMarker[]
  // Look for a `heatmap` wrapper
  if (o.heatmap && typeof o.heatmap === 'object') {
    const r = (o.heatmap as Record<string, unknown>).heatmapRenderer as Record<string, unknown> | undefined
    if (r && Array.isArray(r.heatMarkers)) return r.heatMarkers as HeatMarker[]
  }
  for (const k of Object.keys(o)) {
    const v = o[k]
    if (Array.isArray(v)) {
      for (const item of v) {
        const r = findHeatMarkers(item)
        if (r) return r
      }
    } else if (v && typeof v === 'object') {
      const r = findHeatMarkers(v)
      if (r) return r
    }
  }
  return null
}

function findDurationSec(node: unknown): number | null {
  if (!node || typeof node !== 'object') return null
  const o = node as Record<string, unknown>
  // `videoDetails.lengthSeconds` lives on the player response, but the
  // watch page sometimes doesn't have it; try common spots.
  if (typeof o.lengthSeconds === 'string') {
    const n = Number(o.lengthSeconds)
    if (Number.isFinite(n) && n > 0) return n
  }
  if (typeof o.lengthSeconds === 'number' && o.lengthSeconds > 0) return o.lengthSeconds
  for (const k of Object.keys(o)) {
    const v = o[k]
    if (Array.isArray(v)) {
      for (const item of v) {
        const r = findDurationSec(item)
        if (r) return r
      }
    } else if (v && typeof v === 'object') {
      const r = findDurationSec(v)
      if (r) return r
    }
  }
  return null
}

function makeFlatCurve(videoId: string): ActionCurve {
  // 0.3 baseline, tiny pseudo-random wobble derived from the videoId so
  // every clip in a reel has a slightly different baseline (otherwise
  // fairness rotation has nothing to break ties with).
  const seed = hashString(videoId) % 1000 / 1000
  const points: ActionPoint[] = []
  for (let t = 0; t <= 600; t += 5) {
    const wobble = Math.sin((t / 17) + seed * 6.28) * 0.05
    points.push({ t, score: 0.3 + wobble })
  }
  return {
    videoId,
    durationSec: null,
    points,
    source: 'flat-fallback',
    fetchedAt: Date.now(),
  }
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/**
 * Sample the action score at time t. Uses linear interpolation between the
 * two surrounding points and gracefully extrapolates the last bucket.
 */
export function sampleCurve(curve: ActionCurve, t: number): number {
  const pts = curve.points
  if (pts.length === 0) return 0
  if (t <= pts[0].t) return pts[0].score
  if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].score
  // binary search
  let lo = 0, hi = pts.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid].t > t) hi = mid
    else lo = mid
  }
  const a = pts[lo], b = pts[hi]
  const span = b.t - a.t || 1
  const frac = (t - a.t) / span
  return a.score + (b.score - a.score) * frac
}

type HeatMarker = {
  heatMarkerRenderer?: {
    timeRangeStartMillis?: number
    markerDurationMillis?: number
    heatMarkerIntensityScoreNormalized?: number
  }
}
