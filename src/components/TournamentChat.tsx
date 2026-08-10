import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ImagePlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { topBadge, type BadgeMeta } from '@/lib/badges'
import { BadgeChip } from '@/components/BadgeChip'
import { Avatar } from '@/components/ui'
import {
  askAssistant,
  cooldownRemainingMs,
  currentPath,
  extractAssistantQuestion,
  throttleLine,
} from '@/lib/chatAssistant'
import { encodeTkoBot, parseTkoBot } from '@/lib/streamChatMarkup'
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
import type { Json } from '@/types/database'
import { ReportContentButton } from '@/components/ReportContentButton'

/**
 * TournamentChat — a chatroom scoped to a single tournament.
 *
 * Modeled on StreamChat: an initial backfill, a realtime INSERT subscription,
 * optimistic append with id-dedupe, and a log-in gate on the composer. It now
 * shares StreamChat's live layer too — presence, typing, unread divider and the
 * in-chat assistant all come from the same primitives rather than a second
 * implementation.
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
  /** Structural @mentions + reply parent — see src/lib/chatMentions.ts. */
  mentions?: Json | null
  reply_to?: string | null
}

// `meta` carries the sender's badge metadata when we have it (the signed-in
// user's own optimistic messages); other senders degrade to no badge.
type EnrichedMessage = TournamentMessage & {
  username?: string
  avatarUrl?: string | null
  meta?: BadgeMeta
  /** Validated mentions for THIS row, parsed once at load/append time. */
  mentionList?: ChatMention[]
}

/**
 * The chat-foundation columns, with a legacy fallback: a backend that predates
 * the migration errors on this select, and the read retries without them so
 * tournament chat keeps working with no mentions/replies rather than blanking.
 */
const ENRICHED_COLUMNS = 'id, tournament_id, user_id, content, created_at, mentions, reply_to'
const LEGACY_COLUMNS = 'id, tournament_id, user_id, content, created_at'

/** Attach the parsed mention list to a raw row, once. */
function enrich(row: TournamentMessage, extra: Partial<EnrichedMessage> = {}): EnrichedMessage {
  return { ...row, mentionList: parseMentions(row.mentions, row.content), ...extra }
}

/** The author identity a tournament chat line renders. */
type TournamentAuthor = { username: string; avatar_url: string | null }

/**
 * Resolve senders for a BATCH of raw rows — shared by the initial backfill and
 * the incremental poll, so a polled message renders exactly like a backfilled
 * one and a burst costs one profile read rather than one per message.
 *
 * Reads `profiles` ONLY for authors this room has never resolved, so a tick in
 * a room whose speakers are already known costs no profile request at all (see
 * lib/chatAuthors.ts).
 */
