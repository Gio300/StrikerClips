/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '@/lib/supabase'

const cacheKey = (userId: string) => `tko:auto-detect-live:${userId}`

/** Missing values intentionally resolve to true: automatic discovery is opt-out. */
export function cachedAutoDetectLive(userId: string): boolean {
  if (!userId) return true
  try {
    const value = localStorage.getItem(cacheKey(userId))
    return value == null ? true : value !== 'false'
  } catch {
    return true
  }
}

function cache(userId: string, enabled: boolean): void {
  try { localStorage.setItem(cacheKey(userId), String(enabled)) } catch { /* non-fatal */ }
}

export async function loadAutoDetectLive(userId: string): Promise<boolean> {
  if (!userId) return true
  try {
    const { data } = await supabase
      .from('profiles')
      .select('auto_detect_live')
      .eq('id', userId)
      .maybeSingle()
    const value = (data as any)?.auto_detect_live
    const enabled = typeof value === 'boolean' ? value : cachedAutoDetectLive(userId)
    cache(userId, enabled)
    return enabled
  } catch {
    return cachedAutoDetectLive(userId)
  }
}

export async function saveAutoDetectLive(userId: string, enabled: boolean): Promise<boolean> {
  if (!userId) return false
  cache(userId, enabled)
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ auto_detect_live: enabled } as any)
      .eq('id', userId)
    return !error
  } catch {
    return false
  }
}
