import { describe, expect, it } from 'vitest'
import {
  EMPTY_MESSAGE_CURSOR,
  MESSAGE_CURSOR_TIE_LIMIT,
  MESSAGE_IDLE_AFTER_MS,
  MESSAGE_IDLE_POLL_MS,
  MESSAGE_POLL_MS,
  advanceCursor,
  mergeMessages,
  orderOldestFirst,
  shouldPollMessages,
  unseenRows,
  type MessageCursor,
  type PollMessageLike,
} from './chatMessages'

/**
 * SURVIVING A CROWD — the composite cursor, and the load it exists to remove.
 *
 * The transport shipped with an INCLUSIVE cursor, which meant a non-empty room
 * returned its boundary row on every single tick. That row looked like traffic,
 * so the idle backoff could never engage and the surface re-hydrated author
 * profiles every 5 seconds: ~2 requests per open panel per 5s, forever, against
 * a 5-connection pool. Five hundred stream viewers is enough to take the site
 * down at exactly the moment it matters.
 *
 * The fix cannot simply be `gt` instead of `gte`. `created_at` IS NOT A UNIQUE
 * ORDERING here (transaction-start `now()`, millisecond JSON truncation of a
 * microsecond column, and commit order that does not match `now()` order), and
 * a strict bound on a non-unique column silently DROPS messages — which is why
 * the inclusive cursor was chosen in the first place. This transport also
 * cannot express a real `(created_at, id)` tuple comparison: the generic
 * /api/db endpoint AND's a flat filter list and honours one order column.
 *
 * So the tuple is split — the timestamp half stays INCLUSIVE on the wire and
 * the id half is applied on the client. These tests hold BOTH ends of that
 * bargain: the boundary must never lose a message, and an idle room must
 * genuinely report zero activity.
 */

type Row = PollMessageLike & { content?: string }

const row = (id: string, created_at: string | null, extra: Partial<Row> = {}): Row => ({
  id,
  created_at,
  ...extra,
})

/** The cursor after delivering `rows` to a fresh room. */
const cursorOver = (rows: readonly Row[]): MessageCursor =>
  advanceCursor(EMPTY_MESSAGE_CURSOR, rows)

const T0 = '2026-08-04T10:00:00.000Z'
const T1 = '2026-08-04T10:00:05.000Z'
const T2 = '2026-08-04T10:00:10.000Z'

