/* eslint-disable @typescript-eslint/no-explicit-any */
// =============================================================================
// ASK TKO — THE TOOL SURFACE.
//
// server/askContext.ts answers "what should we PUSH into every prompt?". This
// module answers the opposite question: "what can the model PULL when it needs
// it?".
//
// WHY THIS EXISTS. Ask TKO used to be a single-shot call with the whole world
// stuffed into the system prompt: ~31 SQL statements ran on every question, the
// answer was capped at whatever those statements happened to have collected,
// and anything outside that fixed briefing simply did not exist — a player's
// record, a match receipt, a league table, another tournament's bracket. The
// model could not ask for a fact it was not pre-fed, so it either redirected or
// guessed. Guessing a player's win/loss record is the same class of defect as
// the video factory inventing a match outcome, which that codebase already
// refuses to do.
//
// So: fewer pushed facts, and a set of RETRIEVAL tools instead. This is not a
// restriction. It is strictly MORE reach — the assistant can now answer
// questions the old briefing could never cover — for less prompt.
//
// THREE RULES, ALL STRUCTURAL RATHER THAN ADVISORY.
//
//   1. READ-ONLY. Every statement here is a `select`. There is no insert,
//      update, delete or write path in this file, so a model that hallucinates
//      a tool call cannot change anything.
//
//   2. THE CALLER IS THE JWT, NEVER THE MODEL. `AskToolDeps.userId` comes from
//      the authenticated request. NO tool takes a user id as a parameter — the
//      only person-shaped argument any tool accepts is a `username`, which is
//      public identity, and the data returned for another player is limited to
//      what the app already renders publicly (profile card, bracket, promoted
//      reels). Membership tier, wallet, email and payment data are returned for
//      the CALLER ONLY. That is why `my_snapshot` takes no arguments at all: a
//      private read cannot be redirected by anything the model emits.
//
//   3. EMPTY IS AN ANSWER. Every result carries `found`. A miss returns
//      `{ found: false, note: '…' }` rather than nothing, so the model is told
//      in words that the fact does not exist and can say so instead of filling
//      the silence. Ask TKO's system prompt turns that into a hard instruction.
//
// Every query is best-effort in exactly the way askContext.ts is: a table or
// column missing on an older install is caught and degrades that field, never
// the answer.
// =============================================================================
import { bracketLeaders } from '../src/lib/tournamentBracket'
import {
  myLeagueContext,
  myLibraryContext,
  myStandingsContext,
  myTournamentsContext,
  openTournamentsContext,
  type Pooly,
} from './askContext'

export type { Pooly }

/**
 * What a tool run needs. `liveNumbers` / `mySnapshot` are injected rather than
 * imported so this module never depends on server/app.ts (which imports it).
 */
export type AskToolDeps = {
  pool: Pooly
  /** The authenticated caller. '' = signed out. NEVER read from model output. */
  userId: string
  liveNumbers: () => Promise<string>
  mySnapshot: () => Promise<string>
}

/** Hard caps — a tool result is a briefing, not a table dump. */
export const TOOL_MAX_ROWS = 10
export const TOOL_MAX_RECEIPT_PLAYERS = 12
/** Tool rounds the model may take before it must answer. */
export const ASK_MAX_TOOL_ROUNDS = 4

const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try { return await fn() } catch { return fallback }
}

const trim = (value: unknown, max: number): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

const day = (value: unknown): string => {
  if (value == null || value === '') return ''
  const at = new Date(String(value))
  return Number.isFinite(at.getTime()) ? at.toISOString().slice(0, 10) : ''
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A bounded positive integer, however the model chose to spell it. */
export function clampLimit(value: unknown, fallback: number, max = TOOL_MAX_ROWS): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}

/** Model-supplied free text, normalised and capped before it reaches SQL. */
export function cleanArg(value: unknown, max = 80): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/**
 * Same as cleanArg, but ALSO neutralises LIKE metacharacters. Use this for any
 * value interpolated into a `like` pattern; keep cleanArg for display text.
 *
 * Parameterisation stops injection but NOT wildcards -- `%` and `_` are data to
 * the driver and operators to LIKE. Without this, a model that half-hears a name
 * and passes `%` produced `like lower('%%')`, which matched the alphabetically
 * first player and returned their real win/loss ledger with `found: true`. The
 * assistant then reads another person's stats out as fact -- the exact
 * confidently-wrong failure this tool layer exists to prevent, and worse than a
 * miss because nothing looks broken.
 *
 * Backslash is Postgres's default LIKE escape character, so escaping inside the
 * VALUE needs no ESCAPE clause. One pass is safe: each matched character is
 * prefixed, so `\` -> `\\`, `%` -> `\%`, `_` -> `\_`.
 */
