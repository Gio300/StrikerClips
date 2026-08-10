import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AtSign,
  Bell,
  CheckCheck,
  ChevronRight,
  CircleDollarSign,
  Clapperboard,
  Link2,
  MessageCircle,
  Radio,
  ShieldCheck,
  ShoppingBag,
  Trophy,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { fetchMyNotifications, markRead, markAllRead } from '@/lib/notifications'
import { supabase } from '@/lib/supabase'
import { LiveLinkOptOut } from '@/components/LiveLinkOptOut'
import { PushNotificationToggle } from '@/components/PushNotificationToggle'
import type { Notification } from '@/types/database'

const LIVE_LINK_KINDS = new Set(['live_link_created', 'live_battle_both_live'])

type ReadFilter = 'all' | 'unread'
type ActivityCategory = 'all' | 'messages' | 'live' | 'competition' | 'creator'

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  all: 'All activity',
  messages: 'Messages',
  live: 'Live',
  competition: 'Competition',
  creator: 'Creator',
}

function categoryFor(kind: string): Exclude<ActivityCategory, 'all'> | 'other' {
  if (kind === 'mention' || kind === 'follow' || kind.includes('message')) return 'messages'
  if (kind.startsWith('live_') || kind.startsWith('oracle_')) return 'live'
  if (kind.startsWith('tournament_') || kind.startsWith('stat_check_') || kind.startsWith('clan_')) return 'competition'
  if (kind.startsWith('reel_') || kind.startsWith('creator_') || kind.includes('sale') || kind.includes('payout')) return 'creator'
  return 'other'
}

