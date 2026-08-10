/**
 * gifs — the GIF picker's provider layer and its in-band message encoding.
 *
 * ── NOTHING HERE EXISTS WITHOUT A KEY ───────────────────────────────────────
 *   VITE_TENOR_KEY   a Tenor v2 API key   (preferred when both are set)
 *   VITE_GIPHY_KEY   a Giphy API key
 * With neither set `gifProvider()` returns null, the GIF button never renders,
 * and every chat surface behaves exactly as it did before this file existed.
 * Both keys are CLIENT keys — public by design, they identify the app and do
 * not authorize spend. Never put a server secret in a VITE_* var.
 *
 * ── WHY AN IN-BAND MARKER, NOT A COLUMN ─────────────────────────────────────
 * The four chat tables (stream_messages.content, tournament_messages.content,
 * chat_messages.body, dm_messages.content) are plain text with no attachment
 * column, and the app already carries three in-band markers on exactly this
 * pattern: [[tko-bot]] and [[tko-hl]] (src/lib/streamChatMarkup.ts) and
 * [[tko-poll:v1:<id>]] (src/lib/chat.ts). A GIF rides the same road, so it
 * needs no migration and cannot break a single existing row.
 *
 * ── WHY THE HOST ALLOWLIST IS THE SECURITY STORY ────────────────────────────
 * A user can type `[[tko-gif:v1:...]]` by hand — stripLeadingMarkers() only
 * guards the START of a line and the marker is the whole message. So the
 * RENDERER, not the composer, is the gate: parseGifMessage() only ever returns
 * an https URL whose host is on GIF_MEDIA_HOSTS. A forged marker can therefore
 * embed a Tenor/Giphy asset and nothing else — no arbitrary image host, no
 * tracking pixel, no data: URL, no javascript:.
 *
 * Pure except for `searchGifs`, whose fetch is injectable for tests.
 */

// ───────────────────────────────────────────────────────────────────────────
//  Provider config
// ───────────────────────────────────────────────────────────────────────────

export type GifProviderId = 'tenor' | 'giphy'

export const tenorKey = import.meta.env.VITE_TENOR_KEY ?? ''
export const giphyKey = import.meta.env.VITE_GIPHY_KEY ?? ''

export type GifProvider = { id: GifProviderId; key: string; label: string }

/**
 * The active provider, or null when no key is configured. Tenor wins when both
 * are present — one provider at a time keeps the attribution requirement (each
 * network wants its own "via" mark) unambiguous.
 */
export function gifProvider(
  keys: { tenor?: string; giphy?: string } = { tenor: tenorKey, giphy: giphyKey },
): GifProvider | null {
  const t = (keys.tenor ?? '').trim()
  if (t) return { id: 'tenor', key: t, label: 'Tenor' }
  const g = (keys.giphy ?? '').trim()
  if (g) return { id: 'giphy', key: g, label: 'GIPHY' }
  return null
}

/** True when the GIF button should render at all. */
export function gifsEnabled(provider: GifProvider | null = gifProvider()): boolean {
  return provider !== null
}

// ───────────────────────────────────────────────────────────────────────────
//  The message marker
// ───────────────────────────────────────────────────────────────────────────

/** Prefix marking a message as a GIF. KEEP IN SYNC with streamChatMarkup.ts. */
export const GIF_PREFIX = '[[tko-gif:v1:'

/**
 * Hosts a GIF message may point at. Anything else is not a GIF message, no
 * matter what the marker says. Matched on the full host or a dot-suffix, so
 * `evil-media.tenor.com.attacker.net` cannot slip through.
 */
export const GIF_MEDIA_HOSTS: readonly string[] = [
  'media.tenor.com',
  'c.tenor.com',
  'tenor.com',
  'media.giphy.com',
  'i.giphy.com',
  'giphy.com',
]

