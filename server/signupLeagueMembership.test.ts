/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

const SERVICE_KEY = 'signup-league-membership-key'
const previous = {
  origins: process.env.APP_ORIGINS,
  service: process.env.TKO_SERVICE_KEY,
}

type LeagueSeed = {
  slug: string
  tier: 'starter' | 'pro' | 'dynasty' | 'enterprise'
  planStatus: 'none' | 'active' | 'comped'
  domain?: string | null
  customDomain?: string | null
  customStatus?: 'none' | 'pending' | 'verified'
}

async function seedLeague(pool: any, seed: LeagueSeed) {
  await pool.query(
    `insert into leagues
       (slug,name,domain,tier,plan_status,custom_domain,custom_domain_status)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      seed.slug,
      seed.slug.toUpperCase(),
      seed.domain ?? `${seed.slug}.tko.cam`,
      seed.tier,
      seed.planStatus,
      seed.customDomain ?? null,
      seed.customStatus ?? 'none',
    ],
  )
}

function signup(app: any, suffix: string, headers: Record<string, string> = {}, extra: Record<string, any> = {}) {
  let call = request(app)
    .post('/api/auth/signup')
    .send({
      email: `${suffix}@membership.test`,
      password: 'password123',
      username: suffix.replace(/[^a-z0-9_]/gi, '_'),
      youtube_url: `https://www.youtube.com/@${suffix.replace(/[^a-z0-9]/gi, '')}`,
      ...extra,
    })
  for (const [name, value] of Object.entries(headers)) call = call.set(name, value)
  return call
}

async function memberships(pool: any, userId: string) {
  return (await pool.query(
    `select l.slug,m.role
       from league_members m join leagues l on l.id=m.league_id
      where m.user_id=$1
      order by l.slug`,
    [userId],
  )).rows
}