export function likeArg(value: unknown, max = 80): string {
  return cleanArg(value, max).replace(/[\\%_]/g, (c) => `\\${c}`)
}

// ─────────────────────────────────────────────────────────────────────────────
//  THE DECLARATIONS
//
//  These descriptions are the routing logic. There is deliberately NO
//  hand-written intent classifier in front of the model — a keyword table that
//  pre-empts the model's choice is exactly the kind of rule that makes an
//  assistant answer LESS. Instead each description says, in plain words, what
//  the tool knows and when to reach for it, and the model picks.
// ─────────────────────────────────────────────────────────────────────────────

export type ToolDeclaration = {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, any>; required?: string[] }
}

const NO_ARGS = { type: 'object' as const, properties: {} }

export const ASK_TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'live_tko_numbers',
    description:
      'Current platform-wide totals for TKO.cam: how many players are registered, how many clans, ' +
      'how many tournaments exist, how many multi-angle videos have been produced, how much of the ' +
      'Shinobi Conquest map is claimed, and which clans hold the most territory. Call this for any ' +
      '"how many …", "how big is …" or "who is winning Conquest" question. Takes no arguments.',
    parameters: NO_ARGS,
  },
  {
    name: 'my_snapshot',
    description:
      "The signed-in player's OWN account: username, power level, membership tier, utility Tokens, " +
      'Give Points, clans they belong to, and their clip win/loss/K.O. totals. Call this whenever the ' +
      'player asks about themselves ("my", "I", "am I", "do I have"). It always describes the person ' +
      'asking and takes no arguments — there is no way to point it at anyone else.',
    parameters: NO_ARGS,
  },
  {
    name: 'my_activity',
    description:
      "The signed-in player's own tournament entries and their approval status, their upcoming " +
      'matches and who they face, the bracket standings of tournaments they are in, the leagues they ' +
      'belong to, and their own reels and forged artifacts. Call this for "what am I entered in", ' +
      '"who do I play next", "what have I made". Takes no arguments.',
    parameters: NO_ARGS,
  },
  {
    name: 'tournament_board',
    description:
      'Every tournament currently on the board, with status, format, league, start and end dates and ' +
      'how many entrants are accepted. Call this for "what tournaments are running", "what can I ' +
      'enter", or before naming any tournament. Takes no arguments.',
    parameters: NO_ARGS,
  },
  {
    name: 'tournament_state',
    description:
      'One named tournament in detail: its exact organizer-published rules, status and dates, how many ' +
      'entrants it has, how far the bracket has been decided, who is furthest advanced, and — if the ' +
      'person asking is in it — their own next match. Call this for any rules question or whenever the ' +
      'player names a specific tournament or acronym. Use ' +
      'tournament_board first if you do not know the exact name.',
    parameters: {
      type: 'object',
      properties: {
        tournament: {
          type: 'string',
          description: 'The tournament name as the player said it, or its id. Partial names match.',
        },
      },
      required: ['tournament'],
    },
  },
  {
    name: 'player_record',
    description:
      'The public card for a named player: power level, their clip record (matches recorded, wins, ' +
      'losses, K.O.s), recent form over their last matches, the clans they are in, how many ' +
      'tournaments they have entered, and the head-to-head between them and the person asking. Call ' +
      'this whenever a specific player is named. It returns only what the app already shows publicly ' +
      "— never another player's tier, wallet, email or payment details.",
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'The player\'s TKO username, as typed.' },
      },
      required: ['username'],
    },
  },
  {
    name: 'tournament_rosters',
    description:
      'Official team rosters entered for tournaments: each roster name, clan, review and lock status, ' +
      'captain, and every listed player with their competition role. Call this whenever someone asks ' +
      'who is on which team, whether a lineup was approved or locked, or what roster they personally ' +
      'belong to. Roster information requires a signed-in caller. A tournament name is optional; use ' +
      'mine_only for the signed-in player\'s own roster memberships.',
    parameters: {
      type: 'object',
      properties: {
        tournament: {
          type: 'string',
          description: 'Tournament name or id. Partial names match. Omit to inspect recent tournament rosters.',
        },
        mine_only: {
          type: 'boolean',
          description: 'True when the player asks which tournament rosters they are on.',
        },
      },
    },
  },
  {
    name: 'match_receipt',
    description:
      'The parsed result of one recorded match: every player in it, which side won and lost, their ' +
      'kills, deaths, assists and score line, the map and mode, how long it ran, and the produced ' +
      'multi-angle video if one exists. This is the ground truth for "what happened in that match" ' +
      '— never state a match result without it. Only readable for matches the person asking played ' +
      'in, or matches whose video has been published.',
    parameters: {
      type: 'object',
      properties: {
        match_id: { type: 'string', description: 'The match id (a uuid).' },
      },
      required: ['match_id'],
    },
  },
  {
    name: 'standings',
    description:
      'The current table of top players by power level, either across all of TKO or inside one ' +
      'white-label league (for example the Shinobi Striker League, slug "ssl"). Call this for ' +
      '"who is number one", "leaderboard", "top players", "league table".',
    parameters: {
      type: 'object',
      properties: {
        league_slug: {
          type: 'string',
          description: 'League slug to rank inside, e.g. "ssl". Omit for the whole platform.',
        },
        limit: { type: 'integer', description: `How many places to return, 1-${TOOL_MAX_ROWS}.` },
      },
    },
  },
  {
    name: 'recent_clips',
    description:
      'The most recent published reels — for one named player, for one league, or across TKO — with ' +
      'their titles and dates. Call this for "what has X posted", "any new videos", "what is on the ' +
      "front page\". The person asking also sees their own unpublished reels; nobody else's are shown.",
    parameters: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Limit to this player\'s reels.' },
        league_slug: { type: 'string', description: 'Limit to this league, e.g. "ssl".' },
        limit: { type: 'integer', description: `How many reels, 1-${TOOL_MAX_ROWS}.` },
      },
    },
  },
]

