import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { chatRoomKey, type ChatScope } from '@/lib/chatPresence'
import {
  CHAT_TABLES,
  MESSAGE_POLL_LIMIT,
  MESSAGE_POLL_MS,
  classifyPollFailure,
  type ChatMessageTable,
  type ChatPollStatus,
  type MessageCursor,
  type PollMessageLike,
  type PollReadResult,
} from '@/lib/chatMessages'
import { createChatPollLoop, type ChatPollLoop } from '@/lib/chatPollLoop'

/**
 * useChatMessages — the ONE message-delivery client every chat surface consumes.
 *
 * WHAT IT FIXES. All four surfaces registered an INSERT listener on
 * `supabase.channel(...)`, which is a no-op stub in both shipped backends — so
 * another player's message only appeared on remount. Everything built on top
 * (mentions, replies, reactions, typing, presence) shipped and worked; the
 * message list itself did not move. This hook is the transport that makes them
 * mean something.
 *
 * INCREMENTAL, NEVER A REFETCH. The cursor is COMPOSITE — the newest
 * `created_at` the surface is already rendering, plus the ids already delivered
 * at that instant. The timestamp half rides the wire as an INCLUSIVE `.gte()`
 * so a row sharing the boundary instant can never be skipped; the id half is
 * applied by `unseenRows` so the boundary row is not counted as traffic twice.
 * See lib/chatMessages.ts for why the timestamp alone is not a unique ordering
 * and an exclusive bound would silently drop messages.
 *
 * An idle room therefore yields ZERO UNSEEN rows: the idle clock is not reset,
 * the backoff engages, and the surface's `onMessages` (which is where author
 * profiles get hydrated) is not called at all.
 *
 * THIS HOOK IS A SHELL. Every decision — the visibility gate, the idle backoff,
 * the retry window, when the cursor may move — lives in lib/chatPollLoop.ts so
 * it can be IMPORTED and driven by tests rather than re-implemented inside one.
 * This file supplies only what the loop cannot have on its own: `supabase`,
 * `document.visibilityState`, `navigator.onLine`, `Date.now`, and the timer.
 *
 * A BAD NETWORK IS A BAD MOMENT, NOT A DEAD ROOM. `readWindow` below returns an
 * EXPLICIT `PollReadResult` instead of relying on a throw, because the shim it
 * calls (lib/realSupabase.ts `apiFetch`) catches its own network error and
 * RESOLVES with `{ error: 'Network error', status: 0 }`. Under the previous
 * shape that made the intended "skipped tick" recovery path unreachable and ran
 * the permanent branch on the FIRST failed request: a five-second Wi-Fi hiccup
 * froze the room for the life of the mount. Now a transient failure backs off
 * with jitter and retries; `online`/`offline` and a visibility regain drop the
 * backoff so the room catches up the moment the network does; and only two
 * verdicts are terminal — this backend does not have the columns, or the viewer
 * is not allowed to read this room.
 *
 * ONE TIMER PER MOUNTED ROOM. Unlike useChatPresence there is deliberately NO
 * cross-pane refcount here. Presence refcounts because unmounting one pane must
 * not send `leaving` for a room another pane still has open — a correctness
 * requirement. A message poll has no such side effect, and electing one pane as
 * the "driver" would mean that when THAT pane unmounts, a surviving pane whose
 * effect does not re-run stops receiving messages entirely: a silent frozen
 * room, which is the exact bug this hook exists to kill. Two panes on one room
 * (a layout that only occurs on the stage) therefore cost two zero-row range
 * scans per tick, and that is the cheaper mistake.
 *
 * DEGRADES, NEVER DISAPPEARS. Rows are handed to the caller RAW and each surface
 * does its own enrichment and merge, because the four schemas genuinely differ
 * (`chat_messages` stores `body`, the rest store `content`; only ChatSpace
 * resolves equipped tags). If that enrichment THROWS, the rows count as
 * UNDELIVERED: the cursor does not move, the same window is re-read next tick,
 * and the surface says "Reconnecting…" instead of losing messages in silence.
 */

/**
 * A raw message row as the table stores it. Only the three fields the transport
 * reads are constrained — the four surfaces genuinely differ beyond that.
 */
export type RawMessageRow = PollMessageLike

export interface ChatMessagePoll {
  /** False once the read has failed PERMANENTLY — hide any "live" affordance. */
  supported: boolean
  /**
   * What to tell the viewer. 'live' means say nothing at all; 'reconnecting'
   * and 'offline' want the quiet one-liner (components/chat/ChatLiveBar →
   * `ChatConnectionNote`). A blip must never look like a broken chat.
   */
  status: ChatPollStatus
  /** Poll right now (e.g. straight after sending). Safe to call any time. */
  refresh: () => void
}

/**
 * One incremental read, with an EXPLICIT success/failure result.
 *
 * The point of the shape is that this cannot fail silently: it either returns
 * rows or returns a CLASSIFIED failure, and the caller has to unpack `ok` to
 * tell which. Both shipped shims resolve rather than throw on a network error,
 * while the hosted supabase-js client does throw — so both paths are folded
 * into one union here, once, instead of every caller guessing which client it
 * happens to be talking to.
 */
