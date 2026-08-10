/* eslint-disable @typescript-eslint/no-explicit-any */
// LIVE ANGLE CONTROL — the host can stop/restart their OWN feed and each
// participant's feed WITHOUT ending the multi-cam session, a dropped feed keeps
// its slot and auto-reconnects, and the top-tier auto live-detect + team
// auto-assemble flows are tier-gated.
//
//  1. Individual STOP/RESTART of a participant angle retains the row (slot kept),
//     and re-adding a stopped player refreshes it in place (no duplicate).
//  2. STOP MY FEED flips host_feed_status only — is_live stays true so the show
//     (and every other angle) survives; restart brings it back.
//  3. A DROPPED feed becomes 'reconnecting' (slot reserved); reconnect flips it
//     back to 'live' once the player's linked stream resolves again.
//  4. live-autostart / live-team-assemble require the TOP tier; autostart pulls
//     the host's connected channel and team-assemble pulls live teammates.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

const ADULT_DOB = '1995-06-15'
type Who = { token: string; id: string }

async function signUp(app: any, name: string): Promise<Who> {
  const r = await request(app).post('/api/auth/signup').send({
    email: `${name}@angle-control.test`,
    password: 'password123',
    username: name,
    date_of_birth: ADULT_DOB,
  })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}

function db(app: any, who: Who | null, body: any) {
  const r = request(app).post('/api/db').send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

function fn(app: any, who: Who | null, name: string, body: any) {
  const r = request(app).post(`/api/fn/${name}`).send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

async function setTier(pool: any, userId: string, tier: string) {
  const current = await pool.query('select user_metadata from users where id=$1', [userId])
  const meta = current.rows[0]?.user_metadata || {}
  meta.reelone_tier = tier
  meta.reelone_tier_expires = null
  await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), userId])
}

async function allowLiveReuse(pool: any, userId: string) {
  await pool.query("update profiles set reel_usage_privacy='lives' where id=$1", [userId])
}

async function startStream(app: any, who: Who) {
  return db(app, who, {
    table: 'live_streams',
    action: 'insert',
    single: true,
    values: { youtube_url: 'https://youtu.be/dQw4w9WgXcQ', title: 'show', placement: 'profile', is_live: true },
  })
}

describe('individual stop / restart / re-add — the show survives', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let host: Who
  let player: Who
  let stranger: Who
  let streamId = ''
  let angleId = ''

  beforeAll(async () => {
    host = await signUp(app, 'ctrl_host')
    player = await signUp(app, 'ctrl_player')
    stranger = await signUp(app, 'ctrl_stranger')
    await setTier(pool, host.id, 'pro')
    await allowLiveReuse(pool, player.id)
    await pool.query('insert into user_youtube_links (user_id, url) values ($1,$2)', [
      player.id, 'https://www.youtube.com/@ctrl_player',
    ])
    const s = await startStream(app, host)
    expect(s.status).toBe(200)
    streamId = s.body.data.id
    const add = await fn(app, host, 'live-angle-add', { liveStreamId: streamId, userId: player.id })
    expect(add.status).toBe(200)
    angleId = add.body.angle.id
  })
  afterAll(async () => { await pool.end() })

  it('stopping one angle keeps the row (slot retained), not a delete', async () => {
    const r = await fn(app, host, 'live-angle-stop', { angleId })
    expect(r.status).toBe(200)
    expect(r.body.angle.status).toBe('stopped')
    const row = await pool.query('select status from live_stream_angles where id=$1', [angleId])
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].status).toBe('stopped')
  })

  it('a non-host cannot stop or restart an angle', async () => {
    const denied = await fn(app, stranger, 'live-angle-stop', { angleId })
    expect(denied.status).toBe(403)
    const denied2 = await fn(app, stranger, 'live-angle-restart', { angleId })
    expect(denied2.status).toBe(403)
  })

  it('restarting re-resolves the player link and flips back to live', async () => {
    await pool.query('update user_youtube_links set url=$1 where user_id=$2', [
      'https://www.youtube.com/@ctrl_player/live', player.id,
    ])
    const r = await fn(app, host, 'live-angle-restart', { angleId })
    expect(r.status).toBe(200)
    expect(r.body.angle.status).toBe('live')
    expect(r.body.angle.youtube_url).toBe('https://www.youtube.com/@ctrl_player/live')
  })

  it('re-adding a stopped player refreshes the SAME row (no duplicate)', async () => {
    await fn(app, host, 'live-angle-stop', { angleId })
    const r = await fn(app, host, 'live-angle-add', { liveStreamId: streamId, userId: player.id })
    expect(r.status).toBe(200)
    const rows = await pool.query('select id from live_stream_angles where live_stream_id=$1 and user_id=$2', [streamId, player.id])
    expect(rows.rows).toHaveLength(1)
  })
})

