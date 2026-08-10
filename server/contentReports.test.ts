import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { makeDb } from './testHarness'

const ADULT_DOB = '1990-01-01'
const NOW = new Date('2026-08-10T18:00:00.000Z')

type Account = { id: string; token: string }

async function signUp(app: ReturnType<typeof createApp>, email: string, username: string): Promise<Account> {
  const response = await request(app)
    .post('/api/auth/signup')
    .send({ email, username, password: 'password123', date_of_birth: ADULT_DOB })
  expect(response.status).toBe(200)
  return { id: response.body.user.id, token: response.body.token }
}

const as = (account: Account) => ({ Authorization: `Bearer ${account.token}` })

describe('authenticated UGC reports and moderation queue', () => {
  let pool: ReturnType<typeof makeDb>
  let app: ReturnType<typeof createApp>
  let reporter: Account
  let author: Account
  let postId: string

  beforeEach(async () => {
    pool = makeDb()
    app = createApp(pool, { now: () => NOW })
    reporter = await signUp(app, 'reporter@example.com', 'reporter')
    author = await signUp(app, 'author@example.com', 'author')
    const post = await pool.query(
      'insert into posts (user_id,body) values ($1,$2) returning id',
      [author.id, 'unsafe post'],
    )
    postId = post.rows[0].id
  })

  it('requires auth, validates the target, and derives both user ids server-side', async () => {
    const unauthenticated = await request(app)
      .post('/api/fn/report-content')
      .send({ target_type: 'post', target_id: postId, reason: 'spam' })
    expect(unauthenticated.status).toBe(401)

    const invalid = await request(app)
      .post('/api/fn/report-content')
      .set(as(reporter))
      .send({ target_type: 'posts; drop table users', target_id: postId, reason: 'spam' })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error).toBe('invalid_report')

    const created = await request(app)
      .post('/api/fn/report-content')
      .set(as(reporter))
      .send({
        reporter_id: author.id,
        target_owner_id: reporter.id,
        target_type: 'post',
        target_id: postId,
        reason: 'harassment',
        details: 'Threatening language',
        source_path: '/profile/example?tab=wall',
      })
    expect(created.status).toBe(201)
    expect(created.body).toEqual(expect.objectContaining({ ok: true, duplicate: false }))

    const rows = await pool.query('select * from content_reports where id=$1', [created.body.report.id])
    expect(rows.rows[0]).toEqual(expect.objectContaining({
      reporter_id: reporter.id,
      target_owner_id: author.id,
      target_type: 'post',
      target_id: postId,
      reason: 'harassment',
      details: 'Threatening language',
      source_path: '/profile/example?tab=wall',
      status: 'open',
    }))
  })

  it('suppresses duplicate active reports and rejects self-reports', async () => {
    const body = { target_type: 'post', target_id: postId, reason: 'spam' }
    const first = await request(app).post('/api/fn/report-content').set(as(reporter)).send(body)
    const second = await request(app).post('/api/fn/report-content').set(as(reporter)).send(body)
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(second.body.duplicate).toBe(true)
    expect(second.body.report.id).toBe(first.body.report.id)
    expect((await pool.query('select * from content_reports')).rows).toHaveLength(1)

    const own = await request(app)
      .post('/api/fn/report-content')
      .set(as(author))
      .send(body)
    expect(own.status).toBe(400)
    expect(own.body.error).toBe('own_content')
  })

  it('reports another player profile while preserving target validation and duplicate safeguards', async () => {
    const body = {
      target_type: 'profile',
      target_id: author.id,
      reason: 'impersonation',
      details: 'This account is pretending to be another league player.',
    }
    const created = await request(app)
      .post('/api/fn/report-content')
      .set(as(reporter))
      .send({ ...body, reporter_id: author.id, target_owner_id: reporter.id })
    expect(created.status).toBe(201)

    const stored = await pool.query('select * from content_reports where id=$1', [created.body.report.id])
    expect(stored.rows[0]).toEqual(expect.objectContaining({
      reporter_id: reporter.id,
      target_type: 'profile',
      target_id: author.id,
      target_owner_id: author.id,
      reason: 'impersonation',
    }))

    const duplicate = await request(app).post('/api/fn/report-content').set(as(reporter)).send(body)
    expect(duplicate.status).toBe(200)
    expect(duplicate.body).toEqual(expect.objectContaining({ duplicate: true }))
    expect(duplicate.body.report.id).toBe(created.body.report.id)

    const own = await request(app).post('/api/fn/report-content').set(as(author)).send(body)
    expect(own.status).toBe(400)
    expect(own.body.error).toBe('own_content')

    const missing = await request(app)
      .post('/api/fn/report-content')
      .set(as(reporter))
      .send({ ...body, target_id: randomUUID() })
    expect(missing.status).toBe(404)
    expect(missing.body.error).toBe('not_found')
  })

  it('lets a player flag an assistant response even when the chat row was written under their id', async () => {
    const message = await pool.query(
      `insert into stream_messages (stream_id,user_id,content)
       values ($1,$2,$3) returning id`,
      [randomUUID(), reporter.id, '[[tko-bot]]unsafe generated answer'],
    )
    const created = await request(app)
      .post('/api/fn/report-content')
      .set(as(reporter))
      .send({ target_type: 'stream_message', target_id: message.rows[0].id, reason: 'other' })
    expect(created.status).toBe(201)
    const stored = await pool.query('select target_is_ai from content_reports where id=$1', [created.body.report.id])
    expect(stored.rows[0].target_is_ai).toBe(true)
  })

  it('only lets a DM participant report that private message', async () => {
    const outsider = await signUp(app, 'outsider@example.com', 'outsider')
    const conversation = await pool.query('insert into dm_conversations (name) values ($1) returning id', [null])
    await pool.query(
      'insert into dm_participants (conversation_id,user_id) values ($1,$2),($1,$3)',
      [conversation.rows[0].id, reporter.id, author.id],
    )
    const message = await pool.query(
      'insert into dm_messages (conversation_id,user_id,content) values ($1,$2,$3) returning id',
      [conversation.rows[0].id, author.id, 'private abuse'],
    )
    const body = { target_type: 'dm_message', target_id: message.rows[0].id, reason: 'harassment' }

    const refused = await request(app).post('/api/fn/report-content').set(as(outsider)).send(body)
    expect(refused.status).toBe(403)
    expect(refused.body.error).toBe('not_visible')
    const accepted = await request(app).post('/api/fn/report-content').set(as(reporter)).send(body)
    expect(accepted.status).toBe(201)
  })

  it('enforces a durable hourly ceiling across API instances', async () => {
    for (let index = 0; index < 30; index += 1) {
      await pool.query(
        `insert into content_reports
           (reporter_id,target_type,target_id,target_owner_id,reason,created_at,updated_at)
         values ($1,'chat_message',$2,$3,'spam',$4,$4)`,
        [reporter.id, randomUUID(), author.id, new Date(NOW.getTime() - index * 1000).toISOString()],
      )
    }
    // A fresh app proves this is the database window, not only the local burst map.
    const secondInstance = createApp(pool, { now: () => NOW })
    const limited = await request(secondInstance)
      .post('/api/fn/report-content')
      .set(as(reporter))
      .send({ target_type: 'post', target_id: postId, reason: 'spam' })
    expect(limited.status).toBe(429)
    expect(limited.body.error).toBe('rate_limited')
  })

  it('keeps the queue host-only and records review decisions', async () => {
    const created = await request(app)
      .post('/api/fn/report-content')
      .set(as(reporter))
      .send({ target_type: 'post', target_id: postId, reason: 'scam' })
    expect(created.status).toBe(201)

    const refused = await request(app).get('/api/moderation/reports').set(as(reporter))
    expect(refused.status).toBe(403)

    await pool.query(
      'update users set user_metadata=$2 where id=$1',
      [reporter.id, JSON.stringify({ tko_host: true })],
    )
    const listed = await request(app).get('/api/moderation/reports?status=open').set(as(reporter))
    expect(listed.status).toBe(200)
    expect(listed.body.reports.map((row: any) => row.id)).toContain(created.body.report.id)

    const reviewed = await request(app)
      .patch(`/api/moderation/reports/${created.body.report.id}`)
      .set(as(reporter))
      .send({ status: 'resolved', review_note: 'Removed and warned.' })
    expect(reviewed.status).toBe(200)
    expect(reviewed.body.report).toEqual(expect.objectContaining({
      status: 'resolved',
      reviewer_id: reporter.id,
      review_note: 'Removed and warned.',
    }))
  })
})
