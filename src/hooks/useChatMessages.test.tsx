import { useState } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MESSAGE_IDLE_AFTER_MS,
  MESSAGE_IDLE_POLL_MS,
  MESSAGE_POLL_MS,
  mergeMessages,
} from '@/lib/chatMessages'
import { useChatMessages } from '@/hooks/useChatMessages'

/**
 * THE SHIPPED HOOK, MOUNTED AND DRIVEN.
 *
 * WHY THIS FILE EXISTS. The transport shipped green with six defects in it
 * because the tests re-implemented the polling loop INSIDE the test file: they
 * asserted a copy of the loop while the real one froze rooms on the first failed
 * request, never backed off, and advanced its cursor over messages it had not
 * delivered. Nothing imported `useChatMessages`.
 *
 * So this file imports it. Everything below mounts the ACTUAL hook in an ACTUAL
 * React tree and drives it through the only three seams it has: the `supabase`
 * module (mocked at the boundary the hook imports, so `readWindow`, the query
 * shape and the failure classification all run for real), `document` /
 * `navigator` / `window`, and the clock. Nothing about the loop, the cursor, the
 * cadence or the retry policy is restated here — if the hook stops delivering
 * messages, these fail.
 *
 * The seven behaviours each map to a defect that reached production:
 *   • a second client's message arrives with no remount        (the whole point)
 *   • the sender's own line is never doubled                   (inclusive cursor)
 *   • ONE failed request does not freeze the room forever      (defect 1)
 *   • a hidden tab spends nothing, and catches up on return    (the cost gate)
 *   • an idle room ACTUALLY backs off                          (defect 2)
 *   • two rows sharing a timestamp are both delivered          (cursor boundary)
 *   • a failed author read does not CONSUME the messages       (defect 3)
 */

// ───────────────────────────────────────────────────────────────────────────
//  The backend, as the hook's own import sees it
// ───────────────────────────────────────────────────────────────────────────

type Row = { id: string; created_at: string | null; user_id?: string | null; content?: string }

/** One read the hook issued, exactly as it built it. */
interface Read {
  table: string
  columns: string
  filters: [string, unknown][]
  /** The `.gte('created_at', …)` bound, or null when the room has read nothing. */
  cursor: string | null
  ascending: boolean
  limit: number
}

/** What the fake backend answers with. `throws` covers the hosted client. */
interface Reply {
  data?: Row[] | null
  error?: { message: string } | null
  status?: number
  throws?: Error
}

const reads: Read[] = []
let reply: (read: Read, index: number) => Reply = () => ({ data: [] })

/**
 * A stand-in for the real query builder, mocked at the module boundary the hook
 * imports — so the hook's own `readWindow` (its filter shape, its `{ data,
 * error, status }` unpacking and its failure classification) is the code under
 * test, not a paraphrase of it.
 */
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const read: Read = {
        table,
        columns: '*',
        filters: [],
        cursor: null,
        ascending: true,
        limit: 0,
      }
      const builder = {
        select(columns: string) {
          read.columns = columns
          return builder
        },
        eq(col: string, val: unknown) {
          read.filters.push([col, val])
          return builder
        },
        gte(_col: string, val: string) {
          read.cursor = val
          return builder
        },
        order(_col: string, opts: { ascending: boolean }) {
          read.ascending = opts.ascending
          return builder
        },
        async limit(count: number) {
          read.limit = count
          reads.push(read)
          const answer = reply(read, reads.length - 1)
          if (answer.throws) throw answer.throws
          return {
            data: answer.data ?? [],
            error: answer.error ?? null,
            status: answer.status ?? 200,
          }
        },
      }
      return builder
    },
  },
}))

// ───────────────────────────────────────────────────────────────────────────
//  The browser, as the hook's own globals see it
// ───────────────────────────────────────────────────────────────────────────

class FakeEvents {
  private readonly listeners = new Map<string, Set<() => void>>()
  addEventListener(type: string, fn: () => void) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(fn)
    this.listeners.set(type, set)
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn)
  }
  /** Fire an event the way the browser would. */
  dispatch(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn()
  }
  /** How many listeners survive — the cleanup assertion. */
  count(type: string) {
    return this.listeners.get(type)?.size ?? 0
  }
}

