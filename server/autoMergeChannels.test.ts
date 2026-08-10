/* eslint-disable @typescript-eslint/no-explicit-any */
// INTERNAL /api/internal/auto-merge-channels — the LIVE connected-account
// roster the auto-merge pipeline (tko_autopilot.dynamic_channels) pulls every
// run instead of the four hardcoded channels. Proves paid, beta, and plain free
// signups are included and the endpoint is refused without the service key.
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

  it('includes every connected signup and carries its tier/beta metadata', async () => {
    const paidId = await connect(pool, { username: 'paidguy', url: 'https://www.youtube.com/@paidguy', tier: 'pro' })
    const basicId = await connect(pool, { username: 'basicguy', url: 'https://www.youtube.com/@basicguy', tier: 'ad_free' })
    const betaId = await connect(pool, { username: 'hammy', url: 'https://www.youtube.com/@hammy', beta: true }) // FREE tier + beta flag
    const freeId = await connect(pool, { username: 'freeplayer', url: 'https://www.youtube.com/@freeplayer' })

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
    // Plain FREE, non-beta — included; the worker's weekly cap applies later.
    expect(byUser[freeId]).toMatchObject({ username: 'freeplayer', tier: '', beta: false })
    expect(r.body.channels).toHaveLength(4)
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

  it('carries high-confidence system-detected livestream ids to the factory', async () => {
    const userId = await connect(pool, {
      username: 'kyubi',
      url: 'https://www.youtube.com/@kyubi',
    })
    const source = await pool.query(
      `insert into media_sources
         (owner_id,provider,source_kind,source_url,source_fingerprint,status)
       values ($1,'youtube','youtube_live','https://youtu.be/MWBcNzQMqxc',$2,'complete')
       returning id`,
      [userId, `source-${userId}`],
    )
    const segment = await pool.query(
      `insert into match_segments
         (source_id,segment_index,segment_fingerprint,start_sec,end_sec,start_reason,end_reason,
          boundary_confidence)
       values ($1,0,$2,0,120,'start','result',0.92)
       returning id`,
      [source.rows[0].id, `segment-${userId}`],
    )
    await pool.query(
      `insert into clip_records
         (player_id,youtube_id,segment_id,score_verification_status,boundary_confidence,source_id)
       values ($1,'MWBcNzQMqxc',$2,'shadow',0.92,$3),
              ($1,'tooLow12345',null,'shadow',0.40,$3)`,
      [userId, segment.rows[0].id, source.rows[0].id],
    )

    const response = await request(app)
      .post('/api/internal/auto-merge-channels')
      .set('x-tko-service', SERVICE_KEY)
      .send({})

    expect(response.status).toBe(200)
    expect(response.body.channels[0].detected_video_ids).toEqual(['MWBcNzQMqxc'])
  })

  it('skips video rows without letting a newer video mask an older valid channel', async () => {
    const channelId = await connect(pool, {
      username: 'channelowner',
      url: 'https://www.youtube.com/@channelowner',
    })
    await pool.query(
      'update user_youtube_links set created_at=$1 where user_id=$2',
      ['2026-08-08T00:00:00.000Z', channelId],
    )
    await pool.query(
      'insert into user_youtube_links (user_id,url,created_at) values ($1,$2,$3)',
      [channelId, 'https://www.youtube.com/watch?v=abcdefghijk', '2026-08-09T00:00:00.000Z'],
    )
    const videoOnlyId = await connect(pool, {
      username: 'videoonly',
      url: 'https://youtu.be/abcdefghijk',
    })

    const response = await request(app)
      .post('/api/internal/auto-merge-channels')
      .set('x-tko-service', SERVICE_KEY)
      .send({})

    expect(response.status).toBe(200)
    expect(response.body.channels).toContainEqual(expect.objectContaining({
      user_id: channelId,
      url: 'https://www.youtube.com/@channelowner',
    }))
    expect(response.body.channels.some((row: any) => row.user_id === videoOnlyId)).toBe(false)
  })
})
