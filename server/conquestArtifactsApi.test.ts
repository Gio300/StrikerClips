import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

const ADULT_DOB = '1990-04-12'

describe('Conquest artifact API', () => {
  const pool = makeDb()
  const app = createApp(pool as any)
  let token = ''
  let userId = ''
  let clanId = ''
  let baseId = ''
  let artifactId = ''

  beforeAll(async () => {
    const signup = await request(app).post('/api/auth/signup').send({
      email: 'forge-leader@tko.cam',
      password: 'password123',
      username: 'forgeleader',
      date_of_birth: ADULT_DOB,
    })
    token = signup.body.token
    userId = signup.body.user.id
    await pool.query(
      `update users
          set user_metadata=$1
        where id=$2`,
      [JSON.stringify({
        ...signup.body.user.user_metadata,
        reelone_tier: 'creator',
      }), userId],
    )
    clanId = (await pool.query(
      `insert into servers (name, owner_id) values ('Forge Clan',$1) returning id`,
      [userId],
    )).rows[0].id
    await pool.query(
      `insert into clan_members (server_id, user_id, role)
       values ($1,$2,'leader')`,
      [clanId, userId],
    )
    baseId = (await pool.query(
      `insert into territories (name, col, row, owner_clan_id, captured_at)
       values ('Base',0,0,$1,now()) returning id`,
      [clanId],
    )).rows[0].id
    await pool.query(
      `insert into territories (name, col, row) values
       ('North',0,1),('East',1,0),('Far East',2,0),('South',0,-1),('West',-1,0)`,
    )
  })

  it('returns fixed recipes and Legend limits', async () => {
    const response = await request(app)
      .post('/api/fn/conquest-artifact-config')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(response.status).toBe(200)
    expect(response.body.tier).toBe('creator')
    expect(response.body.limits.activeSlots).toBe(3)
    expect(response.body.recipes.some((recipe: any) => (
      recipe.code === 'legendary-clan-campaign' &&
      recipe.listPriceCents === 9999
    ))).toBe(true)
    expect(response.body.official_recipes).toEqual([])
  })

  it('forges the server recipe without accepting custom power amounts', async () => {
    const response = await request(app)
      .post('/api/fn/conquest-artifact-forge')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clanId,
        recipeCode: 'legendary-clan-campaign',
        effects: [{ kind: 'territory_tiles', amount: 9999 }],
      })
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    artifactId = response.body.artifact.id
    expect(response.body.artifact.price_cents).toBe(9999)
    expect(response.body.artifact.slot_cost).toBe(3)
    expect(response.body.artifact.power_payload).toEqual([
      { kind: 'territory_tiles', amount: 4 },
      { kind: 'basic_clan_passes', amount: 10 },
      { kind: 'kill_lead', amount: 10 },
      { kind: 'base_shield_hours', amount: 24 },
      { kind: 'rivalry_resets', amount: 1 },
    ])
  })

  it('activates the bundle once and applies all bounded clan effects', async () => {
    const response = await request(app)
      .post('/api/fn/conquest-artifact-activate')
      .set('Authorization', `Bearer ${token}`)
      .send({ artifactId, targetTerritoryId: baseId })
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    expect(response.body.claimed_territory_ids).toHaveLength(4)
    expect(response.body.protected_territory_id).toBe(baseId)
    expect(response.body.pass_count).toBe(10)
    expect(response.body.rivalry_reset).toBe(true)

    const base = (await pool.query(
      'select protected_until from territories where id=$1',
      [baseId],
    )).rows[0]
    expect(new Date(base.protected_until).getTime()).toBeGreaterThan(Date.now())
    const passes = (await pool.query(
      'select remaining_count from clan_basic_pass_pools where clan_id=$1',
      [clanId],
    )).rows[0]
    expect(Number(passes.remaining_count)).toBe(10)
    const state = (await pool.query(
      'select reset_count from clan_conquest_state where clan_id=$1',
      [clanId],
    )).rows[0]
    expect(Number(state.reset_count)).toBe(1)
  })

  it('refuses a second activation of the same artifact', async () => {
    const response = await request(app)
      .post('/api/fn/conquest-artifact-activate')
      .set('Authorization', `Bearer ${token}`)
      .send({ artifactId, targetTerritoryId: baseId })
    expect(response.body).toMatchObject({ ok: false, reason: 'already-used' })
  })
})
