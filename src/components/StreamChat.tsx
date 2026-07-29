import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { topBadge, type BadgeMeta } from '@/lib/badges'
import { BadgeChip } from '@/components/BadgeChip'
import { Avatar } from '@/components/ui'
import type { StreamMessage } from '@/types/database'

/**
 * StreamChat — realtime chat panel pinned next to a live stream.
 *
 * Subscribes to inserts on `public.stream_messages` filtered by `stream_id`
 * via Supabase Realtime. We deliberately keep the surface tiny: messages,
 * sender username, "send a message" box. Moderation and reactions can be
 * layered on later without touching the wire format.
 */

// `meta` carries whatever badge-bearing metadata we have for the sender. Only
// the signed-in user's own (optimistic) messages carry it today — profiles
// fetched for other senders don't expose user_metadata, so their badge simply
// degrades to nothing. See badges.ts.
type EnrichedMessage = StreamMessage & {
  username?: string
  avatarUrl?: string | null
  meta?: BadgeMeta
}

/** Short local time (e.g. "3:07 PM") for a chat message row. */
function fmtChatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function StreamChat({ streamId, title }: { streamId: string; title?: string | null }) {
  const { user, profile } = useAuth()
  const [messages, setMessages] = useState<EnrichedMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Initial backfill + realtime subscription. We use one effect because the
  // sub depends on streamId and we don't want listener leaks if the user
  // jumps between streams.
  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function init() {
      const { data, error: err } = await supabase
        .from('stream_messages')
        .select('id, stream_id, user_id, content, created_at')
        .eq('stream_id', streamId)
        .order('created_at', { ascending: true })
        .limit(100)
      if (cancelled) return
      if (err) {
        setError(err.message)
        return
      }
      const rows = (data ?? []) as StreamMessage[]
      const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean) as string[]))
      let nameMap = new Map<string, { username: string; avatar_url: string | null }>()
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .in('id', userIds)
        nameMap = new Map(
          (profiles ?? []).map((p) => [p.id, { username: p.username, avatar_url: p.avatar_url ?? null }]),
        )
      }
      if (cancelled) return
      setMessages(
        rows.map((r) => ({
          ...r,
          username: r.user_id ? nameMap.get(r.user_id)?.username : undefined,
          avatarUrl: r.user_id ? nameMap.get(r.user_id)?.avatar_url ?? null : null,
        })),
      )

      channel = supabase
        .channel(`stream-chat:${streamId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'stream_messages', filter: `stream_id=eq.${streamId}` },
          async (payload) => {
            const row = payload.new as StreamMessage
            let username: string | undefined
            let avatarUrl: string | null = null
            if (row.user_id) {
              const { data: prof } = await supabase
                .from('profiles')
                .select('username, avatar_url')
                .eq('id', row.user_id)
                .maybeSingle()
              username = prof?.username
              avatarUrl = prof?.avatar_url ?? null
            }
            // Dedupe against an optimistic copy we may have already added.
            setMessages((prev) =>
              prev.some((m) => m.id === row.id) ? prev : [...prev, { ...row, username, avatarUrl }],
            )
          },
        )
        .subscribe()
    }

    init()
    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [streamId])

  // Pin to bottom on new messages — but only if the user was already at the
  // bottom (don't yank them away if they scrolled up to read backlog).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !draft.trim() || sending) return
    setSending(true)
    setError(null)
    const content = draft.trim().slice(0, 500)
    const { data: inserted, error: err } = await supabase
      .from('stream_messages')
      .insert({ stream_id: streamId, user_id: user.id, content })
      .select()
      .single()
    setSending(false)
    if (err) {
      setError(err.message)
      return
    }
    setDraft('')
    // Show it right away. The standalone backend has no realtime echo, so we
    // append locally; the real backend WILL echo — deduped by id in the
    // realtime handler above.
    const myName =
      profile?.username ??
      ((user.user_metadata as Record<string, unknown> | undefined)?.username as string | undefined)
    const row =
      (inserted as StreamMessage | null) ?? {
        id: `local-${Date.now()}`,
        stream_id: streamId,
        user_id: user.id,
        content,
        created_at: new Date().toISOString(),
      }
    setMessages((prev) =>
      prev.some((m) => m.id === row.id)
        ? prev
        : [
            ...prev,
            {
              ...row,
              username: myName,
              avatarUrl: profile?.avatar_url ?? null,
              meta: user.user_metadata as BadgeMeta,
            },
          ],
    )
  }

  return (
    <div className="flex flex-col rounded-xl border border-dark-border bg-dark-card overflow-hidden h-[480px] md:h-auto md:max-h-[640px]">
      <div className="px-3 py-2 border-b border-dark-border text-xs uppercase tracking-wider text-gray-400 flex items-center justify-between">
        <span>Chat</span>
        {title && <span className="truncate text-gray-500 ml-2">{title}</span>}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 text-sm">
        {messages.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-6">Be the first to say something.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="leading-snug">
              {m.user_id ? (
                <>
                  <Avatar
                    src={m.avatarUrl}
                    name={m.username}
                    seed={m.user_id}
                    size={18}
                    className="mr-1.5 align-text-bottom"
                  />
                  {topBadge(m.meta) && <BadgeChip badge={topBadge(m.meta)!} compact className="mr-1" />}
                  <Link
                    to={`/profile/${m.user_id}`}
                    className="text-accent font-semibold mr-1.5 hover:underline"
                  >
                    {m.username ?? 'someone'}
                  </Link>
                </>
              ) : (
                <span className="text-gray-500 font-semibold mr-1.5">deleted</span>
              )}
              <span className="text-gray-200 break-words">{m.content}</span>
              {m.created_at && (
                <span className="text-[10px] text-gray-600 ml-1.5 align-baseline">{fmtChatTime(m.created_at)}</span>
              )}
            </div>
          ))
        )}
      </div>
      {error && <p className="px-3 py-1 text-xs text-kunai border-t border-dark-border">{error}</p>}
      <form onSubmit={handleSend} className="border-t border-dark-border p-2 flex gap-2">
        {user ? (
          <>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              placeholder="Say something nice…"
              className="flex-1 px-3 py-1.5 rounded-lg bg-dark border border-dark-border text-white text-sm"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              className="px-3 py-1.5 rounded-lg bg-accent text-dark text-sm font-semibold disabled:opacity-50"
            >
              Send
            </button>
          </>
        ) : (
          <span className="text-xs text-gray-500 px-2 py-1">
            <Link to="/login" className="text-accent hover:underline">Log in</Link> to chat.
          </span>
        )}
      </form>
    </div>
  )
}
