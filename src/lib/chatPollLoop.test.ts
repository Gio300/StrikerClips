import { describe, expect, it, vi } from 'vitest'
import { createChatPollLoop, type ChatPollDeps } from './chatPollLoop'
import {
  MESSAGE_IDLE_AFTER_MS,
  MESSAGE_POLL_MS,
  MESSAGE_RETRY_BASE_MS,
  MESSAGE_RETRY_MAX_MS,
  classifyPollFailure,
  retryDelayMs,
  type ChatPollStatus,
  type PollReadResult,
} from './chatMessages'

/**
 * SURVIVING A BAD NETWORK.
 *
 * These drive the SHIPPED loop (lib/chatPollLoop.ts — the same module
 * hooks/useChatMessages.ts constructs), not a copy of it. The previous round's
 * tests re-implemented the polling loop inside the test file, which is exactly
 * why six defects shipped green: every assertion held against the copy while
 * the real one froze the room on its first failed request.
 *
 * The three things a chat transport must never do, asserted directly:
 *   • FREEZE on a blip — one failed tick must be transient, and the room must
 *     recover by itself on a following tick;
 *   • LOSE a message — the cursor must not step over rows the surface did not
 *     commit;
 *   • LIE — a room that is behind must say so, quietly, and only when it is.
 */

type Row = { id: string; created_at: string; user_id?: string; content?: string }

const row = (id: string, created_at: string, extra: Partial<Row> = {}): Row => ({
  id,
  created_at,
  ...extra,
})

const ok = (rows: Row[]): PollReadResult<Row> => ({ ok: true, rows })
const netFail = (): PollReadResult<Row> => ({
  ok: false,
  // EXACTLY what src/lib/realSupabase.ts apiFetch resolves with when the fetch
  // itself fails. It does not throw — that is the whole defect.
  failure: { kind: classifyPollFailure('Network error', 0), message: 'Network error', status: 0 },
})

/**
 * A controllable harness around the real loop: a manual clock, a scriptable
 * server, and a `run(ms)` that advances time in MESSAGE_POLL_MS steps the way
 * the hook's interval does.
 */
function harness(options: {
  /** Called for every read; return rows or a failure. */
  server: (call: number) => PollReadResult<Row>
  /** Throw from here to simulate a surface whose enrichment failed. */
  deliver?: (rows: Row[]) => void
  visible?: () => boolean
  online?: () => boolean
  hasLegacyColumns?: boolean
}) {
  let now = 1_000_000
  let calls = 0
  const delivered: Row[] = []
  const statuses: ChatPollStatus[] = []

  const deps: ChatPollDeps<Row> = {
    hasLegacyColumns: options.hasLegacyColumns ?? false,
    now: () => now,
    visible: options.visible ?? (() => true),
    online: options.online ?? (() => true),
    // Mid-window jitter: deterministic, and still exercises the jitter maths.
    random: () => 0.5,
    onStatus: (status) => statuses.push(status),
    read: async () => {
      calls += 1
      return options.server(calls)
    },
    deliver: (rows) => {
      options.deliver?.(rows)
      delivered.push(...rows)
    },
  }

  const loop = createChatPollLoop(deps)

  /** Advance the clock in interval-sized steps, ticking like the hook does. */
  async function run(ms: number) {
    const steps = Math.round(ms / MESSAGE_POLL_MS)
    for (let i = 0; i < steps; i += 1) {
      now += MESSAGE_POLL_MS
      await loop.tick(false)
    }
  }

  return {
    loop,
    run,
    at: (ms: number) => {
      now += ms
    },
    reads: () => calls,
    delivered,
    statuses,
    status: () => loop.status(),
  }
}

