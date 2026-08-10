/* eslint-disable @typescript-eslint/no-explicit-any */
// ===========================================================================
// TKO KING — server matchmaking + results for the never-ending ladder.
//
// Register → you're rated and auto-paired with someone in your rank band. You
// both propose times; when they overlap the match schedules itself. A verified
// result re-rates both (Elo) and frees them to be paired again. The top-rated
// Shinobi holds the "TKO King" status. Pure ladder/scheduling math lives in
// src/lib/kingLadder + kingSchedule; this is the DB orchestration over them.
// ===========================================================================
import { applyLadderResult, candidatesFor, START_RATING, kingOf, type LadderPlayer } from '../src/lib/kingLadder'
import { applyProposal, matchState, type KingMatch } from '../src/lib/kingSchedule'

type Pool = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }

const jsonArr = (v: any): string[] => {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : [] } catch { return [] } }
  return []
}

/** Ensure a rating row exists; returns the current rating. */
export async function ensureRating(pool: Pool, userId: string): Promise<number> {
  await pool.query(
    `insert into king_ratings (user_id, rating) values ($1,$2) on conflict (user_id) do nothing`,
    [userId, START_RATING],
  )
  const r = await pool.query('select rating from king_ratings where user_id=$1', [userId])
  return Number(r.rows[0]?.rating ?? START_RATING)
}

/** The whole ladder, King-first. */
export async function loadLadder(pool: Pool): Promise<LadderPlayer[]> {
  const r = await pool.query('select user_id, rating from king_ratings')
  return r.rows.map((x: any) => ({ id: String(x.user_id), rating: Number(x.rating) }))
}

/** A user's current OPEN match (proposing/scheduled/awaiting), or null. */
export async function openMatchFor(pool: Pool, userId: string): Promise<any | null> {
  const r = await pool.query(
    `select * from king_matches where (player_a=$1 or player_b=$1) and status <> 'done' order by created_at desc limit 1`,
    [userId],
  )
  return r.rows[0] ?? null
}

/**
 * Pair a registered user with the best available opponent in their rank band
 * (top players only face top players). Returns the match row (existing if they
 * already have one). Null if there's nobody suitable yet.
 */
export async function pairNext(pool: Pool, userId: string): Promise<any | null> {
  await ensureRating(pool, userId)
  const existing = await openMatchFor(pool, userId)
  if (existing) return existing

  const ladder = await loadLadder(pool)
  // Who's already busy in an open match?
  const busy = new Set<string>()
  const openRows = await pool.query(`select player_a, player_b from king_matches where status <> 'done'`)
  for (const m of openRows.rows) { busy.add(String(m.player_a)); busy.add(String(m.player_b)) }

  const candidates = candidatesFor(userId, ladder).filter((p) => !busy.has(p.id))
  if (candidates.length === 0) return null
  // Nearest-rated free opponent.
  const me = ladder.find((p) => p.id === userId)
  const opp = candidates.sort((a, b) =>
    Math.abs(a.rating - (me?.rating ?? START_RATING)) - Math.abs(b.rating - (me?.rating ?? START_RATING)),
  )[0]
  const ins = await pool.query(
    `insert into king_matches (player_a, player_b, status) values ($1,$2,'proposing') returning *`,
    [userId, opp.id],
  )
  return ins.rows[0] ?? null
}

/** Fold in a time proposal; schedules the match when both sides overlap. */
export async function proposeTime(pool: Pool, matchId: string, userId: string, slots: string[]): Promise<any | null> {
  const row = (await pool.query('select * from king_matches where id=$1', [matchId])).rows[0]
  if (!row) return null
  const match: KingMatch = {
    id: String(row.id), playerA: String(row.player_a), playerB: String(row.player_b),
    proposalsA: jsonArr(row.proposals_a), proposalsB: jsonArr(row.proposals_b),
    agreedTime: row.agreed_time ? new Date(row.agreed_time).toISOString() : null,
    winnerId: row.winner_id ? String(row.winner_id) : null,
  }
  const next = applyProposal(match, userId, slots)
  const status = matchState(next)
  await pool.query(
    `update king_matches set proposals_a=$1, proposals_b=$2, agreed_time=$3, status=$4 where id=$5`,
    [JSON.stringify(next.proposalsA), JSON.stringify(next.proposalsB), next.agreedTime, status, matchId],
  )
  return { ...next, status }
}

export type ParticipantReportResult = {
  ok: boolean
  settled: boolean
  status?: string
  winnerId?: string | null
  yourReport?: string | null
  opponentReport?: string | null
  conflict?: boolean
  error?: string
  winnerRating?: number
  loserRating?: number
  king?: string | null
}

/**
 * Record one participant's result claim without trusting it as the result.
 * Ratings move only after BOTH participants name the same winner. A mismatch is
 * kept as `disputed` so a later trusted media/host decision can resolve it, or
 * either player can correct their own report.
 */