export const ASK_TOOL_NAMES: string[] = ASK_TOOL_DECLARATIONS.map((t) => t.name)

// ─────────────────────────────────────────────────────────────────────────────
//  THE EXECUTORS
// ─────────────────────────────────────────────────────────────────────────────

export type ToolResult = Record<string, any> & { found: boolean }

const miss = (note: string): ToolResult => ({ found: false, note })

/** `id -> username` for a set of profile ids (public identity only). */
async function usernames(pool: Pooly, ids: unknown[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean).map(String)))
  if (!unique.length) return new Map()
  return safe(async () => {
    const placeholders = unique.map((_, i) => `$${i + 1}`).join(', ')
    const rows = (await pool.query(
      `select id, username from profiles where id in (${placeholders})`, unique,
    )).rows
    return new Map(rows.map((r: any) => [String(r.id), String(r.username ?? 'player')]))
  }, new Map<string, string>())
}

/** Resolve a typed username to a profile, case-insensitively. */
async function findProfile(pool: Pooly, username: string): Promise<any | null> {
  const name = cleanArg(username, 60)
  if (!name) return null
  return safe(async () => {
    const exact = (await pool.query(
      'select id, username, power_level, bio, country from profiles where lower(username) = lower($1) limit 1',
      [name],
    )).rows[0]
    if (exact) return exact
    // People type "@zed" or "Zed " or half a name. One forgiving prefix pass
    // rather than a refusal — but still exactly one row, never a fuzzy list.
    const like = (await pool.query(
      // No explicit ESCAPE clause: backslash is Postgres's default LIKE escape,
      // so likeArg()'s escaping is honoured as-is. (An explicit `escape '\'` is
      // more self-documenting but pg-mem, the in-memory test engine, cannot
      // parse it and fails the whole query -- worse than the default.)
      `select id, username, power_level, bio, country from profiles
        where lower(username) like lower($1) order by username asc limit 1`,
      // likeArg, not the raw name: the trailing % is OURS (a prefix search),
      // but any % or _ the model supplied must stay literal. A bare "%" here
      // used to match the alphabetically first player and hand back their real
      // record as though it were the one asked for.
      [`${likeArg(name.replace(/^@/, ''), 60)}%`],
    )).rows[0]
    return like ?? null
  }, null)
}

