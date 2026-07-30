/* eslint-disable @typescript-eslint/no-explicit-any */
// TKO-BETA redeem — beyond the top-tier grant (covered in testerCode.test.ts),
// redeeming marks the account tko_beta and auto-joins the single global
// TKO-BETA tester chat space. Idempotent: redeeming twice is fine.
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { makeDb } from './testHarness'
import { createApp } from './app'

const ADULT_DOB = '1995-06-15'
const BETA_SPACE = '00000000-0000-0000-0000-0000000be7a0'
async function signUp(app: any, email: string, username: string) {
  const r = await request(app).post('/api/auth/signup').send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token as string, id: r.body.user.id as string }
}

describe('TKO-BETA tester chat', () => {
  let app: any
  let pool: any
  beforeEach(() => { pool = makeDb(); app = createApp(pool) })

  it('marks tko_beta and joins the global TKO-BETA chat space', async () => {
    const u = await signUp(app, 'beta@kc.gg', 'beta')
    const r = await request(app).post('/api/fn/redeem-code').set('Authorization', `Bearer ${u.token}`).send({ code: 'TKO-BETA' })
    expect(r.body.ok).toBe(true)
    expect(r.body.beta).toBe(true)

    // The account carries the tester flag (surfaced on /auth/me).
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${u.token}`)
    expect(me.body.user.user_metadata.tko_beta).toBe(true)

    // The space + its #general channel exist, and the user is a member.
    const space = await pool.query('select kind, name from chat_spaces where id=$1', [BETA_SPACE])
    expect(space.rows[0].name).toBe('TKO-BETA')
    const chan = await pool.query('select count(*)::int n from chat_channels where space_id=$1 and name=$2', [BETA_SPACE, 'general'])
    expect(chan.rows[0].n).toBe(1)
    const mem = await pool.query('select count(*)::int n from chat_space_members where space_id=$1 and user_id=$2', [BETA_SPACE, u.id])
    expect(mem.rows[0].n).toBe(1)
  })

  it('is idempotent — redeeming twice leaves one membership', async () => {
    const u = await signUp(app, 'twice@kc.gg', 'twice')
    for (let i = 0; i < 2; i++) {
      const r = await request(app).post('/api/fn/redeem-code').set('Authorization', `Bearer ${u.token}`).send({ code: 'tko-beta' })
      expect(r.body.ok).toBe(true)
    }
    const mem = await pool.query('select count(*)::int n from chat_space_members where space_id=$1 and user_id=$2', [BETA_SPACE, u.id])
    expect(mem.rows[0].n).toBe(1)
  })
})
