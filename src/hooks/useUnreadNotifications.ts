import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

/**
 * Unread-notification count for the sidebar bell.
 *
 * - Counts unread rows (the query gateway returns rows, so we count them).
 * - LIVE: subscribes to the notifications channel so a "you were mentioned"
 *   ping lights the bell the instant it arrives (via the WebSocket layer).
 * - 30s visible-tab poll as a fallback / to catch read-elsewhere updates.
 */
export function useUnreadNotifications(): { count: number; refresh: () => void } {
  const { user } = useAuth()
  const [count, setCount] = useState(0)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!user) {
      setCount(0)
      return
    }
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', user!.id)
        .is('read_at', null)
      if (!cancelled) setCount(Array.isArray(data) ? data.length : 0)
    }
    load()

    // Live ping: bump the badge the instant a new notification lands.
    const channel = supabase
      .channel(`notif:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => setCount((c) => c + 1),
      )
      .subscribe()

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [user, tick])

  return { count, refresh }
}
