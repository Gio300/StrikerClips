/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest'
import { makeDb } from './testHarness'
import {
  isClearlyNonShinobiUploadTitle,
  parseYouTubeFeed,
  runAutoYouTubeScan,
} from './autoYouTube'
import { resetDailyNotices } from './youtubeChannel'

const CHANNEL_ID = 'UC1234567890123456789012'
const FEED_PUBLISHED_AT = new Date().toISOString()

afterEach(() => resetDailyNotices())

function response(body: string, url: string): Response {
  return {
    ok: true,
    status: 200,
    url,
    text: async () => body,
  } as Response
}

function youtubeFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/feeds/videos.xml')) {
      return response(`
        <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
          <entry>
            <yt:videoId>upload12345</yt:videoId>
            <title>TKO match</title>
            <published>${FEED_PUBLISHED_AT}</published>
            <link rel="alternate" href="https://www.youtube.com/watch?v=upload12345" />
          </entry>
        </feed>`, url)
    }
    return response(`<script>window.data={"channelId":"${CHANNEL_ID}"}</script>`, url)
  }) as typeof fetch
}

describe('YouTube upload discovery', () => {
  it('skips explicit other-game titles but keeps vague and Shinobi titles for frame analysis', () => {
    expect(isClearlyNonShinobiUploadTitle('Fortnite ranked highlights')).toBe(true)
    expect(isClearlyNonShinobiUploadTitle('Marvel Rivals with the squad')).toBe(true)
    expect(isClearlyNonShinobiUploadTitle('Playing for fun')).toBe(false)
    expect(isClearlyNonShinobiUploadTitle('Naruto to Boruto: Shinobi Striker vs Marvel clan')).toBe(false)
  })

  it('parses upload entries from the zero-quota Atom feed', () => {
    const entries = parseYouTubeFeed(`
      <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
        <entry><yt:videoId>abc123XYZ00</yt:videoId><title>A &amp; B</title>
          <published>2026-07-31T12:00:00Z</published></entry>
      </feed>`)
    expect(entries).toEqual([{
      videoId: 'abc123XYZ00',
      watchUrl: 'https://www.youtube.com/watch?v=abc123XYZ00',
      title: 'A & B',
      publishedAt: '2026-07-31T12:00:00Z',
    }])
  })

  it('queues each upload once even when later scans rediscover it', async () => {
    const pool = makeDb()
    const user = await pool.query(
      `insert into users (email,user_metadata) values ('uploads@tko.cam',$1) returning id`,
      [JSON.stringify({ reelone_tier: 'pro' })],
    )
    const userId = user.rows[0].id
    await pool.query(
      `insert into profiles (id,username,auto_merge_opt_out) values ($1,'uploader',false)`,
      [userId],
    )
    await pool.query(
      `insert into user_youtube_links (user_id,url) values ($1,'https://www.youtube.com/@uploader')`,
      [userId],
    )

    const first = await runAutoYouTubeScan(pool, { fetchFn: youtubeFetch() })
    const second = await runAutoYouTubeScan(pool, { fetchFn: youtubeFetch() })
    expect(first).toMatchObject({ scanned: 1, eligible: 1, discovered: 1, queued: 1 })
    expect(second).toMatchObject({ scanned: 1, eligible: 1, discovered: 1, queued: 1 })

    const sources = await pool.query(
      `select * from media_sources where owner_id=$1 and external_id='upload12345'`,
      [userId],
    )
    const jobs = await pool.query(
      `select * from media_analysis_jobs where source_id=$1`,
      [sources.rows[0].id],
    )
    expect(sources.rows).toHaveLength(1)
    expect(jobs.rows).toHaveLength(1)
  })

  it('only queues uploads from the inclusive signup day onward', async () => {
    const pool = makeDb()
    const user = await pool.query(
      `insert into users (email,user_metadata,created_at)
       values ('signup-window@tko.cam',$1,'2026-08-09T18:30:00Z') returning id`,
      [JSON.stringify({ reelone_tier: 'pro' })],
    )
    const userId = user.rows[0].id
    await pool.query(`insert into profiles (id,username) values ($1,'signup-window')`, [userId])
    await pool.query(
      `insert into user_youtube_links (user_id,url) values ($1,'https://www.youtube.com/@signup-window')`,
      [userId],
    )
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/feeds/videos.xml')) {
        return response(`
          <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
            <entry><yt:videoId>beforeDay01</yt:videoId><title>Shinobi Striker</title>
              <published>2026-08-08T23:59:59Z</published></entry>
            <entry><yt:videoId>signupDay01</yt:videoId><title>Shinobi Striker</title>
              <published>2026-08-09T00:01:00Z</published></entry>
            <entry><yt:videoId>afterSignup1</yt:videoId><title>Shinobi Striker</title>
              <published>2026-08-10T03:00:00Z</published></entry>
          </feed>`, url)
      }
      return response(`<script>window.data={"channelId":"${CHANNEL_ID}"}</script>`, url)
    }) as typeof fetch

    const result = await runAutoYouTubeScan(pool, { fetchFn })
    expect(result).toMatchObject({
      discovered: 3,
      skippedPreSignup: 1,
      queued: 2,
    })
    const sources = await pool.query(
      `select external_id from media_sources where owner_id=$1 order by external_id`,
      [userId],
    )
    expect(sources.rows.map((row) => row.external_id)).toEqual(['afterSignup1', 'signupDay01'])
  })

  it('resolves the handle once and persists the channel id for later cycles', async () => {
    const pool = makeDb()
    const user = await pool.query(
      `insert into users (email,user_metadata) values ('cached@tko.cam',$1) returning id`,
      [JSON.stringify({ reelone_tier: 'pro' })],
    )
    const userId = user.rows[0].id
    await pool.query(`insert into profiles (id,username) values ($1,'cached')`, [userId])
    await pool.query(
      `insert into user_youtube_links (user_id,url) values ($1,'https://www.youtube.com/@cached')`,
      [userId],
    )
    const pageFetches: string[] = []
    const fetchFn = ((base: typeof fetch) => (async (input: RequestInfo | URL, init?: any) => {
      const url = String(input)
      if (!url.includes('/feeds/videos.xml')) pageFetches.push(url)
      return (base as any)(input, init)
    }) as typeof fetch)(youtubeFetch())

    await runAutoYouTubeScan(pool, { fetchFn })
    const link = await pool.query('select channel_id from user_youtube_links where user_id=$1', [userId])
    expect(link.rows[0].channel_id).toBe(CHANNEL_ID)

    await runAutoYouTubeScan(pool, { fetchFn })
    // One page scrape total: the second cycle went straight to the feed.
    expect(pageFetches).toHaveLength(1)
  })

  it('ignores a newer saved video when choosing the upload channel', async () => {
    const pool = makeDb()
    const user = await pool.query(
      `insert into users (email,user_metadata) values ('clips-and-channel@tko.cam',$1) returning id`,
      [JSON.stringify({ reelone_tier: 'pro' })],
    )
    const userId = user.rows[0].id
    await pool.query(`insert into profiles (id,username) values ($1,'channelowner')`, [userId])
    await pool.query(
      `insert into user_youtube_links (user_id,url,created_at) values
       ($1,'https://www.youtube.com/@channelowner','2026-01-01T00:00:00Z'),
       ($1,'https://www.youtube.com/watch?v=newestClip1','2026-02-01T00:00:00Z')`,
      [userId],
    )
    const pageCalls: string[] = []
    const base = youtubeFetch()
    const summary = await runAutoYouTubeScan(pool, {
      fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (!url.includes('/feeds/videos.xml')) pageCalls.push(url)
        return (base as any)(input, init)
      }) as typeof fetch,
    })
    expect(summary).toMatchObject({ scanned: 1, feeds: 1, queued: 1 })
    expect(pageCalls).toEqual(['https://www.youtube.com/@channelowner'])
  })

  it('heals a stale persisted channel id when its feed 404s', async () => {
    const pool = makeDb()
    const staleId = 'UCstale567890123456789012'
    const user = await pool.query(
      `insert into users (email,user_metadata) values ('stale@tko.cam',$1) returning id`,
      [JSON.stringify({ reelone_tier: 'pro' })],
    )
    const userId = user.rows[0].id
    await pool.query(`insert into profiles (id,username) values ($1,'stale')`, [userId])
    await pool.query(
      `insert into user_youtube_links (user_id,url,channel_id)
       values ($1,'https://www.youtube.com/@stale',$2)`,
      [userId, staleId],
    )
    const base = youtubeFetch()
    const fetchFn = (async (input: RequestInfo | URL, init?: any) => {
      const url = String(input)
      if (url.includes(`channel_id=${staleId}`)) {
        return { ok: false, status: 404, url, text: async () => '' } as Response
      }
      return (base as any)(input, init)
    }) as typeof fetch

    const summary = await runAutoYouTubeScan(pool, { fetchFn })
    expect(summary).toMatchObject({ feeds: 1, discovered: 1, queued: 1, errors: [] })
    const link = await pool.query('select channel_id from user_youtube_links where user_id=$1', [userId])
    expect(link.rows[0].channel_id).toBe(CHANNEL_ID)
  })

  it('logs a dead channel once per day instead of every cycle', async () => {
    const pool = makeDb()
    const user = await pool.query(
      `insert into users (email,user_metadata) values ('dead@tko.cam',$1) returning id`,
      [JSON.stringify({ reelone_tier: 'pro' })],
    )
    const userId = user.rows[0].id
    await pool.query(`insert into profiles (id,username) values ($1,'deadchannel')`, [userId])
    await pool.query(
      `insert into user_youtube_links (user_id,url) values ($1,'https://www.youtube.com/@gonehandle')`,
      [userId],
    )
    // The handle page itself 404s — a genuinely dead/renamed channel.
    const fetchFn = (async (input: RequestInfo | URL) => ({
      ok: false, status: 404, url: String(input), text: async () => '',
    })) as typeof fetch

    const t0 = Date.parse('2026-08-03T10:00:00Z')
    const first = await runAutoYouTubeScan(pool, { fetchFn, now: t0 })
    expect(first.errors).toEqual([{ userId, error: 'could not resolve YouTube channel id' }])
    expect(first.muted).toBe(0)

    const repeat = await runAutoYouTubeScan(pool, { fetchFn, now: t0 + 5 * 60 * 1000 })
    expect(repeat.errors).toEqual([])
    expect(repeat.muted).toBe(1)

    const nextDay = await runAutoYouTubeScan(pool, { fetchFn, now: t0 + 25 * 60 * 60 * 1000 })
    expect(nextDay.errors).toHaveLength(1)
  })

  it('discovers a free member from signup day and does not queue an explicit other game', async () => {
    const pool = makeDb()
    const user = await pool.query(
      `insert into users (email,user_metadata) values ('free-upload@tko.cam',$1) returning id`,
      [JSON.stringify({ terms_accepted: true, privacy_accepted: true })],
    )
    const userId = user.rows[0].id
    await pool.query(`insert into profiles (id,username) values ($1,'free-uploader')`, [userId])
    await pool.query(
      `insert into user_youtube_links (user_id,url) values ($1,'https://www.youtube.com/@free-uploader')`,
      [userId],
    )
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/feeds/videos.xml')) {
        return response(`
          <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
            <entry><yt:videoId>fortnite123</yt:videoId><title>Fortnite tournament</title>
              <published>${FEED_PUBLISHED_AT}</published></entry>
          </feed>`, url)
      }
      return response(`<script>window.data={"channelId":"${CHANNEL_ID}"}</script>`, url)
    }) as typeof fetch

    const result = await runAutoYouTubeScan(pool, { fetchFn })
    expect(result).toMatchObject({ scanned: 1, eligible: 1, discovered: 1, skippedNonCombat: 1, queued: 0 })
    expect((await pool.query('select * from media_sources')).rows).toHaveLength(0)
  })
})