/** Clip-record rollup for one player: the win/loss ledger the app already shows. */
async function clipRecord(pool: Pooly, profileId: string) {
  return safe(async () => {
    const row = (await pool.query(
      // `sum(case when …)` rather than `count(*) filter (where …)`. FILTER is
      // standard Postgres but is NOT universally implemented — the in-memory
      // engine the suite runs on silently ignores it and returns the
      // unfiltered count, which reports every match as both a win AND a loss.
      // A record that is quietly wrong is worse than one that is missing, and
      // this is the number the assistant will read aloud.
      `select count(*)::int total,
              coalesce(sum(case when outcome='victory' then 1 else 0 end),0)::int wins,
              coalesce(sum(case when outcome='defeat' then 1 else 0 end),0)::int losses,
              coalesce(sum(kills),0)::int kills,
              coalesce(sum(deaths),0)::int deaths
         from clip_records where player_id = $1`,
      [profileId],
    )).rows[0]
    return {
      matches_recorded: Number(row?.total ?? 0),
      wins: Number(row?.wins ?? 0),
      losses: Number(row?.losses ?? 0),
      knockouts: Number(row?.kills ?? 0),
      deaths: Number(row?.deaths ?? 0),
    }
  }, null)
}

async function toolLiveNumbers(deps: AskToolDeps): Promise<ToolResult> {
  const text = await safe(() => deps.liveNumbers(), '')
  return text
    ? { found: true, summary: text }
    : miss('No platform totals are available right now.')
}

async function toolMySnapshot(deps: AskToolDeps): Promise<ToolResult> {
  if (!deps.userId) return miss('Nobody is signed in, so there is no personal account to read. Tell them to sign in.')
  const text = await safe(() => deps.mySnapshot(), '')
  return text
    ? { found: true, summary: text }
    : miss('This account has no profile data yet.')
}

async function toolMyActivity(deps: AskToolDeps): Promise<ToolResult> {
  const { pool, userId } = deps
  if (!userId) return miss('Nobody is signed in, so there is no personal activity to read. Tell them to sign in.')
  const [mine, standings, league, library] = await Promise.all([
    myTournamentsContext(pool, userId).catch(() => ''),
    myStandingsContext(pool, userId).catch(() => ''),
    myLeagueContext(pool, userId).catch(() => ''),
    myLibraryContext(pool, userId).catch(() => ''),
  ])
  const summary = [mine, standings, league, library].filter(Boolean).join('\n')
  return summary
    ? { found: true, summary }
    : miss('This player has no tournament entries, leagues, reels or artifacts yet.')
}

async function toolTournamentBoard(deps: AskToolDeps): Promise<ToolResult> {
  const summary = await safe(() => openTournamentsContext(deps.pool), '')
  return summary
    ? { found: true, summary }
    : miss('There are no tournaments on the board right now.')
}

async function toolTournamentState(deps: AskToolDeps, args: any): Promise<ToolResult> {
  const { pool, userId } = deps
  const wanted = cleanArg(args?.tournament, 80)
  if (!wanted) return miss('No tournament name was given.')

  const row = await safe(async () => {
    if (UUID.test(wanted)) {
      const byId = (await pool.query(
        `select id, name, rules, status, format, league_slug, start_at, end_at
           from tournaments where id = $1 limit 1`, [wanted],
      )).rows[0]
      if (byId) return byId
    }
    return (await pool.query(
      `select id, name, rules, status, format, league_slug, start_at, end_at
         from tournaments where lower(name) like lower($1)
        order by created_at desc limit 1`,
      // Surrounding % are OURS (a contains search); anything wildcard-ish in
      // `wanted` must stay literal, or "%" matches the newest tournament and
      // reports it confidently as the one the player asked about.
      [`%${likeArg(wanted, 80)}%`],
    )).rows[0] ?? null
  }, null)
  if (!row) {
    return miss(
      `No tournament matching "${wanted}" exists on TKO. Say you cannot find it rather than describing one.`,
    )
  }

  const id = String(row.id)
  const entrants = await safe(async () => Number((await pool.query(
    `select count(*)::int n from tournament_entrants where tournament_id = $1 and status = 'accepted'`,
    [id],
  )).rows[0]?.n ?? 0), 0)
  const battles = await safe(async () => (await pool.query(
    'select player_a, player_b, winner, round, scheduled_at, status from tournament_battles where tournament_id = $1',
    [id],
  )).rows, [] as any[])
  const decided = battles.filter((b: any) => b.winner != null && b.winner !== '').length
  const leaders = battles.length ? bracketLeaders(battles as any) : []
  const named = await usernames(pool, [
    ...leaders,
    ...battles.flatMap((b: any) => [b.player_a, b.player_b]),
  ])

  const result: ToolResult = {
    found: true,
    name: trim(row.name, 80),
    status: trim(row.status, 20) || 'open',
    format: trim(row.format, 24) || 'standard',
    league: trim(row.league_slug, 40) || 'tko',
    starts: day(row.start_at) || 'TBD',
    ends: day(row.end_at) || 'no end time set',
    // Rules are organizer-authored public tournament data (the same text shown
    // on Overview). Bound the payload so one oversized rulebook cannot consume
    // the whole model turn; null means the organizer has not published any.
    rules: String(row.rules ?? '').trim().slice(0, 4_000) || null,
    accepted_entrants: entrants,
    matches_total: battles.length,
    matches_decided: decided,
    furthest_advanced: leaders.map((x) => named.get(String(x)) ?? 'a player'),
  }

  // The caller's own place in it — private only in the sense of "which row we
  // bothered to look up"; the bracket itself is public.
  if (userId) {
    const next = battles.find((b: any) =>
      (String(b.player_a) === userId || String(b.player_b) === userId) &&
      (b.winner == null || b.winner === ''))
    if (next) {
      const opponentId = String(next.player_a) === userId ? next.player_b : next.player_a
      result.your_next_match = {
        round: Number(next.round ?? 1),
        opponent: opponentId ? (named.get(String(opponentId)) ?? 'an unnamed player') : 'a bye',
        scheduled: day(next.scheduled_at) || 'time not set',
      }
    } else {
      result.your_next_match = null
    }
  }
  return result
}

