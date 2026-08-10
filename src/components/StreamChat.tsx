import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ImagePlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { topBadge, type BadgeMeta } from '@/lib/badges'
import { BadgeChip } from '@/components/BadgeChip'
import { PowerLevelBadge } from '@/components/PlayerMetaLine'
import { TagBadge } from '@/components/TagBadge'
import { Avatar } from '@/components/ui'
import { EmojiBurst } from '@/components/EmojiBurst'
import {
  encodeTkoBot,
  parseTkoBot,
  parseHighlight,
  isEmojiOnly,
} from '@/lib/streamChatMarkup'
import {
  askAssistant,
  cooldownRemainingMs,
  currentPath,
  extractAssistantQuestion,
  throttleLine,
} from '@/lib/chatAssistant'
import { useChatPresence } from '@/hooks/useChatPresence'
import { useChatUnread } from '@/hooks/useChatUnread'
import { useChatDraft } from '@/hooks/useChatDraft'
import { useChatMessages } from '@/hooks/useChatMessages'
import { useChatReactions } from '@/hooks/useChatReactions'
import { MESSAGE_BACKFILL_LIMIT, mergeMessages, orderOldestFirst } from '@/lib/chatMessages'
import { createAuthorCache, type AuthorCache } from '@/lib/chatAuthors'
import { ChatConnectionNote, ChatLiveBar, TypingLine } from '@/components/chat/ChatLiveBar'
import { NewMessagesDivider } from '@/components/chat/NewMessagesDivider'
import {
  ChatRichText,
  EmojiPickerButton,
  MentionMenu,
  ReactionRow,
  ReplyButton,
  ReplyQuote,
  ReplyingToBar,
} from '@/components/chat'
import { ChatAdRail } from '@/components/ChatAdRail'
import { GifPicker } from '@/components/social/GifPicker'
import { GifMessageView } from '@/components/social/GifMessage'
import { encodeGifMessage, gifsEnabled, parseGifMessage, type GifResult } from '@/lib/gifs'
import { encodeChatImage, parseChatImage, uploadChatImage } from '@/lib/chatMedia'
import {
  parseMentions,
  prepareChatMessage,
  serializeMentions,
  type ChatMention,
} from '@/lib/chatMentions'
import {
  replyPreview,
  replyToColumn,
  resolveReplyTarget,
  type ReplyTarget,
} from '@/lib/chatReplies'
import type { ReactionTally } from '@/lib/chatReactions'
import {
  armUnlockSound,
  isChatSoundMuted,
  setChatSoundMuted,
} from '@/lib/unlockSound'
import type { ArtifactRarity, Json, StreamMessage } from '@/types/database'
import { ReportContentButton } from '@/components/ReportContentButton'

/**
 * StreamChat — realtime chat panel pinned next to a live stream.
 *
 * Backfills `public.stream_messages` for this `stream_id`, then keeps the room
 * live on the SHARED incremental poll (useChatMessages) — the app has no push
 * transport, and the Realtime subscription this panel used to register was an
 * inert stub in both shipped backends. On top of the plain message surface it
 * adds:
 *   • @tko replies — a line containing "@tko <question>" (or @oracle / @ai /
 *     /ask) posts the user's message, then asks the Gemini-backed `ask` fn and
 *     posts the answer back as a distinct TKO bot line. Rate limited on BOTH
 *     sides (client cooldown + the fn's per-user window), because a public chat
 *     composer wired straight to a paid model is a billing incident waiting to
 *     happen. A failed or throttled ask posts nothing to the room.
 *   • @mentions, emoji, reactions and replies — all from the SHARED chat
 *     primitive (components/chat + hooks/useChatDraft + useChatReactions), so
 *     this panel, TournamentChat, StageChat and the channel/DM composer behave
 *     identically instead of drifting into four dialects.
 *   • presence + typing — the shared poll-backed live layer (useChatPresence).
 *   • unread count + a "New messages" divider (useChatUnread).
 *   • emoji bursts + a short unlock blip when a line is only emoji.
 *   • highlighted lines — server-written, Token-paid pins render with a glow.
 *
 * MENTIONS ARE STRUCTURAL. The `mentions` column travels with the row and the
 * renderer slices the body at those offsets; the text is never re-scanned for
 * "@name", so an email address can't sprout a chip and nobody can paint a
 * mention onto someone else's words. See src/lib/chatMentions.ts.
 */