/** Timers resolve on `globalThis` at CALL time, so the fake clock is the one
 *  the hook's interval actually uses. Rebuilt per test — a listener left behind
 *  by one test must never be visible to the next. */
const newWindow = () =>
  Object.assign(new FakeEvents(), {
    setInterval: (fn: () => void, ms: number) => globalThis.setInterval(fn, ms),
    clearInterval: (id: number) => globalThis.clearInterval(id),
  })

let fakeDocument = Object.assign(new FakeEvents(), { visibilityState: 'visible' as string })
let fakeWindow = newWindow()
let fakeNavigator = { onLine: true }

const ROOM = '33333333-4444-4555-8666-777777777777'
const T0 = new Date('2026-08-04T10:00:00.000Z')

function row(id: string, at: string, extra: Partial<Row> = {}): Row {
  return { id, created_at: at, user_id: 'them', content: id, ...extra }
}

/** ISO for `seconds` after the room opened. */
function at(seconds: number): string {
  return new Date(T0.getTime() + seconds * 1000).toISOString()
}

// ───────────────────────────────────────────────────────────────────────────
//  The surface
// ───────────────────────────────────────────────────────────────────────────

/** Everything a test wants to look at from outside the tree. */
interface Store {
  messages: Row[]
  status: string
  supported: boolean
  /** Every batch handed to `onMessages`, in order. */
  delivered: Row[][]
}

/**
 * A minimal chat surface: it holds a list, hands the hook that list, and merges
 * what comes back exactly the way all four real surfaces do
 * (`mergeMessages`). No other behaviour — the hook is what is on trial.
 */
function Room(props: {
  store: Store
  roomId: string | null
  initial?: Row[]
  /** Stand-in for the surfaces' author/profile hydration. May reject. */
  hydrate?: (rows: Row[]) => Promise<void>
  ready?: boolean
}) {
  const [messages, setMessages] = useState<Row[]>(props.initial ?? [])
  const poll = useChatMessages<Row>({
    scope: 'stream',
    roomId: props.roomId,
    messages,
    ready: props.ready ?? true,
    onMessages: async (rows) => {
      props.store.delivered.push(rows)
      // DirectMessages resolves author profiles here, and that read can fail.
      if (props.hydrate) await props.hydrate(rows)
      setMessages((prev) => mergeMessages(prev, rows, (m) => m.content ?? ''))
    },
  })
  props.store.messages = messages
  props.store.status = poll.status
  props.store.supported = poll.supported
  return null
}

function newStore(): Store {
  return { messages: [], status: 'live', supported: true, delivered: [] }
}

/** Every tree a test mounted, so afterEach can tear all of them down. */
const mounted: TestRenderer.ReactTestRenderer[] = []

/** Mount the surface. Returns the store and the renderer (for unmount). */
async function open(props: Omit<Parameters<typeof Room>[0], 'store'>) {
  const store = newStore()
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<Room store={store} {...props} />)
  })
  mounted.push(renderer)
  return { store, renderer }
}

