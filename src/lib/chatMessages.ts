/**
 * chatMessages — the pure, DOM-free core of chat MESSAGE DELIVERY.
 *
 * WHY THIS EXISTS. Every chat surface in this app was "fetch once on mount +
 * optimistically append your own line". The only thing that claimed to be live
 * was `supabase.channel(...).on('postgres_changes', ...)`, and in BOTH shipped
 * backends `channel()` returns an inert stub (src/lib/realSupabase.ts,
 * src/lib/mockSupabase.ts) — the callback is registered against an object that
 * never fires. So another player's message became visible only when the room
 * remounted. Presence, typing, mentions, reactions and replies all shipped on
 * top of a list that never moved: "Gio is typing…" above a frozen log.
 *
 * TRANSPORT: an INCREMENTAL poll, deliberately, for the same reasons presence
 * polls (see chatPresence.ts). No push transport exists, and a fix built on
 * polling is the only one that works in both shipped backends. The cursor is a
 * `created_at` bound the existing /api/db endpoint already understands
 * (`.gte()` → a parameterized `"created_at" >= $n`), so this needs no new route
 * and no server change: a tick reads only what arrived since the last one, and
 * an idle room's tick returns zero rows.
 *
 * THE CURSOR IS A COMPOSITE: (timestamp, the ids already delivered AT that
 * timestamp). It is INCLUSIVE on the wire and EXCLUSIVE in effect, and both
 * halves are load-bearing.
 *
 * A timestamp alone cannot be exclusive here, because `created_at` IS NOT A
 * UNIQUE ORDERING. Three independent reasons, all verified against this stack:
 *   1. Postgres `now()` is TRANSACTION-START time, so two concurrent inserts
 *      routinely share a `created_at` to the microsecond, and `id` is a random
 *      uuid that cannot break the tie.
 *   2. `created_at` is `timestamptz` (microseconds) but reaches the client
 *      through `JSON.stringify(Date)`, which is MILLISECOND precision — so the
 *      cursor a client echoes back is a TRUNCATED view of the true value and
 *      many rows share it.
 *   3. Commit order is not `now()` order: a transaction that started earlier
 *      can commit later, so a row AT the boundary timestamp can become visible
 *      AFTER we have already read past it.
 * Any one of those turns a bare `gt('created_at', cursor)` into silent message
 * loss — the off-by-one this transport must not have.
 *
 * The honest fix is a composite `(created_at, id) > (cursor.at, cursor.ids)`.
 * This transport CANNOT express that in SQL: the generic /api/db endpoint AND's
 * a flat `{col, op, val}` filter list (server/app.ts buildWhere — no OR, no
 * tuple comparison) and honours ONE order column, and redesigning it is out of
 * scope. So the tuple is split: the timestamp half rides the wire as the same
 * INCLUSIVE `.gte()` bound (nothing can ever be skipped), and the id half is
 * applied on the client by `unseenRows` (nothing already delivered is counted
 * twice). The read is identical; the VERDICT is exclusive.
 *
 * That verdict is what makes the idle backoff real. Under a bare inclusive
 * cursor a non-empty room returns its boundary row on EVERY tick, so every
 * panel looked permanently "active": it never backed off, and it re-hydrated
 * author profiles every 5s. With the id half applied, an idle room yields zero
 * UNSEEN rows, `lastRowAt` stops being reset, and the existing backoff engages.
 *
 * Pure and injectable like chatPresence.ts / chatUnread.ts — the hook
 * (hooks/useChatMessages.ts) is a thin wrapper over these decisions.
 */

import type { ChatScope } from '@/lib/chatPresence'

// ───────────────────────────────────────────────────────────────────────────
//  Tables
// ───────────────────────────────────────────────────────────────────────────

/** The four message tables, as the typed client knows them. */
export type ChatMessageTable =
  | 'stream_messages'
  | 'tournament_messages'
  | 'chat_messages'
  | 'dm_messages'

