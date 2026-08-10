/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LEAGUE URL IDENTITY — the server half (operator 2026-08-04).
 *
 * The dangerous bug this suite exists to prevent: a league getting an ADDRESS
 * it did not pay for. The Studio draft carries a tier the owner can flip with
 * a radio button, and the claim/verify endpoints take a JSON body — so every
 * test here pushes on the boundary between "what the client says" and "what
 * the leagues row says", and asserts the row always wins.
 *
 * DNS is stubbed through server/leagueUrl.ts's swappable resolver, the same
 * trick the Vertex/Stripe suites use on `fetch`, so the ownership challenge is
 * exercised end to end without a network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { makeDb } from './testHarness'
import { createApp, hostGateDecision } from './app'
import { setTxtResolver } from './leagueUrl'

const ADULT_DOB = '1995-06-15'

async function signUp(app: any, email: string, username: string) {
  const r = await request(app).post('/api/auth/signup').send({
    email, password: 'password123', username, date_of_birth: ADULT_DOB,
  })
  expect(r.status).toBe(200)
  return { token: r.body.token as string, id: r.body.user.id as string }
}

/**
 * Insert a league owned by `ownerId` at `tier`. `planStatus` defaults to
 * 'active' because most cases are about the TIER ladder; the tests that care
 * about the PAID gate pass 'none' explicitly.
 */
async function makeLeague(
  pool: any, slug: string, ownerId: string, tier: string, planStatus = 'active',
) {
  await pool.query(
    `insert into leagues (slug, name, domain, tier, plan_status, owner_id)
     values ($1,$2,$3,$4,$5,$6)`,
    [slug, slug.toUpperCase(), `${slug}.tko.cam`, tier, planStatus, ownerId],
  )
  const r = await pool.query('select id from leagues where slug=$1', [slug])
  return r.rows[0].id as string
}

