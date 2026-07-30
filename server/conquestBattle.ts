/* eslint-disable @typescript-eslint/no-explicit-any */
// ===========================================================================
// CONQUEST BATTLE RESOLVER — battles move the map.
//
// A clan battle result (a found-video match or a scheduled match, whoever
// reports it) lands here. This is the ONE place that turns a win/loss into land
// changing hands, applying the rules from src/lib/conquestMechanics:
//
//   • an UNCLAIMED territory is taken on the first win — plant your flag;
//   • an OCCUPIED territory only flips once the challenger's NET wins over the
//     current holder (for THAT territory) reach VACATE_MARGIN — so a clan erodes
//     an incumbent over several battles before pushing them off the land;
//   • a win by the current holder is a successful defense (no change), and pulls
//     the rival's margin back down.
//
// Pure orchestration over the pool + the shared rules, so it unit-tests against
// pg-mem with no video, no network. It logs every battle to `clan_battles` and,
// on a capture, stamps `territories.owner_clan_id` + `captured_at`.
// ===========================================================================
import { VACATE_MARGIN, dominanceCapture } from '../src/lib/conquestMechanics'

type Pool = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }

/** Head-to-head is settled on RECENT form — a rolling week, so it's "this week's
 *  matches added up" rather than an all-time tally that never resets. */
export const PERIOD_DAYS = 7

/** Clans allied WITH `clanId` (both directions) — the village it belongs to. */
async function alliesOf(pool: Pool, clanId: string): Promise<string[]> {
  try {
    const r = await pool.query(
      'select clan_id, ally_clan_id from clan_alliances where clan_id=$1 or ally_clan_id=$1',
      [clanId],
    )
    const set = new Set<string>()
    for (const row of r.rows) {
      const a = String(row.clan_id), b = String(row.ally_clan_id)
      if (a !== clanId) set.add(a)
      if (b !== clanId) set.add(b)
    }
    return [...set]
  } catch {
    return []
  }
}

/** Are two clans in the same village (allied)? Allies don't fight for land. */
async function areAllied(pool: Pool, a: string, b: string): Promise<boolean> {
  if (a === b) return true
  return (await alliesOf(pool, a)).includes(b)
}

/** A clan's members; a VILLAGE (clan + allies) is bigger and holds land harder. */
async function clanSize(pool: Pool, clanId: string): Promise<number> {
  try {
    const ids = [clanId, ...(await alliesOf(pool, clanId))]
    const r = await pool.query(
      'select count(*)::int n from clan_members where clan_id = any($1) or server_id = any($1)',
      [ids],
    )
    return Math.max(1, Number(r.rows[0]?.n ?? 1))
  } catch {
    return 1
  }
}

export interface ConquestBattleInput {
  winnerClanId: string
  loserClanId: string | null
  territoryId: string
  /** Dedupe key (e.g. the match id) so the same battle never counts twice. */
  matchKey?: string | null
}

export interface ConquestBattleResult {
  recorded: boolean
  captured: boolean
  territoryId: string
  ownerClanId: string | null
  /** How many more net wins the winner needs to seize an occupied land (0 = took it). */
  marginToCapture: number
  reason: 'captured' | 'defended' | 'contested' | 'shielded' | 'already-recorded' | 'territory-not-found' | 'invalid' | 'allied'
}

async function rivalryResetSince(
  pool: Pool,
  attacker: string,
  defender: string,
): Promise<string | null> {
  try {
    const r = await pool.query(
      `select rivalry_reset_at from clan_conquest_state
        where clan_id = any($1) and rivalry_reset_at is not null
        order by rivalry_reset_at desc limit 1`,
      [[attacker, defender]],
    )
    return r.rows[0]?.rivalry_reset_at
      ? new Date(r.rows[0].rivalry_reset_at).toISOString()
      : null
  } catch {
    return null
  }
}

async function activeKillLead(pool: Pool, clanId: string): Promise<number> {
  try {
    const r = await pool.query(
      `select effects from conquest_artifact_activations
        where clan_id=$1 and status='active'
          and (expires_at is null or expires_at > now())`,
      [clanId],
    )
    let total = 0
    for (const row of r.rows) {
      let effects = row.effects
      if (typeof effects === 'string') {
        try { effects = JSON.parse(effects) } catch { effects = [] }
      }
      if (!Array.isArray(effects)) continue
      for (const effect of effects) {
        if (effect?.kind === 'kill_lead') {
          total += Math.max(0, Math.floor(Number(effect.amount || 0)))
        }
      }
    }
    return total
  } catch {
    return 0
  }
}

/** Head-to-head verified wins between two clans over a territory THIS PERIOD
 *  (the rolling week), so the map settles on recent form, not an all-time tally. */