describe('host stops their OWN feed without ending the session', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let host: Who
  let player: Who
  let streamId = ''

  beforeAll(async () => {
    host = await signUp(app, 'hf_host')
    player = await signUp(app, 'hf_player')
    await setTier(pool, host.id, 'pro')
    await allowLiveReuse(pool, player.id)
    await pool.query('insert into user_youtube_links (user_id, url) values ($1,$2)', [
      player.id, 'https://www.youtube.com/@hf_player',
    ])
    const s = await startStream(app, host)
    streamId = s.body.data.id
    await fn(app, host, 'live-angle-add', { liveStreamId: streamId, userId: player.id })
  })
  afterAll(async () => { await pool.end() })

  it('stop-my-feed sets host_feed_status but leaves is_live=true and the angles intact', async () => {
    const r = await fn(app, host, 'live-host-feed', { liveStreamId: streamId, action: 'stop' })
    expect(r.status).toBe(200)
    const row = await pool.query('select is_live, host_feed_status from live_streams where id=$1', [streamId])
    expect(row.rows[0].is_live).toBe(true)
    expect(row.rows[0].host_feed_status).toBe('stopped')
    // The participant angle is untouched — the session did NOT tear down.
    const angles = await pool.query('select id from live_stream_angles where live_stream_id=$1', [streamId])
    expect(angles.rows.length).toBe(1)
  })

  it('start-my-feed flips host_feed_status back to live', async () => {
    const r = await fn(app, host, 'live-host-feed', { liveStreamId: streamId, action: 'start' })
    expect(r.status).toBe(200)
    const row = await pool.query('select host_feed_status from live_streams where id=$1', [streamId])
    expect(row.rows[0].host_feed_status).toBe('live')
  })

  it('a non-host cannot control the host feed', async () => {
    const denied = await fn(app, player, 'live-host-feed', { liveStreamId: streamId, action: 'stop' })
    expect(denied.status).toBe(403)
  })
})

describe('host show recovery, feed replacement, and full stop', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let host: Who
  let player: Who
  let stranger: Who
  let streamId = ''

  beforeAll(async () => {
    host = await signUp(app, 'recover_host')
    player = await signUp(app, 'recover_player')
    stranger = await signUp(app, 'recover_stranger')
    await setTier(pool, host.id, 'pro')
    await allowLiveReuse(pool, player.id)
    await pool.query('insert into user_youtube_links (user_id, url) values ($1,$2)', [
      player.id, 'https://www.youtube.com/@recover_player/live',
    ])
    const stream = await startStream(app, host)
    streamId = stream.body.data.id
    await fn(app, host, 'live-angle-add', { liveStreamId: streamId, userId: player.id })
  })
  afterAll(async () => { await pool.end() })

  it('lists the server-owned active show so a new device can recover it', async () => {
    const result = await fn(app, host, 'live-session-list', {})
    expect(result.status).toBe(200)
    expect(result.body.streams[0]).toMatchObject({ id: streamId, is_live: true, angle_count: 1 })
  })

  it('refuses session control from anyone except the host', async () => {
    const result = await fn(app, stranger, 'live-session-control', { liveStreamId: streamId, action: 'end' })
    expect(result.status).toBe(403)
    const row = await pool.query('select is_live from live_streams where id=$1', [streamId])
    expect(row.rows[0].is_live).toBe(true)
  })

  it('ends the entire show and stops every retained camera slot', async () => {
    const result = await fn(app, host, 'live-session-control', { liveStreamId: streamId, action: 'end' })
    expect(result.status).toBe(200)
    expect(result.body.stream.is_live).toBe(false)
    const angles = await pool.query('select status from live_stream_angles where live_stream_id=$1', [streamId])
    expect(angles.rows).toHaveLength(1)
    expect(angles.rows[0].status).toBe('stopped')
  })

  it('resumes an ended show, replaces its host feed, and reconnects retained slots', async () => {
    const replacement = 'https://www.youtube.com/@recover_host/live'
    const result = await fn(app, host, 'live-session-control', {
      liveStreamId: streamId,
      action: 'resume',
      youtubeUrl: replacement,
    })
    expect(result.status).toBe(200)
    expect(result.body.stream).toMatchObject({ is_live: true, youtube_url: replacement, host_feed_status: 'live' })
    const angles = await pool.query('select status from live_stream_angles where live_stream_id=$1', [streamId])
    expect(angles.rows[0].status).toBe('reconnecting')
  })
})

