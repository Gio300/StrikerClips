/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { makeDb } from './testHarness'
import {
  createApp,
  oracleStreamerShareCents,
  ORACLE_PLATFORM_FEE_RATE,
  ORACLE_STREAMER_FLAT_FEE_CENTS,
} from './app'

const ADULT_DOB = '1995-06-15'

async function signUp(app: any, email: string, username: string) {
  const response = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(response.status).toBe(200)
  return { token: response.body.token as string, id: response.body.user.id as string }
}

const fn = (app: any, token: string, name: string, body: any = {}) =>
  request(app).post(`/api/fn/${name}`).set('Authorization', `Bearer ${token}`).send(body)

async function makeCreatorTier(pool: any, id: string) {
  await pool.query(
    'update users set user_metadata=$1 where id=$2',
    [JSON.stringify({ reelone_tier: 'creator' }), id],
  )
}

async function makeGlobalHost(pool: any, id: string) {
  await pool.query(
    'update users set user_metadata=$1 where id=$2',
    [JSON.stringify({ tko_host: true }), id],
  )
}

async function createStream(pool: any, hostId: string, live = true) {
  const response = await pool.query(
    'insert into live_streams (user_id, youtube_url, is_live) values ($1,$2,$3) returning id',
    [hostId, 'https://youtu.be/live', live],
  )
  return response.rows[0].id as string
}

async function addAngle(pool: any, streamId: string, userId: string, label: string) {
  await pool.query(
    `insert into live_stream_angles (live_stream_id, user_id, label, youtube_url, status)
     values ($1,$2,$3,$4,'live')`,
    [streamId, userId, label, `https://youtu.be/${label}`],
  )
}

async function setWallet(
  pool: any,
  userId: string,
  values: { paidCents?: number; tickets?: number; sweeps?: number; tokens?: number },
) {
  await pool.query(
    `insert into wallets (user_id, tokens, sweeps, paid_sweeps_cents, oracle_tickets)
     values ($1,$2,$3,$4,$5)
     on conflict (user_id) do update set
       tokens=excluded.tokens,
       sweeps=excluded.sweeps,
       paid_sweeps_cents=excluded.paid_sweeps_cents,
       oracle_tickets=excluded.oracle_tickets`,
    [userId, values.tokens ?? 0, values.sweeps ?? 0, values.paidCents ?? 0, values.tickets ?? 0],
  )
}

const ticketsOf = async (pool: any, id: string) =>
  Number((await pool.query('select oracle_tickets from wallets where user_id=$1', [id])).rows[0]?.oracle_tickets ?? 0)

const paidCentsOf = async (pool: any, id: string) =>
  Number((await pool.query('select paid_sweeps_cents from wallets where user_id=$1', [id])).rows[0]?.paid_sweeps_cents ?? 0)

async function makeArtifact(pool: any, ownerId: string, origin: string, official = false) {
  const response = await pool.query(
    `insert into artifacts (owner_id, slug, name, origin, official_override)
     values ($1,$2,$3,$4,$5) returning id`,
    [ownerId, `slug-${origin}-${Math.random().toString(36).slice(2)}`, `Artifact ${origin}`, origin, official],
  )
  return response.rows[0].id as string
}

