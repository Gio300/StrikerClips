/* eslint-disable @typescript-eslint/no-explicit-any */
// =============================================================================
// TOURNAMENT END SWEEP — when tournaments.end_at passes, the tournament ENDS
// on its own (same background-scan shape as server/autoLive.ts):
//
//   1. WINNER: whoever is furthest advanced / leading in the bracket
//      (src/lib/tournamentBracket.ts bracketLeaders over tournament_battles;
//      falls back to recorded tournament_results when no bracket was built).
//      A TIE (e.g. an undecided final) means the leaders SPLIT the prize
//      evenly (splitPrizePoolEvenly — every share within one unit).
//   2. MONEY: any still-active Sweeps prize pool settles through the SAME
//      per-entry machinery as /api/fn/tournament-prize-resolve — wallet
//      credit + wallet_ledger row + tournament_prize_payouts row inside ONE
//      transaction, losers' escrowed entries forfeited, pool → 'settled'.
//      The pot-conservation invariant holds exactly: sum(payouts) == pot.
//      A bracket leader who never entered the pool does NOT trigger a mass
//      refund: the pot belongs to the people who paid in, so it settles to the
//      best-placed POOL ENTRANT instead (bracketLeadersAmong). Only when the
//      bracket says nothing about anyone who paid is every escrowed entry
//      refunded through the tournament-prize-cancel machinery — with the
//      reason recorded and logged. The pot is conserved on every path.
//   3. STATUS: tournaments.status → 'closed' (the existing status vocabulary),
//      a tournament_results row records each winner, and every entrant is
//      notified.
//
// Concurrency safety: each tournament is processed in its own transaction with
// `select … for update` on the tournament AND pool rows plus status re-checks,
// so two instances (or a sweep racing a manual resolve) can never double-pay.
// The interval runner additionally takes a distributed lease like the other
// background scanners.
// =============================================================================
import { bracketLeaders, bracketLeadersAmong } from '../src/lib/tournamentBracket'
import { splitPrizePoolEvenly } from '../src/lib/tournamentPrizePools'
import { withDistributedLease } from './distributedLease'
import {
  ACTIVE_ENTRANT_STATUSES,
  SEEDABLE_ENTRANT_STATUSES,
  backfillEntrantsFromRegistrations,
  canonicalEntrantIds,
} from './tournamentEntrants'

export type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>
  connect?: () => Promise<Queryable & { release: () => void }>
}

/**
 * WHY a pool settled to the people it settled to — recorded on the summary and
 * logged, so "the pot went somewhere surprising" is always explainable.
 *
 *   bracket-winner          the bracket leader(s) had paid into the pool.
 *   best-paid-entrant       no leader paid in, so the pot went to the
 *                           furthest-advanced player who DID pay.
 *   no-paid-entrant-placed  nobody who paid appears in the bracket → refund.
 *   no-winner               the bracket named nobody at all → refund.
 *   no-entries              the pool holds no escrowed entry → nothing to do.
 */
export type PoolOutcomeReason =
  | 'bracket-winner'
  | 'best-paid-entrant'
  | 'no-paid-entrant-placed'
  | 'no-winner'
  | 'no-entries'

export type EndedTournament = {
  tournamentId: string
  name: string
  winners: string[]
  tie: boolean
  settledPools: {
    poolId: string
    pot: number
    reason: PoolOutcomeReason
    payouts: { user_id: string; placement: number; amount: number }[]
  }[]
  refundedPools: { poolId: string; reason: PoolOutcomeReason; refunds: { user_id: string; amount: number }[] }[]
  notified: number
  /** Entrant rows the read-through mirror created for King registrations. */
  backfilledEntrants: number
}

export type EndSweepSummary = {
  scanned: number
  closed: EndedTournament[]
  errors: { tournamentId: string; error: string }[]
}

