import { beforeEach, describe, expect, it } from 'vitest'
import { newDb } from 'pg-mem'
import { POWER_DETECTED_PARTICIPATION, recomputePower } from './power'

function testDb() {
  const mem = newDb()
  mem.public.none(`
    create table profiles (
      id text primary key,
      power_level integer not null default 0,
      oracle_points integer not null default 0
    );
    create table clip_records (
      id text primary key,
      player_id text not null,
      match_id text,
      outcome text,
      composite_youtube_id text,
      score_verification_status text not null default 'legacy',
      source_id text,
      segment_id text,
      youtube_id text
    );
    create table media_sources (
      id text primary key,
      owner_id text not null,
      provider text not null,
      source_kind text not null,
      external_id text,
      status text not null
    );
    create table match_segments (
      id text primary key,
      source_id text not null,
      start_sec numeric not null,
      end_sec numeric not null,
      boundary_confidence real not null,
      first_timer_sec integer
    );
    create table verified_match_player_stats (
      match_group_id text not null,
      profile_id text not null,
      kills integer not null default 0,
      deaths integer not null default 0,
      assists integer not null default 0,
      primary key (match_group_id, profile_id)
    );
    insert into profiles (id,power_level) values ('player',0),('founder',5200);
  `)
  return new (mem.adapters.createPg().Pool)()
}

describe('verified match power', () => {
  let db: any
  beforeEach(() => { db = testDb() })

  it('scores one match once even when it has multiple camera rows', async () => {
    await db.query(`
      insert into clip_records
        (id,player_id,match_id,outcome,composite_youtube_id,score_verification_status) values
        ('a','player','match-1','victory','composite-1','verified'),
        ('b','player','match-1','victory','composite-1','verified')
    `)
    expect(await recomputePower(db, 'player')).toBe(400)
  })

  it('keeps unproven shadow detections out of public power', async () => {
    await db.query(`update profiles set power_level=900 where id='player'`)
    await db.query(`
      insert into clip_records
        (id,player_id,match_id,outcome,composite_youtube_id,score_verification_status) values
        ('a','player','match-1','victory',null,'shadow')
    `)
    expect(await recomputePower(db, 'player')).toBe(900)
  })

  it('preserves a seeded account when there is no scoring activity', async () => {
    expect(await recomputePower(db, 'founder')).toBe(5200)
  })

  it('does not score legacy browser or screenshot outcomes', async () => {
    await db.query(`update profiles set power_level=700 where id='player'`)
    await db.query(`
      insert into clip_records
        (id,player_id,match_id,outcome,score_verification_status)
      values ('legacy','player','manual-match','victory','legacy')
    `)
    expect(await recomputePower(db, 'player')).toBe(700)
  })

  it('awards neutral participation for a strong detected connected-YouTube battle', async () => {
    await db.query(`
      insert into media_sources values
        ('source-1','player','youtube','youtube_upload','video-1','complete');
      insert into match_segments values
        ('segment-1','source-1',120,360,0.84,600);
      insert into clip_records
        (id,player_id,outcome,score_verification_status,source_id,segment_id,youtube_id)
      values ('detected','player','victory','shadow','source-1','segment-1','video-1');
    `)
    expect(await recomputePower(db, 'player')).toBe(POWER_DETECTED_PARTICIPATION)
  })

  it('does not award participation to a direct upload or weak boundary guess', async () => {
    await db.query(`
      insert into media_sources values
        ('direct','player','tko','direct_upload','file-1','complete'),
        ('weak','player','youtube','youtube_live','video-2','complete');
      insert into match_segments values
        ('segment-direct','direct',0,300,0.95,600),
        ('segment-weak','weak',0,300,0.40,600);
      insert into clip_records
        (id,player_id,score_verification_status,source_id,segment_id,youtube_id) values
        ('direct-clip','player','shadow','direct','segment-direct','file-1'),
        ('weak-clip','player','shadow','weak','segment-weak','video-2');
    `)
    expect(await recomputePower(db, 'player')).toBe(0)
  })

  it('adds canonical combat stats once per match to public power', async () => {
    await db.query(`
      insert into verified_match_player_stats values
        ('match-1','player',2,1,3)
    `)
    expect(await recomputePower(db, 'player')).toBe(70)
  })
})
