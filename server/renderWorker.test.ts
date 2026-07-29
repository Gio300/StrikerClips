/* eslint-disable @typescript-eslint/no-explicit-any */
// Render-worker queue mechanics: a pending job is claimed once, produces the
// video, marks done, stamps the link, and notifies every participant — with a
// retry path that gives up after MAX_ATTEMPTS.
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { makeDb, entitleForAutoMerge } from './testHarness'
import { createApp } from './app'
import { drainQueue, runWorkerOnce, claimNextJob, type RenderAndUpload } from './renderWorker'

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

// A fake "assemble + upload" that just returns a deterministic YouTube id.
const fakeRender: RenderAndUpload = async (_pool, job) => ({
  youtubeId: `yt_${job.id.slice(0, 6)}`,
  videoUrl: `https://youtu.be/yt_${job.id.slice(0, 6)}`,
})

async function seedMatchJob(app: any, pool: any) {
  const alice = await signUp(app, `a_${Math.random()}@kc.gg`, `alice_${Math.floor(Math.random() * 1e6)}`)
  const bob = await signUp(app, `b_${Math.random()}@kc.gg`, `bob_${Math.floor(Math.random() * 1e6)}`)
  // Bob is the auto-match trigger; entitle him so the pipeline is not gated off.
  await entitleForAutoMerge(pool, bob.id)
  const t0 = new Date('2026-07-20T18:00:00Z').getTime()
  const lobby = `lobby_${Math.random()}`
  await addClip(app, alice, { player_handle: 'alice', lobby_id: lobby, recorded_at: new Date(t0).toISOString(), duration_sec: 300 })
  const bClip = await addClip(app, bob, { player_handle: 'bob', lobby_id: lobby, recorded_at: new Date(t0 + 60_000).toISOString(), duration_sec: 300 })
  const r = await request(app).post('/api/fn/auto-match').set('Authorization', `Bearer ${bob.token}`).send({ clipRecordId: bClip })
  expect(r.body.matched).toBe(true)
  // Production waits for more players. Queue-mechanics tests intentionally
  // advance that collection deadline.
  await pool.query(`update render_jobs set ready_at=$1`, ['2000-01-01T00:00:00Z'])
  return { alice, bob, lobby, t0 }
}

describe('render worker — queue → video → notify', () => {
  it('does not claim a pair before its collection deadline', async () => {
    const pool = makeDb()
    await pool.query(
      `insert into render_jobs (match_key, status, ready_at)
       values ('future-pair','pending',$1)`,
      ['2999-01-01T00:00:00Z'],
    )
    expect(await claimNextJob(pool)).toBeNull()
  })

  it('processes a pending job: done, link stamped, both participants notified', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const { alice, bob } = await seedMatchJob(app, pool)

    const handled = await drainQueue(pool, fakeRender)
    expect(handled).toBe(1)

    const jobs = await pool.query(`select * from render_jobs`)
    expect(jobs.rows.length).toBe(1)
    expect(jobs.rows[0].status).toBe('done')
    expect(jobs.rows[0].youtube_id).toBeTruthy()

    // Both clips carry the finished TKO composite id (separate from their own
    // raw source id, which stays whatever it was).
    const clips = await pool.query(`select composite_youtube_id from clip_records where match_id is not null`)
    expect(clips.rows.every((c: any) => !!c.composite_youtube_id)).toBe(true)

    const versions = await pool.query(`select * from match_versions`)
    expect(versions.rows).toHaveLength(1)
    expect(Number(versions.rows[0].angle_count)).toBe(2)
    expect(versions.rows[0].participant_ids).toHaveLength(2)

    // Both participants got the "video is live" notification with a link.
    for (const u of [alice, bob]) {
      const n = await pool.query(
        `select * from notifications where user_id=$1 and kind='auto_match_ready'`, [u.id],
      )
      expect(n.rows.length).toBe(1)
      expect(String(n.rows[0].link)).toContain('youtu.be')
    }

    // Queue is now empty.
    expect(await claimNextJob(pool)).toBeNull()
  })

  it('retries a failing render, then gives up as failed after 3 attempts', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    await seedMatchJob(app, pool)

    const boom: RenderAndUpload = async () => { throw new Error('ffmpeg exploded') }
    // Attempt 1 + 2 → back to pending; attempt 3 → failed.
    await runWorkerOnce(pool, boom)
    let j = (await pool.query(`select status, attempts from render_jobs`)).rows[0]
    expect(j.status).toBe('pending'); expect(Number(j.attempts)).toBe(1)

    await runWorkerOnce(pool, boom)
    j = (await pool.query(`select status, attempts from render_jobs`)).rows[0]
    expect(j.status).toBe('pending'); expect(Number(j.attempts)).toBe(2)

    await runWorkerOnce(pool, boom)
    j = (await pool.query(`select status, attempts, error from render_jobs`)).rows[0]
    expect(j.status).toBe('failed'); expect(Number(j.attempts)).toBe(3)
    expect(String(j.error)).toContain('ffmpeg')
  })

  it('reopens a finished pair when a third player joins', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const { lobby, t0 } = await seedMatchJob(app, pool)
    await drainQueue(pool, fakeRender)

    const carol = await signUp(app, `c_${Math.random()}@kc.gg`, `carol_${Math.floor(Math.random() * 1e6)}`)
    await entitleForAutoMerge(pool, carol.id)
    const cClip = await addClip(app, carol, {
      player_handle: 'carol',
      lobby_id: lobby,
      recorded_at: new Date(t0 + 120_000).toISOString(),
      duration_sec: 300,
    })
    const response = await request(app)
      .post('/api/fn/auto-match')
      .set('Authorization', `Bearer ${carol.token}`)
      .send({ clipRecordId: cClip })

    expect(response.body.matched).toBe(true)
    expect(response.body.clipCount).toBe(3)
    const job = (await pool.query(
      `select status,clip_ids,youtube_id,combined_video_url from render_jobs`,
    )).rows[0]
    expect(job.status).toBe('pending')
    expect(job.clip_ids).toHaveLength(3)
    expect(job.youtube_id).toBeNull()
    expect(job.combined_video_url).toBeNull()
  })
})