/** Advance the clock, letting every poll it starts run to completion. */
async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  reads.length = 0
  reply = () => ({ data: [] })
  // A FRESH browser per test: a room left mounted by one test must not be able
  // to spend a request that another test then counts.
  fakeDocument = Object.assign(new FakeEvents(), { visibilityState: 'visible' as string })
  fakeWindow = newWindow()
  fakeNavigator = { onLine: true }
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal('navigator', fakeNavigator)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // Only the clock the poll reads. setTimeout/setImmediate stay REAL so React's
  // own scheduler is untouched by anything a test does to time.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(T0)
  // Kill the retry jitter: every backoff below is its exact minimum.
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(async () => {
  // Unmount before the clock goes back to normal, so no interval outlives its
  // test and lands in the next one's read log.
  await act(async () => {
    for (const renderer of mounted.splice(0)) renderer.unmount()
  })
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ───────────────────────────────────────────────────────────────────────────

describe('useChatMessages — a second client is finally heard', () => {
  it('delivers a message posted AFTER the room opened, with no remount', async () => {
    const theirs = row('t1', at(3), { content: 'gg wp' })
    reply = (_read, index) => ({ data: index === 0 ? [] : [theirs] })

    const { store } = await open({ roomId: ROOM })
    expect(store.messages).toHaveLength(0)

    await elapse(MESSAGE_POLL_MS)

    // The whole product, in one assertion: the list moved without a remount.
    expect(store.messages.map((m) => m.id)).toEqual(['t1'])
    expect(store.status).toBe('live')
  })

  it('issues the incremental read the /api/db route understands', async () => {
    reply = () => ({ data: [row('t1', at(3))] })
    await open({ roomId: ROOM })
    await elapse(MESSAGE_POLL_MS)

    expect(reads[0].table).toBe('stream_messages')
    expect(reads[0].filters).toEqual([['stream_id', ROOM]])
    expect(reads[0].cursor).toBeNull() // nothing delivered yet
    expect(reads[0].ascending).toBe(true)
    expect(reads[0].limit).toBeGreaterThan(0)
    // Once a row lands, every later tick is bounded by it.
    expect(reads[1].cursor).toBe(at(3))
  })

  it('spends NOTHING until the surface says its backfill has landed', async () => {
    reply = () => ({ data: [row('t1', at(3))] })
    const { store } = await open({ roomId: ROOM, ready: false })
    await elapse(MESSAGE_POLL_MS * 4)
    expect(reads).toHaveLength(0)
    expect(store.messages).toHaveLength(0)
  })

  it('stops polling and drops its listeners on unmount', async () => {
    const { renderer } = await open({ roomId: ROOM })
    const spent = reads.length
    expect(fakeDocument.count('visibilitychange')).toBe(1)

    await act(async () => {
      renderer.unmount()
    })
    await elapse(MESSAGE_POLL_MS * 10)

    expect(reads).toHaveLength(spent)
    expect(fakeDocument.count('visibilitychange')).toBe(0)
    expect(fakeWindow.count('online')).toBe(0)
    expect(fakeWindow.count('offline')).toBe(0)
  })
})

describe('useChatMessages — the sender never sees their own line twice', () => {
  it('does not re-deliver a message the surface already holds', async () => {
    // The cursor is INCLUSIVE on the wire, so the row it points at comes back on
    // every single tick. It must never reach the surface a second time.
    const mine = row('real-1', at(0), { user_id: 'me', content: 'gg' })
    reply = () => ({ data: [mine] })

    const { store } = await open({ roomId: ROOM, initial: [mine] })
    await elapse(MESSAGE_POLL_MS * 5)

    expect(store.messages.map((m) => m.id)).toEqual(['real-1'])
    expect(store.delivered).toEqual([]) // never handed back, so never re-hydrated
    expect(reads.length).toBeGreaterThan(1) // …and the room really was polling
  })

  it('replaces an optimistic local-… stand-in with the persisted row', async () => {
    // The fallback id an older backend forces, and the case where the poll would
    // otherwise show the sender their own message twice.
    const optimistic = row('local-17-abc', at(0), { user_id: 'me', content: 'gg' })
    const persisted = row('uuid-1', at(1), { user_id: 'me', content: 'gg' })
    reply = () => ({ data: [persisted] })

    const { store } = await open({ roomId: ROOM, initial: [optimistic] })
    await elapse(MESSAGE_POLL_MS)

    expect(store.messages.map((m) => m.id)).toEqual(['uuid-1'])
  })
})

describe('useChatMessages — one bad request is a bad moment, not a dead room', () => {
  it('RECOVERS on the next tick after a failed read', async () => {
    // The exact shape lib/realSupabase.ts returns for a network error: it
    // resolves, it does not throw. That is what used to run the permanent branch
    // and freeze the room for the life of the mount.
    reply = (_read, index) =>
      index === 0
        ? { data: null, error: { message: 'Network error' }, status: 0 }
        : { data: [row('t1', at(3))] }

    const { store } = await open({ roomId: ROOM })
    expect(store.messages).toHaveLength(0)

    await elapse(MESSAGE_POLL_MS)

    expect(store.messages.map((m) => m.id)).toEqual(['t1'])
    expect(store.status).toBe('live')
    expect(store.supported).toBe(true)
  })

  it('recovers from a THROWN request too (the hosted client)', async () => {
    reply = (_read, index) =>
      index === 0 ? { throws: new Error('Failed to fetch') } : { data: [row('t1', at(3))] }

    const { store } = await open({ roomId: ROOM })
    await elapse(MESSAGE_POLL_MS)
    expect(store.messages.map((m) => m.id)).toEqual(['t1'])
  })

  it('keeps trying through a LONG outage and heals the moment it ends', async () => {
    // Ten minutes of failure. The room must still be asking at the end of it —
    // "no retry for the life of the mount" is the defect this replaces.
    let down = true
    reply = () => (down ? { data: null, error: { message: 'timeout' }, status: 0 } : { data: [row('t1', at(3))] })

    const { store } = await open({ roomId: ROOM })
    await elapse(10 * 60_000)

    expect(reads.length).toBeGreaterThan(5)
    expect(store.status).toBe('reconnecting') // visible, and quiet
    expect(store.supported).toBe(true) // NOT declared dead

    down = false
    const spentWhileDown = reads.length
    await elapse(5 * 60_000)

    expect(reads.length).toBeGreaterThan(spentWhileDown)
    expect(store.messages.map((m) => m.id)).toEqual(['t1'])
    expect(store.status).toBe('live')
  })

  it('reports OFFLINE without spending a request, and catches up on `online`', async () => {
    reply = () => ({ data: [row('t1', at(3))] })
    const { store } = await open({ roomId: ROOM, initial: [row('seed', at(0))] })
    const spent = reads.length

    fakeNavigator.onLine = false
    await act(async () => {
      fakeWindow.dispatch('offline')
    })
    await elapse(MESSAGE_POLL_MS * 6)

    expect(reads).toHaveLength(spent) // nothing burned on a doomed request
    expect(store.status).toBe('offline')

    fakeNavigator.onLine = true
    await act(async () => {
      fakeWindow.dispatch('online')
    })

    expect(reads.length).toBeGreaterThan(spent)
    expect(store.messages.map((m) => m.id)).toEqual(['seed', 't1'])
    expect(store.status).toBe('live')
  })

  it('stops for good only when the viewer is REFUSED the room', async () => {
    // The one honest terminal state: retrying cannot change the answer. The room
    // degrades to backfill-only, exactly as it behaved before this transport.
    reply = () => ({ data: null, error: { message: 'Forbidden' }, status: 403 })

    const { store } = await open({ roomId: ROOM })
    const spent = reads.length
    await elapse(MESSAGE_POLL_MS * 20)

    expect(reads).toHaveLength(spent) // no hammering
    expect(store.supported).toBe(false)
    expect(store.status).toBe('unsupported')
  })
})

describe('useChatMessages — a hidden tab costs nothing', () => {
  it('STOPS polling while hidden and catches up the instant it returns', async () => {
    // Nothing to hear on the opening tick; the other client speaks while the
    // viewer is looking at a different tab.
    reply = (_read, index) => ({ data: index === 0 ? [] : [row('t1', at(3))] })
    const { store } = await open({ roomId: ROOM, initial: [row('seed', at(0))] })
    const spent = reads.length

    fakeDocument.visibilityState = 'hidden'
    await elapse(MESSAGE_POLL_MS * 12)
    expect(reads).toHaveLength(spent)
    expect(store.messages.map((m) => m.id)).toEqual(['seed'])

    // Back in front: one immediate catch-up, not a wait for the next interval.
    fakeDocument.visibilityState = 'visible'
    await act(async () => {
      fakeDocument.dispatch('visibilitychange')
    })

    expect(reads.length).toBe(spent + 1)
    expect(store.messages.map((m) => m.id)).toEqual(['seed', 't1'])
  })
})

describe('useChatMessages — an idle room actually backs off', () => {
  it('drops to the slow cadence when nothing new is being said', async () => {
    // THE DEFECT-2 REGRESSION. The cursor is inclusive, so a non-empty room
    // returns its boundary row on EVERY tick. Counting that echo as "activity"
    // kept every open panel at 5s forever — and re-hydrated author profiles
    // every 5s with it. At 500 viewers that is ~200 req/s of pure echo against a
    // five-connection pool.
    const only = row('t1', at(0))
    reply = () => ({ data: [only] })

    const { store } = await open({ roomId: ROOM })

    // Talk once, then go quiet for the whole idle window.
    await elapse(MESSAGE_IDLE_AFTER_MS + MESSAGE_POLL_MS)
    const beforeIdle = reads.length

    const window = 100_000
    await elapse(window)
    const spentWhileIdle = reads.length - beforeIdle

    const fastCadence = Math.floor(window / MESSAGE_POLL_MS) // 20
    const slowCadence = Math.floor(window / MESSAGE_IDLE_POLL_MS) // 5
    expect(spentWhileIdle).toBeLessThanOrEqual(slowCadence + 1)
    expect(spentWhileIdle).toBeLessThan(fastCadence)
    expect(spentWhileIdle).toBeGreaterThan(0) // still live, just cheaper

    // …and the surface was handed the row exactly ONCE in all that time, so the
    // profiles table is not re-read on every tick either.
    expect(store.delivered).toHaveLength(1)
    expect(store.messages.map((m) => m.id)).toEqual(['t1'])
  })

  it('returns to the fast cadence the moment somebody speaks', async () => {
    let rows: Row[] = [row('t1', at(0))]
    reply = () => ({ data: rows })
    await open({ roomId: ROOM })
    await elapse(MESSAGE_IDLE_AFTER_MS + MESSAGE_IDLE_POLL_MS * 2)

    rows = [row('t1', at(0)), row('t2', at(200))]
    await elapse(MESSAGE_IDLE_POLL_MS) // the tick that hears it
    const afterSpeech = reads.length
    await elapse(MESSAGE_POLL_MS * 4)

    expect(reads.length - afterSpeech).toBeGreaterThanOrEqual(3)
  })
})

describe('useChatMessages — the cursor boundary', () => {
  it('delivers BOTH messages that share a created_at', async () => {
    // now() is transaction-start time, so ties are normal, and a row at the
    // boundary can commit AFTER we have already read past it. An exclusive
    // cursor loses the second one silently.
    const first = row('a', at(10))
    const second = row('b', at(10))
    reply = (_read, index) => ({ data: index === 0 ? [first] : [first, second] })

    const { store } = await open({ roomId: ROOM })
    await elapse(MESSAGE_POLL_MS)

    expect(store.messages.map((m) => m.id)).toEqual(['a', 'b'])
    // The wire bound is inclusive — that is what makes the tie readable at all.
    expect(reads[1].cursor).toBe(at(10))

    // And neither of them is delivered again on the ticks that follow.
    await elapse(MESSAGE_POLL_MS * 3)
    expect(store.delivered.flat().map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('useChatMessages — a failed author read does not consume messages', () => {
  it('re-reads the SAME window and loses nothing', async () => {
    // DirectMessages hydrates authors inside onMessages, and that read can fail.
    // The cursor is monotonic: if it moves before delivery is confirmed, those
    // messages are never fetched again — silent, permanent loss.
    const theirs = row('t1', at(3), { content: 'you there?' })
    reply = () => ({ data: [theirs] })
    let failNext = true
    const hydrate = async () => {
      if (failNext) {
        failNext = false
        throw new Error('profiles read failed')
      }
    }

    const { store } = await open({ roomId: ROOM, hydrate })
    expect(store.messages).toHaveLength(0) // the throw ate the merge…

    await elapse(MESSAGE_POLL_MS * 3)

    // …but not the message.
    expect(store.messages.map((m) => m.id)).toEqual(['t1'])
    // The read that followed the failure carried the UNMOVED cursor.
    expect(reads[1].cursor).toBeNull()
    // Delivered twice (once failed, once committed), merged exactly once.
    expect(store.delivered.map((batch) => batch.map((m) => m.id))).toEqual([['t1'], ['t1']])
  })

  it('keeps re-reading a window it can NEVER deliver, rather than dropping it', async () => {
    // Hydration that fails forever (a profiles outage). The room must not
    // consume the messages, must not declare itself dead, and must still be
    // asking — so the log fills in by itself the moment hydration recovers.
    reply = () => ({ data: [row('t1', at(3))] })
    const { store } = await open({
      roomId: ROOM,
      hydrate: async () => {
        throw new Error('profiles read failed')
      },
    })
    await elapse(MESSAGE_POLL_MS * 20)

    expect(store.messages).toHaveLength(0)
    expect(store.supported).toBe(true) // never declared unsupported
    expect(store.delivered.length).toBeGreaterThan(2) // still handing it over
    // Every one of those attempts read the SAME unmoved window.
    expect(reads.every((read) => read.cursor === null)).toBe(true)
  })
})
