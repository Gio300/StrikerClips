/* eslint-disable @typescript-eslint/no-explicit-any */
// =============================================================================
// ASK TKO — the grounding context.
//
// Ask TKO (the `ask` fn in server/app.ts) is a Gemini call with a system prompt.
// It used to receive only two things: global COUNTS (liveStats — "12 clans, 4
// tournaments") and a thin personal snapshot (userStats — power level, wallet,
// clip totals). That is enough to answer "how many clans are there?" and
// nothing else: it could not name a single tournament, could not say whether
// the player was in one, could not read a rule, and could not see the reels or
// artifacts the player had made. Every such question got a plausible-sounding
// guess or a redirect.
//
// This module supplies the missing facts, as a COMPACT BRIEFING rather than a
// database dump — a handful of lines per topic, hard row caps everywhere, so
// the prompt stays small and cheap.
//
// PRIVACY IS STRUCTURAL HERE.
//   • The PUBLIC section only ever contains data the app already shows to a
//     signed-out visitor: the tournament list (tournaments are select:'public'
//     in the data API's table policy) and bracket rosters (the bracket renders
//     names to anyone).
//   • Every PRIVATE section is filtered by `user_id = $1` / `owner_id = $1` in
//     SQL. There is no code path that takes another user's id.
//   • A signed-out caller gets the public section only — `userId` is null and
//     every private builder returns ''.
//   • Opponent usernames are resolved from `profiles`, which is the same public
//     identity the bracket already displays. No email, wallet, metadata or any
//     other user's private column is ever selected.
//
// Every query is best-effort: a table or column missing on an older install is
// caught and skipped, exactly like liveStats/userStats in server/app.ts, so a
// schema drift degrades the answer instead of breaking the assistant.
// =============================================================================
import { bracketLeaders } from '../src/lib/tournamentBracket'

export type Pooly = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }

/** Hard caps — this is a briefing, not a database dump. */
export const ASK_MAX_TOURNAMENTS = 6
export const ASK_MAX_ENTRIES = 6
export const ASK_MAX_BATTLES = 5
export const ASK_MAX_ARTIFACTS = 6
export const ASK_MAX_REELS = 5
/** Tournaments we compute live standings for (bracket scan is not free). */
export const ASK_MAX_STANDINGS = 2

const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try { return await fn() } catch { return fallback }
}

const day = (value: unknown): string => {
  if (value == null || value === '') return ''
  const at = new Date(String(value))
  return Number.isFinite(at.getTime()) ? at.toISOString().slice(0, 10) : ''
}

const trim = (value: unknown, max: number): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** `[id] -> username` for a set of profile ids (public identity only). */
async function usernames(pool: Pooly, ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean).map(String)))
  if (!unique.length) return new Map()
  return safe(async () => {
    const placeholders = unique.map((_, index) => `$${index + 1}`).join(', ')
    const rows = (await pool.query(
      `select id, username from profiles where id in (${placeholders})`,
      unique,
    )).rows
    return new Map(rows.map((row: any) => [String(row.id), String(row.username ?? 'player')]))
  }, new Map<string, string>())
}

/**
 * PUBLIC — the tournaments that are actually running, so "what tournaments are
 * on right now?" is answered from the board instead of invented. Same data the
 * signed-out /tournaments page lists.
 */
export async function openTournamentsContext(pool: Pooly): Promise<string> {
  const rows = await safe(async () => (await pool.query(
    `select id, name, status, format, league_slug, start_at, end_at
       from tournaments
      where coalesce(status,'open') <> 'closed'
      order by created_at desc
      limit ${ASK_MAX_TOURNAMENTS}`,
  )).rows, [] as any[])
  if (!rows.length) return ''

  // Accepted-entrant headcount per tournament, resolved as the ONE canonical
  // roster does (server/tournamentEntrants.ts): the accepted entrants, plus any
  // King registration that has no entrant row yet.
  //
  // This used to SUM the two tables, which double-counted anyone holding both
  // rows — and every King registration is mirrored into tournament_entrants
  // now, so that would double-count the entire King board. Resolved in JS
  // rather than by running the mirror: a briefing is a read, and a read should
  // not write. A registration the host explicitly rejected is not counted.
  const ids = rows.map((row: any) => String(row.id))
  const counts = new Map<string, number>()
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ')
  const roster = new Map<string, Set<string>>()
  const knownEntrant = new Map<string, Set<string>>()
  const add = (map: Map<string, Set<string>>, tournamentId: string, userId: string) => {
    const set = map.get(tournamentId) ?? new Set<string>()
    set.add(userId)
    map.set(tournamentId, set)
  }
  for (const row of await safe(async () => (await pool.query(
    `select tournament_id, user_id, status from tournament_entrants
      where tournament_id in (${placeholders})`,
    ids,
  )).rows, [] as any[])) {
    const tournamentId = String(row.tournament_id)
    const userId = String(row.user_id)
    add(knownEntrant, tournamentId, userId)
    if (String(row.status ?? '') === 'accepted') add(roster, tournamentId, userId)
  }
  for (const row of await safe(async () => (await pool.query(
    `select tournament_id, user_id from tournament_registrations
      where tournament_id in (${placeholders})`,
    ids,
  )).rows, [] as any[])) {
    const tournamentId = String(row.tournament_id)
    const userId = String(row.user_id)
    // An entrant row already ruled on this person — its status is the answer.
    if (knownEntrant.get(tournamentId)?.has(userId)) continue
    add(roster, tournamentId, userId)
  }
  for (const [tournamentId, set] of roster) counts.set(tournamentId, set.size)

  const lines = rows.map((row: any) => {
    const parts = [
      `status ${trim(row.status, 20) || 'open'}`,
      `format ${trim(row.format, 24) || 'standard'}`,
      `league ${trim(row.league_slug, 40) || 'tko'}`,
    ]
    const starts = day(row.start_at)
    const ends = day(row.end_at)
    parts.push(starts ? `starts ${starts}` : 'start date TBD')
    // An end time is what lets a tournament auto-close and pay out; say so
    // plainly rather than leaving the assistant to guess when it finishes.
    parts.push(ends ? `ends ${ends}` : 'no end time set')
    parts.push(`${counts.get(String(row.id)) ?? 0} accepted entrants`)
    return `- ${trim(row.name, 80)} (${parts.join(', ')})`
  })
  return `Tournaments on the board right now:\n${lines.join('\n')}`
}

