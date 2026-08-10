/* eslint-disable @typescript-eslint/no-explicit-any */
// Auto-match orchestration, end to end through the real API on pg-mem:
// strangers upload angles of one match → the server bunches them, enqueues one
// render job, and notifies everyone — idempotently and only for real matches.
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { makeDb, entitleForAutoMerge } from './testHarness'
import { createApp } from './app'

const ADULT_DOB = '1995-06-15'

type Who = { token: string; id: string }

async function signUp(app: any, email: string, username: string): Promise<Who> {
  const r = await request(app).post('/api/auth/signup').send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}

/** Insert a clip_records row as this user (player_id is forced to them). */
async function addClip(app: any, who: Who, v: Record<string, any>): Promise<string> {
  const r = await request(app)
    .post('/api/db')
    .set('Authorization', `Bearer ${who.token}`)
    .send({ table: 'clip_records', action: 'insert', single: true, values: { player_id: who.id, ...v } })
  expect(r.status).toBe(200)
  return r.body.data.id
}

function fn(app: any, who: Who, name: string, body: any) {
  return request(app).post(`/api/fn/${name}`).set('Authorization', `Bearer ${who.token}`).send(body)
}

describe('auto-match — upload orchestration', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let alice: Who, bob: Who, carol: Who
  const t0 = new Date('2026-07-20T18:00:00Z').getTime()
  const iso = (ms: number) => new Date(ms).toISOString()
  const LOBBY = 'lobby-abc-123'

  it('sets up three entitled players', async () => {
    alice = await signUp(app, 'a@kc.gg', 'alice')
    bob = await signUp(app, 'b@kc.gg', 'bob')
    carol = await signUp(app, 'c@kc.gg', 'carol')
    // The auto-merge pipeline is server-gated to paying CONTENT-tier members
    // with YouTube connected. Entitle all three so the orchestration below runs.
    await entitleForAutoMerge(pool, alice.id)
    await entitleForAutoMerge(pool, bob.id)
    await entitleForAutoMerge(pool, carol.id)
  })

  let aliceClip = ''
  it('a lone clip does not match anything yet', async () => {
    aliceClip = await addClip(app, alice, {
      player_handle: 'alice', lobby_id: LOBBY, recorded_at: iso(t0), duration_sec: 300,
    })
    const r = await fn(app, alice, 'auto-match', { clipRecordId: aliceClip })
    expect(r.status).toBe(200)
    expect(r.body.matched).toBe(false)
    // No render job for a single clip.
    const jobs = await request(app).post('/api/db').set('Authorization', `Bearer ${alice.token}`)
      .send({ table: 'render_jobs', action: 'select' })
    expect((jobs.body.data ?? []).length).toBe(0)
  })

  it('bunches two strangers who share a lobby + time window, enqueues ONE job, notifies both', async () => {
    // Bob uploads his angle of the same lobby a minute later.
    const bobClip = await addClip(app, bob, {
      player_handle: 'bob', lobby_id: LOBBY, recorded_at: iso(t0 + 60_000), duration_sec: 300,
    })
    const r = await fn(app, bob, 'auto-match', { clipRecordId: bobClip })
    expect(r.status).toBe(200)
    expect(r.body.matched).toBe(true)
    expect(r.body.clipCount).toBe(2)
    expect(r.body.jobId).toBeTruthy()
    expect(r.body.jobAlreadyExisted).toBe(false)
    expect(r.body.notified).toBe(2) // alice + bob

    // A render job is queued, pending, referencing both clips.
    const jobs = await request(app).post('/api/db').set('Authorization', `Bearer ${bob.token}`)
      .send({ table: 'render_jobs', action: 'select' })
    expect(jobs.body.data.length).toBe(1)
    expect(jobs.body.data[0].status).toBe('pending')

    // Both clips were stamped with the same match id.
    const stamped = await request(app).post('/api/db').set('Authorization', `Bearer ${bob.token}`)
      .send({ table: 'clip_records', action: 'select', columns: 'id,match_id' })
    const matchIds = new Set((stamped.body.data as any[]).map((c) => c.match_id).filter(Boolean))
    expect(matchIds.size).toBe(1)

    // Alice got a notification about her match.
    const notifs = await request(app).post('/api/db').set('Authorization', `Bearer ${alice.token}`)
      .send({ table: 'notifications', action: 'select', filters: [{ col: 'user_id', op: 'eq', val: alice.id }] })
    const tagged = (notifs.body.data as any[]).find((n) => n.kind === 'auto_match')
    expect(tagged?.title).toBe('You were tagged in a game')

    const angles = await pool.query('select * from match_angles')
    expect(angles.rows).toHaveLength(2)
    expect(new Set(angles.rows.map((angle: any) => String(angle.user_id))).size).toBe(2)
  })

  it('is idempotent — re-running does not duplicate the job or re-notify', async () => {
    const r = await fn(app, alice, 'auto-match', { clipRecordId: aliceClip })
    expect(r.body.matched).toBe(true)
    expect(r.body.jobAlreadyExisted).toBe(true)
    expect(r.body.notified).toBe(0)
    const jobs = await request(app).post('/api/db').set('Authorization', `Bearer ${alice.token}`)
      .send({ table: 'render_jobs', action: 'select' })
    expect(jobs.body.data.length).toBe(1) // still exactly one
  })

  it('a third angle joins the SAME job, not a new one', async () => {
    const carolClip = await addClip(app, carol, {
      player_handle: 'carol', lobby_id: LOBBY, recorded_at: iso(t0 + 120_000), duration_sec: 300,
    })
    const r = await fn(app, carol, 'auto-match', { clipRecordId: carolClip })
    expect(r.body.matched).toBe(true)
    expect(r.body.clipCount).toBe(3)
    const jobs = await request(app).post('/api/db').set('Authorization', `Bearer ${carol.token}`)
      .send({ table: 'render_jobs', action: 'select' })
    expect(jobs.body.data.length).toBe(1) // one job, now covering 3 clips
    expect(jobs.body.data[0].clip_ids.length).toBe(3)
    expect((await pool.query('select * from match_angles')).rows).toHaveLength(3)
  })

  it('refuses to auto-match a clip you do not own', async () => {
    const r = await fn(app, carol, 'auto-match', { clipRecordId: aliceClip })
    expect(r.status).toBe(403)
  })

  it('does not bunch clips from a different lobby/time', async () => {
    const lone = await addClip(app, alice, {
      player_handle: 'alice', lobby_id: 'other-lobby', recorded_at: iso(t0 + 3 * 3600_000), duration_sec: 300,
    })
    const r = await fn(app, alice, 'auto-match', { clipRecordId: lone })
    expect(r.body.matched).toBe(false)
  })
})

