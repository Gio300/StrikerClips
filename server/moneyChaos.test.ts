/* eslint-disable @typescript-eslint/no-explicit-any */
// Concurrency stampedes on the TOKEN money paths. Buying an artifact or paying a
// clan fee both read the wallet, check the balance, THEN debit — the classic
// TOCTOU. Fired all at once with only enough for ONE, does the user get charged
// once (correct) or drain value / double-own / mint clan treasury (a bug)?
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { makeDb } from './testHarness'
import { createApp } from './app'

const ADULT_DOB = '1995-06-15'

async function signUp(app: any, email: string, username: string) {
  const r = await request(app).post('/api/auth/signup').send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}
const fn = (app: any, who: any, name: string, body: any) =>
  request(app).post(`/api/fn/${name}`).set('Authorization', `Bearer ${who.token}`).send(body)

describe('money paths — concurrent stampede integrity', () => {
  it('buying one artifact 8x at once charges once, owns once, never double-spends', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const u = await signUp(app, 'buyer@kc.gg', 'buyer')
    // Exactly enough for ONE 250-token jersey.
    await pool.query('insert into wallets (user_id, tokens, sweeps) values ($1, 250, 0)', [u.id])

    const results = await Promise.all(
      Array.from({ length: 8 }, () => fn(app, u, 'asset-buy', { assetId: 'seed-akatsuki-jersey' })),
    )
    const bought = results.filter((r) => r.status === 200 && r.body?.ok === true)
    expect(bought.length).toBe(1) // exactly one purchase went through

    const wal = (await pool.query('select tokens from wallets where user_id=$1', [u.id])).rows[0]
    expect(Number(wal.tokens)).toBe(0) // charged exactly 250, not more, never negative

    const owned = (await pool.query('select count(*)::int n from asset_ownership where user_id=$1 and asset_id=$2', [u.id, 'seed-akatsuki-jersey'])).rows[0]
    expect(Number(owned.n)).toBe(1) // owns exactly one copy

    const spent = (await pool.query(`select coalesce(sum(tokens_delta),0)::int s from wallet_ledger where user_id=$1 and kind='spend'`, [u.id])).rows[0]
    expect(Number(spent.s)).toBe(-250) // the ledger debited 250 total, not 8×250
  })

  it('paying a clan join fee 6x at once charges once and credits the treasury once', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const owner = await signUp(app, 'leader@kc.gg', 'leader')
    const payer = await signUp(app, 'payer@kc.gg', 'payer')
    const clan = (await pool.query(
      `insert into servers (name, owner_id, kind, join_fee_tokens, treasury_tokens) values ('Akatsuki',$1,'clan',100,0) returning id`,
      [owner.id],
    )).rows[0]
    await pool.query('insert into wallets (user_id, tokens, sweeps) values ($1, 100, 0)', [payer.id])

    const results = await Promise.all(
      Array.from({ length: 6 }, () => fn(app, payer, 'clan-pay', { serverId: clan.id, kind: 'join' })),
    )
    const paid = results.filter((r) => r.status === 200 && r.body?.ok === true && r.body?.charged === 100)
    expect(paid.length).toBe(1) // charged exactly once

    const wal = (await pool.query('select tokens from wallets where user_id=$1', [payer.id])).rows[0]
    expect(Number(wal.tokens)).toBe(0)

    const pays = (await pool.query('select count(*)::int n from clan_dues_payments where server_id=$1 and user_id=$2', [clan.id, payer.id])).rows[0]
    expect(Number(pays.n)).toBe(1) // one payment receipt, not six

    const treasury = (await pool.query('select treasury_tokens from servers where id=$1', [clan.id])).rows[0]
    // The clan gets its cut of exactly ONE 100-token payment, never six.
    expect(Number(treasury.treasury_tokens)).toBeLessThanOrEqual(100)
    expect(Number(treasury.treasury_tokens)).toBeGreaterThan(0)
    const oneCut = Number(treasury.treasury_tokens)
    const receipt = (await pool.query('select clan_tokens from clan_dues_payments where server_id=$1', [clan.id])).rows[0]
    expect(oneCut).toBe(Number(receipt.clan_tokens)) // treasury == exactly one receipt's cut
  })
})