describe('the composite cursor — nothing at the boundary is lost', () => {
  it('THE OFF-BY-ONE: a second row sharing the boundary timestamp is still delivered', () => {
    // The exact case a strict `gt('created_at', cursor)` would drop forever.
    // Two inserts share a created_at (Postgres now() is transaction-start
    // time); the first commits and is read, the second commits afterwards.
    const first = row('a', T1, { content: 'gg' })
    const second = row('b', T1, { content: 'wp' })

    const cursor = cursorOver([first])
    // The wire bound is inclusive, so BOTH rows come back on the next read.
    const returned = [first, second]

    const fresh = unseenRows(cursor, returned)
    expect(fresh.map((m) => m.id)).toEqual(['b'])
  })

  it('survives a THREE-way tie arriving one commit at a time', () => {
    const a = row('a', T1)
    const b = row('b', T1)
    const c = row('c', T1)

    let cursor = cursorOver([a])
    let fresh = unseenRows(cursor, [a, b])
    expect(fresh.map((m) => m.id)).toEqual(['b'])

    cursor = advanceCursor(cursor, fresh)
    fresh = unseenRows(cursor, [a, b, c])
    expect(fresh.map((m) => m.id)).toEqual(['c'])

    // And once all three are in, the room is quiet again.
    cursor = advanceCursor(cursor, fresh)
    expect(unseenRows(cursor, [a, b, c])).toEqual([])
  })

  it('does not lose a message when the timestamp is truncated to milliseconds', () => {
    // timestamptz is microseconds in Postgres but reaches the client through
    // JSON.stringify(Date), which is milliseconds — so many distinct rows share
    // the cursor value a client can echo back.
    const truncated = '2026-08-04T10:00:05.123Z'
    const first = row('a', truncated)
    const second = row('b', truncated)
    const cursor = cursorOver([first])
    expect(unseenRows(cursor, [first, second]).map((m) => m.id)).toEqual(['b'])
  })

  it('keeps the tie list only for the CURRENT boundary instant', () => {
    const cursor = advanceCursor(cursorOver([row('a', T1), row('b', T1)]), [row('c', T2)])
    expect(cursor.at).toBe(T2)
    // 'a' and 'b' are strictly older now, so their ids are dead weight.
    expect(cursor.ids).toEqual(['c'])
    // …and they are still correctly treated as seen, by time alone.
    expect(unseenRows(cursor, [row('a', T1), row('b', T1)])).toEqual([])
  })

  it('UNIONS ids that land on the boundary instead of evicting the ones it has', () => {
    const cursor = advanceCursor(cursorOver([row('a', T1)]), [row('b', T1)])
    expect(cursor.at).toBe(T1)
    expect([...cursor.ids].sort()).toEqual(['a', 'b'])
  })

  it('NEVER rewinds — a surface replacing its whole list cannot rewind the poll', () => {
    const cursor = cursorOver([row('c', T2)])
    const rewound = advanceCursor(cursor, [row('a', T0)])
    expect(rewound.at).toBe(T2)
    expect(rewound.ids).toEqual(['c'])
  })

  it('treats everything as unseen before anything has been delivered', () => {
    expect(unseenRows(EMPTY_MESSAGE_CURSOR, [row('a', T0), row('b', T1)]).map((m) => m.id)).toEqual(
      ['a', 'b'],
    )
  })

  it('delivers a row with no usable timestamp rather than dropping it', () => {
    // created_at is NOT NULL on all four tables, so this is a shape we should
    // never see — and re-delivering is recoverable where losing is not.
    const cursor = cursorOver([row('a', T1)])
    expect(unseenRows(cursor, [row('x', null)]).map((m) => m.id)).toEqual(['x'])
  })

  it('bounds the tie list, and overflows toward RE-DELIVERY not loss', () => {
    const many = Array.from({ length: MESSAGE_CURSOR_TIE_LIMIT + 25 }, (_, i) =>
      row(`id-${i}`, T1),
    )
    const cursor = cursorOver(many)
    expect(cursor.ids).toHaveLength(MESSAGE_CURSOR_TIE_LIMIT)
    // The ids that fell off come back as "unseen" — a duplicate mergeMessages
    // discards, never a gap.
    const redelivered = unseenRows(cursor, many)
    expect(redelivered).toHaveLength(25)
    expect(mergeMessages(many, redelivered)).toHaveLength(many.length)
  })
})

describe('the idle room genuinely reports zero activity', () => {
  it('yields NO unseen rows when nothing has been said', () => {
    const log = [row('a', T0), row('b', T1)]
    const cursor = cursorOver(log)
    // The inclusive wire bound re-reads the boundary row every tick…
    for (let tick = 0; tick < 100; tick += 1) {
      expect(unseenRows(cursor, [row('b', T1)])).toEqual([])
    }
  })

  it('lets the backoff engage — this is the whole load fix', () => {
    // A quiet room whose idle clock is NOT reset by its own echo drops to the
    // slow cadence. Under the old inclusive-only cursor `lastRowAt` was pushed
    // forward on every tick, so this branch was unreachable.
    const openedAt = 1_000_000
    const quietFor = MESSAGE_IDLE_AFTER_MS + 1
    const now = openedAt + quietFor

    const gate = { visible: true, lastPollAt: now, lastRowAt: openedAt }
    expect(shouldPollMessages({ ...gate, now: now + MESSAGE_POLL_MS })).toBe(false)
    expect(shouldPollMessages({ ...gate, now: now + MESSAGE_IDLE_POLL_MS })).toBe(true)
  })

  it('counts a real message as activity and returns to the fast cadence', () => {
    const cursor = cursorOver([row('a', T1)])
    const fresh = unseenRows(cursor, [row('a', T1), row('b', T2, { content: 'gg' })])
    expect(fresh.map((m) => m.id)).toEqual(['b'])
    // Fresh rows exist → the surface resets lastRowAt → fast cadence again.
    const gate = { visible: true, lastPollAt: 1_000_000, lastRowAt: 1_000_000 }
    expect(shouldPollMessages({ ...gate, now: 1_000_000 + MESSAGE_POLL_MS })).toBe(true)
  })

  it("does not treat the SENDER'S OWN optimistic line as incoming traffic", () => {
    // The surface's list feeds the cursor, so a message the user just sent is
    // already "delivered" before the poll ever echoes it back.
    const mine = row('mine-1', T1, { user_id: 'me', content: 'gg' })
    const cursor = cursorOver([mine])
    expect(unseenRows(cursor, [mine])).toEqual([])
  })
})