async function readWindow<T>(args: {
  table: ChatMessageTable
  roomCol: string
  roomId: string
  columns: string
  cursor: MessageCursor
}): Promise<PollReadResult<T>> {
  try {
    let query = supabase
      .from(args.table)
      .select(args.columns)
      .eq(args.roomCol, args.roomId)
    // INCLUSIVE on the wire — a row sharing the boundary instant must come back,
    // because it may be one that committed after we last read (see
    // lib/chatMessages.ts). `unseenRows` in the loop makes the VERDICT
    // exclusive. No cursor yet = nothing delivered; read a bounded tail.
    if (args.cursor.at) query = query.gte('created_at', args.cursor.at)
    const response = (await query
      .order('created_at', { ascending: true })
      .limit(MESSAGE_POLL_LIMIT)) as unknown as {
      data: unknown
      error: { message?: string } | null
      status?: number
    }

    // PostgREST and the Express shim both carry the HTTP status, and it is the
    // only way to tell "the connection pool timed out" from "that column does
    // not exist" — server/app.ts answers 400 for BOTH — without reading prose.
    const status = typeof response.status === 'number' ? response.status : null
    if (response.error) {
      const message = response.error.message || 'Could not read messages.'
      return {
        ok: false,
        failure: { kind: classifyPollFailure(message, status), message, status },
      }
    }
    return { ok: true, rows: (response.data ?? []) as T[] }
  } catch (thrown) {
    // A thrown request is ALWAYS the network, never the schema.
    return {
      ok: false,
      failure: {
        kind: 'transient',
        message: thrown instanceof Error ? thrown.message : 'Network error',
        status: null,
      },
    }
  }
}

export function useChatMessages<T extends RawMessageRow>(options: {
  scope: ChatScope
  roomId: string | null | undefined
  /**
   * The surface's COMMITTED list. It is folded into the cursor after each
   * commit, which is what makes an optimistic append count as delivered for
   * free — the sender's own line stops being re-read as if it were new traffic.
   */
  messages: readonly PollMessageLike[]
  /**
   * Columns to select. Falls back to `legacyColumns` once if this backend does
   * not have them, matching the enriched/legacy pair each surface already uses
   * for its initial load. Defaults to '*'.
   */
  columns?: string
  legacyColumns?: string
  /**
   * Called with rows the surface has not seen yet. The surface enriches and
   * merges them (lib/chatMessages.mergeMessages). Never called with an empty
   * array. Re-entrancy safe: the next tick is not issued until this resolves.
   *
   * IF IT THROWS the rows count as UNDELIVERED — the cursor stays put and the
   * next tick re-reads the same window. Prefer degrading (render with a
   * placeholder and backfill later) over throwing, but throwing is SAFE: it
   * costs a re-read, never a lost message.
   */
  onMessages: (rows: T[]) => void | Promise<void>
  /**
   * False while the surface's own initial load is still running. Polling before
   * that lands would read a window the backfill is about to deliver anyway.
   */
  ready?: boolean
  /** Set false to keep the room mounted but silent (e.g. a hidden pane). */
  enabled?: boolean
}): ChatMessagePoll {
  const {
    scope,
    roomId,
    messages,
    columns = '*',
    legacyColumns,
    onMessages,
    ready = true,
    enabled = true,
  } = options

  const roomKey = roomId ? chatRoomKey(scope, roomId) : null
  const spec = CHAT_TABLES[scope]
  const active = Boolean(enabled && ready && roomKey && spec)

  const [status, setStatus] = useState<ChatPollStatus>('live')

  // Latest callback and latest list, without re-arming the timer on every
  // parent render.
  const onMessagesRef = useRef(onMessages)
  onMessagesRef.current = onMessages
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const loopRef = useRef<ChatPollLoop | null>(null)

  // Poll RIGHT NOW. Deliberately NOT a state nonce: re-arming the effect would
  // tear down and rebuild the loop — and its cursor — every time the user sent
  // a message, which is the one moment the cursor matters most.
  const refresh = useCallback(() => {
    void loopRef.current?.tick(true)
  }, [])

  useEffect(() => {
    if (!active || !roomId || !spec) return
    const { table, roomCol } = spec

    const loop = createChatPollLoop<T>({
      hasLegacyColumns: Boolean(legacyColumns),
      now: () => Date.now(),
      visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
      // `navigator.onLine === false` is the only trustworthy half of that API
      // (a true value proves nothing), and that is exactly how it is used here:
      // to SKIP a request we know will fail, never to assume one will succeed.
      online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
      onStatus: setStatus,
      read: (cursor, legacy) =>
        readWindow<T>({
          table,
          roomCol,
          roomId,
          cursor,
          columns: legacy ? legacyColumns ?? columns : columns,
        }),
      deliver: (rows) => onMessagesRef.current(rows),
    })
    loopRef.current = loop
    // A new room is a new cursor, a new cadence, and a new verdict on both.
    setStatus('live')
    loop.observe(messagesRef.current)

    // Not forced: a panel that mounts in a BACKGROUND tab spends nothing until
    // the viewer actually looks at it.
    void loop.tick(false)
    const timer = window.setInterval(() => {
      void loop.tick(false)
    }, MESSAGE_POLL_MS)

    // THE THREE WAYS A ROOM HEALS ITSELF. Each drops the retry window and asks
    // immediately, rather than sitting out a backoff that was measured against
    // a network problem which has just gone away. This is what turns a Wi-Fi
    // hiccup back into a live room without a remount, a reload, or a "tap to
    // reconnect" control the viewer would never find.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      loop.resume()
      void loop.tick(true)
    }
    const onOnline = () => {
      loop.resume()
      void loop.tick(true)
    }
    const onOffline = () => loop.goOffline()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      loop.stop()
      if (loopRef.current === loop) loopRef.current = null
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
    // `messages` is deliberately NOT a dependency: the cursor rides the loop so
    // a new message never re-arms the interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, roomKey, roomId, spec, columns, legacyColumns])

  // AFTER COMMIT, never during render: the cursor may only step over rows that
  // are genuinely on screen. Declared after the effect above so the loop exists
  // by the time this first runs.
  useEffect(() => {
    loopRef.current?.observe(messages)
  }, [messages])

  return { supported: status !== 'unsupported', status, refresh }
}
