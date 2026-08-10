import { describe, expect, it } from 'vitest'
import {
  CHAT_TABLES,
  MESSAGE_IDLE_AFTER_MS,
  MESSAGE_IDLE_POLL_MS,
  MESSAGE_POLL_MS,
  mergeMessages,
  newestTimestamp,
  shouldPollMessages,
} from './chatMessages'
import { CHAT_SCOPES } from './chatPresence'

/**
 * The transport that makes chat actually live.
 *
 * Everything here is the decision layer the hook (hooks/useChatMessages.ts)
 * calls: what the cursor is, what happens when a polled row collides with the
 * sender's optimistic copy, and whether a tick is allowed to spend a request.
 * The three behaviours the slice is judged on are asserted directly:
 *   • a second client's message appears WITHOUT a remount (merge appends it);
 *   • the sender's own message is NOT duplicated (id and optimistic dedupe);
 *   • a hidden tab STOPS polling (the gate refuses every tick).
 */

type Row = { id: string; created_at: string | null; user_id?: string | null; content?: string }

const row = (id: string, created_at: string | null, extra: Partial<Row> = {}): Row => ({
  id,
  created_at,
  ...extra,
})

describe('CHAT_TABLES', () => {
  it('covers every chat scope presence knows about', () => {
    for (const scope of CHAT_SCOPES) {
      expect(CHAT_TABLES[scope]).toBeTruthy()
      expect(CHAT_TABLES[scope].table).toBeTruthy()
      expect(CHAT_TABLES[scope].roomCol).toBeTruthy()
    }
  })

  it('knows chat_messages stores its body in `body`, not `content`', () => {
    // The one schema difference that would silently break a shared merge.
    expect(CHAT_TABLES.channel.textCol).toBe('body')
    expect(CHAT_TABLES.stream.textCol).toBe('content')
    expect(CHAT_TABLES.tournament.textCol).toBe('content')
    expect(CHAT_TABLES.dm.textCol).toBe('content')
  })
})

describe('newestTimestamp — the cursor', () => {
  it('is the newest created_at in the list', () => {
    expect(
      newestTimestamp([
        row('a', '2026-08-04T10:00:00.000Z'),
        row('b', '2026-08-04T10:00:05.000Z'),
        row('c', '2026-08-04T10:00:02.000Z'),
      ]),
    ).toBe('2026-08-04T10:00:05.000Z')
  })

  it('NEVER moves backward — a surface replacing its list cannot rewind the poll', () => {
    const current = '2026-08-04T10:00:05.000Z'
    expect(newestTimestamp([row('a', '2026-08-04T09:00:00.000Z')], current)).toBe(current)
  })

  it('ignores rows with a missing or unparseable timestamp', () => {
    expect(newestTimestamp([row('a', null), row('b', 'not-a-date')])).toBeNull()
    expect(newestTimestamp([row('a', null), row('b', '2026-08-04T10:00:00.000Z')])).toBe(
      '2026-08-04T10:00:00.000Z',
    )
  })

  it('returns the existing cursor for an empty list', () => {
    expect(newestTimestamp([], '2026-08-04T10:00:00.000Z')).toBe('2026-08-04T10:00:00.000Z')
    expect(newestTimestamp([])).toBeNull()
  })
})

