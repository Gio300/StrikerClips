/* eslint-disable @typescript-eslint/no-explicit-any */
// ===========================================================================
// CONCURRENT MULTI-USER CHAOS + ADVERSARIAL SIMULATION
//
// Many simulated users act AT THE SAME TIME against one live app instance —
// some playing sensibly (sign up, clip, go live, join a clan, chat, predict),
// some making mistakes or actively misbehaving (malformed input, forging other
// people's rows, self-granting a paid tier, double-spending, acting logged out).
// Agents share a registry of each other's ids, so they genuinely interfere.
//
// It is not asserting specific outputs — it is a fuzz/soak test for INVARIANTS
// that must hold no matter what order thousands of interleaved requests arrive:
//
//   1. NO 5xx. A server crash under any input or interleaving is a bug.
//   2. No privilege escalation. Anyone who tried to self-grant a tier / host
//      flag still reads as free + non-host afterward.
//   3. No negative wallet. The economy never goes underwater.
//   4. No cross-user forgery. An ownership-gated insert for someone else's row
//      is never accepted (2xx).
//
// A failure prints the exact request that caused it, so it is reproducible.
// ===========================================================================
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { makeApp } from './testHarness'

const ADULT_DOB = '1995-06-15'

// Small seeded RNG so a failing run is reproducible from the seed in the name.
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Agent = { token: string; id: string; name: string; triedEscalation: boolean }

type Crash = { agent: string; action: string; status: number; body: any; sent: any }
type Forgery = { agent: string; action: string; status: number }

// A shared world the agents mutate as they go, so they act on each other's data.
class World {
  agents: Agent[] = []
  reels: { id: string; owner: string }[] = []
  clans: { id: string; owner: string }[] = []
  streams: { id: string; owner: string }[] = []
  tournaments: { id: string }[] = []
  crashes: Crash[] = []
  forgeriesAccepted: Forgery[] = []
  rnd: () => number
  constructor(seed: number) { this.rnd = mulberry32(seed) }
  pick<T>(arr: T[]): T | undefined { return arr.length ? arr[Math.floor(this.rnd() * arr.length)] : undefined }
}

