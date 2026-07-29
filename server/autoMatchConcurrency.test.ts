/* eslint-disable @typescript-eslint/no-explicit-any */
// Two angles of one match landing AT THE SAME INSTANT must converge to exactly
// ONE match group + ONE render job — not two of each from a create race.
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { makeDb, entitleForAutoMerge } from './testHarness'
import { createApp } from './app'

const ADULT_DOB = '1995-06-15'
async function signUp(app: any, email: string, username: string) {
  const r = await request(app).post('/api/auth/signup').send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}
async function addClip(app: any, who: any, v: Record<string, any>) {
  const r = await request(app).post('/api/db').set('Authorization', `Bearer ${who.token}`)
    .send({ table: 'clip_records', action: 'insert', single: true, values: { player_id: who.id, ...v } })
  expect(r.status).toBe(200)
  return r.body.data.id
}

describe('auto-match — concurrent trigger convergence', () => {
  it('two simultaneous triggers for the same match make one group + one job', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const alice = await signUp(app, 'a@kc.gg', 'alice')
    const bob = await signUp(app, 'b@kc.gg', 'bob')
    // The auto-merge pipeline is server-gated to paying CONTENT-tier members
    // with YouTube connected; entitle both triggers so the race is exercised.
    await entitleForAutoMerge(pool, alice.id)
    await entitleForAutoMerge(pool, bob.id)
    const t0 = new Date('2026-07-20T18:00:00Z').getTime()
    const lobby = 'lobby-concurrent'
    const aClip = await addClip(app, alice, { player_handle: 'alice', lobby_id: lobby, recorded_at: new Date(t0).toISOString(), duration_sec: 300 })
    const bClip = await addClip(app, bob, { player_handle: 'bob', lobby_id: lobby, recorded_at: new Date(t0 + 60_000).toISOString(), duration_sec: 300 })

    // Fire both at once.
    const [ra, rb] = await Promise.all([
      request(app).post('/api/fn/auto-match').set('Authorization', `Bearer ${alice.token}`).send({ clipRecordId: aClip }),
      request(app).post('/api/fn/auto-match').set('Authorization', `Bearer ${bob.token}`).send({ clipRecordId: bClip }),
    ])
    expect(ra.body.matched).toBe(true)
    expect(rb.body.matched).toBe(true)

    const groups = await pool.query('select count(*)::int n from match_groups')
    expect(Number(groups.rows[0].n)).toBe(1)
    const jobs = await pool.query('select count(*)::int n from render_jobs')
    expect(Number(jobs.rows[0].n)).toBe(1)
    // Both clips carry the same one match id.
    const mids = await pool.query('select distinct match_id from clip_records where match_id is not null')
    expect(mids.rows.length).toBe(1)
  })
})
