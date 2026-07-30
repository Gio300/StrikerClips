import { extractYouTubeId } from './youtubeApi'

/**
 * A clean, user-facing label for a clip. NEVER returns the raw URL.
 *
 * - Uses the provided `title` when we have one (the human name of the clip).
 * - Otherwise falls back to `YouTube clip · <short id>` using a short slice of
 *   the video id, so two different clips still read as distinct without ever
 *   exposing the ugly `https://youtube.com/watch?v=…` string to the user.
 * - Non-YouTube links get a generic `Video clip`.
 *
 * The real URL stays in the data/logic — this only changes what's DISPLAYED.
 */
export function prettyClip(url: string | null | undefined, title?: string | null): string {
  const t = title?.trim()
  if (t) return t
  const id = extractYouTubeId(url ?? '')
  if (id) return `YouTube clip · ${id.slice(-4)}`
  return 'Video clip'
}