async function headToHead(pool: Pool, territoryId: string, attacker: string, defender: string): Promise<{ winsFor: number; winsAgainst: number }> {
  const periodStart = new Date(Date.now() - PERIOD_DAYS * 86_400_000)
  const resetRaw = await rivalryResetSince(pool, attacker, defender)
  const resetAt = resetRaw ? new Date(resetRaw) : null
  const since = (
    resetAt && Number.isFinite(resetAt.getTime()) && resetAt > periodStart
  ) ? resetAt.toISOString() : periodStart.toISOString()
  const count = async (w: string, l: string) => {
    try {
      const r = await pool.query(
        'select count(*)::int n from clan_battles where territory_id=$1 and winner_clan_id=$2 and loser_clan_id=$3 and created_at >= $4',
        [territoryId, w, l, since],
      )
      return Number(r.rows[0]?.n ?? 0)
    } catch {
      // Backend without a comparable created_at — fall back to all-time.
      const r = await pool.query(
        'select count(*)::int n from clan_battles where territory_id=$1 and winner_clan_id=$2 and loser_clan_id=$3',
        [territoryId, w, l],
      )
      return Number(r.rows[0]?.n ?? 0)
    }
  }
  return { winsFor: await count(attacker, defender), winsAgainst: await count(defender, attacker) }
}

/**
 * Apply one clan battle result to the map. Records the battle, then transfers
 * the territory if the win earned it. Idempotent on `matchKey`.
 */
export async function applyConquestBattle(pool: Pool, input: ConquestBattleInput): Promise<ConquestBattleResult> {
  const winnerClanId = String(input.winnerClanId || '')
  const territoryId = String(input.territoryId || '')
  const loserClanId = input.loserClanId ? String(input.loserClanId) : null
  const matchKey = input.matchKey ? String(input.matchKey) : null

  if (!winnerClanId || !territoryId) {
    return { recorded: false, captured: false, territoryId, ownerClanId: null, marginToCapture: VACATE_MARGIN, reason: 'invalid' }
  }

  // Idempotency: a battle already logged for this matchKey is a no-op.
  if (matchKey) {
    const dup = await pool.query('select id from clan_battles where match_key=$1', [matchKey])
    if (dup.rows.length) {
      const t = await pool.query('select owner_clan_id from territories where id=$1', [territoryId])
      return { recorded: false, captured: false, territoryId, ownerClanId: t.rows[0]?.owner_clan_id ?? null, marginToCapture: 0, reason: 'already-recorded' }
    }
  }

  let terr: any
  try {
    terr = (await pool.query(
      'select id, owner_clan_id, protected_until from territories where id=$1',
      [territoryId],
    )).rows[0]
  } catch {
    terr = (await pool.query(
      'select id, owner_clan_id from territories where id=$1',
      [territoryId],
    )).rows[0]
  }
  if (!terr) {
    return { recorded: false, captured: false, territoryId, ownerClanId: null, marginToCapture: VACATE_MARGIN, reason: 'territory-not-found' }
  }
  const holder: string | null = terr.owner_clan_id ?? null

  // Allies don't fight for land. If the two clans have merged into a village,
  // a battle between them is friendly — it never counts against the territory.
  if (loserClanId && (await areAllied(pool, winnerClanId, loserClanId))) {
    return { recorded: false, captured: false, territoryId, ownerClanId: holder, marginToCapture: 0, reason: 'allied' }
  }

  // A base ward prevents capture attempts from counting while it is active.
  // Defenses by the holder still record normally.
  const protectedUntil = terr.protected_until ? new Date(terr.protected_until).getTime() : 0
  if (holder && holder !== winnerClanId && protectedUntil > Date.now()) {
    return {
      recorded: false,
      captured: false,
      territoryId,
      ownerClanId: holder,
      marginToCapture: 0,
      reason: 'shielded',
    }
  }

  // Log the battle (this counts toward the rivalry margin below).
  await pool.query(
    'insert into clan_battles (winner_clan_id, loser_clan_id, match_key, territory_id) values ($1,$2,$3,$4)',
    [winnerClanId, loserClanId, matchKey, territoryId],
  )

  // Resolve ownership.
  if (!holder) {
    await pool.query('update territories set owner_clan_id=$1, captured_at=now() where id=$2', [winnerClanId, territoryId])
    return { recorded: true, captured: true, territoryId, ownerClanId: winnerClanId, marginToCapture: 0, reason: 'captured' }
  }
  if (holder === winnerClanId) {
    return { recorded: true, captured: false, territoryId, ownerClanId: holder, marginToCapture: 0, reason: 'defended' }
  }
  // Capture is decided by the BALANCE of verified head-to-head wins, weighted by
  // clan sizes: you must be winning a clear majority AND clear the size-scaled
  // net margin to push the holder out. Losses pull the net back down, so a clan
  // that starts losing gives ground.
  const { winsFor, winsAgainst } = await headToHead(pool, territoryId, winnerClanId, holder)
  const [defSize, atkSize, attackerLead, defenderLead] = await Promise.all([
    clanSize(pool, holder),
    clanSize(pool, winnerClanId),
    activeKillLead(pool, winnerClanId),
    activeKillLead(pool, holder),
  ])
  const dom = dominanceCapture({
    winsFor: winsFor + attackerLead,
    winsAgainst: winsAgainst + defenderLead,
    defenderSize: defSize,
    attackerSize: atkSize,
  })
  if (dom.captured) {
    await pool.query('update territories set owner_clan_id=$1, captured_at=now() where id=$2', [winnerClanId, territoryId])
    return { recorded: true, captured: true, territoryId, ownerClanId: winnerClanId, marginToCapture: 0, reason: 'captured' }
  }
  return { recorded: true, captured: false, territoryId, ownerClanId: holder, marginToCapture: Math.max(0, dom.need - dom.net), reason: 'contested' }
}
