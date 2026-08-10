/* eslint-disable @typescript-eslint/no-explicit-any */
// LIVE STREAMS TTL + HOST-CURATED ANGLES.
//
//  1. A stale is_live=true live_streams row (no recent heartbeat) is expired
//     BEFORE the go-live conflict check, so a host whose old session never ended
//     is not blocked from going live again — and it drops off the public "who is
//     live now" read.
//  2. A live heartbeat keeps a genuinely-active stream fresh, so a fresh row DOES
//     still block a second concurrent start.
//  3. The host assembles a multi-angle show: only the OWNER of the parent
//     live_streams row may add/remove angles; an added player's linked YouTube is
//     resolved automatically; angles are public to read.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'
import type { Placement } from '../src/lib/tiers'

const ADULT_DOB = '1995-06-15'
type Who = { token: string; id: string }

async function signUp(app: any, name: string): Promise<Who> {
  const r = await request(app).post('/api/auth/signup').send({
    email: `${name}@live-angles.test`,
    password: 'password123',
    username: name,
    date_of_birth: ADULT_DOB,
  })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}

function db(app: any, who: Who | null, body: any) {
  const r = request(app).post('/api/db').send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

function fn(app: any, who: Who | null, name: string, body: any) {
  const r = request(app).post(`/api/fn/${name}`).send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

async function setTier(pool: any, userId: string, tier: string) {
  const current = await pool.query('select user_metadata from users where id=$1', [userId])
  const meta = current.rows[0]?.user_metadata || {}
  meta.reelone_tier = tier
  meta.reelone_tier_expires = null
  await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), userId])
}

async function allowLiveReuse(pool: any, userId: string) {
  await pool.query("update profiles set reel_usage_privacy='lives' where id=$1", [userId])
}

async function startStream(app: any, who: Who, placement: Placement = 'profile', extra: any = {}) {
  return db(app, who, {
    table: 'live_streams',
    action: 'insert',
    single: true,
    values: {
      youtube_url: 'https://youtu.be/dQw4w9WgXcQ',
      title: `${placement} stream`,
      placement,
      is_live: true,
      ...extra,
    },
  })
}

describe('live_streams stale TTL — unblocks going live + hides stale lives', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let alice: Who

  beforeAll(async () => {
    alice = await signUp(app, 'ttl_alice')
    await setTier(pool, alice.id, 'pro')
  })
  afterAll(async () => { await pool.end() })

  it('a fresh active stream still blocks a second concurrent start', async () => {
    const first = await startStream(app, alice)
    expect(first.status).toBe(200)
    const blocked = await startStream(app, alice)
    expect(blocked.status).toBe(409)
  })

  it('a stale active stream is expired, so the host can go live again', async () => {
    // Backdate the live row past the TTL — a session that never refreshed.
    await pool.query(
      "update live_streams set updated_at = now() - interval '2 hours', created_at = now() - interval '2 hours' where user_id=$1 and is_live=true",
      [alice.id],
    )
    const again = await startStream(app, alice)
    expect(again.status).toBe(200)
    // Exactly one live row remains — the stale one was flipped to is_live=false.
    const active = await pool.query('select id from live_streams where user_id=$1 and is_live=true', [alice.id])
    expect(active.rows).toHaveLength(1)
  })

  it('a public live_streams read expires stale rows so LIVE NOW is honest', async () => {
    // Make every one of alice's rows stale again.
    await pool.query("update live_streams set updated_at = now() - interval '2 hours' where user_id=$1", [alice.id])
    const read = await db(app, null, { table: 'live_streams', action: 'select', columns: '*' })
    expect(read.status).toBe(200)
    // After the read-side cleanup no row is still flagged live.
    const stillLive = await pool.query('select id from live_streams where user_id=$1 and is_live=true', [alice.id])
    expect(stillLive.rows).toHaveLength(0)
  })

  it('a heartbeat keeps a stream fresh, so it still blocks a duplicate start', async () => {
    const started = await startStream(app, alice)
    expect(started.status).toBe(200)
    const streamId = started.body.data.id
    // Age it out, then heartbeat it back to fresh.
    await pool.query("update live_streams set updated_at = now() - interval '2 hours' where id=$1", [streamId])
    const beat = await fn(app, alice, 'live-heartbeat', { streamId })
    expect(beat.status).toBe(200)
    expect(beat.body.updated).toBe(1)
    // A fresh live row must still block a second concurrent start.
    const blocked = await startStream(app, alice)
    expect(blocked.status).toBe(409)
  })
})

