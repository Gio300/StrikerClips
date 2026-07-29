/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { entitleForAutoMerge, makeDb } from './testHarness'

const ADULT_DOB = '1995-06-15'

describe('auto-match distinct-player counting', () => {
  it('does not treat two uploads from one player as a two-angle match', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const signup = await request(app).post('/api/auth/signup').send({
      email: `solo_${Math.random()}@tko.cam`,
      password: 'password123',
      username: `solo_${Math.floor(Math.random() * 1e6)}`,
      date_of_birth: ADULT_DOB,
    })
    expect(signup.status).toBe(200)
    const token = signup.body.token as string
    const playerId = signup.body.user.id as string
    await entitleForAutoMerge(pool, playerId)

    const addClip = async (recordedAt: string) => {
      const response = await request(app)
        .post('/api/db')
        .set('Authorization', `Bearer ${token}`)
        .send({
          table: 'clip_records',
          action: 'insert',
          single: true,
          values: {
            player_id: playerId,
            player_handle: 'solo',
            lobby_id: 'solo-lobby',
            recorded_at: recordedAt,
            duration_sec: 300,
          },
        })
      expect(response.status).toBe(200)
      return response.body.data.id as string
    }

    const start = Date.parse('2026-07-25T18:00:00Z')
    await addClip(new Date(start).toISOString())
    const second = await addClip(new Date(start + 30_000).toISOString())
    const result = await request(app)
      .post('/api/fn/auto-match')
      .set('Authorization', `Bearer ${token}`)
      .send({ clipRecordId: second })

    expect(result.status).toBe(200)
    expect(result.body.matched).toBe(false)
    expect(result.body.reason).toContain('duplicate clips')
    const count = Number((await pool.query('select count(*)::int n from render_jobs')).rows[0].n)
    expect(count).toBe(0)
  })
})