export function NotificationsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<Notification[]>([])
  const [actorMap, setActorMap] = useState<Map<string, string>>(new Map())
  const [readFilter, setReadFilter] = useState<ReadFilter>('unread')
  const [category, setCategory] = useState<ActivityCategory>('all')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (showLoading = false) => {
    if (!user) {
      setItems([])
      setLoading(false)
      return
    }
    if (showLoading) setLoading(true)
    const list = await fetchMyNotifications({ limit: 150 })
    const actorIds = Array.from(new Set(list.map((item) => item.actor_id).filter(Boolean) as string[]))
    let names = new Map<string, string>()
    if (actorIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', actorIds)
      names = new Map((profiles ?? []).map((profile) => [profile.id, profile.username]))
    }
    setActorMap(names)
    setItems(list)
    setLoading(false)
  }, [user])

  useEffect(() => {
    let cancelled = false
    const refresh = async (showLoading = false) => {
      if (cancelled) return
      await load(showLoading)
    }
    void refresh(true)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 15_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  async function onClick(item: Notification) {
    if (item.read_at) return
    await markRead(item.id)
    setItems((current) => current.map((entry) => (
      entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry
    )))
  }

  async function onMarkAll() {
    await markAllRead()
    const now = new Date().toISOString()
    setItems((current) => current.map((item) => (item.read_at ? item : { ...item, read_at: now })))
  }

  const unreadCount = items.filter((item) => !item.read_at).length
  const categoryCounts = useMemo(() => {
    const counts: Record<ActivityCategory, number> = { all: items.length, messages: 0, live: 0, competition: 0, creator: 0 }
    items.forEach((item) => {
      const itemCategory = categoryFor(item.kind)
      if (itemCategory !== 'other') counts[itemCategory] += 1
    })
    return counts
  }, [items])
  const visible = useMemo(() => items.filter((item) => {
    if (readFilter === 'unread' && item.read_at) return false
    return category === 'all' || categoryFor(item.kind) === category
  }), [category, items, readFilter])

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
        <h1 className="mb-4 text-2xl font-bold">Activity</h1>
        <div className="rounded-lg border border-dark-border bg-dark-card p-8 text-center">
          <Link to="/login" className="font-semibold text-accent hover:underline">Log in</Link>
          <span className="text-gray-400"> to view messages, matches, live activity, and creator updates.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Bell size={22} className="text-accent" aria-hidden />
            <h1 className="text-2xl font-bold">Activity</h1>
          </div>
          <p className="mt-1 max-w-xl text-sm text-gray-400">
            Messages, live invites, Oracle results, tournaments, clan activity, videos, sales, and payouts.
          </p>
        </div>
        {unreadCount > 0 && (
          <button type="button" onClick={() => { void onMarkAll() }} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-dark-border px-3 text-sm font-semibold text-gray-300 hover:border-accent/60 hover:text-white">
            <CheckCheck size={17} aria-hidden /> Mark all read
          </button>
        )}
      </div>

      {/*
        The phone-notification opt-in lives here, at the top of the page that IS
        activity — not buried in profile settings. It renders nothing at all when
        the deployment has no VAPID keys or the browser cannot do web push, so
        this line is invisible until the feature genuinely works.
      */}
      <PushNotificationToggle className="mb-4" />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(Object.keys(CATEGORY_LABELS) as ActivityCategory[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setCategory(value)}
            className={`min-h-12 rounded-md border px-3 text-left transition-colors ${category === value ? 'border-accent bg-accent/10 text-white' : 'border-dark-border bg-dark-card text-gray-400 hover:border-accent/40'}`}
          >
            <span className="block text-xs font-semibold">{CATEGORY_LABELS[value]}</span>
            <span className="mt-0.5 block text-[11px] tabular-nums text-gray-500">{categoryCounts[value]}</span>
          </button>
        ))}
      </div>

      <div className="mb-4 inline-flex rounded-md border border-dark-border bg-dark-card p-1">
        {(['unread', 'all'] as ReadFilter[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setReadFilter(value)}
            className={`min-h-9 rounded px-4 text-xs font-semibold capitalize transition-colors ${readFilter === value ? 'bg-accent text-dark' : 'text-gray-400 hover:text-white'}`}
          >
            {value}{value === 'unread' && unreadCount > 0 ? ` (${unreadCount})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-lg border border-dark-border bg-dark-card p-8 text-center text-gray-400">Loading activity...</div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dark-border bg-dark-card p-10 text-center">
          <CheckCheck size={28} className="mx-auto mb-3 text-accent" aria-hidden />
          <p className="font-semibold text-white">{readFilter === 'unread' ? 'You are all caught up.' : 'No activity here yet.'}</p>
          <p className="mt-1 text-sm text-gray-500">New activity appears here automatically.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              actorName={item.actor_id ? actorMap.get(item.actor_id) : undefined}
              onClick={onClick}
              viewerId={user.id}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function NotificationRow({
  item,
  actorName,
  onClick,
  viewerId,
}: {
  item: Notification
  actorName?: string
  onClick: (item: Notification) => void
  viewerId: string
}) {
  const linkGroupId = LIVE_LINK_KINDS.has(item.kind) ? item.related_id : null
  const Icon = iconFor(item.kind)
  const inner = (
    <div className={`group rounded-lg border p-3 transition-colors ${item.read_at ? 'border-dark-border bg-dark-card hover:border-accent/30' : 'border-accent/50 bg-accent/5 hover:border-accent'}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${item.read_at ? 'bg-dark-elevated text-gray-500' : 'bg-accent/15 text-accent'}`}>
          <Icon size={19} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-sm font-semibold text-white">{item.title}</p>
            {!item.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
          </div>
          {actorName && <p className="mt-0.5 text-xs font-medium text-accent">@{actorName}</p>}
          {item.body && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-gray-400">{item.body}</p>}
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-gray-500">{timeAgo(item.created_at)}</span>
            {item.link && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400 group-hover:text-accent">Open <ChevronRight size={13} aria-hidden /></span>}
          </div>
        </div>
      </div>
    </div>
  )

  const optOut = linkGroupId ? (
    <div className="mt-1 pl-12">
      <LiveLinkOptOut groupId={linkGroupId} userId={viewerId} />
    </div>
  ) : null

  if (item.link) {
    return (
      <li>
        <Link to={item.link} onClick={() => { void onClick(item) }} className="block">{inner}</Link>
        {optOut}
      </li>
    )
  }
  return (
    <li>
      <button type="button" onClick={() => { void onClick(item) }} className="w-full text-left">{inner}</button>
      {optOut}
    </li>
  )
}

function iconFor(kind: string): LucideIcon {
  if (kind === 'direct_message' || kind === 'group_message') return MessageCircle
  if (kind === 'mention') return AtSign
  if (kind === 'follow') return UserPlus
  if (kind.startsWith('oracle_')) return ShieldCheck
  if (kind.startsWith('live_')) return kind.includes('link') ? Link2 : Radio
  if (kind.startsWith('tournament_') || kind.startsWith('stat_check_')) return Trophy
  if (kind.startsWith('clan_')) return Users
  if (kind.startsWith('reel_')) return Clapperboard
  if (kind.includes('payout')) return CircleDollarSign
  if (kind.includes('sale')) return ShoppingBag
  return Bell
}

function timeAgo(iso: string): string {
  const timestamp = new Date(iso).getTime()
  if (!Number.isFinite(timestamp)) return ''
  const minutes = Math.floor((Date.now() - timestamp) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