/**
 * PRIVATE — the asking player's own entries and their verdicts. Scoped by
 * user_id in SQL; a signed-out caller gets ''.
 */
export async function myTournamentsContext(pool: Pooly, userId: string | null): Promise<string> {
  if (!userId) return ''
  const bits: string[] = []

  // The canonical roster first (tournament_entrants). Every King registration
  // is mirrored into it, so the registrations pass below only adds tournaments
  // this list did not already cover — otherwise a King entrant would be
  // briefed twice, once as "entered" and once as "registered for".
  const entries = await safe(async () => (await pool.query(
    `select t.id, t.name, t.status as tournament_status, e.status as entry_status
       from tournament_entrants e join tournaments t on t.id = e.tournament_id
      where e.user_id = $1
      order by e.created_at desc
      limit ${ASK_MAX_ENTRIES}`,
    [userId],
  )).rows, [] as any[])
  const covered = new Set<string>()
  for (const row of entries) {
    covered.add(String(row.id))
    bits.push(
      `entered "${trim(row.name, 80)}" — entry ${trim(row.entry_status, 20) || 'pending'}` +
      `, tournament ${trim(row.tournament_status, 20) || 'open'}`,
    )
  }

  const regs = await safe(async () => (await pool.query(
    `select t.id, t.name, t.status
       from tournament_registrations r join tournaments t on t.id = r.tournament_id
      where r.user_id = $1
      order by r.registered_at desc
      limit ${ASK_MAX_ENTRIES}`,
    [userId],
  )).rows, [] as any[])
  for (const row of regs) {
    if (covered.has(String(row.id))) continue
    bits.push(`registered for "${trim(row.name, 80)}" (${trim(row.status, 20) || 'open'})`)
  }

  // Upcoming/undecided matches, with the opponent named.
  const battles = await safe(async () => (await pool.query(
    `select b.round, b.status, b.scheduled_at, b.player_a, b.player_b, t.name
       from tournament_battles b join tournaments t on t.id = b.tournament_id
      where (b.player_a = $1 or b.player_b = $1) and b.winner is null
      order by b.round asc
      limit ${ASK_MAX_BATTLES}`,
    [userId],
  )).rows, [] as any[])
  const names = await usernames(
    pool,
    battles.map((row: any) => (String(row.player_a) === String(userId) ? row.player_b : row.player_a)),
  )
  for (const row of battles) {
    const opponentId = String(row.player_a) === String(userId) ? row.player_b : row.player_a
    const opponent = opponentId ? (names.get(String(opponentId)) ?? 'an unnamed player') : 'a bye'
    const when = day(row.scheduled_at)
    bits.push(
      `upcoming match in "${trim(row.name, 80)}" round ${Number(row.round ?? 1)} vs ${opponent}` +
      (when ? ` on ${when}` : ' (time not set)'),
    )
  }

  if (!bits.length) return 'This player has not entered any tournament yet.'
  return `The signed-in player's own tournament activity — ${bits.join('; ')}.`
}

/**
 * PUBLIC — who is leading the brackets this player is involved in. Bracket
 * standings are public (the bracket renders them to anyone); only the CHOICE of
 * which tournaments to summarise is personal.
 */