describe('signup league membership from the served address', () => {
  let pool: any
  let app: any

  beforeEach(() => {
    process.env.APP_ORIGINS = [
      'https://onyx.gg',
      'https://shinobistrikerleague.com',
      'https://www.shinobistrikerleague.com',
    ].join(',')
    process.env.TKO_SERVICE_KEY = SERVICE_KEY
    pool = makeDb()
    app = createApp(pool)
  })

  afterEach(() => {
    if (previous.origins === undefined) delete process.env.APP_ORIGINS
    else process.env.APP_ORIGINS = previous.origins
    if (previous.service === undefined) delete process.env.TKO_SERVICE_KEY
    else process.env.TKO_SERVICE_KEY = previous.service
  })

  it('enrolls a custom-domain signup as member and returns that slug to the factory roster', async () => {
    await seedLeague(pool, {
      slug: 'onyx',
      tier: 'enterprise',
      planStatus: 'active',
      domain: 'onyx.gg',
      customDomain: 'onyx.gg',
      customStatus: 'verified',
    })

    // This is the standalone-frontend shape: its API base is tko.cam, while
    // Origin/Referer identify the league app the player actually used.
    const created = await signup(app, 'onyxplayer', {
      Host: 'tko.cam',
      Origin: 'https://onyx.gg',
      Referer: 'https://onyx.gg/signup',
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    expect(await memberships(pool, created.body.user.id)).toEqual([
      { slug: 'onyx', role: 'member' },
    ])

    const roster = await request(app)
      .post('/api/internal/auto-merge-channels')
      .set('x-tko-service', SERVICE_KEY)
      .send({})
    expect(roster.status).toBe(200)
    expect(roster.body.channels).toContainEqual(expect.objectContaining({
      user_id: created.body.user.id,
      username: 'onyxplayer',
      league: 'onyx',
    }))
  })

  it('enrolls SSL from its grandfathered Amplify origin only while its Enterprise plan is entitled', async () => {
    await seedLeague(pool, {
      slug: 'shinobistrikerleague',
      tier: 'enterprise',
      planStatus: 'comped',
      domain: 'shinobistrikerleague.com',
    })

    const created = await signup(app, 'sslplayer', {
      Host: 'tko.cam',
      Origin: 'https://www.shinobistrikerleague.com',
      Referer: 'https://www.shinobistrikerleague.com/signup',
    }, {
      // A body slug is deliberately ignored; the server-owned address wins.
      league_slug: 'some-other-league',
    })
    expect(created.status).toBe(200)
    expect(await memberships(pool, created.body.user.id)).toEqual([
      { slug: 'shinobistrikerleague', role: 'member' },
    ])
  })

  it('accepts an entitled league subdomain but refuses unpaid and unverified addresses', async () => {
    await seedLeague(pool, { slug: 'blaze', tier: 'pro', planStatus: 'active' })
    await seedLeague(pool, { slug: 'ember', tier: 'starter', planStatus: 'active' })
    await seedLeague(pool, {
      slug: 'pending',
      tier: 'enterprise',
      planStatus: 'active',
      domain: 'pending.gg',
      customDomain: 'pending.gg',
      customStatus: 'pending',
    })

    const blaze = await signup(app, 'blazeplayer', { Host: 'blaze.tko.cam' })
    expect(blaze.status).toBe(200)
    expect(await memberships(pool, blaze.body.user.id)).toEqual([
      { slug: 'blaze', role: 'member' },
    ])

    const ember = await signup(app, 'emberplayer', { Host: 'ember.tko.cam' })
    expect(ember.status).toBe(200)
    expect(await memberships(pool, ember.body.user.id)).toEqual([])

    const pending = await signup(app, 'pendingplayer', { Host: 'pending.gg' })
    expect(pending.status).toBe(200)
    expect(await memberships(pool, pending.body.user.id)).toEqual([])
  })

  it('ignores arbitrary body slugs and cross-origin headers outside the server allow-list', async () => {
    await seedLeague(pool, {
      slug: 'onyx',
      tier: 'enterprise',
      planStatus: 'active',
      domain: 'onyx.gg',
      customDomain: 'onyx.gg',
      customStatus: 'verified',
    })

    const created = await signup(app, 'outsider', {
      Host: 'tko.cam',
      Origin: 'https://evil.example',
      // Even an otherwise allow-listed Referer cannot override an explicit
      // untrusted Origin.
      Referer: 'https://onyx.gg/signup',
    }, { league: 'onyx', league_slug: 'onyx' })
    expect(created.status).toBe(200)
    expect(await memberships(pool, created.body.user.id)).toEqual([])
  })

  it('idempotently repairs existing users on login and session refresh without demoting an owner', async () => {
    await seedLeague(pool, {
      slug: 'onyx',
      tier: 'enterprise',
      planStatus: 'active',
      domain: 'onyx.gg',
      customDomain: 'onyx.gg',
      customStatus: 'verified',
    })

    const owner = await signup(app, 'existingowner', { Host: 'tko.cam' })
    const league = (await pool.query('select id from leagues where slug=$1', ['onyx'])).rows[0]
    await pool.query(
      `insert into league_members (league_id,user_id,role) values ($1,$2,'owner')`,
      [league.id, owner.body.user.id],
    )
    const ownerLogin = await request(app)
      .post('/api/auth/login')
      .set('Host', 'tko.cam')
      .set('Origin', 'https://onyx.gg')
      .send({ email: 'existingowner@membership.test', password: 'password123' })
    expect(ownerLogin.status).toBe(200)
    expect(await memberships(pool, owner.body.user.id)).toEqual([
      { slug: 'onyx', role: 'owner' },
    ])

    const returning = await signup(app, 'returningplayer', { Host: 'tko.cam' })
    expect(await memberships(pool, returning.body.user.id)).toEqual([])
    const refreshed = await request(app)
      .get('/api/auth/me')
      .set('Host', 'tko.cam')
      .set('Origin', 'https://onyx.gg')
      .set('authorization', `Bearer ${returning.body.token}`)
    expect(refreshed.status).toBe(200)
    expect(await memberships(pool, returning.body.user.id)).toEqual([
      { slug: 'onyx', role: 'member' },
    ])
  })

  it('keeps a complete account usable when the optional membership insert is temporarily unavailable', async () => {
    await seedLeague(pool, {
      slug: 'onyx',
      tier: 'enterprise',
      planStatus: 'active',
      domain: 'onyx.gg',
      customDomain: 'onyx.gg',
      customStatus: 'verified',
    })
    await pool.query('drop table league_members')

    const created = await signup(app, 'retrylater', {
      Host: 'tko.cam',
      Origin: 'https://onyx.gg',
    })
    expect(created.status, JSON.stringify(created.body)).toBe(200)
    expect((await pool.query('select email from users where id=$1', [created.body.user.id])).rows).toEqual([
      { email: 'retrylater@membership.test' },
    ])

    const login = await request(app)
      .post('/api/auth/login')
      .set('Host', 'tko.cam')
      .set('Origin', 'https://onyx.gg')
      .send({ email: 'retrylater@membership.test', password: 'password123' })
    expect(login.status).toBe(200)
  })
})