describe('TKO API — concurrent multi-user chaos (seed 1337)', () => {
  const app = makeApp()
  const world = new World(1337)

  // POST /api/db as a user (or anonymously), never throwing on HTTP status.
  async function db(who: Agent | null, body: any, action: string) {
    const r = await (who
      ? request(app).post('/api/db').set('Authorization', `Bearer ${who.token}`).send(body)
      : request(app).post('/api/db').send(body))
    if (r.status >= 500) world.crashes.push({ agent: who?.name ?? 'anon', action, status: r.status, body: r.body, sent: body })
    return r
  }
  async function fn(who: Agent | null, nm: string, body: any) {
    const req = request(app).post(`/api/fn/${nm}`).send(body)
    const r = await (who ? req.set('Authorization', `Bearer ${who.token}`) : req)
    if (r.status >= 500) world.crashes.push({ agent: who?.name ?? 'anon', action: `fn/${nm}`, status: r.status, body: r.body, sent: body })
    return r
  }

  const BIG = 'z'.repeat(20000)
  const WEIRD = ['', '   ', null, undefined, 123, {}, [], BIG, "'; drop table users;--", '<script>x</script>', '👊'.repeat(500)]

  // One agent's whole session: a randomized run of sensible + adversarial acts.
  async function runAgent(a: Agent, steps: number) {
    const w = world
    for (let s = 0; s < steps; s++) {
      const roll = w.rnd()
      try {
        if (roll < 0.12) {
          // sensible: create a clip I own
          await db(a, { table: 'clips', action: 'insert', single: true, values: { user_id: a.id, title: `clip ${s}`, source_type: 'youtube', youtube_video_id: 'dQw4w9WgXcQ' } }, 'create-clip')
        } else if (roll < 0.22) {
          // sensible: create a reel I own, remember it
          const r = await db(a, { table: 'reels', action: 'insert', single: true, values: { user_id: a.id, title: `reel ${s}` } }, 'create-reel')
          if (r.status === 200 && r.body?.data?.id) w.reels.push({ id: r.body.data.id, owner: a.id })
        } else if (roll < 0.30) {
          // sensible: go live, remember the stream
          const r = await db(a, { table: 'live_streams', action: 'insert', single: true, values: { user_id: a.id, youtube_url: 'https://youtu.be/dQw4w9WgXcQ', title: 'live', is_live: true, placement: 'profile' } }, 'go-live')
          if (r.status === 200 && r.body?.data?.id) w.streams.push({ id: r.body.data.id, owner: a.id })
        } else if (roll < 0.36) {
          // sensible: end one of MY streams
          const mine = w.streams.filter((x) => x.owner === a.id)
          const st = w.pick(mine)
          if (st) await db(a, { table: 'live_streams', action: 'update', filters: [{ col: 'id', op: 'eq', val: st.id }], values: { is_live: false } }, 'end-live')
        } else if (roll < 0.44) {
          // sensible: create a clan (server kind=clan) I own
          const r = await db(a, { table: 'servers', action: 'insert', single: true, values: { name: `clan-${a.name}-${s}`, owner_id: a.id, kind: 'clan' } }, 'create-clan')
          if (r.status === 200 && r.body?.data?.id) w.clans.push({ id: r.body.data.id, owner: a.id })
        } else if (roll < 0.50) {
          // sensible: join SOMEONE ELSE'S clan as a plain member
          const clan = w.pick(w.clans.filter((c) => c.owner !== a.id))
          if (clan) await db(a, { table: 'clan_members', action: 'insert', single: true, values: { server_id: clan.id, user_id: a.id, role: 'member' } }, 'join-clan')
        } else if (roll < 0.56) {
          // sensible: post a chat message somewhere (channel may not exist — still must not 500)
          await db(a, { table: 'chat_messages', action: 'insert', single: true, values: { channel_id: a.id, user_id: a.id, body: `gg ${s}` } }, 'chat')
        } else if (roll < 0.62) {
          // sensible: update my own profile bio
          await db(a, { table: 'profiles', action: 'update', filters: [{ col: 'id', op: 'eq', val: a.id }], values: { bio: `main ${s}`, country: 'US' } }, 'edit-profile')
        } else if (roll < 0.68) {
          // sensible: read a public feed
          const t = w.pick(['reels', 'clips', 'live_streams', 'posts', 'servers'])!
          await db(a, { table: t, action: 'select', columns: '*' }, `read-${t}`)
        } else if (roll < 0.73) {
          // economy: try to buy the seeded jersey (usually 'insufficient' — must never 5xx or go negative)
          await fn(a, 'asset-buy', { assetId: 'seed-akatsuki-jersey' })
        } else if (roll < 0.77) {
          // economy: claim the daily sweeps (second claim in a run must be refused, not double-credit)
          await fn(a, 'sweeps-daily', {})
        } else if (roll < 0.81) {
          // ADVERSARIAL: forge a clip owned by someone else. The insert:'owner'
          // policy must FORCE user_id back to the caller, so a real forgery is
          // only when the returned row is actually owned by the victim.
          const other = w.pick(w.agents.filter((x) => x.id !== a.id))
          if (other) {
            const r = await db(a, { table: 'clips', action: 'insert', single: true, values: { user_id: other.id, title: 'stolen', source_type: 'youtube' } }, 'forge-clip')
            if (r.status >= 200 && r.status < 300 && r.body?.data?.user_id === other.id) {
              w.forgeriesAccepted.push({ agent: a.name, action: 'forge-clip', status: r.status })
            }
          }
        } else if (roll < 0.85) {
          // ADVERSARIAL: write myself into someone else's reel
          const reel = w.pick(w.reels.filter((x) => x.owner !== a.id))
          if (reel) {
            const r = await db(a, { table: 'reel_participants', action: 'insert', single: true, values: { reel_id: reel.id, user_id: a.id } }, 'forge-participant')
            if (r.status >= 200 && r.status < 300) w.forgeriesAccepted.push({ agent: a.name, action: 'forge-participant', status: r.status })
          }
        } else if (roll < 0.89) {
          // ADVERSARIAL: self-grant a paid tier + host flag
          a.triedEscalation = true
          await db(a, { table: 'profiles', action: 'update', filters: [{ col: 'id', op: 'eq', val: a.id }], values: { reelone_tier: 'creator', tko_host: true, user_metadata: { tko_host: true, reelone_tier: 'legend' } } }, 'escalate')
        } else if (roll < 0.92) {
          // ADVERSARIAL: end SOMEONE ELSE'S stream
          const st = w.pick(w.streams.filter((x) => x.owner !== a.id))
          if (st) {
            const r = await db(a, { table: 'live_streams', action: 'update', filters: [{ col: 'id', op: 'eq', val: st.id }], values: { is_live: false } }, 'kill-other-stream')
            if (r.status >= 200 && r.status < 300) w.forgeriesAccepted.push({ agent: a.name, action: 'kill-other-stream', status: r.status })
          }
        } else if (roll < 0.96) {
          // ADVERSARIAL: garbage payloads at the generic endpoint
          const table = w.pick(['reels', 'clips', 'profiles', 'live_streams', 'chat_messages', 'not_a_real_table', 'users', 'redeem_codes'])!
          const action = w.pick(['insert', 'update', 'select', 'delete', 'nonsense'])!
          const key = String(w.pick(['title', 'body', 'x']))
          const garbage: any = { table, action, values: { [key]: w.pick(WEIRD) }, filters: w.rnd() < 0.5 ? 'not-an-array' : [{ col: 'id', op: 'eq', val: w.pick(WEIRD) }] }
          await db(a, garbage, 'garbage')
        } else {
          // ADVERSARIAL: act with NO auth on an authed endpoint
          await db(null, { table: 'clips', action: 'insert', single: true, values: { user_id: a.id, title: 'anon' } }, 'anon-write')
        }
      } catch (e: any) {
        // A thrown error (not an HTTP response) is also a crash worth surfacing.
        world.crashes.push({ agent: a.name, action: 'threw', status: -1, body: String(e?.message || e), sent: null })
      }
    }
  }

  it('signs up a crowd concurrently', async () => {
    const N = 40
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        request(app).post('/api/auth/signup').send({ email: `chaos${i}@kc.gg`, password: 'password123', username: `chaos_${i}`, date_of_birth: ADULT_DOB }),
      ),
    )
    for (const r of results) {
      expect(r.status).toBe(200)
      world.agents.push({ token: r.body.token, id: r.body.user.id, name: r.body.user.user_metadata?.username || r.body.user.id, triedEscalation: false })
    }
    expect(world.agents.length).toBe(N)
  }, 30_000)

  it('runs everyone at once doing sensible + adversarial things', async () => {
    // Every agent runs concurrently; each does ~30 interleaved actions.
    await Promise.all(world.agents.map((a) => runAgent(a, 30)))
    // The whole point: not a single request may 5xx.
    if (world.crashes.length) {
      // Surface the first few precisely for a reproducible fix.
      console.error('CRASHES:', JSON.stringify(world.crashes.slice(0, 8), null, 2))
    }
    expect(world.crashes).toEqual([])
    // A WALL-CLOCK BUDGET, NOT A PERFORMANCE ASSERTION. This drives N agents x
    // ~30 interleaved requests concurrently; alone the file finishes in ~20s,
    // but under the full run it shares a machine with 170+ other test files and
    // gets a fraction of the CPU. At 15s it timed out there and passed in
    // isolation -- and because the `it` blocks below only assert on the `world`
    // this one populates, a single slow machine turned into TWO red tests that
    // had nothing to do with the code. A suite that fails randomly is a suite
    // people stop reading. Budget for a saturated machine; a genuine hang still
    // trips it.
  }, 90_000)

  it('never accepted a cross-user forgery', () => {
    if (world.forgeriesAccepted.length) console.error('FORGERIES ACCEPTED:', JSON.stringify(world.forgeriesAccepted.slice(0, 10), null, 2))
    expect(world.forgeriesAccepted).toEqual([])
  })

  it('never granted a self-escalated tier or host flag', async () => {
    const escalators = world.agents.filter((a) => a.triedEscalation)
    expect(escalators.length).toBeGreaterThan(0) // the sim actually tried
    for (const a of escalators) {
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${a.token}`)
      expect(me.status).toBe(200)
      expect(me.body.user.user_metadata.reelone_tier).toBe('')
      expect(me.body.user.user_metadata.tko_host).toBe(false)
    }
    // One sequential /auth/me per escalating agent -- same saturated-machine
    // reasoning as the budget above, and it was the second casualty of it.
  }, 30_000)

  it('never drove any wallet negative', async () => {
    for (const a of world.agents) {
      const r = await request(app).post('/api/fn/wallet').set('Authorization', `Bearer ${a.token}`).send({})
      expect(r.status).toBe(200)
      const wal = r.body.wallet || { tokens: 0, sweeps: 0 }
      expect(wal.tokens).toBeGreaterThanOrEqual(0)
      expect(wal.sweeps).toBeGreaterThanOrEqual(0)
    }
  })
})

// ===========================================================================
// CONCURRENCY RACES on a shared, LIMITED resource.
// A single-use redeem code redeemed by a crowd at the same instant is the
// classic check-then-write (TOCTOU) trap: if the handler reads uses<max and
// only later increments, several requests can pass the gate before any commits,
// over-granting past the cap. This is exactly a "many users at once" bug.
// ===========================================================================
describe('TKO API — single-use redeem code under a concurrent stampede', () => {
  const app = makeApp()
  const users: { token: string; id: string }[] = []

  it('signs up a crowd', async () => {
    const rs = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        request(app).post('/api/auth/signup').send({ email: `race${i}@kc.gg`, password: 'password123', username: `race_${i}`, date_of_birth: ADULT_DOB }),
      ),
    )
    for (const r of rs) { expect(r.status).toBe(200); users.push({ token: r.body.token, id: r.body.user.id }) }
  }, 15_000)

  it('honors max_uses=1 even when 20 redeem at the exact same moment', async () => {
    // KILLCAM-TEST-CODE is seeded with tier=pro, months=1, max_uses=1.
    const results = await Promise.all(
      users.map((u) =>
        request(app).post('/api/fn/redeem-code').set('Authorization', `Bearer ${u.token}`).send({ code: 'KILLCAM-TEST-CODE' }),
      ),
    )
    const granted = results.filter((r) => r.status === 200 && r.body?.ok === true)
    // The cap is one. If more than one user walked away with the pro grant, the
    // counter has a race and the code is an infinite-tier button under load.
    expect(granted.length).toBe(1)

    // And exactly the granted users actually carry the tier now.
    let carrying = 0
    for (const u of users) {
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${u.token}`)
      if (me.body?.user?.user_metadata?.reelone_tier === 'pro') carrying++
    }
    expect(carrying).toBe(1)
  })
})

