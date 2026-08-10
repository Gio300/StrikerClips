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

// ===========================================================================
// UNIFIED FORGE — /api/fn/forge-artifact-save (tier gates + validation).
// Client section locks are cosmetic; these prove the SERVER enforces the
// src/lib/forgeTiers.ts mapping: powers=Pro+, price=Elite+, shirt=Legend.
// ===========================================================================
describe('Unified forge artifact save', () => {
  const pool = makeDb()
  const app = createApp(pool as any)
  let token = ''
  let userId = ''
  let otherToken = ''
  let otherUserId = ''

  const setTier = async (id: string, tier: string) => {
    const row = await pool.query('select user_metadata from users where id=$1', [id])
    const meta = typeof row.rows[0]?.user_metadata === 'string'
      ? JSON.parse(row.rows[0].user_metadata)
      : (row.rows[0]?.user_metadata || {})
    if (tier) meta.reelone_tier = tier
    else delete meta.reelone_tier
    await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), id])
  }

  const save = (body: Record<string, unknown>, asToken = token) =>
    request(app)
      .post('/api/fn/forge-artifact-save')
      .set('Authorization', `Bearer ${asToken}`)
      .send(body)

  beforeAll(async () => {
    const signup = await request(app).post('/api/auth/signup').send({
      email: 'unified-forge@tko.cam',
      password: 'password123',
      username: 'unifiedforger',
      date_of_birth: ADULT_DOB,
    })
    token = signup.body.token
    userId = signup.body.user.id
    const other = await request(app).post('/api/auth/signup').send({
      email: 'unified-forge-other@tko.cam',
      password: 'password123',
      username: 'otherforger',
      date_of_birth: ADULT_DOB,
    })
    otherToken = other.body.token
    otherUserId = other.body.user.id
  })

  it('lets a FREE member forge a basic artifact (owner forced to the caller)', async () => {
    const response = await save({ name: '  Basic   Blade ', rarity: 'epic', capability: 'none' })
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    expect(response.body.artifact.owner_id).toBe(userId)
    expect(response.body.artifact.name).toBe('Basic Blade')
    expect(response.body.artifact.rarity).toBe('epic')
    expect(response.body.artifact.price_cents).toBeNull()
  })

  it('403s a FREE member posting powers', async () => {
    const response = await save({ name: 'Nope', powers: [{ name: 'Dash', description: 'Fast' }] })
    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ ok: false, reason: 'membership-upgrade-required', capability: 'powers' })
  })

  it('403s a FREE member posting a price or a shirt', async () => {
    const price = await save({ name: 'Nope', priceCents: 500 })
    expect(price.status).toBe(403)
    expect(price.body.capability).toBe('price')
    const shirt = await save({ name: 'Nope', shirtProductId: '00000000-0000-4000-8000-000000000000' })
    expect(shirt.status).toBe(403)
    expect(shirt.body.capability).toBe('shirt')
  })

  it('PRO may attach powers; validation still applies', async () => {
    await setTier(userId, 'pro')
    const tooMany = await save({
      name: 'Overloaded',
      powers: [1, 2, 3, 4, 5].map((n) => ({ name: `P${n}`, description: '' })),
    })
    expect(tooMany.status).toBe(400)
    const nameless = await save({ name: 'Nameless', powers: [{ name: '  ', description: 'x' }] })
    expect(nameless.status).toBe(400)
    const longName = await save({ name: 'Long', powers: [{ name: 'x'.repeat(41), description: '' }] })
    expect(longName.status).toBe(400)

    const good = await save({
      name: 'Empowered',
      powers: [
        { name: 'Shadow Step', description: 'Teleport behind the target.' },
        { name: 'Iron Skin', description: '' },
      ],
    })
    expect(good.status).toBe(200)
    expect(good.body.ok).toBe(true)
    const stored = typeof good.body.artifact.powers === 'string'
      ? JSON.parse(good.body.artifact.powers)
      : good.body.artifact.powers
    expect(stored).toEqual([
      { name: 'Shadow Step', description: 'Teleport behind the target.' },
      { name: 'Iron Skin', description: '' },
    ])
  })

  it('PRO still may NOT attach a price (Elite+ only)', async () => {
    const response = await save({ name: 'Priced', priceCents: 500 })
    expect(response.status).toBe(403)
    expect(response.body.capability).toBe('price')
  })

  it('ELITE may attach a price; out-of-range values are refused', async () => {
    await setTier(userId, 'supporter')
    const over = await save({ name: 'Too pricey', priceCents: 100_001 })
    expect(over.status).toBe(400)
    const negative = await save({ name: 'Negative', priceCents: -1 })
    expect(negative.status).toBe(400)
    const fractional = await save({ name: 'Fraction', priceCents: 12.5 })
    expect(fractional.status).toBe(400)

    const good = await save({ name: 'Fairly priced', priceCents: 2500 })
    expect(good.status).toBe(200)
    expect(Number(good.body.artifact.price_cents)).toBe(2500)
  })

  it('ELITE still may NOT bundle a shirt (Legend only)', async () => {
    const response = await save({ name: 'Shirted', shirtProductId: '00000000-0000-4000-8000-000000000000' })
    expect(response.status).toBe(403)
    expect(response.body.capability).toBe('shirt')
  })

  it('LEGEND may bundle only a shirt THEY designed', async () => {
    await setTier(userId, 'creator')
    // A shirt product owned by the OTHER member is refused…
    const base = await save({ name: 'Shirt base' })
    const foreignShirt = (await pool.query(
      `insert into physical_merch_products
         (artifact_id, seller_user_id, title, artwork_url, sale_price_cents, ip_attested_at)
       values ($1,$2,'Not Yours Tee','https://cdn.example.test/tee.png',2500,now())
       returning id`,
      [base.body.artifact.id, otherUserId],
    )).rows[0].id
    const stolen = await save({ name: 'Bundled', shirtProductId: String(foreignShirt) })
    expect(stolen.status).toBe(400)

    // …while their OWN designed shirt attaches and lands in shirt_ref.
    const ownBase = await save({ name: 'Own shirt base' })
    const ownShirt = (await pool.query(
      `insert into physical_merch_products
         (artifact_id, seller_user_id, title, artwork_url, sale_price_cents, ip_attested_at)
       values ($1,$2,'My Forge Tee','https://cdn.example.test/mine.png',2900,now())
       returning id`,
      [ownBase.body.artifact.id, userId],
    )).rows[0].id
    const bundled = await save({ name: 'Bundle', shirtProductId: String(ownShirt) })
    expect(bundled.status).toBe(200)
    expect(String(bundled.body.artifact.shirt_ref)).toBe(String(ownShirt))
  })

  it('updates are owner-only', async () => {
    const mine = await save({ name: 'Mine' })
    const theft = await save(
      { artifactId: mine.body.artifact.id, name: 'Stolen' },
      otherToken,
    )
    expect(theft.status).toBe(404)
    const kept = await pool.query('select name from artifacts where id=$1', [mine.body.artifact.id])
    expect(kept.rows[0].name).toBe('Mine')

    const renamed = await save({ artifactId: mine.body.artifact.id, name: 'Renamed' })
    expect(renamed.status).toBe(200)
    expect(renamed.body.artifact.name).toBe('Renamed')
  })

  it('lets the owner remove an unused artifact and refuses another account', async () => {
    const mine = await save({ name: 'Remove Me' })
    const remove = (artifactId: string, asToken = token) => request(app)
      .post('/api/fn/forge-artifact-delete')
      .set('Authorization', `Bearer ${asToken}`)
      .send({ artifactId })

    const theft = await remove(mine.body.artifact.id, otherToken)
    expect(theft.status).toBe(404)
    expect((await pool.query('select id from artifacts where id=$1', [mine.body.artifact.id])).rows).toHaveLength(1)

    const removed = await remove(mine.body.artifact.id)
    expect(removed.status).toBe(200)
    expect(removed.body.ok).toBe(true)
    expect((await pool.query('select id from artifacts where id=$1', [mine.body.artifact.id])).rows).toHaveLength(0)
  })

  it('keeps a linked marketplace listing in sync and removes it with an unsold collectible', async () => {
    const mine = await save({ name: 'Market Original', imageUrl: 'https://cdn.example.test/original.png' })
    const artifactId = String(mine.body.artifact.id)
    const listing = await request(app)
      .post('/api/db')
      .set('Authorization', `Bearer ${token}`)
      .send({
        table: 'assets',
        action: 'insert',
        single: true,
        values: {
          id: artifactId,
          name: 'Market Original',
          team_name: 'Creator',
          image_url: 'https://cdn.example.test/original.png',
          price_tokens: 100,
          kind: 'badge_skin',
          seller_type: 'creator',
        },
      })
    expect(listing.status).toBe(200)

    const idSquat = await request(app)
      .post('/api/db')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        table: 'assets',
        action: 'insert',
        values: { id: artifactId, name: 'Stolen listing', kind: 'badge_skin', seller_type: 'creator' },
      })
    expect(idSquat.status).toBe(403)

    const edited = await save({
      artifactId,
      name: 'Market Renamed',
      imageUrl: 'https://cdn.example.test/renamed.png',
    })
    expect(edited.status).toBe(200)
    expect((await pool.query('select name,image_url from assets where id=$1', [artifactId])).rows[0])
      .toMatchObject({ name: 'Market Renamed', image_url: 'https://cdn.example.test/renamed.png' })

    const removed = await request(app)
      .post('/api/fn/forge-artifact-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ artifactId })
    expect(removed.status).toBe(200)
    expect((await pool.query('select id from artifacts where id=$1', [artifactId])).rows).toHaveLength(0)
    expect((await pool.query('select id from assets where id=$1', [artifactId])).rows).toHaveLength(0)
  })

  it('does not remove a collectible or listing already owned by marketplace buyers', async () => {
    const mine = await save({ name: 'Purchased Market Item' })
    const artifactId = String(mine.body.artifact.id)
    await pool.query(
      `insert into assets (id,name,kind,created_by,origin,seller_type)
       values ($1,'Purchased Market Item','badge_skin',$2,'user','creator')`,
      [artifactId, userId],
    )
    await pool.query(
      `insert into asset_ownership (user_id,asset_id,source)
       values ($1,$2,'purchase')`,
      [otherUserId, artifactId],
    )

    const removed = await request(app)
      .post('/api/fn/forge-artifact-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ artifactId })
    expect(removed.status).toBe(409)
    expect(removed.body.error).toMatch(/belongs to players/i)
    expect((await pool.query('select id from artifacts where id=$1', [artifactId])).rows).toHaveLength(1)
    expect((await pool.query('select id from assets where id=$1', [artifactId])).rows).toHaveLength(1)
  })

  it('keeps used artifacts in collection history', async () => {
    const mine = await save({ name: 'Used Artifact' })
    await pool.query('update artifacts set used_at=now() where id=$1', [mine.body.artifact.id])
    const removed = await request(app)
      .post('/api/fn/forge-artifact-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ artifactId: mine.body.artifact.id })
    expect(removed.status).toBe(409)
    expect((await pool.query('select id from artifacts where id=$1', [mine.body.artifact.id])).rows).toHaveLength(1)
  })

  it('refuses to edit a conquest (recipe-forged) artifact here', async () => {
    const conquest = (await pool.query(
      `insert into artifacts (owner_id, slug, name, recipe_code)
       values ($1,'scout-mark','Scout Mark','scout-mark') returning id`,
      [userId],
    )).rows[0].id
    const response = await save({ artifactId: String(conquest), name: 'Hacked' })
    expect(response.status).toBe(403)
    const removed = await request(app)
      .post('/api/fn/forge-artifact-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ artifactId: String(conquest) })
    expect(removed.status).toBe(403)
    expect((await pool.query('select id from artifacts where id=$1', [conquest])).rows).toHaveLength(1)
  })

  it('the generic /api/db path scrubs powers/price_cents/shirt_ref', async () => {
    const response = await request(app)
      .post('/api/db')
      .set('Authorization', `Bearer ${token}`)
      .send({
        table: 'artifacts',
        action: 'insert',
        single: true,
        values: {
          slug: 'forged',
          name: 'Sneaky',
          powers: JSON.stringify([{ name: 'Admin', description: 'god mode' }]),
          price_cents: 99_999,
          shirt_ref: '00000000-0000-4000-8000-000000000000',
        },
      })
    expect(response.status).toBe(200)
    const row = response.body.data
    expect(row.name).toBe('Sneaky')
    expect(row.price_cents ?? null).toBeNull()
    expect(row.shirt_ref ?? null).toBeNull()
    const powers = typeof row.powers === 'string' ? JSON.parse(row.powers) : row.powers
    expect(powers).toEqual([])
  })
})

// ===========================================================================
// UNIFIED FORGE — /api/fn/forge-artifact-list (the READ side).
// Forging used to be write-only: powers, price and the bundled shirt were
// saved and never shown back. These prove the owner can now read their own
// collection WITH those extras, and that nobody can read anyone else's.
// ===========================================================================
describe('Unified forge artifact list', () => {
  const pool = makeDb()
  const app = createApp(pool as any)
  let token = ''
  let userId = ''
  let otherToken = ''
  let otherUserId = ''

  const list = (asToken: string) =>
    request(app).post('/api/fn/forge-artifact-list').set('Authorization', `Bearer ${asToken}`).send({})

  beforeAll(async () => {
    const signup = await request(app).post('/api/auth/signup').send({
      email: 'forge-list@tko.cam',
      password: 'password123',
      username: 'forgelister',
      date_of_birth: ADULT_DOB,
    })
    token = signup.body.token
    userId = signup.body.user.id
    await pool.query(
      'update users set user_metadata=$1 where id=$2',
      [JSON.stringify({ ...signup.body.user.user_metadata, reelone_tier: 'creator' }), userId],
    )
    const other = await request(app).post('/api/auth/signup').send({
      email: 'forge-list-other@tko.cam',
      password: 'password123',
      username: 'forgelistother',
      date_of_birth: ADULT_DOB,
    })
    otherToken = other.body.token
    otherUserId = other.body.user.id
  })

  it('requires a signed-in caller', async () => {
    const response = await request(app).post('/api/fn/forge-artifact-list').send({})
    expect(response.status).toBe(401)
  })

  it('returns the caller’s artifact WITH its powers, price and paired shirt', async () => {
    const base = await request(app)
      .post('/api/fn/forge-artifact-save')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Shirt anchor' })
    const shirtId = (await pool.query(
      `insert into physical_merch_products
         (artifact_id, seller_user_id, title, artwork_url, sale_price_cents, ip_attested_at)
       values ($1,$2,'Forge Tee','https://cdn.example.test/tee.png',2900,now())
       returning id`,
      [base.body.artifact.id, userId],
    )).rows[0].id

    const saved = await request(app)
      .post('/api/fn/forge-artifact-save')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Kunai of Proof',
        rarity: 'legendary',
        powers: [{ name: 'Shadow Step', description: 'Blink behind the target.' }],
        priceCents: 4200,
        shirtProductId: String(shirtId),
      })
    expect(saved.status).toBe(200)

    const response = await list(token)
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    const artifact = response.body.artifacts.find((a: any) => a.name === 'Kunai of Proof')
    expect(artifact).toBeTruthy()
    expect(artifact.rarity).toBe('legendary')
    expect(artifact.powers).toEqual([{ name: 'Shadow Step', description: 'Blink behind the target.' }])
    expect(artifact.price_cents).toBe(4200)
    expect(artifact.shirt).toMatchObject({ title: 'Forge Tee', sale_price_cents: 2900 })
    expect(artifact.conquest).toBe(false)
  })

  it('never returns another member’s artifacts', async () => {
    await request(app)
      .post('/api/fn/forge-artifact-save')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Someone Else Blade' })

    const mine = await list(token)
    expect(mine.body.artifacts.some((a: any) => a.name === 'Someone Else Blade')).toBe(false)

    const theirs = await list(otherToken)
    expect(theirs.body.artifacts.every((a: any) => a.name !== 'Kunai of Proof')).toBe(true)
    expect(theirs.body.artifacts.some((a: any) => a.name === 'Someone Else Blade')).toBe(true)
    expect(otherUserId).toBeTruthy()
  })

  it('marks recipe-forged conquest artifacts so they are not editable in the Forge', async () => {
    await pool.query(
      `insert into artifacts (owner_id, slug, name, recipe_code)
       values ($1,'scout-mark','Scout Mark','scout-mark')`,
      [userId],
    )
    const response = await list(token)
    const conquest = response.body.artifacts.find((a: any) => a.name === 'Scout Mark')
    expect(conquest.conquest).toBe(true)
    expect(conquest.powers).toEqual([])
  })
})