describe('classifyPollFailure — a blip is not a broken backend', () => {
  it('reads the shim’s resolved network failure as TRANSIENT', () => {
    // status 0 + "Network error" is verbatim what realSupabase.apiFetch returns
    // for a dropped request. Calling this permanent is defect 1.
    expect(classifyPollFailure('Network error', 0)).toBe('transient')
  })

  it('treats rate limits, timeouts and 5xx as transient', () => {
    expect(classifyPollFailure('Too many requests', 429)).toBe('transient')
    expect(classifyPollFailure('gateway timeout', 504)).toBe('transient')
    expect(classifyPollFailure('internal error', 500)).toBe('transient')
    expect(classifyPollFailure('request timeout', 408)).toBe('transient')
  })

  it('treats a POOL TIMEOUT as transient even though the server answers 400', () => {
    // server/app.ts answers 400 for every /api/db failure, including this one.
    // Under a crowd it is the most likely failure there is, and it MUST recover.
    expect(
      classifyPollFailure('timeout exceeded when trying to connect', 400),
    ).toBe('transient')
  })

  it('still recognises a genuine schema gap', () => {
    expect(classifyPollFailure('column "mentions" does not exist', 400)).toBe('schema')
    expect(classifyPollFailure('relation "dm_messages" does not exist', 400)).toBe('schema')
    expect(classifyPollFailure('42703', 400)).toBe('schema')
  })

  it('still recognises a refusal', () => {
    expect(classifyPollFailure('forbidden: not a participant', 403)).toBe('refused')
    expect(classifyPollFailure('unauthorized', 401)).toBe('refused')
    expect(classifyPollFailure('permission denied for table dm_messages', 400)).toBe('refused')
  })

  it('defaults an UNRECOGNISED failure to transient', () => {
    // Fail toward recovery. The opposite default is a permanently frozen room.
    expect(classifyPollFailure('something nobody predicted', null)).toBe('transient')
    expect(classifyPollFailure(null, null)).toBe('transient')
  })
})

describe('retryDelayMs — bounded, exponential, JITTERED', () => {
  it('grows exponentially and is capped', () => {
    const mid = (attempt: number) => retryDelayMs(attempt, () => 0.5)
    expect(mid(1)).toBe(MESSAGE_RETRY_BASE_MS * 0.75)
    expect(mid(2)).toBe(MESSAGE_RETRY_BASE_MS * 1.5)
    expect(mid(3)).toBe(MESSAGE_RETRY_BASE_MS * 3)
    // However long the outage lasts, the room keeps probing at the ceiling.
    expect(mid(50)).toBeLessThanOrEqual(MESSAGE_RETRY_MAX_MS)
    expect(mid(50)).toBeGreaterThan(0)
  })

  it('never exceeds the cap, whatever the jitter source returns', () => {
    for (const r of [0, 0.5, 0.999999, 1, 5, -3, Number.NaN]) {
      for (const attempt of [1, 5, 12, 40]) {
        const delay = retryDelayMs(attempt, () => r)
        expect(delay).toBeGreaterThanOrEqual(0)
        expect(delay).toBeLessThanOrEqual(MESSAGE_RETRY_MAX_MS)
      }
    }
  })

  it('SPREADS a herd that all failed on the same blip', () => {
    // 500 stream viewers whose polls failed in the same second must not all
    // retry in the same second against a five-connection pool.
    const delays = Array.from({ length: 500 }, (_, i) => retryDelayMs(4, () => i / 500))
    expect(new Set(delays).size).toBeGreaterThan(100)
    const spread = Math.max(...delays) - Math.min(...delays)
    expect(spread).toBeGreaterThan(MESSAGE_RETRY_BASE_MS)
  })
})