describe('a dropped feed keeps its slot and auto-reconnects', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let host: Who
  let player: Who
  let streamId = ''
  let angleId = ''

  beforeAll(async () => {
    host = await signUp(app, 'drop_host')
    player = await signUp(app, 'drop_player')
    await setTier(pool, host.id, 'pro')
    await allowLiveReuse(pool, player.id)
    await pool.query('insert into user_youtube_links (user_id, url) values ($1,$2)', [
      player.id, 'https://www.youtube.com/@drop_player',
    ])
    const s = await startStream(app, host)
    streamId = s.body.data.id
    const add = await fn(app, host, 'live-angle-add', { liveStreamId: streamId, userId: player.id })
    angleId = add.body.angle.id
  })
  afterAll(async () => { await pool.end() })

  it('the angle owner can report their own drop → reconnecting (slot kept)', async () => {
    const r = await fn(app, player, 'live-angle-dropped', { angleId })
    expect(r.status).toBe(200)
    expect(r.body.angle.status).toBe('reconnecting')
    // The slot is reserved — the row is still there, the show still has it.
    const row = await pool.query('select status from live_stream_angles where id=$1', [angleId])
    expect(row.rows[0].status).toBe('reconnecting')
  })

  it('reconnect returns false while the player has no resolvable live link', async () => {
    await pool.query('delete from user_youtube_links where user_id=$1', [player.id])
    const r = await fn(app, host, 'live-angle-reconnect', { angleId })
    expect(r.status).toBe(200)
    expect(r.body.reconnected).toBe(false)
    const row = await pool.query('select status from live_stream_angles where id=$1', [angleId])
    expect(row.rows[0].status).toBe('reconnecting') // still reserved
  })

  it('reconnect flips back to live once the player is streaming again', async () => {
    await pool.query('insert into user_youtube_links (user_id, url) values ($1,$2)', [
      player.id, 'https://www.youtube.com/@drop_player/live',
    ])
    const r = await fn(app, host, 'live-angle-reconnect', { angleId })
    expect(r.status).toBe(200)
    expect(r.body.reconnected).toBe(true)
    expect(r.body.angle.status).toBe('live')
    expect(r.body.angle.youtube_url).toBe('https://www.youtube.com/@drop_player/live')
  })
})

describe('fresh active-live resolution', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let host: Who
  let player: Who
  let streamId = ''
  const playerWatchUrl = 'https://www.youtube.com/watch?v=a1b2c3d4e5F'
  const hostWatchUrl = 'https://www.youtube.com/live=f1e2d3c4b5A'.replace('live=', 'live/')

  beforeAll(async () => {
    host = await signUp(app, 'fresh_host')
    player = await signUp(app, 'fresh_player')
    await setTier(pool, host.id, 'pro')
    await allowLiveReuse(pool, player.id)
    for (const who of [host, player]) {
      await pool.query('insert into user_youtube_links (user_id, url) values ($1,$2)', [
        who.id, `https://www.youtube.com/@${who === host ? 'fresh_host' : 'fresh_player'}`,
      ])
    }
    const stream = await startStream(app, host)
    streamId = stream.body.data.id
    await pool.query(
      `insert into auto_live_discoveries
         (user_id,provider,external_stream_id,channel_url,watch_url,status,detection_method,confidence,last_seen_at)
       values ($1,'youtube',$2,$3,$4,'live','youtube-live-page',0.99,now())`,
      [player.id, 'player-live', 'https://www.youtube.com/@fresh_player', playerWatchUrl],
    )
    await pool.query(
      `insert into auto_live_discoveries
         (user_id,provider,external_stream_id,channel_url,watch_url,status,detection_method,confidence,last_seen_at)
       values ($1,'youtube',$2,$3,$4,'live','youtube-live-page',0.99,now())`,
      [host.id, 'host-live', 'https://www.youtube.com/@fresh_host', hostWatchUrl],
    )
  })
  afterAll(async () => { await pool.end() })

  it('people search add uses the detected watch URL, not the saved channel page', async () => {
    const result = await fn(app, host, 'live-angle-add', { liveStreamId: streamId, userId: player.id })
    expect(result.status).toBe(200)
    expect(result.body.angle.youtube_url).toBe(playerWatchUrl)
  })

  it('repairs every reserved camera from one host-only batch request', async () => {
    await pool.query(
      "update live_stream_angles set youtube_url=$1,status='reconnecting' where live_stream_id=$2 and user_id=$3",
      ['https://www.youtube.com/@fresh_player', streamId, player.id],
    )

    const denied = await fn(app, player, 'live-angle-refresh-all', { liveStreamId: streamId })
    expect(denied.status).toBe(403)

    const result = await fn(app, host, 'live-angle-refresh-all', { liveStreamId: streamId })
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, updated: 1, waiting: 0 })
    expect(result.body.angles).toHaveLength(1)
    expect(result.body.angles[0]).toMatchObject({ youtube_url: playerWatchUrl, status: 'live' })
  })

  it('refreshing angle 1 resolves the host current detected broadcast', async () => {
    const result = await fn(app, host, 'live-host-feed', { liveStreamId: streamId, action: 'start' })
    expect(result.status).toBe(200)
    expect(result.body.stream.youtube_url).toBe(hostWatchUrl)
  })
})