/** Where one scope's messages live, and what its columns are called. */
export interface ChatTable {
  /** The message table for this scope. */
  table: ChatMessageTable
  /** The column that names the room. */
  roomCol: string
  /** The body column — chat_messages says `body`, the other three say `content`. */
  textCol: string
}

/**
 * The four surfaces, their tables and their column names.
 * KEEP IN SYNC with the scope list in chatPresence.ts (and the tables the four
 * surfaces read: StreamChat, TournamentChat, ChatSpace/ChannelView,
 * DirectMessages).
 */
export const CHAT_TABLES: Record<ChatScope, ChatTable> = {
  stream: { table: 'stream_messages', roomCol: 'stream_id', textCol: 'content' },
  tournament: { table: 'tournament_messages', roomCol: 'tournament_id', textCol: 'content' },
  channel: { table: 'chat_messages', roomCol: 'channel_id', textCol: 'body' },
  dm: { table: 'dm_messages', roomCol: 'conversation_id', textCol: 'content' },
}

// ───────────────────────────────────────────────────────────────────────────
//  Cadences
// ───────────────────────────────────────────────────────────────────────────

/**
 * How often a VISIBLE, ACTIVE room asks for new messages. 5s sits just under
 * the app's existing polling band (Oracle 4s … Notifications 15s) because a
 * message landing inside a human turn-taking beat is the whole product: 10s
 * reads as broken chat. One indexed range scan per tick, zero rows when idle.
 */
export const MESSAGE_POLL_MS = 5_000

/**
 * The BACKED-OFF cadence for a room where nothing has been said in a while.
 * Most open chat panels are idle most of the time; without this, every stale
 * tab in the building spends a query every 5s on a room nobody is using.
 */
export const MESSAGE_IDLE_POLL_MS = 20_000

/** A room with no new message for this long is "idle" and drops to the slow cadence. */
export const MESSAGE_IDLE_AFTER_MS = 90_000

/**
 * How many rows one incremental tick may return. This is a CATCH-UP bound, not
 * a window: the cursor advances to the newest row we actually received, so a
 * burst bigger than this simply arrives over the next few ticks instead of
 * being lost.
 */
export const MESSAGE_POLL_LIMIT = 60

/**
 * How many rows a room's OPENING read backfills.
 *
 * Read from the NEWEST end (see `orderOldestFirst`). Reading the oldest N — the
 * shape every surface shipped with — put the cursor at ANCIENT HISTORY, so the
 * poll then walked forward MESSAGE_POLL_LIMIT rows per tick and replayed years
 * of backlog as if it were arriving live: auto-scroll firing, unread dividers
 * firing, for minutes per open tab on a big channel. The newest N costs the
 * same single indexed read and opens the room where the user actually is.
 */
export const MESSAGE_BACKFILL_LIMIT = 100

/**
 * Ceiling on the tie-breaker id list a cursor carries (see `MessageCursor`).
 * One millisecond holding more ids than this is not a real room; overflowing
 * costs a harmless RE-DELIVERY (mergeMessages dedupes it), never a loss, so the
 * bound is safe in the only direction that matters.
 */
export const MESSAGE_CURSOR_TIE_LIMIT = 500

// ───────────────────────────────────────────────────────────────────────────
//  Rows
// ───────────────────────────────────────────────────────────────────────────

/** The subset of a message row this module reads — all four schemas satisfy it. */
export interface PollMessageLike {
  id: string
  created_at?: string | null
  user_id?: string | null
}

/** Epoch ms for an ISO timestamp, or null when absent/unparseable. */
function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/**
 * An optimistic, not-yet-persisted row id (`local-…`). Mirrors
 * isPersistedMessageId in lib/chatReplies.ts — kept as its own predicate here so
 * this module stays dependency-free below chatPresence.
 */
function isLocalId(id: string): boolean {
  return typeof id === 'string' && id.startsWith('local-')
}

