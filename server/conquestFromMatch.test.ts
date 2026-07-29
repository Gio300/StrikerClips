/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { newDb } from 'pg-mem'
import { recordMatchToConquest } from './conquestFromMatch'

function db() {
  const mem = newDb()
  mem.public.none(`
    create table territories (id text primary key, name text, owner_clan_id text, captured_at timestamptz);
    create table clan_battles (id serial primary key, winner_clan_id text, loser_clan_id text, match_key text, territory_id text, created_at timestamptz default now());
    create table clan_alliances (id serial primary key, clan_id text, ally_clan_id text);
    create table clan_members (id serial primary key, user_id text, clan_id text, server_id text);
    create table clip_records (id text primary key, player_id text, outcome text, composite_youtube_id text);
    insert into territories (id, name, owner_clan_id) values ('t1','Leaf','clan-sand');
    insert into clan_members (user_id, clan_id) values ('p1','clan-leaf'), ('p2','clan-sand');
    insert into clip_records (id, player_id, outcome) values ('c1','p1','victory'), ('c2','p2','defeat');
  `)
  return new (mem.adapters.createPg().Pool)()
}

describe('recordMatchToConquest (auto-merge → map)', () => {
  let pool: any
  beforeEach(() => { pool = db() })

  it('records a verified clan-vs-clan result over the loser\'s land', async () => {
    const r = await recordMatchToConquest(pool, ['c1', 'c2'], 'comp1')
    expect(r.applied).toBe(true)
    // one verified win isn't enough to capture yet, but it's logged
    expect(r.captured).toBe(false)
    const battles = (await pool.query('select winner_clan_id, loser_clan_id, territory_id from clan_battles')).rows
    expect(battles).toHaveLength(1)
    expect(battles[0].winner_clan_id).toBe('clan-leaf')
    expect(battles[0].loser_clan_id).toBe('clan-sand')
    expect(battles[0].territory_id).toBe('t1')
  })

  it('is idempotent on the composite id (one produced video = one battle)', async () => {
    await recordMatchToConquest(pool, ['c1', 'c2'], 'comp1')
    const again = await recordMatchToConquest(pool, ['c1', 'c2'], 'comp1')
    expect(again.applied).toBe(false)
    expect((await pool.query('select count(*)::int n from clan_battles')).rows[0].n).toBe(1)
  })

  it('skips a match with no tagged winner', async () => {
    await pool.query(`update clip_records set outcome=null`)
    const r = await recordMatchToConquest(pool, ['c1', 'c2'], 'comp2')
    expect(r.applied).toBe(false)
    expect(r.reason).toContain('winner')
  })

  it('skips when it is not a two-clan match', async () => {
    await pool.query(`update clan_members set clan_id='clan-leaf' where user_id='p2'`)
    const r = await recordMatchToConquest(pool, ['c1', 'c2'], 'comp3')
    expect(r.applied).toBe(false)
    expect(r.reason).toContain('two-clan')
  })
})
