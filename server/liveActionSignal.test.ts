/* eslint-disable @typescript-eslint/no-explicit-any */
// LIVE ACTION SIGNAL — the PC-side live director's two internal endpoints:
//   GET  /api/internal/live-shows   (which multi-cam shows are on air now)
//   POST /api/internal/live-action  (per-feed action scores 0-100)
// Proves: both endpoints fail CLOSED (no key / wrong key / TKO_SERVICE_KEY
// unset → 401), the live-shows list has the exact shape the watcher consumes
// and excludes stale-heartbeat streams, and live-action writes
// action_level/action_at + host_action_level/host_action_at with unknown ids
// ignored and out-of-range scores refused.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { makeDb } from './testHarness'
import { createApp } from './app'

const SERVICE_KEY = 'test-live-action-key'
const previousServiceKey = process.env.TKO_SERVICE_KEY

async function seedUser(pool: any, username: string): Promise<string> {
  const u = await pool.query(
    'insert into users (email, user_metadata) values ($1,$2) returning id',
    [`${username}@kc.gg`, JSON.stringify({ username })],
  )
  const id = u.rows[0].id
  await pool.query('insert into profiles (id, username) values ($1,$2)', [id, username])
  return id
}

async function seedShow(pool: any, hostId: string, url = 'https://www.youtube.com/watch?v=host1234567') {
  const s = await pool.query(
    'insert into live_streams (user_id, youtube_url, is_live) values ($1,$2,true) returning id',
    [hostId, url],
  )
  return s.rows[0].id as string
}

async function seedAngle(pool: any, streamId: string, userId: string | null, url: string, status = 'live') {
  const a = await pool.query(
    'insert into live_stream_angles (live_stream_id, user_id, youtube_url, status) values ($1,$2,$3,$4) returning id',
    [streamId, userId, url, status],
  )
  return a.rows[0].id as string
}

