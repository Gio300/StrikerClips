import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { topBadge, type BadgeMeta } from '@/lib/badges'
import { BadgeChip } from '@/components/BadgeChip'
import { Avatar } from '@/components/ui'

/**
 * TournamentChat — a chatroom scoped to a single tournament.
 *
 * Modeled on StreamChat: an initial backfill, a realtime INSERT subscription,
 * optimistic append with id-dedupe, and a log-in gate on the composer.
 *
 * Messages are stored in `tournament_messages` keyed by `tournament_id` — the
 * same shape as `stream_messages` (id, <scope>_id, user_id, content,
 * created_at), so it maps cleanly onto a real Supabase table + RLS later.
 * Anyone can READ; only logged-in users can SEND.
 */

interface TournamentMessage {
  id: string
  tournament_id: string
  user_id: string | null
  content: string
  created_at: string
}

// `meta` carries the sender's badge metadata when we have it (the signed-in
// user's own optimistic messages); other senders degrade to no badge.
type EnrichedMessage = TournamentMessage & {
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

export function TournamentChat({ tournamentId, title }: { tournamentId: string; title?: string | null }) {
  const { user, profile } = useAuth()
  const [messages, setMessages] = useState<EnrichedMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Initial backfill + realtime subscription, keyed by tournament id so we
  // don't leak listeners when the user jumps between tournaments.
  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function init() {
      const { data, error: err } = await supabase
        .from('tournament_messages')
        .select('id, tournament_id, user_id, content, created_at')
        .eq('tournament_id', tournamentId)
        .order('created_at', { ascending: true })
        .limit(100)
      if (cancelled) return
      if (err) {
        setError(err.message)
        return
      }
      const rows = (data ?? []) as TournamentMessage[]
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
        .channel(`tournament-chat:${tournamentId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'tournament_messages', filter: `tournament_id=eq.${tournamentId}` },
          async (payload) => {
            const row = payload.new as TournamentMessage
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
  }, [tournamentId])

  // Pin to bottom on new messages — but only if the user was already near the
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
      .from('tournament_messages')
      .insert({ tournament_id: tournamentId, user_id: user.id, content })
      .select()
      .single()
    setSending(false)
    if (err) {
      setError(err.message)
      return
    }
    setDraft('')
    // Show it right away. The standalone backend has no realtime echo, so we
    // append locally; the real backend WILL echo — deduped by id above.
    const myName =
      profile?.username ??
      ((user.user_metadata as Record<string, unknown> | undefined)?.username as string | undefined)
    const row =
      (inserted as TournamentMessage | null) ?? {
        id: `local-${Date.now()}`,
        tournament_id: tournamentId,
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
    <div className="flex flex-col rounded-xl border border-dark-border bg-dark-card overflow-hidden h-[480px] md:h-[560px]">
      <div className="px-3 py-2 border-b border-dark-border text-xs uppercase tracking-wider text-gray-400 flex items-center justify-between">
        <span>Tournament Chat</span>
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

export default TournamentChat
