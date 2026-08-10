/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'
import type { Placement } from '../src/lib/tiers'

const ADULT_DOB = '1995-06-15'

type Who = { token: string; id: string }

async function signUp(app: any, name: string): Promise<Who> {
  const r = await request(app).post('/api/auth/signup').send({
    email: `${name}@live-hardening.test`,
    password: 'password123',
    username: name,
    date_of_birth: ADULT_DOB,
  })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}

function db(app: any, who: Who | null, body: any) {
  const r = request(app).post('/api/db').send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

async function setTier(pool: any, userId: string, tier: string) {
  const current = await pool.query('select user_metadata from users where id=$1', [userId])
  const meta = current.rows[0]?.user_metadata || {}
  meta.reelone_tier = tier
  meta.reelone_tier_expires = null
  await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), userId])
}

async function startStream(app: any, who: Who, placement: Placement, extra: any = {}) {
  return db(app, who, {
    table: 'live_streams',
    action: 'insert',
    single: true,
    values: {
      youtube_url: `https://youtu.be/${placement}`,
      title: `${placement} stream`,
      placement,
      is_live: true,
      ...extra,
    },
  })
}

async function endStream(app: any, who: Who, id: string) {
  return db(app, who, {
    table: 'live_streams',
    action: 'update',
    single: true,
    filters: [{ col: 'id', op: 'eq', val: id }],
    values: { is_live: false },
  })
}

