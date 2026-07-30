/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest'
import { newDb } from 'pg-mem'
import { creditProduced } from './creditProduced'

function db() {
  const mem = newDb()
  mem.public.none(`
    create table profiles (id text primary key, username text, power_level integer default 0);
    create table user_youtube_links (id serial primary key, user_id text, url text);
    create table clip_records (
      id serial primary key, player_id text, composite_youtube_id text,
      youtube_id text, outcome text, recorded_at timestamptz default now()
    );
    insert into profiles (id, username) values ('u-gio','gio'), ('u-jerry','mrjerry');
    insert into user_youtube_links (user_id, url) values
      ('u-gio','https://www.youtube.com/@gio'),
      ('u-jerry','https://www.youtube.com/@MrJerrySS');
  `)
  return new (mem.adapters.createPg().Pool)()
}

/** Same shape/weights as server/app.ts recomputePower, run against pg-mem. */
async function recompute(pool: any, playerId: string): Promise<number> {
  const r = await pool.query(
    `select
       coalesce(sum(case when outcome='victory' then 1 else 0 end),0) as wins,
       coalesce(sum(case when outcome='defeat' then 1 else 0 end),0)  as losses,
       coalesce(sum(case when outcome is null or outcome='draw' then 1 else 0 end),0) as neutral,
       count(distinct case when composite_youtube_id is not null then composite_youtube_id end) as produced
     from clip_records where player_id=$1`,
    [playerId],
  )
  const row = r.rows[0] || {}
  const power = Math.max(
    0,
    Number(row.wins) * 250 - Number(row.losses) * 75 + Number(row.neutral) * 100 + Number(row.produced) * 150,
  )
  await pool.query('update profiles set power_level=$1 where id=$2', [power, playerId])
  return power
}

describe('creditProduced (auto-merge → power level)', () => {
  let pool: any
  beforeEach(() => { pool = db() })

  it('resolves players by connected YouTube handle and credits power', async () => {
    const r = await creditProduced(pool, 'comp-1', [
      { handle: 'gio' },
      { handle: '@mrjerryss' }, // case + @ insensitive
    ], recompute)
    expect(r.unresolved).toHaveLength(0)
    expect(r.credited).toHaveLength(2)
    // A produced video with no tagged result = neutral (+100) + produced (+150) = 250.
    const gio = r.credited.find((c) => c.user_id === 'u-gio')!
    expect(gio.power).toBe(250)
    expect(gio.created).toBe(true)
    expect(gio.clip_record_id).toBeTruthy()
    const pl = (await pool.query(`select power_level from profiles where id='u-gio'`)).rows[0].power_level
    expect(pl).toBe(250)
  })

  it('is idempotent per (player, video) — re-running never double-credits', async () => {
    await creditProduced(pool, 'comp-1', [{ handle: 'gio' }], recompute)
    const again = await creditProduced(pool, 'comp-1', [{ handle: 'gio' }], recompute)
    expect(again.credited[0].created).toBe(false)
    const n = (await pool.query(`select count(*)::int n from clip_records where player_id='u-gio'`)).rows[0].n
    expect(n).toBe(1)
    // Two DIFFERENT videos DO stack (150 each produced + 100 neutral each).
    await creditProduced(pool, 'comp-2', [{ handle: 'gio' }], recompute)
    const pl = (await pool.query(`select power_level from profiles where id='u-gio'`)).rows[0].power_level
    expect(pl).toBe(500)
  })

  it('fills in an outcome that arrives after the initial credit', async () => {
    await creditProduced(pool, 'comp-1', [{ handle: 'gio' }], recompute) // neutral → 250
    const r = await creditProduced(pool, 'comp-1', [{ handle: 'gio', outcome: 'victory' }], recompute)
    // now victory(+250) + produced(+150) = 400
    expect(r.credited[0].power).toBe(400)
  })

  it('uses the channel_id → owner override when there is no handle row', async () => {
    const r = await creditProduced(
      pool, 'comp-3',
      [{ channel_id: 'UCkissa', source_youtube_id: 'raw9' }],
      recompute,
      { UCkissa: 'u-kissa-new' },
    )
    expect(r.credited).toHaveLength(1)
    expect(r.credited[0].user_id).toBe('u-kissa-new')
  })

  it('reports unresolved angles instead of crediting a stranger', async () => {
    const r = await creditProduced(pool, 'comp-4', [{ handle: 'nobody_here' }], recompute)
    expect(r.credited).toHaveLength(0)
    expect(r.unresolved).toHaveLength(1)
  })
})
