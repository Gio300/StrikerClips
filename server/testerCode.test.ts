/* eslint-disable @typescript-eslint/no-explicit-any */
// The reusable TKO-BETA beta pass: one code, many testers, top-tier access.
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { makeApp } from './testHarness'

const ADULT_DOB = '1995-06-15'
async function signUp(app: any, email: string, username: string) {
  const r = await request(app).post('/api/auth/signup').send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token }
}

describe('TKO-BETA reusable tester pass', () => {
  const app = makeApp()

  it('grants top-tier access and is reusable by many testers', async () => {
    for (const [i, name] of ['aa', 'bb', 'cc'].entries()) {
      const u = await signUp(app, `${name}${i}@kc.gg`, `${name}${i}`)
      const r = await request(app).post('/api/fn/redeem-code').set('Authorization', `Bearer ${u.token}`).send({ code: 'TKO-BETA' })
      expect(r.status).toBe(200)
      expect(r.body.ok).toBe(true)
      expect(r.body.tier).toBe('creator')
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${u.token}`)
      expect(me.body.user.user_metadata.reelone_tier).toBe('creator')
    }
  })

  it('is case-insensitive', async () => {
    const u = await signUp(app, 'lower@kc.gg', 'lower')
    const r = await request(app).post('/api/fn/redeem-code').set('Authorization', `Bearer ${u.token}`).send({ code: 'tko-beta' })
    expect(r.body.ok).toBe(true)
    expect(r.body.tier).toBe('creator')
  })
})
