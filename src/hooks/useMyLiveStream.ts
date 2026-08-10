import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

/**
 * useMyLiveStream — "am I on air right now?", for chrome that has to answer it
 * without owning the Go Live screen (the top bar's GO LIVE control).
 *
 * THE PREDICATE IS THE SERVER'S. Starting a second concurrent show is refused
 * by the API with a 409 (`sendActiveLiveStreamConflict` in server/app.ts), and
 * the row it refuses on is exactly `live_streams where user_id = me and
 * is_live = true`. So this hook asks the SAME question: any surface that offers
 * "go live" then cannot offer it in a state the server would reject — it says
 * "you're live" and points at the running show instead. Matching the server's
 * own condition (rather than inventing a freshness rule here) is also what
 * keeps a stale row honest: the server expires stale live rows before it checks
 * for the conflict, so once it would let you start again, this flips back too.
 *
 * Cost: `live_streams` is public-read by policy, so this is one narrow indexed
 * read on a 30s poll, paused while the tab is hidden — the same shape as
 * useUnreadNotifications, which sits next to it in the same bar.
 *
 * Degrades, never throws: any failure just reads as "not live", which shows the
 * ordinary GO LIVE button. The server still refuses a genuine second stream.
 */

const POLL_MS = 30_000

export interface MyLiveStream {
  id: string
  title: string | null
}

export function useMyLiveStream(): { live: MyLiveStream | null; refresh: () => void } {
  const { user } = useAuth()
  const [live, setLive] = useState<MyLiveStream | null>(null)
  const [tick, setTick] = useState(0)
  const userId = user?.id

  useEffect(() => {
    if (!userId) {
      setLive(null)
      return
    }
    let cancelled = false
    async function load() {
      try {
        const { data } = await supabase
          .from('live_streams')
          .select('id, title')
          .eq('user_id', userId!)
          .eq('is_live', true)
          .order('created_at', { ascending: false })
          .limit(1)
        if (cancelled) return
        const row = (Array.isArray(data) ? data[0] : null) as MyLiveStream | undefined | null
        setLive(row?.id ? { id: row.id, title: row.title ?? null } : null)
      } catch {
        /* offline / blocked read — leave the last known answer alone */
      }
    }
    void load()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, tick])

  return { live, refresh: () => setTick((t) => t + 1) }
}