describe('orderOldestFirst — a room opens at the END, not the beginning', () => {
  it('flips a newest-first backfill window into reading order', () => {
    const newestFirst = [row('c', T2), row('b', T1), row('a', T0)]
    expect(orderOldestFirst(newestFirst).map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts rather than reverses, so a backend that ignored the order is still correct', () => {
    expect(orderOldestFirst([row('b', T1), row('c', T2), row('a', T0)]).map((m) => m.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('is stable for rows that share a timestamp', () => {
    const tied = [row('x', T1), row('y', T1), row('z', T1)]
    expect(orderOldestFirst(tied).map((m) => m.id)).toEqual(['x', 'y', 'z'])
  })

  it('handles an empty window', () => {
    expect(orderOldestFirst([])).toEqual([])
  })
})

describe('a 5,000-message channel opens instantly and replays NOTHING', () => {
  /**
   * The end-to-end shape of defect 4. A long-lived channel is backfilled, then
   * polled. The assertions are the ones a user would notice: the room opens on
   * RECENT messages, and no historical row is ever handed to the surface as an
   * arrival (which is what fires auto-scroll and the "new messages" divider).
   */
  const BACKLOG = 5_000
  const WINDOW = 100
  const base = Date.parse('2026-01-01T00:00:00.000Z')
  const history: Row[] = Array.from({ length: BACKLOG }, (_, i) =>
    row(`m-${i}`, new Date(base + i * 60_000).toISOString(), { content: `line ${i}` }),
  )

  /** The tail read every surface now issues: newest N, flipped for rendering. */
  const backfill = () => orderOldestFirst(history.slice(-WINDOW).reverse())

  it('opens on the NEWEST window, not the first messages ever sent', () => {
    const opened = backfill()
    expect(opened).toHaveLength(WINDOW)
    expect(opened[0].id).toBe(`m-${BACKLOG - WINDOW}`)
    expect(opened[opened.length - 1].id).toBe(`m-${BACKLOG - 1}`)
    // The ancient history is simply not present — nothing to replay.
    expect(opened.some((m) => m.id === 'm-0')).toBe(false)
  })

  it('hands the surface ZERO rows on every tick until somebody actually speaks', () => {
    const opened = backfill()
    let cursor = cursorOver(opened)
    // The server keeps answering the inclusive bound with the boundary row.
    const serverAnswer = () => history.filter((m) => m.created_at! >= cursor.at!)

    let delivered = 0
    for (let tick = 0; tick < 200; tick += 1) {
      const fresh = unseenRows(cursor, serverAnswer())
      delivered += fresh.length
      cursor = advanceCursor(cursor, fresh)
    }
    // 200 ticks — over 16 minutes at the fast cadence — and not one replayed
    // line. Before the fix this walked forward 60 rows per tick.
    expect(delivered).toBe(0)
  })

  it('delivers a genuinely new message, and only that one', () => {
    const opened = backfill()
    let cursor = cursorOver(opened)
    const arrival = row('new-1', new Date(base + BACKLOG * 60_000).toISOString(), {
      content: 'gg wp',
    })
    const withArrival = [...history, arrival]

    const fresh = unseenRows(cursor, withArrival.filter((m) => m.created_at! >= cursor.at!))
    expect(fresh.map((m) => m.id)).toEqual(['new-1'])

    cursor = advanceCursor(cursor, fresh)
    const merged = mergeMessages(opened, fresh, (m) => m.content ?? '')
    expect(merged).toHaveLength(WINDOW + 1)
    expect(merged[merged.length - 1].id).toBe('new-1')
    // …and the room goes quiet again immediately.
    expect(unseenRows(cursor, withArrival.filter((m) => m.created_at! >= cursor.at!))).toEqual([])
  })
})