// The server enforces that the cross-user auto-merge/auto-build pipeline runs
// ONLY for a paying CONTENT-tier member (pro/supporter/creator — NOT ad_free,
// NOT free) who has connected YouTube. Non-entitled callers get ok:true but
// nothing matched / enqueued. Each case builds a REAL match (two angles of one
// lobby) so the ONLY reason no job appears is the gate.
describe('auto-match — server entitlement gate', () => {
  const iso = (ms: number) => new Date(ms).toISOString()

  // Set the trigger user's tier without touching YouTube (so we can dial each
  // condition independently). '' clears the tier back to free.
  async function setTier(pool: any, userId: string, tier: string) {
    const cur = await pool.query('select user_metadata from users where id=$1', [userId])
    const m = cur.rows[0]?.user_metadata
    const meta = typeof m === 'string' ? JSON.parse(m) : (m || {})
    meta.reelone_tier = tier
    await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), userId])
  }
  async function linkYouTube(pool: any, userId: string) {
    await pool.query('insert into user_youtube_links (user_id, url) values ($1,$2)', [userId, 'https://youtube.com/@x'])
  }

  // Stand up a fresh app + two clips in one lobby: `trigger` uploads the second
  // angle and fires auto-match. Returns the app, pool, and trigger clip id.
  async function twoAngleMatch(configure: (pool: any, trigger: Who) => Promise<void>) {
    const pool = makeDb()
    const app = createApp(pool)
    const t0 = new Date('2026-07-21T18:00:00Z').getTime()
    const lobby = `gate-lobby-${Math.random()}`
    const other = await signUp(app, `o_${Math.random()}@kc.gg`, `other_${Math.floor(Math.random() * 1e6)}`)
    const trigger = await signUp(app, `t_${Math.random()}@kc.gg`, `trig_${Math.floor(Math.random() * 1e6)}`)
    await addClip(app, other, { player_handle: 'other', lobby_id: lobby, recorded_at: iso(t0), duration_sec: 300 })
    const triggerClip = await addClip(app, trigger, { player_handle: 'trig', lobby_id: lobby, recorded_at: iso(t0 + 60_000), duration_sec: 300 })
    await configure(pool, trigger)
    const res = await fn(app, trigger, 'auto-match', { clipRecordId: triggerClip })
    return { pool, res }
  }

  const jobCount = async (pool: any) => Number((await pool.query('select count(*)::int n from render_jobs')).rows[0].n)
  const matchCount = async (pool: any) => Number((await pool.query('select count(*)::int n from match_groups')).rows[0].n)

  it('(a) FREE user → gated, no build', async () => {
    const { pool, res } = await twoAngleMatch(async (pool, trigger) => {
      await linkYouTube(pool, trigger.id) // YouTube yes, but tier is free
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.gated).toBe(true)
    expect(res.body.matched).toBe(false)
    expect(await jobCount(pool)).toBe(0)
    expect(await matchCount(pool)).toBe(0)
  })

  it("(b) AD_FREE user → gated, no build (not just the no-ads tier)", async () => {
    const { pool, res } = await twoAngleMatch(async (pool, trigger) => {
      await setTier(pool, trigger.id, 'ad_free')
      await linkYouTube(pool, trigger.id)
    })
    expect(res.body.ok).toBe(true)
    expect(res.body.gated).toBe(true)
    expect(res.body.matched).toBe(false)
    expect(await jobCount(pool)).toBe(0)
    expect(await matchCount(pool)).toBe(0)
  })

  it('(c) PAID content tier but NO YouTube link → gated, no build', async () => {
    const { pool, res } = await twoAngleMatch(async (pool, trigger) => {
      await setTier(pool, trigger.id, 'pro') // paid, but YouTube not connected
    })
    expect(res.body.ok).toBe(true)
    expect(res.body.gated).toBe(true)
    expect(res.body.matched).toBe(false)
    expect(await jobCount(pool)).toBe(0)
    expect(await matchCount(pool)).toBe(0)
  })

  it('(d) ENTITLED user (paid content tier + YouTube) → runs and enqueues', async () => {
    const { pool, res } = await twoAngleMatch(async (pool, trigger) => {
      await entitleForAutoMerge(pool, trigger.id)
      // This test isolates the entitlement gate, so both angles explicitly opt
      // into general reuse instead of relying on the account privacy default.
      await pool.query("update profiles set reel_usage_privacy='anyone'")
    })
    expect(res.body.ok).toBe(true)
    expect(res.body.gated).toBeUndefined()
    expect(res.body.matched).toBe(true)
    expect(res.body.jobId).toBeTruthy()
    expect(await jobCount(pool)).toBe(1)
    expect(await matchCount(pool)).toBe(1)
  })
})

