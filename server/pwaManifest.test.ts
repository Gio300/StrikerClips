/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET /manifest.json — the installed app's identity, per HOST.
 *
 * Operator 2026-08-06, on shinobistrikerleague.com: "install so it should say
 * and it should install the app they are on.. this is taking me to TKO..
 * should be Shinobistrikerleague.com". One bundle serves tko.cam and every
 * league address, so the manifest had to stop being one static file.
 *
 * The dangerous half of that change is the OTHER direction: an installed TKO
 * app whose manifest quietly changes identity is uninstalled and re-installed
 * by the browser, and the user's home-screen icon breaks. So the first test
 * here is the one that matters most — on tko.cam the bytes are unchanged.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeDb } from './testHarness'
import { createApp } from './app'
import { TKO_MANIFEST } from '../src/lib/pwaManifest'

const ADULT_DOB = '1995-06-15'
const SHIPPED_MANIFEST = JSON.parse(
  readFileSync(join(__dirname, '..', 'public', 'manifest.json'), 'utf8'),
)

async function signUp(app: any, email: string, username: string) {
  const r = await request(app).post('/api/auth/signup').send({
    email, password: 'password123', username, date_of_birth: ADULT_DOB,
  })
  expect(r.status).toBe(200)
  return { token: r.body.token as string, id: r.body.user.id as string }
}

/** A league on the tier/plan its address needs, so hostGateDecision serves it. */
async function makeLeague(
  pool: any, slug: string, name: string, ownerId: string, tier: string, tagline = '',
) {
  await pool.query(
    `insert into leagues (slug, name, domain, tagline, tier, plan_status, owner_id)
     values ($1,$2,$3,$4,$5,'active',$6)`,
    [slug, name, `${slug}.tko.cam`, tagline, tier, ownerId],
  )
}

/** Fetch the manifest as a browser on `host` would. */
function getManifest(app: any, host: string, query?: Record<string, string>) {
  const r = request(app).get('/manifest.json').set('Host', host)
  return query ? r.query(query) : r
}

