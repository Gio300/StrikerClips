import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { topBadge, type BadgeMeta } from '@/lib/badges'
import { BadgeChip } from '@/components/BadgeChip'
import { Avatar } from '@/components/ui'
import { EmojiBurst } from '@/components/EmojiBurst'
import { callFn } from '@/lib/backend'
import { searchPeople, type PersonHit } from '@/lib/liveAngles'
import {
  activeMentionAt,
  extractTkoQuestion,
  encodeTkoBot,
  parseTkoBot,
  parseHighlight,
  isEmojiOnly,
  stripLeadingMarkers,
} from '@/lib/streamChatMarkup'
import {
  armUnlockSound,
  isChatSoundMuted,
  setChatSoundMuted,
} from '@/lib/unlockSound'
import type { StreamMessage } from '@/types/database'

/**
 * StreamChat — realtime chat panel pinned next to a live stream.
 *
 * Subscribes to inserts on `public.stream_messages` filtered by `stream_id`
 * via Supabase Realtime. On top of the plain message surface it adds:
 *   • @tko replies — a line containing "@tko <question>" posts the user's message,
 *     then asks the Gemini-backed `ask` fn and posts the answer back as a distinct
 *     TKO bot line (resilient: a failed ask simply posts nothing).
 *   • @mention autocomplete — the same username search used by the post composer.
 *   • emoji bursts + a short unlock blip when a line is only emoji.
 *   • highlighted lines — server-written, Token-paid pins render with a glow.
 */

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