async function toolTournamentRosters(deps: AskToolDeps, args: any): Promise<ToolResult> {
  const { pool, userId } = deps
  if (!userId) {
    return miss('Tournament roster information requires an account. Tell the player to sign in, then ask again.')
  }
  const wanted = cleanArg(args?.tournament, 80)
  const mineOnly = args?.mine_only === true
  let tournament: any | null = null
  if (wanted) {
    tournament = await safe(async () => {
      if (UUID.test(wanted)) {
        const byId = (await pool.query(
          'select id,name,status from tournaments where id=$1 limit 1',
          [wanted],
        )).rows[0]
        if (byId) return byId
      }
      return (await pool.query(
        `select id,name,status from tournaments
          where lower(name) like lower($1) order by created_at desc limit 1`,
        [`%${likeArg(wanted, 80)}%`],
      )).rows[0] ?? null
    }, null)
    if (!tournament) {
      return miss(`No tournament matching "${wanted}" exists. Say you cannot find it rather than naming a roster.`)
    }
  }

  const params: any[] = []
  let mineJoin = ''
  if (mineOnly) {
    params.push(userId)
    mineJoin = `join tournament_roster_members mine
      on mine.tournament_roster_id=r.id and mine.user_id=$${params.length}`
  }
  const where = [`r.status <> 'withdrawn'`]
  if (tournament) {
    params.push(String(tournament.id))
    where.push(`r.tournament_id=$${params.length}`)
  }
  const rows = await safe(async () => (await pool.query(
    `select distinct r.id,r.tournament_id,r.name,r.status,r.version,r.locked_at,
            r.captain_id,t.name as tournament_name,t.status as tournament_status,
            s.name as clan_name,s.clan_tag
       from tournament_rosters r
       ${mineJoin}
       join tournaments t on t.id=r.tournament_id
       left join servers s on s.id=r.clan_id
      where ${where.join(' and ')}
      order by r.updated_at desc limit ${TOOL_MAX_ROWS}`,
    params,
  )).rows, [] as any[])
  if (!rows.length) {
    return miss(
      mineOnly
        ? 'The signed-in player is not listed on any matching tournament roster.'
        : tournament
          ? `${trim(tournament.name, 80)} has no tournament rosters entered yet.`
          : 'No tournament rosters have been entered yet.',
    )
  }

  const rosters = []
  for (const row of rows) {
    const members = await safe(async () => (await pool.query(
      `select m.user_id,m.member_role,p.username
         from tournament_roster_members m
         join profiles p on p.id=m.user_id
        where m.tournament_roster_id=$1
        order by case m.member_role
          when 'captain' then 0 when 'starter' then 1 when 'substitute' then 2 else 3 end,
          lower(p.username)
        limit ${TOOL_MAX_RECEIPT_PLAYERS}`,
      [row.id],
    )).rows, [] as any[])
    rosters.push({
      tournament: trim(row.tournament_name, 80),
      tournament_status: trim(row.tournament_status, 20),
      roster: trim(row.name, 80),
      clan: trim(row.clan_name, 80) || null,
      clan_tag: trim(row.clan_tag, 20) || null,
      review_status: trim(row.status, 24),
      locked: Boolean(row.locked_at),
      version: Number(row.version || 1),
      captain: members.find((member: any) => String(member.user_id) === String(row.captain_id))?.username || null,
      members: members.map((member: any) => ({
        player: trim(member.username, 40),
        role: trim(member.member_role, 20),
      })),
    })
  }
  return {
    found: true,
    scope: tournament ? trim(tournament.name, 80) : mineOnly ? 'the signed-in player\'s rosters' : 'recent tournament rosters',
    rosters,
    note: 'These are official tournament roster snapshots. Report the review and lock status exactly as returned.',
  }
}