describe('live_streams phantom cleanup — unattached / no-heartbeat lives die within 60s', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let host: Who

  beforeAll(async () => {
    host = await signUp(app, 'phantom_host')
    await setTier(pool, host.id, 'pro')
  })
  afterAll(async () => { await pool.end() })

  it('an is_live row with no attached link and no recent heartbeat no longer blocks go-live nor appears live', async () => {
    // A phantom "active stream": is_live=true but nothing playable was ever
    // attached (no youtube_url) and it never heartbeated. Insert directly (the
    // public API requires a link), then age it past the ~60s window via UPDATE.
    const ins = await pool.query(
      "insert into live_streams (user_id, youtube_url, title, placement, is_live) " +
        "values ($1, '', 'phantom', 'profile', true) returning id",
      [host.id],
    )
    const phantomId = ins.rows[0].id
    // Age it well past the ~60s window (the cutoff is 60s; 2h is unambiguous).
    await pool.query(
      "update live_streams set updated_at = now() - interval '2 hours', created_at = now() - interval '2 hours' where id=$1",
      [phantomId],
    )

    // A public read runs the cleanup: the phantom is flipped to is_live=false, so
    // the frontend (which shows only is_live !== false) drops it from LIVE NOW.
    const read = await db(app, null, { table: 'live_streams', action: 'select', columns: '*' })
    expect(read.status).toBe(200)
    const phantomCard = read.body.data.find((s: any) => s.id === phantomId)
    expect(phantomCard == null || phantomCard.is_live === false).toBe(true)
    const row = await pool.query('select is_live from live_streams where id=$1', [phantomId])
    expect(row.rows[0].is_live).toBe(false)

    // ...and it no longer blocks the host from going live for real.
    const again = await startStream(app, host)
    expect(again.status).toBe(200)
  })

  it('a freshly-heartbeating attached stream survives the cleanup', async () => {
    // Ensure the host has exactly one attached, live stream to exercise.
    let active = await pool.query('select id from live_streams where user_id=$1 and is_live=true', [host.id])
    if (active.rows.length === 0) {
      const s = await startStream(app, host)
      expect(s.status).toBe(200)
      active = await pool.query('select id from live_streams where user_id=$1 and is_live=true', [host.id])
    }
    expect(active.rows.length).toBe(1)
    const id = active.rows[0].id
    await pool.query("update live_streams set updated_at = now() - interval '5 minutes' where id=$1", [id])
    const beat = await fn(app, host, 'live-heartbeat', { streamId: id })
    expect(beat.status).toBe(200)
    expect(beat.body.updated).toBe(1)
    // A public read (which runs the cleanup) still shows it as live.
    const read = await db(app, null, { table: 'live_streams', action: 'select', columns: '*' })
    const card = read.body.data.find((s: any) => s.id === id && s.is_live !== false)
    expect(card).toBeTruthy()
    // Bug #1: the public read carries the HOST PROFILE (real username + avatar)
    // so LIVE NOW cards render a name, not a raw user id.
    expect(card.profiles).toBeTruthy()
    expect(card.profiles.username).toBe('phantom_host')
    expect(card.profiles).toHaveProperty('avatar_url')
  })
})

describe('live_streams Go Live config — new fields round-trip', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let host: Who

  beforeAll(async () => {
    host = await signUp(app, 'config_host')
    await setTier(pool, host.id, 'pro')
  })
  afterAll(async () => { await pool.end() })

  it('persists chat/access/host-share/look/layout on go-live and reads them back', async () => {
    const started = await startStream(app, host, 'profile', {
      chat_enabled: false,
      is_paid: true,
      price_cents: 499,
      host_share: 'video',
      background_url: 'https://cdn.tko.cam/bg/leaf.png',
      team_a: 'Leaf',
      team_b: 'Sand',
      layout: 'host_top_chat_right',
    })
    expect(started.status).toBe(200)
    const row = started.body.data
    // The insert returns the stored row — every new column round-trips.
    expect(row.chat_enabled).toBe(false)
    expect(row.is_paid).toBe(true)
    expect(row.price_cents).toBe(499)
    expect(row.host_share).toBe('video')
    expect(row.background_url).toBe('https://cdn.tko.cam/bg/leaf.png')
    expect(row.team_a).toBe('Leaf')
    expect(row.team_b).toBe('Sand')
    expect(row.layout).toBe('host_top_chat_right')

    // And they're the real persisted values, not just the echo.
    const back = await pool.query(
      'select chat_enabled, is_paid, price_cents, host_share, team_a, team_b, layout from live_streams where id=$1',
      [row.id],
    )
    expect(back.rows[0]).toMatchObject({
      chat_enabled: false,
      is_paid: true,
      price_cents: 499,
      host_share: 'video',
      team_a: 'Leaf',
      team_b: 'Sand',
      layout: 'host_top_chat_right',
    })
  })

  it('defaults are applied for a plain go-live (free, chat on, auto layout)', async () => {
    // Age out the previous live so this host can start again.
    await pool.query(
      "update live_streams set updated_at = now() - interval '2 hours' where user_id=$1",
      [host.id],
    )
    const started = await startStream(app, host)
    expect(started.status).toBe(200)
    const row = started.body.data
    expect(row.chat_enabled).toBe(true)
    expect(row.is_paid).toBe(false)
    expect(row.host_share).toBe('both')
    expect(row.layout).toBe('auto')
  })
})

