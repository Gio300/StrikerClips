/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest'
import { makeDb } from './testHarness'
import { automaticLiveEligible, probeYouTubeLive, runAutoLiveScan } from './autoLive'
import { resetDailyNotices } from './youtubeChannel'

afterEach(() => resetDailyNotices())

function page(html: string, url = 'https://www.youtube.com/@player/live'): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    url,
    text: async () => html,
    json: async () => JSON.parse(html),
  })) as any
}

async function linkedUser(pool: any, enabled = true) {
  const user = await pool.query(
    `insert into users (email,user_metadata)
     values ('live@tko.cam',$1) returning id`,
    [JSON.stringify({ username: 'liveplayer', reelone_tier: 'pro' })],
  )
  const id = user.rows[0].id
  await pool.query(
    'insert into profiles (id,username,auto_detect_live) values ($1,$2,$3)',
    [id, 'liveplayer', enabled],
  )
  await pool.query(
    `insert into user_youtube_links (user_id,url)
     values ($1,'https://www.youtube.com/@liveplayer')`, [id],
  )
  return id
}

describe('YouTube automatic live discovery', () => {
  it('treats a connected free account as eligible from signup day', () => {
    expect(automaticLiveEligible({ terms_accepted: true, privacy_accepted: true })).toBe(true)
    expect(automaticLiveEligible({ reelone_tier: 'free' })).toBe(true)
  })

  it('requires positive live evidence and extracts the active video', async () => {
    const probe = await probeYouTubeLive('https://www.youtube.com/@liveplayer', {
      fetchFn: page(
        '<script>var ytInitialData={}; var ytInitialPlayerResponse={"videoDetails":{"videoId":"abc123XYZ00","title":"Ranked battle","isLiveContent":true},"microformat":{"playerMicroformatRenderer":{"liveBroadcastDetails":{"isLiveNow":true}}}}</script>',
        'https://www.youtube.com/watch?v=abc123XYZ00',
      ),
    })
    expect(probe).toMatchObject({
      status: 'live', externalStreamId: 'abc123XYZ00',
      watchUrl: 'https://www.youtube.com/watch?v=abc123XYZ00',
    })
  })

  it('does not mistake an archived livestream for a live broadcast', async () => {
    const probe = await probeYouTubeLive('https://www.youtube.com/watch?v=ended123XYZ', {
      fetchFn: page(
        '<script>var ytInitialData={}; var ytInitialPlayerResponse={"videoDetails":{"videoId":"ended123XYZ","title":"Finished stream","isLiveContent":true},"microformat":{"playerMicroformatRenderer":{"liveBroadcastDetails":{"isLiveNow":false,"endTimestamp":"2026-07-31T20:00:00Z"}}}}</script>',
        'https://www.youtube.com/watch?v=ended123XYZ',
      ),
    })
    expect(probe).toMatchObject({ status: 'offline', watchUrl: null, externalStreamId: null })
  })

  it('accepts the reduced active-player payload served to cloud scanners', async () => {
    const probe = await probeYouTubeLive('https://www.youtube.com/watch?v=cloud123XYZ', {
      fetchFn: page(
        '<script>var ytInitialData={}; var ytInitialPlayerResponse={"playabilityStatus":{"status":"OK","liveStreamability":{}},"videoDetails":{"videoId":"cloud123XYZ","title":"Cloud live","isLiveContent":true,"channelId":"UC1234567890123456789012"}}</script>',
        'https://www.youtube.com/watch?v=cloud123XYZ',
      ),
    })
    expect(probe).toMatchObject({
      status: 'live', externalStreamId: 'cloud123XYZ',
      watchUrl: 'https://www.youtube.com/watch?v=cloud123XYZ',
    })
  })

  it('verifies a stripped cloud watch page through YouTube player metadata', async () => {
    const calls: string[] = []
    const probe = await probeYouTubeLive('https://www.youtube.com/watch?v=inner123XYZ', {
      fetchFn: (async (input: string | URL | Request) => {
        const requested = String(input)
        calls.push(requested)
        if (requested.includes('/youtubei/v1/player')) {
          return {
            ok: true,
            status: 200,
            url: requested,
            text: async () => '',
            json: async () => ({
              playabilityStatus: { status: 'OK' },
              videoDetails: {
                videoId: 'inner123XYZ',
                title: 'Verified cloud live',
                isLiveContent: true,
                isLive: true,
              },
              microformat: {
                playerMicroformatRenderer: {
                  liveBroadcastDetails: { isLiveNow: true },
                },
              },
            }),
          } as Response
        }
        const html = '<script>ytcfg.set({"INNERTUBE_API_KEY":"public-web-key","INNERTUBE_CLIENT_VERSION":"2.20260731.00.00"}); var ytInitialData={}; var ytInitialPlayerResponse={"videoDetails":{"videoId":"inner123XYZ","channelId":"UC1234567890123456789012"}}</script>'
        return {
          ok: true,
          status: 200,
          url: 'https://www.youtube.com/watch?v=inner123XYZ',
          text: async () => html,
          json: async () => JSON.parse(html),
        } as Response
      }) as any,
    })
    expect(calls).toHaveLength(2)
    expect(probe).toMatchObject({
      status: 'live',
      externalStreamId: 'inner123XYZ',
      title: 'Verified cloud live',
    })
  })

  it('verifies a stripped candidate with the low-cost YouTube videos endpoint', async () => {
    const calls: string[] = []
    const probe = await probeYouTubeLive('https://www.youtube.com/watch?v=data123XYZ0', {
      oauthAccessToken: 'test-access-token',
      fetchFn: (async (input: string | URL | Request, init?: RequestInit) => {
        const requested = String(input)
        calls.push(requested)
        if (requested.includes('/youtube/v3/videos')) {
          expect((init?.headers as Record<string, string>)?.authorization).toBe('Bearer test-access-token')
          return {
            ok: true,
            status: 200,
            url: requested,
            text: async () => '',
            json: async () => ({
              items: [{
                snippet: {
                  title: 'Officially verified live',
                  liveBroadcastContent: 'live',
                },
                liveStreamingDetails: {
                  actualStartTime: '2026-07-31T20:00:00Z',
                  concurrentViewers: '14',
                },
              }],
            }),
          } as Response
        }
        const html = '<script>var ytInitialData={}; var ytInitialPlayerResponse={"videoDetails":{"videoId":"data123XYZ0","channelId":"UC1234567890123456789012"}}</script>'
        return {
          ok: true,
          status: 200,
          url: 'https://www.youtube.com/watch?v=data123XYZ0',
          text: async () => html,
          json: async () => JSON.parse(html),
        } as Response
      }) as any,
    })
    expect(calls).toHaveLength(2)
    expect(probe).toMatchObject({
      status: 'live',
      externalStreamId: 'data123XYZ0',
      title: 'Officially verified live',
      method: 'youtube-data-api',
    })
  })

  it('discovers a handle live through the official uploads playlist', async () => {
    const calls: string[] = []
    const probe = await probeYouTubeLive('https://www.youtube.com/@officialplayer', {
      apiKey: 'test-data-key',
      fetchFn: (async (input: string | URL | Request) => {
        const requested = String(input)
        calls.push(requested)
        const parsed = new URL(requested)
        if (parsed.pathname.endsWith('/channels')) {
          expect(parsed.searchParams.get('forHandle')).toBe('@officialplayer')
          return {
            ok: true, status: 200, url: requested,
            json: async () => ({ items: [{
              id: 'UCofficial123456789012345',
              snippet: { title: 'Official Player' },
              contentDetails: { relatedPlaylists: { uploads: 'UUofficial123456789012345' } },
            }] }),
          } as Response
        }
        if (parsed.pathname.endsWith('/playlistItems')) {
          return {
            ok: true, status: 200, url: requested,
            json: async () => ({ items: [
              { contentDetails: { videoId: 'officialLIVE1' } },
              { contentDetails: { videoId: 'ordinaryVID1' } },
            ] }),
          } as Response
        }
        if (parsed.pathname.endsWith('/videos')) {
          return {
            ok: true, status: 200, url: requested,
            json: async () => ({ items: [
              {
                id: 'officialLIVE1',
                snippet: { title: 'Live clan match', liveBroadcastContent: 'live' },
                liveStreamingDetails: { actualStartTime: '2026-07-31T20:00:00Z', concurrentViewers: '9' },
              },
              { id: 'ordinaryVID1', snippet: { liveBroadcastContent: 'none' } },
            ] }),
          } as Response
        }
        throw new Error(`unexpected request ${requested}`)
      }) as any,
    })
    expect(calls).toHaveLength(3)
    expect(probe).toMatchObject({
      status: 'live',
      externalStreamId: 'officialLIVE1',
      watchUrl: 'https://www.youtube.com/watch?v=officialLIVE1',
      method: 'youtube-data-api',
    })
  })

  it('rejects a scheduled stream that has not started', async () => {
    const probe = await probeYouTubeLive('https://www.youtube.com/watch?v=soon123XYZ0', {
      fetchFn: page(
        '<script>var ytInitialData={}; var ytInitialPlayerResponse={"playabilityStatus":{"status":"LIVE_STREAM_OFFLINE","liveStreamability":{"liveStreamabilityRenderer":{"offlineSlate":{}}}},"videoDetails":{"videoId":"soon123XYZ0","title":"Starting soon","isLiveContent":true,"channelId":"UC1234567890123456789012"},"microformat":{"playerMicroformatRenderer":{"liveBroadcastDetails":{"isLiveNow":false}}}}</script>',
        'https://www.youtube.com/watch?v=soon123XYZ0',
      ),
    })
    expect(probe).toMatchObject({ status: 'offline', watchUrl: null, externalStreamId: null })
  })

  it('follows an old saved broadcast to the channel current live video', async () => {
    const calls: string[] = []
    const probe = await probeYouTubeLive('https://www.youtube.com/watch?v=old123XYZ00', {
      fetchFn: (async (input: string | URL | Request) => {
        const requested = String(input)
        calls.push(requested)
        const isOldWatch = requested.includes('old123XYZ00')
        const isChannel = requested.includes('/channel/UC1234567890123456789012/live')
        const html = isOldWatch
          ? '<script>var ytInitialData={}; var ytInitialPlayerResponse={"videoDetails":{"videoId":"old123XYZ00","isLiveContent":true,"channelId":"UC1234567890123456789012"},"microformat":{"playerMicroformatRenderer":{"liveBroadcastDetails":{"isLiveNow":false}}}}</script>'
          : isChannel
            ? '<script>var ytInitialData={"currentVideo":"new123XYZ00"}; var ytInitialPlayerResponse={"videoDetails":{"videoId":"new123XYZ00","title":"New match","isLiveContent":true,"channelId":"UC1234567890123456789012"}}</script>'
            : '<script>var ytInitialData={}; var ytInitialPlayerResponse={"videoDetails":{"videoId":"new123XYZ00","title":"New match","isLiveContent":true,"channelId":"UC1234567890123456789012"},"microformat":{"playerMicroformatRenderer":{"liveBroadcastDetails":{"isLiveNow":true}}}}</script>'
        return {
          ok: true,
          status: 200,
          url: isOldWatch
            ? 'https://www.youtube.com/watch?v=old123XYZ00'
            : isChannel
              ? requested
              : 'https://www.youtube.com/watch?v=new123XYZ00',
          text: async () => html,
          json: async () => JSON.parse(html),
        } as Response
      }) as any,
    })
    expect(calls).toHaveLength(3)
    expect(probe).toMatchObject({
      status: 'live', externalStreamId: 'new123XYZ00',
      watchUrl: 'https://www.youtube.com/watch?v=new123XYZ00',
    })
  })

  it('creates, heartbeats, and explicitly ends only scanner-owned rows', async () => {
    const pool = makeDb()
    const userId = await linkedUser(pool)
    const liveHtml = '<script>var ytInitialData={};var ytInitialPlayerResponse={"videoDetails":{"videoId":"abc123XYZ00","title":"Live","isLiveContent":true},"microformat":{"playerMicroformatRenderer":{"liveBroadcastDetails":{"isLiveNow":true}}}}</script>'
    const first = await runAutoLiveScan(pool, {
      fetchFn: page(liveHtml, 'https://www.youtube.com/watch?v=abc123XYZ00'),
    })
    expect(first).toMatchObject({ live: 1, started: 1, ended: 0 })
    let rows = await pool.query('select * from live_streams where user_id=$1', [userId])
    expect(rows.rows[0]).toMatchObject({ is_live: true, source: 'auto_youtube', external_stream_id: 'abc123XYZ00' })

    const unknown = await runAutoLiveScan(pool, {
      fetchFn: (async () => { throw new Error('temporary network loss') }) as any,
    })
    expect(unknown.unknown).toBe(1)
    rows = await pool.query('select * from live_streams where user_id=$1', [userId])
    expect(rows.rows[0].is_live).toBe(true)

    const offline = await runAutoLiveScan(pool, {
      fetchFn: page('<script>var ytInitialData={"channelId":"UC1234567890123456789012"};</script>'),
    })
    expect(offline).toMatchObject({ offline: 1, ended: 1 })
    rows = await pool.query('select * from live_streams where user_id=$1', [userId])
    expect(rows.rows[0].is_live).toBe(false)
  })

  it('uses the account channel even when a newer saved clip exists', async () => {
    const pool = makeDb()
    const userId = await linkedUser(pool)
    await pool.query(
      `update user_youtube_links set created_at='2026-01-01T00:00:00Z' where user_id=$1`,
      [userId],
    )
    await pool.query(
      `insert into user_youtube_links (user_id,url,created_at)
       values ($1,'https://www.youtube.com/watch?v=wrongNewest1','2026-02-01T00:00:00Z')`,
      [userId],
    )
    const calls: string[] = []
    const liveHtml = '<script>var ytInitialData={};var ytInitialPlayerResponse={"videoDetails":{"videoId":"abc123XYZ00","title":"Live","isLiveContent":true},"microformat":{"playerMicroformatRenderer":{"liveBroadcastDetails":{"isLiveNow":true}}}}</script>'
    const result = await runAutoLiveScan(pool, {
      fetchFn: (async (input: string | URL | Request) => {
        calls.push(String(input))
        return page(liveHtml, 'https://www.youtube.com/watch?v=abc123XYZ00')(input as any)
      }) as any,
    })
    expect(result.live).toBe(1)
    expect(calls[0]).toContain('/@liveplayer/live')
    expect(calls[0]).not.toContain('wrongNewest1')
  })

  it('finds a renamed handle through the persisted channel id', async () => {
    const pool = makeDb()
    const userId = await linkedUser(pool)
    // A previous successful resolution persisted the UC… id (shared cache with
    // the [auto-youtube] scanner); afterwards the member renamed their handle,
    // so the stored @liveplayer URL now 404s at YouTube.
    await pool.query('update user_youtube_links set channel_id=$1 where user_id=$2',
      ['UC1234567890123456789012', userId])
    const liveHtml = '<script>var ytInitialData={};var ytInitialPlayerResponse={"videoDetails":{"videoId":"abc123XYZ00","title":"Live","isLiveContent":true},"microformat":{"playerMicroformatRenderer":{"liveBroadcastDetails":{"isLiveNow":true}}}}</script>'
    const calls: string[] = []
    const result = await runAutoLiveScan(pool, {
      fetchFn: (async (input: string | URL | Request) => {
        const requested = String(input)
        calls.push(requested)
        if (requested.includes('/@liveplayer')) {
          return { ok: false, status: 404, url: requested, text: async () => '' } as Response
        }
        return {
          ok: true,
          status: 200,
          url: 'https://www.youtube.com/watch?v=abc123XYZ00',
          text: async () => liveHtml,
          json: async () => JSON.parse(liveHtml),
        } as Response
      }) as any,
    })
    expect(result).toMatchObject({ live: 1, started: 1, errors: [] })
    expect(calls.some((u) => u.includes('/channel/UC1234567890123456789012/live'))).toBe(true)
  })

  it('mutes a repeating dead-channel probe error after the first daily notice', async () => {
    const pool = makeDb()
    const userId = await linkedUser(pool)
    const dead = (async (input: string | URL | Request) => ({
      ok: false, status: 404, url: String(input), text: async () => '',
    })) as any
    const t0 = Date.parse('2026-08-03T10:00:00Z')
    const first = await runAutoLiveScan(pool, { fetchFn: dead, now: t0 })
    expect(first.errors).toEqual([{ userId, error: 'YouTube HTTP 404' }])
    expect(first.muted).toBe(0)
    const repeat = await runAutoLiveScan(pool, { fetchFn: dead, now: t0 + 90 * 1000 })
    expect(repeat.errors).toEqual([])
    expect(repeat.muted).toBe(1)
  })

  it('honors the default-on switch when the member opts out', async () => {
    const pool = makeDb()
    await linkedUser(pool, false)
    let calls = 0
    const result = await runAutoLiveScan(pool, {
      fetchFn: (async () => { calls++; return page('')('' as any) }) as any,
    })
    expect(result).toMatchObject({ scanned: 1, eligible: 0, live: 0 })
    expect(calls).toBe(0)
  })
})