describe('live_streams API hardening', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let alice: Who
  let bob: Who

  beforeAll(async () => {
    alice = await signUp(app, 'live_harden_alice')
    bob = await signUp(app, 'live_harden_bob')
  })

  afterAll(async () => {
    await pool.end()
  })

  it('never lets generic updates transfer live_stream or live_session ownership', async () => {
    await setTier(pool, alice.id, 'pro')
    const started = await startStream(app, alice, 'profile', { user_id: bob.id })
    expect(started.status).toBe(200)
    expect(started.body.data.user_id).toBe(alice.id)

    const streamUpdate = await db(app, alice, {
      table: 'live_streams',
      action: 'update',
      single: true,
      filters: [{ col: 'id', op: 'eq', val: started.body.data.id }],
      values: {
        user_id: bob.id,
        placement: 'front_page',
        title: 'title may change',
      },
    })
    expect(streamUpdate.status).toBe(200)
    expect(streamUpdate.body.data.user_id).toBe(alice.id)
    expect(streamUpdate.body.data.placement).toBe('profile')
    expect(streamUpdate.body.data.title).toBe('title may change')

    const bobTakeover = await db(app, bob, {
      table: 'live_streams',
      action: 'update',
      filters: [{ col: 'id', op: 'eq', val: started.body.data.id }],
      values: { title: 'owned by bob' },
    })
    expect(bobTakeover.status).toBe(403)
    await endStream(app, alice, started.body.data.id)

    const session = await db(app, alice, {
      table: 'live_sessions',
      action: 'insert',
      single: true,
      // A live session now needs an embeddable YouTube link (host_id is still
      // FORCED to the caller regardless of the forged value).
      values: { host_id: bob.id, title: 'Alice session', status: 'live', watch_url: 'https://youtu.be/alive1' },
    })
    expect(session.status).toBe(200)
    expect(session.body.data.host_id).toBe(alice.id)

    const sessionUpdate = await db(app, alice, {
      table: 'live_sessions',
      action: 'update',
      single: true,
      filters: [{ col: 'id', op: 'eq', val: session.body.data.id }],
      values: { host_id: bob.id, title: 'still Alice session' },
    })
    expect(sessionUpdate.status).toBe(200)
    expect(sessionUpdate.body.data.host_id).toBe(alice.id)

    const bobEndsSession = await db(app, bob, {
      table: 'live_sessions',
      action: 'update',
      filters: [{ col: 'id', op: 'eq', val: session.body.data.id }],
      values: { status: 'ended' },
    })
    expect(bobEndsSession.status).toBe(403)
  })

  it('rejects a free user forging a creator id to reach front_page', async () => {
    await setTier(pool, bob.id, '')
    const bypass = await startStream(app, bob, 'front_page', { user_id: alice.id })
    expect(bypass.status).toBe(403)

    const rows = await pool.query('select * from live_streams where user_id=$1 and is_live=true', [bob.id])
    expect(rows.rows).toHaveLength(0)
  })

  it('enforces the exact profile/clan/front_page/tournament tier matrix', async () => {
    const tournament = await pool.query(
      'insert into tournaments (name, created_by) values ($1,$2) returning id',
      ['Placement Matrix', alice.id],
    )
    const tournamentId = tournament.rows[0].id
    const placements: Placement[] = ['profile', 'clan', 'front_page', 'tournament']
    const cases = [
      { name: 'matrix_free', tier: '', allowed: [] as Placement[] },
      { name: 'matrix_ad_free', tier: 'ad_free', allowed: [] as Placement[] },
      { name: 'matrix_pro', tier: 'pro', allowed: ['profile', 'tournament'] as Placement[] },
      { name: 'matrix_supporter', tier: 'supporter', allowed: ['profile', 'clan', 'tournament'] as Placement[] },
      { name: 'matrix_creator', tier: 'creator', allowed: placements },
    ]

    for (const testCase of cases) {
      const who = await signUp(app, testCase.name)
      await setTier(pool, who.id, testCase.tier)
      await pool.query(
        'insert into tournament_registrations (tournament_id, user_id) values ($1,$2)',
        [tournamentId, who.id],
      )

      for (const placement of placements) {
        const result = await startStream(app, who, placement)
        const allowed = testCase.allowed.includes(placement)
        expect(result.status, `${testCase.tier || 'free'} -> ${placement}`).toBe(allowed ? 200 : 403)
        if (allowed) {
          expect(result.body.data.user_id).toBe(who.id)
          const ended = await endStream(app, who, result.body.data.id)
          expect(ended.status).toBe(200)
        }
      }
    }
  })

  it('requires tournament involvement even with enough tier or a founder host bypass', async () => {
    const pro = await signUp(app, 'tournament_pro')
    await setTier(pool, pro.id, 'pro')
    expect((await startStream(app, pro, 'tournament')).status).toBe(403)

    const tournament = await pool.query(
      'insert into tournaments (name, created_by) values ($1,$2) returning id',
      ['Current Tournament', alice.id],
    )
    await pool.query(
      'insert into tournament_registrations (tournament_id, user_id) values ($1,$2)',
      [tournament.rows[0].id, pro.id],
    )
    const proTournament = await startStream(app, pro, 'tournament')
    expect(proTournament.status).toBe(200)
    await endStream(app, pro, proTournament.body.data.id)

    const founder = await signUp(app, 'tournament_founder')
    const hostGrant = await request(app).post('/api/fn/redeem-code')
      .set('Authorization', `Bearer ${founder.token}`)
      .send({ code: 'TKO-HOST-M4R7PZ' })
    expect(hostGrant.status).toBe(200)

    for (const placement of ['profile', 'clan', 'front_page'] as Placement[]) {
      const result = await startStream(app, founder, placement)
      expect(result.status, `founder -> ${placement}`).toBe(200)
      await endStream(app, founder, result.body.data.id)
    }
    expect((await startStream(app, founder, 'tournament')).status).toBe(403)

    await pool.query(
      'insert into tournament_admins (tournament_id, user_id) values ($1,$2)',
      [tournament.rows[0].id, founder.id],
    )
    const founderTournament = await startStream(app, founder, 'tournament')
    expect(founderTournament.status).toBe(200)
    await endStream(app, founder, founderTournament.body.data.id)
  })

  it('atomically allows only one concurrent active start for the same user', async () => {
    const who = await signUp(app, 'concurrent_starter')
    await setTier(pool, who.id, 'pro')

    const results = await Promise.all([
      startStream(app, who, 'profile', { title: 'race one' }),
      startStream(app, who, 'profile', { title: 'race two' }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])

    const active = await pool.query(
      'select * from live_streams where user_id=$1 and is_live=true',
      [who.id],
    )
    expect(active.rows).toHaveLength(1)
    expect(['race one', 'race two']).toContain(active.rows[0].title)
  })
})

// ── live-tournament-attach: connect a tournament to a RUNNING show ──────────
// The GoLive form can pre-attach a tournament, but a host who went live without
// one attaches it mid-show through this fn. Host-only, own-tournament-only
// (creator / listed admin / global TKO host), never a completed tournament.
const invokeFn = (app: any, who: Who, name: string, body: any) =>
  request(app).post(`/api/fn/${name}`).set('Authorization', `Bearer ${who.token}`).send(body)

