/**
 * chatPollLoop — the RUNNER behind the shared chat message poll.
 *
 * WHY IT IS ITS OWN MODULE. The loop used to live inline in
 * hooks/useChatMessages.ts, where nothing could import it: the tests
 * re-implemented the loop inside the test file, so every one of them passed
 * against a copy while the shipped copy froze rooms. This module IS the shipped
 * loop. `useChatMessages` supplies `supabase`, `document.visibilityState`,
 * `navigator.onLine`, `Date.now` and `Math.random`, and does nothing else with
 * the decisions — exactly the split chatPresence.ts / chatUnread.ts already use.
 *
 * THE THREE RULES IT ENFORCES
 *
 * 1. A FAILED TICK IS TRANSIENT, NEVER TERMINAL. The read reports success or
 *    failure as a VALUE (`PollReadResult`) because the shim never throws, and a
 *    failure that is not provably permanent is retried with bounded exponential
 *    backoff plus jitter. Only two verdicts stop the loop: the backend does not
 *    have the columns (after one fallback), or the viewer is not allowed to read
 *    the room. Everything else — offline, 5xx, 429, a pool timeout, an
 *    unrecognised error — keeps probing and the room heals by itself.
 *
 * 2. THE CURSOR MOVES ONLY AFTER DELIVERY IS CONFIRMED. `deliver()` is awaited
 *    FIRST; the cursor advances only once it resolves. If the surface throws
 *    mid-delivery (DirectMessages' author read is one real case), the rows are
 *    not consumed: the same window is re-read on the next tick and the failure
 *    is treated exactly like a failed read. A monotonic cursor advanced ahead of
 *    delivery is silent, permanent message loss — the worst failure a chat
 *    product has.
 *
 * 3. FAILURE IS VISIBLE AND QUIET. `status` goes 'reconnecting' (or 'offline'
 *    when the browser says so) after MESSAGE_RECONNECT_AFTER_ATTEMPTS
 *    consecutive failures, so a single blip that heals on the next tick shows
 *    nothing, and a real outage never masquerades as a working room.
 *
 * ONE TIMER, still. The caller ticks at the fast cadence; everything else —
 * the visibility gate, the idle backoff, the retry window — is a refusal
 * INSIDE `tick()`. There is no second timer to leak.
 */

import {
  EMPTY_MESSAGE_CURSOR,
  MESSAGE_RECONNECT_AFTER_ATTEMPTS,
  advanceCursor,
  retryDelayMs,
  shouldPollMessages,
  unseenRows,
  type ChatPollStatus,
  type MessageCursor,
  type PollFailure,
  type PollMessageLike,
  type PollReadResult,
} from '@/lib/chatMessages'

/** Everything the loop needs from the outside world, all injectable. */
export interface ChatPollDeps<T extends PollMessageLike> {
  /**
   * Perform ONE read from `cursor.at` (inclusive) forward. MUST NOT throw —
   * it reports failure by returning `{ ok: false, failure }`. `legacy` is true
   * once the enriched column list has been refused by this backend.
   */
  read: (cursor: MessageCursor, legacy: boolean) => Promise<PollReadResult<T>>
  /**
   * Hand unseen rows to the surface. MAY throw or reject: that is read as
   * "these rows were NOT committed", and the cursor stays where it was.
   */
  deliver: (rows: T[]) => void | Promise<void>
  /** Epoch ms. Injected so the cadence is testable without a fake clock global. */
  now: () => number
  /** `document.visibilityState === 'visible'`. */
  visible: () => boolean
  /** `navigator.onLine`. A room that knows it is offline does not spend requests. */
  online: () => boolean
  /** Does the surface have a legacy column list to fall back to? */
  hasLegacyColumns: boolean
  /** Called only when the reported status actually CHANGES — never per tick. */
  onStatus?: (status: ChatPollStatus) => void
  /** Injectable jitter source. Defaults to Math.random. */
  random?: () => number
}

/**
 * The live loop. The hook owns the timer; this owns every decision.
 *
 * Deliberately NOT generic: the row type only matters between `read` and
 * `deliver`, both of which are supplied at construction. Everything the caller
 * drives afterwards is about timing and health, not rows.
 */
export interface ChatPollLoop {
  /**
   * Try one tick. Refuses (cheaply, without a request) when the tab is hidden,
   * the browser is offline, the room is inside a retry window, or the cadence
   * gate says it is not due yet. `force` skips the cadence gate only — it never
   * skips the "we are offline" or "the loop has stopped" guards.
   */
  tick: (force?: boolean) => Promise<void>
  /**
   * Fold the surface's COMMITTED list into the cursor. Safe by construction:
   * these rows are on screen, so consuming them can lose nothing.
   */
  observe: (messages: readonly PollMessageLike[]) => void
  /**
   * The network came back, or the tab did. Drops the retry window so the next
   * tick fires at once. Keeps the failure count, so the "Reconnecting…" line
   * survives until a read actually succeeds, and so the backoff keeps growing
   * if the network is still bad.
   */
  resume: () => void
  /** The browser fired `offline`. Report it without waiting for a failed read. */
  goOffline: () => void
  /** Current status, for a caller that needs it outside the change callback. */
  status: () => ChatPollStatus
  /** Consecutive failures since the last success. Exposed for tests + telemetry. */
  attempts: () => number
  /** Where the poll has read up to. */
  cursor: () => MessageCursor
  /** Stop for good (unmount). Any in-flight delivery is discarded. */
  stop: () => void
}

