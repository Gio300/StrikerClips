import { supabase } from '@/lib/supabase'
import type { LibraryVideo } from '@/lib/describeClip'

export type ConnectedYouTubeChannel = {
  id: string
  url: string
  title?: string | null
  channel_id?: string | null
  created_at?: string | null
}

type SettingsResult = {
  ok?: boolean
  channel?: ConnectedYouTubeChannel | null
  videos?: LibraryVideo[]
  warning?: string
  error?: string
}

async function invoke(action: 'get' | 'save' | 'disconnect' | 'uploads', url?: string): Promise<SettingsResult> {
  const { data, error } = await supabase.functions.invoke('youtube-channel-settings', {
    body: { action, ...(url ? { url } : {}) },
  })
  if (error) throw new Error(error.message || 'YouTube settings are unavailable.')
  const result = (data || {}) as SettingsResult
  if (result.error) throw new Error(result.error)
  return result
}

export function loadConnectedYouTubeChannel() {
  return invoke('get').then((result) => result.channel ?? null)
}

export function saveConnectedYouTubeChannel(url: string) {
  return invoke('save', url).then((result) => result.channel ?? null)
}

export function disconnectYouTubeChannel() {
  return invoke('disconnect').then((result) => result.channel ?? null)
}

/**
 * Restore the signed-in player's saved channel and recent public uploads.
 * This is account-scoped server data, so it works across browsers and across
 * tko.cam / league domains without another Google authorization popup.
 */
export async function loadConnectedYouTubeUploads(): Promise<{
  channel: ConnectedYouTubeChannel | null
  videos: LibraryVideo[]
  warning?: string
}> {
  const result = await invoke('uploads')
  return {
    channel: result.channel ?? null,
    videos: Array.isArray(result.videos) ? result.videos : [],
    warning: result.warning,
  }
}
