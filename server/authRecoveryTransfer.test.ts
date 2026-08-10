import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'
import type { PasswordResetEmail } from './authEmail'

const ADULT_DOB = '1995-06-15'

describe('account recovery and cross-origin session continuity', () => {
  let pool: ReturnType<typeof makeDb>
  let deliveries: PasswordResetEmail[]
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    process.env.APP_ORIGINS = 'https://shinobistrikerleague.com'
    pool = makeDb()
    deliveries = []
    app = createApp(pool, {
      sendPasswordResetEmail: async (message) => { deliveries.push(message) },
    })
  })

  afterEach(async () => {
    delete process.env.APP_ORIGINS
    await pool.end()
  })

  async function signup(email = 'veteran@tko.test', username = 'veteran') {
    const response = await request(app).post('/api/auth/signup').send({
      email, username, password: 'old-password', date_of_birth: ADULT_DOB,
    })
    expect(response.status).toBe(200)
    return response.body as { token: string; user: { id: string; email: string } }
  }

  async function requestReset(email = 'veteran@tko.test') {
    const response = await request(app).post('/api/auth/password/forgot').send({
      email, origin: 'https://shinobistrikerleague.com',
    })
    expect(response.status).toBe(202)
    expect(response.body.ok).toBe(true)
    return response
  }

  it('keeps the response generic and never stores the raw emailed reset code', async () => {
    await signup()
    const existing = await requestReset()
    const missing = await requestReset('nobody@tko.test')
    expect(missing.body).toEqual(existing.body)
    expect(deliveries).toHaveLength(1)
    expect(new URL(deliveries[0].resetUrl).origin).toBe('https://shinobistrikerleague.com')

    const raw = new URL(deliveries[0].resetUrl).searchParams.get('token') || ''
    expect(raw.length).toBeGreaterThanOrEqual(32)
    const stored = await pool.query('select token_hash from password_reset_tokens')
    expect(stored.rows).toHaveLength(1)
    expect(stored.rows[0].token_hash).not.toBe(raw)
    expect(stored.rows[0].token_hash).not.toContain(raw)
  })

  it('changes the password once and preserves the same user and power', async () => {
    const account = await signup()
    await pool.query('update profiles set power_level=5200 where id=$1', [account.user.id])
    await requestReset()
    const raw = new URL(deliveries[0].resetUrl).searchParams.get('token') || ''

    const reset = await request(app).post('/api/auth/password/reset').send({
      token: raw, password: 'new-password-123',
    })
    expect(reset.status).toBe(200)
    expect(reset.body.user.id).toBe(account.user.id)

    const reused = await request(app).post('/api/auth/password/reset').send({
      token: raw, password: 'another-password',
    })
    expect(reused.status).toBe(400)
    const oldLogin = await request(app).post('/api/auth/login').send({
      email: account.user.email, password: 'old-password',
    })
    expect(oldLogin.status).toBe(401)
    const newLogin = await request(app).post('/api/auth/login').send({
      email: account.user.email, password: 'new-password-123',
    })
    expect(newLogin.status).toBe(200)
    expect(newLogin.body.user.id).toBe(account.user.id)
    const profile = await pool.query('select power_level from profiles where id=$1', [account.user.id])
    expect(Number(profile.rows[0].power_level)).toBe(5200)
  })

  it('rejects an expired password reset link', async () => {
    await signup()
    await requestReset()
    const raw = new URL(deliveries[0].resetUrl).searchParams.get('token') || ''
    await pool.query("update password_reset_tokens set expires_at=now()-interval '1 minute'")
    const reset = await request(app).post('/api/auth/password/reset').send({
      token: raw, password: 'new-password-123',
    })
    expect(reset.status).toBe(400)
  })

  it('hands the same account to SSL exactly once and only at SSL', async () => {
    const account = await signup()
    await pool.query('update profiles set power_level=5200 where id=$1', [account.user.id])
    const start = await request(app)
      .post('/api/auth/transfer/start')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ target_origin: 'https://shinobistrikerleague.com', return_path: '/profile' })
    expect(start.status).toBe(200)
    const callback = new URL(start.body.url)
    expect(callback.origin).toBe('https://shinobistrikerleague.com')
    expect(callback.pathname).toBe('/profile')
    const code = callback.searchParams.get('auth_code') || ''
    expect(code).not.toContain(account.token)

    const wrongOrigin = await request(app).post('/api/auth/transfer/exchange').send({
      code, target_origin: 'https://tko.cam',
    })
    expect(wrongOrigin.status).toBe(400)

    const exchange = await request(app).post('/api/auth/transfer/exchange').send({
      code, target_origin: 'https://shinobistrikerleague.com',
    })
    expect(exchange.status).toBe(200)
    expect(exchange.body.user.id).toBe(account.user.id)
    expect(exchange.body.return_path).toBe('/profile')
    const profile = await pool.query('select power_level from profiles where id=$1', [exchange.body.user.id])
    expect(Number(profile.rows[0].power_level)).toBe(5200)

    const reused = await request(app).post('/api/auth/transfer/exchange').send({
      code, target_origin: 'https://shinobistrikerleague.com',
    })
    expect(reused.status).toBe(400)
  })

  it('supports the Android deep link but refuses an arbitrary website', async () => {
    const account = await signup()
    const native = await request(app)
      .post('/api/auth/transfer/start')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ target_origin: 'tkocam://auth', return_path: '/messages' })
    expect(native.status).toBe(200)
    expect(native.body.url).toMatch(/^tkocam:\/\/auth\?auth_code=/)

    const hostile = await request(app)
      .post('/api/auth/transfer/start')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ target_origin: 'https://attacker.example', return_path: '/' })
    expect(hostile.status).toBe(400)
  })
})
