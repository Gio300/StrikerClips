/* eslint-disable @typescript-eslint/no-explicit-any */
// ORACLE BETTING ECONOMY — money-safety suite.
//
// Proves the operator's Rules 1–4 hold end-to-end against a real SQL engine
// (pg-mem): the daily grant is ORACLE-USE-ONLY tickets; bets are LIVE +
// host-tier only; stakes are tickets / PAID sweeps / FORGED-or-purchased
// artifacts only; one bet per game; the pot is conserved; and — the invariant
// that protects the business — cumulative streamer payout can NEVER exceed 25%
// of the real sweeps-cents bet on a stream.
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { makeDb } from './testHarness'
import {
  createApp,
  oracleStreamerShareCents,
  ORACLE_STREAMER_FLAT_FEE_CENTS,
  ORACLE_PLATFORM_FEE_RATE,
} from './app'

const ADULT_DOB = '1995-06-15'

async function signUp(app: any, email: string, username: string) {
  const r = await request(app).post('/api/auth/signup').send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token as string, id: r.body.user.id as string }
}
const fn = (app: any, token: string, name: string, body: any) =>
  request(app).post(`/api/fn/${name}`).set('Authorization', `Bearer ${token}`).send(body)

async function makeGlobalHost(pool: any, id: string) {
  await pool.query(`update users set user_metadata=$1 where id=$2`, [JSON.stringify({ tko_host: true }), id])
}
async function makeCreatorTier(pool: any, id: string) {
  await pool.query(`update users set user_metadata=$1 where id=$2`, [JSON.stringify({ reelone_tier: 'creator' }), id])
}
async function createStream(pool: any, hostId: string, live = true) {
  const r = await pool.query(
    `insert into live_streams (user_id, youtube_url, is_live) values ($1,$2,$3) returning id`,
    [hostId, 'https://youtu.be/live', live],
  )
  return r.rows[0].id as string
}
async function setWallet(pool: any, userId: string, w: { paidCents?: number; tickets?: number; sweeps?: number; tokens?: number }) {
  await pool.query(
    `insert into wallets (user_id, tokens, sweeps, paid_sweeps_cents, oracle_tickets) values ($1,$2,$3,$4,$5)
       on conflict (user_id) do update set tokens=excluded.tokens, sweeps=excluded.sweeps,
         paid_sweeps_cents=excluded.paid_sweeps_cents, oracle_tickets=excluded.oracle_tickets`,
    [userId, w.tokens ?? 0, w.sweeps ?? 0, w.paidCents ?? 0, w.tickets ?? 0],
  )
}
const ticketsOf = async (pool: any, id: string) =>
  Number((await pool.query('select oracle_tickets from wallets where user_id=$1', [id])).rows[0]?.oracle_tickets ?? 0)
const paidCentsOf = async (pool: any, id: string) =>
  Number((await pool.query('select paid_sweeps_cents from wallets where user_id=$1', [id])).rows[0]?.paid_sweeps_cents ?? 0)
async function makeArtifact(pool: any, ownerId: string, origin: string, official = false) {
  const r = await pool.query(
    `insert into artifacts (owner_id, slug, name, origin, official_override) values ($1,$2,$3,$4,$5) returning id`,
    [ownerId, 'slug-' + origin + '-' + Math.random().toString(36).slice(2), 'Artifact ' + origin, origin, official],
  )
  return r.rows[0].id as string
}

