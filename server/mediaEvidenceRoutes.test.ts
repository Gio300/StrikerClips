/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { queueMediaAnalysis, registerMediaSource } from './mediaEvidence'
import { makeDb } from './testHarness'

const previousServiceKey = process.env.TKO_SERVICE_KEY

afterEach(() => {
  if (previousServiceKey == null) delete process.env.TKO_SERVICE_KEY
  else process.env.TKO_SERVICE_KEY = previousServiceKey
})

describe('cloud media evidence routes', () => {
  it('registers a direct upload, leases it, ingests evidence, and confirms a detected alias', async () => {
    process.env.TKO_SERVICE_KEY = 'test-media-service-key'
    const pool = makeDb()
    const app = createApp(pool)
    const signup = await request(app).post('/api/auth/signup').send({
      email: 'media-worker@tko.cam',
      password: 'password123',
      username: 'mediaworker',
      age_consent_13_plus: true,
    })
    expect(signup.status).toBe(200)
    const token = String(signup.body.token)

    const registered = await request(app)
      .post('/api/media/sources')
      .set('Authorization', `Bearer ${token}`)
      .send({ source_url: 'https://storage.tko.cam/uploads/match-1.mp4', duration_sec: 125 })
    expect(registered.status).toBe(201)
    const sourceId = String(registered.body.source.id)

    const unauthorized = await request(app)
      .post('/api/internal/media-analysis/jobs/claim')
      .send({ worker_id: 'detector-one' })
    expect(unauthorized.status).toBe(401)

    const claimed = await request(app)
      .post('/api/internal/media-analysis/jobs/claim')
      .set('x-tko-service', 'test-media-service-key')
      .send({ worker_id: 'detector-one', lease_seconds: 300 })
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200)
    expect(claimed.body.job.source.id).toBe(sourceId)

    const evidence = await request(app)
      .post('/api/internal/media-evidence')
      .set('x-tko-service', 'test-media-service-key')
      .send({
        sourceId,
        sourceDurationSec: 125,
        ownerAlias: { displayAlias: 'HammyNew', confidence: 0.99 },
        observations: [
          { atSec: 0, cue: 'start', text: 'Battle start', timerSec: 420, confidence: 0.99, roster: ['HammyNew'] },
          { atSec: 120, cue: 'result', text: 'Battle complete', timerSec: 0, confidence: 0.99 },
        ],
        final: true,
      })
    expect(evidence.status, JSON.stringify(evidence.body)).toBe(200)
    expect(evidence.body.ingestion.clipRecordIds).toHaveLength(1)

    const confirmed = await request(app)
      .post('/api/media/aliases/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ source_id: sourceId, alias: 'HammyNew' })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    expect(confirmed.body.decision.status).toBe('verified')

    const catalog = await request(app)
      .get(`/api/internal/media-analysis/aliases?source_id=${sourceId}`)
      .set('x-tko-service', 'test-media-service-key')
    expect(catalog.status, JSON.stringify(catalog.body)).toBe(200)
    expect(catalog.body.source.ownerId).toBe(signup.body.user.id)
    expect(catalog.body.aliases).toEqual([
      expect.objectContaining({
        profileId: signup.body.user.id,
        displayAlias: 'HammyNew',
        normalizedAlias: 'hammynew',
      }),
    ])

    const completed = await request(app)
      .post(`/api/internal/media-analysis/jobs/${claimed.body.job.id}/complete`)
      .set('x-tko-service', 'test-media-service-key')
      .send({ ok: true, cursor_sec: 125 })
    expect(completed.status).toBe(200)

    const job = await pool.query('select status from media_analysis_jobs where id=$1', [claimed.body.job.id])
    expect(job.rows[0].status).toBe('complete')
  })

  it('retries transient analysis failures before marking an upload failed', async () => {
    process.env.TKO_SERVICE_KEY = 'test-media-service-key'
    const pool = makeDb()
    const app = createApp(pool)
    const signup = await request(app).post('/api/auth/signup').send({
      email: 'media-retry@tko.cam',
      password: 'password123',
      username: 'mediaretry',
      age_consent_13_plus: true,
    })
    const token = String(signup.body.token)
    await request(app)
      .post('/api/media/sources')
      .set('Authorization', `Bearer ${token}`)
      .send({ source_url: 'https://storage.tko.cam/uploads/retry.mp4' })

    for (let attempt = 1; attempt <= 3; attempt++) {
      const claimed = await request(app)
        .post('/api/internal/media-analysis/jobs/claim')
        .set('x-tko-service', 'test-media-service-key')
        .send({ worker_id: `retry-${attempt}` })
      expect(claimed.body.job).toBeTruthy()
      await request(app)
        .post(`/api/internal/media-analysis/jobs/${claimed.body.job.id}/complete`)
        .set('x-tko-service', 'test-media-service-key')
        .send({ ok: false, error: 'temporary OCR failure' })
      const row = (await pool.query(
        'select status,attempts,worker_id from media_analysis_jobs where id=$1',
        [claimed.body.job.id],
      )).rows[0]
      expect(Number(row.attempts)).toBe(attempt)
      expect(row.status).toBe(attempt < 3 ? 'queued' : 'failed')
      expect(row.worker_id).toBeNull()
      if (attempt < 3) {
        await pool.query('update media_analysis_jobs set ready_at=now() where id=$1', [claimed.body.job.id])
      }
    }
  })

  it('does not spend retries on a terminal external-access block', async () => {
    process.env.TKO_SERVICE_KEY = 'test-media-service-key'
    const pool = makeDb()
    const app = createApp(pool)
    const signup = await request(app).post('/api/auth/signup').send({
      email: 'media-blocked@tko.cam',
      password: 'password123',
      username: 'mediablocked',
      age_consent_13_plus: true,
    })
    const token = String(signup.body.token)
    await request(app)
      .post('/api/media/sources')
      .set('Authorization', `Bearer ${token}`)
      .send({ source_url: 'https://storage.tko.cam/uploads/blocked.mp4' })

    const claimed = await request(app)
      .post('/api/internal/media-analysis/jobs/claim')
      .set('x-tko-service', 'test-media-service-key')
      .send({ worker_id: 'terminal-youtube-block' })
    expect(claimed.body.job).toBeTruthy()
    await request(app)
      .post(`/api/internal/media-analysis/jobs/${claimed.body.job.id}/complete`)
      .set('x-tko-service', 'test-media-service-key')
      .send({ ok: false, retryable: false, error: 'YouTube cloud access blocked' })

    const row = (await pool.query(
      'select status,attempts,worker_id,source_id,reason,error from media_analysis_jobs where id=$1',
      [claimed.body.job.id],
    )).rows[0]
    expect(row.status).toBe('failed')
    expect(Number(row.attempts)).toBe(1)
    expect(row.worker_id).toBeNull()

    // The channel scanners rediscover the same upload every cycle. That must
    // not revive a terminal access failure and let it starve all newer jobs.
    await queueMediaAnalysis(pool, String(row.source_id), String(row.reason))
    const rediscovered = (await pool.query(
      'select status,attempts,error from media_analysis_jobs where id=$1',
      [claimed.body.job.id],
    )).rows[0]
    expect(rediscovered.status).toBe('failed')
    expect(Number(rediscovered.attempts)).toBe(1)
    expect(rediscovered.error).toBe('YouTube cloud access blocked')

    // A genuinely new phase (for example, a live broadcast ending) gets one
    // fresh attempt because the archived recording can be accessible even if
    // a live snapshot was not.
    await queueMediaAnalysis(pool, String(row.source_id), 'live_ended_final_pass')
    const finalPass = (await pool.query(
      'select status,attempts,error from media_analysis_jobs where id=$1',
      [claimed.body.job.id],
    )).rows[0]
    expect(finalPass.status).toBe('queued')
    expect(Number(finalPass.attempts)).toBe(0)
    expect(finalPass.error).toBeNull()
  })

  it('does not queue, lease, or ingest a YouTube upload from before signup day', async () => {
    process.env.TKO_SERVICE_KEY = 'test-media-service-key'
    const pool = makeDb()
    const app = createApp(pool)
    const signup = await request(app).post('/api/auth/signup').send({
      email: 'no-retro-worker@tko.cam',
      password: 'password123',
      username: 'noretroworker',
      age_consent_13_plus: true,
    })
    const userId = String(signup.body.user.id)
    await pool.query(`update users set created_at='2026-08-09T18:30:00Z' where id=$1`, [userId])

    const oldSource = await registerMediaSource(pool, {
      ownerId: userId,
      provider: 'youtube',
      sourceKind: 'youtube_upload',
      externalId: 'oldUpload01',
      sourceUrl: 'https://www.youtube.com/watch?v=oldUpload01',
      recordedAt: '2026-08-08T23:59:59Z',
    })
    const signupDaySource = await registerMediaSource(pool, {
      ownerId: userId,
      provider: 'youtube',
      sourceKind: 'youtube_upload',
      externalId: 'sameDay001',
      sourceUrl: 'https://www.youtube.com/watch?v=sameDay001',
      // Inclusive day policy: this is before the exact signup time but on the
      // same UTC calendar day, so it remains eligible.
      recordedAt: '2026-08-09T00:01:00Z',
    })

    expect(await queueMediaAnalysis(pool, String(oldSource.id), 'auto_youtube_upload_discovered')).toBeNull()
    expect((await pool.query(
      'select * from media_analysis_jobs where source_id=$1',
      [oldSource.id],
    )).rows).toHaveLength(0)
    await queueMediaAnalysis(pool, String(signupDaySource.id), 'auto_youtube_upload_discovered')

    // Simulate a pre-fix queued row already present in production. The claim
    // guard must leave it untouched and lease the eligible signup-day row.
    await pool.query(
      `insert into media_analysis_jobs (source_id,status,reason,ready_at)
       values ($1,'queued','legacy_pre_signup_backlog',now())`,
      [oldSource.id],
    )
    const claimed = await request(app)
      .post('/api/internal/media-analysis/jobs/claim')
      .set('x-tko-service', 'test-media-service-key')
      .send({ worker_id: 'signup-window-detector' })
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200)
    expect(claimed.body.job.source.id).toBe(signupDaySource.id)
    expect((await pool.query(
      'select status,attempts from media_analysis_jobs where source_id=$1',
      [oldSource.id],
    )).rows[0]).toMatchObject({ status: 'queued', attempts: 0 })

    const evidence = await request(app)
      .post('/api/internal/media-evidence')
      .set('x-tko-service', 'test-media-service-key')
      .send({
        sourceId: oldSource.id,
        sourceDurationSec: 120,
        observations: [
          { atSec: 0, cue: 'start', timerSec: 420, confidence: 0.99 },
          { atSec: 115, cue: 'result', timerSec: 0, confidence: 0.99 },
        ],
      })
    expect(evidence.status).toBe(400)
    expect(evidence.body.error).toContain('signup window')
    expect((await pool.query('select * from clip_records where player_id=$1', [userId])).rows).toHaveLength(0)
    expect(Number((await pool.query('select power_level from profiles where id=$1', [userId])).rows[0].power_level)).toBe(0)
  })
})
