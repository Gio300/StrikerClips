import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { fetchMyNotifications, markRead, markAllRead } from '@/lib/notifications'
import { supabase } from '@/lib/supabase'
import type { Notification } from '@/types/database'

/**
 * Notifications inbox.
 *
 * The whole feed lives on `notifications` table; this page just renders it
 * with a filter (all / unread). Clicking a row marks it read AND deep-links
 * to whatever path was stashed in `link`.
 */

type Filter = 'all' | 'unread'

export function NotificationsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<Notification[]>([])
  const [actorMap, setActorMap] = useState<Map<string, string>>(new Map())
  const [filter, setFilter] = useState<Filter>('unread')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      const list = await fetchMyNotifications({ limit: 100 })
      if (cancelled) return
      const actorIds = Array.from(new Set(list.map((n) => n.actor_id).filter(Boolean) as string[]))
      let map = new Map<string, string>()
      if (actorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username')
          .in('id', actorIds)
        map = new Map((profiles ?? []).map((p) => [p.id, p.username]))
      }
      if (cancelled) return
      setActorMap(map)
      setItems(list)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  async function onClick(n: Notification) {
    if (!n.read_at) {
      await markRead(n.id)
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
      )
    }
  }

  async function onMarkAll() {
    await markAllRead()
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })))
  }

  if (!user) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Notifications</h1>
        <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center">
          <Link to="/login" className="text-accent hover:underline">
            Log in
          </Link>
          <span className="text-gray-400"> to view your notifications.</span>
        </div>
      </div>
    )
  }

  const visible = filter === 'all' ? items : items.filter((n) => !n.read_at)
  const unreadCount = items.filter((n) => !n.read_at).length

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-gray-400 text-sm">
            Tournament invites, stat-check reviews, team requests — everything you've been linked
            on lives here.
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={onMarkAll}
            className="text-sm text-gray-400 hover:text-accent"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-4">
        {(['unread', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs uppercase tracking-wider transition-colors ${
              filter === f
                ? 'bg-accent text-dark'
                : 'border border-dark-border text-gray-400 hover:border-accent/50'
            }`}
          >
            {f}
            {f === 'unread' && unreadCount > 0 && (
              <span className="ml-1 text-[10px]">({unreadCount})</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="animate-pulse text-gray-400">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark-card p-12 text-center text-gray-400">
          {filter === 'unread' ? 'You\u2019re all caught up.' : 'No notifications yet.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              actorName={n.actor_id ? actorMap.get(n.actor_id) : undefined}
              onClick={onClick}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function NotificationRow({
  n,
  actorName,
  onClick,
}: {
  n: Notification
  actorName: string | undefined
  onClick: (n: Notification) => void
}) {
  const inner = (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        n.read_at
          ? 'border-dark-border bg-dark-card hover:border-accent/30'
          : 'border-accent/40 bg-accent/5 hover:border-accent'
      }`}
    >
      <div className="flex items-start gap-3">
        <KindIcon kind={n.kind} unread={!n.read_at} />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">
            {n.title}
            {actorName && (
              <span className="text-gray-500 text-xs ml-2">via @{actorName}</span>
            )}
          </p>
          {n.body && <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{n.body}</p>}
          <p className="text-[11px] text-gray-500 mt-1">
            {timeAgo(n.created_at)}
          </p>
        </div>
        {!n.read_at && <span className="w-2 h-2 rounded-full bg-accent shrink-0 mt-2" />}
      </div>
    </div>
  )

  if (n.link) {
    return (
      <li>
        <Link to={n.link} onClick={() => onClick(n)} className="block">
          {inner}
        </Link>
      </li>
    )
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => onClick(n)}
        className="w-full text-left"
      >
        {inner}
      </button>
    </li>
  )
}

function KindIcon({ kind, unread }: { kind: string; unread: boolean }) {
  const cls = unread ? 'text-accent' : 'text-gray-500'
  // Pick an emoji by kind. Cheap, readable, no extra SVGs to maintain.
  const emoji = (() => {
    switch (kind) {
      case 'tournament_admin_invite':
        return '🛡️'
      case 'tournament_team_invite':
        return '🤝'
      case 'tournament_started':
        return '🏆'
      case 'stat_check_review_request':
        return '📋'
      case 'stat_check_reviewed':
        return '✓'
      case 'stat_check_creator_decision':
        return '⚖️'
      case 'live_group_invite':
        return '🎥'
      case 'reel_invite':
        return '🎬'
      case 'follow':
        return '➕'
      case 'mention':
        return '@'
      default:
        return '🔔'
    }
  })()
  return (
    <span
      className={`shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-full bg-dark-elevated ${cls}`}
      aria-hidden
    >
      {emoji}
    </span>
  )
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