export function createChatPollLoop<T extends PollMessageLike>(
  deps: ChatPollDeps<T>,
): ChatPollLoop {
  const random = deps.random ?? Math.random

  let cursor: MessageCursor = EMPTY_MESSAGE_CURSOR
  let lastPollAt: number | null = null
  // Seeded to "now" so a freshly opened room polls at the FAST cadence for its
  // first quiet window instead of opening already backed off.
  let lastRowAt: number | null = deps.now()
  let inFlight = false
  let legacy = false
  let stopped = false
  /** Consecutive failed ticks. Zeroed by any successful read. */
  let attempts = 0
  /** Epoch ms before which a tick must not spend a request. */
  let retryAt: number | null = null
  let status: ChatPollStatus = 'live'

  const setStatus = (next: ChatPollStatus) => {
    if (next === status) return
    status = next
    deps.onStatus?.(next)
  }

  /** What the viewer should be told right now, given the failure count. */
  const reportHealth = () => {
    if (stopped) return
    if (attempts === 0) {
      setStatus('live')
      return
    }
    if (!deps.online()) {
      setStatus('offline')
      return
    }
    // Below the threshold we say NOTHING. A blip that heals on the next tick is
    // not news, and flashing "Reconnecting…" every time a packet drops is
    // exactly the "looks broken" failure this is meant to prevent.
    if (attempts >= MESSAGE_RECONNECT_AFTER_ATTEMPTS) setStatus('reconnecting')
  }

  /** Record one failure and decide whether the room can keep trying. */
  const fail = (failure: PollFailure) => {
    if (failure.kind === 'schema' && !legacy && deps.hasLegacyColumns) {
      // The same enriched → legacy fallback every surface's initial load uses.
      // Not a failure the viewer needs to know about, and not a backoff: the
      // next tick asks for the smaller list at the normal cadence.
      legacy = true
      retryAt = null
      return
    }
    if (failure.kind === 'schema' || failure.kind === 'refused') {
      // Genuinely permanent for this mount. Stop rather than fail on a timer
      // forever: the room degrades to backfill-only, which is precisely how it
      // behaved before this transport existed.
      stopped = true
      setStatus('unsupported')
      return
    }
    attempts += 1
    retryAt = deps.now() + retryDelayMs(attempts, random)
    reportHealth()
  }

  const tick = async (force = false): Promise<void> => {
    if (stopped || inFlight) return
    const now = deps.now()

    if (!deps.online()) {
      // Spending a request we know will fail only burns the retry budget.
      // Treat it as a failed tick so the room reports honestly and the backoff
      // is already warm when the network comes back.
      if (attempts === 0) attempts = 1
      setStatus('offline')
      return
    }
    // A retry window outranks the cadence gate AND `force`: a forced refresh
    // (the user just sent a message) must not become a way to bypass backoff
    // during an outage — that is how 500 viewers turn a blip into a stampede.
    if (retryAt !== null && now < retryAt) return
    if (
      !force &&
      !shouldPollMessages({
        visible: deps.visible(),
        lastPollAt,
        lastRowAt,
        now,
      })
    ) {
      return
    }

    inFlight = true
    lastPollAt = now
    try {
      const result = await deps.read(cursor, legacy)
      if (stopped) return

      if (!result.ok) {
        fail(result.failure)
        return
      }

      const fresh = unseenRows(cursor, result.rows)
      if (fresh.length > 0) {
        // DELIVER FIRST. The cursor is monotonic, so anything it steps over can
        // never be re-read: it may only move once these rows are committed.
        await deps.deliver(fresh)
        if (stopped) return
        // Advanced from ALL the rows we received, not just the unseen ones: the
        // ones we filtered out are rows we already hold, and their ids belong in
        // the tie list so the inclusive boundary does not re-offer them next
        // tick. A burst larger than the read limit still arrives over the
        // following ticks rather than being skipped.
        cursor = advanceCursor(cursor, result.rows)
        lastRowAt = deps.now()
      }

      // THE WHOLE TICK SUCCEEDED — read AND delivery. Only now is the backoff
      // cleared. Clearing it on the read alone would let a surface that throws
      // on every delivery report a permanently healthy room while rendering
      // nothing, which is the same silent freeze in a different costume.
      attempts = 0
      retryAt = null
      reportHealth()
    } catch (thrown) {
      // Delivery threw — the surface did NOT commit these rows (DirectMessages'
      // author read is the real case). The cursor has not moved, so the next
      // tick re-reads exactly this window. Same treatment as a failed read:
      // back off, report, recover.
      if (!stopped) {
        fail({
          kind: 'transient',
          message: thrown instanceof Error ? thrown.message : 'Could not deliver messages.',
          status: null,
        })
      }
    } finally {
      inFlight = false
    }
  }

  return {
    tick,
    observe(messages) {
      // These rows are already rendered, so consuming them cannot lose anything.
      cursor = advanceCursor(cursor, messages)
    },
    resume() {
      if (stopped) return
      retryAt = null
      // `attempts` is deliberately KEPT: the note stays up until a read actually
      // succeeds, and a network that is still bad keeps growing its backoff
      // instead of restarting at 2s every time the tab is focused.
      reportHealth()
    },
    goOffline() {
      if (stopped) return
      if (attempts === 0) attempts = 1
      setStatus('offline')
    },
    status: () => status,
    attempts: () => attempts,
    cursor: () => cursor,
    stop() {
      stopped = true
    },
  }
}
