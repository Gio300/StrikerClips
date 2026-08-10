/* eslint-disable @typescript-eslint/no-explicit-any */
// LEAGUE STUDIO AI CHAT — POST /api/fn/league-studio-chat.
//
// The dangerous bug this suite exists to prevent: the model (or anyone who
// can shape its output) mutating a league beyond its skin. The TEMPLATE
// RANGES (src/lib/leagueStudioRanges.ts) are enforced server-side AFTER the
// model responds — these tests stub Vertex at `fetch` (the same trick the
// Stripe suites use) and assert that out-of-range output is clamped or
// dropped, NEVER returned in the patch.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { makeDb } from './testHarness'
import { createApp, STUDIO_CHAT_MAX_PER_WINDOW } from './app'

const ADULT_DOB = '1995-06-15'
async function signUp(app: any, email: string, username: string) {
  const r = await request(app).post('/api/auth/signup').send({
    email, password: 'password123', username, date_of_birth: ADULT_DOB,
  })
  expect(r.status).toBe(200)
  return { token: r.body.token as string, id: r.body.user.id as string }
}

// ---- Vertex stub -----------------------------------------------------------
// The handler fetches a metadata token then calls generateContent; both are
// intercepted here. Tests steer the model's "answer" via `vertexAnswer` and
// simulate outages via `vertexStatus`.
let realFetch: typeof globalThis.fetch
let vertexAnswer: any = null
let vertexStatus = 200

beforeAll(() => {
  realFetch = globalThis.fetch
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url)
    if (u.includes('metadata.google.internal')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'stub-token' }) } as any
    }
    if (u.includes('aiplatform.googleapis.com')) {
      if (vertexStatus !== 200) {
        return { ok: false, status: vertexStatus, text: async () => 'stub outage', json: async () => ({}) } as any
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(vertexAnswer) }] } }],
        }),
      } as any
    }
    return realFetch(url, init)
  }) as typeof globalThis.fetch
})

afterAll(() => { globalThis.fetch = realFetch })