async function toolPlayerRecord(deps: AskToolDeps, args: any): Promise<ToolResult> {
  const { pool, userId } = deps
  const asked = cleanArg(args?.username, 60)
  if (!asked) return miss('No player name was given.')
  const profile = await findProfile(pool, asked)
  if (!profile) {
    return miss(
      `No TKO player named "${asked}" exists. Say you cannot find that player rather than guessing at their record.`,
    )
  }
  const id = String(profile.id)
  const isSelf = Boolean(userId) && id === userId

  const [record, clans, entered, recent] = await Promise.all([
    clipRecord(pool, id),
    safe(async () => (await pool.query(
      `select s.name, cm.role from clan_members cm join servers s on s.id = cm.server_id
        where cm.user_id = $1 order by cm.joined_at desc limit 5`, [id],
    )).rows.map((r: any) => `${trim(r.name, 60)} (${trim(r.role, 20) || 'member'})`), [] as string[]),
    safe(async () => Number((await pool.query(
      'select count(*)::int n from tournament_entrants where user_id = $1', [id],
    )).rows[0]?.n ?? 0), 0),
    // RECENT FORM — the last handful of recorded outcomes, newest first, so
    // "are they hot right now" is answered from results instead of vibes.
    safe(async () => (await pool.query(
      `select outcome, mode, map, recorded_at from clip_records
        where player_id = $1 and outcome is not null
        order by recorded_at desc nulls last limit 5`, [id],
    )).rows.map((r: any) => trim(r.outcome, 12) || 'unknown'), [] as string[]),
  ])

  const result: ToolResult = {
    found: true,
    username: trim(profile.username, 40),
    power_level: Number(profile.power_level ?? 0),
    country: trim(profile.country, 40) || null,
    record: record ?? null,
    recent_form_newest_first: recent,
    clans,
    tournaments_entered: entered,
    is_the_person_asking: isSelf,
  }
  if (!isSelf) {
    result.privacy_note =
      'Public card only. This player\'s membership tier, wallet, email and payment details are not readable.'
  }

  // HEAD TO HEAD — how the two of them have actually gone, from the recorded
  // defeat ledger. Only ever the caller vs the named player.
  if (userId && !isSelf) {
    const beats = await safe(async () => {
      const mine = Number((await pool.query(
        'select coalesce(sum(beat_count),0)::int n from shinobi_defeats where user_id = $1 and opponent_id = $2',
        [userId, id],
      )).rows[0]?.n ?? 0)
      const theirs = Number((await pool.query(
        'select coalesce(sum(beat_count),0)::int n from shinobi_defeats where user_id = $1 and opponent_id = $2',
        [id, userId],
      )).rows[0]?.n ?? 0)
      return { you_beat_them: mine, they_beat_you: theirs }
    }, null)
    result.head_to_head = beats && (beats.you_beat_them || beats.they_beat_you)
      ? beats
      : { you_beat_them: 0, they_beat_you: 0, note: 'No recorded matches between the two of you yet.' }
  }
  return result
}