describe('Oracle betting economy', () => {
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
    await makeCreatorTier(pool, host.id)      // a top-tier user who may host
    streamId = await createStream(pool, host.id, true)
  })

  const ref = (s = 'm1') => `live:${streamId}:${s}`

  // ---- Rule 1: the daily grant is ORACLE-USE-ONLY tickets, once/day ---------
  it('the daily grant credits N oracle tickets, once per day, and never $', async () => {
    const first = await fn(app, a.token, 'sweeps-daily', {})
    expect(first.body.ok).toBe(true)
    expect(first.body.granted).toBe(3)
    expect(first.body.grantedKind).toBe('oracle_tickets')
    expect(first.body.wallet.oracle_tickets).toBe(3)
    expect(first.body.wallet.sweeps).toBe(0)          // NOT $-flow currency
    expect(first.body.wallet.paid_sweeps_cents).toBe(0)

    const second = await fn(app, a.token, 'sweeps-daily', {})
    expect(second.body.ok).toBe(false)
    expect(second.body.reason).toBe('already-claimed')
    expect(await ticketsOf(pool, a.id)).toBe(3)
  })

  // ---- Rule 3: a ticket bet places with stake_cents = 0 --------------------
  it('a ticket bet escrows tickets and carries stake_cents = 0', async () => {
    await setWallet(pool, a.id, { tickets: 5 })
    const r = await fn(app, a.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'blue', stakeKind: 'ticket', amount: 2 })
    expect(r.body.ok).toBe(true)
    expect(await ticketsOf(pool, a.id)).toBe(3)       // 5 - 2 escrowed
    const row = (await pool.query('select * from oracle_bets where match_ref=$1 and user_id=$2', [ref(), a.id])).rows[0]
    expect(row.stake_kind).toBe('ticket')
    expect(Number(row.stake_amount)).toBe(2)
    expect(Number(row.stake_cents)).toBe(0)
    expect(row.status).toBe('active')
  })

  // ---- Rule 4 basis: a paid-sweeps bet tracks stake_cents ------------------
  it('a paid-sweeps bet debits paid_sweeps_cents and records stake_cents', async () => {
    await setWallet(pool, a.id, { paidCents: 5000 })
    const r = await fn(app, a.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'blue', stakeKind: 'sweeps', amount: 1000 })
    expect(r.body.ok).toBe(true)
    expect(await paidCentsOf(pool, a.id)).toBe(4000)
    const row = (await pool.query('select * from oracle_bets where match_ref=$1 and user_id=$2', [ref(), a.id])).rows[0]
    expect(Number(row.stake_cents)).toBe(1000)
    expect(Number(row.stake_amount)).toBe(1000)
  })

  // ---- Rule 3: forged/purchased artifacts bettable; free/earned refused ----
  it('a forged artifact is bettable; free/seed/reward/prize and official are refused', async () => {
    const forged = await makeArtifact(pool, a.id, 'forge')
    const ok = await fn(app, a.token, 'oracle-bet', { matchRef: ref('f'), streamId, choice: 'blue', stakeKind: 'artifact', artifactId: forged })
    expect(ok.body.ok).toBe(true)

    for (const bad of ['free', 'seed', 'reward', 'prize']) {
      const art = await makeArtifact(pool, b.id, bad)
      const res = await fn(app, b.token, 'oracle-bet', { matchRef: ref('bad-' + bad), streamId, choice: 'blue', stakeKind: 'artifact', artifactId: art })
      expect(res.body.ok).toBe(false)
      expect(res.body.reason).toBe('artifact-not-bettable')
    }
    // A host-issued official (official_override) is not bettable even if forged.
    const official = await makeArtifact(pool, c.id, 'forge', true)
    const off = await fn(app, c.token, 'oracle-bet', { matchRef: ref('off'), streamId, choice: 'blue', stakeKind: 'artifact', artifactId: official })
    expect(off.body.ok).toBe(false)
    expect(off.body.reason).toBe('artifact-not-bettable')
    // Someone else's artifact can't be staked.
    const mine = await makeArtifact(pool, a.id, 'forge')
    const theft = await fn(app, b.token, 'oracle-bet', { matchRef: ref('theft'), streamId, choice: 'blue', stakeKind: 'artifact', artifactId: mine })
    expect(theft.body.reason).toBe('artifact-not-owned')
  })

  // ---- Rule 2: one bet per game -------------------------------------------
  it('enforces one bet per (match, user) and does not double-charge', async () => {
    await setWallet(pool, a.id, { tickets: 10 })
    const one = await fn(app, a.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'blue', stakeKind: 'ticket', amount: 3 })
    expect(one.body.ok).toBe(true)
    const two = await fn(app, a.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'red', stakeKind: 'ticket', amount: 3 })
    expect(two.body.ok).toBe(false)
    expect(two.body.reason).toBe('already-bet')
    expect(await ticketsOf(pool, a.id)).toBe(7)       // charged exactly once
  })

  // ---- the streamer minimum -----------------------------------------------
  it('enforces the streamer-set minimum bet', async () => {
    const set = await fn(app, host.token, 'oracle-bet-config-set', { streamId, minBet: 5, minStakeKind: 'ticket' })
    expect(set.body.ok).toBe(true)
    await setWallet(pool, a.id, { tickets: 20 })
    const low = await fn(app, a.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'blue', stakeKind: 'ticket', amount: 3 })
    expect(low.body.ok).toBe(false)
    expect(low.body.reason).toBe('below-minimum')
    const ok = await fn(app, a.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'blue', stakeKind: 'ticket', amount: 5 })
    expect(ok.body.ok).toBe(true)
  })

  // ---- Rule 2: only live, host-tier streams accept bets --------------------
  it('refuses bets on non-live, non-host-tier, and pre-recorded streams', async () => {
    await setWallet(pool, a.id, { tickets: 10 })

    // (a) a live stream that has since gone offline
    const offline = await createStream(pool, host.id, false)
    const r1 = await fn(app, a.token, 'oracle-bet', { matchRef: ref('x'), streamId: offline, choice: 'blue', stakeKind: 'ticket', amount: 1 })
    expect(r1.body.reason).toBe('not-live')

    // (b) a live stream hosted by a NON-host-tier (free) user
    const free = await signUp(app, 'free@tko.gg', 'freebie')
    const freeStream = await createStream(pool, free.id, true)
    const r2 = await fn(app, a.token, 'oracle-bet', { matchRef: ref('y'), streamId: freeStream, choice: 'blue', stakeKind: 'ticket', amount: 1 })
    expect(r2.body.reason).toBe('not-host-tier')

    // (c) a pre-recorded / automerge video — not a live_streams row at all
    const r3 = await fn(app, a.token, 'oracle-bet', { matchRef: ref('z'), streamId: '00000000-0000-4000-8000-000000000000', choice: 'blue', stakeKind: 'ticket', amount: 1 })
    expect(r3.body.reason).toBe('no-stream')

    // nothing was charged for any refused bet
    expect(await ticketsOf(pool, a.id)).toBe(10)
  })

  // ---- resolve pays winners, conserves the pot, tickets earn the streamer $0 -
  it('resolve pays ticket winners pro-rata, conserves the pot, and pays the streamer $0 for ticket-only games', async () => {
    await setWallet(pool, a.id, { tickets: 10 })
    await setWallet(pool, b.id, { tickets: 30 })
    await setWallet(pool, c.id, { tickets: 40 })
    await fn(app, a.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'blue', stakeKind: 'ticket', amount: 10 })
    await fn(app, b.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'blue', stakeKind: 'ticket', amount: 30 })
    await fn(app, c.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'red', stakeKind: 'ticket', amount: 40 })

    const hostBefore = await paidCentsOf(pool, host.id)
    const res = await fn(app, host.token, 'oracle-bet-resolve', { matchRef: ref(), winningChoice: 'blue' })
    expect(res.body.ok).toBe(true)
    expect(res.body.resolved).toBe(true)
    // pot = 80 tickets, winner stake = 40 → a:20, b:60 (sum == 80, conserved)
    expect(await ticketsOf(pool, a.id)).toBe(20)
    expect(await ticketsOf(pool, b.id)).toBe(60)
    expect(await ticketsOf(pool, c.id)).toBe(0)
    const paid = res.body.results.tickets.winners.reduce((s: number, w: any) => s + w.payout, 0)
    expect(paid).toBe(80)                              // pot conserved exactly
    // Tickets are $0 basis → the streamer earns nothing from a ticket-only game.
    expect(res.body.streamer_cents).toBe(0)
    expect(await paidCentsOf(pool, host.id)).toBe(hostBefore)
  })

  // ---- Rule 4: paid-sweeps settlement — 25% share minus $2 + platform fee ---
  it('pays the streamer a capped 25% of the sweeps-$ minus the $2 flat + platform fee, and conserves the pot', async () => {
    await setWallet(pool, a.id, { paidCents: 10000 })
    await setWallet(pool, b.id, { paidCents: 10000 })
    // pot = 10000¢ ($100). a wins, b loses.
    await fn(app, a.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'blue', stakeKind: 'sweeps', amount: 6000 })
    await fn(app, b.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'red', stakeKind: 'sweeps', amount: 4000 })

    const res = await fn(app, host.token, 'oracle-bet-resolve', { matchRef: ref(), winningChoice: 'blue' })
    expect(res.body.ok).toBe(true)
    expect(res.body.sweeps_cents_in).toBe(10000)

    // The winner takes the WHOLE pot (single winner) — conserved, not minted.
    // a started 10000, staked 6000 → 4000, won 10000 → 14000.
    expect(await paidCentsOf(pool, a.id)).toBe(14000)
    expect(await paidCentsOf(pool, b.id)).toBe(6000)   // staked 4000, lost

    // Streamer share = 25% of 10000 = 2500, minus $2 flat (200) minus platform
    // fee floor(2500 * rate). Credited from the platform, never from the pot.
    const gross = Math.floor(10000 * 0.25)             // 2500
    const platformFee = Math.floor(gross * ORACLE_PLATFORM_FEE_RATE)
    const expected = gross - ORACLE_STREAMER_FLAT_FEE_CENTS - platformFee
    expect(res.body.streamer_cents).toBe(expected)
    expect(res.body.streamer_cents).toBeLessThanOrEqual(gross) // never exceeds 25%
    expect(await paidCentsOf(pool, host.id)).toBe(expected)
  })

  // ---- Rule 4 HARD CAP: cumulative streamer payout ≤ 25% of sweeps sold -----
  it('HARD CAP: $10,000 of paid sweeps all bet on one stream → streamer earns ≤ $2,500 ever', async () => {
    // Two bettors, 10 matches, each a 100000¢ ($1,000) pot (50000 each side,
    // one side wins) → 1,000,000¢ ($10,000) of sweeps flows on this stream.
    await setWallet(pool, a.id, { paidCents: 6_000_000 })
    await setWallet(pool, b.id, { paidCents: 6_000_000 })

    for (let i = 0; i < 10; i++) {
      const m = ref('cap-' + i)
      await fn(app, a.token, 'oracle-bet', { matchRef: m, streamId, choice: 'blue', stakeKind: 'sweeps', amount: 50_000 })
      await fn(app, b.token, 'oracle-bet', { matchRef: m, streamId, choice: 'red', stakeKind: 'sweeps', amount: 50_000 })
      const res = await fn(app, host.token, 'oracle-bet-resolve', { matchRef: m, winningChoice: 'blue' })
      expect(res.body.ok).toBe(true)
    }

    const tally = (await pool.query('select sweeps_cents_in, streamer_cents_paid from oracle_stream_tally where stream_id=$1', [streamId])).rows[0]
    expect(Number(tally.sweeps_cents_in)).toBe(1_000_000)             // $10,000 flowed
    // THE INVARIANT: streamer payout can NEVER exceed 25% of the sweeps-$ bet.
    expect(Number(tally.streamer_cents_paid)).toBeLessThanOrEqual(250_000) // ≤ $2,500
    expect(await paidCentsOf(pool, host.id)).toBe(Number(tally.streamer_cents_paid))
    expect(await paidCentsOf(pool, host.id)).toBeLessThanOrEqual(250_000)
    // With the $2 + platform fee, the actual total is well under the cap.
    const perMatch = Math.floor(100_000 * 0.25) - ORACLE_STREAMER_FLAT_FEE_CENTS - Math.floor(Math.floor(100_000 * 0.25) * ORACLE_PLATFORM_FEE_RATE)
    expect(Number(tally.streamer_cents_paid)).toBe(perMatch * 10)
  })

  // ---- Rule 4 cap clamp, in isolation (the pure formula) -------------------
  it('oracleStreamerShareCents clamps hard so cumulative payout can never pass 25%', () => {
    // Fresh stream: 100000¢ in → 25000 gross, minus fees.
    const gross = Math.floor(100_000 * 0.25)
    const fee = Math.floor(gross * ORACLE_PLATFORM_FEE_RATE)
    expect(oracleStreamerShareCents(100_000, 0, 0)).toBe(gross - ORACLE_STREAMER_FLAT_FEE_CENTS - fee)
    // If the streamer was ALREADY paid the full 25% of the running total, a new
    // settlement is clamped to 0 — the cap bites even if fees were zero.
    expect(oracleStreamerShareCents(100_000, 0, 25_000)).toBe(0)
    // Partial headroom: only the remaining cap room is payable.
    // prior in 0, prior paid 20000, this settlement in 100000 →
    // capRemaining = floor(100000*0.25) - 20000 = 5000; share (17300) clamps to 5000.
    expect(oracleStreamerShareCents(100_000, 0, 20_000)).toBe(5_000)
    // Randomised: cumulative payout across a sequence never exceeds 25% of in.
    let totIn = 0, totPaid = 0
    for (let i = 0; i < 200; i++) {
      const s = Math.floor(Math.random() * 100_000)
      const pay = oracleStreamerShareCents(s, totIn, totPaid)
      totIn += s; totPaid += pay
      expect(totPaid).toBeLessThanOrEqual(Math.floor(totIn * 0.25))
    }
  })

  // ---- idempotent resolve --------------------------------------------------
  it('resolve is idempotent — a second call settles nothing and pays no one twice', async () => {
    await setWallet(pool, a.id, { paidCents: 10000 })
    await setWallet(pool, b.id, { paidCents: 10000 })
    await fn(app, a.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'blue', stakeKind: 'sweeps', amount: 5000 })
    await fn(app, b.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'red', stakeKind: 'sweeps', amount: 5000 })

    const first = await fn(app, host.token, 'oracle-bet-resolve', { matchRef: ref(), winningChoice: 'blue' })
    expect(first.body.resolved).toBe(true)
    const hostAfterFirst = await paidCentsOf(pool, host.id)
    const winnerAfterFirst = await paidCentsOf(pool, a.id)

    const again = await fn(app, host.token, 'oracle-bet-resolve', { matchRef: ref(), winningChoice: 'blue' })
    expect(again.body.resolved).toBe(false)
    expect(again.body.reason).toBe('already-settled')
    expect(await paidCentsOf(pool, host.id)).toBe(hostAfterFirst)   // no double streamer pay
    expect(await paidCentsOf(pool, a.id)).toBe(winnerAfterFirst)    // no double payout
  })

  // ---- cancel refunds every active stake ----------------------------------
  it('cancel refunds tickets and paid sweeps, and blocks a later resolve', async () => {
    await setWallet(pool, a.id, { tickets: 10 })
    await setWallet(pool, b.id, { paidCents: 8000 })
    await fn(app, a.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'blue', stakeKind: 'ticket', amount: 4 })
    await fn(app, b.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'red', stakeKind: 'sweeps', amount: 3000 })
    expect(await ticketsOf(pool, a.id)).toBe(6)
    expect(await paidCentsOf(pool, b.id)).toBe(5000)

    const cancel = await fn(app, host.token, 'oracle-bet-cancel', { matchRef: ref() })
    expect(cancel.body.ok).toBe(true)
    expect(cancel.body.cancelled).toBe(true)
    expect(await ticketsOf(pool, a.id)).toBe(10)     // fully refunded
    expect(await paidCentsOf(pool, b.id)).toBe(8000) // fully refunded

    // A cancelled match can't then be resolved.
    const res = await fn(app, host.token, 'oracle-bet-resolve', { matchRef: ref(), winningChoice: 'blue' })
    expect(res.body.resolved).toBe(false)
    expect(res.body.reason).toBe('already-settled')
  })

  // ---- host gating on resolve/cancel/config --------------------------------
  it('only the stream host (or a global TKO host) may resolve, cancel, or set the minimum', async () => {
    await setWallet(pool, a.id, { tickets: 10 })
    await fn(app, a.token, 'oracle-bet', { matchRef: ref(), streamId, choice: 'blue', stakeKind: 'ticket', amount: 2 })

    const notHost = await fn(app, a.token, 'oracle-bet-resolve', { matchRef: ref(), winningChoice: 'blue' })
    expect(notHost.status).toBe(403)
    const notHostCancel = await fn(app, a.token, 'oracle-bet-cancel', { matchRef: ref() })
    expect(notHostCancel.status).toBe(403)
    const notHostCfg = await fn(app, a.token, 'oracle-bet-config-set', { streamId, minBet: 9 })
    expect(notHostCfg.status).toBe(403)

    // A global TKO host may resolve any stream.
    const gh = await signUp(app, 'gh@tko.gg', 'globalhost')
    await makeGlobalHost(pool, gh.id)
    const ok = await fn(app, gh.token, 'oracle-bet-resolve', { matchRef: ref(), winningChoice: 'blue' })
    expect(ok.body.ok).toBe(true)
    expect(await ticketsOf(pool, a.id)).toBe(10)     // sole winner takes the 2-ticket pot back
  })

  // ---- config read mirrors eligibility + minimum + tickets -----------------
  it('oracle-bet-config reports eligibility, the minimum, and the caller ticket balance', async () => {
    await setWallet(pool, a.id, { tickets: 7 })
    await fn(app, host.token, 'oracle-bet-config-set', { streamId, minBet: 4, minStakeKind: 'ticket' })
    const cfg = await fn(app, a.token, 'oracle-bet-config', { streamId, matchRef: ref() })
    expect(cfg.body.eligible).toBe(true)
    expect(cfg.body.min_bet).toBe(4)
    expect(cfg.body.oracle_tickets).toBe(7)

    // An ineligible (offline) stream reports eligible:false with a reason.
    const offline = await createStream(pool, host.id, false)
    const bad = await fn(app, a.token, 'oracle-bet-config', { streamId: offline })
    expect(bad.body.eligible).toBe(false)
    expect(bad.body.reason).toBe('not-live')
  })
})