type EnrichedMessage = StreamMessage & {
  username?: string
  avatarUrl?: string | null
  powerLevel?: number | null
  equippedTagText?: string | null
  equippedTagRarity?: ArtifactRarity | null
  meta?: BadgeMeta
  /** Validated mentions for THIS row, parsed once at load/append time. */
  mentionList?: ChatMention[]
}

/**
 * Columns including the chat-foundation additions. A backend that predates the
 * migration errors on this select, so the read falls back to LEGACY_COLUMNS —
 * mentions and replies simply don't render there and chat keeps working. Same
 * defensive shape ChatSpace/DirectMessages already use for the tag columns.
 */
const ENRICHED_COLUMNS = 'id, stream_id, user_id, content, created_at, mentions, reply_to'
const LEGACY_COLUMNS = 'id, stream_id, user_id, content, created_at'

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

/** Attach the parsed mention list to a raw row, once. */
function enrich(row: StreamMessage, extra: Partial<EnrichedMessage> = {}): EnrichedMessage {
  return { ...row, mentionList: parseMentions(row.mentions, row.content), ...extra }
}

/** The author identity a stream chat line renders. */
type StreamAuthor = {
  username: string
  avatar_url: string | null
  power_level?: number | null
  equipped_tag_text?: string | null
  equipped_tag_rarity?: ArtifactRarity | null
}

type StreamAuthorRow = StreamAuthor & { id: string }

/**
 * Resolve senders for a BATCH of raw rows. Shared by the initial backfill and
 * the incremental poll so a polled message renders identically to a backfilled
 * one — the old realtime handler resolved one profile per row, which is a
 * request per message on a busy room.
 *
 * Reads `profiles` ONLY for authors this room has never resolved. Identity is
 * near-static, and re-reading the same speakers every 5s was the second half of
 * the poll's request cost (see lib/chatAuthors.ts). In a room where everyone
 * talking has talked before, this makes a tick cost zero profile requests.
 */
async function hydrateRows(
  rows: StreamMessage[],
  authors: AuthorCache<StreamAuthor>,
): Promise<EnrichedMessage[]> {
  const wanted = authors.missing(rows.map((r) => r.user_id))
  if (wanted.length > 0) {
    const enriched = await supabase
      .from('profiles')
      .select('id, username, avatar_url, power_level, equipped_tag_text, equipped_tag_rarity')
      .in('id', wanted)
    let profiles = (enriched.data ?? []) as StreamAuthorRow[]
    let profileError = enriched.error
    if (profileError) {
      const basic = await supabase
        .from('profiles')
        .select('id, username, avatar_url, power_level')
        .in('id', wanted)
      profiles = (basic.data ?? []) as StreamAuthorRow[]
      profileError = basic.error
    }
    // ONLY a read that actually SUCCEEDED may populate the cache. `fill` records
    // "asked for and not returned" as known-absent, so filling from a FAILED
    // read would pin those senders to "someone" for the life of the room rather
    // than resolving them on the next batch.
    if (!profileError) {
      authors.fill(
        wanted,
        new Map(
          profiles.map((p) => [
            p.id,
            {
              username: p.username,
              avatar_url: p.avatar_url ?? null,
              power_level: p.power_level ?? null,
              equipped_tag_text: p.equipped_tag_text ?? null,
              equipped_tag_rarity: p.equipped_tag_rarity ?? null,
            } as StreamAuthor,
          ]),
        ),
      )
    }
  }
  return rows.map((r) =>
    enrich(r, {
      username: authors.get(r.user_id)?.username,
      avatarUrl: authors.get(r.user_id)?.avatar_url ?? null,
      powerLevel: authors.get(r.user_id)?.power_level ?? null,
      equippedTagText: authors.get(r.user_id)?.equipped_tag_text ?? null,
      equippedTagRarity: authors.get(r.user_id)?.equipped_tag_rarity ?? null,
    }),
  )
}