/**
 * The newest `created_at` in a list, never moving BACKWARD from `current`.
 *
 * Monotonic on purpose: a surface can replace its whole list (ChatSpace
 * re-reads a channel on switch), and a cursor that rewound would re-deliver a
 * window we already merged. Rows with no parseable timestamp are ignored rather
 * than treated as epoch 0.
 */
export function newestTimestamp(
  messages: readonly PollMessageLike[],
  current?: string | null,
): string | null {
  let bestIso = current ?? null
  let bestMs = timeOf(bestIso)
  for (const m of messages) {
    const t = timeOf(m.created_at)
    if (t === null) continue
    if (bestMs === null || t > bestMs) {
      bestMs = t
      bestIso = m.created_at as string
    }
  }
  return bestIso
}

// ───────────────────────────────────────────────────────────────────────────
//  The composite cursor
// ───────────────────────────────────────────────────────────────────────────

/**
 * Where a room's poll has read up to: `(at, ids)`.
 *
 * `at` is the newest `created_at` DELIVERED so far and is the only half that
 * reaches SQL — as an INCLUSIVE `.gte()` bound, so a row that shares the
 * boundary timestamp is always re-read and can never be skipped (see the module
 * header for why an exclusive timestamp loses messages here).
 *
 * `ids` are the rows already delivered AT exactly `at` — the tie-breaker that
 * makes the verdict exclusive. It resets every time `at` moves, so it only ever
 * holds one millisecond's worth of ids.
 */
export interface MessageCursor {
  /** Newest delivered `created_at`, or null before anything has been read. */
  at: string | null
  /** Ids already delivered whose `created_at` equals `at`. */
  ids: readonly string[]
}

/** A room that has read nothing yet. */
export const EMPTY_MESSAGE_CURSOR: MessageCursor = { at: null, ids: [] }

/**
 * The rows in `rows` this cursor has NOT already delivered.
 *
 * Newer than the boundary → unseen. AT the boundary → unseen only if its id is
 * not in the tie list. A row with no usable timestamp is treated as unseen
 * rather than dropped: `created_at` is NOT NULL on all four tables (see
 * server/ensureSchema.ts), so this is a shape we should never see, and
 * delivering it twice is recoverable where losing it is not.
 *
 * This is the client half of `(created_at, id) > (cursor.at, cursor.ids)`, and
 * the reason an idle room reports zero activity instead of echoing its last
 * message forever.
 */
export function unseenRows<T extends PollMessageLike>(
  cursor: MessageCursor,
  rows: readonly T[],
): T[] {
  const boundary = timeOf(cursor.at)
  if (boundary === null) return rows.filter((row) => Boolean(row && row.id))
  const tie = new Set(cursor.ids)
  return rows.filter((row) => {
    if (!row || !row.id) return false
    const t = timeOf(row.created_at)
    if (t === null) return true
    if (t > boundary) return true
    if (t < boundary) return false
    return !tie.has(row.id)
  })
}

/**
 * Move the cursor over rows that have been DELIVERED.
 *
 * MONOTONIC in the same sense `newestTimestamp` is — `at` never moves backward,
 * so a surface replacing its whole list cannot rewind the poll. When rows land
 * ON the current boundary their ids JOIN the tie list (a later-committing row
 * at the same instant must not evict the ids we already have); when they move
 * it forward the tie list is rebuilt from scratch at the new instant.
 *
 * Call this only once delivery is confirmed. A cursor advanced before the rows
 * reach the surface is a cursor that can never re-fetch them.
 */
export function advanceCursor(
  cursor: MessageCursor,
  rows: readonly PollMessageLike[],
): MessageCursor {
  const newestIso = newestTimestamp(rows, cursor.at)
  const newestMs = timeOf(newestIso)
  if (newestIso === null || newestMs === null) return cursor

  const atBoundary: string[] = []
  for (const row of rows) {
    if (!row || !row.id) continue
    if (timeOf(row.created_at) === newestMs) atBoundary.push(row.id)
  }

  const carried = timeOf(cursor.at) === newestMs ? cursor.ids : []
  if (carried === cursor.ids && atBoundary.length === 0) return cursor

  const ids: string[] = []
  const seen = new Set<string>()
  // Newest-first so the cap, if it ever bites, keeps the most recent ids.
  for (const id of [...atBoundary, ...carried]) {
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= MESSAGE_CURSOR_TIE_LIMIT) break
  }
  return { at: newestIso, ids }
}