describe('live-tournament-attach — connect a tournament to a running show', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let host: Who
  let rival: Who

  beforeAll(async () => {
    host = await signUp(app, 'attach_host')
    rival = await signUp(app, 'attach_rival')
    await setTier(pool, host.id, 'pro')
    await setTier(pool, rival.id, 'pro')
  })
  afterAll(async () => { await pool.end() })

  async function makeTournament(createdBy: string, name: string, status = 'open') {
    const r = await pool.query(
      'insert into tournaments (name, created_by, status) values ($1,$2,$3) returning *',
      [name, createdBy, status],
    )
    return r.rows[0]
  }

  it('lets the host attach THEIR OWN tournament (created_by, no admin row) and detach it', async () => {
    // Creating a tournament writes NO tournament_admins row — created_by alone
    // must be enough, exactly the case behind "you're not running a tournament".
    const tournament = await makeTournament(host.id, 'Attach Cup')
    const started = await startStream(app, host, 'profile', { title: 'attach show' })
    expect(started.status).toBe(200)
    const streamId = started.body.data.id
    expect(started.body.data.tournament_id ?? null).toBeNull()

    const attach = await invokeFn(app, host, 'live-tournament-attach', {
      liveStreamId: streamId, tournamentId: tournament.id,
    })
    expect(attach.status).toBe(200)
    expect(attach.body.ok).toBe(true)
    expect(String(attach.body.stream.tournament_id)).toBe(String(tournament.id))
    expect(attach.body.stream.show_bracket).toBe(true)

    const detach = await invokeFn(app, host, 'live-tournament-attach', {
      liveStreamId: streamId, tournamentId: null,
    })
    expect(detach.status).toBe(200)
    expect(detach.body.detached).toBe(true)
    expect(detach.body.stream.tournament_id).toBeNull()
    expect(detach.body.stream.show_bracket).toBe(false)
    await endStream(app, host, streamId)
  })

  it('refuses a caller who is not the stream host, and a tournament the host does not run', async () => {
    const theirs = await makeTournament(rival.id, 'Rival Cup')
    const started = await startStream(app, host, 'profile', { title: 'guard show' })
    expect(started.status).toBe(200)
    const streamId = started.body.data.id

    const notYourStream = await invokeFn(app, rival, 'live-tournament-attach', {
      liveStreamId: streamId, tournamentId: theirs.id,
    })
    expect(notYourStream.status).toBe(403)

    const notYourTournament = await invokeFn(app, host, 'live-tournament-attach', {
      liveStreamId: streamId, tournamentId: theirs.id,
    })
    expect(notYourTournament.status).toBe(403)

    const row = await pool.query('select tournament_id from live_streams where id=$1', [streamId])
    expect(row.rows[0].tournament_id).toBeNull()

    // A LISTED admin of someone else's tournament may attach it.
    await pool.query(
      'insert into tournament_admins (tournament_id, user_id) values ($1,$2)',
      [theirs.id, host.id],
    )
    const asAdmin = await invokeFn(app, host, 'live-tournament-attach', {
      liveStreamId: streamId, tournamentId: theirs.id,
    })
    expect(asAdmin.status).toBe(200)
    expect(asAdmin.body.ok).toBe(true)
    await endStream(app, host, streamId)
  })

  it('refuses a completed (closed) tournament', async () => {
    const closed = await makeTournament(host.id, 'Done Cup', 'closed')
    const started = await startStream(app, host, 'profile', { title: 'closed show' })
    expect(started.status).toBe(200)
    const streamId = started.body.data.id

    const refused = await invokeFn(app, host, 'live-tournament-attach', {
      liveStreamId: streamId, tournamentId: closed.id,
    })
    expect(refused.status).toBe(409)
    expect(refused.body.reason).toBe('tournament-closed')
    const row = await pool.query('select tournament_id from live_streams where id=$1', [streamId])
    expect(row.rows[0].tournament_id).toBeNull()
    await endStream(app, host, streamId)
  })

  it('surfaces tournament_id in live-session-list so a recovered show knows its bracket', async () => {
    const tournament = await makeTournament(host.id, 'Recover Cup')
    const started = await startStream(app, host, 'profile', { title: 'recover show' })
    expect(started.status).toBe(200)
    const streamId = started.body.data.id
    const attach = await invokeFn(app, host, 'live-tournament-attach', {
      liveStreamId: streamId, tournamentId: tournament.id,
    })
    expect(attach.body.ok).toBe(true)

    const list = await invokeFn(app, host, 'live-session-list', {})
    expect(list.status).toBe(200)
    const mine = (list.body.streams as any[]).find((s) => String(s.id) === String(streamId))
    expect(mine).toBeTruthy()
    expect(String(mine.tournament_id)).toBe(String(tournament.id))
    await endStream(app, host, streamId)
  })
})

