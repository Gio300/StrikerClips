/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

const SERVICE_KEY = 'credit-produced-route-test-key'
const ADULT_DOB = '1995-06-15'
let previousServiceKey: string | undefined

beforeEach(() => {
  previousServiceKey = process.env.TKO_SERVICE_KEY
  process.env.TKO_SERVICE_KEY = SERVICE_KEY
})

afterEach(() => {
  if (previousServiceKey === undefined) delete process.env.TKO_SERVICE_KEY
  else process.env.TKO_SERVICE_KEY = previousServiceKey
})

async function signUp(app: any, username: string): Promise<string> {
  const response = await request(app).post('/api/auth/signup').send({
    email: `${username}@tko.cam`,
    password: 'password123',
    username,
    date_of_birth: ADULT_DOB,
  })
  expect(response.status).toBe(200)
  return response.body.user.id
}

function credit(app: any, composite: string, matchKey: string, userIds: string[]) {
  return request(app)
    .post('/api/internal/credit-produced')
    .set('x-tko-service', SERVICE_KEY)
    .send({
      composite_youtube_id: composite,
      match_key: matchKey,
      angles: userIds.map((userId, index) => ({
        user_id: userId,
        source_youtube_id: `source-${index + 1}`,
      })),
    })
}

describe('POST /api/internal/credit-produced canonical feed writes', () => {
  it('creates one immutable version per produced upload and remains idempotent', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const players = [
      await signUp(app, 'creditrouteone'),
      await signUp(app, 'creditroutetwo'),
    ]

    const first = await credit(app, 'produced-v1', 'match-route-1', players)
    expect(first.status).toBe(200)
    expect(first.body.credited).toHaveLength(2)

    const duplicate = await credit(app, 'produced-v1', 'match-route-1', players)
    expect(duplicate.status).toBe(200)

    const replacement = await credit(app, 'produced-v2', 'match-route-1', players)
    expect(replacement.status).toBe(200)

    const versions = await pool.query(
      `select version,youtube_id,angle_count,participant_ids
         from match_versions
        where match_key=$1
        order by version`,
      ['match-route-1'],
    )
    expect(versions.rows.map((row: any) => ({
      version: Number(row.version),
      youtubeId: row.youtube_id,
      angleCount: Number(row.angle_count),
    }))).toEqual([
      { version: 1, youtubeId: 'produced-v1', angleCount: 2 },
      { version: 2, youtubeId: 'produced-v2', angleCount: 2 },
    ])
    expect(versions.rows[1].participant_ids).toEqual(expect.arrayContaining(players))
  })

  // The chips under a produced video read player_handle off clip_records
  // through the PUBLIC /api/db select. The route used to drop the handle the
  // pipeline sent, so every chip rendered the placeholder "player".
  it('stores the gamertag each angle was sent with, publicly readable', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const hammy = await signUp(app, 'hammyroutecredit')
    const jerry = await signUp(app, 'jerryroutecredit')

    const response = await request(app)
      .post('/api/internal/credit-produced')
      .set('x-tko-service', SERVICE_KEY)
      .send({
        composite_youtube_id: 'produced-handles',
        match_key: 'match-handles',
        angles: [
          { user_id: hammy, handle: '@Hammy', source_youtube_id: 'raw-1' },
          { user_id: jerry, handle: 'MrJerrySS', source_youtube_id: 'raw-2' },
        ],
      })
    expect(response.status).toBe(200)
    expect(response.body.credited.map((c: any) => c.player_handle).sort()).toEqual(['Hammy', 'MrJerrySS'])

    // Exactly the read the app makes, with NO auth header at all.
    const read = await request(app).post('/api/db').send({
      table: 'clip_records',
      action: 'select',
      columns: 'composite_youtube_id, player_id, player_handle',
      filters: [{ col: 'composite_youtube_id', op: 'eq', val: 'produced-handles' }],
    })
    expect(read.status).toBe(200)
    const byPlayer = Object.fromEntries(
      read.body.data.map((row: any) => [row.player_id, row.player_handle]),
    )
    expect(byPlayer[hammy]).toBe('Hammy')
    expect(byPlayer[jerry]).toBe('MrJerrySS')
  })

  it('fails closed without the service key', async () => {
    const app = createApp(makeDb())
    const response = await request(app)
      .post('/api/internal/credit-produced')
      .send({ composite_youtube_id: 'produced', match_key: 'match', angles: [{}] })

    expect(response.status).toBe(401)
  })
})
