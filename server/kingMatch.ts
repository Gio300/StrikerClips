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

/**
 * Record a verified result: re-rate both players (Elo), close the match, and try
 * to pair each of them again. Returns the new King id + both new ratings.
 */
export async function reportResult(pool: Pool, matchId: string, winnerId: string): Promise<any> {
  const row = (await pool.query('select * from king_matches where id=$1', [matchId])).rows[0]
  if (!row) return { ok: false, error: 'match not found' }
  if (row.winner_id) return { ok: false, error: 'already decided' }
  const a = String(row.player_a), b = String(row.player_b)
  if (winnerId !== a && winnerId !== b) return { ok: false, error: 'winner not in this match' }
  const loserId = winnerId === a ? b : a

  const wr = await ensureRating(pool, winnerId)
  const lr = await ensureRating(pool, loserId)
  const { winner, loser } = applyLadderResult(wr, lr)
  await pool.query('update king_ratings set rating=$1, matches=matches+1, wins=wins+1, updated_at=now() where user_id=$2', [winner, winnerId])
  await pool.query('update king_ratings set rating=$1, matches=matches+1, updated_at=now() where user_id=$2', [loser, loserId])
  await pool.query(`update king_matches set winner_id=$1, status='done' where id=$2`, [winnerId, matchId])

  const king = kingOf(await loadLadder(pool))
  // Free them to fight again.
  await pairNext(pool, winnerId).catch(() => null)
  await pairNext(pool, loserId).catch(() => null)
  return { ok: true, winnerRating: winner, loserRating: loser, king }
}
