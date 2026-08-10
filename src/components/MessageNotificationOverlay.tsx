import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { markRead } from '@/lib/notifications'
import { supabase } from '@/lib/supabase'
import type { Notification } from '@/types/database'

const MESSAGE_KINDS = ['direct_message', 'group_message']

export function messageOverlayDecision(
  initialized: boolean,
  baselineId: string | null,
  newestId: string | null,
): { initialized: true; baselineId: string | null; show: boolean } {
  if (!initialized) return { initialized: true, baselineId: newestId, show: false }
  if (!newestId || newestId === baselineId) {
    return { initialized: true, baselineId, show: false }
  }
  return { initialized: true, baselineId: newestId, show: true }
}

/** Messenger-style heads-up banner while the app is already open. */
export function MessageNotificationOverlay() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [item, setItem] = useState<Notification | null>(null)
  const baseline = useRef<string | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (!user) {
      baseline.current = null
      initialized.current = false
      setItem(null)
      return
    }
    let cancelled = false
    let hideTimer: number | undefined
    async function poll() {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user!.id)
        .in('kind', MESSAGE_KINDS)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
      if (cancelled) return
      const newest = ((data ?? [])[0] as Notification | undefined) ?? null
      const decision = messageOverlayDecision(initialized.current, baseline.current, newest?.id ?? null)
      initialized.current = decision.initialized
      baseline.current = decision.baselineId
      if (!decision.show || !newest) return
      const openConversation = new URLSearchParams(location.search).get('conversation')
      if (location.pathname === '/messages' && openConversation === newest.related_id) return
      setItem(newest)
      if (hideTimer) window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => setItem(null), 7_000)
    }
    void poll()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void poll()
    }, 4_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      if (hideTimer) window.clearTimeout(hideTimer)
    }
  }, [location.pathname, location.search, user])

  if (!item) return null

  async function openMessage() {
    await markRead(item!.id)
    const query = item!.related_id ? `?conversation=${encodeURIComponent(item!.related_id)}` : ''
    setItem(null)
    navigate(`/messages${query}`)
  }

  return (
    <div className="pointer-events-none fixed inset-x-3 top-[calc(var(--tko-safe-area-top)+0.75rem)] z-[90] flex justify-center" aria-live="polite">
      <div className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border border-dark-border bg-dark-card/95 p-3 shadow-2xl backdrop-blur">
        <button type="button" onClick={() => { void openMessage() }} className="flex min-w-0 flex-1 items-start gap-3 text-left">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-dark">
            <MessageCircle className="h-5 w-5 fill-current" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">{item.title}</span>
            {item.body && <span className="mt-0.5 block line-clamp-2 text-xs text-gray-300">{item.body}</span>}
          </span>
        </button>
        <button type="button" onClick={() => setItem(null)} aria-label="Dismiss message" title="Dismiss" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-dark-border hover:text-white">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