async function toolMatchReceipt(deps: AskToolDeps, args: any): Promise<ToolResult> {
  const { pool, userId } = deps
  const matchId = cleanArg(args?.match_id, 64)
  if (!UUID.test(matchId)) return miss('That is not a valid match id, so there is no receipt to read.')

  const rows = await safe(async () => (await pool.query(
    `select player_id, player_handle, outcome, kills, deaths, assists, score_line,
            map, mode, duration_sec, recorded_at, composite_youtube_id, youtube_id
       from clip_records where match_id = $1
      order by recorded_at asc limit ${TOOL_MAX_RECEIPT_PLAYERS}`,
    [matchId],
  )).rows, [] as any[])
  if (!rows.length) {
    return miss(`No match with id ${matchId} has been recorded. Say the receipt does not exist.`)
  }

  // ACCESS: your own match, or a match whose multi-angle video was published.
  // Anything else is somebody else's private footage record.
  const mine = rows.some((r: any) => userId && String(r.player_id) === userId)
  const published = rows.some((r: any) => r.composite_youtube_id)
  if (!mine && !published) {
    return miss(
      'That match belongs to other players and its video has not been published, so its receipt is not readable. Say you cannot see it.',
    )
  }

  const named = await usernames(pool, rows.map((r: any) => r.player_id))
  const players = rows.map((r: any) => ({
    player: named.get(String(r.player_id)) ?? trim(r.player_handle, 40) ?? 'a player',
    outcome: trim(r.outcome, 12) || 'unrecorded',
    kills: r.kills == null ? null : Number(r.kills),
    deaths: r.deaths == null ? null : Number(r.deaths),
    assists: r.assists == null ? null : Number(r.assists),
    score_line: trim(r.score_line, 40) || null,
  }))
  // MATCH-WIDE FACTS COME FROM WHICHEVER ANGLE RECORDED THEM, not from row 0.
  // Each row is one player's capture, and the detectors do not fill every
  // column on every angle — the map may be read off one player's HUD and the
  // produced video id written onto another. Reading only the first row reports
  // "no video" for a match that has one, which reads as a broken lookup and is
  // exactly the kind of gap that pushes a model back into guessing.
  const firstOf = (key: string): any => {
    for (const row of rows) if (row?.[key] != null && row[key] !== '') return row[key]
    return null
  }
  const seconds = Number(firstOf('duration_sec') ?? 0)
  return {
    found: true,
    match_id: matchId,
    map: trim(firstOf('map'), 60) || null,
    mode: trim(firstOf('mode'), 40) || null,
    played_on: day(firstOf('recorded_at')) || null,
    length_seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    angles_recorded: rows.length,
    players,
    produced_video_id: trim(firstOf('composite_youtube_id'), 40) || null,
    note:
      'These are the parsed per-angle records for this match. Report only what is here; ' +
      'a field that is null was never recorded. An official full-match score needs complete footage.',
  }
}

async function toolStandings(deps: AskToolDeps, args: any): Promise<ToolResult> {
  const { pool } = deps
  const slug = cleanArg(args?.league_slug, 40)
  const limit = clampLimit(args?.limit, 5)

  if (slug) {
    const league = await safe(async () => (await pool.query(
      'select id, name, slug from leagues where lower(slug) = lower($1) limit 1', [slug],
    )).rows[0] ?? null, null)
    if (!league) return miss(`No league with slug "${slug}" exists. Say you cannot find that league.`)
    const rows = await safe(async () => (await pool.query(
      `select p.username, p.power_level from league_members m join profiles p on p.id = m.user_id
        where m.league_id = $1 order by p.power_level desc nulls last, p.username asc limit ${limit}`,
      [league.id],
    )).rows, [] as any[])
    if (!rows.length) return miss(`${trim(league.name, 60)} has no members yet, so there is no table.`)
    return {
      found: true,
      scope: `league ${trim(league.name, 60)} (${trim(league.slug, 40)})`,
      table: rows.map((r: any, i: number) => ({
        place: i + 1, player: trim(r.username, 40), power_level: Number(r.power_level ?? 0),
      })),
      note: 'Ranked by power level, which is what the app ranks by.',
    }
  }

  const rows = await safe(async () => (await pool.query(
    `select username, power_level from profiles
      order by power_level desc nulls last, username asc limit ${limit}`,
  )).rows, [] as any[])
  if (!rows.length) return miss('No players are registered yet.')
  return {
    found: true,
    scope: 'all of TKO',
    table: rows.map((r: any, i: number) => ({
      place: i + 1, player: trim(r.username, 40), power_level: Number(r.power_level ?? 0),
    })),
    note: 'Ranked by power level, which is what the app ranks by.',
  }
}

