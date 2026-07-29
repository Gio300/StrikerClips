/* eslint-disable @typescript-eslint/no-explicit-any */
// ===========================================================================
// AUTO-MERGE → CONQUEST — the verification→map loop.
//
// The auto-merge already PROVES two clans fought the same match (linked
// accounts + clock/banner confirm) and knows who won (the tagged result). This
// turns that verified result into a Conquest battle: the winning clan's win is
// recorded against the losing clan over a real territory, and the dominance
// rules (server/conquestBattle.ts) decide if land changes hands. No separate
// identity check — being in an auto-merged match IS the verification.
//
// Pure orchestration over the pool, so it unit-tests against pg-mem.
// ===========================================================================
import { applyConquestBattle } from './conquestBattle'

type Pool = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }

/** Resolve a player's clan id (clan_members), or null. */
async function clanOf(pool: Pool, playerId: string): Promise<string | null> {
  try {
    const r = await pool.query('select clan_id, server_id from clan_members where user_id=$1 limit 1', [playerId])
    const row = r.rows[0]
    return row ? String(row.clan_id ?? row.server_id) : null
  } catch {
    return null
  }
}

/** Pick the territory this battle is over: the LOSER clan's land (an attack on
 *  it). If they hold several, the most-recently-captured; if none, null. */
async function contestedTerritory(pool: Pool, loserClanId: string): Promise<string | null> {
  try {
    const r = await pool.query(
      'select id from territories where owner_clan_id=$1 order by captured_at desc nulls last limit 1',
      [loserClanId],
    )
    return r.rows[0] ? String(r.rows[0].id) : null
  } catch {
    return null
  }
}

export interface MatchToConquestResult {
  applied: boolean
  captured?: boolean
  reason: string
}

/**
 * Record a produced multi-angle match into Conquest. `clipRecordIds` are the
 * angle rows of the match; `compositeId` is the produced-video id (the unique
 * match key so it counts once). We read each angle's player + outcome, resolve
 * their clans, and if it's a clan-vs-clan match with a known winner, register
 * the battle over the loser clan's land.
 */
export async function recordMatchToConquest(
  pool: Pool,
  clipRecordIds: string[],
  compositeId: string,
): Promise<MatchToConquestResult> {
  if (!clipRecordIds.length || !compositeId) return { applied: false, reason: 'no clips' }
  let rows: any[] = []
  try {
    const ph = clipRecordIds.map((_, i) => `$${i + 1}`).join(',')
    rows = (await pool.query(
      `select player_id, outcome from clip_records where id in (${ph})`,
      clipRecordIds,
    )).rows
  } catch {
    return { applied: false, reason: 'clips unreadable' }
  }

  // Map each player to a clan + note who won.
  const clanByPlayer = new Map<string, string>()
  let winnerClan: string | null = null
  for (const r of rows) {
    const pid = r.player_id ? String(r.player_id) : ''
    if (!pid || clanByPlayer.has(pid)) continue
    const clan = await clanOf(pool, pid)
    if (clan) {
      clanByPlayer.set(pid, clan)
      if (String(r.outcome) === 'victory') winnerClan = clan
    }
  }
  const clans = [...new Set(clanByPlayer.values())]
  if (clans.length !== 2) return { applied: false, reason: 'not a two-clan match' }
  if (!winnerClan) return { applied: false, reason: 'no verified winner (untagged result)' }
  const loserClan = clans.find((c) => c !== winnerClan) ?? null
  if (!loserClan) return { applied: false, reason: 'no distinct loser' }

  // Battle is over the loser's land (an attack). If they hold none, nothing to
  // fight for here — the win still counts once they DO hold land.
  const territoryId = await contestedTerritory(pool, loserClan)
  if (!territoryId) return { applied: false, reason: 'loser holds no territory to contest' }

  const res = await applyConquestBattle(pool, {
    winnerClanId: winnerClan,
    loserClanId: loserClan,
    territoryId,
    matchKey: `merge:${compositeId}`,
  })
  return { applied: res.recorded, captured: res.captured, reason: res.reason }
}
