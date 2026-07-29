/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

describe('retired wagering API', () => {
  it('fails closed for every legacy wagering action', async () => {
    const app = createApp(makeDb())
    const signup = await request(app).post('/api/auth/signup').send({
      email: 'viewer@tko.gg',
      password: 'password123',
      username: 'viewer',
      date_of_birth: '1995-06-15',
    })

    expect(signup.status).toBe(200)

    for (const name of ['wager-open', 'wager-place', 'wager-lock', 'wager-resolve', 'wager-cancel']) {
      const response = await request(app)
        .post(`/api/fn/${name}`)
        .set('Authorization', `Bearer ${signup.body.token}`)
        .send({})

      expect(response.status).toBe(410)
      expect(response.body).toMatchObject({ ok: false, reason: 'feature-retired' })
    }
  })
})
