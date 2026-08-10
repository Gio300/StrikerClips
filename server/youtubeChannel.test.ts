/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest'
import { makeDb } from './testHarness'
import {
  cachedUserChannelId,
  directChannelId,
  resetDailyNotices,
  resolveUserChannelId,
  shouldLogDailyNotice,
  youtubeChannelIdFromPage,
} from './youtubeChannel'

const CHANNEL_ID = 'UC1234567890123456789012'

function pageFetch(channelId: string, calls?: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls?.push(url)
    return {
      ok: true,
      status: 200,
      url,
      text: async () => `<script>var ytcfg={"channelId":"${channelId}"}</script>`,
    } as Response
  }) as typeof fetch
}

async function linkedUser(pool: any, url: string): Promise<string> {
  const user = await pool.query(
    `insert into users (email) values ('${Math.random().toString(36).slice(2)}@tko.cam') returning id`,
  )
  const userId = user.rows[0].id
  await pool.query('insert into user_youtube_links (user_id,url) values ($1,$2)', [userId, url])
  return userId
}

afterEach(() => resetDailyNotices())

describe('youtubeChannelIdFromPage', () => {
  it('reads the id straight from a /channel/UC… path', () => {
    expect(youtubeChannelIdFromPage(`https://www.youtube.com/channel/${CHANNEL_ID}/live`, ''))
      .toBe(CHANNEL_ID)
  })

  it('rejects a lowercased uc… path (channel ids are case-sensitive)', () => {
    expect(youtubeChannelIdFromPage(`https://www.youtube.com/channel/${CHANNEL_ID.toLowerCase()}`, ''))
      .toBeNull()
  })

  it('scrapes channelId / externalId / meta markers from page HTML', () => {
    const url = 'https://www.youtube.com/@someone'
    expect(youtubeChannelIdFromPage(url, `"channelId":"${CHANNEL_ID}"`)).toBe(CHANNEL_ID)
    expect(youtubeChannelIdFromPage(url, `"externalId":"${CHANNEL_ID}"`)).toBe(CHANNEL_ID)
    expect(youtubeChannelIdFromPage(url, `<meta itemprop="channelId" content="${CHANNEL_ID}">`))
      .toBe(CHANNEL_ID)
    expect(youtubeChannelIdFromPage(url, '<html>nothing here</html>')).toBeNull()
  })
})

describe('resolveUserChannelId', () => {
  it('answers a /channel/UC… link without any network or DB access', async () => {
    const pool = makeDb()
    const calls: string[] = []
    const resolved = await resolveUserChannelId(
      pool, '00000000-0000-0000-0000-000000000000',
      `https://www.youtube.com/channel/${CHANNEL_ID}`, pageFetch('UCother567890123456789012', calls),
    )
    expect(resolved).toBe(CHANNEL_ID)
    expect(calls).toHaveLength(0)
    expect(directChannelId(`https://youtube.com/channel/${CHANNEL_ID}`)).toBe(CHANNEL_ID)
  })

  it('scrapes a handle once, persists the id, and serves the cache afterwards', async () => {
    const pool = makeDb()
    const url = 'https://www.youtube.com/@handle'
    const userId = await linkedUser(pool, url)
    const calls: string[] = []

    const first = await resolveUserChannelId(pool, userId, url, pageFetch(CHANNEL_ID, calls))
    expect(first).toBe(CHANNEL_ID)
    expect(calls).toHaveLength(1)

    const persisted = await pool.query(
      'select channel_id from user_youtube_links where user_id=$1', [userId],
    )
    expect(persisted.rows[0].channel_id).toBe(CHANNEL_ID)

    // Second resolve: cache hit — the page is NOT fetched again.
    const second = await resolveUserChannelId(pool, userId, url, pageFetch(CHANNEL_ID, calls))
    expect(second).toBe(CHANNEL_ID)
    expect(calls).toHaveLength(1)
    expect(await cachedUserChannelId(pool, userId, url)).toBe(CHANNEL_ID)
  })

  it('forceRefresh bypasses a stale cached id and heals the row', async () => {
    const pool = makeDb()
    const url = 'https://www.youtube.com/@renamed'
    const userId = await linkedUser(pool, url)
    await pool.query('update user_youtube_links set channel_id=$1 where user_id=$2',
      ['UCstale567890123456789012', userId])

    const calls: string[] = []
    const fresh = await resolveUserChannelId(
      pool, userId, url, pageFetch(CHANNEL_ID, calls), { forceRefresh: true },
    )
    expect(fresh).toBe(CHANNEL_ID)
    expect(calls).toHaveLength(1)
    expect(await cachedUserChannelId(pool, userId, url)).toBe(CHANNEL_ID)
  })

  it('returns null (and persists nothing) when the page has no channel id', async () => {
    const pool = makeDb()
    const url = 'https://www.youtube.com/@empty'
    const userId = await linkedUser(pool, url)
    const resolved = await resolveUserChannelId(pool, userId, url, (async () => ({
      ok: true, status: 200, url, text: async () => '<html>consent wall</html>',
    })) as any)
    expect(resolved).toBeNull()
    expect(await cachedUserChannelId(pool, userId, url)).toBeNull()
  })

  it('propagates network failures to the caller (per-user error accounting)', async () => {
    const pool = makeDb()
    const url = 'https://www.youtube.com/@flaky'
    const userId = await linkedUser(pool, url)
    await expect(resolveUserChannelId(pool, userId, url, (async () => {
      throw new Error('The operation was aborted due to timeout')
    }) as any)).rejects.toThrow('aborted')
  })
})

describe('shouldLogDailyNotice', () => {
  it('logs a key once per day, then again after 24h', () => {
    const t0 = Date.parse('2026-08-03T10:00:00Z')
    expect(shouldLogDailyNotice('auto-youtube:u1:dead', t0)).toBe(true)
    expect(shouldLogDailyNotice('auto-youtube:u1:dead', t0 + 5 * 60 * 1000)).toBe(false)
    expect(shouldLogDailyNotice('auto-youtube:u1:dead', t0 + 23 * 60 * 60 * 1000)).toBe(false)
    expect(shouldLogDailyNotice('auto-youtube:u1:dead', t0 + 25 * 60 * 60 * 1000)).toBe(true)
  })

  it('keys are independent: a new failure mode still logs immediately', () => {
    const t0 = Date.parse('2026-08-03T10:00:00Z')
    expect(shouldLogDailyNotice('auto-youtube:u1:feed 404', t0)).toBe(true)
    expect(shouldLogDailyNotice('auto-youtube:u1:feed 500', t0)).toBe(true)
    expect(shouldLogDailyNotice('auto-live:u1:feed 404', t0)).toBe(true)
  })
})
