import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

async function account(app: ReturnType<typeof createApp>) {
  const response = await request(app).post('/api/auth/signup').send({
    email: 'fair-play@example.com',
    password: 'password123',
    username: 'fairplay',
    date_of_birth: '1995-06-15',
  })
  expect(response.status).toBe(200)
  return { token: response.body.token as string, id: response.body.user.id as string }
}

describe('manual result scoring retirement', () => {
  it('blocks old screenshot result clients and prevents clip provenance spoofing', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const who = await account(app)
    const auth = { Authorization: `Bearer ${who.token}` }

    const manual = await request(app).post('/api/db').set(auth).send({
      table: 'match_results',
      action: 'insert',
      single: true,
      values: { uploader_id: who.id, match_type: 'survival', screenshot_url: 'https://example.com/result.jpg' },
    })
    expect(manual.status).toBe(403)

    const clip = await request(app).post('/api/db').set(auth).send({
      table: 'clip_records',
      action: 'insert',
      single: true,
      values: {
        player_id: 'someone-else',
        youtube_id: 'MWBcNzQMqxc',
        outcome: 'victory',
        score_verification_status: 'verified',
        source_id: 'spoofed-source',
        segment_id: 'spoofed-segment',
        boundary_confidence: 1,
      },
    })
    expect(clip.status).toBe(200)
    expect(clip.body.data.player_id).toBe(who.id)
    expect(clip.body.data.score_verification_status).toBe('shadow')
    expect(clip.body.data.source_id).toBeNull()
    expect(clip.body.data.segment_id).toBeNull()

    const promote = await request(app).post('/api/db').set(auth).send({
      table: 'clip_records',
      action: 'update',
      filters: [{ col: 'id', op: 'eq', val: clip.body.data.id }],
      values: { score_verification_status: 'verified' },
    })
    expect(promote.status).toBe(403)
  })
})
