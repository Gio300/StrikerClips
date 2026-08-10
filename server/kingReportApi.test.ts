/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from './app'
import { makeDb } from './testHarness'

const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me'

async function player(pool: any, username: string) {
  const email = `${username}@king.test`
  const row = (await pool.query(
    'insert into users (email,user_metadata) values ($1,$2) returning id',
    [email, JSON.stringify({ username })],
  )).rows[0]
  await pool.query('insert into profiles (id,username) values ($1,$2)', [row.id, username])
  return {
    id: String(row.id),
    token: jwt.sign({ sub: String(row.id), email }, jwtSecret, { expiresIn: '1h' }),
  }
}

const callKing = (app: any, token: string, body: Record<string, unknown>) =>
  request(app).post('/api/fn/king').set('Authorization', `Bearer ${token}`).send(body)

describe('King participant result API', () => {
  it('keeps one report pending and settles only after the opponent agrees', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const alice = await player(pool, 'king_alice')
    const bob = await player(pool, 'king_bob')

    await callKing(app, alice.token, { action: 'register' }).expect(200)
    const paired = await callKing(app, bob.token, { action: 'register' }).expect(200)
    const matchId = String(paired.body.match.id)

    const first = await callKing(app, alice.token, {
      action: 'report', matchId, winnerId: alice.id,
    }).expect(200)
    expect(first.body).toMatchObject({ ok: true, settled: false, status: 'awaiting_confirmation' })

    const pending = (await pool.query(
      'select winner_id,status from king_matches where id=$1',
      [matchId],
    )).rows[0]
    expect(pending).toEqual({ winner_id: null, status: 'awaiting_confirmation' })
    const before = (await pool.query(
      'select rating,matches,wins from king_ratings where user_id=$1',
      [alice.id],
    )).rows[0]
    expect(before).toEqual({ rating: 1000, matches: 0, wins: 0 })

    const confirmed = await callKing(app, bob.token, {
      action: 'report', matchId, winnerId: alice.id,
    }).expect(200)
    expect(confirmed.body).toMatchObject({ ok: true, settled: true, status: 'done', winnerId: alice.id })

    const winner = (await pool.query(
      'select rating,matches,wins from king_ratings where user_id=$1',
      [alice.id],
    )).rows[0]
    const loser = (await pool.query(
      'select rating,matches,wins from king_ratings where user_id=$1',
      [bob.id],
    )).rows[0]
    expect(winner).toEqual({ rating: 1016, matches: 1, wins: 1 })
    expect(loser).toEqual({ rating: 984, matches: 1, wins: 0 })
  })

  it('keeps conflicting API reports unresolved with both ratings unchanged', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const alice = await player(pool, 'dispute_alice')
    const bob = await player(pool, 'dispute_bob')
    await callKing(app, alice.token, { action: 'register' }).expect(200)
    const paired = await callKing(app, bob.token, { action: 'register' }).expect(200)
    const matchId = String(paired.body.match.id)

    await callKing(app, alice.token, { action: 'report', matchId, winnerId: alice.id }).expect(200)
    const conflict = await callKing(app, bob.token, {
      action: 'report', matchId, winnerId: bob.id,
    }).expect(200)
    expect(conflict.body).toMatchObject({ ok: true, settled: false, status: 'disputed', conflict: true })

    const match = (await pool.query('select status,winner_id from king_matches where id=$1', [matchId])).rows[0]
    expect(match).toEqual({ status: 'disputed', winner_id: null })
    const ratings = (await pool.query('select rating from king_ratings order by user_id')).rows
    expect(ratings).toEqual([{ rating: 1000 }, { rating: 1000 }])
  })
})