describe('POST /api/fn/league-url-*', () => {
  let app: any
  let pool: any
  let restoreDns: (() => void) | null = null

  beforeEach(() => {
    pool = makeDb()
    app = createApp(pool)
  })
  afterEach(() => {
    restoreDns?.()
    restoreDns = null
  })

  const call = (token: string, action: string, body: any) =>
    request(app).post(`/api/fn/league-url-${action}`).set('Authorization', `Bearer ${token}`).send(body)

  it('requires authentication', async () => {
    const r = await request(app).post('/api/fn/league-url-status').send({ slug: 'blaze' })
    expect(r.status).toBe(401)
  })

  it('refuses a league you do not manage', async () => {
    const owner = await signUp(app, 'own1@kc.gg', 'own1')
    const stranger = await signUp(app, 'str1@kc.gg', 'str1')
    await makeLeague(pool, 'blaze', owner.id, 'dynasty')
    const r = await call(stranger.token, 'status', { slug: 'blaze' })
    expect(r.status).toBe(403)
  })

  it('404s an unknown league and 400s a malformed slug', async () => {
    const u = await signUp(app, 'own2@kc.gg', 'own2')
    expect((await call(u.token, 'status', { slug: 'nosuchleague' })).status).toBe(404)
    expect((await call(u.token, 'status', { slug: 'NOT A SLUG' })).status).toBe(400)
  })

  // ── RUNG 1 ────────────────────────────────────────────────────────────────
  it('STARTER gets the path address and nothing else', async () => {
    const u = await signUp(app, 'st@kc.gg', 'st')
    await makeLeague(pool, 'blaze', u.id, 'starter')
    const r = await call(u.token, 'status', { slug: 'blaze' })
    expect(r.status).toBe(200)
    expect(r.body.rungs.path).toMatchObject({ url: 'https://tko.cam/blaze', entitled: true })
    expect(r.body.rungs.subdomain).toMatchObject({ url: null, entitled: false, unlocks_with: 'Pro League' })
    expect(r.body.rungs.custom).toMatchObject({ url: null, entitled: false, unlocks_with: 'Dynasty' })
    expect(r.body.primary).toBe('https://tko.cam/blaze')
  })

  // ── RUNG 2 ────────────────────────────────────────────────────────────────
  it('PRO adds the subdomain', async () => {
    const u = await signUp(app, 'pr@kc.gg', 'pr')
    await makeLeague(pool, 'blaze', u.id, 'pro')
    const r = await call(u.token, 'status', { slug: 'blaze' })
    expect(r.body.rungs.subdomain).toMatchObject({ url: 'https://blaze.tko.cam', entitled: true })
    expect(r.body.rungs.custom.entitled).toBe(false)
    expect(r.body.primary).toBe('https://blaze.tko.cam')
  })

  // ── RUNG 3: the gate ──────────────────────────────────────────────────────
  it('REFUSES a custom-domain claim below the top plan — whatever the client sends', async () => {
    const u = await signUp(app, 'pr2@kc.gg', 'pr2')
    await makeLeague(pool, 'blaze', u.id, 'pro')
    // The body claims a tier it does not have; the ROW is what decides.
    const r = await call(u.token, 'claim', { slug: 'blaze', domain: 'blaze.gg', tier: 'dynasty' })
    expect(r.status).toBe(403)
    expect(String(r.body.error)).toContain('Dynasty')
    const row = await pool.query('select custom_domain from leagues where slug=$1', ['blaze'])
    expect(row.rows[0].custom_domain).toBeNull()
  })

  it('REFUSES everything above the path rung when the plan was never PAID for', async () => {
    // leagues.tier is Studio-editable; plan_status is webhook-only. A row that
    // says 'dynasty' with plan_status 'none' is a draft, not a purchase.
    const u = await signUp(app, 'unpaid@kc.gg', 'unpaid')
    await makeLeague(pool, 'blaze', u.id, 'dynasty', 'none')
    const status = await call(u.token, 'status', { slug: 'blaze' })
    expect(status.body.rungs.path).toMatchObject({ url: 'https://tko.cam/blaze', entitled: true })
    expect(status.body.rungs.subdomain.entitled).toBe(false)
    expect(status.body.rungs.custom.entitled).toBe(false)
    expect((await call(u.token, 'claim', { slug: 'blaze', domain: 'blaze.gg' })).status).toBe(403)
  })

  it('refuses a subdomain claim below Pro League', async () => {
    const u = await signUp(app, 'st2@kc.gg', 'st2')
    await makeLeague(pool, 'blaze', u.id, 'starter')
    const r = await call(u.token, 'claim', { slug: 'blaze', rung: 'subdomain' })
    expect(r.status).toBe(403)
    expect(String(r.body.error)).toContain('Pro League')
  })

  // ── RUNG 3: the happy path ────────────────────────────────────────────────
  it('claim → TXT challenge → verify → the domain becomes an address', async () => {
    const u = await signUp(app, 'en@kc.gg', 'en')
    await makeLeague(pool, 'blaze', u.id, 'dynasty')

    const claim = await call(u.token, 'claim', { slug: 'blaze', domain: 'https://WWW.Blaze.GG/join' })
    expect(claim.status).toBe(200)
    expect(claim.body.custom_domain).toBe('blaze.gg')          // normalized
    expect(claim.body.custom_domain_status).toBe('pending')
    expect(claim.body.verification).toMatchObject({ host: '_tko-verify.blaze.gg', type: 'TXT' })
    // Pending is NOT an address yet.
    expect(claim.body.rungs.custom.url).toBeNull()
    expect(claim.body.primary).toBe('https://blaze.tko.cam')
    const token = String(claim.body.verification.value).replace('tko-verify=', '')
    expect(token).toMatch(/^[a-f0-9]{32}$/)

    // DNS doesn't have it yet: ok:false, still pending, never a 500.
    restoreDns = setTxtResolver(async () => [['v=spf1 -all']])
    const early = await call(u.token, 'verify', { slug: 'blaze' })
    expect(early.status).toBe(200)
    expect(early.body.ok).toBe(false)
    expect(early.body.custom_domain_status).toBe('pending')

    // Owner publishes the record.
    restoreDns()
    restoreDns = setTxtResolver(async (host) => {
      expect(host).toBe('_tko-verify.blaze.gg')
      return [['v=spf1 -all'], [`tko-verify=${token}`]]
    })
    const ok = await call(u.token, 'verify', { slug: 'blaze' })
    expect(ok.body.ok).toBe(true)
    expect(ok.body.custom_domain_status).toBe('verified')
    expect(ok.body.rungs.custom.url).toBe('https://blaze.gg')
    expect(ok.body.primary).toBe('https://blaze.gg')
  })

  it('re-claiming the SAME domain keeps the token already published', async () => {
    const u = await signUp(app, 'en2@kc.gg', 'en2')
    await makeLeague(pool, 'blaze', u.id, 'dynasty')
    const a = await call(u.token, 'claim', { slug: 'blaze', domain: 'blaze.gg' })
    const b = await call(u.token, 'claim', { slug: 'blaze', domain: 'blaze.gg' })
    expect(b.body.verification.value).toBe(a.body.verification.value)
  })

  it('one domain, one league', async () => {
    const a = await signUp(app, 'en3@kc.gg', 'en3')
    const b = await signUp(app, 'en4@kc.gg', 'en4')
    await makeLeague(pool, 'blaze', a.id, 'dynasty')
    await makeLeague(pool, 'ember', b.id, 'dynasty')
    expect((await call(a.token, 'claim', { slug: 'blaze', domain: 'blaze.gg' })).status).toBe(200)
    const clash = await call(b.token, 'claim', { slug: 'ember', domain: 'blaze.gg' })
    expect(clash.status).toBe(409)
  })

  it('rejects junk and un-claimable domains (tko.cam is not claimable)', async () => {
    const u = await signUp(app, 'en5@kc.gg', 'en5')
    await makeLeague(pool, 'blaze', u.id, 'dynasty')
    for (const domain of ['', 'nodot', 'tko.cam', 'blaze.tko.cam', 'localhost', '10.0.0.1']) {
      const r = await call(u.token, 'claim', { slug: 'blaze', domain })
      expect(r.status).toBe(400)
    }
  })

  it('verify without a claim is a clean 400, not a crash', async () => {
    const u = await signUp(app, 'en6@kc.gg', 'en6')
    await makeLeague(pool, 'blaze', u.id, 'dynasty')
    expect((await call(u.token, 'verify', { slug: 'blaze' })).status).toBe(400)
  })

  it('release hands the domain back', async () => {
    const u = await signUp(app, 'en7@kc.gg', 'en7')
    await makeLeague(pool, 'blaze', u.id, 'dynasty')
    await call(u.token, 'claim', { slug: 'blaze', domain: 'blaze.gg' })
    const r = await call(u.token, 'release', { slug: 'blaze' })
    expect(r.body.custom_domain).toBe('')
    expect(r.body.custom_domain_status).toBe('none')
    const row = await pool.query('select custom_domain from leagues where slug=$1', ['blaze'])
    expect(row.rows[0].custom_domain).toBeNull()
  })

  it('an unknown action 404s rather than falling through', async () => {
    const u = await signUp(app, 'en8@kc.gg', 'en8')
    await makeLeague(pool, 'blaze', u.id, 'dynasty')
    expect((await call(u.token, 'nonsense', { slug: 'blaze' })).status).toBe(404)
  })
})

