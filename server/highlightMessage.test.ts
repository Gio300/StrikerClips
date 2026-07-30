/* eslint-disable @typescript-eslint/no-explicit-any */
// HIGHLIGHT MY COMMENT — a viewer spends utility Tokens to pin a highlighted
// chat line into a live stream. The debit must run through the trusted atomic
// spendTokens path (never a client-supplied balance), the row is written
// server-side with the highlight marker, and an under-funded viewer is refused
// without a charge.
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { makeDb } from './testHarness'
import { createApp } from './app'

const ADULT_DOB = '1995-06-15'
async function signUp(app: any, email: string, username: string) {
  const r = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token as string, id: r.body.user.id as string }
}
const fn = (app: any, token: string, name: string, body: any) =>
  request(app).post(`/api/fn/${name}`).set('Authorization', `Bearer ${token}`).send(body)

async function seedTokens(pool: any, userId: string, tokens: number) {
  await pool.query(
    `insert into wallets (user_id, tokens, sweeps, paid_sweeps_cents)
     values ($1, $2, 0, 0)
     on conflict (user_id) do update set tokens = excluded.tokens`,
    [userId, tokens],
  )
}
async function makeStream(pool: any, userId: string) {
  const r = await pool.query(
    `insert into live_streams (user_id, youtube_url, title) values ($1, $2, $3) returning id`,
    [userId, 'https://youtu.be/abc123', 'Test stream'],
  )
  return r.rows[0].id as string
}
const tokensOf = async (pool: any, id: string) =>
  Number((await pool.query('select tokens from wallets where user_id=$1', [id])).rows[0]?.tokens ?? 0)

describe('highlight-message (in-stream purchase)', () => {
  let app: any
  let pool: any
  let host: { token: string; id: string }
  let viewer: { token: string; id: string }
  let streamId: string

  beforeEach(async () => {
    pool = makeDb()
    app = createApp(pool)
    host = await signUp(app, 'host@kc.gg', 'host')
    viewer = await signUp(app, 'viewer@kc.gg', 'viewer')
    streamId = await makeStream(pool, host.id)
  })

  it('spends 50 Tokens through the trusted path and writes a marked highlight row', async () => {
    // Fund EXACTLY the cost. pg-mem evaluates a parameterized `col - $n` with
    // reversed operands, so a debit only yields the right number in-test when the
    // wallet is funded to exactly the price (balance → 0) — the same convention
    // moneyChaos/artifactTags use. On real Postgres `tokens - 50` is correct for
    // any balance; this asserts the debit ran through the trusted path.
    await seedTokens(pool, viewer.id, 50)
    const res = await fn(app, viewer.token, 'highlight-message', { streamId, content: 'LETS GO' })
    expect(res.body.ok).toBe(true)
    expect(res.body.cost).toBe(50)
    expect(res.body.wallet.tokens).toBe(0)
    // Balance actually moved server-side (not a client-reported number).
    expect(await tokensOf(pool, viewer.id)).toBe(0)
    // The highlighted row was written with the marker + belongs to the buyer.
    const rows = await pool.query('select user_id, content from stream_messages where stream_id=$1', [streamId])
    expect(rows.rows).toHaveLength(1)
    expect(String(rows.rows[0].content).startsWith('[[tko-hl]]')).toBe(true)
    expect(String(rows.rows[0].content)).toContain('LETS GO')
    expect(String(rows.rows[0].user_id)).toBe(viewer.id)
  })

  it('refuses (no charge, no row) when the viewer cannot afford it', async () => {
    await seedTokens(pool, viewer.id, 10)
    const res = await fn(app, viewer.token, 'highlight-message', { streamId, content: 'broke' })
    expect(res.body.ok).toBe(false)
    expect(res.body.reason).toBe('insufficient')
    expect(await tokensOf(pool, viewer.id)).toBe(10) // untouched
    const rows = await pool.query('select id from stream_messages where stream_id=$1', [streamId])
    expect(rows.rows).toHaveLength(0)
  })

  it('rejects an empty message without spending', async () => {
    await seedTokens(pool, viewer.id, 200)
    const res = await fn(app, viewer.token, 'highlight-message', { streamId, content: '   ' })
    expect(res.body.ok).toBe(false)
    expect(res.body.reason).toBe('invalid')
    expect(await tokensOf(pool, viewer.id)).toBe(200)
  })
})
