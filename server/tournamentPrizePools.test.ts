/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'
import { sweepEndedTournaments } from './tournamentEndSweep'
import {
  backfillEntrantsFromRegistrations,
  canonicalEntrantIds,
  ensureEntrantForRegistration,
} from './tournamentEntrants'

const DOB = '1990-05-10'

async function signup(app: any, email: string, username: string) {
  const response = await request(app).post('/api/auth/signup').send({
    email,
    password: 'password123',
    username,
    date_of_birth: DOB,
  })
  expect(response.status).toBe(200)
  return {
    id: response.body.user.id as string,
    token: response.body.token as string,
  }
}

const invoke = (app: any, token: string, name: string, body: Record<string, unknown>) =>
  request(app)
    .post(`/api/fn/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body)

describe('tournament prize pools', () => {
  it('escrows Sweeps, conserves the pot, and settles only once', async () => {
    const db = makeDb()
    const app = createApp(db)
    const host = await signup(app, 'host@tko.test', 'host')
    const first = await signup(app, 'first@tko.test', 'first')
    const second = await signup(app, 'second@tko.test', 'second')
    const tournament = (await db.query(
      'insert into tournaments (name, created_by) values ($1,$2) returning *',
      ['Prize Night', host.id],
    )).rows[0]
    await db.query(
      'insert into wallets (user_id, sweeps) values ($1,100),($2,100)',
      [first.id, second.id],
    )

    const opened = await invoke(app, host.token, 'tournament-prize-open', {
      tournamentId: tournament.id,
      currency: 'sweeps',
      entryAmount: 25,
      paidPlaces: 2,
    })
    expect(opened.body).toMatchObject({
      ok: true,
      pool: {
        entry_amount: 25,
        paid_places: 2,
        prize_split_bps: [7000, 3000],
      },
    })
    const poolId = opened.body.pool.id as string

    expect((await invoke(app, first.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)
    expect((await invoke(app, second.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)
    expect((await invoke(app, first.token, 'tournament-prize-join', { poolId })).body.reason).toBe('duplicate')

    const settled = await invoke(app, host.token, 'tournament-prize-resolve', {
      poolId,
      placements: [first.id, second.id],
    })
    expect(settled.body).toMatchObject({
      ok: true,
      settled: true,
      pot: 50,
      payouts: [
        { user_id: first.id, placement: 1, amount: 35 },
        { user_id: second.id, placement: 2, amount: 15 },
      ],
    })

    const wallets = await db.query(
      'select user_id, sweeps from wallets where user_id=$1 or user_id=$2',
      [first.id, second.id],
    )
    const balances = new Map(wallets.rows.map((row: any) => [String(row.user_id), Number(row.sweeps)]))
    expect(balances.get(first.id)).toBe(110)
    expect(balances.get(second.id)).toBe(90)

    const repeated = await invoke(app, host.token, 'tournament-prize-resolve', {
      poolId,
      placements: [first.id, second.id],
    })
    expect(repeated.body).toMatchObject({ ok: true, settled: false, reason: 'already-settled' })
    const payouts = await db.query('select * from tournament_prize_payouts where pool_id=$1', [poolId])
    expect(payouts.rows).toHaveLength(2)
  })

  it('does not create an entry when funds are insufficient and refunds a cancellation', async () => {
    const db = makeDb()
    const app = createApp(db)
    const host = await signup(app, 'host2@tko.test', 'host2')
    const player = await signup(app, 'player@tko.test', 'player')
    const broke = await signup(app, 'broke@tko.test', 'broke')
    const tournament = (await db.query(
      'insert into tournaments (name, created_by) values ($1,$2) returning *',
      ['Refund Night', host.id],
    )).rows[0]
    await db.query('insert into wallets (user_id, sweeps) values ($1,40),($2,5)', [player.id, broke.id])

    const opened = await invoke(app, host.token, 'tournament-prize-open', {
      tournamentId: tournament.id,
      entryAmount: 20,
      paidPlaces: 1,
    })
    const poolId = opened.body.pool.id as string
    expect((await invoke(app, player.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)
    expect((await invoke(app, broke.token, 'tournament-prize-join', { poolId })).body.reason).toBe('insufficient')
    expect(
      Number((await db.query('select count(*) n from tournament_prize_entries where user_id=$1', [broke.id])).rows[0].n),
    ).toBe(0)

    const cancelled = await invoke(app, host.token, 'tournament-prize-cancel', { poolId })
    expect(cancelled.body).toMatchObject({
      ok: true,
      cancelled: true,
      refunds: [{ user_id: player.id, amount: 20 }],
    })
    const wallet = await db.query('select sweeps from wallets where user_id=$1', [player.id])
    expect(Number(wallet.rows[0].sweeps)).toBe(40)

    const repeated = await invoke(app, host.token, 'tournament-prize-cancel', { poolId })
    expect(repeated.body).toMatchObject({ ok: true, cancelled: false, reason: 'already-settled' })
  })

  it('refuses cash pools instead of routing tournament entry money through Stripe', async () => {
    const db = makeDb()
    const app = createApp(db)
    const host = await signup(app, 'cash-host@tko.test', 'cashhost')
    const tournament = (await db.query(
      'insert into tournaments (name, created_by) values ($1,$2) returning *',
      ['Cash Later', host.id],
    )).rows[0]

    const response = await invoke(app, host.token, 'tournament-prize-open', {
      tournamentId: tournament.id,
      currency: 'cash',
      entryAmount: 1000,
      paidPlaces: 1,
    })
    expect(response.body).toMatchObject({
      ok: false,
      reason: 'approved-tournament-payment-provider-required',
    })
    const count = await db.query('select count(*) n from tournament_prize_pools')
    expect(Number(count.rows[0].n)).toBe(0)
  })
})

describe('tournament delete', () => {
  it('refuses everyone but the creator — even a listed tournament admin', async () => {
    const db = makeDb()
    const app = createApp(db)
    const creator = await signup(app, 'del-creator@tko.test', 'delcreator')
    const admin = await signup(app, 'del-admin@tko.test', 'deladmin')
    const stranger = await signup(app, 'del-stranger@tko.test', 'delstranger')
    const tournament = (await db.query(
      'insert into tournaments (name, created_by) values ($1,$2) returning *',
      ['Not Yours', creator.id],
    )).rows[0]
    await db.query(
      'insert into tournament_admins (tournament_id, user_id) values ($1,$2)',
      [tournament.id, admin.id],
    )

    const asStranger = await invoke(app, stranger.token, 'tournament-delete', {
      tournamentId: tournament.id,
    })
    expect(asStranger.status).toBe(403)

    // An admin may run the bracket, but deleting the tournament is creator-only.
    const asAdmin = await invoke(app, admin.token, 'tournament-delete', {
      tournamentId: tournament.id,
    })
    expect(asAdmin.status).toBe(403)

    const still = await db.query('select id from tournaments where id=$1', [tournament.id])
    expect(still.rows).toHaveLength(1)

    const asCreator = await invoke(app, creator.token, 'tournament-delete', {
      tournamentId: tournament.id,
    })
    expect(asCreator.body).toMatchObject({ ok: true, deleted: true })
    const gone = await db.query('select id from tournaments where id=$1', [tournament.id])
    expect(gone.rows).toHaveLength(0)
  })

  it('refunds every escrowed entry and conserves the pot when deleted before settlement', async () => {
    const db = makeDb()
    const app = createApp(db)
    const creator = await signup(app, 'del-host@tko.test', 'delhost')
    const first = await signup(app, 'del-first@tko.test', 'delfirst')
    const second = await signup(app, 'del-second@tko.test', 'delsecond')
    const tournament = (await db.query(
      'insert into tournaments (name, created_by) values ($1,$2) returning *',
      ['Refund On Delete', creator.id],
    )).rows[0]
    await db.query(
      'insert into wallets (user_id, sweeps) values ($1,100),($2,100)',
      [first.id, second.id],
    )

    const opened = await invoke(app, creator.token, 'tournament-prize-open', {
      tournamentId: tournament.id,
      entryAmount: 25,
      paidPlaces: 2,
    })
    const poolId = opened.body.pool.id as string
    expect((await invoke(app, first.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)
    expect((await invoke(app, second.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)

    // Escrow took the entries out of the wallets.
    const escrowed = await db.query(
      'select sum(sweeps) total from wallets where user_id=$1 or user_id=$2',
      [first.id, second.id],
    )
    expect(Number(escrowed.rows[0].total)).toBe(150)

    const deleted = await invoke(app, creator.token, 'tournament-delete', {
      tournamentId: tournament.id,
    })
    expect(deleted.body).toMatchObject({ ok: true, deleted: true })
    const refunds = deleted.body.refunds as { user_id: string; amount: number }[]
    expect(refunds).toHaveLength(2)
    expect(new Set(refunds.map((r) => r.user_id))).toEqual(new Set([first.id, second.id]))
    for (const refund of refunds) expect(refund.amount).toBe(25)

    // Money conservation: both wallets whole again — nothing created, nothing lost.
    const wallets = await db.query(
      'select user_id, sweeps from wallets where user_id=$1 or user_id=$2',
      [first.id, second.id],
    )
    const balances = new Map(wallets.rows.map((row: any) => [String(row.user_id), Number(row.sweeps)]))
    expect(balances.get(first.id)).toBe(100)
    expect(balances.get(second.id)).toBe(100)

    // The refunds are on the ledger (audit trail survives the delete)…
    const ledger = await db.query(
      "select user_id, sweeps_delta from wallet_ledger where reason='tournament deleted: prize-pool entry refund'",
    )
    expect(ledger.rows).toHaveLength(2)
    for (const row of ledger.rows) expect(Number(row.sweeps_delta)).toBe(25)

    // …and the tournament + its money rows are gone.
    expect((await db.query('select id from tournaments where id=$1', [tournament.id])).rows).toHaveLength(0)
    expect((await db.query('select id from tournament_prize_pools where tournament_id=$1', [tournament.id])).rows).toHaveLength(0)
    expect((await db.query('select id from tournament_prize_entries where pool_id=$1', [poolId])).rows).toHaveLength(0)
  })

  it('leaves wallets untouched when deleting after settlement', async () => {
    const db = makeDb()
    const app = createApp(db)
    const creator = await signup(app, 'del-settled@tko.test', 'delsettled')
    const first = await signup(app, 'del-win@tko.test', 'delwin')
    const second = await signup(app, 'del-place@tko.test', 'delplace')
    const tournament = (await db.query(
      'insert into tournaments (name, created_by) values ($1,$2) returning *',
      ['Settled Then Deleted', creator.id],
    )).rows[0]
    await db.query(
      'insert into wallets (user_id, sweeps) values ($1,100),($2,100)',
      [first.id, second.id],
    )

    const opened = await invoke(app, creator.token, 'tournament-prize-open', {
      tournamentId: tournament.id,
      entryAmount: 25,
      paidPlaces: 2,
    })
    const poolId = opened.body.pool.id as string
    expect((await invoke(app, first.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)
    expect((await invoke(app, second.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)
    const settled = await invoke(app, creator.token, 'tournament-prize-resolve', {
      poolId,
      placements: [first.id, second.id],
    })
    expect(settled.body).toMatchObject({ ok: true, settled: true, pot: 50 })

    const deleted = await invoke(app, creator.token, 'tournament-delete', {
      tournamentId: tournament.id,
    })
    expect(deleted.body).toMatchObject({ ok: true, deleted: true, refunds: [] })

    // Settled money is final: winner keeps 110, runner-up keeps 90.
    const wallets = await db.query(
      'select user_id, sweeps from wallets where user_id=$1 or user_id=$2',
      [first.id, second.id],
    )
    const balances = new Map(wallets.rows.map((row: any) => [String(row.user_id), Number(row.sweeps)]))
    expect(balances.get(first.id)).toBe(110)
    expect(balances.get(second.id)).toBe(90)

    // No refund ledger rows were written for a settled pool.
    const ledger = await db.query(
      "select id from wallet_ledger where reason='tournament deleted: prize-pool entry refund'",
    )
    expect(ledger.rows).toHaveLength(0)
    expect((await db.query('select id from tournaments where id=$1', [tournament.id])).rows).toHaveLength(0)
  })

  it('deletes a tournament that has entrants + registrations but NO prize pool (every type, not only AI/clan)', async () => {
    // The operator report: production only offered delete on "AI clan"
    // tournaments and refused one with 2 entrants. The delete path must work
    // for ANY tournament the caller created, entrants included, pool or not.
    const db = makeDb()
    const app = createApp(db)
    const creator = await signup(app, 'del-entrants@tko.test', 'delentrants')
    const entrantA = await signup(app, 'del-entrant-a@tko.test', 'delentranta')
    const entrantB = await signup(app, 'del-entrant-b@tko.test', 'delentrantb')
    const tournament = (await db.query(
      'insert into tournaments (name, created_by) values ($1,$2) returning *',
      ['Two Entrants Cup', creator.id],
    )).rows[0]
    await db.query(
      "insert into tournament_entrants (tournament_id, user_id, status) values ($1,$2,'accepted'),($1,$3,'accepted')",
      [tournament.id, entrantA.id, entrantB.id],
    )
    await db.query(
      'insert into tournament_registrations (tournament_id, user_id) values ($1,$2)',
      [tournament.id, entrantA.id],
    )

    const deleted = await invoke(app, creator.token, 'tournament-delete', {
      tournamentId: tournament.id,
    })
    expect(deleted.body).toMatchObject({ ok: true, deleted: true, refunds: [] })
    expect((await db.query('select id from tournaments where id=$1', [tournament.id])).rows).toHaveLength(0)
    expect((await db.query('select id from tournament_entrants where tournament_id=$1', [tournament.id])).rows).toHaveLength(0)
    expect((await db.query('select id from tournament_registrations where tournament_id=$1', [tournament.id])).rows).toHaveLength(0)
  })

  it('removes the tournament from the public list query', async () => {
    const db = makeDb()
    const app = createApp(db)
    const creator = await signup(app, 'del-list@tko.test', 'dellist')
    const keep = (await db.query(
      'insert into tournaments (name, created_by) values ($1,$2) returning *',
      ['Keeper Cup', creator.id],
    )).rows[0]
    const doomed = (await db.query(
      'insert into tournaments (name, created_by) values ($1,$2) returning *',
      ['Doomed Cup', creator.id],
    )).rows[0]

    const deleted = await invoke(app, creator.token, 'tournament-delete', {
      tournamentId: doomed.id,
    })
    expect(deleted.body).toMatchObject({ ok: true, deleted: true })

    // The same generic query the Tournaments page runs.
    const list = await request(app).post('/api/db').send({ table: 'tournaments', action: 'select' })
    expect(list.status).toBe(200)
    const ids = (list.body.data as any[]).map((row) => String(row.id))
    expect(ids).toContain(String(keep.id))
    expect(ids).not.toContain(String(doomed.id))
  })

  it('generic /api/db delete refuses a tournament holding an active prize pool', async () => {
    const db = makeDb()
    const app = createApp(db)
    const creator = await signup(app, 'del-guard@tko.test', 'delguard')
    const player = await signup(app, 'del-guarded@tko.test', 'delguarded')
    const tournament = (await db.query(
      'insert into tournaments (name, created_by) values ($1,$2) returning *',
      ['Guarded Cup', creator.id],
    )).rows[0]
    await db.query('insert into wallets (user_id, sweeps) values ($1,100)', [player.id])
    const opened = await invoke(app, creator.token, 'tournament-prize-open', {
      tournamentId: tournament.id,
      entryAmount: 20,
      paidPlaces: 1,
    })
    const poolId = opened.body.pool.id as string
    expect((await invoke(app, player.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)

    // Cascading this row through the generic API would destroy the escrowed
    // entry — the guard routes deletion to the refunding fn instead.
    const generic = await request(app)
      .post('/api/db')
      .set('Authorization', `Bearer ${creator.token}`)
      .send({
        table: 'tournaments',
        action: 'delete',
        filters: [{ col: 'id', op: 'eq', val: tournament.id }],
      })
    expect(generic.status).toBe(403)
    expect(generic.body.error).toMatch(/tournament-delete/)
    expect((await db.query('select id from tournaments where id=$1', [tournament.id])).rows).toHaveLength(1)

    // The refunding path still works and makes the player whole.
    const deleted = await invoke(app, creator.token, 'tournament-delete', {
      tournamentId: tournament.id,
    })
    expect(deleted.body).toMatchObject({
      ok: true,
      deleted: true,
      refunds: [{ user_id: player.id, amount: 20 }],
    })
    const wallet = await db.query('select sweeps from wallets where user_id=$1', [player.id])
    expect(Number(wallet.rows[0].sweeps)).toBe(100)
  })
})

describe('tournaments league branding (league_slug)', () => {
  it("defaults to 'tko' and persists a chosen league through the wizard's insert path", async () => {
    const db = makeDb()
    const app = createApp(db)
    const creator = await signup(app, 'league-host@tko.test', 'leaguehost')

    const plain = (await db.query(
      'insert into tournaments (name, created_by) values ($1,$2) returning *',
      ['House Cup', creator.id],
    )).rows[0]
    expect(plain.league_slug).toBe('tko')

    // The creation wizard inserts through the generic /api/db path — the
    // chosen league must ride along and come back on reads.
    const created = await request(app)
      .post('/api/db')
      .set('Authorization', `Bearer ${creator.token}`)
      .send({
        table: 'tournaments',
        action: 'insert',
        single: true,
        values: {
          name: 'League Cup',
          created_by: creator.id,
          league_slug: 'shinobistrikerleague',
          status: 'open',
          end_at: '2030-01-01T00:00:00.000Z',
        },
      })
    expect(created.status).toBe(200)
    expect(created.body.data.league_slug).toBe('shinobistrikerleague')

    const listed = await request(app).post('/api/db').send({ table: 'tournaments', action: 'select' })
    expect(listed.status).toBe(200)
    const row = (listed.body.data as any[]).find((t) => t.name === 'League Cup')
    expect(row?.league_slug).toBe('shinobistrikerleague')
  })
})

// ===========================================================================
// EVERY TOURNAMENT NEEDS AN END TIME.
// The end-time sweep only scans `end_at is not null`, so a tournament created
// without one never auto-closes, never settles its pool and never leaves the
// open list. The create wizard demanded it client-side; creation runs through
// the generic data API, so until now that check was only advice.
// ===========================================================================
describe('tournaments require an end time', () => {
  it('refuses a create with no end time, accepts one with it, and refuses removing it later', async () => {
    const db = makeDb()
    const app = createApp(db)
    const creator = await signup(app, 'endtime-host@tko.test', 'endtimehost')
    const create = (values: Record<string, unknown>) =>
      request(app)
        .post('/api/db')
        .set('Authorization', `Bearer ${creator.token}`)
        .send({ table: 'tournaments', action: 'insert', single: true, values })

    const missing = await create({ name: 'Open Ended Cup', created_by: creator.id })
    expect(missing.status).toBe(400)
    expect(missing.body.error).toMatch(/end time/i)
    expect((await db.query('select id from tournaments')).rows).toHaveLength(0)

    const backwards = await create({
      name: 'Backwards Cup',
      created_by: creator.id,
      start_at: '2030-02-01T00:00:00.000Z',
      end_at: '2030-01-01T00:00:00.000Z',
    })
    expect(backwards.status).toBe(400)
    expect(backwards.body.error).toMatch(/after the start time/i)

    const good = await create({
      name: 'Proper Cup',
      created_by: creator.id,
      start_at: '2030-01-01T00:00:00.000Z',
      end_at: '2030-02-01T00:00:00.000Z',
    })
    expect(good.status).toBe(200)
    const tournamentId = good.body.data.id

    // The end time may be MOVED…
    const moved = await request(app)
      .post('/api/db')
      .set('Authorization', `Bearer ${creator.token}`)
      .send({
        table: 'tournaments',
        action: 'update',
        filters: [{ col: 'id', op: 'eq', val: tournamentId }],
        values: { end_at: '2030-03-01T00:00:00.000Z' },
      })
    expect(moved.status).toBe(200)

    // …but never removed, which would drop it out of the sweep entirely.
    const cleared = await request(app)
      .post('/api/db')
      .set('Authorization', `Bearer ${creator.token}`)
      .send({
        table: 'tournaments',
        action: 'update',
        filters: [{ col: 'id', op: 'eq', val: tournamentId }],
        values: { end_at: null },
      })
    expect(cleared.status).toBe(400)
    const still = await db.query('select end_at from tournaments where id=$1', [tournamentId])
    expect(still.rows[0].end_at).toBeTruthy()

    // An edit that does not touch the schedule is unaffected.
    const renamed = await request(app)
      .post('/api/db')
      .set('Authorization', `Bearer ${creator.token}`)
      .send({
        table: 'tournaments',
        action: 'update',
        filters: [{ col: 'id', op: 'eq', val: tournamentId }],
        values: { name: 'Proper Cup II' },
      })
    expect(renamed.status).toBe(200)
  })
})

// ===========================================================================
// ONE CANONICAL ENTRANT ROSTER + POT CONSERVATION ON EVERY SETTLEMENT PATH.
//
// tournament_entrants is canonical; tournament_registrations (the King entry
// flow) reads through to it. These prove the two rosters can no longer
// disagree, and that whichever way a pot settles it is conserved exactly.
// ===========================================================================
describe('canonical entrant roster', () => {
  const endedTournament = async (db: any, creatorId: string, name: string) =>
    (await db.query(
      `insert into tournaments (name, created_by, status, end_at)
       values ($1,$2,'live', now() - interval '1 minute') returning *`,
      [name, creatorId],
    )).rows[0]

  it('mirrors a King registration into the canonical entrant table on write', async () => {
    const db = makeDb()
    const app = createApp(db)
    const host = await signup(app, 'mir-host@tko.test', 'mirhost')
    const player = await signup(app, 'mir-player@tko.test', 'mirplayer')
    const tournament = await endedTournament(db, host.id, 'Mirror Cup')

    const registered = await request(app)
      .post('/api/db')
      .set('Authorization', `Bearer ${player.token}`)
      .send({
        table: 'tournament_registrations',
        action: 'insert',
        single: true,
        values: {
          tournament_id: tournament.id,
          user_id: player.id,
          streamed: true,
          no_mod_ack: true,
        },
      })
    expect(registered.status).toBe(200)

    // The canonical roster now holds the King entrant, without a second write.
    const entrants = await db.query(
      'select user_id, status from tournament_entrants where tournament_id=$1',
      [tournament.id],
    )
    expect(entrants.rows).toHaveLength(1)
    expect(String(entrants.rows[0].user_id)).toBe(player.id)
    expect(entrants.rows[0].status).toBe('accepted')

    // Idempotent: mirroring again never doubles the roster.
    await ensureEntrantForRegistration(db, String(tournament.id), player.id)
    await backfillEntrantsFromRegistrations(db, String(tournament.id))
    expect(
      (await db.query('select id from tournament_entrants where tournament_id=$1', [tournament.id])).rows,
    ).toHaveLength(1)
    expect(await canonicalEntrantIds(db, String(tournament.id))).toEqual([player.id])
  })

  it('backfills King registrations that predate the mirror and never re-approves a rejected entry', async () => {
    const db = makeDb()
    const app = createApp(db)
    const host = await signup(app, 'bf-host@tko.test', 'bfhost')
    const legacy = await signup(app, 'bf-legacy@tko.test', 'bflegacy')
    const rejected = await signup(app, 'bf-rejected@tko.test', 'bfrejected')
    const tournament = await endedTournament(db, host.id, 'Backfill Cup')

    // Written straight to the table, as an install from before the mirror had.
    await db.query(
      'insert into tournament_registrations (tournament_id, user_id) values ($1,$2),($1,$3)',
      [tournament.id, legacy.id, rejected.id],
    )
    // …and one of them the host already REJECTED through the approval fn.
    await db.query(
      "insert into tournament_entrants (tournament_id, user_id, status) values ($1,$2,'rejected')",
      [tournament.id, rejected.id],
    )

    expect(await backfillEntrantsFromRegistrations(db, String(tournament.id))).toBe(1)
    // The host's verdict stands — the mirror never resurrects a rejected entry.
    const statuses = new Map(
      (await db.query('select user_id, status from tournament_entrants where tournament_id=$1', [tournament.id]))
        .rows.map((row: any) => [String(row.user_id), row.status]),
    )
    expect(statuses.get(legacy.id)).toBe('accepted')
    expect(statuses.get(rejected.id)).toBe('rejected')
    expect(await canonicalEntrantIds(db, String(tournament.id))).toEqual([legacy.id])
    // Running it again creates nothing.
    expect(await backfillEntrantsFromRegistrations(db, String(tournament.id))).toBe(0)
  })

  it('seeds ONE bracket from both entry flows instead of discarding a roster', async () => {
    const db = makeDb()
    const app = createApp(db)
    const host = await signup(app, 'seed-host@tko.test', 'seedhost')
    const mainA = await signup(app, 'seed-a@tko.test', 'seeda')
    const mainB = await signup(app, 'seed-b@tko.test', 'seedb')
    const kingA = await signup(app, 'seed-c@tko.test', 'seedc')
    const kingB = await signup(app, 'seed-d@tko.test', 'seedd')
    const tournament = await endedTournament(db, host.id, 'Both Doors Cup')

    // Main flow: two approved entrants. King flow: two registrations.
    await db.query(
      `insert into tournament_entrants (tournament_id, user_id, status)
       values ($1,$2,'accepted'),($1,$3,'accepted')`,
      [tournament.id, mainA.id, mainB.id],
    )
    await db.query(
      'insert into tournament_registrations (tournament_id, user_id) values ($1,$2),($1,$3)',
      [tournament.id, kingA.id, kingB.id],
    )

    const seeded = await invoke(app, host.token, 'tournament-bracket-seed', {
      tournamentId: tournament.id,
    })
    expect(seeded.body.ok).toBe(true)
    // Before, the seeder took the 2 accepted entrants and NEVER looked at the
    // registrations — the two King entrants were silently dropped. All four
    // are on the board now.
    const players = new Set<string>()
    for (const row of seeded.body.battles as any[]) {
      if (row.player_a) players.add(String(row.player_a))
      if (row.player_b) players.add(String(row.player_b))
    }
    expect(players).toEqual(new Set([mainA.id, mainB.id, kingA.id, kingB.id]))
    expect(seeded.body.totalRounds).toBe(2)
  })

  it('conserves the pot exactly on the settle, best-paid-entrant and refund paths', async () => {
    // Three tournaments, one per settlement path. In every one the Sweeps in
    // circulation before and after the sweep are identical: a pot is only ever
    // moved, never minted, lost or stranded.
    for (const shape of ['leader-paid', 'leader-unpaid', 'nobody-placed'] as const) {
      const tag = shape.replace(/-/g, '')
      const db = makeDb()
      const app = createApp(db)
      const host = await signup(app, `pc-${shape}-host@tko.test`, `pc${tag}h`)
      const winner = await signup(app, `pc-${shape}-w@tko.test`, `pc${tag}w`)
      const other = await signup(app, `pc-${shape}-o@tko.test`, `pc${tag}o`)
      const tournament = await endedTournament(db, host.id, `Conservation ${shape}`)
      await db.query(
        `insert into tournament_entrants (tournament_id, user_id, status)
         values ($1,$2,'accepted'),($1,$3,'accepted')`,
        [tournament.id, winner.id, other.id],
      )
      await db.query('insert into wallets (user_id, sweeps) values ($1,100),($2,100)', [winner.id, other.id])
      const opened = await invoke(app, host.token, 'tournament-prize-open', {
        tournamentId: tournament.id,
        entryAmount: 25,
        paidPlaces: 1,
      })
      const poolId = opened.body.pool.id as string

      // Who pays in, and who fights, is what distinguishes the three paths.
      //   leader-paid    the bracket winner paid in    → 'bracket-winner'
      //   leader-unpaid  only the loser paid in        → 'best-paid-entrant'
      //   nobody-placed  the only payer never fought   → refund
      const payers = shape === 'leader-paid' ? [winner, other] : [other]
      for (const payer of payers) {
        expect((await invoke(app, payer.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)
      }
      await db.query(
        `insert into tournament_battles
           (tournament_id, player_a, player_b, status, winner, round, bracket_slot)
         values ($1,$2,$3,'complete',$2,1,0)`,
        [tournament.id, winner.id, shape === 'nobody-placed' ? host.id : other.id],
      )

      const before = 200 // both wallets started at 100
      const summary = await sweepEndedTournaments(db)
      expect(summary.errors).toEqual([])
      const closed = summary.closed[0]

      const escrowed = payers.length * 25
      const paidOut = closed.settledPools.reduce(
        (sum, pool) => sum + pool.payouts.reduce((inner, payout) => inner + payout.amount, 0),
        0,
      )
      const refunded = closed.refundedPools.reduce(
        (sum, pool) => sum + pool.refunds.reduce((inner, refund) => inner + refund.amount, 0),
        0,
      )
      // Every escrowed Sweep came back out exactly once.
      expect(paidOut + refunded).toBe(escrowed)
      for (const pool of closed.settledPools) expect(pool.pot).toBe(escrowed)

      const after =
        Number((await db.query('select sweeps from wallets where user_id=$1', [winner.id])).rows[0].sweeps) +
        Number((await db.query('select sweeps from wallets where user_id=$1', [other.id])).rows[0].sweeps)
      expect(after).toBe(before)

      // …and each path is labelled with WHY the pot went where it went.
      const reasons = [
        ...closed.settledPools.map((pool) => pool.reason),
        ...closed.refundedPools.map((pool) => pool.reason),
      ]
      expect(reasons).toEqual([
        shape === 'leader-paid'
          ? 'bracket-winner'
          : shape === 'leader-unpaid'
            ? 'best-paid-entrant'
            : 'no-paid-entrant-placed',
      ])
    }
  })
})
