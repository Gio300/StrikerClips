/* eslint-disable @typescript-eslint/no-explicit-any */
// INTERNAL /api/internal/auto-merge-channels — the LIVE, eligibility-gated
// roster the auto-merge pipeline (tko_autopilot.dynamic_channels) pulls every
// run instead of the four hardcoded channels. Proves: a paid user's channel is
// included, a beta (free-tier) user's channel is included, a plain free user's
// channel is excluded, and the endpoint is refused without the service key.
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { makeDb } from './testHarness'
import { createApp } from './app'

const SERVICE_KEY = 'test-service-key'

async function connect(pool: any, opts: { username: string; url: string; tier?: string; beta?: boolean }) {
  const meta: any = { username: opts.username }
  if (opts.tier) meta.reelone_tier = opts.tier
  if (opts.beta) meta.tko_beta = true
  const u = await pool.query(
    'insert into users (email, user_metadata) values ($1,$2) returning id',
    [`${opts.username}@kc.gg`, JSON.stringify(meta)],
  )
  const id = u.rows[0].id
  await pool.query('insert into profiles (id, username) values ($1,$2)', [id, opts.username])
  await pool.query('insert into user_youtube_links (user_id, url) values ($1,$2)', [id, opts.url])
  return id
}

describe('INTERNAL /api/internal/auto-merge-channels (dynamic roster)', () => {
  let app: any
  let pool: any
  beforeEach(() => {
    process.env.TKO_SERVICE_KEY = SERVICE_KEY
    pool = makeDb()
    app = createApp(pool)
  })

  it('includes paid + beta channels and excludes plain free', async () => {
    const paidId = await connect(pool, { username: 'paidguy', url: 'https://www.youtube.com/@paidguy', tier: 'pro' })
    const basicId = await connect(pool, { username: 'basicguy', url: 'https://www.youtube.com/@basicguy', tier: 'ad_free' })
    const betaId = await connect(pool, { username: 'hammy', url: 'https://www.youtube.com/@hammy', beta: true }) // FREE tier + beta flag
    await connect(pool, { username: 'freeloader', url: 'https://www.youtube.com/@freeloader' }) // free, no beta

    const r = await request(app)
      .post('/api/internal/auto-merge-channels')
      .set('x-tko-service', SERVICE_KEY)
      .send({})
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)

    const byUser: Record<string, any> = {}
    for (const c of r.body.channels) byUser[c.user_id] = c

    // PAID (pro) — included.
    expect(byUser[paidId]).toMatchObject({ username: 'paidguy', url: 'https://www.youtube.com/@paidguy' })
    // PAID "basic" (ad_free) — included ("and up").
    expect(byUser[basicId]).toBeTruthy()
    // BETA tester on the FREE tier — included via tko_beta.
    expect(byUser[betaId]).toMatchObject({ username: 'hammy' })
    // Plain FREE, non-beta — excluded.
    const usernames = r.body.channels.map((c: any) => c.username)
    expect(usernames).not.toContain('freeloader')
    expect(r.body.channels).toHaveLength(3)
  })

  it('refuses without / with a wrong service key', async () => {
    await connect(pool, { username: 'paidguy', url: 'https://www.youtube.com/@paidguy', tier: 'pro' })
    const noKey = await request(app).post('/api/internal/auto-merge-channels').send({})
    expect(noKey.status).toBe(401)
    const wrongKey = await request(app)
      .post('/api/internal/auto-merge-channels')
      .set('x-tko-service', 'nope')
      .send({})
    expect(wrongKey.status).toBe(401)
  })
})
