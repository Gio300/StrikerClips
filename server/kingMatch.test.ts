/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { newDb } from 'pg-mem'
import { ensureRating, pairNext, proposeTime, reportResult, openMatchFor } from './kingMatch'

function db() {
  const mem = newDb()
  mem.public.none(`
    create table king_ratings (user_id text primary key, rating int default 1000, matches int default 0, wins int default 0, updated_at timestamptz default now());
    create table king_matches (id serial primary key, player_a text, player_b text, proposals_a text default '[]', proposals_b text default '[]', agreed_time timestamptz, winner_id text, status text default 'proposing', created_at timestamptz default now());
  `)
  return new (mem.adapters.createPg().Pool)()
}

describe('TKO King matchmaking', () => {
  let pool: any
  beforeEach(async () => {
    pool = db()
    await ensureRating(pool, 'a')
    await ensureRating(pool, 'b')
  })

  it('registers a rating of 1000 and auto-pairs two players in band', async () => {
    const m = await pairNext(pool, 'a')
    expect(m).toBeTruthy()
    expect([m.player_a, m.player_b].sort()).toEqual(['a', 'b'])
  })

  it('schedules when both propose an overlapping time', async () => {
    const m = await pairNext(pool, 'a')
    await proposeTime(pool, String(m.id), 'a', ['2030-01-01T18:00:00Z', '2030-01-02T18:00:00Z'])
    const out = await proposeTime(pool, String(m.id), 'b', ['2030-01-02T18:00:00Z'])
    expect(out.status).toBe('scheduled')
    expect(out.agreedTime).toBe('2030-01-02T18:00:00Z')
  })

  it('a verified result re-rates both and closes the match', async () => {
    const m = await pairNext(pool, 'a')
    const res = await reportResult(pool, String(m.id), 'a')
    expect(res.ok).toBe(true)
    expect(res.winnerRating).toBeGreaterThan(1000)
    expect(res.loserRating).toBeLessThan(1000)
    // the winner is now the King (higher rating)
    expect(res.king).toBe('a')
    const closed = (await pool.query('select status, winner_id from king_matches where id=$1', [String(m.id)])).rows[0]
    expect(closed.status).toBe('done')
    expect(closed.winner_id).toBe('a')
  })

  it('re-pairs players after a result (the ladder never ends)', async () => {
    const m = await pairNext(pool, 'a')
    await reportResult(pool, String(m.id), 'a')
    // both freed + re-paired into a fresh open match
    const next = await openMatchFor(pool, 'a')
    expect(next).toBeTruthy()
    expect(next.status).not.toBe('done')
  })
})