describe('INTERNAL live action signal (/api/internal/live-shows + /live-action)', () => {
  let app: any
  let pool: any
  beforeEach(() => {
    process.env.TKO_SERVICE_KEY = SERVICE_KEY
    pool = makeDb()
    app = createApp(pool)
  })
  afterEach(() => {
    if (previousServiceKey === undefined) delete process.env.TKO_SERVICE_KEY
    else process.env.TKO_SERVICE_KEY = previousServiceKey
  })

  it('fails closed: no key, wrong key, and unset TKO_SERVICE_KEY are all 401', async () => {
    // No header at all.
    expect((await request(app).get('/api/internal/live-shows')).status).toBe(401)
    expect((await request(app).post('/api/internal/live-action').send({})).status).toBe(401)
    // Wrong key.
    expect((await request(app).get('/api/internal/live-shows').set('x-tko-service', 'nope')).status).toBe(401)
    expect((await request(app).post('/api/internal/live-action').set('x-tko-service', 'nope').send({})).status).toBe(401)
    // TKO_SERVICE_KEY unset entirely → refused even with an empty header (fail closed).
    delete process.env.TKO_SERVICE_KEY
    expect((await request(app).get('/api/internal/live-shows').set('x-tko-service', '')).status).toBe(401)
    expect((await request(app).post('/api/internal/live-action').set('x-tko-service', '').send({})).status).toBe(401)
  })

  it('lists active shows in the watcher shape and drops stale-heartbeat streams', async () => {
    const hostId = await seedUser(pool, 'showhost')
    const playerId = await seedUser(pool, 'angleplayer')
    const streamId = await seedShow(pool, hostId)
    const liveAngle = await seedAngle(pool, streamId, playerId, 'https://www.youtube.com/watch?v=angle123456', 'live')
    const stoppedAngle = await seedAngle(pool, streamId, null, 'https://www.youtube.com/watch?v=angle654321', 'stopped')

    // A second show whose heartbeat went stale (attached TTL is ~60 min) must
    // NOT be returned — the stale-live sweep flips it dead before the read.
    const staleHost = await seedUser(pool, 'ghosthost')
    const staleId = await seedShow(pool, staleHost)
    await pool.query("update live_streams set updated_at = now() - interval '90 minutes' where id=$1", [staleId])

    const r = await request(app).get('/api/internal/live-shows').set('x-tko-service', SERVICE_KEY)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.shows).toHaveLength(1)

    const show = r.body.shows[0]
    expect(show).toMatchObject({
      stream_id: streamId,
      host_user_id: hostId,
      host_youtube_url: 'https://www.youtube.com/watch?v=host1234567',
    })
    expect(show.angles).toHaveLength(2)
    expect(show.angles[0]).toMatchObject({
      angle_id: liveAngle,
      user_id: playerId,
      youtube_url: 'https://www.youtube.com/watch?v=angle123456',
      status: 'live',
    })
    expect(show.angles[1]).toMatchObject({ angle_id: stoppedAngle, status: 'stopped' })
  })

  it('writes host + angle action levels, ignores unknown ids, reports counts', async () => {
    const hostId = await seedUser(pool, 'actionhost')
    const streamId = await seedShow(pool, hostId)
    const angleId = await seedAngle(pool, streamId, null, 'https://www.youtube.com/watch?v=angleaaa111')

    const r = await request(app)
      .post('/api/internal/live-action')
      .set('x-tko-service', SERVICE_KEY)
      .send({
        stream_id: streamId,
        host_action: 40,
        host_fight: { detected: true, mode: 'base' },
        angles: [
          { angle_id: angleId, action: 95, fight: { detected: true, mode: 'combat-or-barrier' } },
          { angle_id: randomUUID(), action: 50 }, // unknown — ignored
        ],
      })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ ok: true, host_updated: 1, angles_updated: 1 })

    const host = (await pool.query(
      'select host_action_level, host_action_at, host_fight_detected, host_fight_mode, host_fight_at from live_streams where id=$1',
      [streamId],
    )).rows[0]
    expect(host.host_action_level).toBe(40)
    expect(host.host_action_at).toBeTruthy()
    expect(host.host_fight_detected).toBe(true)
    expect(host.host_fight_mode).toBe('base')
    expect(host.host_fight_at).toBeTruthy()
    const angle = (await pool.query(
      'select action_level, action_at, fight_detected, fight_mode, fight_at from live_stream_angles where id=$1',
      [angleId],
    )).rows[0]
    expect(angle.action_level).toBe(95)
    expect(angle.action_at).toBeTruthy()
    expect(angle.fight_detected).toBe(true)
    expect(angle.fight_mode).toBe('combat-or-barrier')
    expect(angle.fight_at).toBeTruthy()
  })

  it('scopes angle writes to the named stream (no cross-show writes)', async () => {
    const hostA = await seedUser(pool, 'hosta')
    const hostB = await seedUser(pool, 'hostb')
    const streamA = await seedShow(pool, hostA, 'https://www.youtube.com/watch?v=hostaaaa111')
    const streamB = await seedShow(pool, hostB, 'https://www.youtube.com/watch?v=hostbbbb222')
    const angleB = await seedAngle(pool, streamB, null, 'https://www.youtube.com/watch?v=anglebbb222')

    // Naming stream A but B's angle must write NOTHING.
    const r = await request(app)
      .post('/api/internal/live-action')
      .set('x-tko-service', SERVICE_KEY)
      .send({ stream_id: streamA, angles: [{ angle_id: angleB, action: 99 }] })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, host_updated: 0, angles_updated: 0 })
    const angle = (await pool.query('select action_level from live_stream_angles where id=$1', [angleB])).rows[0]
    expect(angle.action_level).toBeNull()
  })

  it('refuses malformed batches: missing stream_id, out-of-range or non-integer scores', async () => {
    const hostId = await seedUser(pool, 'strictHost')
    const streamId = await seedShow(pool, hostId)
    const angleId = await seedAngle(pool, streamId, null, 'https://www.youtube.com/watch?v=anglestrict')

    const key = (req: request.Test) => req.set('x-tko-service', SERVICE_KEY)
    expect((await key(request(app).post('/api/internal/live-action')).send({})).status).toBe(400)
    expect((await key(request(app).post('/api/internal/live-action')).send({ stream_id: streamId, host_action: 101 })).status).toBe(400)
    expect((await key(request(app).post('/api/internal/live-action')).send({ stream_id: streamId, host_action: -1 })).status).toBe(400)
    expect((await key(request(app).post('/api/internal/live-action')).send({ stream_id: streamId, host_action: 55.5 })).status).toBe(400)
    expect((await key(request(app).post('/api/internal/live-action')).send({ stream_id: streamId, host_fight: { detected: true, mode: 'boss-rush' } })).status).toBe(400)
    expect((await key(request(app).post('/api/internal/live-action')).send({ stream_id: streamId, host_fight: { detected: false, mode: 'flag' } })).status).toBe(400)
    expect((await key(request(app).post('/api/internal/live-action')).send({ stream_id: streamId, angles: [{ angle_id: angleId, action: 'hot' }] })).status).toBe(400)
    expect((await key(request(app).post('/api/internal/live-action')).send({ stream_id: streamId, angles: [{ action: 50 }] })).status).toBe(400)
    expect((await key(request(app).post('/api/internal/live-action')).send({ stream_id: streamId, angles: [{ angle_id: angleId, action: 50, fight: { detected: true, mode: '' } }] })).status).toBe(400)
    // Nothing was written by any refused batch.
    const host = (await pool.query('select host_action_level from live_streams where id=$1', [streamId])).rows[0]
    expect(host.host_action_level).toBeNull()
  })
})