async function hydrateRows(
  rows: TournamentMessage[],
  authors: AuthorCache<TournamentAuthor>,
): Promise<EnrichedMessage[]> {
  const wanted = authors.missing(rows.map((r) => r.user_id))
  if (wanted.length > 0) {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', wanted)
    // ONLY a read that actually SUCCEEDED may populate the cache — `fill` treats
    // an asked-for id that did not come back as known-absent, and a transient
    // failure must not blank a sender for the life of the room.
    if (!error) {
      authors.fill(
        wanted,
        new Map(
          (profiles ?? []).map((p) => [
            p.id,
            { username: p.username, avatar_url: p.avatar_url ?? null } as TournamentAuthor,
          ]),
        ),
      )
    }
  }
  return rows.map((r) =>
    enrich(r, {
      username: authors.get(r.user_id)?.username,
      avatarUrl: authors.get(r.user_id)?.avatar_url ?? null,
    }),
  )
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
  // The backfill has landed — the incremental poll may take over from here.
  const [loaded, setLoaded] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [gifOpen, setGifOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  // No provider key → no button, and the composer is untouched.
  const canGif = useMemo(() => gifsEnabled(), [])
  const scrollRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const lastAskAtRef = useRef<number | null>(null)

  const presence = useChatPresence({ scope: 'tournament', roomId: tournamentId, userId: user?.id })
  const unread = useChatUnread({ scope: 'tournament', roomId: tournamentId, userId: user?.id, messages })

  // The SAME composer brain and reaction store the live chat uses — mentions,
  // emoji and reactions behave identically here by construction, not by copy.
  const draft = useChatDraft({ userId: user?.id ?? null, onTyping: presence.notifyTyping })
  const messageIds = useMemo(() => messages.map((m) => m.id), [messages])
  const reactions = useChatReactions({ surface: 'tournament', messageIds, userId: user?.id ?? null })

  /** Scroll a quoted parent into view when its preview is clicked. */
  const jumpToMessage = useCallback((messageId: string) => {
    const el = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  // Author identity, memoized for the life of THIS room — see hydrateRows.
  const authorsRef = useRef<AuthorCache<TournamentAuthor>>(createAuthorCache<TournamentAuthor>())

  // Initial backfill, keyed by tournament id. Liveness is the shared
  // incremental poll below, not a subscription.
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    // A new room is a new set of speakers.
    authorsRef.current = createAuthorCache<TournamentAuthor>()

    async function init() {
      // NEWEST first — the oldest N put the poll's cursor in ancient history
      // and replayed the backlog as if it were arriving live.
      const enrichedRead = await supabase
        .from('tournament_messages')
        .select(ENRICHED_COLUMNS)
        .eq('tournament_id', tournamentId)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_BACKFILL_LIMIT)
      const read = enrichedRead.error
        ? await supabase
            .from('tournament_messages')
            .select(LEGACY_COLUMNS)
            .eq('tournament_id', tournamentId)
            .order('created_at', { ascending: false })
            .limit(MESSAGE_BACKFILL_LIMIT)
        : enrichedRead
      if (cancelled) return
      if (read.error) {
        setError(read.error.message)
        // Let the poll take over anyway — a failed backfill must not leave the
        // room permanently frozen, which is the defect this slice removes.
        setLoaded(true)
        return
      }
      const tail = orderOldestFirst((read.data ?? []) as TournamentMessage[])
      const hydrated = await hydrateRows(tail, authorsRef.current)
      if (cancelled) return
      setMessages(hydrated)
      setLoaded(true)
    }

    init()
    return () => {
      cancelled = true
    }
  }, [tournamentId])

  /** Fold rows another client wrote into the log, senders resolved in one read. */
  const onPolled = useCallback(async (rows: TournamentMessage[]) => {
    const hydrated = await hydrateRows(rows, authorsRef.current)
    setMessages((prev) => mergeMessages(prev, hydrated, (m) => m.content))
  }, [])

  // THE LIVE LAYER — the same incremental cursor + visibility gate every chat
  // surface now uses. Starts only once the backfill has landed.
  const delivery = useChatMessages<TournamentMessage>({
    scope: 'tournament',
    roomId: tournamentId,
    messages,
    columns: ENRICHED_COLUMNS,
    legacyColumns: LEGACY_COLUMNS,
    onMessages: onPolled,
    ready: loaded,
  })

  // Pin to bottom on new messages — but only if the user was already near the
  // bottom (don't yank them away if they scrolled up to read backlog).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  /**
   * Insert one tournament_messages row and optimistically append it. Used for
   * the user's own line AND the assistant's reply, so both go through the same
   * dedupe. Throws the backend's message so the caller can surface it.
   */
  async function insertMessage(
    content: string,
    extras: { mentions?: Json; reply_to?: string | null; mentionList?: ChatMention[] } = {},
  ): Promise<TournamentMessage> {
    if (!user) throw new Error('Log in to chat.')
    const base = { tournament_id: tournamentId, user_id: user.id, content }
    // Try WITH the chat-foundation columns; retry without them so an older
    // database still takes plain messages instead of dead-ending the composer.
    const enrichedWrite = await supabase
      .from('tournament_messages')
      .insert({ ...base, mentions: extras.mentions ?? [], reply_to: extras.reply_to ?? null })
      .select()
      .single()
    const { data: inserted, error: err } = enrichedWrite.error
      ? await supabase.from('tournament_messages').insert(base).select().single()
      : enrichedWrite
    if (err) throw new Error(err.message || 'Could not send the message.')
    // Show it right away. The standalone backend has no realtime echo, so we
    // append locally; the real backend WILL echo — deduped by id above.
    const myName =
      profile?.username ??
      ((user.user_metadata as Record<string, unknown> | undefined)?.username as string | undefined)
    const row =
      (inserted as TournamentMessage | null) ?? {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        tournament_id: tournamentId,
        user_id: user.id,
        content,
        created_at: new Date().toISOString(),
      }
    if (extras.reply_to && !row.reply_to) row.reply_to = extras.reply_to
    setMessages((prev) =>
      prev.some((m) => m.id === row.id)
        ? prev
        : [
            ...prev,
            enrich(row, {
              username: myName,
              avatarUrl: profile?.avatar_url ?? null,
              meta: user.user_metadata as BadgeMeta,
              // Prefer the mentions we just computed: a legacy backend drops the
              // column, and re-parsing the echo would lose the chips.
              ...(extras.mentionList ? { mentionList: extras.mentionList } : {}),
            }),
          ],
    )
    return row
  }

  /**
   * "@tko who's left in this bracket?" — the same assistant, the same fn and the
   * same two-sided cost gate as the live chat. A throttled or failed ask posts
   * nothing to the room; the asker gets a local note.
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
      setNotice(result.message)
      return
    }
    if (result.kind !== 'answer') return
    setNotice(null)
    try {
      await insertMessage(encodeTkoBot(result.answer))
    } catch {
      /* the answer just doesn't land — never break the chat over it */
    }
  }

  /**
   * Post a GIF. Straight through insertMessage: the encoded marker is one
   * atomic body that must not meet the 500-char composer clamp or the
   * leading-marker strip, neither of which the user authored.
   */
  async function sendGif(gif: GifResult) {
    if (!user || sending) return
    setSending(true)
    setError(null)
    try {
      await insertMessage(encodeGifMessage(gif), { reply_to: replyToColumn(replyTo) })
      setGifOpen(false)
      setReplyTo(null)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send the GIF.')
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
      const image = await uploadChatImage(file, tournamentId, 'tournament')
      await insertMessage(encodeChatImage(image), { reply_to: replyToColumn(replyTo) })
      setReplyTo(null)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send the image.')
    } finally {
      setSending(false)
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !draft.text.trim() || sending) return
    setSending(true)
    setError(null)
    setNotice(null)
    // Strips the leading control markers (so nobody forges an assistant line by
    // pasting the prefix), trims, caps at 500 — and re-anchors the mentions to
    // the text those edits produced. See prepareChatMessage.
    const outgoing = prepareChatMessage({ text: draft.text, mentions: draft.mentions })
    if (!outgoing.text) { setSending(false); return }
    try {
      await insertMessage(outgoing.text, {
        mentions: serializeMentions(outgoing.text, outgoing.mentions),
        reply_to: replyToColumn(replyTo),
        mentionList: outgoing.mentions,
      })
      draft.reset()
      setReplyTo(null)
      void maybeAnswerTko(outgoing.text)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send the message.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-dark-border bg-dark-card overflow-hidden h-[480px] md:h-[560px]">
      <div className="px-3 py-2 border-b border-dark-border text-xs uppercase tracking-wider text-gray-400 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          Tournament Chat
          {unread.count > 0 && (
            <span className="rounded-full bg-kunai/20 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-kunai">
              {unread.count > 99 ? '99+' : unread.count}
            </span>
          )}
        </span>
        <div className="ml-2 flex min-w-0 items-center gap-2">
          {title && <span className="truncate text-gray-500">{title}</span>}
          <ChatLiveBar members={presence.members} supported={presence.supported} selfId={user?.id ?? null} />
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 text-sm">
        {messages.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-6">Be the first to say something.</p>
        ) : (
          messages.map((m) => {
            const botAnswer = parseTkoBot(m.content)
            const tallies = reactions.talliesFor(m.id)
            const footer = reactions.supported ? (
              <ReactionRow
                tallies={tallies}
                onToggle={(emoji) => reactions.toggle(m.id, emoji)}
                canReact={Boolean(user)}
              />
            ) : null
            const parent = resolveReplyTarget(m.reply_to, messages, (row) => ({
              author: row.username ?? 'someone',
              body: row.content,
              authorId: row.user_id,
            }))
            if (botAnswer) {
              return (
                <div key={m.id} data-message-id={m.id}>
                  {unread.dividerBeforeId === m.id && <NewMessagesDivider count={unread.count} />}
                  <div className="rounded-lg border border-accent/40 bg-accent/5 px-2 py-1.5 leading-snug">
                    <span className="mr-1.5 inline-flex items-center gap-1.5 align-text-bottom">
                      <span
                        className="inline-flex h-4 w-4 items-center justify-center rounded bg-accent text-[8px] font-black leading-none text-dark"
                        aria-hidden
                      >
                        TKO
                      </span>
                      <span className="font-semibold text-accent">TKO</span>
                    </span>
                    <span className="break-words text-gray-100">{botAnswer}</span>
                    {footer}
                    <ReportContentButton
                      reporterId={user?.id}
                      targetOwnerId={null}
                      targetType="tournament_message"
                      targetId={m.id}
                      className="mt-1 -ml-2"
                    />
                  </div>
                </div>
              )
            }
            // Only a whole-body marker on an allowlisted provider host renders
            // as a GIF; anything else stays plain text (src/lib/gifs.ts).
            const gif = parseGifMessage(m.content)
            const image = parseChatImage(m.content)
            return (
            <div key={m.id} data-message-id={m.id} className="group leading-snug">
              {unread.dividerBeforeId === m.id && <NewMessagesDivider count={unread.count} />}
              {parent && <ReplyQuote target={parent} onJump={jumpToMessage} className="mb-0.5" />}
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
              {!gif && !image && (
                <ChatRichText
                  text={m.content}
                  mentions={m.mentionList}
                  viewerId={user?.id ?? null}
                  className="text-gray-200 break-words"
                />
              )}
              {m.created_at && (
                <span className="text-[10px] text-gray-600 ml-1.5 align-baseline">{fmtChatTime(m.created_at)}</span>
              )}
              {user && (
                <ReplyButton
                  onClick={() =>
                    setReplyTo({
                      id: m.id,
                      author: m.username ?? 'someone',
                      preview: replyPreview(m.content),
                      authorId: m.user_id,
                    })
                  }
                  className="ml-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
                />
              )}
              <ReportContentButton
                reporterId={user?.id}
                targetOwnerId={m.user_id}
                targetType="tournament_message"
                targetId={m.id}
                className="ml-1 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100"
              />
              {gif && <GifMessageView gif={gif} />}
              {image && (
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
              )}
              {footer}
            </div>
            )
          })
        )}
      </div>
      <TypingLine line={presence.typingLine} />
      {/* Delivery is struggling — a status line under the log, never an error. */}
      <ChatConnectionNote status={delivery.status} />
      {/* The one in-chat ad — outside the scroll area, hidden for anyone
          entitled to ad-free (personal tier OR league plan). */}
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

export default TournamentChat
