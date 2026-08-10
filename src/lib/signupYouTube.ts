const YOUTUBE_CHANNEL_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const YOUTUBE_CHANNEL_PREFIXES = new Set(['channel', 'c', 'user'])

/**
 * Normalize the one channel attached to a member account.
 *
 * Saved watch/short links are useful clip sources, but they are not channels.
 * Only durable channel forms are accepted here; channel sub-pages such as
 * /live or /videos are reduced to the canonical account URL.
 */
export function normalizeConnectedYouTubeChannelUrl(raw: unknown): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    const host = parsed.hostname.toLowerCase()
    if (!YOUTUBE_CHANNEL_HOSTS.has(host)) return null
    const parts = parsed.pathname.split('/').filter(Boolean)
    const first = parts[0] ?? ''

    if (first.startsWith('@') && first.length > 1) {
      return `https://www.youtube.com/${first}`
    }
    if (YOUTUBE_CHANNEL_PREFIXES.has(first) && parts[1]) {
      return `https://www.youtube.com/${first}/${parts[1]}`
    }
    return null
  } catch {
    return null
  }
}

/** Signup accepts and stores a canonical channel URL, never a video URL. */
export function normalizeSignupYouTubeUrl(raw: unknown): string | null {
  return normalizeConnectedYouTubeChannelUrl(raw)
}

/** A cached @handle can drive Go Live without another network lookup. */
export function youtubeHandleFromChannelUrl(raw: unknown): string | null {
  const normalized = normalizeConnectedYouTubeChannelUrl(raw)
  if (!normalized) return null
  const first = new URL(normalized).pathname.split('/').filter(Boolean)[0] ?? ''
  return first.startsWith('@') ? first.slice(1) : null
}
