/* eslint-disable @typescript-eslint/no-explicit-any */
// =============================================================================
// ASK TKO TOOLS — server/askTools.ts
//
// The tools are what let a CHEAP model answer better than an expensive one: it
// stops guessing and looks things up. That only holds if three things are true,
// and these tests hold them:
//
//   1. THE LOOKUP IS REAL — a player's record, a match receipt, a league table
//      and a bracket come back with the actual numbers from the database, not a
//      summary of a summary.
//   2. A MISS SAYS SO — every dead end returns `found: false` with a sentence
//      the model is instructed to repeat. Silence is what makes a model invent
//      a win/loss record, and inventing one is the same defect class as the
//      video factory inventing a match outcome.
//   3. THE MODEL CANNOT REACH ANOTHER PLAYER'S PRIVATE DATA. The caller is the
//      JWT. No tool takes a user id, the personal tools take no arguments at
//      all, and a named player yields their public card and nothing else.
// =============================================================================
import { beforeAll, describe, expect, it } from 'vitest'
import { makeDb } from './testHarness'
import {
  ASK_TOOL_DECLARATIONS,
  ASK_TOOL_NAMES,
  clampLimit,
  cleanArg,
  runAskTool,
  TOOL_MAX_ROWS,
  type AskToolDeps,
} from './askTools'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('Ask TKO tool surface', () => {
  const pool = makeDb()
  const me = uuid(11)
  const rival = uuid(12)
  const stranger = uuid(13)
  const myMatch = uuid(21)
  const publishedMatch = uuid(22)
  const strangersMatch = uuid(23)
  let cupId = ''

  /** Deps for a signed-in caller. `liveNumbers`/`mySnapshot` are injected. */
  const depsFor = (userId: string): AskToolDeps => ({
    pool: pool as any,
    userId,
    liveNumbers: async () => 'Live TKO numbers right now — registered players: 3.',
    mySnapshot: async () => `Private snapshot for the signed-in player only - id ${userId}.`,
  })

  beforeAll(async () => {
    for (const [id, name, power] of [
      [me, 'toolme', 40],
      [rival, 'ToolRival', 90],
      [stranger, 'toolstranger', 10],
    ] as const) {
      await pool.query('insert into users (id, email) values ($1,$2)', [id, `${name}@tko.cam`])
      await pool.query('insert into profiles (id, username, power_level) values ($1,$2,$3)', [id, name, power])
    }

    cupId = (await pool.query(
      `insert into tournaments (name, created_by, rules, format, status, league_slug, start_at, end_at)
       values ('Leaf Village Cup',$1,'Best of three. No mods. Full-match footage is required.','standard','open','ssl','2026-09-01','2026-09-30') returning id`,
      [rival],
    )).rows[0].id
    await pool.query(
      `insert into tournament_entrants (tournament_id, user_id, status) values
       ($1,$2,'accepted'),($1,$3,'accepted')`,
      [cupId, me, rival],
    )
    await pool.query(
      `insert into tournament_battles (tournament_id, player_a, player_b, round, bracket_slot, status)
       values ($1,$2,$3,1,0,'scheduled')`,
      [cupId, me, rival],
    )

    // A record for the rival: two wins, one loss, with recent form.
    await pool.query(
      `insert into clip_records (player_id, match_id, outcome, kills, deaths, assists, map, mode, recorded_at)
       values ($1,$2,'victory',7,2,1,'Hidden Leaf','base',now())`,
      [rival, myMatch],
    )
    await pool.query(
      `insert into clip_records (player_id, match_id, outcome, kills, deaths, map, mode, recorded_at)
       values ($1,$2,'victory',4,3,'Hidden Leaf','base',now())`,
      [rival, publishedMatch],
    )
    await pool.query(
      `insert into clip_records (player_id, match_id, outcome, kills, deaths, recorded_at)
       values ($1,$2,'defeat',1,6,now())`,
      [rival, strangersMatch],
    )
    // My own angle on myMatch — this is what makes its receipt readable to me.
    await pool.query(
      `insert into clip_records (player_id, match_id, outcome, kills, deaths, map, mode, duration_sec, recorded_at)
       values ($1,$2,'defeat',2,7,'Hidden Leaf','base',412,now())`,
      [me, myMatch],
    )
    // A match I was NOT in, with a produced video — public by publication.
    await pool.query(
      `insert into clip_records (player_id, match_id, outcome, kills, composite_youtube_id, recorded_at)
       values ($1,$2,'victory',3,'yt-composite-1',now())`,
      [stranger, publishedMatch],
    )
    // A match I was not in and which was never published — private.
    await pool.query(
      `insert into clip_records (player_id, match_id, outcome, kills, recorded_at)
       values ($1,$2,'defeat',0,now())`,
      [stranger, strangersMatch],
    )

    await pool.query('insert into shinobi_defeats (user_id, opponent_id, beat_count) values ($1,$2,3)', [me, rival])
    await pool.query('insert into shinobi_defeats (user_id, opponent_id, beat_count) values ($1,$2,1)', [rival, me])

    const leagueId = (await pool.query(
      `insert into leagues (slug, name) values ('ssl','Shinobi Striker League') returning id`,
    )).rows[0].id
    await pool.query(
      `insert into league_members (league_id, user_id, role) values ($1,$2,'owner'),($1,$3,'member')`,
      [leagueId, me, rival],
    )

    const clanId = (await pool.query(
      `insert into servers (name, owner_id) values ('Sand Siblings',$1) returning id`, [rival],
    )).rows[0].id
    await pool.query(
      `insert into clan_members (server_id, user_id, role) values ($1,$2,'leader')`, [clanId, rival],
    )
    const rosterId = (await pool.query(
      `insert into tournament_rosters
         (tournament_id,clan_id,name,captain_id,status,version,locked_at,created_by)
       values ($1,$2,'Sand Four',$3,'approved',3,now(),$3) returning id`,
      [cupId, clanId, rival],
    )).rows[0].id
    await pool.query(
      `insert into tournament_roster_members (tournament_roster_id,user_id,member_role) values
       ($1,$2,'captain'),($1,$3,'starter')`,
      [rosterId, rival, me],
    )

    await pool.query(
      `insert into reels (user_id, title, league_slug, promoted) values ($1,'Rival Ult Montage','ssl',true)`,
      [rival],
    )
    await pool.query(
      `insert into reels (user_id, title, promoted) values ($1,'Rival Draft — do not show',false)`,
      [rival],
    )
    await pool.query(
      `insert into reels (user_id, title, promoted) values ($1,'My Private Draft',false)`,
      [me],
    )
  })

  // ── 1. The declarations are what the model routes on ──────────────────────

  it('declares every tool it can execute, and can execute every tool it declares', async () => {
    // A declared-but-missing tool is a dead end the model will keep retrying;
    // an executable-but-undeclared tool is capability nobody can reach.
    for (const name of ASK_TOOL_NAMES) {
      const result = await runAskTool(depsFor(me), name, {})
      expect(result, `${name} returned nothing`).toBeTruthy()
      expect(typeof result.found, `${name} has no found flag`).toBe('boolean')
    }
    expect(new Set(ASK_TOOL_NAMES).size).toBe(ASK_TOOL_NAMES.length)
  })

  it('describes each tool well enough for a model to pick it unaided', () => {
    for (const tool of ASK_TOOL_DECLARATIONS) {
      // The descriptions ARE the routing logic — there is no hand-written
      // classifier in front of the model — so a thin one is a real defect.
      expect(tool.description.length, `${tool.name} description is too thin`).toBeGreaterThan(120)
      expect(tool.parameters.type).toBe('object')
      for (const required of tool.parameters.required ?? []) {
        expect(Object.keys(tool.parameters.properties)).toContain(required)
      }
    }
  })

  it('never accepts a user id as a parameter — the caller is the JWT, not the model', () => {
    // This is the structural privacy guarantee. If a tool ever took an id, a
    // model could be talked into reading somebody else's private rows.
    for (const tool of ASK_TOOL_DECLARATIONS) {
      for (const key of Object.keys(tool.parameters.properties)) {
        expect(key, `${tool.name} exposes ${key}`).not.toMatch(/user_?id|owner_?id|profile_?id|caller/i)
      }
    }
    for (const name of ['my_snapshot', 'my_activity']) {
      const decl = ASK_TOOL_DECLARATIONS.find((t) => t.name === name)!
      expect(Object.keys(decl.parameters.properties)).toEqual([])
    }
  })

  // ── 2. The lookups are real ────────────────────────────────────────────────

  it('reads a named player\'s real record, recent form and head-to-head', async () => {
    const result = await runAskTool(depsFor(me), 'player_record', { username: 'toolrival' })
    expect(result.found).toBe(true)
    expect(result.username).toBe('ToolRival')
    expect(result.power_level).toBe(90)
    expect(result.record).toMatchObject({ matches_recorded: 3, wins: 2, losses: 1, knockouts: 12 })
    expect(result.recent_form_newest_first).toHaveLength(3)
    expect(result.clans).toEqual(['Sand Siblings (leader)'])
    expect(result.tournaments_entered).toBe(1)
    expect(result.head_to_head).toEqual({ you_beat_them: 3, they_beat_you: 1 })
  })

  it('reads one tournament\'s live state and the caller\'s own next match in it', async () => {
    const result = await runAskTool(depsFor(me), 'tournament_state', { tournament: 'leaf village' })
    expect(result.found).toBe(true)
    expect(result.name).toBe('Leaf Village Cup')
    expect(result.status).toBe('open')
    expect(result.league).toBe('ssl')
    expect(result.rules).toBe('Best of three. No mods. Full-match footage is required.')
    expect(result.accepted_entrants).toBe(2)
    expect(result.matches_total).toBe(1)
    expect(result.matches_decided).toBe(0)
    expect(result.your_next_match).toMatchObject({ round: 1, opponent: 'ToolRival' })
  })

  it('returns null for unpublished tournament rules and caps an oversized rulebook', async () => {
    await pool.query(
      `insert into tournaments (name, created_by, rules) values
       ('No Rules Scrim',$1,null),('Huge Rules Cup',$1,$2)`,
      [rival, 'x'.repeat(5_000)],
    )
    const missing = await runAskTool(depsFor(me), 'tournament_state', { tournament: 'no rules scrim' })
    const huge = await runAskTool(depsFor(me), 'tournament_state', { tournament: 'huge rules cup' })
    expect(missing).toMatchObject({ found: true, rules: null })
    expect(huge.rules).toHaveLength(4_000)
  })

  it('reads official tournament rosters, roles, captain, lock and approval state', async () => {
    const result = await runAskTool(depsFor(me), 'tournament_rosters', { tournament: 'leaf village' })
    expect(result.found).toBe(true)
    expect(result.rosters).toHaveLength(1)
    expect(result.rosters[0]).toMatchObject({
      tournament: 'Leaf Village Cup',
      roster: 'Sand Four',
      clan: 'Sand Siblings',
      review_status: 'approved',
      locked: true,
      version: 3,
      captain: 'ToolRival',
      members: [
        { player: 'ToolRival', role: 'captain' },
        { player: 'toolme', role: 'starter' },
      ],
    })

    const mine = await runAskTool(depsFor(me), 'tournament_rosters', { mine_only: true })
    expect(mine.found).toBe(true)
    expect(mine.rosters[0].roster).toBe('Sand Four')
    const notMine = await runAskTool(depsFor(stranger), 'tournament_rosters', { mine_only: true })
    expect(notMine.found).toBe(false)
  })

  it('reads a match receipt with every angle, and never rounds a missing field into a number', async () => {
    const result = await runAskTool(depsFor(me), 'match_receipt', { match_id: myMatch })
    expect(result.found).toBe(true)
    expect(result.angles_recorded).toBe(2)
    expect(result.map).toBe('Hidden Leaf')
    expect(result.length_seconds).toBe(412)
    const players = result.players as any[]
    expect(players.map((p) => p.player).sort()).toEqual(['ToolRival', 'toolme'])
    const rivalRow = players.find((p) => p.player === 'ToolRival')
    expect(rivalRow).toMatchObject({ outcome: 'victory', kills: 7, deaths: 2, assists: 1 })
    // An unrecorded field stays null. A 0 here would be the model reporting a
    // stat nobody measured.
    expect(players.find((p) => p.player === 'toolme')!.assists).toBeNull()
  })

  it('ranks a league table and the whole platform, and honours a sane limit', async () => {
    const league = await runAskTool(depsFor(me), 'standings', { league_slug: 'SSL' })
    expect(league.found).toBe(true)
    expect(league.table).toEqual([
      { place: 1, player: 'ToolRival', power_level: 90 },
      { place: 2, player: 'toolme', power_level: 40 },
    ])

    const global = await runAskTool(depsFor(me), 'standings', { limit: 1 })
    expect(global.found).toBe(true)
    expect(global.table).toHaveLength(1)
    expect((global.table as any[])[0].player).toBe('ToolRival')
  })

  // ── 3. A miss says so, in words ───────────────────────────────────────────

  it('says a player does not exist instead of letting the model imagine their record', async () => {
    const result = await runAskTool(depsFor(me), 'player_record', { username: 'definitely-not-a-player' })
    expect(result.found).toBe(false)
    expect(String(result.note)).toMatch(/no tko player named/i)
    // The note must actually instruct the model, or it will paper over it.
    expect(String(result.note)).toMatch(/rather than guessing/i)
  })

  it('says a tournament does not exist rather than describing a plausible one', async () => {
    const result = await runAskTool(depsFor(me), 'tournament_state', { tournament: 'Chunin Exams' })
    expect(result.found).toBe(false)
    expect(String(result.note)).toMatch(/no tournament matching/i)
  })

  it('turns a bad argument, a missing argument and an unknown tool into a spoken miss, never a throw', async () => {
    for (const [name, args, pattern] of [
      ['match_receipt', { match_id: 'not-a-uuid' }, /not a valid match id/i],
      ['match_receipt', {}, /not a valid match id/i],
      ['player_record', {}, /no player name/i],
      ['tournament_state', { tournament: '   ' }, /no tournament name/i],
      ['standings', { league_slug: 'nope' }, /no league with slug/i],
      ['recent_clips', { username: 'ghost' }, /no tko player named/i],
      ['not_a_real_tool', {}, /there is no "not_a_real_tool" tool/i],
    ] as const) {
      const result = await runAskTool(depsFor(me), name, args)
      expect(result.found, `${name} should have missed`).toBe(false)
      expect(String(result.note)).toMatch(pattern)
    }
  })

  it('survives a model that sends a string, an array or null where an object belongs', async () => {
    for (const args of ['tournament', ['a'], null, undefined, 42] as unknown[]) {
      const result = await runAskTool(depsFor(me), 'player_record', args)
      expect(result.found).toBe(false)
      expect(result.note).toBeTruthy()
    }
  })

  it('tells the model to send a signed-out caller to sign in, rather than returning nothing', async () => {
    for (const name of ['my_snapshot', 'my_activity', 'tournament_rosters']) {
      const result = await runAskTool(depsFor(''), name, {})
      expect(result.found).toBe(false)
      expect(String(result.note)).toMatch(/sign in/i)
    }
  })

  // ── 4. Privacy is structural ──────────────────────────────────────────────

  it('returns another player\'s PUBLIC card only, and says so', async () => {
    const result = await runAskTool(depsFor(me), 'player_record', { username: 'ToolRival' })
    expect(result.is_the_person_asking).toBe(false)
    expect(String(result.privacy_note)).toMatch(/membership tier, wallet, email/i)
    // The shape must not carry a private field at all — a note is not a gate.
    // (The note itself names those words, so it is excluded from the sweep.)
    const { privacy_note: _note, ...data } = result as any
    expect(JSON.stringify(data)).not.toMatch(/tokens|sweeps|email|reelone_tier|user_metadata/i)
  })

  it('refuses a match receipt belonging to other players when its video was never published', async () => {
    const denied = await runAskTool(depsFor(me), 'match_receipt', { match_id: strangersMatch })
    expect(denied.found).toBe(false)
    expect(String(denied.note)).toMatch(/not readable|cannot see/i)
    expect(JSON.stringify(denied)).not.toMatch(/toolstranger/)

    // …but a PUBLISHED match is readable by anyone, because the app already
    // shows that video to everyone.
    const published = await runAskTool(depsFor(me), 'match_receipt', { match_id: publishedMatch })
    expect(published.found).toBe(true)
    expect(published.produced_video_id).toBe('yt-composite-1')
  })

  it('lists published reels for anyone, and unpublished ones only for their own author', async () => {
    const asMe = await runAskTool(depsFor(me), 'recent_clips', { username: 'ToolRival' })
    expect(asMe.found).toBe(true)
    const titles = (asMe.reels as any[]).map((r) => r.title)
    expect(titles).toContain('Rival Ult Montage')
    expect(titles).not.toContain('Rival Draft — do not show')

    const asRival = await runAskTool(depsFor(rival), 'recent_clips', { username: 'ToolRival' })
    expect((asRival.reels as any[]).map((r) => r.title)).toContain('Rival Draft — do not show')

    // A signed-out caller sees published reels and nothing else.
    const signedOut = await runAskTool(depsFor(''), 'recent_clips', {})
    expect((signedOut.reels as any[]).every((r) => r.published)).toBe(true)
  })

  it('cannot be pointed at another player by a my_* tool, because they take no arguments', async () => {
    // The model emitting `{user_id: rival}` must still describe the caller.
    const snapshot = await runAskTool(depsFor(me), 'my_snapshot', { user_id: rival, username: 'ToolRival' })
    expect(snapshot.found).toBe(true)
    expect(String(snapshot.summary)).toContain(me)
    expect(String(snapshot.summary)).not.toContain(rival)
  })

  // ── 5. Argument hygiene ───────────────────────────────────────────────────

  it('clamps a limit however the model spells it', () => {
    expect(clampLimit(3, 5)).toBe(3)
    expect(clampLimit('4', 5)).toBe(4)
    expect(clampLimit(999, 5)).toBe(TOOL_MAX_ROWS)
    expect(clampLimit(-1, 5)).toBe(5)
    expect(clampLimit(0, 5)).toBe(5)
    expect(clampLimit(undefined, 5)).toBe(5)
    expect(clampLimit('nonsense', 5)).toBe(5)
  })

  it('flattens control characters and caps length before an argument reaches SQL', () => {
    expect(cleanArg('  ToolRival\n\t ')).toBe('ToolRival')
    expect(cleanArg('a b')).toBe('a b')
    expect(cleanArg('x'.repeat(500), 10)).toHaveLength(10)
    expect(cleanArg(null)).toBe('')
    expect(cleanArg({ a: 1 })).toBe('[object Object]')
  })

  it('treats a quote-heavy argument as data, not SQL', async () => {
    const result = await runAskTool(depsFor(me), 'player_record', {
      username: "'; drop table profiles; --",
    })
    expect(result.found).toBe(false)
    // The proof the injection did nothing: the table is still there.
    const still = await runAskTool(depsFor(me), 'player_record', { username: 'toolrival' })
    expect(still.found).toBe(true)
  })
})