export async function submitParticipantReport(
  pool: Pool,
  matchId: string,
  reporterId: string,
  winnerId: string,
): Promise<ParticipantReportResult> {
  const current = (await pool.query('select * from king_matches where id=$1', [matchId])).rows[0]
  if (!current) return { ok: false, settled: false, error: 'match not found' }

  const playerA = String(current.player_a)
  const playerB = String(current.player_b)
  if (reporterId !== playerA && reporterId !== playerB) {
    return { ok: false, settled: false, error: 'not your match' }
  }
  if (winnerId !== playerA && winnerId !== playerB) {
    return { ok: false, settled: false, error: 'winner not in this match' }
  }
  if (current.winner_id) {
    return {
      ok: true,
      settled: true,
      status: String(current.status || 'done'),
      winnerId: String(current.winner_id),
    }
  }

  const updated = await pool.query(
    `update king_matches
        set report_a_winner_id = case when player_a=$2 then $3 else report_a_winner_id end,
            report_b_winner_id = case when player_b=$2 then $3 else report_b_winner_id end
      where id=$1 and winner_id is null
      returning *`,
    [matchId, reporterId, winnerId],
  )
  if (!updated.rows[0]) {
    const latest = (await pool.query('select * from king_matches where id=$1', [matchId])).rows[0]
    if (latest?.winner_id) {
      return {
        ok: true,
        settled: true,
        status: String(latest.status || 'done'),
        winnerId: String(latest.winner_id),
      }
    }
    return { ok: false, settled: false, error: 'result report could not be saved' }
  }

  // Recompute from the latest row, not the stale UPDATE result. This keeps two
  // simultaneous reports from racing a `disputed` match back to `waiting`.
  const state = (await pool.query(
    `update king_matches
        set status = case
          when report_a_winner_id is not null
           and report_b_winner_id is not null
           and report_a_winner_id <> report_b_winner_id then 'disputed'
          when report_a_winner_id is not null or report_b_winner_id is not null then 'awaiting_confirmation'
          else status
        end
      where id=$1 and winner_id is null
      returning *`,
    [matchId],
  )).rows[0]

  if (!state) {
    const latest = (await pool.query('select * from king_matches where id=$1', [matchId])).rows[0]
    return latest?.winner_id
      ? { ok: true, settled: true, status: String(latest.status || 'done'), winnerId: String(latest.winner_id) }
      : { ok: false, settled: false, error: 'result report could not be confirmed' }
  }

  const reportA = state.report_a_winner_id ? String(state.report_a_winner_id) : null
  const reportB = state.report_b_winner_id ? String(state.report_b_winner_id) : null
  const yourReport = reporterId === playerA ? reportA : reportB
  const opponentReport = reporterId === playerA ? reportB : reportA

  if (reportA && reportB && reportA === reportB) {
    const settlement = await reportResult(pool, matchId, reportA)
    if (!settlement.ok && settlement.error === 'already decided') {
      const latest = (await pool.query('select status,winner_id from king_matches where id=$1', [matchId])).rows[0]
      return {
        ok: true,
        settled: true,
        status: String(latest?.status || 'done'),
        winnerId: latest?.winner_id ? String(latest.winner_id) : reportA,
        yourReport,
        opponentReport,
      }
    }
    return {
      ...settlement,
      settled: settlement.ok,
      status: settlement.ok ? 'done' : String(state.status),
      winnerId: settlement.ok ? reportA : null,
      yourReport,
      opponentReport,
    }
  }

  const conflict = Boolean(reportA && reportB && reportA !== reportB)
  return {
    ok: true,
    settled: false,
    status: conflict ? 'disputed' : 'awaiting_confirmation',
    winnerId: null,
    yourReport,
    opponentReport,
    conflict,
  }
}

/**
 * Record a verified result: re-rate both players (Elo), close the match, and try
 * to pair each of them again. Returns the new King id + both new ratings.
 */
export async function reportResult(pool: Pool, matchId: string, winnerId: string): Promise<any> {
  // Claim settlement atomically. Participant reports can arrive at the same
  // instant; only one caller is allowed to move the ratings.
  const row = (await pool.query(
    `update king_matches
        set winner_id=$2, status='settling'
      where id=$1 and winner_id is null and (player_a=$2 or player_b=$2)
      returning *`,
    [matchId, winnerId],
  )).rows[0]
  if (!row) {
    const existing = (await pool.query('select winner_id from king_matches where id=$1', [matchId])).rows[0]
    if (!existing) return { ok: false, error: 'match not found' }
    if (existing.winner_id) return { ok: false, error: 'already decided' }
    return { ok: false, error: 'winner not in this match' }
  }
  const a = String(row.player_a), b = String(row.player_b)
  const loserId = winnerId === a ? b : a

  try {
    const wr = await ensureRating(pool, winnerId)
    const lr = await ensureRating(pool, loserId)
    const { winner, loser } = applyLadderResult(wr, lr)
    // One statement updates both participants, so there is no half-rerated
    // match if the database rejects the write.
    await pool.query(
      `update king_ratings
          set rating = case when user_id=$1 then $3 else $4 end,
              matches = matches + 1,
              wins = wins + case when user_id=$1 then 1 else 0 end,
              updated_at = now()
        where user_id=$1 or user_id=$2`,
      [winnerId, loserId, winner, loser],
    )
    await pool.query(`update king_matches set status='done' where id=$1 and winner_id=$2`, [matchId, winnerId])

    const king = kingOf(await loadLadder(pool))
    // Free them to fight again.
    await pairNext(pool, winnerId).catch(() => null)
    await pairNext(pool, loserId).catch(() => null)
    return { ok: true, winnerRating: winner, loserRating: loser, king }
  } catch (error) {
    await pool.query(
      `update king_matches
          set winner_id=null,
              status=case
                when report_a_winner_id is not null or report_b_winner_id is not null then 'awaiting_confirmation'
                else 'awaiting_result'
              end
        where id=$1 and status='settling'`,
      [matchId],
    ).catch(() => null)
    throw error
  }
}
