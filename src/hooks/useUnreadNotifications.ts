import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

/**
 * Lightweight unread-count poll for the sidebar bell. Polls every 15s while
 * the tab is visible. We deliberately avoid a Realtime subscription here to
 * keep websocket usage minimal — promo-grade pricing.
 */
export type UnreadNotificationsState = { count: number; refresh: () => void }

const UnreadNotificationsContext = createContext<UnreadNotificationsState | null>(null)

function useUnreadNotificationsState(enabled: boolean): UnreadNotificationsState {
  const { user } = useAuth()
  const [count, setCount] = useState(0)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
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
      if (typeof document === 'undefined' || document.visibilityState === 'visible') load()
    }, 15_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(interval)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, user, tick])

  return useMemo(() => ({ count, refresh: () => setTick((t) => t + 1) }), [count])
}

/**
 * Layout-level owner for the unread count. Sidebar, top bell, and phone menu are
 * all mounted at once even when CSS hides two of them; sharing this state keeps
 * those three badges on one 15-second poll instead of tripling every member's
 * notification traffic.
 */
export function UnreadNotificationsProvider({ children }: { children: ReactNode }) {
  const value = useUnreadNotificationsState(true)
  return createElement(UnreadNotificationsContext.Provider, { value }, children)
}

export function useUnreadNotifications(): UnreadNotificationsState {
  const shared = useContext(UnreadNotificationsContext)
  // Components mounted alone in tests or an isolated story still work. Inside
  // Layout, `enabled=false` makes this fallback inert and the shared poll wins.
  const standalone = useUnreadNotificationsState(shared === null)
  return shared ?? standalone
}