describe('host-controlled Oracle economy', () => {
  let app: any
  let pool: any
  let host: { token: string; id: string }
  let a: { token: string; id: string }
  let b: { token: string; id: string }
  let c: { token: string; id: string }
  let streamId: string

  beforeEach(async () => {
    pool = makeDb()
    app = createApp(pool)
    host = await signUp(app, 'host@tko.gg', 'host')
    a = await signUp(app, 'a@tko.gg', 'alice')
    b = await signUp(app, 'b@tko.gg', 'bob')
    c = await signUp(app, 'c@tko.gg', 'carol')
    await makeCreatorTier(pool, host.id)
    streamId = await createStream(pool, host.id, true)
  })

  async function openRound() {
    const response = await fn(app, host.token, 'oracle-round-start', { streamId })
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    return {
      ref: String(response.body.round.match_ref),
      choices: response.body.round.choices as Array<{ key: string; label: string }>,
    }
  }

  async function lockRound(matchRef: string) {
    await pool.query(
      "update oracle_live_rounds set status='locked', locks_at=$2 where match_ref=$1",
      [matchRef, new Date(Date.now() - 1_000).toISOString()],
    )
  }

  it('requires the host, a live eligible stream, and at least two attached participants', async () => {
    const before = await fn(app, a.token, 'oracle-bet-config', { streamId })
    expect(before.body.eligible).toBe(false)
    expect(before.body.reason).toBe('host-has-not-started')

    const notHost = await fn(app, a.token, 'oracle-round-start', { streamId })
    expect(notHost.status).toBe(403)

    const oneParticipant = await fn(app, host.token, 'oracle-round-start', { streamId })
    expect(oneParticipant.body.ok).toBe(false)
    expect(oneParticipant.body.reason).toBe('not-enough-participants')

    await addAngle(pool, streamId, a.id, 'alice')
    const opened = await openRound()
    expect(opened.choices).toHaveLength(2)
    expect(opened.choices.map((choice) => choice.key)).toEqual(['team:a', 'team:b'])

    const idempotent = await fn(app, host.token, 'oracle-round-start', { streamId })
    expect(idempotent.body.ok).toBe(true)
    expect(idempotent.body.started).toBe(false)
    expect(idempotent.body.round.match_ref).toBe(opened.ref)
  })

  it('shares editable team names and advances the score before opening the next round', async () => {
    await addAngle(pool, streamId, a.id, 'alice')

    const denied = await fn(app, b.token, 'live-scoreboard-update', {
      streamId,
      teamA: 'Hidden Leaf',
      teamB: 'Hidden Cloud',
    })
    expect(denied.status).toBe(403)

    const renamed = await fn(app, host.token, 'live-scoreboard-update', {
      streamId,
      teamA: 'Hidden Leaf',
      teamB: 'Hidden Cloud',
    })
    expect(renamed.status).toBe(200)
    expect(renamed.body.scoreboard).toMatchObject({
      team_a: 'Hidden Leaf',
      team_b: 'Hidden Cloud',
      score_a: 0,
      score_b: 0,
    })

    const round = await openRound()
    expect(round.choices).toEqual([
      { key: 'team:a', label: 'Hidden Leaf' },
      { key: 'team:b', label: 'Hidden Cloud' },
    ])
    await lockRound(round.ref)

    const settled = await fn(app, host.token, 'oracle-bet-resolve', {
      matchRef: round.ref,
      winningChoice: 'team:a',
      losingChoice: 'team:b',
    })
    expect(settled.status).toBe(200)
    expect(settled.body.scoreboard).toMatchObject({
      team_a: 'Hidden Leaf',
      team_b: 'Hidden Cloud',
      score_a: 1,
      score_b: 0,
    })

    const stored = await pool.query(
      'select team_a,team_b,score_a,score_b from live_streams where id=$1',
      [streamId],
    )
    expect(stored.rows[0]).toMatchObject({
      team_a: 'Hidden Leaf',
      team_b: 'Hidden Cloud',
      score_a: 1,
      score_b: 0,
    })

    const next = await fn(app, host.token, 'oracle-round-start', { streamId })
    expect(next.body.started).toBe(true)
    expect(next.body.round.match_ref).not.toBe(round.ref)
    expect(next.body.scoreboard.score_a).toBe(1)
  })

  it('lets the owner rename teams even when the stream is not eligible for Oracle', async () => {
    const regularHost = await signUp(app, 'regular-host@tko.gg', 'regular-host')
    const regularStream = await createStream(pool, regularHost.id, true)

    const renamed = await fn(app, regularHost.token, 'live-scoreboard-update', {
      streamId: regularStream,
      teamA: 'Team Seven',
      teamB: 'Sand Squad',
    })

    expect(renamed.status).toBe(200)
    expect(renamed.body.scoreboard).toMatchObject({
      team_a: 'Team Seven',
      team_b: 'Sand Squad',
    })
  })

  it('lets only the host set scores directly, whole numbers only', async () => {
    const scoreHost = await signUp(app, 'score-host@tko.gg', 'score-host')
    const scoreStream = await createStream(pool, scoreHost.id, true)
    const viewer = await signUp(app, 'score-viewer@tko.gg', 'score-viewer')

    // Viewer-side writes are refused — the scoreboard is host-global state.
    const denied = await fn(app, viewer.token, 'live-scoreboard-update', {
      streamId: scoreStream,
      scoreA: 5,
    })
    expect(denied.status).toBe(403)

    // Host sets one side; the other is untouched (coalesce).
    const bumped = await fn(app, scoreHost.token, 'live-scoreboard-update', {
      streamId: scoreStream,
      scoreA: 2,
    })
    expect(bumped.status).toBe(200)
    expect(bumped.body.scoreboard).toMatchObject({ score_a: 2, score_b: 0 })

    const both = await fn(app, scoreHost.token, 'live-scoreboard-update', {
      streamId: scoreStream,
      scoreB: 3,
    })
    expect(both.status).toBe(200)
    expect(both.body.scoreboard).toMatchObject({ score_a: 2, score_b: 3 })

    // Garbage is rejected outright.
    const negative = await fn(app, scoreHost.token, 'live-scoreboard-update', {
      streamId: scoreStream,
      scoreA: -1,
    })
    expect(negative.status).toBe(400)
    const fractional = await fn(app, scoreHost.token, 'live-scoreboard-update', {
      streamId: scoreStream,
      scoreB: 2.5,
    })
    expect(fractional.status).toBe(400)
  })

  it('lets only the host publish the on-air host view, with a validated shape', async () => {
    const viewHost = await signUp(app, 'view-host@tko.gg', 'view-host')
    const viewStream = await createStream(pool, viewHost.id, true)
    const watcher = await signUp(app, 'view-watcher@tko.gg', 'view-watcher')

    const denied = await fn(app, watcher.token, 'live-host-view', {
      streamId: viewStream, layout: 'solo', feeds: ['host'],
    })
    expect(denied.status).toBe(403)

    const badLayout = await fn(app, viewHost.token, 'live-host-view', {
      streamId: viewStream, layout: 'cinema', feeds: ['host'],
    })
    expect(badLayout.status).toBe(400)

    const noFeeds = await fn(app, viewHost.token, 'live-host-view', {
      streamId: viewStream, layout: 'solo', feeds: [],
    })
    expect(noFeeds.status).toBe(400)

    const ok = await fn(app, viewHost.token, 'live-host-view', {
      streamId: viewStream, layout: 'duo', feeds: ['host', 'some-angle-id'],
    })
    expect(ok.status).toBe(200)
    const row = await pool.query('select host_view from live_streams where id=$1', [viewStream])
    const view = typeof row.rows[0].host_view === 'string'
      ? JSON.parse(row.rows[0].host_view)
      : row.rows[0].host_view
    expect(view.layout).toBe('duo')
    expect(view.feeds).toEqual(['host', 'some-angle-id'])
  })

  it('uses a server-owned choice list and refuses stale or invented outcomes', async () => {
    await addAngle(pool, streamId, a.id, 'alice')
    const round = await openRound()
    await setWallet(pool, b.id, { tickets: 5 })

    const invented = await fn(app, b.token, 'oracle-bet', {
      streamId,
      matchRef: round.ref,
      choice: 'some-random-player',
      stakeKind: 'ticket',
      amount: 1,
    })
    expect(invented.body.reason).toBe('invalid-choice')

    const stale = await fn(app, b.token, 'oracle-bet', {
      streamId,
      matchRef: 'stale-round',
      choice: round.choices[0].key,
      stakeKind: 'ticket',
      amount: 1,
    })
    expect(stale.body.reason).toBe('stale-match')
    expect(await ticketsOf(pool, b.id)).toBe(5)
  })

  it('keeps free daily points as Oracle-only tickets with zero cash basis', async () => {
    const first = await fn(app, b.token, 'sweeps-daily')
    expect(first.body.grantedKind).toBe('oracle_tickets')
    expect(first.body.wallet.oracle_tickets).toBe(3)
    expect(first.body.wallet.sweeps).toBe(0)
    expect(first.body.wallet.paid_sweeps_cents).toBe(0)

    const second = await fn(app, b.token, 'sweeps-daily')
    expect(second.body.ok).toBe(false)
    expect(second.body.reason).toBe('already-claimed')
  })

  it('escrows ticket stakes at zero cents and never pays the streamer from them', async () => {
    await addAngle(pool, streamId, a.id, 'alice')
    const round = await openRound()
    const [blue, red] = round.choices.map((choice) => choice.key)
    await setWallet(pool, b.id, { tickets: 10 })
    await setWallet(pool, c.id, { tickets: 10 })

    expect((await fn(app, b.token, 'oracle-bet', { streamId, matchRef: round.ref, choice: blue, stakeKind: 'ticket', amount: 4 })).body.ok).toBe(true)
    expect((await fn(app, c.token, 'oracle-bet', { streamId, matchRef: round.ref, choice: red, stakeKind: 'ticket', amount: 6 })).body.ok).toBe(true)
    const stored = await pool.query('select stake_cents from oracle_bets where match_ref=$1', [round.ref])
    expect(stored.rows.every((row: any) => Number(row.stake_cents) === 0)).toBe(true)

    await lockRound(round.ref)
    const resolved = await fn(app, host.token, 'oracle-bet-resolve', {
      matchRef: round.ref,
      winningChoice: blue,
      losingChoice: red,
    })
    expect(resolved.body.resolved).toBe(true)
    expect(resolved.body.streamer_cents).toBe(0)
    expect(await paidCentsOf(pool, host.id)).toBe(0)
    expect(await ticketsOf(pool, b.id)).toBe(16)
    expect(await ticketsOf(pool, c.id)).toBe(4)
  })

  it('requires a distinct verified winner and loser after the server timer locks', async () => {
    await addAngle(pool, streamId, a.id, 'alice')
    const round = await openRound()
    const [winner, loser] = round.choices.map((choice) => choice.key)

    const early = await fn(app, host.token, 'oracle-bet-resolve', {
      matchRef: round.ref,
      winningChoice: winner,
      losingChoice: loser,
    })
    expect(early.body.reason).toBe('betting-open')

    await lockRound(round.ref)
    const same = await fn(app, host.token, 'oracle-bet-resolve', {
      matchRef: round.ref,
      winningChoice: winner,
      losingChoice: winner,
    })
    expect(same.body.reason).toBe('winner-and-loser-required')

    const invalid = await fn(app, host.token, 'oracle-bet-resolve', {
      matchRef: round.ref,
      winningChoice: winner,
      losingChoice: 'not-attached',
    })
    expect(invalid.body.reason).toBe('invalid-result')
  })

  it('enforces one bet per user, host exclusion, and the host minimum', async () => {
    await addAngle(pool, streamId, a.id, 'alice')
    const round = await openRound()
    const choice = round.choices[0].key
    await fn(app, host.token, 'oracle-bet-config-set', { streamId, minBet: 4, minStakeKind: 'ticket' })
    await setWallet(pool, b.id, { tickets: 10 })
    await setWallet(pool, host.id, { tickets: 10 })

    expect((await fn(app, b.token, 'oracle-bet', { streamId, matchRef: round.ref, choice, stakeKind: 'ticket', amount: 2 })).body.reason).toBe('below-minimum')
    expect((await fn(app, b.token, 'oracle-bet', { streamId, matchRef: round.ref, choice, stakeKind: 'ticket', amount: 4 })).body.ok).toBe(true)
    expect((await fn(app, b.token, 'oracle-bet', { streamId, matchRef: round.ref, choice, stakeKind: 'ticket', amount: 4 })).body.reason).toBe('already-bet')
    expect((await fn(app, host.token, 'oracle-bet', { streamId, matchRef: round.ref, choice, stakeKind: 'ticket', amount: 4 })).body.reason).toBe('host-cannot-bet')
    expect(await ticketsOf(pool, b.id)).toBe(6)
  })

  it('allows only forged or purchased non-official artifacts', async () => {
    await addAngle(pool, streamId, a.id, 'alice')
    const round = await openRound()
    const choice = round.choices[0].key
    const forged = await makeArtifact(pool, b.id, 'forge')
    expect((await fn(app, b.token, 'oracle-bet', { streamId, matchRef: round.ref, choice, stakeKind: 'artifact', artifactId: forged })).body.ok).toBe(true)

    for (const origin of ['free', 'seed', 'reward', 'prize']) {
      const artifact = await makeArtifact(pool, c.id, origin)
      const response = await fn(app, c.token, 'oracle-bet', { streamId, matchRef: round.ref, choice, stakeKind: 'artifact', artifactId: artifact })
      expect(response.body.reason).toBe('artifact-not-bettable')
    }
  })

  it('conserves paid Sweeps and caps streamer revenue at 25 percent of paid flow', async () => {
    await addAngle(pool, streamId, a.id, 'alice')
    const round = await openRound()
    const [blue, red] = round.choices.map((choice) => choice.key)
    await setWallet(pool, b.id, { paidCents: 10_000 })
    await setWallet(pool, c.id, { paidCents: 10_000 })
    await fn(app, b.token, 'oracle-bet', { streamId, matchRef: round.ref, choice: blue, stakeKind: 'sweeps', amount: 6_000 })
    await fn(app, c.token, 'oracle-bet', { streamId, matchRef: round.ref, choice: red, stakeKind: 'sweeps', amount: 4_000 })

    await lockRound(round.ref)
    const result = await fn(app, host.token, 'oracle-bet-resolve', {
      matchRef: round.ref,
      winningChoice: blue,
      losingChoice: red,
    })
    expect(result.body.sweeps_cents_in).toBe(10_000)
    expect(await paidCentsOf(pool, b.id)).toBe(14_000)
    expect(await paidCentsOf(pool, c.id)).toBe(6_000)
    const gross = Math.floor(10_000 * 0.25)
    const expected = gross - ORACLE_STREAMER_FLAT_FEE_CENTS - Math.floor(gross * ORACLE_PLATFORM_FEE_RATE)
    expect(result.body.streamer_cents).toBe(expected)
    expect(result.body.streamer_cents).toBeLessThanOrEqual(gross)
  })

  it('refunds every active stake on cancel and cannot settle twice', async () => {
    await addAngle(pool, streamId, a.id, 'alice')
    const round = await openRound()
    const [blue, red] = round.choices.map((choice) => choice.key)
    await setWallet(pool, b.id, { tickets: 8 })
    await setWallet(pool, c.id, { paidCents: 8_000 })
    await fn(app, b.token, 'oracle-bet', { streamId, matchRef: round.ref, choice: blue, stakeKind: 'ticket', amount: 3 })
    await fn(app, c.token, 'oracle-bet', { streamId, matchRef: round.ref, choice: red, stakeKind: 'sweeps', amount: 3_000 })

    const cancelled = await fn(app, host.token, 'oracle-bet-cancel', { matchRef: round.ref })
    expect(cancelled.body.cancelled).toBe(true)
    expect(await ticketsOf(pool, b.id)).toBe(8)
    expect(await paidCentsOf(pool, c.id)).toBe(8_000)

    const again = await fn(app, host.token, 'oracle-bet-resolve', {
      matchRef: round.ref,
      winningChoice: blue,
      losingChoice: red,
    })
    expect(again.body.reason).toBe('already-settled')
  })

  it('lets a global TKO host settle but rejects an ordinary viewer', async () => {
    await addAngle(pool, streamId, a.id, 'alice')
    const round = await openRound()
    const [winner, loser] = round.choices.map((choice) => choice.key)
    await lockRound(round.ref)

    const denied = await fn(app, b.token, 'oracle-bet-resolve', {
      matchRef: round.ref,
      winningChoice: winner,
      losingChoice: loser,
    })
    expect(denied.status).toBe(403)

    const globalHost = await signUp(app, 'global@tko.gg', 'globalhost')
    await makeGlobalHost(pool, globalHost.id)
    const allowed = await fn(app, globalHost.token, 'oracle-bet-resolve', {
      matchRef: round.ref,
      winningChoice: winner,
      losingChoice: loser,
    })
    expect(allowed.body.resolved).toBe(true)
  })

  it('fails closed for offline, free-host, and non-stream content', async () => {
    await setWallet(pool, b.id, { tickets: 10 })
    const offline = await createStream(pool, host.id, false)
    expect((await fn(app, b.token, 'oracle-bet-config', { streamId: offline })).body.reason).toBe('not-live')

    const free = await signUp(app, 'free@tko.gg', 'freebie')
    const freeStream = await createStream(pool, free.id, true)
    expect((await fn(app, b.token, 'oracle-bet-config', { streamId: freeStream })).body.reason).toBe('not-host-tier')

    expect((await fn(app, b.token, 'oracle-bet-config', { streamId: '00000000-0000-4000-8000-000000000000' })).body.reason).toBe('no-stream')
    expect(await ticketsOf(pool, b.id)).toBe(10)
  })

  it('keeps the pure streamer cap formula below 25 percent cumulatively', () => {
    let totalIn = 0
    let totalPaid = 0
    for (let index = 0; index < 200; index += 1) {
      const settlement = Math.floor(Math.random() * 100_000)
      const payout = oracleStreamerShareCents(settlement, totalIn, totalPaid)
      totalIn += settlement
      totalPaid += payout
      expect(totalPaid).toBeLessThanOrEqual(Math.floor(totalIn * 0.25))
    }
  })
})