/** The TKO app mark used on bot lines. */
function TkoMark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-4 w-4 items-center justify-center rounded bg-accent text-dark text-[8px] font-black leading-none ${className}`}
      aria-hidden
    >
      TKO
    </span>
  )
}

export function StreamChat({ streamId, title }: { streamId: string; title?: string | null }) {
  const { user, profile } = useAuth()
  const [messages, setMessages] = useState<EnrichedMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState<boolean>(() => isChatSoundMuted())
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // @mention autocomplete state (reuses searchPeople — the post composer search).
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const [hits, setHits] = useState<PersonHit[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const showMenu = Boolean(mention) && hits.length > 0

  useEffect(() => {
    const q = mention?.query ?? ''
    if (!q || !user) { setHits([]); return }
    let cancelled = false
    const t = window.setTimeout(async () => {
      const people = await searchPeople(q, user.id)
      if (!cancelled) { setHits(people.slice(0, 6)); setActiveIdx(0) }
    }, 150)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [mention?.query, user])

  // Initial backfill + realtime subscription.
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

  // Pin to bottom on new messages — only if already near the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  /** Append an enriched row, deduped by id. */
  function appendLocal(row: StreamMessage, extra: Partial<EnrichedMessage>) {
    setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, { ...row, ...extra }]))
  }

  /** Insert a message row (used for both the user's line and the TKO bot reply). */
  async function insertMessage(content: string): Promise<StreamMessage | null> {
    if (!user) return null
    const { data: inserted } = await supabase
      .from('stream_messages')
      .insert({ stream_id: streamId, user_id: user.id, content })
      .select()
      .single()
    return (
      (inserted as StreamMessage | null) ?? {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        stream_id: streamId,
        user_id: user.id,
        content,
        created_at: new Date().toISOString(),
      }
    )
  }

  /** After a user line posts, if it @tko'd a question, ask + post the reply. */
  async function maybeAnswerTko(text: string) {
    const question = extractTkoQuestion(text)
    if (!question) return
    try {
      const res = await callFn<{ ok: boolean; answer?: string }>('ask', { question })
      const answer = res?.ok ? (res.answer || '').trim() : ''
      if (!answer) return
      const row = await insertMessage(encodeTkoBot(answer))
      if (row) {
        const myName =
          profile?.username ??
          ((user?.user_metadata as Record<string, unknown> | undefined)?.username as string | undefined)
        appendLocal(row, { username: myName, avatarUrl: profile?.avatar_url ?? null })
      }
    } catch {
      /* ask failed — stay silent, never break the chat */
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !draft.trim() || sending) return
    setSending(true)
    setError(null)
    setMention(null)
    const content = stripLeadingMarkers(draft.trim()).slice(0, 500)
    if (!content) { setSending(false); return }
    const row = await insertMessage(content)
    setSending(false)
    if (!row) {
      setError('Could not send the message.')
      return
    }
    setDraft('')
    const myName =
      profile?.username ??
      ((user.user_metadata as Record<string, unknown> | undefined)?.username as string | undefined)
    appendLocal(row, {
      username: myName,
      avatarUrl: profile?.avatar_url ?? null,
      meta: user.user_metadata as BadgeMeta,
    })
    void maybeAnswerTko(content)
  }

  // ── mention composer helpers ──────────────────────────────────────────────
  function syncMention(text: string, caret: number) {
    setMention(activeMentionAt(text, caret))
  }
  function pickMention(person: PersonHit) {
    const username = person.username
    if (!username || !mention) return
    const caret = inputRef.current?.selectionStart ?? draft.length
    const next = `${draft.slice(0, mention.start)}@${username} ${draft.slice(caret)}`
    setDraft(next)
    setMention(null)
    setHits([])
    const pos = mention.start + username.length + 2
    window.requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showMenu) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => (i + 1) % hits.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => (i - 1 + hits.length) % hits.length) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(hits[activeIdx]) }
    else if (e.key === 'Escape') { e.preventDefault(); setMention(null) }
  }

  function toggleMute() {
    setMuted((m) => {
      const next = !m
      setChatSoundMuted(next)
      return next
    })
  }

  return (
    <div
      className="flex flex-col rounded-xl border border-dark-border bg-dark-card overflow-hidden h-[480px] md:h-auto md:max-h-[640px]"
      // Arm the WebAudio blip on the first interaction anywhere in the panel.
      onPointerDown={armUnlockSound}
      onKeyDown={armUnlockSound}
    >
      <div className="px-3 py-2 border-b border-dark-border text-xs uppercase tracking-wider text-gray-400 flex items-center justify-between">
        <span>Chat</span>
        <div className="flex items-center gap-2 min-w-0">
          {title && <span className="truncate text-gray-500">{title}</span>}
          <button
            type="button"
            onClick={toggleMute}
            title={muted ? 'Unmute chat sounds' : 'Mute chat sounds'}
            aria-label={muted ? 'Unmute chat sounds' : 'Mute chat sounds'}
            className="shrink-0 text-gray-500 hover:text-accent"
          >
            {muted ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M11 5 6 9H2v6h4l5 4z" /><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 text-sm">
        {messages.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-6">Be the first to say something.</p>
        ) : (
          messages.map((m) => <ChatLine key={m.id} m={m} />)
        )}
      </div>

      {error && <p className="px-3 py-1 text-xs text-kunai border-t border-dark-border">{error}</p>}

      <form onSubmit={handleSend} className="relative border-t border-dark-border p-2 flex gap-2">
        {showMenu && (
          <ul className="absolute bottom-full left-2 right-2 z-20 mb-1 max-h-56 overflow-y-auto rounded-lg border border-dark-border bg-dark-card py-1 shadow-2xl">
            {hits.map((person, index) => (
              <li key={person.id}>
                <button
                  type="button"
                  onMouseDown={(ev) => { ev.preventDefault(); pickMention(person) }}
                  onMouseEnter={() => setActiveIdx(index)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                    index === activeIdx ? 'bg-dark-border/60 text-white' : 'text-gray-300 hover:bg-dark-border/40'
                  }`}
                >
                  <Avatar src={person.avatar_url} name={person.username} seed={person.id} size={22} />
                  <span className="truncate">@{person.username || 'player'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {user ? (
          <>
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
              }}
              onKeyDown={onKeyDown}
              onClick={(e) => syncMention(draft, e.currentTarget.selectionStart ?? draft.length)}
              onBlur={() => window.setTimeout(() => setMention(null), 120)}
              maxLength={500}
              placeholder="Say something — @mention or ask @tko…"
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

/** One chat row — branches into TKO bot / highlighted / emoji-burst / normal. */
function ChatLine({ m }: { m: EnrichedMessage }) {
  const botAnswer = parseTkoBot(m.content)
  if (botAnswer) {
    return (
      <div className="rounded-lg border border-accent/40 bg-accent/5 px-2 py-1.5 leading-snug">
        <span className="inline-flex items-center gap-1.5 mr-1.5 align-text-bottom">
          <TkoMark />
          <span className="text-accent font-semibold">TKO</span>
        </span>
        <span className="text-gray-100 break-words">{botAnswer}</span>
      </div>
    )
  }

  const highlighted = parseHighlight(m.content)
  const body = highlighted ?? m.content
  const emojiOnly = isEmojiOnly(body)

  const nameBlock = m.user_id ? (
    <>
      <Avatar src={m.avatarUrl} name={m.username} seed={m.user_id} size={18} className="mr-1.5 align-text-bottom" />
      {topBadge(m.meta) && <BadgeChip badge={topBadge(m.meta)!} compact className="mr-1" />}
      <Link to={`/profile/${m.user_id}`} className="text-accent font-semibold mr-1.5 hover:underline">
        {m.username ?? 'someone'}
      </Link>
    </>
  ) : (
    <span className="text-gray-500 font-semibold mr-1.5">deleted</span>
  )

  if (highlighted) {
    return (
      <div className="rounded-lg border border-yellow-400/50 bg-yellow-400/10 px-2 py-1.5 leading-snug shadow-[0_0_0_1px_rgba(250,204,21,0.15)]">
        <span className="mr-1 inline-flex items-center gap-1 rounded-full bg-yellow-400/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-yellow-300 align-text-bottom">
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden><path d="m12 2 3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" /></svg>
          Highlight
        </span>
        {nameBlock}
        <span className="text-yellow-50 font-medium break-words">{body}</span>
        {m.created_at && <span className="text-[10px] text-yellow-200/50 ml-1.5 align-baseline">{fmtChatTime(m.created_at)}</span>}
      </div>
    )
  }

  return (
    <div className="leading-snug">
      {nameBlock}
      {emojiOnly ? (
        <EmojiBurst emoji={body.trim()} />
      ) : (
        <span className="text-gray-200 break-words">{body}</span>
      )}
      {m.created_at && <span className="text-[10px] text-gray-600 ml-1.5 align-baseline">{fmtChatTime(m.created_at)}</span>}
    </div>
  )
}