describe('mergeMessages — a second client is heard, the sender is not doubled', () => {
  it('APPENDS another client’s message with no remount', () => {
    const mine = [row('m1', '2026-08-04T10:00:00.000Z', { user_id: 'me', content: 'gg' })]
    const polled = [row('t1', '2026-08-04T10:00:03.000Z', { user_id: 'them', content: 'gg wp' })]
    const merged = mergeMessages(mine, polled, (m) => m.content ?? '')
    expect(merged.map((m) => m.id)).toEqual(['m1', 't1'])
  })

  it('does not duplicate the sender’s own line when the poll echoes it back', () => {
    // The inclusive cursor ALWAYS re-delivers the row it points at.
    const optimistic = [row('real-1', '2026-08-04T10:00:00.000Z', { user_id: 'me', content: 'gg' })]
    const echoed = [row('real-1', '2026-08-04T10:00:00.000Z', { user_id: 'me', content: 'gg' })]
    const merged = mergeMessages(optimistic, echoed, (m) => m.content ?? '')
    expect(merged).toHaveLength(1)
    expect(merged[0]).toBe(optimistic[0]) // the ENRICHED local copy survives
  })

  it('replaces an optimistic local-… stand-in with the persisted row', () => {
    // Minted only when an insert returned no row; without this rule the poll
    // brings the real row back and the sender sees their line twice.
    const current = [row('local-17-abc', '2026-08-04T10:00:00.000Z', { user_id: 'me', content: 'gg' })]
    const polled = [row('uuid-1', '2026-08-04T10:00:00.500Z', { user_id: 'me', content: 'gg' })]
    const merged = mergeMessages(current, polled, (m) => m.content ?? '')
    expect(merged.map((m) => m.id)).toEqual(['uuid-1'])
  })

  it('keeps an optimistic row whose text belongs to somebody else', () => {
    const current = [row('local-17-abc', '2026-08-04T10:00:00.000Z', { user_id: 'me', content: 'gg' })]
    const polled = [row('uuid-1', '2026-08-04T10:00:00.500Z', { user_id: 'them', content: 'gg' })]
    const merged = mergeMessages(current, polled, (m) => m.content ?? '')
    expect(merged.map((m) => m.id)).toEqual(['local-17-abc', 'uuid-1'])
  })

  it('orders a late arrival into the log by time, not by arrival', () => {
    const current = [
      row('a', '2026-08-04T10:00:00.000Z'),
      row('c', '2026-08-04T10:00:10.000Z'),
    ]
    const merged = mergeMessages(current, [row('b', '2026-08-04T10:00:05.000Z')])
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps insertion order for rows that share a timestamp', () => {
    // now() is transaction-start time, so ties are normal and must be stable.
    const merged = mergeMessages(
      [row('a', '2026-08-04T10:00:00.000Z')],
      [row('b', '2026-08-04T10:00:00.000Z'), row('c', '2026-08-04T10:00:00.000Z')],
    )
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns the SAME array when the poll brought nothing new', () => {
    // Identity matters: a fresh array every tick would re-render every row.
    const current = [row('a', '2026-08-04T10:00:00.000Z')]
    expect(mergeMessages(current, [])).toBe(current)
    expect(mergeMessages(current, [row('a', '2026-08-04T10:00:00.000Z')])).toBe(current)
  })

  it('never hoists a row with no timestamp to the top of the log', () => {
    const current = [row('a', '2026-08-04T10:00:00.000Z')]
    const merged = mergeMessages(current, [row('b', null)])
    expect(merged.map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('shouldPollMessages — the visibility gate and the idle backoff', () => {
  const base = { lastPollAt: 1_000_000, lastRowAt: 1_000_000, now: 1_000_000 + MESSAGE_POLL_MS }

  it('REFUSES every tick while the tab is hidden', () => {
    expect(shouldPollMessages({ ...base, visible: false })).toBe(false)
    // Even a first-ever tick, and even after an eternity of silence.
    expect(shouldPollMessages({ visible: false, lastPollAt: null, lastRowAt: null, now: 5 })).toBe(false)
    expect(
      shouldPollMessages({ ...base, visible: false, now: base.now + 10 * MESSAGE_IDLE_POLL_MS }),
    ).toBe(false)
  })

  it('polls immediately on the first visible tick', () => {
    expect(shouldPollMessages({ visible: true, lastPollAt: null, lastRowAt: null, now: 5 })).toBe(true)
  })

  it('polls at the fast cadence while the room is active', () => {
    expect(shouldPollMessages({ ...base, visible: true, now: 1_000_000 + 1_000 })).toBe(false)
    expect(shouldPollMessages({ ...base, visible: true })).toBe(true)
  })

  it('BACKS OFF once the room has been quiet', () => {
    const quietSince = 1_000_000 - MESSAGE_IDLE_AFTER_MS - 1
    const gate = { visible: true, lastPollAt: 1_000_000, lastRowAt: quietSince }
    // The fast cadence is no longer enough…
    expect(shouldPollMessages({ ...gate, now: 1_000_000 + MESSAGE_POLL_MS })).toBe(false)
    // …but the slow one is.
    expect(shouldPollMessages({ ...gate, now: 1_000_000 + MESSAGE_IDLE_POLL_MS })).toBe(true)
  })

  it('returns to the fast cadence the moment somebody speaks', () => {
    const gate = { visible: true, lastPollAt: 1_000_000, lastRowAt: 1_000_000 }
    expect(shouldPollMessages({ ...gate, now: 1_000_000 + MESSAGE_POLL_MS })).toBe(true)
  })

  it('does not wedge when the clock jumps backward', () => {
    // Sleep/wake and NTP skew must not park a room until the clock catches up.
    expect(shouldPollMessages({ ...base, visible: true, now: 1 })).toBe(true)
  })
})

describe('the poll loop, driven with a fake clock', () => {
  /**
   * The loop the hook runs, with `document` and `supabase` replaced by plain
   * values: an interval that ticks every MESSAGE_POLL_MS and only fetches when
   * the gate says so. This is what proves "a hidden tab stops polling" and "a
   * second client's message appears without remount" as one behaviour rather
   * than two isolated predicates.
   */
  function run(options: {
    ticks: number
    visibleAt: (now: number) => boolean
    server: (cursor: string | null) => Row[]
  }) {
    let now = 0
    let lastPollAt: number | null = null
    let lastRowAt: number | null = 0
    let cursor: string | null = null
    let fetches = 0
    let list: Row[] = []

    for (let i = 0; i < options.ticks; i += 1) {
      now += MESSAGE_POLL_MS
      const visible = options.visibleAt(now)
      if (!visible) continue // the interval callback's own visibility guard
      if (!shouldPollMessages({ visible, lastPollAt, lastRowAt, now })) continue
      lastPollAt = now
      fetches += 1
      const rows = options.server(cursor)
      if (rows.length === 0) continue
      cursor = newestTimestamp(rows, cursor)
      lastRowAt = now
      list = mergeMessages(list, rows, (m) => m.content ?? '')
    }
    return { fetches, list, cursor }
  }

  it('delivers a second client’s message without a remount', () => {
    const theirs = row('t1', '2026-08-04T10:00:03.000Z', { user_id: 'them', content: 'gg wp' })
    // The other client posts AFTER the room opened — the exact case that used
    // to require closing and reopening the channel.
    let posted = false
    const live = run({
      ticks: 3,
      visibleAt: () => true,
      server: () => {
        if (!posted) {
          posted = true
          return []
        }
        return [theirs]
      },
    })
    expect(live.list.map((m) => m.id)).toEqual(['t1'])
    expect(live.cursor).toBe('2026-08-04T10:00:03.000Z')
  })

  it('spends ZERO requests while the tab is hidden, then catches up on return', () => {
    const hidden = run({
      ticks: 20,
      visibleAt: () => false,
      server: () => [row('t1', '2026-08-04T10:00:03.000Z', { content: 'hi' })],
    })
    expect(hidden.fetches).toBe(0)
    expect(hidden.list).toHaveLength(0)

    // Same 20 ticks, but the tab is in front for the last five.
    const returned = run({
      ticks: 20,
      visibleAt: (now) => now > 15 * MESSAGE_POLL_MS,
      server: () => [row('t1', '2026-08-04T10:00:03.000Z', { content: 'hi' })],
    })
    expect(returned.fetches).toBeGreaterThan(0)
    expect(returned.list.map((m) => m.id)).toEqual(['t1'])
  })

  it('re-delivers the cursor row every tick and never duplicates it', () => {
    // The inclusive cursor is the whole reason merge must dedupe by id.
    const only = row('t1', '2026-08-04T10:00:03.000Z', { user_id: 'them', content: 'gg' })
    const result = run({ ticks: 10, visibleAt: () => true, server: () => [only] })
    expect(result.list).toHaveLength(1)
    expect(result.fetches).toBe(10)
  })
})