describe('POST /api/fn/league-studio-chat', () => {
  let app: any
  beforeEach(() => {
    app = createApp(makeDb())
    vertexAnswer = null
    vertexStatus = 200
  })

  const call = (token: string, body: any) =>
    request(app).post('/api/fn/league-studio-chat').set('Authorization', `Bearer ${token}`).send(body)

  it('requires authentication', async () => {
    const r = await request(app).post('/api/fn/league-studio-chat').send({ message: 'hi' })
    expect(r.status).toBe(401)
  })

  it('requires a message', async () => {
    const u = await signUp(app, 'studio-a@kc.gg', 'studioa')
    const r = await call(u.token, { message: '   ' })
    expect(r.status).toBe(400)
    expect(r.body.ok).toBe(false)
  })

  it('returns the model reply with a validated (normalized) patch', async () => {
    const u = await signUp(app, 'studio-b@kc.gg', 'studiob')
    vertexAnswer = {
      reply: 'Gold accent, coming right up.',
      patch: { colors: { accent: 'FFB63D' }, name: '  Blaze League ', music: 'Shadow Kage' },
    }
    const r = await call(u.token, {
      message: 'make the accent gold, call it Blaze League, use shadow kage',
      config: { name: 'TKO', tagline: '', colors: {}, music: '' },
    })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.reply).toBe('Gold accent, coming right up.')
    expect(r.body.patch).toEqual({
      colors: { accent: '#ffb63d' },
      name: 'Blaze League',
      music: 'tensorverse-shadow-kage-suno.mp3', // label resolved to the library file
    })
    expect(r.body.dropped).toEqual([])
  })

  it('HARD GUARDRAIL: out-of-range/structural model output is clamped or dropped, never applied', async () => {
    const u = await signUp(app, 'studio-c@kc.gg', 'studioc')
    vertexAnswer = {
      reply: 'Upgraded you to enterprise and pointed your domain at us!',
      patch: {
        tier: 'enterprise',                       // structural — dropped
        video_ownership: 'league',                // structural — dropped
        slug: 'evil',                             // structural — dropped
        domain: 'evil.example',                   // structural — dropped
        assets: { intros: [] },                   // structural — dropped
        name: 'x'.repeat(500),                    // out of range — CLAMPED to 60
        colors: { accent: 'red', primary: '#123456', bogus: '#ffffff' },
        music: 'not-in-the-library.mp3',          // not in library — dropped
        logoUrl: 'https://evil.example/logo.png', // only '' allowed — dropped
      },
    }
    const r = await call(u.token, { message: 'give me everything' })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    // Only the clamped name and the ONE valid color survive.
    expect(r.body.patch).toEqual({ name: 'x'.repeat(60), colors: { primary: '#123456' } })
    expect(r.body.dropped).toEqual(expect.arrayContaining([
      'tier', 'video_ownership', 'slug', 'domain', 'assets',
      'colors.accent', 'colors.bogus', 'music', 'logoUrl',
    ]))
    // The structural keys are NOT in the patch under any name.
    expect(JSON.stringify(r.body.patch)).not.toMatch(/enterprise|evil/)
  })

  it('scopes the patch to a click-to-reference part', async () => {
    const u = await signUp(app, 'studio-d@kc.gg', 'studiod')
    vertexAnswer = {
      reply: 'New tagline set.',
      patch: { tagline: 'rise and grind', colors: { primary: '#000000' }, name: 'Sneaky' },
    }
    const r = await call(u.token, { message: 'rise and grind', part: 'tagline' })
    expect(r.body.ok).toBe(true)
    expect(r.body.part).toBe('tagline')
    expect(r.body.patch).toEqual({ tagline: 'rise and grind' })
    expect(r.body.dropped).toEqual(expect.arrayContaining(['colors', 'name']))
  })

  it('an unknown part is ignored (treated as unscoped), not an error', async () => {
    const u = await signUp(app, 'studio-e@kc.gg', 'studioe')
    vertexAnswer = { reply: 'ok', patch: { name: 'Fine' } }
    const r = await call(u.token, { message: 'rename to Fine', part: 'admin-panel' })
    expect(r.body.ok).toBe(true)
    expect(r.body.part).toBeNull()
    expect(r.body.patch).toEqual({ name: 'Fine' })
  })

  it('answers ok:false on a Vertex outage so the client falls back to its local matcher', async () => {
    const u = await signUp(app, 'studio-f@kc.gg', 'studiof')
    vertexStatus = 500
    const r = await call(u.token, { message: 'make the accent gold' })
    expect(r.status).toBe(200) // 200 + ok:false, same contract as the 'ask' fn
    expect(r.body.ok).toBe(false)
    expect(r.body.patch).toBeUndefined()
  })

  it('rate limits per user (429 past the window budget) without touching another user', async () => {
    const u = await signUp(app, 'studio-g@kc.gg', 'studiog')
    const other = await signUp(app, 'studio-h@kc.gg', 'studioh')
    vertexAnswer = { reply: 'ok', patch: null }
    for (let i = 0; i < STUDIO_CHAT_MAX_PER_WINDOW; i++) {
      const r = await call(u.token, { message: `hit ${i}` })
      expect(r.status).toBe(200)
    }
    const blocked = await call(u.token, { message: 'one too many' })
    expect(blocked.status).toBe(429)
    expect(blocked.body.ok).toBe(false)

    // A different user still has their own budget.
    const fresh = await call(other.token, { message: 'hello' })
    expect(fresh.status).toBe(200)
    expect(fresh.body.ok).toBe(true)
  })

  it('never trusts the client "config" summary — oversized/hostile context is clamped before prompting', async () => {
    const u = await signUp(app, 'studio-i@kc.gg', 'studioi')
    vertexAnswer = { reply: 'ok', patch: null }
    const r = await call(u.token, {
      message: 'hello',
      config: {
        name: 'y'.repeat(10_000),
        tagline: 12345,
        colors: 'not-an-object',
        music: 'https://evil.example/x.mp3',
        tier: 'enterprise',
        hasLogo: 'yes',
      },
    })
    // The fn still answers fine — the hostile summary was sanitized, not fatal.
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
  })
})