export type GifMessage = {
  /** Animated asset (the thing that plays once the reader clicks). */
  url: string
  /** Static first frame. Empty when the provider gave us none. */
  poster: string
  width: number
  height: number
  /** Short description, for alt text. */
  alt: string
}

function hostAllowed(raw: string): boolean {
  let host: string
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    host = u.hostname.toLowerCase()
  } catch {
    return false
  }
  return GIF_MEDIA_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

function cleanDimension(n: unknown): number {
  const v = typeof n === 'number' ? n : Number.parseInt(String(n ?? ''), 10)
  if (!Number.isFinite(v) || v <= 0) return 0
  return Math.min(4096, Math.round(v))
}

/** Strip the delimiters the encoding reserves, so alt text can never break it. */
function cleanAlt(raw: string): string {
  return (raw || '').replace(/[|\]\r\n]+/g, ' ').trim().slice(0, 80)
}

/**
 * Encode a GIF as one chat message body:
 *   [[tko-gif:v1:<w>x<h>|<url>|<poster>|<alt>]]
 * Pipes are the field separator and are stripped from the only free-text field,
 * and URLs cannot contain a pipe or a `]`, so the format is unambiguous.
 * Throws on anything that would not survive parseGifMessage — encode and parse
 * agree by construction rather than by convention.
 */
export function encodeGifMessage(gif: {
  url: string
  poster?: string
  width?: number
  height?: number
  alt?: string
}): string {
  const url = (gif.url || '').trim()
  if (!hostAllowed(url)) throw new Error('Unsupported GIF host')
  const poster = (gif.poster || '').trim()
  const safePoster = poster && hostAllowed(poster) ? poster : ''
  const w = cleanDimension(gif.width)
  const h = cleanDimension(gif.height)
  return `${GIF_PREFIX}${w}x${h}|${url}|${safePoster}|${cleanAlt(gif.alt ?? 'GIF')}]]`
}

/**
 * Return the GIF only when the ENTIRE message is a well-formed marker pointing
 * at an allowlisted host. Anything else — a marker with text around it, an
 * off-list host, a non-https URL — is null, and the caller renders plain text.
 */
export function parseGifMessage(body: string): GifMessage | null {
  if (typeof body !== 'string') return null
  const t = body.trim()
  if (!t.startsWith(GIF_PREFIX) || !t.endsWith(']]')) return null
  const payload = t.slice(GIF_PREFIX.length, -2)
  const parts = payload.split('|')
  if (parts.length < 2) return null
  const [dims, url, poster = '', alt = ''] = parts
  if (!hostAllowed(url)) return null
  const m = dims.match(/^(\d{1,4})x(\d{1,4})$/)
  return {
    url,
    poster: poster && hostAllowed(poster) ? poster : '',
    width: m ? cleanDimension(m[1]) : 0,
    height: m ? cleanDimension(m[2]) : 0,
    alt: cleanAlt(alt) || 'GIF',
  }
}

/** True when this message body is a GIF (cheap check for render branches). */
export function isGifMessage(body: string): boolean {
  return parseGifMessage(body) !== null
}

// ───────────────────────────────────────────────────────────────────────────
//  Search / trending
// ───────────────────────────────────────────────────────────────────────────

export type GifResult = GifMessage & { id: string }

/** How many results one page of the picker asks for. */
export const GIF_PAGE_SIZE = 24