describe('GET /api/league/by-host + hostGateDecision (the tier made real)', () => {
  let app: any
  let pool: any
  beforeEach(async () => {
    pool = makeDb()
    app = createApp(pool)
    const owner = await signUp(app, 'host@kc.gg', 'hostuser')
    await makeLeague(pool, 'blaze', owner.id, 'pro')
    await makeLeague(pool, 'ember', owner.id, 'starter')
    await makeLeague(pool, 'onyx', owner.id, 'dynasty')
    await pool.query(
      `update leagues set custom_domain='onyx.gg', custom_domain_status='verified' where slug='onyx'`,
    )
  })

  it('serves a Pro league on its subdomain', async () => {
    expect(await hostGateDecision(pool, 'blaze.tko.cam')).toEqual({
      action: 'serve', slug: 'blaze', rung: 'subdomain',
    })
    const r = await request(app).get('/api/league/by-host').query({ host: 'blaze.tko.cam' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ slug: 'blaze', rung: 'subdomain', entitled: true })
  })

  it('redirects a Starter league off the subdomain, DOWN to its path address', async () => {
    expect(await hostGateDecision(pool, 'ember.tko.cam')).toEqual({
      action: 'redirect', slug: 'ember', to: '/ember', reason: 'tier',
    })
    const r = await request(app).get('/api/league/by-host').query({ host: 'ember.tko.cam' })
    expect(r.body).toMatchObject({ entitled: false, redirect_to: '/ember' })
  })

  it('serves a verified top-plan custom domain', async () => {
    expect(await hostGateDecision(pool, 'onyx.gg')).toEqual({
      action: 'serve', slug: 'onyx', rung: 'custom',
    })
    expect(await hostGateDecision(pool, 'www.onyx.gg')).toEqual({
      action: 'serve', slug: 'onyx', rung: 'custom',
    })
  })

  it('never serves an unverified claim, however DNS is pointed', async () => {
    await pool.query(`update leagues set custom_domain_status='pending' where slug='onyx'`)
    expect(await hostGateDecision(pool, 'onyx.gg')).toEqual({
      action: 'redirect', slug: 'onyx', to: '/onyx', reason: 'unverified',
    })
  })

  it('an UNPAID Pro row is downgraded too — the paid column, not just the tier', async () => {
    await pool.query(`update leagues set plan_status='none' where slug='blaze'`)
    expect(await hostGateDecision(pool, 'blaze.tko.cam')).toEqual({
      action: 'redirect', slug: 'blaze', to: '/blaze', reason: 'tier',
    })
  })

  it('the apex, infrastructure subdomains and unknown hosts all pass through', async () => {
    expect(await hostGateDecision(pool, 'tko.cam')).toEqual({ action: 'pass' })
    expect(await hostGateDecision(pool, 'api.tko.cam')).toEqual({ action: 'pass' })
    expect(await hostGateDecision(pool, 'nosuch.tko.cam')).toEqual({ action: 'pass' })
    expect(await hostGateDecision(pool, 'random-site.example')).toEqual({ action: 'pass' })
    expect((await request(app).get('/api/league/by-host').query({ host: 'tko.cam' })).status).toBe(404)
    expect((await request(app).get('/api/league/by-host')).status).toBe(400)
  })
})

describe('GET /api/league/:slug/config — the addresses are public', () => {
  it('publishes a VERIFIED custom domain and hides a pending one', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const owner = await signUp(app, 'cfg@kc.gg', 'cfguser')
    await makeLeague(pool, 'onyx', owner.id, 'dynasty')
    await pool.query(
      `update leagues set custom_domain='onyx.gg', custom_domain_status='pending' where slug='onyx'`,
    )
    let r = await request(app).get('/api/league/onyx/config')
    expect(r.status).toBe(200)
    expect(r.body.custom_domain).toBeNull()
    expect(r.body.urls).toMatchObject({
      path: 'https://tko.cam/onyx',
      subdomain: 'https://onyx.tko.cam',
      custom: null,
    })

    await pool.query(`update leagues set custom_domain_status='verified' where slug='onyx'`)
    r = await request(app).get('/api/league/onyx/config')
    expect(r.body.custom_domain).toBe('onyx.gg')
    expect(r.body.urls.custom).toBe('https://onyx.gg')
    expect(r.body.urls.primary).toBe('https://onyx.gg')
  })
})
