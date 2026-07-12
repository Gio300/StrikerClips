import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { RoomMessage, RoomType } from '@/types/database'

/**
 * RoomChat — generic realtime chat scoped to any "room".
 *
 * A room is the pair (room_type, room_ref): a clip, reel, match, tournament,
 * or clan_match. All rooms live in the single `public.room_messages` table
 * keyed by that pair, so this one component powers chat everywhere without a
 * new table per surface. Modeled on StreamChat: same realtime wire pattern,
 * same username enrichment, same auto-scroll + char cap.
 *
 * Realtime note: Supabase's `postgres_changes` filter only accepts a single
 * column, so we subscribe on `room_ref=eq.<ref>` and then discard any insert
 * whose `room_type` doesn't match ours in the handler. Two different room
 * types could in principle share a ref value, hence the guard.
 */

type EnrichedMessage = RoomMessage & { username?: string }

export function RoomChat({
  roomType,
  roomRef,
  title,
  className,
}: {
  roomType: RoomType
  roomRef: string
  title?: string
  className?: string
}) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<EnrichedMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Initial backfill + realtime subscription. One effect keyed by the room so
  // we never leak a listener when the user jumps between rooms.
  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function init() {
      const { data, error: err } = await supabase
        .from('room_messages')
        .select('id, room_type, room_ref, user_id, content, created_at')
        .eq('room_type', roomType)
        .eq('room_ref', roomRef)
        .order('created_at', { ascending: true })
        .limit(100)
      if (cancelled) return
      if (err) {
        setError(err.message)
        return
      }
      const rows = (data ?? []) as RoomMessage[]
      const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean) as string[]))
      let nameMap = new Map<string, string>()
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username')
          .in('id', userIds)
        nameMap = new Map((profiles ?? []).map((p) => [p.id, p.username]))
      }
      if (cancelled) return
      setMessages(rows.map((r) => ({ ...r, username: r.user_id ? nameMap.get(r.user_id) : undefined })))

      channel = supabase
        .channel(`room-chat:${roomType}:${roomRef}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_ref=eq.${roomRef}` },
          async (payload) => {
            const row = payload.new as RoomMessage
            // We only filtered by room_ref on the wire; ignore other room types.
            if (row.room_type !== roomType) return
            let username: string | undefined
            if (row.user_id) {
              const { data: prof } = await supabase
                .from('profiles')
                .select('username')
                .eq('id', row.user_id)
                .maybeSingle()
              username = prof?.username
            }
            // De-dupe by id — a fast local echo or a re-delivered event can
            // otherwise double up.
            setMessages((prev) =>
              prev.some((m) => m.id === row.id) ? prev : [...prev, { ...row, username }],
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
  }, [roomType, roomRef])

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
    const { error: err } = await supabase
      .from('room_messages')
      .insert({ room_type: roomType, room_ref: roomRef, user_id: user.id, content })
    setSending(false)
    if (err) {
      setError(err.message)
      return
    }
    setDraft('')
  }

  return (
    <div
      className={`flex flex-col rounded-xl border border-dark-border bg-dark-card overflow-hidden h-[480px] md:h-auto md:max-h-[640px] ${className ?? ''}`}
    >
      <div className="px-3 py-2 border-b border-dark-border text-xs uppercase tracking-wider text-gray-400 flex items-center justify-between">
        <span>Chat</span>
        {title && <span className="truncate text-gray-500 ml-2">{title}</span>}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 text-sm">
        {messages.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-6">Be the first to talk about this.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="leading-snug">
              {m.user_id ? (
                <Link
                  to={`/profile/${m.user_id}`}
                  className="text-accent font-semibold mr-1.5 hover:underline"
                >
                  {m.username ?? 'someone'}
                </Link>
              ) : (
                <span className="text-gray-500 font-semibold mr-1.5">deleted</span>
              )}
              <span className="text-gray-200 break-words">{m.content}</span>
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

export default RoomChat