const withTransaction = async <T>(pool: Queryable, fn: (db: Queryable) => Promise<T>): Promise<T> => {
  if (!pool.connect) {
    await pool.query('begin')
    try {
      const value = await fn(pool)
      await pool.query('commit')
      return value
    } catch (error) {
      await pool.query('rollback')
      throw error
    }
  }
  const client = await pool.connect()
  try {
    await client.query('begin')
    const value = await fn(client)
    await client.query('commit')
    return value
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

// The roster reads that used to be fenced here now live in
// server/tournamentEntrants.ts, which owns the same SAVEPOINT guard: these
// statements run INSIDE the closing transaction, and in real Postgres one
// failed statement poisons the whole transaction (25P02) — the wallet credits
// already written would roll back, the tournament would stay open, and the
// sweep would retry the same failure every two minutes forever.

const notify = async (
  db: Queryable,
  userId: string,
  title: string,
  body: string,
  link: string,
  relatedId: string,
): Promise<void> => {
  await db.query(
    `insert into notifications (user_id, kind, title, body, link, related_id)
     values ($1,'tournament',$2,$3,$4,$5)`,
    [userId, title, body, link, relatedId],
  )
}

/** Refund every escrowed entry — the tournament-prize-cancel machinery. */
async function refundPool(
  db: Queryable,
  poolRow: any,
  tournamentName: string,
): Promise<{ user_id: string; amount: number }[]> {
  const entries = (await db.query(
    "select * from tournament_prize_entries where pool_id=$1 and status='escrowed'",
    [poolRow.id],
  )).rows
  const refunds: { user_id: string; amount: number }[] = []
  for (const entry of entries) {
    await db.query(
      `insert into wallets (user_id, tokens, sweeps, paid_sweeps_cents)
       values ($1,0,0,0) on conflict (user_id) do nothing`,
      [entry.user_id],
    )
    await db.query(
      'update wallets set sweeps=sweeps+$2::integer, updated_at=now() where user_id=$1',
      [entry.user_id, Number(entry.amount)],
    )
    await db.query(
      `insert into wallet_ledger
         (user_id, kind, tokens_delta, sweeps_delta, paid_sweeps_delta_cents,
          event, status, reason, ref_id)
       values ($1,'tournament',0,$2,0,$3,'Paid',
               'tournament ended: prize-pool entry refund',$4)`,
      [entry.user_id, Number(entry.amount), tournamentName, poolRow.id],
    )
    await db.query(
      "update tournament_prize_entries set status='refunded', updated_at=now() where id=$1",
      [entry.id],
    )
    refunds.push({ user_id: String(entry.user_id), amount: Number(entry.amount) })
  }
  await db.query(
    `update tournament_prize_pools
        set status='cancelled', cancelled_at=now(), updated_at=now()
      where id=$1`,
    [poolRow.id],
  )
  return refunds
}

/**
 * Settle one pool for the end-time winners — the tournament-prize-resolve
 * machinery with an EVEN split across however many winners are tied.
 *
 * WHO GETS PAID, in order:
 *
 *   1. The bracket leader(s) who ALSO paid into the pool. The normal case.
 *   2. Nobody at the top of the bracket paid in? The pot still belongs to the
 *      people who paid, so it goes to the furthest-advanced player among THEM
 *      (bracketLeadersAmong over the pool's escrowed entries, restricted to the
 *      tournament's canonical roster). This is the case that used to refund
 *      everyone: a bracket winner who never entered the prize pool won nothing
 *      AND handed every paying entrant their money back, so the pot evaporated
 *      and the players who actually competed for it were paid nothing.
 *   3. Only when the bracket says nothing about anyone who paid — an empty
 *      bracket, or a pool whose entrants all sat out — does the pool refund,
 *      with the reason recorded and logged rather than left to be inferred.
 *
 * Pot conservation is identical on every path: the payouts split exactly the
 * sum of the escrowed entries, and a refund returns exactly each entry.
 */
async function settlePool(
  db: Queryable,
  poolRow: any,
  winners: string[],
  battles: readonly any[],
  rosterIds: readonly string[],
  tournamentId: string,
  tournamentName: string,
): Promise<
  | {
      settled: true
      pot: number
      reason: PoolOutcomeReason
      payouts: { user_id: string; placement: number; amount: number }[]
    }
  | { settled: false; reason: PoolOutcomeReason; refunds: { user_id: string; amount: number }[] }
> {
  const entries = (await db.query(
    `select * from tournament_prize_entries
      where pool_id=$1 and status='escrowed'
      order by entered_at asc, id asc`,
    [poolRow.id],
  )).rows
  const entrantIds = new Set(entries.map((entry: any) => String(entry.user_id)))
  if (entrantIds.size === 0) {
    return { settled: false, reason: 'no-entries', refunds: await refundPool(db, poolRow, tournamentName) }
  }

  // (1) the bracket leaders who paid in.
  let paidWinners = winners.filter((id) => entrantIds.has(id))
  let reason: PoolOutcomeReason = 'bracket-winner'

  // (2) nobody at the top paid — award the best-placed PAYING entrant instead.
  //     Restricted to the canonical roster so a stray entry from somebody who
  //     is not even in the tournament cannot take the pot.
  if (paidWinners.length === 0) {
    const roster = new Set(rosterIds.map(String))
    const eligible = Array.from(entrantIds).filter((id) => roster.size === 0 || roster.has(id))
    paidWinners = bracketLeadersAmong(battles, eligible)
    reason = 'best-paid-entrant'
  }

  // (3) the bracket names nobody who paid — the existing refund path.
  if (paidWinners.length === 0) {
    const why: PoolOutcomeReason = winners.length === 0 ? 'no-winner' : 'no-paid-entrant-placed'
    // eslint-disable-next-line no-console
    console.warn(
      `[tournament-end] pool ${poolRow.id} ("${tournamentName}") refunded: ${why} — ` +
        `${entrantIds.size} paying entrant(s), ${winners.length} bracket leader(s), ` +
        'none of the paying entrants placed in the bracket',
    )
    return { settled: false, reason: why, refunds: await refundPool(db, poolRow, tournamentName) }
  }

  if (reason === 'best-paid-entrant') {
    // eslint-disable-next-line no-console
    console.log(
      `[tournament-end] pool ${poolRow.id} ("${tournamentName}") settled to the best-placed ` +
        `PAYING entrant(s) ${paidWinners.join(', ')}: the bracket leader(s) ` +
        `${winners.join(', ') || '(none)'} never entered this pool`,
    )
  }

  const pot = entries.reduce((sum: number, entry: any) => sum + Number(entry.amount || 0), 0)
  const shares = splitPrizePoolEvenly(pot, paidWinners.length)
  const paid: { user_id: string; placement: number; amount: number }[] = []
  for (let index = 0; index < paidWinners.length; index += 1) {
    const userId = paidWinners[index]
    const share = shares[index]
    await db.query(
      `insert into wallets (user_id, tokens, sweeps, paid_sweeps_cents)
       values ($1,0,0,0) on conflict (user_id) do nothing`,
      [userId],
    )
    if (share.amount > 0) {
      await db.query(
        'update wallets set sweeps=sweeps+$2::integer, updated_at=now() where user_id=$1',
        [userId, share.amount],
      )
      await db.query(
        `insert into wallet_ledger
           (user_id, kind, tokens_delta, sweeps_delta, paid_sweeps_delta_cents,
            event, result, prize, status, reason, ref_id)
         values ($1,'tournament',0,$2,0,$3,'Win',$4,'Paid',
                 'tournament prize-pool payout',$5)`,
        [userId, share.amount, tournamentName, `${share.amount} Sweeps`, poolRow.id],
      )
    }
    await db.query(
      `insert into tournament_prize_payouts
         (pool_id, user_id, placement, gross_amount, net_amount, status, paid_at)
       values ($1,$2,$3,$4,$4,'paid',now())`,
      [poolRow.id, userId, share.placement, share.amount],
    )
    await db.query(
      `update tournament_prize_entries
          set status='paid', updated_at=now()
        where pool_id=$1 and user_id=$2`,
      [poolRow.id, userId],
    )
    const standing = reason === 'best-paid-entrant'
      ? 'you finished furthest of everyone who entered this prize pool'
      : 'you led the bracket'
    await notify(
      db,
      userId,
      'Tournament prize paid',
      paidWinners.length > 1
        ? `The tournament ended in a ${paidWinners.length}-way tie — you split the pot and received ${share.amount} Sweeps.`
        : `The tournament ended and ${standing} — you received ${share.amount} Sweeps.`,
      `/tournaments/${tournamentId}`,
      poolRow.id,
    )
    paid.push({ user_id: userId, placement: share.placement, amount: share.amount })
  }
  await db.query(
    `update tournament_prize_entries
        set status='forfeited', updated_at=now()
      where pool_id=$1 and status='escrowed'`,
    [poolRow.id],
  )
  await db.query(
    `update tournament_prize_pools
        set status='settled', settled_at=now(), updated_at=now()
      where id=$1`,
    [poolRow.id],
  )
  return { settled: true, pot, reason, payouts: paid }
}

/** End ONE tournament (already known to be past end_at). Runs in its own tx. */
async function endTournament(pool: Queryable, tournamentId: string): Promise<EndedTournament | null> {
  return withTransaction(pool, async (db) => {
    const locked = (await db.query(
      'select * from tournaments where id=$1 for update',
      [tournamentId],
    )).rows[0]
    // Re-check under the lock: another instance may have closed it first.
    if (
      !locked ||
      String(locked.status || '') === 'closed' ||
      !locked.end_at ||
      new Date(locked.end_at).getTime() > Date.now()
    ) {
      return null
    }
    const name = String(locked.name || 'Tournament')

    // ── Roster: ONE canonical entrant set (server/tournamentEntrants.ts). ────
    // The read-through mirror runs before anything reads the roster, so a King
    // registration made since the last boot is already a canonical entrant by
    // the time the pot is settled and the notifications go out.
    const backfilledEntrants = await backfillEntrantsFromRegistrations(db, tournamentId)
    const rosterIds = await canonicalEntrantIds(db, tournamentId, {
      statuses: SEEDABLE_ENTRANT_STATUSES,
      sync: false,
    })

    // ── Winner: furthest advanced in the bracket; results as the fallback. ──
    const battles = (await db.query(
      'select * from tournament_battles where tournament_id=$1',
      [tournamentId],
    )).rows
    let winners = bracketLeaders(battles)
    if (winners.length === 0) {
      const results = (await db.query(
        'select distinct winner_profile_id from tournament_results where tournament_id=$1',
        [tournamentId],
      )).rows
      winners = results.map((row: any) => String(row.winner_profile_id)).sort()
    }
    const tie = winners.length > 1

    // ── Money: settle (or refund) every still-active pool. ──────────────────
    const pools = (await db.query(
      `select * from tournament_prize_pools
        where tournament_id=$1 and status in ('draft','open','locked')
        for update`,
      [tournamentId],
    )).rows
    const settledPools: EndedTournament['settledPools'] = []
    const refundedPools: EndedTournament['refundedPools'] = []
    for (const poolRow of pools) {
      if (poolRow.currency !== 'sweeps') {
        // An active non-Sweeps pool holds money outside our wallets; crediting
        // internally would mint Sweeps from nothing. Leave it for an operator.
        throw new Error(`pool ${poolRow.id} is not a sweeps pool; refusing to auto-settle`)
      }
      const outcome = await settlePool(db, poolRow, winners, battles, rosterIds, tournamentId, name)
      if (outcome.settled) {
        settledPools.push({
          poolId: String(poolRow.id),
          pot: outcome.pot,
          reason: outcome.reason,
          payouts: outcome.payouts,
        })
      } else {
        refundedPools.push({
          poolId: String(poolRow.id),
          reason: outcome.reason,
          refunds: outcome.refunds,
        })
      }
    }

    // ── Record the winner(s) + close. ───────────────────────────────────────
    for (const winnerId of winners) {
      const prior = (await db.query(
        'select id from tournament_results where tournament_id=$1 and winner_profile_id=$2 limit 1',
        [tournamentId, winnerId],
      )).rows[0]
      if (!prior) {
        await db.query(
          'insert into tournament_results (tournament_id, winner_profile_id) values ($1,$2)',
          [tournamentId, winnerId],
        )
      }
    }
    await db.query("update tournaments set status='closed' where id=$1", [tournamentId])

    // ── Notify every entrant — ONE canonical roster, no per-caller dedupe. ──
    // Pending entries are included: somebody whose entry the host never got to
    // still deserves to hear that the tournament ended.
    const entrantIds = new Set(
      await canonicalEntrantIds(db, tournamentId, {
        statuses: ACTIVE_ENTRANT_STATUSES,
        sync: false,
      }),
    )
    const winnerNames = winners.length
      ? (await db.query(
          `select id, username from profiles where id in (${winners.map((_, i) => `$${i + 1}`).join(', ')})`,
          winners,
        )).rows
      : []
    const nameOf = new Map(winnerNames.map((row: any) => [String(row.id), String(row.username)]))
    const outcomeLine =
      winners.length === 0
        ? 'No winner could be determined; any prize entries were refunded.'
        : tie
          ? `It ended in a tie — ${winners.map((id) => nameOf.get(id) || 'a player').join(' and ')} split the prize evenly.`
          : `${nameOf.get(winners[0]) || 'The bracket leader'} takes the win.`
    let notified = 0
    for (const entrantId of entrantIds) {
      await notify(
        db,
        entrantId,
        'Tournament ended',
        `"${name}" reached its end time. ${outcomeLine}`,
        `/tournaments/${tournamentId}`,
        tournamentId,
      )
      notified += 1
    }

    return { tournamentId, name, winners, tie, settledPools, refundedPools, notified, backfilledEntrants }
  })
}

/** One sweep pass: close every tournament whose end_at has passed. */
export async function sweepEndedTournaments(pool: Queryable): Promise<EndSweepSummary> {
  const summary: EndSweepSummary = { scanned: 0, closed: [], errors: [] }
  const due = (await pool.query(
    `select id from tournaments
      where end_at is not null and end_at <= now()
        and coalesce(status,'') <> 'closed'
      order by end_at asc`,
  )).rows
  for (const row of due) {
    summary.scanned += 1
    const tournamentId = String(row.id)
    try {
      const ended = await endTournament(pool, tournamentId)
      if (ended) summary.closed.push(ended)
    } catch (error) {
      summary.errors.push({ tournamentId, error: (error as Error).message })
    }
  }
  return summary
}

/** Background runner, same shape as startAutoLiveScanner (server/autoLive.ts). */
export function startTournamentEndSweeper(db: Queryable): { stop: () => void } {
  if (/^(1|true|yes)$/i.test(String(process.env.TOURNAMENT_END_SWEEP_DISABLED || ''))) {
    return { stop() {} }
  }
  const requested = Number(process.env.TOURNAMENT_END_SWEEP_INTERVAL_SECONDS || 120)
  const intervalMs = Math.max(30, Number.isFinite(requested) ? requested : 120) * 1000
  let running = false
  const sweep = async () => {
    if (running) return
    running = true
    try {
      const result = await withDistributedLease(db, 'tournament-end-sweep', 120, () =>
        sweepEndedTournaments(db),
      )
      const summary = result.value
      if (result.acquired && summary && (summary.closed.length || summary.errors.length)) {
        // eslint-disable-next-line no-console
        console.log(
          `[tournament-end] closed ${summary.closed.length} tournament(s)` +
            (summary.errors.length ? `, ${summary.errors.length} error(s)` : ''),
        )
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[tournament-end] sweep failed:', (error as Error).message)
    } finally {
      running = false
    }
  }
  const first = setTimeout(() => void sweep(), 12_000)
  const timer = setInterval(() => void sweep(), intervalMs)
  ;(timer as any).unref?.()
  ;(first as any).unref?.()
  return { stop() { clearTimeout(first); clearInterval(timer) } }
}
