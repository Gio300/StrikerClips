/* eslint-disable @typescript-eslint/no-explicit-any */
// SINGLE-USE code enforcement (founder requirement): a founder HOST code AND a
// redeem_codes tier pass may each be redeemed by EXACTLY ONE profile, EXACTLY
// ONCE. The guard is the UNIQUE(code) key on `redeemed_codes`: the redeem-code
// handler claims a code by inserting a row there before granting anything, so
// the first claim wins and every later attempt — a different profile, the same
// profile retrying, or a concurrent race — is rejected with "code already used".
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { makeApp } from './testHarness'

const ADULT_DOB = '1995-06-15'

type Who = { token: string; id: string }

async function signUp(app: any, email: string, username: string): Promise<Who> {
  const r = await request(app).post('/api/auth/signup').send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}

function redeem(app: any, who: Who, code: string) {
  return request(app).post('/api/fn/redeem-code').set('Authorization', `Bearer ${who.token}`).send({ code })
}

function me(app: any, who: Who) {
  return request(app).get('/api/auth/me').set('Authorization', `Bearer ${who.token}`)
}

describe('redeem-code — founder HOST codes are single-use', () => {
  const app = makeApp()
  const HOST_CODE = 'TKO-HOST-K9F3QX'
  let first: Who
  let second: Who

  it('sets up two users', async () => {
    first = await signUp(app, 'host-first@su.gg', 'host_first')
    second = await signUp(app, 'host-second@su.gg', 'host_second')
  })

  it('the FIRST profile to redeem a host code gets the tko_host role', async () => {
    const r = await redeem(app, first, HOST_CODE)
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.host).toBe(true)
    const m = await me(app, first)
    expect(m.body.user.user_metadata.tko_host).toBe(true)
  })

  it('a SECOND profile redeeming the same host code is rejected and gets nothing', async () => {
    const r = await redeem(app, second, HOST_CODE)
    expect(r.status).toBe(409)
    expect(r.body.ok).toBe(false)
    expect(r.body.error).toMatch(/already used/i)
    const m = await me(app, second)
    // Never granted the host role.
    expect(m.body.user.user_metadata?.tko_host).not.toBe(true)
  })

  it('is case-insensitive — the same code in a different case cannot be re-claimed', async () => {
    const third = await signUp(app, 'host-third@su.gg', 'host_third')
    const r = await redeem(app, third, HOST_CODE.toLowerCase())
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/already used/i)
  })

  it('the SAME profile cannot re-redeem a host code it already used', async () => {
    const r = await redeem(app, first, HOST_CODE)
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/already used/i)
  })
})

describe('redeem-code — redeem_codes tier passes are single-use', () => {
  const app = makeApp()
  // KILLCAM-TEST-CODE is seeded in the harness with tier=pro, months=1, max_uses=1.
  const TIER_CODE = 'KILLCAM-TEST-CODE'
  let first: Who
  let second: Who

  it('sets up two users', async () => {
    first = await signUp(app, 'tier-first@su.gg', 'tier_first')
    second = await signUp(app, 'tier-second@su.gg', 'tier_second')
  })

  it('the FIRST redemption succeeds and grants the correct tier', async () => {
    const r = await redeem(app, first, TIER_CODE)
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.tier).toBe('pro')
    expect(r.body.expires_at).toBeTruthy()
    const m = await me(app, first)
    expect(m.body.user.user_metadata.reelone_tier).toBe('pro')
  })

  it('a SECOND profile redeeming the same tier code is rejected and gets no tier', async () => {
    const r = await redeem(app, second, TIER_CODE)
    expect(r.status).toBe(409)
    expect(r.body.ok).toBe(false)
    const m = await me(app, second)
    // No tier was granted (default is empty / unset — never the 'pro' grant).
    expect(m.body.user.user_metadata?.reelone_tier || '').not.toBe('pro')
  })

  it('rejects an unknown code before any claim is recorded', async () => {
    const third = await signUp(app, 'tier-third@su.gg', 'tier_third')
    const r = await redeem(app, third, 'KILLCAM-NOPE-NOPE')
    expect(r.status).toBe(404)
    expect(r.body.error).toMatch(/invalid code/i)
  })
})

describe('redeem-code — a concurrent double-redeem yields exactly one winner', () => {
  it('20 profiles redeeming ONE host code at once: exactly one gets the role', async () => {
    const app = makeApp()
    const HOST_CODE = 'TKO-HOST-M4R7PZ'
    const users = await Promise.all(
      Array.from({ length: 20 }, (_, i) => signUp(app, `race-host-${i}@su.gg`, `race_host_${i}`)),
    )
    const results = await Promise.all(users.map((u) => redeem(app, u, HOST_CODE)))
    const granted = results.filter((r) => r.status === 200 && r.body?.ok === true && r.body?.host === true)
    expect(granted.length).toBe(1)
    // The 19 losers are all a clean 409 "already used" — no partial grant.
    const rejected = results.filter((r) => r.status === 409)
    expect(rejected.length).toBe(19)

    // And exactly one profile actually carries the host role now.
    let hosts = 0
    for (const u of users) {
      const m = await me(app, u)
      if (m.body?.user?.user_metadata?.tko_host === true) hosts++
    }
    expect(hosts).toBe(1)
  }, 15_000)

  it('20 profiles redeeming ONE tier code at once: exactly one gets the tier', async () => {
    const app = makeApp()
    const TIER_CODE = 'KILLCAM-TEST-CODE'
    const users = await Promise.all(
      Array.from({ length: 20 }, (_, i) => signUp(app, `race-tier-${i}@su.gg`, `race_tier_${i}`)),
    )
    const results = await Promise.all(users.map((u) => redeem(app, u, TIER_CODE)))
    const granted = results.filter((r) => r.status === 200 && r.body?.ok === true && r.body?.tier === 'pro')
    expect(granted.length).toBe(1)

    let carrying = 0
    for (const u of users) {
      const m = await me(app, u)
      if (m.body?.user?.user_metadata?.reelone_tier === 'pro') carrying++
    }
    expect(carrying).toBe(1)
  }, 15_000)
})
