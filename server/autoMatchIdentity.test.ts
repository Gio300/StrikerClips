/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { entitleForAutoMerge, makeDb } from './testHarness'

const ADULT_DOB = '1995-06-15'

type Player = { id: string; token: string }

async function signUp(app: any, name: string): Promise<Player> {
  const nonce = `${name}_${Math.random().toString(36).slice(2)}`
  const response = await request(app).post('/api/auth/signup').send({
    email: `${nonce}@tko.cam`,
    password: 'password123',
    username: nonce,
    date_of_birth: ADULT_DOB,
  })
  expect(response.status).toBe(200)
  return { id: response.body.user.id, token: response.body.token }
}

async function addClip(
  app: any,
  player: Player,
  values: Record<string, unknown>,
): Promise<string> {
  const response = await request(app)
    .post('/api/db')
    .set('Authorization', `Bearer ${player.token}`)
    .send({
      table: 'clip_records',
      action: 'insert',
      single: true,
      values: { player_id: player.id, ...values },
    })
  expect(response.status).toBe(200)
  return response.body.data.id
}

function autoMatch(app: any, player: Player, clipRecordId: string) {
  return request(app)
    .post('/api/fn/auto-match')
    .set('Authorization', `Bearer ${player.token}`)
    .send({ clipRecordId })
}

