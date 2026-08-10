/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

const KEY = 'shadow-test-key'

describe('shadow match evidence boundary', () => {
  let pool: any
  let app: any
  beforeEach(() => {
    process.env.TKO_SERVICE_KEY = KEY
    pool = makeDb()
    app = createApp(pool)
  })

  it('requires the service key and stores evidence without official effects', async () => {
    const denied = await request(app).post('/api/internal/shadow-match-evidence').send({})
    expect(denied.status).toBe(401)

    const response = await request(app)
      .post('/api/internal/shadow-match-evidence')
      .set('x-tko-service', KEY)
      .send({
        source_fingerprint: 'group-001',
        source_ref: 'confirmed-match-1',
        status: 'needs_review',
        verdict: { winning_team: 'blue' },
        confidence: 0.76,
        evidence_quality: 0.82,
        analyzer: 'pc-local-plus-cloud-review',
        model: 'tko-ss',
        participants: [
          { detected_name: 'Hammy', team: 'blue', outcome: 'win', confidence: 0.8 },
          { detected_name: 'Opponent', team: 'red', outcome: 'loss', confidence: 0.7 },
        ],
      })
    expect(response.status).toBe(200)
    expect(response.body.official_state_changed).toBe(false)
    expect(response.body.participants).toHaveLength(2)

    const shadow = await pool.query('select * from shadow_match_analyses where source_fingerprint=$1', ['group-001'])
    expect(shadow.rows[0]).toMatchObject({ status: 'needs_review', analyzer: 'pc-local-plus-cloud-review' })
    const matchGroups = await pool.query('select * from match_groups')
    const conquest = await pool.query('select * from clan_conquest_state')
    expect(matchGroups.rows).toHaveLength(0)
    expect(conquest.rows).toHaveLength(0)
  })
})