export async function myStandingsContext(pool: Pooly, userId: string | null): Promise<string> {
  if (!userId) return ''
  const ids = await safe(async () => (await pool.query(
    `select distinct tournament_id from tournament_battles
      where player_a = $1 or player_b = $1
      limit ${ASK_MAX_STANDINGS}`,
    [userId],
  )).rows.map((row: any) => String(row.tournament_id)), [] as string[])
  if (!ids.length) return ''

  const lines: string[] = []
  for (const tournamentId of ids) {
    const battles = await safe(async () => (await pool.query(
      'select player_a, player_b, winner, round from tournament_battles where tournament_id = $1',
      [tournamentId],
    )).rows, [] as any[])
    if (!battles.length) continue
    const name = await safe(async () => trim(
      (await pool.query('select name from tournaments where id = $1', [tournamentId])).rows[0]?.name,
      80,
    ), '')
    const leaders = bracketLeaders(battles as any)
    const decided = battles.filter((row: any) => row.winner != null && row.winner !== '').length
    const named = await usernames(pool, leaders)
    const who = leaders.map((id) => named.get(String(id)) ?? 'a player').join(', ')
    lines.push(
      `"${name || 'a tournament'}": ${decided}/${battles.length} matches decided` +
      (who ? `, furthest advanced: ${who}` : ''),
    )
  }
  return lines.length ? `Bracket standings — ${lines.join('; ')}.` : ''
}

/** PRIVATE — which white-label league(s) this player belongs to. */
export async function myLeagueContext(pool: Pooly, userId: string | null): Promise<string> {
  if (!userId) return ''
  const rows = await safe(async () => (await pool.query(
    `select l.slug, l.name, m.role
       from league_members m join leagues l on l.id = m.league_id
      where m.user_id = $1
      order by m.joined_at desc
      limit 3`,
    [userId],
  )).rows, [] as any[])
  if (!rows.length) return ''
  const leagues = rows.map((row: any) =>
    `${trim(row.name, 60)} (${trim(row.slug, 40)}, ${trim(row.role, 20) || 'member'})`)
  return `The player's leagues: ${leagues.join(', ')}.`
}

/**
 * PRIVATE — the player's OWN library: the reels they made and the artifacts
 * they forged, including the paid Forge extras so "what powers does my artifact
 * have?" is answerable. Everything is scoped by user_id / owner_id.
 */
export async function myLibraryContext(pool: Pooly, userId: string | null): Promise<string> {
  if (!userId) return ''
  const bits: string[] = []

  const reels = await safe(async () => (await pool.query(
    `select title, created_at from reels
      where user_id = $1 order by created_at desc limit ${ASK_MAX_REELS}`,
    [userId],
  )).rows, [] as any[])
  if (reels.length) {
    const titles = reels
      .map((row: any) => trim(row.title, 60) || 'untitled reel')
      .join(', ')
    bits.push(`recent reels: ${titles}`)
  }

  const produced = await safe(async () => Number((await pool.query(
    `select count(distinct composite_youtube_id)::int n from clip_records
      where player_id = $1 and composite_youtube_id is not null`,
    [userId],
  )).rows[0]?.n ?? 0), 0)
  if (produced) bits.push(`produced multi-angle videos they appear in: ${produced}`)

  const artifacts = await safe(async () => (await pool.query(
    `select name, rarity, capability, price_cents, powers, shirt_ref
       from artifacts where owner_id = $1
      order by created_at desc limit ${ASK_MAX_ARTIFACTS}`,
    [userId],
  )).rows, [] as any[])
  if (artifacts.length) {
    const described = artifacts.map((row: any) => {
      const extras: string[] = []
      let powerCount = 0
      try {
        const raw = typeof row.powers === 'string' ? JSON.parse(row.powers) : row.powers
        if (Array.isArray(raw)) powerCount = raw.filter((p: any) => p && p.name).length
      } catch { powerCount = 0 }
      if (powerCount) extras.push(`${powerCount} power${powerCount === 1 ? '' : 's'}`)
      if (row.price_cents != null) extras.push(`$${(Number(row.price_cents) / 100).toFixed(2)}`)
      if (row.shirt_ref) extras.push('bundled shirt')
      return `${trim(row.name, 60) || 'artifact'} (${trim(row.rarity, 20) || 'common'}` +
        (extras.length ? `, ${extras.join(', ')}` : '') + ')'
    })
    bits.push(`forged artifacts: ${described.join('; ')}`)
  }

  return bits.length ? `The player's own library — ${bits.join('. ')}.` : ''
}

/**
 * Everything Ask TKO knows about tournaments, leagues and the caller's own
 * things, assembled in one pass. `userId` null = signed out, which yields the
 * public tournament board and nothing else.
 */
export async function buildAskContext(pool: Pooly, userId: string | null): Promise<string> {
  const [open, mine, standings, league, library] = await Promise.all([
    openTournamentsContext(pool).catch(() => ''),
    myTournamentsContext(pool, userId).catch(() => ''),
    myStandingsContext(pool, userId).catch(() => ''),
    myLeagueContext(pool, userId).catch(() => ''),
    myLibraryContext(pool, userId).catch(() => ''),
  ])
  return [open, mine, standings, league, library].filter(Boolean).join('\n')
}