describe('GET /manifest.json — one bundle, one identity per address', () => {
  let app: any
  let pool: any

  beforeEach(async () => {
    pool = makeDb()
    app = createApp(pool)
    const owner = await signUp(app, 'pwa@kc.gg', 'pwaowner')
    // Pro buys the subdomain rung; Enterprise buys a custom domain.
    await makeLeague(pool, 'blaze', 'BLAZE LEAGUE', owner.id, 'pro', 'burn it down')
    await makeLeague(pool, 'onyx', 'ONYX', owner.id, 'enterprise')
    await pool.query(
      `update leagues set custom_domain='onyx.gg', custom_domain_status='verified' where slug='onyx'`,
    )
    // Starter is NOT entitled to <slug>.tko.cam — index.ts redirects that host
    // down to the path rung, so its manifest must stay TKO's.
    await makeLeague(pool, 'ember', 'EMBER', owner.id, 'starter')
  })

  it('tko.cam gets EXACTLY today\'s manifest, byte for byte', async () => {
    const r = await getManifest(app, 'tko.cam')
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toContain('application/manifest+json')
    expect(JSON.parse(r.text)).toEqual(SHIPPED_MANIFEST)
    expect(JSON.parse(r.text)).toEqual(TKO_MANIFEST)
  })

  it('www.tko.cam and localhost are TKO too', async () => {
    for (const host of ['www.tko.cam', 'localhost']) {
      expect(JSON.parse((await getManifest(app, host)).text)).toEqual(TKO_MANIFEST)
    }
  })

  it('an UNKNOWN host falls back to TKO rather than guessing a league', async () => {
    for (const host of ['random-site.example', 'nosuch.tko.cam', 'api.tko.cam']) {
      const body = JSON.parse((await getManifest(app, host)).text)
      expect(body, `${host} must not invent a league`).toEqual(TKO_MANIFEST)
    }
  })

  it('a league\'s CUSTOM domain installs as that league', async () => {
    const body = JSON.parse((await getManifest(app, 'onyx.gg')).text)
    expect(body.name).toBe('Onyx')
    expect(body.short_name).toBe('Onyx')
    expect(body.id).toBe('/')
    expect(JSON.stringify(body)).not.toContain('TKO.cam')
  })

  it('SSL\'s own domain installs as SSL — the operator\'s actual report', async () => {
    // THE CASE THAT MATTERED. shinobistrikerleague.com predates the rung-3
    // claim flow, so SSL's row has NO custom_domain and hostGateDecision
    // correctly answers 'pass'. The app still takes that host over on the
    // hostname rule, so the manifest has to as well or the chrome says SSL
    // while the home-screen icon says TKO — which is what the operator saw.
    const owner = await pool.query(`select owner_id from leagues where slug='onyx'`)
    await makeLeague(
      pool, 'shinobistrikerleague', 'SHINOBI STRIKER LEAGUE',
      owner.rows[0].owner_id, 'pro', 'rise. strike. reign.',
    )
    const r = await getManifest(app, 'shinobistrikerleague.com')
    const body = JSON.parse(r.text)
    expect(body.name).toBe('Shinobi Striker League')
    expect(body.short_name).toBe('Shinobi Striker League')
    expect(body.icons[0].src).toBe('leagues/shinobistrikerleague/icon-192.png')
    expect(JSON.stringify(body)).not.toContain('TKO')

    // www. and the Amplify default domain are the SAME app, not a second one.
    for (const alias of ['www.shinobistrikerleague.com', 'ssl-app.amplifyapp.com']) {
      expect(JSON.parse((await getManifest(app, alias)).text)).toEqual(body)
    }
  })

  it('a hostname whose first label matches NO league is still TKO', async () => {
    // The hostname rule is a guess; a leagues row is what makes it real.
    expect(JSON.parse((await getManifest(app, 'ghost.example')).text)).toEqual(TKO_MANIFEST)
  })

  it('a Pro league\'s SUBDOMAIN installs as that league, with its own icons', async () => {
    // A league with bundled icons proves the icon half; blaze has none, so
    // point the row at the slug that does.
    await pool.query(`update leagues set slug='shinobistrikerleague' where slug='blaze'`)
    const body = JSON.parse(
      (await getManifest(app, 'shinobistrikerleague.tko.cam')).text,
    )
    expect(body.name).toBe('Blaze League')
    expect(body.description).toContain('burn it down')
    expect(body.icons.map((i: any) => i.src)).toEqual([
      'leagues/shinobistrikerleague/icon-192.png',
      'leagues/shinobistrikerleague/icon-512.png',
      'leagues/shinobistrikerleague/icon-192.png',
      'leagues/shinobistrikerleague/icon-512.png',
    ])
  })

  it('a league on an address it did NOT pay for stays TKO — same gate as the app', async () => {
    // ember is Starter: index.ts redirects ember.tko.cam down to /ember, so
    // handing it a league manifest there would install an app at a URL that
    // immediately bounces.
    expect(JSON.parse((await getManifest(app, 'ember.tko.cam')).text)).toEqual(TKO_MANIFEST)
  })

  it('the PATH rung names its league in the URL and scopes the install to it', async () => {
    const body = JSON.parse((await getManifest(app, 'tko.cam', { league: 'ember' })).text)
    expect(body.name).toBe('Ember')
    expect(body.id).toBe('/ember/')
    expect(body.start_url).toBe('/ember/')
    expect(body.scope).toBe('/ember/')
  })

  it('carries the /app/ base into a path-rung install when served under /app/', async () => {
    const r = await request(app).get('/app/manifest.json')
      .set('Host', 'tko.cam').query({ league: 'ember' })
    expect(JSON.parse(r.text).scope).toBe('/app/ember/')
  })

  it('a HOST league beats a ?league= that disagrees — the address is the truth', async () => {
    const body = JSON.parse((await getManifest(app, 'onyx.gg', { league: 'ember' })).text)
    expect(body.name).toBe('Onyx')
  })

  it('a bogus or unknown ?league= is TKO, never a 500 and never a blank app', async () => {
    for (const league of ['../../etc/passwd', 'NOPE!!', '', 'ghostleague']) {
      const r = await getManifest(app, 'tko.cam', { league })
      expect(r.status).toBe(200)
      expect(JSON.parse(r.text)).toEqual(TKO_MANIFEST)
    }
  })

  it('is never cached — the Studio can rename a league between installs', async () => {
    const r = await getManifest(app, 'onyx.gg')
    expect(r.headers['cache-control']).toContain('no-store')
  })

  it('degrades to TKO when the database is down, instead of failing the install', async () => {
    const dead = { query: () => Promise.reject(new Error('connection refused')) }
    const r = await request(createApp(dead as any)).get('/manifest.json').set('Host', 'onyx.gg')
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text)).toEqual(TKO_MANIFEST)
  })
})
