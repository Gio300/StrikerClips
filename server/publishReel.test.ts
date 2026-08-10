/* eslint-disable @typescript-eslint/no-explicit-any */
// The reels feed had NO writer the video factory could reach: `reels` is
// insert:'owner' and `promoted` is a PRIVILEGE_COL, so a produced video could
// land on a profile (clip_records) but never in the feed. These prove the new
// service-key route puts it there, exactly once, on the right people.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'
import { reelTitleFor, reelWatchUrl, reelYouTubeId } from './publishReel'

const SERVICE_KEY = 'publish-reel-route-test-key'
const ADULT_DOB = '1995-06-15'
let previousServiceKey: string | undefined

beforeEach(() => {
  previousServiceKey = process.env.TKO_SERVICE_KEY
  process.env.TKO_SERVICE_KEY = SERVICE_KEY
})

afterEach(() => {
  if (previousServiceKey === undefined) delete process.env.TKO_SERVICE_KEY
  else process.env.TKO_SERVICE_KEY = previousServiceKey
})

async function signUp(app: any, username: string): Promise<string> {
  const response = await request(app).post('/api/auth/signup').send({
    email: `${username}@tko.cam`,
    password: 'password123',
    username,
    date_of_birth: ADULT_DOB,
  })
  expect(response.status).toBe(200)
  return response.body.user.id
}

function publish(app: any, body: Record<string, unknown>) {
  return request(app)
    .post('/api/internal/publish-reel')
    .set('x-tko-service', SERVICE_KEY)
    .send(body)
}

/** Exactly the read src/pages/Reels.tsx makes, with NO auth header at all. */
async function feedReels(app: any): Promise<any[]> {
  const read = await request(app).post('/api/db').send({ table: 'reels', action: 'select' })
  expect(read.status).toBe(200)
  return (read.body.data as any[]).filter((r) => r.promoted !== false)
}

describe('publishReel helpers', () => {
  it('accepts a bare id, a watch url and a youtu.be link as the same video', () => {
    expect(reelYouTubeId('mJ-zg4bnQ8w')).toBe('mJ-zg4bnQ8w')
    expect(reelYouTubeId('https://www.youtube.com/watch?v=mJ-zg4bnQ8w')).toBe('mJ-zg4bnQ8w')
    expect(reelYouTubeId('https://youtu.be/mJ-zg4bnQ8w')).toBe('mJ-zg4bnQ8w')
    expect(reelYouTubeId('https://www.youtube.com/shorts/mJ-zg4bnQ8w')).toBe('mJ-zg4bnQ8w')
    expect(reelYouTubeId('not a video')).toBe('')
    expect(reelWatchUrl('mJ-zg4bnQ8w')).toBe('https://www.youtube.com/watch?v=mJ-zg4bnQ8w')
  })

  it('titles a reel from the cast when the caller sent none', () => {
    expect(reelTitleFor('Flag · Leaf', [])).toBe('Flag · Leaf')
    expect(reelTitleFor('', [{ user_id: 'a', handle: 'Hammy' }, { user_id: 'b', handle: 'MrJerry' }]))
      .toBe('Hammy vs MrJerry')
    expect(reelTitleFor(null, [{ user_id: 'a', handle: 'Hammy' }])).toBe('Hammy — match highlight')
    expect(reelTitleFor(null, [])).toBe('Match highlight')
  })
})

