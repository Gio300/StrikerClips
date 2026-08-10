/* eslint-disable @typescript-eslint/no-explicit-any */
// =============================================================================
// ASK TKO GROUNDING — server/askContext.ts
//
// Ask TKO could not previously name a single tournament, say whether the asking
// player was in one, or see the reels and artifacts they own. These tests hold
// that new context to two promises:
//   1. IT IS THERE — the live tournament board, the caller's own entries and
//      matches, their standings, their league, and their own library all reach
//      the prompt as compact lines.
//   2. IT IS THEIRS ONLY — nothing another member owns or entered ever appears
//      in the asking player's context, and a signed-out caller gets the public
//      board and nothing personal.
// =============================================================================
import { beforeAll, describe, expect, it } from 'vitest'
import { makeDb } from './testHarness'
import {
  buildAskContext,
  myLeagueContext,
  myLibraryContext,
  myStandingsContext,
  myTournamentsContext,
  openTournamentsContext,
} from './askContext'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('Ask TKO grounding context', () => {
  const pool = makeDb()
  const me = uuid(1)
  const rival = uuid(2)
  const stranger = uuid(3)
  let openId = ''
  let closedId = ''

  beforeAll(async () => {
    for (const [id, name] of [[me, 'askme'], [rival, 'askrival'], [stranger, 'askstranger']] as const) {
      await pool.query('insert into users (id, email) values ($1,$2)', [id, `${name}@tko.cam`])
      await pool.query('insert into profiles (id, username, power_level) values ($1,$2,7)', [id, name])
    }

    openId = (await pool.query(
      `insert into tournaments (name, created_by, format, status, league_slug, start_at, end_at)
       values ('Shinobi Open',$1,'standard','open','ssl','2026-09-01','2026-09-30') returning id`,
      [rival],
    )).rows[0].id
    closedId = (await pool.query(
      `insert into tournaments (name, created_by, status, end_at)
       values ('Finished Cup',$1,'closed','2026-01-01') returning id`,
      [rival],
    )).rows[0].id
    // A tournament ONLY the stranger entered — must never leak into my context.
    const strangerCup = (await pool.query(
      `insert into tournaments (name, created_by, status, end_at)
       values ('Stranger Cup',$1,'open','2026-12-01') returning id`,
      [stranger],
    )).rows[0].id

    await pool.query(
      `insert into tournament_entrants (tournament_id, user_id, status) values
       ($1,$2,'accepted'),($1,$3,'accepted'),($4,$5,'accepted')`,
      [openId, me, rival, strangerCup, stranger],
    )
    await pool.query(
      `insert into tournament_battles (tournament_id, player_a, player_b, round, bracket_slot, status)
       values ($1,$2,$3,1,0,'scheduled')`,
      [openId, me, rival],
    )
    await pool.query(
      `insert into tournament_battles (tournament_id, player_a, player_b, round, bracket_slot, status, winner)
       values ($1,$2,$3,1,1,'complete',$3)`,
      [openId, stranger, rival],
    )

    const leagueId = (await pool.query(
      `insert into leagues (slug, name) values ('ssl','Shinobi Striker League') returning id`,
    )).rows[0].id
    await pool.query(
      `insert into league_members (league_id, user_id, role) values ($1,$2,'owner')`,
      [leagueId, me],
    )

    await pool.query(
      `insert into reels (user_id, title) values ($1,'My Best Knockouts')`,
      [me],
    )
    await pool.query(
      `insert into reels (user_id, title) values ($1,'Rival Secret Reel')`,
      [rival],
    )
    await pool.query(
      `insert into artifacts (owner_id, slug, name, rarity, powers, price_cents, shirt_ref)
       values ($1,'forged','Kunai of Proof','legendary',$2,4200,'shirt-1')`,
      [me, JSON.stringify([{ name: 'Shadow Step', description: 'Blink behind the target.' }])],
    )
    await pool.query(
      `insert into artifacts (owner_id, slug, name, rarity) values ($1,'forged','Rival Relic','epic')`,
      [rival],
    )
  })

  it('lists the tournaments that are actually running, with entrant counts', async () => {
    const context = await openTournamentsContext(pool as any)
    expect(context).toContain('Shinobi Open')
    expect(context).toContain('league ssl')
    expect(context).toContain('ends 2026-09-30')
    expect(context).toContain('2 accepted entrants')
    // Closed tournaments are not "on the board".
    expect(context).not.toContain('Finished Cup')
    expect(closedId).toBeTruthy()
  })

  it('reports the caller’s OWN entries and their next match by opponent name', async () => {
    const context = await myTournamentsContext(pool as any, me)
    expect(context).toContain('entered "Shinobi Open"')
    expect(context).toContain('entry accepted')
    expect(context).toContain('vs askrival')
    // The stranger's tournament is not mine.
    expect(context).not.toContain('Stranger Cup')
  })

  it('says plainly when the player has entered nothing', async () => {
    const context = await myTournamentsContext(pool as any, stranger)
    expect(context).toContain('Stranger Cup')
    const empty = await myTournamentsContext(pool as any, uuid(9))
    expect(empty).toBe('This player has not entered any tournament yet.')
  })

  it('summarises bracket standings for the brackets the caller is on', async () => {
    const context = await myStandingsContext(pool as any, me)
    expect(context).toContain('Shinobi Open')
    expect(context).toContain('1/2 matches decided')
    expect(context).toContain('askrival')
  })

  it('names the caller’s league', async () => {
    const context = await myLeagueContext(pool as any, me)
    expect(context).toContain('Shinobi Striker League')
    expect(context).toContain('owner')
    expect(await myLeagueContext(pool as any, rival)).toBe('')
  })

  it('describes the caller’s own reels and forged artifacts, extras included', async () => {
    const context = await myLibraryContext(pool as any, me)
    expect(context).toContain('My Best Knockouts')
    expect(context).toContain('Kunai of Proof')
    expect(context).toContain('1 power')
    expect(context).toContain('$42.00')
    expect(context).toContain('bundled shirt')
    // Another member's reel/artifact never appears in my library.
    expect(context).not.toContain('Rival Secret Reel')
    expect(context).not.toContain('Rival Relic')
  })

  it('gives a signed-out caller the public board and nothing personal', async () => {
    const context = await buildAskContext(pool as any, null)
    expect(context).toContain('Shinobi Open')
    expect(context).not.toContain('My Best Knockouts')
    expect(context).not.toContain('Kunai of Proof')
    expect(context).not.toContain('entered "')
    expect(context).not.toContain('Shinobi Striker League')
  })

  it('assembles one compact briefing rather than a database dump', async () => {
    const context = await buildAskContext(pool as any, me)
    expect(context).toContain('Tournaments on the board right now')
    expect(context).toContain("The signed-in player's own tournament activity")
    expect(context).toContain("The player's own library")
    // A briefing, not a dump: a handful of lines, not thousands of characters.
    expect(context.length).toBeLessThan(4000)
  })

  it('degrades to a partial briefing when a table is missing', async () => {
    const brokenPool = {
      query: async (sql: string, params?: any[]) => {
        if (/from reels|from artifacts|from league_members/i.test(sql)) {
          throw new Error('relation does not exist')
        }
        return (pool as any).query(sql, params)
      },
    }
    const context = await buildAskContext(brokenPool as any, me)
    expect(context).toContain('Shinobi Open')
    expect(context).toContain('entered "Shinobi Open"')
    expect(context).not.toContain('Kunai of Proof')
  })
})