describe('auto-match identity regressions', () => {
  it('rejects a different game even when an incomplete clip transitively bridges the groups', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const alice = await signUp(app, 'alice')
    const bob = await signUp(app, 'bob')
    const carol = await signUp(app, 'carol')
    await entitleForAutoMerge(pool, bob.id)
    await entitleForAutoMerge(pool, carol.id)
    for (const player of [alice, bob, carol]) {
      await pool.query("update profiles set reel_usage_privacy='anyone' where id=$1", [player.id])
    }

    const started = Date.parse('2026-07-26T18:00:00Z')
    const aliceClip = await addClip(app, alice, {
      player_handle: 'alice',
      lobby_id: 'match-one',
      participants: ['bridge-player'],
      map: 'Hidden Cloud',
      mode: 'combat',
      score_line: '3-1',
      recorded_at: new Date(started).toISOString(),
      duration_sec: 300,
    })
    const bobClip = await addClip(app, bob, {
      player_handle: 'bob',
      lobby_id: 'match-one',
      participants: ['bridge-player'],
      map: 'Hidden Cloud',
      mode: 'combat',
      score_line: '3-1',
      recorded_at: new Date(started + 20_000).toISOString(),
      duration_sec: 300,
    })
    expect((await autoMatch(app, bob, bobClip)).body.matched).toBe(true)

    // Simulate a low-confidence analysis row: it still links the two rosters,
    // but it no longer carries the map/lobby evidence that would expose the
    // union-find bridge on its own.
    await pool.query(
      `update clip_records
          set lobby_id=null, map=null, mode=null, score_line=null,
              participants=$1
        where id=$2`,
      [['bridge-player', 'wrong-squad'], bobClip],
    )

    const wrongClip = await addClip(app, carol, {
      player_handle: 'carol',
      lobby_id: 'match-two',
      participants: ['bridge-player', 'wrong-squad'],
      map: 'Hidden Rain',
      mode: 'base',
      score_line: '2-0',
      recorded_at: new Date(started + 40_000).toISOString(),
      duration_sec: 300,
    })
    const result = await autoMatch(app, carol, wrongClip)

    expect(result.status).toBe(200)
    expect(result.body.matched).toBe(false)
    expect(result.body.reason).toMatch(/conflicting|ambiguous/i)
    const clips = await pool.query(
      'select id,match_id from clip_records where id=$1 or id=$2',
      [aliceClip, wrongClip],
    )
    expect(clips.rows.find((row: any) => String(row.id) === wrongClip)?.match_id).toBeNull()
    expect(clips.rows.find((row: any) => String(row.id) === aliceClip)?.match_id).toBeTruthy()
    const job = (await pool.query('select * from render_jobs')).rows[0]
    expect(job.participant_ids).toHaveLength(2)
  })

  it('does not recreate a completed three-player render or produced version on duplicate reruns', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const alice = await signUp(app, 'alice')
    const bob = await signUp(app, 'bob')
    const carol = await signUp(app, 'carol')
    for (const player of [alice, bob, carol]) {
      await entitleForAutoMerge(pool, player.id)
    }

    const started = Date.parse('2026-07-26T20:00:00Z')
    const common = {
      lobby_id: 'stable-version-match',
      participants: ['shared-player'],
      map: 'Hidden Leaf',
      mode: 'combat',
      duration_sec: 300,
    }
    await addClip(app, alice, {
      ...common,
      player_handle: 'alice',
      youtube_id: 'source-alice',
      recorded_at: new Date(started).toISOString(),
    })
    const bobClip = await addClip(app, bob, {
      ...common,
      player_handle: 'bob',
      youtube_id: 'source-bob',
      recorded_at: new Date(started + 20_000).toISOString(),
    })
    expect((await autoMatch(app, bob, bobClip)).body.matched).toBe(true)
    const carolClip = await addClip(app, carol, {
      ...common,
      player_handle: 'carol',
      youtube_id: 'source-carol',
      recorded_at: new Date(started + 40_000).toISOString(),
    })
    expect((await autoMatch(app, carol, carolClip)).body.matched).toBe(true)

    const completed = (await pool.query('select * from render_jobs')).rows[0]
    await pool.query(
      `update render_jobs
          set status='done', youtube_id='produced-three', combined_video_url='https://youtu.be/produced-three'
        where id=$1`,
      [completed.id],
    )
    await pool.query(
      `insert into match_versions
         (match_key,version,youtube_id,angle_count,participant_ids,clip_ids,reason)
       values ($1,1,'produced-three',3,$2,$3,'verified_auto_merge')`,
      [completed.match_key, completed.participant_ids, completed.clip_ids],
    )

    const duplicate = await addClip(app, alice, {
      ...common,
      player_handle: 'alice',
      youtube_id: 'source-alice',
      recorded_at: new Date(started + 10_000).toISOString(),
    })
    const firstRerun = await autoMatch(app, alice, duplicate)
    expect(firstRerun.body.matched).toBe(true)
    expect((await pool.query('select status from render_jobs')).rows[0].status).toBe('done')

    // Queue rows may be archived independently from the immutable version
    // ledger. The ledger must still prevent the same roster from rendering.
    await pool.query('delete from render_jobs')
    const secondRerun = await autoMatch(app, alice, duplicate)
    expect(secondRerun.body.matched).toBe(true)
    expect(Number((await pool.query('select count(*)::int n from render_jobs')).rows[0].n)).toBe(0)
    expect(Number((await pool.query('select count(*)::int n from match_versions')).rows[0].n)).toBe(1)
    expect(Number((await pool.query('select count(*)::int n from match_groups')).rows[0].n)).toBe(1)
  })

  it('accepts a strongly identified partial match angle from a long PS4 upload', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const alice = await signUp(app, 'alice')
    const bob = await signUp(app, 'bob')
    const hammy = await signUp(app, 'hammy')
    await entitleForAutoMerge(pool, bob.id)
    await entitleForAutoMerge(pool, hammy.id)
    for (const player of [alice, bob, hammy]) {
      await pool.query("update profiles set reel_usage_privacy='anyone' where id=$1", [player.id])
    }

    const started = Date.parse('2026-07-26T22:00:00Z')
    const roster = ['alice', 'bob', 'hammy']
    await addClip(app, alice, {
      player_handle: 'alice',
      lobby_id: 'ps4-overlap-match',
      participants: roster,
      map: 'Hidden Sand',
      mode: 'barrier',
      score_line: '2-1',
      recorded_at: new Date(started).toISOString(),
      duration_sec: 300,
    })
    const bobClip = await addClip(app, bob, {
      player_handle: 'bob',
      lobby_id: 'ps4-overlap-match',
      participants: roster,
      map: 'Hidden Sand',
      mode: 'barrier',
      score_line: '2-1',
      recorded_at: new Date(started + 30_000).toISOString(),
      duration_sec: 300,
    })
    const initial = await autoMatch(app, bob, bobClip)
    expect(initial.body.matched).toBe(true)
    const originalMatchId = initial.body.matchId
    await pool.query(`update render_jobs set status='done'`)

    const hammyClip = await addClip(app, hammy, {
      player_handle: 'hammy',
      youtube_id: 'hammy-long-ps4-upload',
      lobby_id: 'ps4-overlap-match',
      participants: roster,
      map: 'Hidden Sand',
      mode: 'barrier',
      score_line: '2-1',
      // The source begins before this match and contains several matches.
      recorded_at: new Date(started - 10 * 60_000).toISOString(),
      duration_sec: 3600,
    })
    const result = await autoMatch(app, hammy, hammyClip)

    expect(result.status).toBe(200)
    expect(result.body.matched).toBe(true)
    expect(result.body.matchId).toBe(originalMatchId)
    expect(result.body.clipCount).toBe(3)
    const stamped = (await pool.query(
      'select match_id from clip_records where id=$1',
      [hammyClip],
    )).rows[0]
    expect(String(stamped.match_id)).toBe(originalMatchId)
    const jobs = await pool.query('select * from render_jobs')
    expect(jobs.rows).toHaveLength(1)
    expect(jobs.rows[0].status).toBe('pending')
    expect(jobs.rows[0].participant_ids).toHaveLength(3)
  })
})
