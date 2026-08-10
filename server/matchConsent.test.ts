/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { drainQueue, type RenderAndUpload } from './renderWorker'
import { entitleForAutoMerge, makeDb } from './testHarness'

const ADULT_DOB = '1995-06-15'

async function signUp(app: any, label: string) {
  const response = await request(app).post('/api/auth/signup').send({
    email: `${label}_${Math.random()}@tko.cam`,
    password: 'password123',
    username: `${label}_${Math.floor(Math.random() * 1e6)}`,
    date_of_birth: ADULT_DOB,
  })
  expect(response.status).toBe(200)
  return { id: response.body.user.id as string, token: response.body.token as string }
}

async function addClip(app: any, player: any, values: Record<string, any>) {
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
  return response.body.data.id as string
}

async function seedThreePlayerMatch() {
  const pool = makeDb()
  const app = createApp(pool)
  const players = await Promise.all([
    signUp(app, 'alpha'),
    signUp(app, 'bravo'),
    signUp(app, 'charlie'),
  ])
  await entitleForAutoMerge(pool, players[2].id)
  for (const player of players) {
    await pool.query("update profiles set reel_usage_privacy='anyone' where id=$1", [player.id])
  }
  const lobby = `consent-${Math.random()}`
  const started = Date.parse('2026-07-24T18:00:00Z')
  const clips: string[] = []
  for (let index = 0; index < players.length; index++) {
    clips.push(await addClip(app, players[index], {
      player_handle: `player-${index}`,
      lobby_id: lobby,
      youtube_id: `video-${index}`,
      recorded_at: new Date(started + index * 30_000).toISOString(),
      duration_sec: 300,
    }))
  }
  const matched = await request(app)
    .post('/api/fn/auto-match')
    .set('Authorization', `Bearer ${players[2].token}`)
    .send({ clipRecordId: clips[2] })
  expect(matched.status).toBe(200)
  expect(matched.body.clipCount).toBe(3)
  await pool.query(`update render_jobs set ready_at='2000-01-01T00:00:00Z'`)
  return { pool, app, players, matchId: matched.body.matchId as string }
}

let renderNumber = 0
const fakeRender: RenderAndUpload = async () => {
  renderNumber++
  return {
    youtubeId: `consent-video-${renderNumber}`,
    videoUrl: `https://youtu.be/consent-video-${renderNumber}`,
  }
}

describe('recorded match camera consent', () => {
  it('removes one camera, preserves the old upload, and queues a reduced version', async () => {
    const { pool, app, players, matchId } = await seedThreePlayerMatch()
    await drainQueue(pool, fakeRender)
    expect(Number((await pool.query('select count(*)::int n from match_versions')).rows[0].n)).toBe(1)

    const removed = await request(app)
      .post('/api/fn/remove-match-angle')
      .set('Authorization', `Bearer ${players[1].token}`)
      .send({ matchId, reason: 'do not include my recorded camera' })
    expect(removed.status).toBe(200)
    expect(removed.body.remainingAngles).toBe(2)
    expect(removed.body.rerenderQueued).toBe(true)
    expect(removed.body.oldUploadPreserved).toBe(true)

    const job = (await pool.query('select * from render_jobs where match_id=$1', [matchId])).rows[0]
    expect(job.status).toBe('pending')
    expect(job.participant_ids).toHaveLength(2)
    expect(job.youtube_id).toBeNull()

    const angle = (await pool.query(
      'select * from match_angles where match_key=$1 and user_id=$2',
      [matchId, players[1].id],
    )).rows[0]
    expect(angle.status).toBe('removed')
    expect(Number((await pool.query('select count(*)::int n from match_versions')).rows[0].n)).toBe(1)

    await drainQueue(pool, fakeRender)
    const versions = await pool.query('select * from match_versions order by version')
    expect(versions.rows).toHaveLength(2)
    expect(Number(versions.rows[0].angle_count)).toBe(3)
    expect(Number(versions.rows[1].angle_count)).toBe(2)
  })

  it('refuses to edit a game that is actively live', async () => {
    const { pool, app, players, matchId } = await seedThreePlayerMatch()
    await pool.query(
      `insert into live_sessions (host_id,status,match_id) values ($1,'live',$2)`,
      [players[0].id, matchId],
    )
    const response = await request(app)
      .post('/api/fn/remove-match-angle')
      .set('Authorization', `Bearer ${players[0].token}`)
      .send({ matchId })
    expect(response.status).toBe(409)
    expect(response.body.error).toContain('live')
    const angle = (await pool.query(
      'select status from match_angles where match_key=$1 and user_id=$2',
      [matchId, players[0].id],
    )).rows[0]
    expect(angle.status).toBe('active')
  })
})
