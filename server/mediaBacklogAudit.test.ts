import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { makeDb } from './testHarness'

const previousServiceKey = process.env.TKO_SERVICE_KEY

describe('operator media backlog audit', () => {
  const pool = makeDb()
  const app = createApp(pool as any)
  let userId = ''
  let reelId = ''
  let sourceId = ''

  beforeAll(async () => {
    process.env.TKO_SERVICE_KEY = 'media-audit-test-key'
    const signup = await request(app).post('/api/auth/signup').send({
      email: 'audit-player@tko.test',
      username: 'auditplayer',
      password: 'password123',
      date_of_birth: '1990-01-01',
    })
    expect(signup.status).toBe(200)
    userId = signup.body.user.id
    await pool.query(
      `insert into user_youtube_links (user_id,url,channel_id)
       values ($1,'https://www.youtube.com/@auditplayer','UC_AUDIT_PLAYER')`,
      [userId],
    )
    sourceId = randomUUID()
    await pool.query(
      `insert into media_sources
         (id,owner_id,provider,source_kind,external_id,source_url,source_fingerprint,status,metadata)
       values ($1,$2,'youtube','youtube_upload','audit-video','https://youtu.be/audit-video',
               'youtube:audit-video','queued',$3::jsonb)`,
      [sourceId, userId, JSON.stringify({ title: 'Shinobi combat training' })],
    )
    await pool.query(
      `insert into media_analysis_jobs (source_id,status,reason)
       values ($1,'queued','audit fixture')`,
      [sourceId],
    )
    reelId = randomUUID()
    await pool.query(
      `insert into reels (id,user_id,title,combined_video_url)
       values ($1,$2,'Coach cleanup fixture','https://www.youtube.com/watch?v=coachQa1234')`,
      [reelId, userId],
    )
  })

  afterAll(() => {
    if (previousServiceKey == null) delete process.env.TKO_SERVICE_KEY
    else process.env.TKO_SERVICE_KEY = previousServiceKey
  })

  it('requires the service key', async () => {
    const response = await request(app).get('/api/internal/media-backlog-audit')
    expect(response.status).toBe(401)
  })

  it('ties recent users to sources, blockers, and combat evidence', async () => {
    const response = await request(app)
      .get('/api/internal/media-backlog-audit?recent_hours=24&limit=100')
      .set('x-tko-service', 'media-audit-test-key')
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.ok).toBe(true)
    expect(response.body.counts.analysis_status.queued).toBe(1)
    const player = response.body.recent_users.find((row: any) => row.id === userId)
    expect(player).toMatchObject({
      username: 'auditplayer',
      youtube_channel_id: 'UC_AUDIT_PLAYER',
      blocker: 'media_analysis_queued',
    })
    const source = response.body.sources.find((row: any) => row.external_id === 'audit-video')
    expect(source).toMatchObject({
      username: 'auditplayer',
      title: 'Shinobi combat training',
      source_status: 'queued',
      combat_evidence: { level: 'unverified' },
    })
  })

  it('dry-runs by default and deletes only an exact reel/YouTube pair', async () => {
    const item = { reel_id: reelId, youtube_id: 'coachQa1234' }
    const dryRun = await request(app).post('/api/internal/media-produced-delete')
      .set('x-tko-service', 'media-audit-test-key')
      .send({ reason: 'coach-dee-test', items: [item] })
    expect(dryRun.status).toBe(200)
    expect(dryRun.body).toMatchObject({ dry_run: true, matched: 1, deleted: 0 })
    expect((await pool.query('select id from reels where id=$1', [reelId])).rows).toHaveLength(1)

    const mismatch = await request(app).post('/api/internal/media-produced-delete')
      .set('x-tko-service', 'media-audit-test-key')
      .send({ reason: 'coach-dee-test', dry_run: false, items: [{ ...item, youtube_id: 'notTheSame1' }] })
    expect(mismatch.status).toBe(200)
    expect(mismatch.body).toMatchObject({ matched: 0, missing: 1, deleted: 0 })

    const remove = await request(app).post('/api/internal/media-produced-delete')
      .set('x-tko-service', 'media-audit-test-key')
      .send({ reason: 'coach-dee-test', dry_run: false, items: [item] })
    expect(remove.status).toBe(200)
    expect(remove.body).toMatchObject({ dry_run: false, matched: 1, deleted: 1 })
    expect((await pool.query('select id from reels where id=$1', [reelId])).rows).toHaveLength(0)
  })

  it('rejects duplicate cleanup targets and quarantines exact queued sources without deleting them', async () => {
    const duplicate = await request(app).post('/api/internal/media-produced-delete')
      .set('x-tko-service', 'media-audit-test-key')
      .send({
        reason: 'duplicate-test',
        items: [
          { reel_id: randomUUID(), youtube_id: 'duplicate11' },
          { reel_id: '00000000-0000-4000-8000-000000000001', youtube_id: 'duplicate12' },
          { reel_id: '00000000-0000-4000-8000-000000000001', youtube_id: 'duplicate13' },
        ],
      })
    expect(duplicate.status).toBe(400)
    expect(duplicate.body.error).toContain('duplicate')

    const dryRun = await request(app).post('/api/internal/media-analysis-quarantine')
      .set('x-tko-service', 'media-audit-test-key')
      .send({ reason: 'explicit Fortnite title', source_ids: [sourceId] })
    expect(dryRun.status).toBe(200)
    expect(dryRun.body).toMatchObject({ dry_run: true, matched: 1, quarantined: 0 })
    expect((await pool.query('select status from media_sources where id=$1', [sourceId])).rows[0].status).toBe('queued')

    const apply = await request(app).post('/api/internal/media-analysis-quarantine')
      .set('x-tko-service', 'media-audit-test-key')
      .send({ reason: 'explicit Fortnite title', source_ids: [sourceId], dry_run: false })
    expect(apply.status).toBe(200)
    expect(apply.body).toMatchObject({ dry_run: false, matched: 1, quarantined: 1 })
    expect((await pool.query('select status from media_sources where id=$1', [sourceId])).rows[0].status).toBe('failed')
    expect((await pool.query('select status,error from media_analysis_jobs where source_id=$1', [sourceId])).rows[0])
      .toMatchObject({ status: 'failed', error: 'explicit Fortnite title' })
  })
})
