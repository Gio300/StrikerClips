/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

/**
 * The SERVER half of "chat is actually live" (src/hooks/useChatMessages.ts).
 *
 * The client polls incrementally: same /api/db read, plus a `created_at` cursor
 * filter. No new route was added for it, so what these tests protect is that the
 * generic data API keeps honouring that shape — a `gte` on created_at, ordered
 * ascending, bounded by a limit — for every one of the four message tables.
 * If any of that regresses, every chat surface silently goes back to being a
 * frozen list, which is precisely the failure this slice exists to remove.
 */

const ADULT_DOB = '1995-06-15'

type Who = { token: string; id: string }

async function signUp(app: any, email: string, username: string): Promise<Who> {
  const response = await request(app).post('/api/auth/signup').send({
    email,
    password: 'password123',
    username,
    date_of_birth: ADULT_DOB,
  })
  expect(response.status).toBe(200)
  return { token: response.body.token, id: response.body.user.id }
}

function db(app: any, who: Who | null, body: any) {
  const call = request(app).post('/api/db')
  if (who) call.set('Authorization', `Bearer ${who.token}`)
  return call.send(body)
}

/** Exactly the read useChatMessages issues for one room. */
function pollRead(table: string, roomCol: string, roomId: string, cursor: string | null) {
  const filters: any[] = [{ col: roomCol, op: 'eq', val: roomId }]
  if (cursor) filters.push({ col: 'created_at', op: 'gte', val: cursor })
  return {
    table,
    action: 'select',
    columns: '*',
    filters,
    order: { column: 'created_at', ascending: true },
    limit: 60,
  }
}

const STREAM_ID = '33333333-4444-4555-8666-777777777777'

describe('incremental message read — the chat poll', () => {
  let pool: any
  let app: any
  let alice: Who
  let bob: Who

  beforeEach(async () => {
    pool = makeDb()
    app = createApp(pool)
    alice = await signUp(app, 'poll-alice@tko.cam', 'poll_alice')
    bob = await signUp(app, 'poll-bob@tko.cam', 'poll_bob')
  })

  /** Write one message straight to the table with a chosen timestamp. */
  async function say(userId: string, content: string, at: string) {
    const inserted = await pool.query(
      'insert into stream_messages (stream_id, user_id, content, created_at) values ($1,$2,$3,$4) returning id',
      [STREAM_ID, userId, content, at],
    )
    return inserted.rows[0].id as string
  }

  it('a SECOND CLIENT’s message arrives on the next poll, with no remount', async () => {
    await say(alice.id, 'first', '2026-08-04T10:00:00.000Z')

    // Alice opens the room: full backfill, cursor = the newest row she holds.
    const backfill = await db(app, alice, pollRead('stream_messages', 'stream_id', STREAM_ID, null))
    expect(backfill.status).toBe(200)
    expect(backfill.body.data).toHaveLength(1)
    const cursor = new Date(backfill.body.data[0].created_at).toISOString()

    // Nothing has happened — a tick costs one query and returns only the row
    // the inclusive cursor points at.
    const quiet = await db(app, alice, pollRead('stream_messages', 'stream_id', STREAM_ID, cursor))
    expect(quiet.body.data.map((r: any) => r.content)).toEqual(['first'])

    // Bob says something from another browser.
    await say(bob.id, 'second', '2026-08-04T10:00:07.000Z')

    const tick = await db(app, alice, pollRead('stream_messages', 'stream_id', STREAM_ID, cursor))
    expect(tick.status).toBe(200)
    expect(tick.body.data.map((r: any) => r.content)).toEqual(['first', 'second'])
  })

  it('never re-reads the whole room — the cursor bounds every later tick', async () => {
    for (let i = 0; i < 12; i += 1) {
      await say(alice.id, `line ${i}`, `2026-08-04T10:0${i < 10 ? '0' : '1'}:0${i % 10}.000Z`)
    }
    const all = await db(app, alice, pollRead('stream_messages', 'stream_id', STREAM_ID, null))
    expect(all.body.data.length).toBe(12)

    const newest = new Date(all.body.data[all.body.data.length - 1].created_at).toISOString()
    const tick = await db(app, alice, pollRead('stream_messages', 'stream_id', STREAM_ID, newest))
    // Only the cursor row comes back — an idle room costs one row, not twelve.
    expect(tick.body.data).toHaveLength(1)
  })

  it('returns rows in created_at order so the log never scrambles', async () => {
    await say(alice.id, 'c', '2026-08-04T10:00:30.000Z')
    await say(alice.id, 'a', '2026-08-04T10:00:10.000Z')
    await say(alice.id, 'b', '2026-08-04T10:00:20.000Z')
    const read = await db(app, alice, pollRead('stream_messages', 'stream_id', STREAM_ID, null))
    expect(read.body.data.map((r: any) => r.content)).toEqual(['a', 'b', 'c'])
  })

  it('a SIGNED-OUT viewer can still poll a public room', async () => {
    // Stream/tournament/channel messages are public-read by policy; if this
    // regressed, every logged-out viewer of a live stream would see a dead chat.
    await say(alice.id, 'hello', '2026-08-04T10:00:00.000Z')
    const read = await db(app, null, pollRead('stream_messages', 'stream_id', STREAM_ID, null))
    expect(read.status).toBe(200)
    expect(read.body.data).toHaveLength(1)
  })

  it('honours the same cursor shape on the tournament + channel tables', async () => {
    const tournamentId = '55555555-6666-4777-8888-999999999999'
    const channelId = '66666666-7777-4888-8999-aaaaaaaaaaaa'
    await pool.query(
      'insert into tournament_messages (tournament_id, user_id, content, created_at) values ($1,$2,$3,$4)',
      [tournamentId, alice.id, 'bracket talk', '2026-08-04T10:00:00.000Z'],
    )
    await pool.query(
      'insert into chat_messages (channel_id, user_id, body, created_at) values ($1,$2,$3,$4)',
      [channelId, alice.id, 'channel talk', '2026-08-04T10:00:00.000Z'],
    )

    const tournament = await db(
      app,
      alice,
      pollRead('tournament_messages', 'tournament_id', tournamentId, '2026-08-04T09:00:00.000Z'),
    )
    expect(tournament.status).toBe(200)
    expect(tournament.body.data).toHaveLength(1)

    const channel = await db(
      app,
      alice,
      pollRead('chat_messages', 'channel_id', channelId, '2026-08-04T09:00:00.000Z'),
    )
    expect(channel.status).toBe(200)
    // chat_messages stores the text in `body`, not `content` — the one schema
    // difference the shared client hook has to know about.
    expect(channel.body.data[0].body).toBe('channel talk')
  })

  it('excludes rows OLDER than the cursor', async () => {
    await say(alice.id, 'old', '2026-08-04T10:00:00.000Z')
    await say(alice.id, 'new', '2026-08-04T10:00:30.000Z')
    const read = await db(
      app,
      alice,
      pollRead('stream_messages', 'stream_id', STREAM_ID, '2026-08-04T10:00:15.000Z'),
    )
    expect(read.body.data.map((r: any) => r.content)).toEqual(['new'])
  })
})