export function StreamChat({ streamId, title }: { streamId: string; title?: string | null }) {
  const { user, profile } = useAuth()
  const [messages, setMessages] = useState<EnrichedMessage[]>([])
  // The backfill has landed — the incremental poll may take over from here.
  const [loaded, setLoaded] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState<boolean>(() => isChatSoundMuted())
  const [notice, setNotice] = useState<string | null>(null)
  const [gifOpen, setGifOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  // No VITE_TENOR_KEY / VITE_GIPHY_KEY → no button, and this composer is exactly
  // what it was before GIFs existed.
  const canGif = useMemo(() => gifsEnabled(), [])
  const scrollRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  // Last assistant call from THIS panel — the client half of the AI cost gate.
  const lastAskAtRef = useRef<number | null>(null)

  // Live layer: presence + typing on the app's poll transport, and the unread
  // watermark. Both go inert for a signed-out viewer or an unreachable backend.
  const presence = useChatPresence({ scope: 'stream', roomId: streamId, userId: user?.id })
  const unread = useChatUnread({ scope: 'stream', roomId: streamId, userId: user?.id, messages })

  // The shared composer brain: draft text + structural mentions + @-autocomplete
  // + emoji insertion. Typing pings ride along on every edit (debounced inside).
  const draft = useChatDraft({
    userId: user?.id ?? null,
    onTyping: presence.notifyTyping,
  })

  const messageIds = useMemo(() => messages.map((m) => m.id), [messages])
  const reactions = useChatReactions({ surface: 'stream', messageIds, userId: user?.id ?? null })

  // Author identity, memoized for the life of THIS room — see hydrateRows.
  const authorsRef = useRef<AuthorCache<StreamAuthor>>(createAuthorCache<StreamAuthor>())

  // Initial backfill. Liveness is the shared poll below, not a subscription.
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    // A new room is a new set of speakers.
    authorsRef.current = createAuthorCache<StreamAuthor>()

    async function init() {
      // NEWEST first. The oldest N put the poll's cursor in ancient history and
      // made it replay the backlog as live traffic; the tail is flipped back to
      // oldest-first for rendering by orderOldestFirst.
      const enrichedRead = await supabase
        .from('stream_messages')
        .select(ENRICHED_COLUMNS)
        .eq('stream_id', streamId)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_BACKFILL_LIMIT)
      const read = enrichedRead.error
        ? await supabase
            .from('stream_messages')
            .select(LEGACY_COLUMNS)
            .eq('stream_id', streamId)
            .order('created_at', { ascending: false })
            .limit(MESSAGE_BACKFILL_LIMIT)
        : enrichedRead
      if (cancelled) return
      if (read.error) {
        setError(read.error.message)
        // Still let the poll take over: a failed backfill must not leave the
        // room permanently frozen, which is the defect this slice removes.
        setLoaded(true)
        return
      }
      const tail = orderOldestFirst((read.data ?? []) as StreamMessage[])
      const hydrated = await hydrateRows(tail, authorsRef.current)
      if (cancelled) return
      setMessages(hydrated)
      setLoaded(true)
    }

    init()
    return () => {
      cancelled = true
    }
  }, [streamId])

  /** Fold rows another client wrote into the log, senders resolved in one read. */
  const onPolled = useCallback(async (rows: StreamMessage[]) => {
    const hydrated = await hydrateRows(rows, authorsRef.current)
    setMessages((prev) => mergeMessages(prev, hydrated, (m) => m.content))
  }, [])

  // THE LIVE LAYER. Incremental `created_at` cursor over the same /api/db read,
  // visibility-gated exactly like presence. Started only once the backfill has
  // landed so the first tick is a delta, never a second full window.
  const delivery = useChatMessages<StreamMessage>({
    scope: 'stream',
    roomId: streamId,
    messages,
    columns: ENRICHED_COLUMNS,
    legacyColumns: LEGACY_COLUMNS,
    onMessages: onPolled,
    ready: loaded,
  })

  // Pin to bottom on new messages — only if already near the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  /** Append an enriched row, deduped by id. */
  function appendLocal(row: StreamMessage, extra: Partial<EnrichedMessage>) {
    setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, enrich(row, extra)]))
  }

  /**
   * Insert a message row (used for the user's line, a GIF, and the TKO bot
   * reply). Writes the chat-foundation columns and RETRIES WITHOUT THEM if the
   * backend rejects the insert, so an older database keeps taking plain messages
   * instead of the composer dead-ending.
   */
  async function insertMessage(
    content: string,
    extras: { mentions?: Json; reply_to?: string | null } = {},
  ): Promise<StreamMessage | null> {
    if (!user) return null
    const base = { stream_id: streamId, user_id: user.id, content }
    const enrichedWrite = await supabase
      .from('stream_messages')
      .insert({ ...base, mentions: extras.mentions ?? [], reply_to: extras.reply_to ?? null })
      .select()
      .single()
    const written = enrichedWrite.error
      ? await supabase.from('stream_messages').insert(base).select().single()
      : enrichedWrite
    return (
      (written.data as StreamMessage | null) ?? {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        stream_id: streamId,
        user_id: user.id,
        content,
        created_at: new Date().toISOString(),
      }
    )
  }

  /**
   * After a user line posts, if it addressed the assistant, ask + post the reply.
   *
   * COST GATE, CLIENT HALF: one call per ASSISTANT_COOLDOWN_MS from this panel.
   * The server enforces the real per-user window; this just means a hot room
   * cannot spend a model call per keystroke-happy user per message. A throttled
   * ask writes NOTHING to the room — the asker sees a local note and that is it,
   * so a rate limit never becomes chat spam everyone else has to read.
   */
  async function maybeAnswerTko(text: string) {
    const question = extractAssistantQuestion(text)
    if (!question) return

    const now = Date.now()
    const wait = cooldownRemainingMs(lastAskAtRef.current, now)
    if (wait > 0) {
      setNotice(throttleLine(wait))
      return
    }
    lastAskAtRef.current = now

    const result = await askAssistant(question, { path: currentPath() })
    if (result.kind === 'throttled') {
      // The server said no — let the client cooldown expire naturally so the
      // next attempt actually reaches it.
      setNotice(result.message)
      return
    }
    if (result.kind !== 'answer') return

    setNotice(null)
    const row = await insertMessage(encodeTkoBot(result.answer))
    if (row) {
      const myName =
        profile?.username ??
        ((user?.user_metadata as Record<string, unknown> | undefined)?.username as string | undefined)
      appendLocal(row, {
        username: myName,
        avatarUrl: profile?.avatar_url ?? null,
        powerLevel: profile?.power_level ?? null,
        equippedTagText: profile?.equipped_tag_text ?? null,
        equippedTagRarity: profile?.equipped_tag_rarity ?? null,
      })
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !draft.text.trim() || sending) return
    setSending(true)
    setError(null)
    setNotice(null)
    // ONE place strips markers, trims, caps AND re-anchors the mentions — doing
    // those edits without moving the offsets is how chips end up on the wrong
    // words. See prepareChatMessage in lib/chatMentions.ts.
    const outgoing = prepareChatMessage({ text: draft.text, mentions: draft.mentions })
    if (!outgoing.text) { setSending(false); return }
    const parent = replyToColumn(replyTo)
    const row = await insertMessage(outgoing.text, {
      mentions: serializeMentions(outgoing.text, outgoing.mentions),
      reply_to: parent,
    })
    setSending(false)
    if (!row) {
      setError('Could not send the message.')
      return
    }
    draft.reset()
    setReplyTo(null)
    const myName =
      profile?.username ??
      ((user.user_metadata as Record<string, unknown> | undefined)?.username as string | undefined)
    appendLocal(
      { ...row, reply_to: row.reply_to ?? parent },
      {
        username: myName,
        avatarUrl: profile?.avatar_url ?? null,
        powerLevel: profile?.power_level ?? null,
        equippedTagText: profile?.equipped_tag_text ?? null,
        equippedTagRarity: profile?.equipped_tag_rarity ?? null,
        meta: user.user_metadata as BadgeMeta,
        // Use the mentions we just computed rather than re-parsing the echo —
        // a legacy backend drops the column and the chips would vanish.
        mentionList: outgoing.mentions,
      },
    )
    void maybeAnswerTko(outgoing.text)
  }

  /**
   * Post a GIF. It goes through insertMessage directly rather than handleSend
   * because the encoded marker is one atomic body: it must not be truncated by
   * the 500-char composer clamp, and stripLeadingMarkers() would be wrong to
   * apply to a body this path — not the user — just produced.
   */
  async function sendGif(gif: GifResult) {
    if (!user || sending) return
    setSending(true)
    setError(null)
    try {
      const body = encodeGifMessage(gif)
      const row = await insertMessage(body, { reply_to: replyToColumn(replyTo) })
      if (!row) { setError('Could not send the GIF.'); return }
      setGifOpen(false)
      setReplyTo(null)
      const myName =
        profile?.username ??
        ((user.user_metadata as Record<string, unknown> | undefined)?.username as string | undefined)
      appendLocal(row, {
        username: myName,
        avatarUrl: profile?.avatar_url ?? null,
        powerLevel: profile?.power_level ?? null,
        equippedTagText: profile?.equipped_tag_text ?? null,
        equippedTagRarity: profile?.equipped_tag_rarity ?? null,
        meta: user.user_metadata as BadgeMeta,
      })
    } catch {
      setError('Could not send the GIF.')
    } finally {
      setSending(false)
    }
  }

  /** Upload and post one image as an atomic chat-media marker. */
  async function sendImage(file: File) {
    if (!user || sending) {
      if (imageInputRef.current) imageInputRef.current.value = ''
      return
    }
    setSending(true)
    setError(null)
    try {
      const image = await uploadChatImage(file, streamId, 'stream')
      const parent = replyToColumn(replyTo)
      const row = await insertMessage(encodeChatImage(image), { reply_to: parent })
      if (!row) {
        setError('Could not send the image.')
        return
      }
      setReplyTo(null)
      const myName =
        profile?.username ??
        ((user.user_metadata as Record<string, unknown> | undefined)?.username as string | undefined)
      appendLocal(
        { ...row, reply_to: row.reply_to ?? parent },
        {
          username: myName,
          avatarUrl: profile?.avatar_url ?? null,
          powerLevel: profile?.power_level ?? null,
          equippedTagText: profile?.equipped_tag_text ?? null,
          equippedTagRarity: profile?.equipped_tag_rarity ?? null,
          meta: user.user_metadata as BadgeMeta,
        },
      )
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send the image.')
    } finally {
      setSending(false)
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }

  /** Scroll a quoted parent into view when its preview is clicked. */
  const jumpToMessage = useCallback((messageId: string) => {
    const el = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

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
        <span className="flex items-center gap-1.5">
          Chat
          {unread.count > 0 && (
            <span className="rounded-full bg-kunai/20 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-kunai">
              {unread.count > 99 ? '99+' : unread.count}
            </span>
          )}
        </span>
        <div className="flex items-center gap-2 min-w-0">
          {title && <span className="truncate text-gray-500">{title}</span>}
          <ChatLiveBar members={presence.members} supported={presence.supported} selfId={user?.id ?? null} />
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
          messages.map((m) => (
            <div key={m.id} className="group">
              {unread.dividerBeforeId === m.id && <NewMessagesDivider count={unread.count} />}
              <ChatLine
                m={m}
                viewerId={user?.id ?? null}
                messages={messages}
                tallies={reactions.talliesFor(m.id)}
                showReactions={reactions.supported}
                canReact={Boolean(user)}
                onToggleReaction={(emoji) => reactions.toggle(m.id, emoji)}
                onReply={user ? () => setReplyTo(replyTargetFor(m)) : undefined}
                onJump={jumpToMessage}
              />
              <ReportContentButton
                reporterId={user?.id}
                targetOwnerId={parseTkoBot(m.content) ? null : m.user_id}
                targetType="stream_message"
                targetId={m.id}
                className="mt-0.5 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100"
              />
            </div>
          ))
        )}
      </div>

      <TypingLine line={presence.typingLine} />

      {/* Delivery is struggling. Sits BELOW the log and ABOVE the composer so
          it reads as a status line, not as a failed message. Renders nothing
          while messages are arriving. */}
      <ChatConnectionNote status={delivery.status} />

      {/* The one in-chat ad. Outside the scroll area so it never moves the
          conversation, and rendered for nobody entitled to ad-free. */}
      <ChatAdRail />

      {notice && <p className="px-3 py-1 text-xs text-gray-500 border-t border-dark-border">{notice}</p>}
      {error && <p className="px-3 py-1 text-xs text-kunai border-t border-dark-border">{error}</p>}

      {gifOpen && canGif && user && (
        <div className="border-t border-dark-border p-2">
          <GifPicker onPick={sendGif} onClose={() => setGifOpen(false)} />
        </div>
      )}

      {replyTo && user && <ReplyingToBar target={replyTo} onCancel={() => setReplyTo(null)} />}

      <form onSubmit={handleSend} className="relative border-t border-dark-border p-2 flex gap-2">
        <MentionMenu draft={draft} />
        {user ? (
          <>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void sendImage(file)
              }}
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={sending}
              aria-label="Send an image"
              title="Send an image"
              className="shrink-0 rounded-lg border border-dark-border px-2 py-1.5 text-gray-400 hover:text-white disabled:opacity-50"
            >
              <ImagePlus className="h-4 w-4" aria-hidden />
            </button>
            {canGif && (
              <button
                type="button"
                onClick={() => setGifOpen((open) => !open)}
                aria-label="Send a GIF"
                aria-expanded={gifOpen}
                title="Send a GIF"
                className={`shrink-0 px-2 py-1.5 rounded-lg border text-xs font-black ${
                  gifOpen
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-dark-border text-gray-400 hover:text-white'
                }`}
              >
                GIF
              </button>
            )}
            <input
              ref={(el) => {
                draft.inputRef.current = el
              }}
              type="text"
              value={draft.text}
              onChange={draft.onChange}
              onKeyDown={draft.onKeyDown}
              onClick={draft.onCaretMove}
              onBlur={draft.onBlur}
              maxLength={500}
              placeholder="Say something — @mention, :fire:, or ask @tko…"
              className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-dark border border-dark-border text-white text-sm"
            />
            <EmojiPickerButton
              onPick={draft.insertEmoji}
              className="shrink-0 [&>button]:h-[34px] [&>button]:w-[34px]"
            />
            <button
              type="submit"
              disabled={!draft.text.trim() || sending}
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

/** How a row describes itself when it becomes the PARENT of a reply. */
function replyTargetFor(m: EnrichedMessage): ReplyTarget {
  return {
    id: m.id,
    author: m.username ?? 'someone',
    preview: replyPreview(m.content),
    authorId: m.user_id,
  }
}

/** One chat row — branches into TKO bot / highlighted / GIF / emoji / normal. */
function ChatLine({
  m,
  viewerId,
  messages,
  tallies,
  showReactions,
  canReact,
  onToggleReaction,
  onReply,
  onJump,
}: {
  m: EnrichedMessage
  viewerId: string | null
  messages: readonly EnrichedMessage[]
  tallies: readonly ReactionTally[]
  showReactions: boolean
  canReact: boolean
  onToggleReaction: (emoji: string) => void
  onReply?: () => void
  onJump: (messageId: string) => void
}) {
  const botAnswer = parseTkoBot(m.content)
  const parent = resolveReplyTarget(m.reply_to, messages, (row) => ({
    author: row.username ?? 'someone',
    body: row.content,
    authorId: row.user_id,
  }))
  const footer = showReactions ? (
    <ReactionRow tallies={tallies} onToggle={onToggleReaction} canReact={canReact} />
  ) : null

  if (botAnswer) {
    return (
      <div data-message-id={m.id} className="rounded-lg border border-accent/40 bg-accent/5 px-2 py-1.5 leading-snug">
        <span className="inline-flex items-center gap-1.5 mr-1.5 align-text-bottom">
          <TkoMark />
          <span className="text-accent font-semibold">TKO</span>
        </span>
        <span className="text-gray-100 break-words">{botAnswer}</span>
        {footer}
      </div>
    )
  }

  const highlighted = parseHighlight(m.content)
  const body = highlighted ?? m.content
  // A GIF body only renders as a GIF when the WHOLE message is a well-formed
  // marker pointing at an allowlisted provider host (src/lib/gifs.ts) — a
  // hand-typed marker falls through to plain text, never to an embed.
  const gif = parseGifMessage(body)
  const image = parseChatImage(body)
  const emojiOnly = !gif && !image && isEmojiOnly(body)

  const nameBlock = m.user_id ? (
    <>
      <Avatar src={m.avatarUrl} name={m.username} seed={m.user_id} size={18} className="mr-1.5 align-text-bottom" />
      {topBadge(m.meta) && <BadgeChip badge={topBadge(m.meta)!} compact className="mr-1" />}
      <Link to={`/profile/${m.user_id}`} className="text-accent font-semibold mr-1.5 hover:underline">
        {m.username ?? 'someone'}
      </Link>
      <TagBadge
        artifactText={m.equippedTagText}
        rarity={m.equippedTagRarity}
        className="mr-1 max-w-[7rem] truncate !rounded-sm !px-1 !py-px !text-[9px] !leading-none"
      />
      <PowerLevelBadge powerLevel={m.powerLevel} className="mr-1" />
    </>
  ) : (
    <span className="text-gray-500 font-semibold mr-1.5">deleted</span>
  )

  if (highlighted) {
    return (
      <div
        data-message-id={m.id}
        className="rounded-lg border border-yellow-400/50 bg-yellow-400/10 px-2 py-1.5 leading-snug shadow-[0_0_0_1px_rgba(250,204,21,0.15)]"
      >
        {parent && <ReplyQuote target={parent} onJump={onJump} className="mb-1" />}
        <span className="mr-1 inline-flex items-center gap-1 rounded-full bg-yellow-400/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-yellow-300 align-text-bottom">
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden><path d="m12 2 3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" /></svg>
          Highlight
        </span>
        {nameBlock}
        <ChatRichText
          text={body}
          mentions={m.mentionList}
          viewerId={viewerId}
          className="text-yellow-50 font-medium break-words"
        />
        {m.created_at && <span className="text-[10px] text-yellow-200/50 ml-1.5 align-baseline">{fmtChatTime(m.created_at)}</span>}
        {footer}
      </div>
    )
  }

  if (gif) {
    return (
      <div data-message-id={m.id} className="group leading-snug">
        {parent && <ReplyQuote target={parent} onJump={onJump} className="mb-0.5" />}
        {nameBlock}
        {m.created_at && <span className="text-[10px] text-gray-600 ml-0.5 align-baseline">{fmtChatTime(m.created_at)}</span>}
        {onReply && (
          <ReplyButton onClick={onReply} className="ml-1 opacity-0 group-hover:opacity-100 focus:opacity-100" />
        )}
        <GifMessageView gif={gif} />
        {footer}
      </div>
    )
  }

  if (image) {
    return (
      <div data-message-id={m.id} className="group leading-snug">
        {parent && <ReplyQuote target={parent} onJump={onJump} className="mb-0.5" />}
        {nameBlock}
        {m.created_at && <span className="text-[10px] text-gray-600 ml-0.5 align-baseline">{fmtChatTime(m.created_at)}</span>}
        {onReply && (
          <ReplyButton onClick={onReply} className="ml-1 opacity-0 group-hover:opacity-100 focus:opacity-100" />
        )}
        <a
          href={image.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block w-fit max-w-full overflow-hidden rounded-lg"
        >
          <img
            src={image.url}
            alt={image.alt}
            loading="lazy"
            className="max-h-[28rem] max-w-full rounded-lg object-contain"
          />
        </a>
        {footer}
      </div>
    )
  }

  return (
    <div data-message-id={m.id} className="group leading-snug">
      {parent && <ReplyQuote target={parent} onJump={onJump} className="mb-0.5" />}
      {nameBlock}
      {emojiOnly ? (
        <EmojiBurst emoji={body.trim()} />
      ) : (
        <ChatRichText
          text={body}
          mentions={m.mentionList}
          viewerId={viewerId}
          className="text-gray-200 break-words"
        />
      )}
      {m.created_at && <span className="text-[10px] text-gray-600 ml-1.5 align-baseline">{fmtChatTime(m.created_at)}</span>}
      {onReply && (
        <ReplyButton onClick={onReply} className="ml-1 opacity-0 group-hover:opacity-100 focus:opacity-100" />
      )}
      {footer}
    </div>
  )
}
