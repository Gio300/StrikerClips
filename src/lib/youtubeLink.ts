import { supabase } from '@/lib/supabase'
import { saveHandle, loadHandle, loadLibrary, youtubeLiveUrl } from '@/lib/youtubeConnect'

/**
 * youtubeLink — ONE source of truth for "this user has connected YouTube".
 *
 * Before this, connecting was recorded inconsistently: the Create/handle path
 * only cached clips in localStorage, while other screens (TKO King, auto-merge)
 * check the backend `user_youtube_links` table — so the same account looked
 * "connected" on one screen and "not connected" on another. Now EVERY connect
 * writes the backend row (cross-device truth) + caches the handle locally, and a
 * single `isYouTubeLinked` answers everywhere.
 */

/** Record a YouTube connection for a user: backend row + local handle cache. */
export async function recordYouTubeLink(userId: string, handle: string): Promise<void> {
  if (!userId) return
  const clean = (handle || '').trim().replace(/^@/, '').replace(/\/.*$/, '')
  if (clean) saveHandle(userId, clean)
  const url = clean ? `https://www.youtube.com/@${clean}` : ''
  if (!url) return
  try {
    // Idempotent: don't stack duplicate rows for the same channel.
    const { data: existing } = await supabase
      .from('user_youtube_links')
      .select('id')
      .eq('user_id', userId)
      .eq('url', url)
      .limit(1)
    if (!existing?.length) {
      await supabase.from('user_youtube_links').insert({ user_id: userId, url })
    }
  } catch {
    /* offline / mock — the local cache still marks them connected */
  }
}

/**
 * Is this user connected to YouTube — anywhere, by any path? True if they have a
 * backend `user_youtube_links` row OR a locally cached channel handle/library.
 * Every "you must connect YouTube" gate should use THIS so the answer is the
 * same on every screen.
 */
export async function isYouTubeLinked(userId: string): Promise<boolean> {
  if (!userId) return false
  if (loadHandle(userId) || loadLibrary(userId).length > 0) return true
  try {
    const { data } = await supabase
      .from('user_youtube_links')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
    return (data?.length ?? 0) > 0
  } catch {
    return false
  }
}

/** The user's "go live from my channel" URL, if we know their handle. */
export function myYouTubeLiveUrl(userId: string): string | null {
  const h = loadHandle(userId)
  return h ? youtubeLiveUrl(h) : null
}
