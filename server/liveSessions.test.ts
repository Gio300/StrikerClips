/* eslint-disable @typescript-eslint/no-explicit-any */
// LIVE SESSIONS (live_sessions) + the produced-video read path (clip_records
// with a youtube_id). Pins down the TABLE_POLICY for the unified "who's live"
// indicator: reads are PUBLIC (a session nobody can see is not live), host_id is
// FORCED to the caller on insert, and only the owner (or a global host) may end
// their own session. Also verifies that a produced video — a clip_records row
// carrying a youtube_id — is publicly readable, which is what the Recent feed
// and a player's "My Clips" produced section read.
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { makeApp } from './testHarness'

const ADULT_DOB = '1995-06-15'

type Who = { token: string; id: string }

async function signUp(app: any, email: string, username: string): Promise<Who> {
  const r = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}

/** POST /api/db as a given user (or anonymously when `who` is null). */
function db(app: any, who: Who | null, body: any) {
  const r = request(app).post('/api/db').send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

describe('live_sessions — the unified "who is live right now" indicator', () => {
  const app = makeApp()
  let alice: Who
  let bob: Who
  let sessionId = ''

  it('sets up two plain users', async () => {
    alice = await signUp(app, 'alice@live.gg', 'alice_live')
    bob = await signUp(app, 'bob@live.gg', 'bob_live')
  })

  it('an anonymous caller cannot mark anyone live', async () => {
    const r = await db(app, null, {
      table: 'live_sessions', action: 'insert', single: true,
      values: { kind: 'host', title: 'nope', status: 'live' },
    })
    expect(r.status).toBe(401)
  })

  it('a signed-in user marks themselves live; host_id is FORCED to the caller', async () => {
    const r = await db(app, alice, {
      table: 'live_sessions', action: 'insert', single: true,
      // Try to attribute the session to bob — the server must overwrite host_id.
      values: { kind: 'host', title: 'Alice goes live', status: 'live', host_id: bob.id, watch_url: 'https://youtu.be/live1' },
    })
    expect(r.status).toBe(200)
    expect(r.body.error).toBeNull()
    expect(r.body.data.host_id).toBe(alice.id)
    expect(r.body.data.status).toBe('live')
    expect(r.body.data.kind).toBe('host')
    sessionId = r.body.data.id
  })

  it('reads are public — anyone (signed out) sees who is live', async () => {
    const r = await db(app, null, {
      table: 'live_sessions', action: 'select', columns: '*',
      filters: [{ col: 'status', op: 'eq', val: 'live' }],
    })
    expect(r.status).toBe(200)
    expect(r.body.data.length).toBe(1)
    expect(r.body.data[0].id).toBe(sessionId)
    expect(r.body.data[0].host_id).toBe(alice.id)
  })

  it('a different user cannot end someone else\'s session', async () => {
    const r = await db(app, bob, {
      table: 'live_sessions', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: sessionId }],
      values: { status: 'ended' },
    })
    expect(r.status).toBe(403)
  })

  it('the owner ends their own session — it stops counting as live', async () => {
    const end = await db(app, alice, {
      table: 'live_sessions', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: sessionId }],
      values: { status: 'ended', ended_at: new Date().toISOString() },
    })
    expect(end.status).toBe(200)
    expect(end.body.data.status).toBe('ended')

    // The "who's live" query (status='live') now returns nothing.
    const live = await db(app, null, {
      table: 'live_sessions', action: 'select', columns: '*',
      filters: [{ col: 'status', op: 'eq', val: 'live' }],
    })
    expect(live.status).toBe(200)
    expect(live.body.data.length).toBe(0)
  })
})

describe('produced videos — a clip_records row with a youtube_id is public', () => {
  const app = makeApp()
  let alice: Who
  const YID = 'dQw4w9WgXcQ'

  it('sets up a user and records a produced clip', async () => {
    alice = await signUp(app, 'alice@vid.gg', 'alice_vid')
    // A produced video: the render worker stamps youtube_id onto each angle's
    // clip_records row. Through the API player_id is forced to the caller.
    const r = await db(app, alice, {
      table: 'clip_records', action: 'insert', single: true,
      values: { youtube_id: YID, player_handle: 'AliceMain', map: 'Hidden Leaf', mode: 'Flag', player_id: 'ignored' },
    })
    expect(r.status).toBe(200)
    expect(r.body.data.youtube_id).toBe(YID)
    expect(r.body.data.player_id).toBe(alice.id)
  })

  it('anyone (signed out) can read the produced video from the public catalogue', async () => {
    const r = await db(app, null, {
      table: 'clip_records', action: 'select', columns: 'youtube_id, player_id, player_handle, map, mode',
      filters: [{ col: 'youtube_id', op: 'eq', val: YID }],
    })
    expect(r.status).toBe(200)
    expect(r.body.data.length).toBe(1)
    expect(r.body.data[0].player_handle).toBe('AliceMain')
  })
})