type FetchLike = (input: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

function tenorUrl(provider: GifProvider, query: string): string {
  const base = query
    ? 'https://tenor.googleapis.com/v2/search'
    : 'https://tenor.googleapis.com/v2/featured'
  const params = new URLSearchParams({
    key: provider.key,
    client_key: 'tko_cam',
    limit: String(GIF_PAGE_SIZE),
    // Tenor's strictest safety filter. A league chat has 13-year-olds in it
    // (src/lib/age.ts MIN_AGE_YEARS), so this is not the place to relax it.
    contentfilter: 'high',
    media_filter: 'tinygif,tinygifpreview,gif',
  })
  if (query) params.set('q', query)
  return `${base}?${params.toString()}`
}

function giphyUrl(provider: GifProvider, query: string): string {
  const base = query
    ? 'https://api.giphy.com/v1/gifs/search'
    : 'https://api.giphy.com/v1/gifs/trending'
  const params = new URLSearchParams({
    api_key: provider.key,
    limit: String(GIF_PAGE_SIZE),
    // Giphy's equivalent ceiling — see the note on contentfilter above.
    rating: 'pg-13',
  })
  if (query) params.set('q', query)
  return `${base}?${params.toString()}`
}

/** The request URL for a query (exported so tests can assert the safety params). */
export function gifRequestUrl(provider: GifProvider, query: string): string {
  return provider.id === 'tenor' ? tenorUrl(provider, query) : giphyUrl(provider, query)
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

/** Tenor v2 → GifResult[]. Anything malformed is dropped, never thrown. */
export function normalizeTenor(payload: unknown): GifResult[] {
  const results = asRecord(payload).results
  if (!Array.isArray(results)) return []
  const out: GifResult[] = []
  for (const raw of results) {
    const row = asRecord(raw)
    const formats = asRecord(row.media_formats)
    const animated = asRecord(formats.tinygif).url ?? asRecord(formats.gif).url
    const still = asRecord(formats.tinygifpreview).url
    const dims = asRecord(formats.tinygif).dims ?? asRecord(formats.gif).dims
    const [w, h] = Array.isArray(dims) ? dims : []
    if (typeof animated !== 'string' || !hostAllowed(animated)) continue
    out.push({
      id: String(row.id ?? animated),
      url: animated,
      poster: typeof still === 'string' && hostAllowed(still) ? still : '',
      width: cleanDimension(w),
      height: cleanDimension(h),
      alt: cleanAlt(String(row.content_description ?? '')) || 'GIF',
    })
  }
  return out
}

/** Giphy v1 → GifResult[]. Same contract as normalizeTenor. */
export function normalizeGiphy(payload: unknown): GifResult[] {
  const data = asRecord(payload).data
  if (!Array.isArray(data)) return []
  const out: GifResult[] = []
  for (const raw of data) {
    const row = asRecord(raw)
    const images = asRecord(row.images)
    const animated = asRecord(images.fixed_height_small).url ?? asRecord(images.fixed_height).url
    const still = asRecord(images.fixed_height_small_still).url
      ?? asRecord(images.fixed_height_still).url
    const sized = asRecord(images.fixed_height_small)
    if (typeof animated !== 'string' || !hostAllowed(animated)) continue
    out.push({
      id: String(row.id ?? animated),
      url: animated,
      poster: typeof still === 'string' && hostAllowed(still) ? still : '',
      width: cleanDimension(sized.width),
      height: cleanDimension(sized.height),
      alt: cleanAlt(String(row.title ?? '')) || 'GIF',
    })
  }
  return out
}

/**
 * Search (or, with an empty query, fetch trending). Returns [] on ANY failure —
 * no key, network down, rate limited, malformed payload. The picker shows an
 * empty state; the chat is never affected.
 */
export async function searchGifs(
  query: string,
  opts: { provider?: GifProvider | null; fetchImpl?: FetchLike } = {},
): Promise<GifResult[]> {
  const provider = opts.provider === undefined ? gifProvider() : opts.provider
  if (!provider) return []
  const doFetch = opts.fetchImpl
    ?? (typeof fetch === 'function' ? (u: string) => fetch(u) : null)
  if (!doFetch) return []
  try {
    const res = await doFetch(gifRequestUrl(provider, query.trim().slice(0, 100)))
    if (!res.ok) return []
    const payload = await res.json()
    return provider.id === 'tenor' ? normalizeTenor(payload) : normalizeGiphy(payload)
  } catch {
    return []
  }
}