/**
 * A backfill read OLDEST-FIRST, whatever order it arrived in.
 *
 * Rooms open by reading the NEWEST rows (`.order('created_at', { ascending:
 * false })`), because the oldest N put the poll cursor in ancient history and
 * replayed the backlog as live traffic. The log still renders oldest → newest,
 * so the window is flipped here. A SORT rather than a `.reverse()` on purpose:
 * a backend that ignored the requested order still produces a correct log
 * instead of an inverted one.
 */
export function orderOldestFirst<T extends PollMessageLike>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index, t: timeOf(row?.created_at) }))
    .sort((a, b) => {
      if (a.t === null || b.t === null) return a.index - b.index
      if (a.t !== b.t) return a.t - b.t
      return a.index - b.index
    })
    .map((entry) => entry.row)
}

/**
 * Fold newly polled rows into the list a surface is already rendering.
 *
 * THREE RULES, and every one of them is about not showing the sender their own
 * message twice:
 *   1. An id we already hold WINS. The local copy carries enrichment the poll
 *      does not have (username, avatar, the mention list computed at send time,
 *      badge metadata) — replacing it with the raw echo would visibly downgrade
 *      the row. This is the same `prev.some(m => m.id === row.id)` guard all
 *      four surfaces already apply to their optimistic append, hoisted here.
 *   2. A persisted row SUPERSEDES an optimistic `local-…` row with the same
 *      author and the same text. That fallback id is minted only when an insert
 *      returned no row (an older backend), and without this rule the poll would
 *      bring the real row back alongside it — the sender's line, twice.
 *   3. The result is ordered by `created_at`, ties broken by the incoming
 *      order, so a late arrival lands in the log where it belongs.
 */
export function mergeMessages<T extends PollMessageLike>(
  current: readonly T[],
  incoming: readonly T[],
  textOf?: (row: T) => string,
): T[] {
  if (incoming.length === 0) return current as T[]

  const known = new Set(current.map((m) => m.id))
  const fresh = incoming.filter((m) => m && m.id && !known.has(m.id))
  if (fresh.length === 0) return current as T[]

  // Rule 2 — drop the optimistic stand-in a persisted row now replaces.
  // The author/text key is joined on an ESCAPED NUL, never a literal one: a
  // raw control byte in a source file makes git treat it as binary and hides the
  // line from every grep. Same delimiter, same behaviour, still plain text.
  let kept = current as readonly T[]
  if (textOf) {
    const supersededBy = new Set(
      fresh.map((m) => `${m.user_id ?? ''}\u0000${textOf(m)}`),
    )
    const trimmed = kept.filter(
      (m) => !isLocalId(m.id) || !supersededBy.has(`${m.user_id ?? ''}\u0000${textOf(m)}`),
    )
    if (trimmed.length !== kept.length) kept = trimmed
  }

  const merged = [...kept, ...fresh]
  // Stable sort by timestamp. Rows without one keep their relative position by
  // sorting as "same time" — never hoisted to the top of the log.
  return merged
    .map((row, index) => ({ row, index, t: timeOf(row.created_at) }))
    .sort((a, b) => {
      if (a.t === null || b.t === null) return a.index - b.index
      if (a.t !== b.t) return a.t - b.t
      return a.index - b.index
    })
    .map((entry) => entry.row)
}

// ───────────────────────────────────────────────────────────────────────────
//  Poll gating
// ───────────────────────────────────────────────────────────────────────────