describe('POST /api/internal/publish-reel', () => {
  it('puts a produced video in the reels FEED, owned by the player, with its cast', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const hammy = await signUp(app, 'publishreelhammy')
    const jerry = await signUp(app, 'publishreeljerry')
    // This legacy feed fixture explicitly permits the owner to include Jerry.
    // Real new accounts keep the followers-of-followers default.
    await pool.query("update profiles set reel_usage_privacy='anyone' where id=$1", [jerry])

    const response = await publish(app, {
      youtube_id: 'https://youtu.be/mJ-zg4bnQ8w',
      user_id: hammy,
      title: 'Flag · Hidden Leaf',
      league: 'shinobistrikerleague',
      promoted: true,
      participants: [{ user_id: hammy, handle: 'Hammy' }, { user_id: jerry, handle: 'MrJerrySS' }],
    })
    expect(response.status).toBe(200)
    expect(response.body.created).toBe(true)
    expect(response.body.watch_url).toBe('https://www.youtube.com/watch?v=mJ-zg4bnQ8w')
    expect(response.body.participants).toEqual([hammy, jerry])

    const feed = await feedReels(app)
    expect(feed).toHaveLength(1)
    expect(feed[0].user_id).toBe(hammy)
    expect(feed[0].title).toBe('Flag · Hidden Leaf')
    expect(feed[0].league_slug).toBe('shinobistrikerleague')
    // The feed card has no clips to derive a thumbnail from, so the row carries
    // the YouTube still itself.
    expect(feed[0].thumbnail).toBe('https://i.ytimg.com/vi/mJ-zg4bnQ8w/hqdefault.jpg')

    // My Clips is "clips I'm in": the cast row is what makes it show for jerry.
    const cast = await pool.query('select user_id from reel_participants where reel_id=$1', [feed[0].id])
    expect(cast.rows.map((r: any) => String(r.user_id)).sort()).toEqual([hammy, jerry].sort())
  })

  it('is idempotent per (player, youtube id) — a retry never doubles the card', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const owner = await signUp(app, 'publishreelretry')

    const first = await publish(app, { youtube_id: 'mJ-zg4bnQ8w', user_id: owner, title: 'First' })
    expect(first.body.created).toBe(true)
    // The retry ledger re-sends the SAME payload spelled as a watch URL.
    const again = await publish(app, {
      youtube_id: 'https://www.youtube.com/watch?v=mJ-zg4bnQ8w',
      user_id: owner,
      title: 'First',
    })
    expect(again.body.created).toBe(false)
    expect(again.body.reel_id).toBe(first.body.reel_id)

    const rows = await pool.query('select id from reels where user_id=$1', [owner])
    expect(rows.rows).toHaveLength(1)
    const cast = await pool.query('select id from reel_participants where reel_id=$1', [first.body.reel_id])
    expect(cast.rows).toHaveLength(1)
  })

  it('keeps a FREE-tier weekly off the front feed but on the owner’s page', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const free = await signUp(app, 'publishreelfree')

    const response = await publish(app, {
      youtube_id: 'freeWeekly1',
      user_id: free,
      title: 'Weekly',
      promoted: false,
    })
    expect(response.status).toBe(200)
    expect(response.body.promoted).toBe(false)

    // Front feed: suppressed.
    expect(await feedReels(app)).toHaveLength(0)
    // The owner's own page reads reels by user_id with no promoted filter.
    const mine = await request(app).post('/api/db').send({
      table: 'reels',
      action: 'select',
      filters: [{ col: 'user_id', op: 'eq', val: free }],
    })
    expect(mine.body.data).toHaveLength(1)
    expect(mine.body.data[0].promoted).toBe(false)
  })

  it('refuses to attach a participant who is not a real account', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const owner = await signUp(app, 'publishreelghost')

    const response = await publish(app, {
      youtube_id: 'ghostcast01',
      user_id: owner,
      participants: [{ user_id: '11111111-1111-4111-8111-111111111111', handle: 'nobody' }],
    })
    expect(response.status).toBe(200)
    expect(response.body.participants).toEqual([owner])
    expect(response.body.skipped).toEqual(['11111111-1111-4111-8111-111111111111'])
    const cast = await pool.query('select user_id from reel_participants where reel_id=$1', [response.body.reel_id])
    expect(cast.rows).toHaveLength(1)
  })

  // Same rule the client path enforces (TABLE_POLICY.reel_participants): a block
  // costs you the clip you were both in, in EITHER direction.
  it('drops a blocked participant from the cast, symmetrically', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const owner = await signUp(app, 'publishreelblocker')
    const foe = await signUp(app, 'publishreelblocked')
    await pool.query('insert into blocks (blocker_id, blocked_id) values ($1,$2)', [foe, owner])

    const response = await publish(app, {
      youtube_id: 'blockedcast',
      user_id: owner,
      participants: [{ user_id: foe, handle: 'Foe' }],
    })
    expect(response.body.participants).toEqual([owner])
    expect(response.body.skipped).toEqual([foe])
  })

  it('refuses an unknown owner and a payload with no video', async () => {
    const app = createApp(makeDb())
    const noOwner = await publish(app, {
      youtube_id: 'mJ-zg4bnQ8w',
      user_id: '22222222-2222-4222-8222-222222222222',
    })
    expect(noOwner.status).toBe(400)
    const noVideo = await publish(app, { youtube_id: '', user_id: 'whoever' })
    expect(noVideo.status).toBe(400)
  })

  it('fails closed without the service key', async () => {
    const app = createApp(makeDb())
    const response = await request(app)
      .post('/api/internal/publish-reel')
      .send({ youtube_id: 'mJ-zg4bnQ8w', user_id: 'someone' })
    expect(response.status).toBe(401)
  })
})