// A public live_streams read runs the stale-live sweep first, so selecting is the
// way to trigger it. Insert rows directly with a backdated updated_at to simulate
// a host who stopped heartbeating, then read + check is_live on the row.
async function insertStream(
  pool: any,
  userId: string,
  opts: { youtube_url: string; placement?: string; game?: string; ageMinutes: number },
): Promise<string> {
  const mins = Number(opts.ageMinutes) || 0
  const r = await pool.query(
    `insert into live_streams (user_id, youtube_url, placement, game, is_live, updated_at, created_at)
       values ($1, $2, $3, $4, true,
               now() - interval '${mins} minutes',
               now() - interval '${mins} minutes')
     returning id`,
    [userId, opts.youtube_url, opts.placement ?? 'profile', opts.game ?? 'Shinobi Striker'],
  )
  return r.rows[0].id
}

async function triggerSweep(app: any) {
  // Any public live_streams read runs expireStaleLiveStreams(pool) before select.
  await db(app, null, {
    table: 'live_streams', action: 'select', columns: '*',
    filters: [{ col: 'is_live', op: 'eq', val: true }],
  })
}

async function isLive(pool: any, id: string): Promise<boolean> {
  const r = await pool.query('select is_live from live_streams where id=$1', [id])
  return r.rows[0]?.is_live === true
}

describe('live_streams — contextual (tiered) session timeouts', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let host: Who

  beforeAll(async () => { host = await signUp(app, 'timeout_host') })
  afterAll(async () => { await pool.end() })

  it('tier 1 — an UNATTACHED live (no playable link) dies inside ~60s', async () => {
    const id = await insertStream(pool, host.id, { youtube_url: '', ageMinutes: 2 })
    await triggerSweep(app)
    expect(await isLive(pool, id)).toBe(false)
  })

  it('tier 2 — an ATTACHED normal live SURVIVES well past 60s (host away 5 min)', async () => {
    const id = await insertStream(pool, host.id, { youtube_url: 'https://youtu.be/attached', ageMinutes: 5 })
    await triggerSweep(app)
    expect(await isLive(pool, id)).toBe(true)

    // …but a normal live that has been silent past ~60 min is finally dropped.
    await pool.query("update live_streams set updated_at = now() - interval '90 minutes' where id=$1", [id])
    await triggerSweep(app)
    expect(await isLive(pool, id)).toBe(false)
  })

  it('tier 3 — a TOURNAMENT live SURVIVES past an hour (up to ~12h)', async () => {
    const id = await insertStream(pool, host.id, {
      youtube_url: 'https://youtu.be/bracket', placement: 'tournament', ageMinutes: 120,
    })
    await triggerSweep(app)
    expect(await isLive(pool, id)).toBe(true)

    // Past the 12-hour bracket window it does finally expire.
    await pool.query("update live_streams set updated_at = now() - interval '13 hours' where id=$1", [id])
    await triggerSweep(app)
    expect(await isLive(pool, id)).toBe(false)
  })
})

describe('live_streams — approved-game gate on the public live read', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let host: Who

  beforeAll(async () => { host = await signUp(app, 'game_gate_host') })
  afterAll(async () => { await pool.end() })

  it('excludes a non-approved-game live from the public "who is live" list', async () => {
    const approvedId = await insertStream(pool, host.id, {
      youtube_url: 'https://youtu.be/approved', game: 'Shinobi Striker', ageMinutes: 0,
    })
    const unapprovedId = await insertStream(pool, host.id, {
      youtube_url: 'https://youtu.be/unapproved', game: 'Fortnite', ageMinutes: 0,
    })

    const r = await db(app, null, {
      table: 'live_streams', action: 'select', columns: '*',
      filters: [{ col: 'is_live', op: 'eq', val: true }],
    })
    expect(r.status).toBe(200)
    const ids = (r.body.data as any[]).map((row) => row.id)
    expect(ids).toContain(approvedId)
    expect(ids).not.toContain(unapprovedId)
  })
})
