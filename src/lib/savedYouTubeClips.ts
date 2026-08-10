import { extractYouTubeId } from './youtubeApi'
import { normalizeConnectedYouTubeChannelUrl } from './signupYouTube'

export interface SavedYouTubeLinkLike {
  url: string | null | undefined
}

/**
 * The legacy `user_youtube_links` table contains both saved footage and the
 * member's connected channel identity. A channel is an account source, not a
 * playable clip, so Reel Builder must only expose rows with a real video id.
 */
export function isSavedYouTubeClip(link: SavedYouTubeLinkLike): boolean {
  const url = String(link.url ?? '').trim()
  if (!url || normalizeConnectedYouTubeChannelUrl(url)) return false
  return extractYouTubeId(url) !== null
}

export function savedYouTubeClips<T extends SavedYouTubeLinkLike>(links: readonly T[]): T[] {
  return links.filter(isSavedYouTubeClip)
}
