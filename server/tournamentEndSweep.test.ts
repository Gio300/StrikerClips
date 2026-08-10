/* eslint-disable @typescript-eslint/no-explicit-any */
// END-TIME SWEEP — the operator brief's settlement rules, proven against the
// same in-memory harness the API tests use:
//   • past end_at ⇒ tournament closes on its own;
//   • winner = furthest advanced in the bracket;
//   • TIE ⇒ the leaders split the pot EVENLY (conserved to the unit);
//   • money moves through the tournament-prize-resolve machinery (wallets,
//     ledger, payouts) or refunds through the cancel machinery — never lost.
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'
import { sweepEndedTournaments } from './tournamentEndSweep'

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

async function makeEndedTournament(db: any, creatorId: string, name: string) {
  return (await db.query(
    `insert into tournaments (name, created_by, status, end_at)
     values ($1,$2,'live', now() - interval '1 minute') returning *`,
    [name, creatorId],
  )).rows[0]
}

const battle = (
  db: any,
  tournamentId: string,
  round: number,
  slot: number,
  a: string,
  b: string | null,
  winner: string | null,
) =>
  db.query(
    `insert into tournament_battles
       (tournament_id, player_a, player_b, status, winner, round, bracket_slot)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [tournamentId, a, b, winner ? 'complete' : 'scheduled', winner, round, slot],
  )

const sweepsOf = async (db: any, userId: string): Promise<number> =>
  Number((await db.query('select sweeps from wallets where user_id=$1', [userId])).rows[0]?.sweeps ?? 0)

describe('tournament end sweep', () => {
  it('closes a past-end tournament, pays the sole bracket leader the whole pot, and notifies entrants', async () => {
    const db = makeDb()
    const app = createApp(db)
    const host = await signup(app, 'end-host@tko.test', 'endhost')
    const first = await signup(app, 'end-first@tko.test', 'endfirst')
    const second = await signup(app, 'end-second@tko.test', 'endsecond')
    const tournament = await makeEndedTournament(db, host.id, 'Deadline Cup')
    await db.query(
      "insert into tournament_entrants (tournament_id, user_id, status) values ($1,$2,'accepted'),($1,$3,'accepted')",
      [tournament.id, first.id, second.id],
    )
    await db.query('insert into wallets (user_id, sweeps) values ($1,100),($2,100)', [first.id, second.id])
    const opened = await invoke(app, host.token, 'tournament-prize-open', {
      tournamentId: tournament.id,
      entryAmount: 25,
      paidPlaces: 1,
    })
    const poolId = opened.body.pool.id as string
    expect((await invoke(app, first.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)
    expect((await invoke(app, second.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)
    // first beat second — the bracket has a sole leader.
    await battle(db, tournament.id, 1, 0, first.id, second.id, first.id)

    const summary = await sweepEndedTournaments(db)
    expect(summary.errors).toEqual([])
    expect(summary.closed).toHaveLength(1)
    expect(summary.closed[0]).toMatchObject({
      tournamentId: String(tournament.id),
      winners: [first.id],
      tie: false,
    })
    expect(summary.closed[0].settledPools).toEqual([
      {
        poolId,
        pot: 50,
        reason: 'bracket-winner',
        payouts: [{ user_id: first.id, placement: 1, amount: 50 }],
      },
    ])

    // Status closed; winner recorded; the pot moved whole to the leader.
    const t = (await db.query('select status from tournaments where id=$1', [tournament.id])).rows[0]
    expect(t.status).toBe('closed')
    const results = await db.query(
      'select winner_profile_id from tournament_results where tournament_id=$1',
      [tournament.id],
    )
    expect(results.rows.map((row: any) => String(row.winner_profile_id))).toEqual([first.id])
    expect(await sweepsOf(db, first.id)).toBe(125) // 100 − 25 entry + 50 pot
    expect(await sweepsOf(db, second.id)).toBe(75) // 100 − 25 entry, forfeited
    const pool = (await db.query('select status from tournament_prize_pools where id=$1', [poolId])).rows[0]
    expect(pool.status).toBe('settled')
    const entries = await db.query(
      'select user_id, status from tournament_prize_entries where pool_id=$1',
      [poolId],
    )
    const entryStatus = new Map(entries.rows.map((row: any) => [String(row.user_id), row.status]))
    expect(entryStatus.get(first.id)).toBe('paid')
    expect(entryStatus.get(second.id)).toBe('forfeited')

    // Both entrants heard the tournament ended; the winner also got a prize note.
    const notes = await db.query(
      "select user_id, title from notifications where title='Tournament ended'",
    )
    expect(new Set(notes.rows.map((row: any) => String(row.user_id)))).toEqual(
      new Set([first.id, second.id]),
    )
    const prizeNotes = await db.query(
      "select user_id from notifications where title='Tournament prize paid'",
    )
    expect(prizeNotes.rows.map((row: any) => String(row.user_id))).toEqual([first.id])

    // Idempotent: a second sweep finds nothing to do and moves no money.
    const again = await sweepEndedTournaments(db)
    expect(again.closed).toEqual([])
    expect(await sweepsOf(db, first.id)).toBe(125)
    expect(
      (await db.query('select id from tournament_prize_payouts where pool_id=$1', [poolId])).rows,
    ).toHaveLength(1)
  })

  it('splits the pot EVENLY on a tie and conserves it to the unit (odd pot)', async () => {
    const db = makeDb()
    const app = createApp(db)
    const host = await signup(app, 'tie-host@tko.test', 'tiehost')
    const first = await signup(app, 'tie-first@tko.test', 'tiefirst')
    const second = await signup(app, 'tie-second@tko.test', 'tiesecond')
    const third = await signup(app, 'tie-third@tko.test', 'tiethird')
    const fourth = await signup(app, 'tie-fourth@tko.test', 'tiefourth')
    const tournament = await makeEndedTournament(db, host.id, 'Sudden Stop Cup')
    await db.query(
      'insert into wallets (user_id, sweeps) values ($1,100),($2,100),($3,100)',
      [first.id, second.id, third.id],
    )
    const opened = await invoke(app, host.token, 'tournament-prize-open', {
      tournamentId: tournament.id,
      entryAmount: 25,
      paidPlaces: 1,
    })
    const poolId = opened.body.pool.id as string
    for (const player of [first, second, third]) {
      expect((await invoke(app, player.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)
    }
    // Semifinals decided, FINAL UNDECIDED at the deadline → 2-way tie.
    await battle(db, tournament.id, 1, 0, first.id, third.id, first.id)
    await battle(db, tournament.id, 1, 1, second.id, fourth.id, second.id)
    await battle(db, tournament.id, 2, 0, first.id, second.id, null)

    const before =
      (await sweepsOf(db, first.id)) + (await sweepsOf(db, second.id)) + (await sweepsOf(db, third.id))
    expect(before).toBe(225) // 300 − 75 escrowed

    const summary = await sweepEndedTournaments(db)
    expect(summary.errors).toEqual([])
    expect(summary.closed).toHaveLength(1)
    const closed = summary.closed[0]
    expect(closed.tie).toBe(true)
    expect(new Set(closed.winners)).toEqual(new Set([first.id, second.id]))

    // POT CONSERVATION: 75 in, 75 out, shares within one unit of each other.
    const payouts = closed.settledPools[0].payouts
    expect(closed.settledPools[0].pot).toBe(75)
    expect(payouts.reduce((sum, payout) => sum + payout.amount, 0)).toBe(75)
    const amounts = payouts.map((payout) => payout.amount).sort((a, b) => b - a)
    expect(amounts).toEqual([38, 37])
    expect(new Set(payouts.map((payout) => payout.user_id))).toEqual(new Set([first.id, second.id]))

    // Wallet-level conservation: every escrowed unit is back in circulation.
    const after =
      (await sweepsOf(db, first.id)) + (await sweepsOf(db, second.id)) + (await sweepsOf(db, third.id))
    expect(after).toBe(300)
    expect(await sweepsOf(db, third.id)).toBe(75) // loser's entry forfeited into the pot

    // Both tied leaders are recorded as winners.
    const results = await db.query(
      'select winner_profile_id from tournament_results where tournament_id=$1',
      [tournament.id],
    )
    expect(new Set(results.rows.map((row: any) => String(row.winner_profile_id)))).toEqual(
      new Set([first.id, second.id]),
    )
  })

  // A bracket winner who never entered the prize pool used to hand EVERY
  // paying entrant their money back — the winner got nothing and the players
  // who actually competed for the pot got nothing either. The pot belongs to
  // the people who paid in, so it settles to the best-placed of THEM.
  it('settles the pot to the best-placed PAYING entrant when the leader never entered the pool', async () => {
    const db = makeDb()
    const app = createApp(db)
    const host = await signup(app, 'bpe-host@tko.test', 'bpehost')
    const leader = await signup(app, 'bpe-leader@tko.test', 'bpeleader')
    const runnerUp = await signup(app, 'bpe-runner@tko.test', 'bperunner')
    const early = await signup(app, 'bpe-early@tko.test', 'bpeearly')
    const other = await signup(app, 'bpe-other@tko.test', 'bpeother')
    const tournament = await makeEndedTournament(db, host.id, 'Freeloader Cup')
    await db.query(
      `insert into tournament_entrants (tournament_id, user_id, status)
       values ($1,$2,'accepted'),($1,$3,'accepted'),($1,$4,'accepted'),($1,$5,'accepted')`,
      [tournament.id, leader.id, runnerUp.id, early.id, other.id],
    )
    await db.query(
      'insert into wallets (user_id, sweeps) values ($1,100),($2,100),($3,100)',
      [runnerUp.id, early.id, other.id],
    )
    const opened = await invoke(app, host.token, 'tournament-prize-open', {
      tournamentId: tournament.id,
      entryAmount: 30,
      paidPlaces: 1,
    })
    const poolId = opened.body.pool.id as string
    // THE LEADER NEVER JOINS THE POOL. Three other players pay in.
    for (const player of [runnerUp, early, other]) {
      expect((await invoke(app, player.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)
    }
    // Semis: leader beats `early`, runnerUp beats `other`. Final: leader wins.
    await battle(db, tournament.id, 1, 0, leader.id, early.id, leader.id)
    await battle(db, tournament.id, 1, 1, runnerUp.id, other.id, runnerUp.id)
    await battle(db, tournament.id, 2, 0, leader.id, runnerUp.id, leader.id)

    const summary = await sweepEndedTournaments(db)
    expect(summary.errors).toEqual([])
    // The tournament's winner is still the (unpaid) bracket leader.
    expect(summary.closed[0].winners).toEqual([leader.id])
    // ...but the 90-Sweep pot goes to the furthest-advanced player who PAID.
    expect(summary.closed[0].refundedPools).toEqual([])
    expect(summary.closed[0].settledPools).toEqual([
      {
        poolId,
        pot: 90,
        reason: 'best-paid-entrant',
        payouts: [{ user_id: runnerUp.id, placement: 1, amount: 90 }],
      },
    ])

    // POT CONSERVATION: 90 escrowed, 90 paid out, nothing minted or stranded.
    expect(await sweepsOf(db, runnerUp.id)).toBe(160) // 100 − 30 entry + 90 pot
    expect(await sweepsOf(db, early.id)).toBe(70)
    expect(await sweepsOf(db, other.id)).toBe(70)
    const total =
      (await sweepsOf(db, runnerUp.id)) + (await sweepsOf(db, early.id)) + (await sweepsOf(db, other.id))
    expect(total).toBe(300)
    const pool = (await db.query('select status from tournament_prize_pools where id=$1', [poolId])).rows[0]
    expect(pool.status).toBe('settled')
    // The leader still takes the (non-monetary) win.
    const results = await db.query(
      'select winner_profile_id from tournament_results where tournament_id=$1',
      [tournament.id],
    )
    expect(results.rows.map((row: any) => String(row.winner_profile_id))).toEqual([leader.id])
    // Nobody was paid who did not pay in.
    const payouts = await db.query('select user_id from tournament_prize_payouts where pool_id=$1', [poolId])
    expect(payouts.rows.map((row: any) => String(row.user_id))).toEqual([runnerUp.id])
  })

  // The refund path still exists — it is just no longer the answer to "the
  // winner didn't pay in". It fires only when the bracket names NOBODY who
  // paid, and the reason is recorded rather than left to be inferred.
  it('refunds with a recorded reason when no paying entrant placed in the bracket', async () => {
    const db = makeDb()
    const app = createApp(db)
    const host = await signup(app, 'ref-host@tko.test', 'refhost')
    const fighterA = await signup(app, 'ref-fa@tko.test', 'reffa')
    const fighterB = await signup(app, 'ref-fb@tko.test', 'reffb')
    const spectator = await signup(app, 'ref-spec@tko.test', 'refspec')
    const tournament = await makeEndedTournament(db, host.id, 'Nobody Entered Cup')
    await db.query(
      `insert into tournament_entrants (tournament_id, user_id, status)
       values ($1,$2,'accepted'),($1,$3,'accepted'),($1,$4,'accepted')`,
      [tournament.id, fighterA.id, fighterB.id, spectator.id],
    )
    await db.query('insert into wallets (user_id, sweeps) values ($1,100)', [spectator.id])
    const opened = await invoke(app, host.token, 'tournament-prize-open', {
      tournamentId: tournament.id,
      entryAmount: 30,
      paidPlaces: 1,
    })
    const poolId = opened.body.pool.id as string
    // The only person who paid into the pool never fought a single battle.
    expect((await invoke(app, spectator.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)
    await battle(db, tournament.id, 1, 0, fighterA.id, fighterB.id, fighterA.id)

    const summary = await sweepEndedTournaments(db)
    expect(summary.errors).toEqual([])
    expect(summary.closed[0].settledPools).toEqual([])
    expect(summary.closed[0].refundedPools).toEqual([
      { poolId, reason: 'no-paid-entrant-placed', refunds: [{ user_id: spectator.id, amount: 30 }] },
    ])
    expect(await sweepsOf(db, spectator.id)).toBe(100) // whole again — nothing minted or lost
    const pool = (await db.query('select status from tournament_prize_pools where id=$1', [poolId])).rows[0]
    expect(pool.status).toBe('cancelled')
    // The bracket winner still takes the (non-monetary) win.
    const results = await db.query(
      'select winner_profile_id from tournament_results where tournament_id=$1',
      [tournament.id],
    )
    expect(results.rows.map((row: any) => String(row.winner_profile_id))).toEqual([fighterA.id])
  })

  it('falls back to recorded tournament_results when no bracket was built', async () => {
    const db = makeDb()
    const app = createApp(db)
    const host = await signup(app, 'res-host@tko.test', 'reshost')
    const champ = await signup(app, 'res-champ@tko.test', 'reschamp')
    const other = await signup(app, 'res-other@tko.test', 'resother')
    const tournament = await makeEndedTournament(db, host.id, 'Paper Bracket Cup')
    await db.query('insert into wallets (user_id, sweeps) values ($1,100),($2,100)', [champ.id, other.id])
    await db.query(
      'insert into tournament_results (tournament_id, winner_profile_id, submitted_by) values ($1,$2,$3)',
      [tournament.id, champ.id, host.id],
    )
    const opened = await invoke(app, host.token, 'tournament-prize-open', {
      tournamentId: tournament.id,
      entryAmount: 10,
      paidPlaces: 1,
    })
    const poolId = opened.body.pool.id as string
    expect((await invoke(app, champ.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)
    expect((await invoke(app, other.token, 'tournament-prize-join', { poolId })).body.ok).toBe(true)

    const summary = await sweepEndedTournaments(db)
    expect(summary.errors).toEqual([])
    expect(summary.closed[0].winners).toEqual([champ.id])
    expect(await sweepsOf(db, champ.id)).toBe(110) // 100 − 10 + the 20 pot
  })

  it('leaves running and open-ended tournaments alone', async () => {
    const db = makeDb()
    const app = createApp(db)
    const host = await signup(app, 'run-host@tko.test', 'runhost')
    await db.query(
      `insert into tournaments (name, created_by, status, end_at)
       values ('Still Running', $1, 'live', now() + interval '1 hour')`,
      [host.id],
    )
    await db.query(
      "insert into tournaments (name, created_by, status) values ('No Deadline (legacy)', $1, 'open')",
      [host.id],
    )
    const summary = await sweepEndedTournaments(db)
    expect(summary.scanned).toBe(0)
    expect(summary.closed).toEqual([])
    const rows = await db.query('select status from tournaments')
    expect(rows.rows.map((row: any) => row.status).sort()).toEqual(['live', 'open'])
  })
})