describe('live_stream_angles — host-curated multi-angle show', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let host: Who
  let player: Who
  let stranger: Who
  let streamId = ''

  beforeAll(async () => {
    host = await signUp(app, 'angle_host')
    player = await signUp(app, 'angle_player')
    stranger = await signUp(app, 'angle_stranger')
    await setTier(pool, host.id, 'pro')
    await allowLiveReuse(pool, player.id)
    // The added player has a linked YouTube handle to resolve automatically.
    await pool.query('insert into user_youtube_links (user_id, url) values ($1,$2)', [
      player.id,
      'https://www.youtube.com/@angle_player',
    ])
    const started = await startStream(app, host)
    expect(started.status).toBe(200)
    streamId = started.body.data.id
  })
  afterAll(async () => { await pool.end() })

  it('the host adds a player angle, resolving the player\'s linked YouTube', async () => {
    const r = await fn(app, host, 'live-angle-add', { liveStreamId: streamId, userId: player.id })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.angle.user_id).toBe(player.id)
    expect(r.body.angle.youtube_url).toBe('https://www.youtube.com/@angle_player')
    expect(r.body.angle.label).toBe('angle_player')
  })

  it('a non-host cannot add an angle to someone else\'s show', async () => {
    const r = await fn(app, stranger, 'live-angle-add', {
      liveStreamId: streamId,
      youtubeUrl: 'https://youtu.be/abcdefghijk',
    })
    expect(r.status).toBe(403)
  })

  it('angles are public to read so viewers can switch between them', async () => {
    const r = await db(app, null, {
      table: 'live_stream_angles',
      action: 'select',
      columns: '*',
      filters: [{ col: 'live_stream_id', op: 'eq', val: streamId }],
    })
    expect(r.status).toBe(200)
    expect(r.body.data.length).toBe(1)
    expect(r.body.data[0].user_id).toBe(player.id)
  })

  it('the host adds a pasted-url angle with no player id', async () => {
    const r = await fn(app, host, 'live-angle-add', {
      liveStreamId: streamId,
      youtubeUrl: 'https://youtu.be/abcdefghijk',
      label: 'Overhead cam',
    })
    expect(r.status).toBe(200)
    expect(r.body.angle.youtube_url).toBe('https://youtu.be/abcdefghijk')
    expect(r.body.angle.label).toBe('Overhead cam')
  })

  it('re-adding the same player refreshes the angle in place (no duplicate)', async () => {
    await pool.query('update user_youtube_links set url=$1 where user_id=$2', [
      'https://www.youtube.com/@angle_player/live',
      player.id,
    ])
    const r = await fn(app, host, 'live-angle-add', { liveStreamId: streamId, userId: player.id })
    expect(r.status).toBe(200)
    const rows = await pool.query(
      'select id from live_stream_angles where live_stream_id=$1 and user_id=$2',
      [streamId, player.id],
    )
    expect(rows.rows).toHaveLength(1)
  })

  it('only the host may remove an angle, and removal clears it', async () => {
    const list = await db(app, null, {
      table: 'live_stream_angles',
      action: 'select',
      columns: '*',
      filters: [{ col: 'live_stream_id', op: 'eq', val: streamId }],
    })
    const anAngle = list.body.data[0]
    const denied = await fn(app, stranger, 'live-angle-remove', { angleId: anAngle.id })
    expect(denied.status).toBe(403)

    const removed = await fn(app, host, 'live-angle-remove', { angleId: anAngle.id })
    expect(removed.status).toBe(200)
    expect(removed.body.removed).toBe(1)

    const after = await pool.query('select id from live_stream_angles where id=$1', [anAngle.id])
    expect(after.rows).toHaveLength(0)
  })
})