// The free daily Sweeps grant is guarded by "one 'grant'/'daily' ledger row per
// UTC day per user". If that guard is a check-then-insert, one user hammering
// the button ten times at once could bank ten days of Sweeps in one second.
describe('TKO API — daily Sweeps grant under a same-user stampede', () => {
  const app = makeApp()
  let u: { token: string; id: string }

  it('signs up one user', async () => {
    const r = await request(app).post('/api/auth/signup').send({ email: 'daily@kc.gg', password: 'password123', username: 'daily', date_of_birth: ADULT_DOB })
    expect(r.status).toBe(200); u = { token: r.body.token, id: r.body.user.id }
  })

  it('grants the daily bonus at most once no matter how many simultaneous claims', async () => {
    const claims = await Promise.all(
      Array.from({ length: 10 }, () => request(app).post('/api/fn/sweeps-daily').set('Authorization', `Bearer ${u.token}`).send({})),
    )
    const ok = claims.filter((r) => r.status === 200 && r.body?.ok === true)
    expect(ok.length).toBeLessThanOrEqual(1)
    const wal = await request(app).post('/api/fn/wallet').set('Authorization', `Bearer ${u.token}`).send({})
    // One day's grant is 3 Oracle tickets (Rule 1); ten concurrent claims must
    // not bank 30. Tickets are the repurposed daily grant — never $-flow sweeps.
    expect(wal.body.wallet.oracle_tickets).toBeLessThanOrEqual(3)
    expect(wal.body.wallet.sweeps).toBe(0)
  })
})
