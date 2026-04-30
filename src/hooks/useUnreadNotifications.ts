import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

/**
 * Lightweight unread-count poll for the sidebar bell. Polls every 30s while
 * the tab is visible. We deliberately avoid a Realtime subscription here to
 * keep websocket usage minimal — promo-grade pricing.
 */
export function useUnreadNotifications(): { count: number; refresh: () => void } {
  const { user } = useAuth()
  const [count, setCount] = useState(0)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!user) {
      setCount(0)
      return
    }
    let cancelled = false
    async function load() {
      const { count: c } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .is('read_at', null)
      if (!cancelled) setCount(c ?? 0)
    }
    load()
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
    }
  }, [user, tick])

  return { count, refresh: () => setTick((t) => t + 1) }
}
