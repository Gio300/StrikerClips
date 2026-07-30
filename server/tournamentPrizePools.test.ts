/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

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