/** Everything the gate needs to decide whether to spend a request. */
export interface PollGate {
  /** `document.visibilityState === 'visible'` — the tab is in front. */
  visible: boolean
  /** When the last tick actually fetched. Null before the first one. */
  lastPollAt: number | null
  /**
   * When this room last produced a NEW message. The hook SEEDS this to the
   * moment the room opened, so a freshly opened room polls at the fast cadence
   * for its first quiet window instead of starting backed off. Null (nothing
   * seeded, nothing seen) reads as idle.
   */
  lastRowAt: number | null
  /** Now, in epoch ms. */
  now: number
}

/**
 * Should this tick spend a request?
 *
 * A HIDDEN TAB NEVER POLLS — the same rule useChatPresence enforces, and the
 * reason the visibilitychange listener exists: coming back to the tab fires one
 * immediate catch-up rather than waiting out the interval. On top of that, a
 * room that has been quiet for MESSAGE_IDLE_AFTER_MS drops to the slow cadence,
 * so the interval can stay at the fast one and back off in here instead of the
 * hook juggling two timers.
 *
 * Pure so the cadence is unit-testable without a DOM.
 */
export function shouldPollMessages(gate: PollGate): boolean {
  if (!gate.visible) return false
  if (gate.lastPollAt === null) return true

  const sinceLastPoll = gate.now - gate.lastPollAt
  // Clock moved backward (skew, sleep/wake) — treat it as "due" rather than
  // wedging the room until the clock catches up.
  if (sinceLastPoll < 0) return true

  const quietFor =
    gate.lastRowAt === null ? Number.POSITIVE_INFINITY : gate.now - gate.lastRowAt
  const wanted = quietFor >= MESSAGE_IDLE_AFTER_MS ? MESSAGE_IDLE_POLL_MS : MESSAGE_POLL_MS
  // A hair of slack so an interval that fires a millisecond early still counts.
  return sinceLastPoll >= wanted - 250
}

// ───────────────────────────────────────────────────────────────────────────
//  Failure, retry, recovery
// ───────────────────────────────────────────────────────────────────────────

/**
 * WHY THIS SECTION EXISTS. The first version of the transport INFERRED "the read
 * failed" from a THROWN fetch, and treated every `{ error }` it was handed as
 * permanent. Both halves were wrong on the shipped backends:
 *
 *   • `realSupabase`'s `apiFetch` catches its own network error and RESOLVES
 *     with `{ error: { message: 'Network error' }, status: 0 }`. It never
 *     throws. So the "skipped tick, try again next time" catch was unreachable
 *     and the permanent branch ran instead: ONE Wi-Fi hiccup killed the room for
 *     the life of the mount. A wrapper that cannot signal failure by throwing
 *     must signal it in its VALUE — hence `PollReadResult` below, which every
 *     caller is forced to destructure.
 *   • The Express `/api/db` route answers 400 for BOTH "column does not exist"
 *     and "timeout exceeded when trying to connect" (pool exhaustion under a
 *     crowd). Status alone cannot tell a schema gap from a bad five seconds, so
 *     the message is classified too.
 *
 * Failure is therefore an EXPLICIT, CLASSIFIED value here, never an inferred
 * one, and the default class is the RECOVERABLE one.
 */

/** Why a read failed, and therefore what the room should do about it. */
export type PollFailureKind =
  /** A bad moment: offline, 5xx, rate limit, pool timeout. RETRY WITH BACKOFF. */
  | 'transient'
  /** This backend lacks these columns/table. Fall back once, then stop asking. */
  | 'schema'
  /** The viewer may not read this room (signed out, not a participant). Stop. */
  | 'refused'

/** A classified read failure. `status` is null when the client never got one. */
export interface PollFailure {
  kind: PollFailureKind
  message: string
  status: number | null
}

/**
 * The EXPLICIT outcome of one attempted read.
 *
 * Success and failure are two shapes of one union precisely because the shim
 * cannot be relied on to throw. `ok` is the whole contract: there is no way to
 * read `rows` without having first admitted the read succeeded.
 */