describe('auto-match future camera consent', () => {
  it('excludes a player who paused future auto-merge', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const started = Date.parse('2026-07-22T18:00:00Z')
    const lobby = `optout-${Math.random()}`
    const paused = await signUp(app, `p_${Math.random()}@kc.gg`, `paused_${Math.floor(Math.random() * 1e6)}`)
    const trigger = await signUp(app, `r_${Math.random()}@kc.gg`, `runner_${Math.floor(Math.random() * 1e6)}`)
    await entitleForAutoMerge(pool, trigger.id)
    await pool.query('update profiles set auto_merge_opt_out=true where id=$1', [paused.id])
    await addClip(app, paused, {
      player_handle: 'paused',
      lobby_id: lobby,
      recorded_at: new Date(started).toISOString(),
      duration_sec: 300,
    })
    const triggerClip = await addClip(app, trigger, {
      player_handle: 'runner',
      lobby_id: lobby,
      recorded_at: new Date(started + 30_000).toISOString(),
      duration_sec: 300,
    })
    const response = await fn(app, trigger, 'auto-match', { clipRecordId: triggerClip })
    expect(response.status).toBe(200)
    expect(response.body.matched).toBe(false)
    const jobs = await pool.query('select count(*)::int n from render_jobs')
    expect(Number(jobs.rows[0].n)).toBe(0)
  })
})
