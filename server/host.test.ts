/* eslint-disable @typescript-eslint/no-explicit-any */
// HOST COMMENTARY / "with host" version markers (host_commentaries).
// Pins down the TABLE_POLICY: only a global tko_host may create a commentary,
// host_id is FORCED to the caller, reads are public (so the version picker can
// see whether a match has a host cut), and only the owning host (or any host)
// may edit it.
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { makeApp } from './testHarness'

const ADULT_DOB = '1995-06-15'

type Who = { token: string; id: string }

async function signUp(app: any, email: string, username: string): Promise<Who> {
  const r = await request(app).post('/api/auth/signup').send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}

/** POST /api/db as a given user (or anonymously when `who` is null). */
function db(app: any, who: Who | null, body: any) {
  const r = request(app).post('/api/db').send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

describe('host_commentaries — the "with host" version lane', () => {
  const app = makeApp()
  let alice: Who
  let host: Who
  let host2: Who
  let legend: Who
  const matchId = randomUUID()
  const legendMatchId = randomUUID()
  let rowId = ''

  it('sets up a plain user, two TKO hosts, and a top-tier (Legend) member', async () => {
    alice = await signUp(app, 'alice@host.gg', 'alice')
    host = await signUp(app, 'host@host.gg', 'hostess')
    host2 = await signUp(app, 'host2@host.gg', 'hostess2')
    // Founder HOST codes are single-use (one profile, one time), so each host
    // must redeem a DISTINCT code — sharing one would now be rejected.
    for (const [h, code] of [[host, 'TKO-HOST-K9F3QX'], [host2, 'TKO-HOST-M4R7PZ']] as const) {
      const r = await request(app).post('/api/fn/redeem-code')
        .set('Authorization', `Bearer ${h.token}`).send({ code })
      expect(r.status).toBe(200)
      expect(r.body.host).toBe(true)
    }
    // The reusable TKO-BETA pass grants the top tier ('creator'/Legend) but does
    // NOT set tko_host — so this exercises the tier arm of the gate, not the code.
    legend = await signUp(app, 'legend@host.gg', 'legend')
    const g = await request(app).post('/api/fn/redeem-code')
      .set('Authorization', `Bearer ${legend.token}`).send({ code: 'TKO-BETA' })
    expect(g.status).toBe(200)
    expect(g.body.tier).toBe('creator')
    expect(g.body.host).not.toBe(true)
  }, 15_000)

  it('a plain (free) user cannot create a host commentary', async () => {
    const r = await db(app, alice, {
      table: 'host_commentaries', action: 'insert', single: true,
      values: { mode: 'past', capture_source: 'mic', match_id: matchId, title: 'nope' },
    })
    expect(r.status).toBe(403)
  })

  it('a top-tier (Legend) member CAN create a host commentary; host_id is forced to them', async () => {
    const r = await db(app, legend, {
      table: 'host_commentaries', action: 'insert', single: true,
      // Try to attribute it to alice — the server must overwrite host_id.
      values: { mode: 'past', capture_source: 'mic', match_id: legendMatchId, host_id: alice.id, title: 'legend cut' },
    })
    expect(r.status).toBe(200)
    expect(r.body.error).toBeNull()
    expect(r.body.data.host_id).toBe(legend.id)
    expect(r.body.data.match_id).toBe(legendMatchId)
  })

  it('the top-tier member owns their own commentary and may edit it', async () => {
    const created = await db(app, legend, {
      table: 'host_commentaries', action: 'insert', single: true,
      values: { mode: 'live', capture_source: 'camera', status: 'live' },
    })
    expect(created.status).toBe(200)
    const id = created.body.data.id
    const edit = await db(app, legend, {
      table: 'host_commentaries', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: id }],
      values: { title: 'legend live cut' },
    })
    expect(edit.status).toBe(200)
    expect(edit.body.data.title).toBe('legend live cut')
  })

  it('an anonymous caller cannot create a host commentary', async () => {
    const r = await db(app, null, {
      table: 'host_commentaries', action: 'insert', single: true,
      values: { mode: 'past', capture_source: 'mic', match_id: matchId },
    })
    expect(r.status).toBe(401)
  })

  it('a host creates a past-match commentary; host_id is FORCED to the caller', async () => {
    const r = await db(app, host, {
      table: 'host_commentaries', action: 'insert', single: true,
      // Try to attribute it to alice — the server must overwrite host_id.
      values: { mode: 'past', capture_source: 'camera', match_id: matchId, host_id: alice.id, title: 'GF cast' },
    })
    expect(r.status).toBe(200)
    expect(r.body.error).toBeNull()
    expect(r.body.data.host_id).toBe(host.id)
    expect(r.body.data.match_id).toBe(matchId)
    expect(r.body.data.mode).toBe('past')
    expect(r.body.data.capture_source).toBe('camera')
    rowId = r.body.data.id
  })

  it('reads are public — the version picker sees the host cut without signing in', async () => {
    const r = await db(app, null, {
      table: 'host_commentaries', action: 'select', columns: '*',
      filters: [{ col: 'match_id', op: 'eq', val: matchId }],
    })
    expect(r.status).toBe(200)
    expect(r.body.data.length).toBe(1)
    expect(r.body.data[0].id).toBe(rowId)
  })

  it('the owning host may link the recorded commentary URL afterwards', async () => {
    const r = await db(app, host, {
      table: 'host_commentaries', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: rowId }],
      values: { commentary_url: 'https://youtu.be/hostcut', status: 'ready' },
    })
    expect(r.status).toBe(200)
    expect(r.body.data.commentary_url).toBe('https://youtu.be/hostcut')
  })

  it('another host may also correct a commentary (any host is elevated)', async () => {
    const r = await db(app, host2, {
      table: 'host_commentaries', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: rowId }],
      values: { title: 'Grand Final — hosted' },
    })
    expect(r.status).toBe(200)
    expect(r.body.data.title).toBe('Grand Final — hosted')
  })

  it('a non-host non-owner cannot edit a commentary', async () => {
    const r = await db(app, alice, {
      table: 'host_commentaries', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: rowId }],
      values: { title: 'hijack' },
    })
    expect(r.status).toBe(403)
  })

  it('a host can host a LIVE match with no match/reel yet', async () => {
    const r = await db(app, host, {
      table: 'host_commentaries', action: 'insert', single: true,
      values: { mode: 'live', capture_source: 'obs', status: 'live' },
    })
    expect(r.status).toBe(200)
    expect(r.body.data.mode).toBe('live')
    expect(r.body.data.capture_source).toBe('obs')
    expect(r.body.data.host_id).toBe(host.id)
  })
})