async function toolRecentClips(deps: AskToolDeps, args: any): Promise<ToolResult> {
  const { pool, userId } = deps
  const limit = clampLimit(args?.limit, 5)
  const slug = cleanArg(args?.league_slug, 40)
  const who = cleanArg(args?.username, 60)

  let ownerId = ''
  let ownerName = ''
  if (who) {
    const profile = await findProfile(pool, who)
    if (!profile) return miss(`No TKO player named "${who}" exists, so there are no reels to list.`)
    ownerId = String(profile.id)
    ownerName = trim(profile.username, 40)
  }

  // VISIBILITY: a reel is listable if it is promoted (the app shows it) or the
  // person asking made it. Another member's unpromoted reel is never listed.
  const params: any[] = []
  const where: string[] = []
  if (ownerId) { params.push(ownerId); where.push(`r.user_id = $${params.length}`) }
  if (slug) { params.push(slug); where.push(`lower(r.league_slug) = lower($${params.length})`) }
  if (userId) {
    params.push(userId)
    where.push(`(coalesce(r.promoted, true) = true or r.user_id = $${params.length})`)
  } else {
    where.push('coalesce(r.promoted, true) = true')
  }

  const rows = await safe(async () => (await pool.query(
    `select r.title, r.created_at, r.user_id, r.league_slug, coalesce(r.promoted, true) as promoted
       from reels r where ${where.join(' and ')}
      order by r.created_at desc limit ${limit}`,
    params,
  )).rows, [] as any[])
  if (!rows.length) {
    return miss(
      ownerName
        ? `${ownerName} has no reels visible to you.`
        : slug ? `No reels have been published in "${slug}".` : 'No reels have been published yet.',
    )
  }

  const named = await usernames(pool, rows.map((r: any) => r.user_id))
  return {
    found: true,
    scope: ownerName ? `${ownerName}'s reels` : slug ? `league ${slug}` : 'all of TKO',
    reels: rows.map((r: any) => ({
      title: trim(r.title, 80) || 'untitled reel',
      by: named.get(String(r.user_id)) ?? 'a player',
      posted: day(r.created_at) || null,
      published: Boolean(r.promoted),
    })),
  }
}

type Executor = (deps: AskToolDeps, args: any) => Promise<ToolResult>

const EXECUTORS: Record<string, Executor> = {
  live_tko_numbers: (deps) => toolLiveNumbers(deps),
  my_snapshot: (deps) => toolMySnapshot(deps),
  my_activity: (deps) => toolMyActivity(deps),
  tournament_board: (deps) => toolTournamentBoard(deps),
  tournament_state: toolTournamentState,
  tournament_rosters: toolTournamentRosters,
  player_record: toolPlayerRecord,
  match_receipt: toolMatchReceipt,
  standings: toolStandings,
  recent_clips: toolRecentClips,
}

/**
 * Run one tool call from the model.
 *
 * NEVER THROWS and never returns undefined: an unknown name, a bad argument or
 * a database that is missing the table all collapse to `{ found: false, note }`,
 * because a tool that errors silently is a tool that invites a guess. The note
 * is written for the model to repeat to the player.
 */
export async function runAskTool(deps: AskToolDeps, name: string, args: unknown): Promise<ToolResult> {
  // hasOwnProperty, NOT a bare index. EXECUTORS is an object literal, so a bare
  // EXECUTORS[name] resolves up Object.prototype: name='constructor' returned
  // the Object function, which passed the truthiness check and was then invoked
  // as `Object(deps, args)` -- returning the ENTIRE deps object, live pg.Pool
  // included. The caller JSON.stringifies a tool result into the functionResponse
  // sent to Vertex, and pg.Pool.options carries user/password/host/
  // connectionString. That is a path from a model-chosen string to database
  // credentials leaving the building. ('toString' was a lesser variant: it
  // returned a bare string where Gemini requires a Struct, surfacing as a 400
  // that reads like an outage.)
  // An own-property check closes the whole class, not just the two known names.
  const key = String(name ?? '')
  const executor = Object.prototype.hasOwnProperty.call(EXECUTORS, key)
    ? EXECUTORS[key]
    : undefined
  if (typeof executor !== 'function') {
    return miss(`There is no "${cleanArg(name, 40)}" tool. Answer from what you already have, or say you do not know.`)
  }
  const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? (args as any) : {}
  try {
    return await executor(deps, safeArgs)
  } catch (e: any) {
    return miss(`That lookup failed (${cleanArg(e?.message, 80) || 'unknown error'}). Say you could not check rather than guessing.`)
  }
}
