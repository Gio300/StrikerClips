/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'
import { normalizeIntegrityReport } from './tournamentIntegrity'

const previousServiceKey = process.env.TKO_SERVICE_KEY

afterEach(() => {
  if (previousServiceKey == null) delete process.env.TKO_SERVICE_KEY
  else process.env.TKO_SERVICE_KEY = previousServiceKey
})

async function tournamentLiveSource() {
  process.env.TKO_SERVICE_KEY = 'integrity-test-key'
  const pool = makeDb()
  const app = createApp(pool)
  const signup = await request(app).post('/api/auth/signup').send({
    email: 'integrity-player@tko.test',
    password: 'password123',
    username: 'integrityplayer',
    age_consent_13_plus: true,
  })
  const userId = String(signup.body.user.id)
  const tournament = (await pool.query(
    "insert into tournaments (name,created_by,status) values ('Integrity Cup',$1,'live') returning *",
    [userId],
  )).rows[0]
  const live = (await pool.query(
    `insert into live_streams (user_id,youtube_url,title,game,tournament_id)
     values ($1,'https://www.youtube.com/watch?v=integrity-live','Integrity POV','Shinobi Striker',$2)
     returning *`,
    [userId, tournament.id],
  )).rows[0]
  const registered = await request(app)
    .post('/api/internal/media-sources')
    .set('x-tko-service', 'integrity-test-key')
    .send({
      owner_id: userId,
      live_stream_id: live.id,
      provider: 'youtube',
      source_kind: 'youtube_live',
      source_url: live.youtube_url,
      external_id: 'integrity-live',
      status: 'queued',
    })
  expect(registered.status, JSON.stringify(registered.body)).toBe(201)
  return { pool, app, userId, tournament, live, source: registered.body.source }
}

describe('tournament integrity boundary', () => {
  it('queues a separate tournament-only job that ordinary media workers cannot claim', async () => {
    const { pool, app, source } = await tournamentLiveSource()
    const jobs = await pool.query(
      'select job_kind,status from media_analysis_jobs where source_id=$1 order by job_kind',
      [source.id],
    )
    expect(jobs.rows.map((row) => row.job_kind)).toEqual([
      'match_boundaries_v1',
      'shinobi_integrity_v1',
    ])

    const ordinary = await request(app)
      .post('/api/internal/media-analysis/jobs/claim')
      .set('x-tko-service', 'integrity-test-key')
      .send({ worker_id: 'ordinary-worker' })
    expect(ordinary.body.job.job_kind).toBe('match_boundaries_v1')

    const integrity = await request(app)
      .post('/api/internal/media-analysis/jobs/claim')
      .set('x-tko-service', 'integrity-test-key')
      .send({ worker_id: 'integrity-worker', job_kind: 'shinobi_integrity_v1' })
    expect(integrity.body.job.job_kind).toBe('shinobi_integrity_v1')
  })

  it('stores model suspicion as review-only and strips its requested clip', async () => {
    const { app, userId, tournament, source } = await tournamentLiveSource()
    const submitted = await request(app)
      .post('/api/internal/tournament-integrity')
      .set('x-tko-service', 'integrity-test-key')
      .send({
        source_id: source.id,
        tournament_id: tournament.id,
        participant_id: userId,
        detector_version: 'integrity-test-v1',
        report: {
          verdict: 'needs_review',
          missing_coverage: ['outfit_skills_visible'],
          evidence: [{
            code: 'MODEL_CANDIDATE_ONLY', level: 'needs_review', deterministic: false,
            confidence: 1, summary: 'vision model nominated this moment',
          }],
          public_accusation_allowed: true,
          clip_windows: [{ t0: 1, t1: 10, evidence_codes: ['MODEL_CANDIDATE_ONLY'] }],
        },
      })
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201)
    expect(submitted.body.report.verdict).toBe('needs_review')
    expect(submitted.body.report.public_accusation_allowed).toBe(false)
    expect(submitted.body.report.clip_eligible).toBe(false)
    expect(submitted.body.report.clip_windows).toEqual([])
  })

  it('allows a clip only when a timestamped deterministic violation clears 0.99', async () => {
    const { app, userId, tournament, source } = await tournamentLiveSource()
    const submitted = await request(app)
      .post('/api/internal/tournament-integrity')
      .set('x-tko-service', 'integrity-test-key')
      .send({
        source_id: source.id,
        tournament_id: tournament.id,
        participant_id: userId,
        detector_version: 'integrity-test-v2',
        report: {
          verdict: 'confirmed_mod',
          missing_coverage: [],
          evidence: [{
            code: 'CROSS_ROLE_ABILITY', level: 'confirmed_mod', deterministic: true,
            confidence: 0.995, t: 20, summary: 'verified role/loadout mismatch',
          }],
          clip_windows: [{ t0: 15, t1: 25, evidence_codes: ['CROSS_ROLE_ABILITY'] }],
        },
      })
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201)
    expect(submitted.body.report.public_accusation_allowed).toBe(true)
    expect(submitted.body.report.clip_eligible).toBe(true)
  })

  it('rejects a model-authored confirmed verdict', () => {
    expect(() => normalizeIntegrityReport({
      verdict: 'confirmed_mod',
      evidence: [{
        code: 'MODEL_CANDIDATE_ONLY', level: 'confirmed_mod', deterministic: true, confidence: 1,
      }],
      clip_windows: [{ t0: 0, t1: 10, evidence_codes: ['MODEL_CANDIDATE_ONLY'] }],
    })).toThrow(/deterministic evidence/)
  })
})