describe('DEFECT 1 — one failed request must not freeze the room', () => {
  it('recovers on a following tick after a mid-session failure', async () => {
    const late = row('t2', '2026-08-04T10:00:30.000Z', { user_id: 'them', content: 'gg wp' })
    // Tick 1 succeeds, tick 2 is the Wi-Fi hiccup, everything after is fine.
    const h = harness({
      server: (call) => {
        if (call === 1) return ok([row('t1', '2026-08-04T10:00:00.000Z', { content: 'hi' })])
        if (call === 2) return netFail()
        return ok([late])
      },
    })

    await h.run(MESSAGE_POLL_MS) // the good tick
    expect(h.delivered.map((m) => m.id)).toEqual(['t1'])

    await h.run(MESSAGE_POLL_MS) // the blip
    expect(h.reads()).toBe(2)
    expect(h.delivered.map((m) => m.id)).toEqual(['t1'])

    // …and the room comes back BY ITSELF, with no remount and no user action.
    await h.run(MESSAGE_RETRY_BASE_MS * 2)
    expect(h.delivered.map((m) => m.id)).toEqual(['t1', 't2'])
    expect(h.status()).toBe('live')
  })

  it('KEEPS TRYING through a long outage instead of dying on the first failure', async () => {
    // The old shape marked the room dead here and never issued another request.
    const h = harness({ server: () => netFail() })
    await h.run(MESSAGE_RETRY_MAX_MS * 3)
    expect(h.reads()).toBeGreaterThan(3)
    expect(h.loop.attempts()).toBeGreaterThan(1)
    expect(h.status()).toBe('reconnecting')
  })

  it('BACKS OFF while it retries — it does not hammer the pool at 5s', async () => {
    const h = harness({ server: () => netFail() })
    await h.run(MESSAGE_POLL_MS * 20) // 100 seconds of outage
    // At 5s flat that would be 20 requests. Backoff makes it a handful.
    expect(h.reads()).toBeLessThan(10)
    expect(h.reads()).toBeGreaterThan(2)
  })

  it('delivers everything the outage held back once the network returns', async () => {
    const backlog = [
      row('a', '2026-08-04T10:00:01.000Z'),
      row('b', '2026-08-04T10:00:02.000Z'),
      row('c', '2026-08-04T10:00:03.000Z'),
    ]
    let up = false
    const h = harness({ server: () => (up ? ok(backlog) : netFail()) })

    await h.run(MESSAGE_POLL_MS * 6)
    expect(h.delivered).toHaveLength(0)
    expect(h.status()).toBe('reconnecting')

    up = true
    await h.run(MESSAGE_RETRY_MAX_MS)
    expect(h.delivered.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(h.status()).toBe('live')
  })

  it('an ONLINE event drops the backoff and catches up immediately', async () => {
    let up = false
    const h = harness({
      server: () => (up ? ok([row('a', '2026-08-04T10:00:01.000Z')]) : netFail()),
    })
    // Fail enough times that the next retry window is a long way off.
    await h.run(MESSAGE_POLL_MS * 10)
    expect(h.delivered).toHaveLength(0)
    const before = h.reads()

    // The browser says the network is back — the room must not sit out a
    // backoff measured against a problem that has just been fixed.
    up = true
    h.loop.resume()
    await h.loop.tick(true)
    expect(h.reads()).toBe(before + 1)
    expect(h.delivered.map((m) => m.id)).toEqual(['a'])
    expect(h.status()).toBe('live')
  })

  it('reports offline WITHOUT spending a request, and resumes when it returns', async () => {
    let connected = false
    const h = harness({
      online: () => connected,
      server: () => ok([row('a', '2026-08-04T10:00:01.000Z')]),
    })

    await h.run(MESSAGE_POLL_MS * 4)
    expect(h.reads()).toBe(0) // a request we know will fail is not sent
    expect(h.status()).toBe('offline')

    connected = true
    h.loop.resume()
    await h.loop.tick(true)
    expect(h.delivered.map((m) => m.id)).toEqual(['a'])
    expect(h.status()).toBe('live')
  })

  it('stops for good ONLY on a refusal or a schema gap', async () => {
    const refused = harness({
      server: () => ({
        ok: false,
        failure: { kind: 'refused', message: 'forbidden', status: 403 },
      }),
    })
    await refused.run(MESSAGE_POLL_MS * 10)
    expect(refused.reads()).toBe(1)
    expect(refused.status()).toBe('unsupported')

    const schema = harness({
      server: () => ({
        ok: false,
        failure: { kind: 'schema', message: 'column "mentions" does not exist', status: 400 },
      }),
    })
    await schema.run(MESSAGE_POLL_MS * 10)
    expect(schema.reads()).toBe(1)
    expect(schema.status()).toBe('unsupported')
  })

  it('falls back to the legacy column list once before giving up', async () => {
    const seen: boolean[] = []
    let now = 1_000_000
    const loop = createChatPollLoop<Row>({
      hasLegacyColumns: true,
      now: () => now,
      visible: () => true,
      online: () => true,
      random: () => 0.5,
      read: async (_cursor, legacy) => {
        seen.push(legacy)
        return legacy
          ? ok([row('a', '2026-08-04T10:00:01.000Z')])
          : {
              ok: false,
              failure: { kind: 'schema', message: 'column "mentions" does not exist', status: 400 },
            }
      },
      deliver: () => {},
    })

    await loop.tick(true)
    expect(seen).toEqual([false])
    now += MESSAGE_POLL_MS
    await loop.tick(false)
    expect(seen).toEqual([false, true])
    expect(loop.status()).toBe('live')
  })
})

describe('DEFECT 3 — the cursor must never outrun delivery', () => {
  it('does NOT consume messages when the surface throws mid-delivery', async () => {
    const rows = [row('a', '2026-08-04T10:00:01.000Z'), row('b', '2026-08-04T10:00:02.000Z')]
    let failing = true
    const seen: string[] = []
    const h = harness({
      server: () => ok(rows),
      deliver: (batch) => {
        // The real case: DirectMessages' author read fails, so the rows never
        // reach the list. Under the old shape the cursor had ALREADY moved and
        // these two messages were gone for good.
        if (failing) throw new Error('Could not load conversation members.')
        seen.push(...batch.map((m) => m.id))
      },
    })

    await h.run(MESSAGE_POLL_MS)
    expect(seen).toEqual([])
    expect(h.loop.cursor().at).toBeNull() // nothing consumed

    failing = false
    await h.run(MESSAGE_RETRY_BASE_MS * 2)
    // The SAME window is re-read and the messages arrive. Nothing was lost.
    expect(seen).toEqual(['a', 'b'])
    expect(h.loop.cursor().at).toBe('2026-08-04T10:00:02.000Z')
  })

  it('treats a failed delivery as a failed tick — visibly, and with backoff', async () => {
    const h = harness({
      server: () => ok([row('a', '2026-08-04T10:00:01.000Z')]),
      deliver: () => {
        throw new Error('profiles unreadable')
      },
    })
    await h.run(MESSAGE_POLL_MS * 8)
    expect(h.status()).toBe('reconnecting')
    expect(h.loop.cursor().at).toBeNull()
  })

  it('advances only AFTER delivery resolves, even when delivery is async', async () => {
    const order: string[] = []
    let now = 1_000_000
    const loop = createChatPollLoop<Row>({
      hasLegacyColumns: false,
      now: () => now,
      visible: () => true,
      online: () => true,
      read: async () => ok([row('a', '2026-08-04T10:00:01.000Z')]),
      deliver: async () => {
        // The cursor must still be empty while delivery is in flight.
        order.push(`during:${String(loop.cursor().at)}`)
        await Promise.resolve()
      },
    })
    await loop.tick(true)
    order.push(`after:${String(loop.cursor().at)}`)
    expect(order).toEqual(['during:null', 'after:2026-08-04T10:00:01.000Z'])
  })

  it('never re-delivers a row it has already committed', async () => {
    // The wire bound is inclusive, so the boundary row comes back every tick.
    const only = row('t1', '2026-08-04T10:00:03.000Z', { user_id: 'them', content: 'gg' })
    const h = harness({ server: () => ok([only]) })
    await h.run(MESSAGE_POLL_MS * 6)
    expect(h.delivered.map((m) => m.id)).toEqual(['t1'])
  })
})

describe('the "Reconnecting…" note is quiet, honest and temporary', () => {
  it('says NOTHING about a single blip that heals on the next tick', async () => {
    const h = harness({
      server: (call) => (call === 2 ? netFail() : ok([])),
    })
    await h.run(MESSAGE_POLL_MS * 2)
    // One failure is below the threshold: no status change was ever emitted.
    expect(h.statuses).toEqual([])
    expect(h.status()).toBe('live')
  })

  it('speaks up on the SECOND consecutive failure, and shuts up on recovery', async () => {
    let up = false
    const h = harness({ server: () => (up ? ok([]) : netFail()) })

    await h.run(MESSAGE_POLL_MS * 8)
    expect(h.status()).toBe('reconnecting')

    up = true
    h.loop.resume()
    await h.loop.tick(true)
    expect(h.status()).toBe('live')
    expect(h.statuses).toEqual(['reconnecting', 'live'])
  })

  it('emits a status only when it CHANGES, never once per tick', async () => {
    const h = harness({ server: () => netFail() })
    await h.run(MESSAGE_POLL_MS * 30)
    expect(h.statuses).toEqual(['reconnecting'])
  })
})

describe('the gates that were already right stay right', () => {
  it('a hidden tab spends nothing, then catches up on return', async () => {
    let shown = false
    const h = harness({
      visible: () => shown,
      server: () => ok([row('a', '2026-08-04T10:00:01.000Z')]),
    })
    await h.run(MESSAGE_POLL_MS * 10)
    expect(h.reads()).toBe(0)

    shown = true
    h.loop.resume()
    await h.loop.tick(true)
    expect(h.delivered.map((m) => m.id)).toEqual(['a'])
  })

  it('an idle room BACKS OFF instead of polling at 5s forever', async () => {
    // A non-empty room whose only row is the one already delivered. The wire
    // returns it on every tick; the loop must not read that as activity.
    const only = row('t1', '2026-08-04T10:00:03.000Z')
    const h = harness({ server: () => ok([only]) })
    await h.run(MESSAGE_IDLE_AFTER_MS + MESSAGE_POLL_MS)
    const busy = h.reads()
    await h.run(MESSAGE_IDLE_AFTER_MS)
    const idleReads = h.reads() - busy
    // At the fast cadence that window would be ~18 reads; backed off it is ~4.
    expect(idleReads).toBeLessThan(busy)
  })

  it('a stopped loop issues nothing, ever again', async () => {
    const h = harness({ server: () => ok([row('a', '2026-08-04T10:00:01.000Z')]) })
    h.loop.stop()
    await h.run(MESSAGE_POLL_MS * 5)
    await h.loop.tick(true)
    h.loop.resume()
    expect(h.reads()).toBe(0)
  })

  it('never runs two reads at once', async () => {
    let inFlight = 0
    let peak = 0
    let now = 1_000_000
    const loop = createChatPollLoop<Row>({
      hasLegacyColumns: false,
      now: () => now,
      visible: () => true,
      online: () => true,
      read: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await Promise.resolve()
        inFlight -= 1
        return ok([])
      },
      deliver: () => {},
    })
    await Promise.all([loop.tick(true), loop.tick(true), loop.tick(true)])
    now += MESSAGE_POLL_MS
    await loop.tick(true)
    expect(peak).toBe(1)
  })

  it('a forced refresh cannot be used to bypass the backoff', async () => {
    // Otherwise a room full of people mashing send during an outage becomes the
    // stampede the jitter exists to prevent.
    const h = harness({ server: () => netFail() })
    await h.run(MESSAGE_POLL_MS)
    const after = h.reads()
    await h.loop.tick(true)
    await h.loop.tick(true)
    expect(h.reads()).toBe(after)
  })
})

describe('the loop is what the hook actually runs', () => {
  it('exports the constructor useChatMessages imports', () => {
    // Guards against the previous round's failure mode: a test file that
    // re-implemented the loop and therefore tested nothing that ships.
    expect(typeof createChatPollLoop).toBe('function')
    const spy = vi.fn()
    const loop = createChatPollLoop<Row>({
      hasLegacyColumns: false,
      now: () => 0,
      visible: () => true,
      online: () => true,
      read: async () => ok([]),
      deliver: spy,
    })
    expect(typeof loop.tick).toBe('function')
    expect(typeof loop.observe).toBe('function')
    expect(typeof loop.resume).toBe('function')
    expect(typeof loop.goOffline).toBe('function')
  })

  it('observe() folds the surface’s committed list into the cursor', async () => {
    const h = harness({ server: () => ok([]) })
    h.loop.observe([row('own', '2026-08-04T10:05:00.000Z')])
    expect(h.loop.cursor().at).toBe('2026-08-04T10:05:00.000Z')
    expect(h.loop.cursor().ids).toContain('own')
  })

  it('goOffline() reports without waiting for a read to fail', () => {
    const h = harness({ server: () => ok([]) })
    h.loop.goOffline()
    expect(h.status()).toBe('offline')
  })
})