export type PollReadResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; failure: PollFailure }

/** A missing column / table / relation, in any of the three backends' wording. */
const SCHEMA_RE =
  /does not exist|no such (table|column)|unknown (table|column)|undefined (table|column)|could not find|missing column|42703|42P01/i

/** The viewer is not allowed to read this room. Retrying will not change that. */
const REFUSED_RE =
  /forbidden|unauthorized|not authori[sz]ed|permission denied|row-level security|violates rls|invalid token|jwt expired/i

/**
 * Classify a read failure.
 *
 * UNKNOWN IS TRANSIENT, deliberately. A room that cannot explain its failure
 * recovers by itself once the cause clears, at the cost of one backed-off
 * request a minute. The opposite default is a permanently frozen room, which is
 * the single worst outcome this transport can produce.
 */
export function classifyPollFailure(
  message: string | null | undefined,
  status?: number | null,
): PollFailureKind {
  const text = typeof message === 'string' ? message : ''
  // Status first where it is unambiguous. 0 is the shim's "the fetch itself
  // failed" — always the network, never the schema.
  if (status === 401 || status === 403) return 'refused'
  if (status === 0 || status === 408 || status === 425 || status === 429) return 'transient'
  if (typeof status === 'number' && status >= 500) return 'transient'
  if (SCHEMA_RE.test(text)) return 'schema'
  if (REFUSED_RE.test(text)) return 'refused'
  return 'transient'
}

/** Delay before the FIRST retry, before jitter is applied. */
export const MESSAGE_RETRY_BASE_MS = 2_000

/**
 * Ceiling on the retry delay. A room whose backend is genuinely down still
 * probes once a minute, so it comes back BY ITSELF the moment the backend does
 * — no remount, no reload, no "tap to reconnect" the viewer will never find.
 */
export const MESSAGE_RETRY_MAX_MS = 60_000

/**
 * Consecutive failures before the surface says "Reconnecting…". One failed tick
 * that heals on the next one is a blip nobody needs to be told about; two in a
 * row is worth a quiet line. The operator's rule: a rate limit or a blip must
 * never look like a broken chat.
 */
export const MESSAGE_RECONNECT_AFTER_ATTEMPTS = 2

/**
 * Backoff delay for the Nth consecutive failure (1-based), WITH JITTER.
 *
 * The jitter is not a nicety. 500 viewers watching one stream poll the same
 * room; a blip fails all 500 ticks inside the same second, and without jitter
 * all 500 retry inside the same second too — again and again, in lockstep,
 * against a five-connection pool. Equal jitter (`half + random × half`) spreads
 * the herd across the whole window while still guaranteeing the delay never
 * exceeds the cap.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const steps = Math.max(0, Math.floor(attempt) - 1)
  // Cap the exponent as well as the product: 2 ** 1000 is Infinity, and
  // Infinity * 0.5 would escape the Math.min below on some paths.
  const capped = Math.min(MESSAGE_RETRY_BASE_MS * 2 ** Math.min(steps, 20), MESSAGE_RETRY_MAX_MS)
  const half = capped / 2
  // Clamp the injected random into [0,1) so a bad source cannot escape the cap.
  // NaN is clamped to 0 explicitly: Math.min/Math.max PROPAGATE NaN rather than
  // clamping it, and a NaN delay would compare false against every retry
  // deadline — which is a room that never retries at all.
  const raw = random()
  const r = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0
  return Math.round(half + r * half)
}

/**
 * What a chat surface should TELL THE VIEWER about delivery.
 *
 *   live         — messages are arriving. Show nothing at all.
 *   reconnecting — a tick failed and we are retrying. Show a quiet line.
 *   offline      — the browser says there is no network. Say so, calmly.
 *   unsupported  — this backend cannot serve the incremental read; the room
 *                  degrades to backfill-only, exactly as it behaved before.
 */
export type ChatPollStatus = 'live' | 'reconnecting' | 'offline' | 'unsupported'
