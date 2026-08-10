import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'

const MESSAGE_KINDS = ['direct_message', 'group_message']

/** Unread inbox count for the global chat entry point. */
export function useMessageUnread(): { count: number; refresh: () => void } {
  const { user } = useAuth()
  const [count, setCount] = useState(0)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    if (!user) {
      setCount(0)
      return
    }
    let cancelled = false
    async function load() {
      // Count on the database instead of downloading every unread message
      // notification to every mounted phone. A busy player can accumulate
      // hundreds of unread rows; the badge only needs one integer.
      const { count: unread } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .in('kind', MESSAGE_KINDS)
        .is('read_at', null)
      if (!cancelled) setCount(unread ?? 0)
    }
    void load()
    const timer = globalThis.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void load()
    }, 8_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      globalThis.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [revision, user])

  return { count, refresh }
}
