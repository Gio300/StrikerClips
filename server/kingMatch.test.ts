/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { newDb } from 'pg-mem'
import {
  ensureRating,
  pairNext,
  proposeTime,
  reportResult,
  submitParticipantReport,
  openMatchFor,
} from './kingMatch'

function db() {
  const mem = newDb()
  mem.public.none(`
    create table king_ratings (user_id text primary key, rating int default 1000, matches int default 0, wins int default 0, updated_at timestamptz default now());
    create table king_matches (id serial primary key, player_a text, player_b text, proposals_a text default '[]', proposals_b text default '[]', agreed_time timestamptz, winner_id text, report_a_winner_id text, report_b_winner_id text, status text default 'proposing', created_at timestamptz default now());
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

  it('does not settle or re-rate after only one participant reports', async () => {
    const m = await pairNext(pool, 'a')
    const report = await submitParticipantReport(pool, String(m.id), 'a', 'a')
    expect(report).toMatchObject({ ok: true, settled: false, status: 'awaiting_confirmation' })

    const row = (await pool.query('select status,winner_id,report_a_winner_id,report_b_winner_id from king_matches where id=$1', [String(m.id)])).rows[0]
    expect(row).toMatchObject({
      status: 'awaiting_confirmation',
      winner_id: null,
      report_a_winner_id: 'a',
      report_b_winner_id: null,
    })
    const ratings = (await pool.query('select user_id,rating,matches,wins from king_ratings order by user_id')).rows
    expect(ratings).toEqual([
      { user_id: 'a', rating: 1000, matches: 0, wins: 0 },
      { user_id: 'b', rating: 1000, matches: 0, wins: 0 },
    ])
  })

  it('keeps conflicting reports disputed without changing either rating', async () => {
    const m = await pairNext(pool, 'a')
    await submitParticipantReport(pool, String(m.id), 'a', 'a')
    const conflict = await submitParticipantReport(pool, String(m.id), 'b', 'b')
    expect(conflict).toMatchObject({ ok: true, settled: false, status: 'disputed', conflict: true })

    const row = (await pool.query('select status,winner_id from king_matches where id=$1', [String(m.id)])).rows[0]
    expect(row).toEqual({ status: 'disputed', winner_id: null })
    const ratings = (await pool.query('select rating from king_ratings order by user_id')).rows.map((r: any) => r.rating)
    expect(ratings).toEqual([1000, 1000])
  })

  it('settles only after both participants independently name the same winner', async () => {
    const m = await pairNext(pool, 'a')
    await submitParticipantReport(pool, String(m.id), 'a', 'a')
    const confirmed = await submitParticipantReport(pool, String(m.id), 'b', 'a')
    expect(confirmed).toMatchObject({ ok: true, settled: true, status: 'done', winnerId: 'a' })
    expect(confirmed.winnerRating).toBeGreaterThan(1000)
    expect(confirmed.loserRating).toBeLessThan(1000)

    const closed = (await pool.query('select status,winner_id from king_matches where id=$1', [String(m.id)])).rows[0]
    expect(closed).toEqual({ status: 'done', winner_id: 'a' })
  })

  it('cannot double-rerate when matching reports arrive concurrently', async () => {
    const m = await pairNext(pool, 'a')
    await Promise.all([
      submitParticipantReport(pool, String(m.id), 'a', 'a'),
      submitParticipantReport(pool, String(m.id), 'b', 'a'),
    ])

    const ratings = (await pool.query('select user_id,rating,matches,wins from king_ratings order by user_id')).rows
    expect(ratings).toEqual([
      { user_id: 'a', rating: 1016, matches: 1, wins: 1 },
      { user_id: 'b', rating: 984, matches: 1, wins: 0 },
    ])
    const decided = (await pool.query('select status,winner_id from king_matches where id=$1', [String(m.id)])).rows[0]
    expect(decided).toEqual({ status: 'done', winner_id: 'a' })
  })

  it('lets a player correct a disputed claim so both reports can agree', async () => {
    const m = await pairNext(pool, 'a')
    await submitParticipantReport(pool, String(m.id), 'a', 'a')
    await submitParticipantReport(pool, String(m.id), 'b', 'b')
    const corrected = await submitParticipantReport(pool, String(m.id), 'b', 'a')
    expect(corrected).toMatchObject({ ok: true, settled: true, winnerId: 'a' })
  })

  it('rejects a result claim from someone outside the match', async () => {
    const m = await pairNext(pool, 'a')
    const outsider = await submitParticipantReport(pool, String(m.id), 'outsider', 'a')
    expect(outsider).toEqual({ ok: false, settled: false, error: 'not your match' })
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
