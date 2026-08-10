import { supabase } from '@/lib/supabase'
import {
  channelLiveUrl,
  loadChannelId,
  loadHandle,
  rememberYouTubeChannel,
  youtubeLiveUrl,
} from '@/lib/youtubeConnect'
import { normalizeConnectedYouTubeChannelUrl } from '@/lib/signupYouTube'

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
  const url = clean ? `https://www.youtube.com/@${clean}` : ''
  if (!url) return
  rememberYouTubeChannel(userId, url)
  try {
    const { error } = await supabase.functions.invoke('youtube-channel-settings', {
      body: { action: 'save', url },
    })
    if (!error) return
  } catch { /* use the rolling-deploy fallback below */ }
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
 * Only a valid channel identity counts as connected. A locally cached clip
 * library or a saved video URL is useful media, but cannot satisfy an account
 * channel requirement.
 */
export async function isYouTubeLinked(userId: string): Promise<boolean> {
  if (!userId) return false
  const handle = loadHandle(userId)
  if (handle && /^[A-Za-z0-9._-]{2,40}$/.test(handle)
    && normalizeConnectedYouTubeChannelUrl(`https://www.youtube.com/@${handle}`)) return true
  const channelId = loadChannelId(userId)
  if (channelId && /^[A-Za-z0-9_-]+$/.test(channelId)
    && normalizeConnectedYouTubeChannelUrl(`https://www.youtube.com/channel/${channelId}`)) return true
  try {
    const { data } = await supabase
      .from('user_youtube_links')
      .select('url')
      .eq('user_id', userId)
    return (data ?? []).some((row) => Boolean(normalizeConnectedYouTubeChannelUrl(row.url)))
  } catch {
    return false
  }
}

/** The user's "go live from my channel" URL, if we know their handle. */
export function myYouTubeLiveUrl(userId: string): string | null {
  const h = loadHandle(userId)
  if (h) return youtubeLiveUrl(h)
  const channelId = loadChannelId(userId)
  return channelId ? channelLiveUrl(channelId) : null
}