describe('top-tier auto live-detect (live-autostart)', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let top: Who
  let pro: Who

  beforeAll(async () => {
    top = await signUp(app, 'auto_top')
    pro = await signUp(app, 'auto_pro')
    await setTier(pool, top.id, 'creator')
    await setTier(pool, pro.id, 'pro')
    await pool.query('insert into user_youtube_links (user_id, url) values ($1,$2)', [
      top.id, 'https://www.youtube.com/@auto_top',
    ])
    await pool.query('insert into user_youtube_links (user_id, url) values ($1,$2)', [
      pro.id, 'https://www.youtube.com/@auto_pro',
    ])
  })
  afterAll(async () => { await pool.end() })

  it('a non-top-tier host is refused', async () => {
    const r = await fn(app, pro, 'live-autostart', {})
    expect(r.status).toBe(403)
    expect(r.body.reason).toBe('top-tier-only')
  })

  it('a top-tier host goes live from their connected channel with no manual link', async () => {
    const r = await fn(app, top, 'live-autostart', {})
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.stream.is_live).toBe(true)
    expect(r.body.stream.youtube_url).toBe('https://www.youtube.com/@auto_top')
    // A second concurrent autostart is blocked by the same go-live slot guard.
    const again = await fn(app, top, 'live-autostart', {})
    expect(again.status).toBe(409)
  })
})

describe('top-tier team auto-assemble (live-team-assemble)', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let host: Who
  let mateLive: Who
  let mateOffline: Who
  let clanId = ''
  let streamId = ''

  beforeAll(async () => {
    host = await signUp(app, 'team_host')
    mateLive = await signUp(app, 'team_mate_live')
    mateOffline = await signUp(app, 'team_mate_off')
    await setTier(pool, host.id, 'creator')
    await allowLiveReuse(pool, mateLive.id)
    await allowLiveReuse(pool, mateOffline.id)
    // A clan the three share.
    const clan = await pool.query(
      "insert into servers (name, kind) values ('Team', 'clan') returning id",
    )
    clanId = clan.rows[0].id
    for (const u of [host, mateLive, mateOffline]) {
      await pool.query('insert into clan_members (server_id, user_id, role) values ($1,$2,$3)', [clanId, u.id, 'member'])
    }
    // One teammate is currently live (own live_streams row); the other is offline.
    await pool.query(
      "insert into live_streams (user_id, youtube_url, title, placement, is_live) values ($1,$2,'live','profile',true)",
      [mateLive.id, 'https://www.youtube.com/@team_mate_live/live'],
    )
    const s = await startStream(app, host)
    streamId = s.body.data.id
  })
  afterAll(async () => { await pool.end() })

  it('assembles ONLY the teammates who are currently live', async () => {
    const r = await fn(app, host, 'live-team-assemble', { liveStreamId: streamId })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.added).toBe(1)
    const rows = await pool.query('select user_id, youtube_url from live_stream_angles where live_stream_id=$1', [streamId])
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0].user_id).toBe(mateLive.id)
    expect(rows.rows[0].youtube_url).toBe('https://www.youtube.com/@team_mate_live/live')
  })

  it('re-running is idempotent (refreshes the same slot, no duplicate)', async () => {
    const r = await fn(app, host, 'live-team-assemble', { liveStreamId: streamId })
    expect(r.status).toBe(200)
    const rows = await pool.query('select id from live_stream_angles where live_stream_id=$1 and user_id=$2', [streamId, mateLive.id])
    expect(rows.rows).toHaveLength(1)
  })

  it('a non-top-tier host is refused', async () => {
    await setTier(pool, host.id, 'pro')
    const r = await fn(app, host, 'live-team-assemble', { liveStreamId: streamId })
    expect(r.status).toBe(403)
    expect(r.body.reason).toBe('top-tier-only')
  })
})
