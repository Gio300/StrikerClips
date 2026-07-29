/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { newDb } from 'pg-mem'
import { applyConquestBattle } from './conquestBattle'
import { VACATE_MARGIN } from '../src/lib/conquestMechanics'

function db() {
  const mem = newDb()
  mem.public.none(`
    create table territories (
      id text primary key, name text, owner_clan_id text, captured_at timestamptz,
      protected_until timestamptz, protected_by_artifact_id text
    );
    create table clan_battles (id serial primary key, winner_clan_id text, loser_clan_id text, match_key text, territory_id text, created_at timestamptz default now());
    create table clan_alliances (id serial primary key, clan_id text, ally_clan_id text, created_at timestamptz default now());
    create table conquest_artifact_activations (
      id serial primary key, clan_id text not null, effects jsonb not null default '[]',
      status text not null default 'active', expires_at timestamptz
    );
    create table clan_conquest_state (
      clan_id text primary key, rivalry_reset_at timestamptz,
      reset_count integer not null default 0
    );
    insert into territories (id, name) values ('t1','Leaf');
  `)
  const pg = mem.adapters.createPg()
  return new pg.Pool()
}

const LEAF = 'clan-leaf'
const SAND = 'clan-sand'

describe('applyConquestBattle', () => {
  let pool: any
  beforeEach(() => { pool = db() })

  it('claims an UNCLAIMED territory on the first win', async () => {
    const r = await applyConquestBattle(pool, { winnerClanId: LEAF, loserClanId: SAND, territoryId: 't1' })
    expect(r.captured).toBe(true)
    expect(r.reason).toBe('captured')
    const owner = (await pool.query('select owner_clan_id from territories where id=$1', ['t1'])).rows[0].owner_clan_id
    expect(owner).toBe(LEAF)
  })

  it('does NOT flip an occupied land until the challenger nets VACATE_MARGIN wins', async () => {
    // Leaf holds it.
    await pool.query(`update territories set owner_clan_id=$1 where id='t1'`, [LEAF])
    let captured = false
    // Sand beats Leaf VACATE_MARGIN-1 times: still contested, no flip.
    for (let i = 0; i < VACATE_MARGIN - 1; i++) {
      const r = await applyConquestBattle(pool, { winnerClanId: SAND, loserClanId: LEAF, territoryId: 't1' })
      captured = r.captured
      expect(r.reason).toBe('contested')
    }
    expect(captured).toBe(false)
    expect((await pool.query(`select owner_clan_id from territories where id='t1'`)).rows[0].owner_clan_id).toBe(LEAF)
    // One more win reaches the margin → Sand takes the land.
    const win = await applyConquestBattle(pool, { winnerClanId: SAND, loserClanId: LEAF, territoryId: 't1' })
    expect(win.captured).toBe(true)
    expect((await pool.query(`select owner_clan_id from territories where id='t1'`)).rows[0].owner_clan_id).toBe(SAND)
  })

  it('holder wins are defenses and pull the rival margin back down', async () => {
    await pool.query(`update territories set owner_clan_id=$1 where id='t1'`, [LEAF])
    // Sand wins twice, Leaf defends once → net 1, still far from VACATE_MARGIN(3).
    await applyConquestBattle(pool, { winnerClanId: SAND, loserClanId: LEAF, territoryId: 't1' })
    await applyConquestBattle(pool, { winnerClanId: SAND, loserClanId: LEAF, territoryId: 't1' })
    const def = await applyConquestBattle(pool, { winnerClanId: LEAF, loserClanId: SAND, territoryId: 't1' })
    expect(def.reason).toBe('defended')
    // Sand needs (VACATE_MARGIN - net) more; net = 2 - 1 = 1.
    const probe = await applyConquestBattle(pool, { winnerClanId: SAND, loserClanId: LEAF, territoryId: 't1' })
    expect(probe.captured).toBe(false)
    expect(probe.marginToCapture).toBe(VACATE_MARGIN - 2) // net now 2
  })

  it('is idempotent on matchKey', async () => {
    const a = await applyConquestBattle(pool, { winnerClanId: LEAF, loserClanId: SAND, territoryId: 't1', matchKey: 'm1' })
    expect(a.recorded).toBe(true)
    const b = await applyConquestBattle(pool, { winnerClanId: LEAF, loserClanId: SAND, territoryId: 't1', matchKey: 'm1' })
    expect(b.recorded).toBe(false)
    expect(b.reason).toBe('already-recorded')
    const n = (await pool.query('select count(*)::int n from clan_battles')).rows[0].n
    expect(n).toBe(1)
  })

  it('allied clans (a village) do not fight for land — the battle does not count', async () => {
    await pool.query(`update territories set owner_clan_id=$1 where id='t1'`, [LEAF])
    await pool.query(`insert into clan_alliances (clan_id, ally_clan_id) values ($1,$2)`, [LEAF, SAND])
    const r = await applyConquestBattle(pool, { winnerClanId: SAND, loserClanId: LEAF, territoryId: 't1' })
    expect(r.reason).toBe('allied')
    expect(r.recorded).toBe(false)
    // Nothing logged, holder unchanged.
    expect((await pool.query('select count(*)::int n from clan_battles')).rows[0].n).toBe(0)
    expect((await pool.query(`select owner_clan_id from territories where id='t1'`)).rows[0].owner_clan_id).toBe(LEAF)
  })

  it('a defense by the winner who already holds it changes nothing', async () => {
    await pool.query(`update territories set owner_clan_id=$1 where id='t1'`, [LEAF])
    const r = await applyConquestBattle(pool, { winnerClanId: LEAF, loserClanId: SAND, territoryId: 't1' })
    expect(r.captured).toBe(false)
    expect(r.reason).toBe('defended')
  })

  it('does not count an attack against an actively shielded base', async () => {
    await pool.query(
      `update territories
          set owner_clan_id=$1, protected_until=$2
        where id='t1'`,
      [LEAF, new Date(Date.now() + 60_000).toISOString()],
    )
    const r = await applyConquestBattle(pool, {
      winnerClanId: SAND,
      loserClanId: LEAF,
      territoryId: 't1',
    })
    expect(r.reason).toBe('shielded')
    expect(r.recorded).toBe(false)
    expect((await pool.query('select count(*)::int n from clan_battles')).rows[0].n).toBe(0)
  })

  it('uses an active kill-lead artifact in the capture calculation', async () => {
    await pool.query(`update territories set owner_clan_id=$1 where id='t1'`, [LEAF])
    await pool.query(
      `insert into conquest_artifact_activations (clan_id, effects, status, expires_at)
       values ($1,$2,'active',$3)`,
      [
        SAND,
        JSON.stringify([{ kind: 'kill_lead', amount: 3 }]),
        new Date(Date.now() + 60_000).toISOString(),
      ],
    )
    const r = await applyConquestBattle(pool, {
      winnerClanId: SAND,
      loserClanId: LEAF,
      territoryId: 't1',
    })
    expect(r.captured).toBe(true)
    expect(r.ownerClanId).toBe(SAND)
  })
})
