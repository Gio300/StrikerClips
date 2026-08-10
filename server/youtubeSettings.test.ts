/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

async function member(app: any) {
  const signup = await request(app).post('/api/auth/signup').send({
    email: `youtube-settings-${Math.random().toString(36).slice(2)}@tko.cam`,
    password: 'password123',
    username: `yt_${Math.random().toString(36).slice(2, 10)}`,
    date_of_birth: '1990-01-01',
  })
  expect(signup.status).toBe(200)
  return { id: signup.body.user.id as string, token: signup.body.token as string }
}

describe('account YouTube channel settings', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('replaces wrong channels without deleting saved clip sources', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const user = await member(app)
    await pool.query(
      `insert into user_youtube_links (user_id,url) values
       ($1,'https://www.youtube.com/@wrong'),
       ($1,'https://www.youtube.com/watch?v=abcdefghijk')`,
      [user.id],
    )

    const saved = await request(app)
      .post('/api/fn/youtube-channel-settings')
      .set('authorization', `Bearer ${user.token}`)
      .send({ action: 'save', url: 'youtube.com/@CorrectPlayer/videos?view=1' })
    expect(saved.status).toBe(200)
    expect(saved.body.channel.url).toBe('https://www.youtube.com/@CorrectPlayer')

    const rows = (await pool.query(
      'select url from user_youtube_links where user_id=$1 order by url', [user.id],
    )).rows.map((row: any) => row.url)
    expect(rows).toEqual([
      'https://www.youtube.com/@CorrectPlayer',
      'https://www.youtube.com/watch?v=abcdefghijk',
    ])

    const metadataRaw = (await pool.query('select user_metadata from users where id=$1', [user.id])).rows[0].user_metadata
    const metadata = typeof metadataRaw === 'string' ? JSON.parse(metadataRaw) : metadataRaw
    expect(metadata.youtube_url).toBe('https://www.youtube.com/@CorrectPlayer')

    const loaded = await request(app)
      .post('/api/fn/youtube-channel-settings')
      .set('authorization', `Bearer ${user.token}`)
      .send({ action: 'get' })
    expect(loaded.body.channel.url).toBe('https://www.youtube.com/@CorrectPlayer')
  })

  it('disconnects the account channel and rejects video links as channels', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const user = await member(app)

    const invalid = await request(app)
      .post('/api/fn/youtube-channel-settings')
      .set('authorization', `Bearer ${user.token}`)
      .send({ action: 'save', url: 'https://youtu.be/abcdefghijk' })
    expect(invalid.status).toBe(400)

    await pool.query(
      `insert into user_youtube_links (user_id,url) values
       ($1,'https://www.youtube.com/channel/UC123'),
       ($1,'https://www.youtube.com/watch?v=abcdefghijk')`,
      [user.id],
    )
    const disconnected = await request(app)
      .post('/api/fn/youtube-channel-settings')
      .set('authorization', `Bearer ${user.token}`)
      .send({ action: 'disconnect' })
    expect(disconnected.status).toBe(200)
    expect(disconnected.body.channel).toBeNull()
    const rows = await pool.query('select url from user_youtube_links where user_id=$1', [user.id])
    expect(rows.rows).toEqual([{ url: 'https://www.youtube.com/watch?v=abcdefghijk' }])
  })

  it('restores uploads from an already-connected account without OAuth', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const user = await member(app)
    const channelId = 'UC1234567890123456789012'
    await pool.query(
      'insert into user_youtube_links (user_id,url) values ($1,$2)',
      [user.id, `https://www.youtube.com/channel/${channelId}`],
    )
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`)
      return new Response(`
        <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
          <entry>
            <yt:videoId>abcdefghijk</yt:videoId>
            <title>Triple K.O.</title>
            <published>2026-08-08T12:34:56Z</published>
            <link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk" />
          </entry>
        </feed>
      `, { status: 200, headers: { 'content-type': 'application/atom+xml' } })
    }))

    const loaded = await request(app)
      .post('/api/fn/youtube-channel-settings')
      .set('authorization', `Bearer ${user.token}`)
      .send({ action: 'uploads' })

    expect(loaded.status).toBe(200)
    expect(loaded.body.channel.url).toBe(`https://www.youtube.com/channel/${channelId}`)
    expect(loaded.body.videos).toEqual([{
      id: 'abcdefghijk',
      title: 'Triple K.O.',
      description: '',
      publishedAt: Date.parse('2026-08-08T12:34:56Z'),
    }])

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('YouTube unavailable') }))
    const temporaryFailure = await request(app)
      .post('/api/fn/youtube-channel-settings')
      .set('authorization', `Bearer ${user.token}`)
      .send({ action: 'uploads' })
    expect(temporaryFailure.status).toBe(200)
    expect(temporaryFailure.body.channel.url).toBe(`https://www.youtube.com/channel/${channelId}`)
    expect(temporaryFailure.body.videos).toEqual([])
    expect(temporaryFailure.body.warning).toContain('connected')
  })
})
