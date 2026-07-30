/* eslint-disable @typescript-eslint/no-explicit-any */
// ORACLE VOTING — a viewer votes on a match outcome; a correct vote banks +10
// oracle_points, which recomputePower ADDS to the player's power level. Resolve
// is host-gated and idempotent.
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { makeDb } from './testHarness'
import { createApp } from './app'

const ADULT_DOB = '1995-06-15'
async function signUp(app: any, email: string, username: string) {
  const r = await request(app).post('/api/auth/signup').send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token as string, id: r.body.user.id as string }
}
const fn = (app: any, token: string, name: string, body: any) =>
  request(app).post(`/api/fn/${name}`).set('Authorization', `Bearer ${token}`).send(body)
const powerOf = async (pool: any, id: string) =>
  Number((await pool.query('select power_level from profiles where id=$1', [id])).rows[0].power_level)

describe('oracle voting', () => {
  let app: any
  let pool: any
  let right: { token: string; id: string }
  let wrong: { token: string; id: string }
  let host: { token: string; id: string }

  beforeEach(async () => {
    pool = makeDb()
    app = createApp(pool)
    right = await signUp(app, 'right@kc.gg', 'right')
    wrong = await signUp(app, 'wrong@kc.gg', 'wrong')
    host = await signUp(app, 'host@kc.gg', 'host')
    // Make `host` a global TKO host (the only role that may resolve a match).
    await pool.query(`update users set user_metadata=$1 where id=$2`, [JSON.stringify({ tko_host: true }), host.id])
  })

  it('records one vote per (user, match); a duplicate is rejected', async () => {
    const a = await fn(app, right.token, 'oracle-vote', { matchRef: 'm1', choice: 'blue' })
    expect(a.body.ok).toBe(true)
    const dupe = await fn(app, right.token, 'oracle-vote', { matchRef: 'm1', choice: 'red' })
    expect(dupe.body.ok).toBe(false)
    expect(dupe.body.reason).toBe('exists')
    const n = await pool.query('select count(*)::int n from oracle_votes where user_id=$1 and match_ref=$2', [right.id, 'm1'])
    expect(n.rows[0].n).toBe(1)
  })

  it("resolve raises a correct voter's power by 10; an incorrect voter is unchanged", async () => {
    await fn(app, right.token, 'oracle-vote', { matchRef: 'm1', choice: 'blue' })
    await fn(app, wrong.token, 'oracle-vote', { matchRef: 'm1', choice: 'red' })
    const rightBefore = await powerOf(pool, right.id)
    const wrongBefore = await powerOf(pool, wrong.id)

    const res = await fn(app, host.token, 'oracle-resolve', { matchRef: 'm1', winningChoice: 'blue' })
    expect(res.body.ok).toBe(true)
    expect(res.body.resolved).toBe(2)
    expect(res.body.correct).toBe(1)

    expect(await powerOf(pool, right.id)).toBe(rightBefore + 10)
    expect(await powerOf(pool, wrong.id)).toBe(wrongBefore)
    // The correct vote is graded and stamped resolved; the wrong one is graded too.
    const rv = await pool.query('select correct, resolved_at from oracle_votes where user_id=$1', [right.id])
    expect(rv.rows[0].correct).toBe(true)
    expect(rv.rows[0].resolved_at).toBeTruthy()
  })

  it('re-resolving the same match is idempotent (no extra +10)', async () => {
    await fn(app, right.token, 'oracle-vote', { matchRef: 'm1', choice: 'blue' })
    await fn(app, host.token, 'oracle-resolve', { matchRef: 'm1', winningChoice: 'blue' })
    const afterFirst = await powerOf(pool, right.id)
    const again = await fn(app, host.token, 'oracle-resolve', { matchRef: 'm1', winningChoice: 'blue' })
    expect(again.body.resolved).toBe(0) // nothing left unresolved
    expect(await powerOf(pool, right.id)).toBe(afterFirst) // unchanged
  })

  it('only a host may resolve a match', async () => {
    await fn(app, right.token, 'oracle-vote', { matchRef: 'm1', choice: 'blue' })
    const nope = await fn(app, right.token, 'oracle-resolve', { matchRef: 'm1', winningChoice: 'blue' })
    expect(nope.status).toBe(403)
    expect(await powerOf(pool, right.id)).toBe(0)
  })
})
