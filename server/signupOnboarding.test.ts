/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from './app'
import { makeDb } from './testHarness'
import { PRIVACY_VERSION, TERMS_VERSION } from '../src/lib/legalVersions'

const SERVICE_KEY = 'signup-roster-key'
const previous = {
  legal: process.env.REQUIRE_LEGAL_ACCEPTANCE,
  age: process.env.REQUIRE_AGE_CONSENT,
  youtube: process.env.REQUIRE_SIGNUP_YOUTUBE,
  service: process.env.TKO_SERVICE_KEY,
}

describe('signup onboarding contract', () => {
  let pool: any
  let app: any

  beforeEach(() => {
    process.env.REQUIRE_LEGAL_ACCEPTANCE = 'true'
    process.env.REQUIRE_AGE_CONSENT = 'true'
    process.env.REQUIRE_SIGNUP_YOUTUBE = 'true'
    process.env.TKO_SERVICE_KEY = SERVICE_KEY
    pool = makeDb()
    app = createApp(pool)
  })

  afterEach(() => {
    for (const [name, value] of Object.entries(previous)) {
      const key = name === 'legal' ? 'REQUIRE_LEGAL_ACCEPTANCE'
        : name === 'age' ? 'REQUIRE_AGE_CONSENT'
          : name === 'youtube' ? 'REQUIRE_SIGNUP_YOUTUBE'
          : 'TKO_SERVICE_KEY'
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('requires an explicit true 13+ consent attestation before creating an account', async () => {
    for (const [suffix, ageConsent] of [['missing', undefined], ['false', false]] as const) {
      const response = await request(app).post('/api/auth/signup').send({
        email: `age-${suffix}@tko.cam`,
        password: 'password123',
        username: `age_${suffix}`,
        terms_accepted: true,
        terms_version: TERMS_VERSION,
        privacy_accepted: true,
        privacy_version: PRIVACY_VERSION,
        ...(ageConsent === undefined ? {} : { age_consent_13_plus: ageConsent }),
      })
      expect(response.status).toBe(400)
      expect(response.body.error).toBe('age_consent_required')
    }
    expect((await pool.query("select id from users where email like 'age-%@tko.cam'")).rows).toEqual([])
  })

  it('allows account-first signup and uses server-owned creation time when a channel is supplied', async () => {
    const missing = await request(app).post('/api/auth/signup').send({
      email: 'missing-channel@tko.cam',
      password: 'password123',
      username: 'missing_channel',
      terms_accepted: true,
      terms_version: TERMS_VERSION,
      privacy_accepted: true,
      privacy_version: PRIVACY_VERSION,
      age_consent_13_plus: true,
    })
    expect(missing.status).toBe(200)
    const missingLinks = await pool.query(
      'select url from user_youtube_links where user_id=$1',
      [missing.body.user.id],
    )
    expect(missingLinks.rows).toEqual([])

    for (const videoUrl of [
      'https://youtu.be/abcdefghijk',
      'https://www.youtube.com/watch?v=abcdefghijk',
      'https://www.youtube.com/shorts/abcdefghijk',
      'https://www.youtube.com/live/abcdefghijk',
    ]) {
      const videoOnly = await request(app).post('/api/auth/signup').send({
        email: 'video-is-not-channel@tko.cam',
        password: 'password123',
        username: 'video_is_not_channel',
        youtube_url: videoUrl,
        terms_accepted: true,
        terms_version: TERMS_VERSION,
        privacy_accepted: true,
        privacy_version: PRIVACY_VERSION,
        age_consent_13_plus: true,
      })
      expect(videoOnly.status, videoUrl).toBe(400)
      expect(videoOnly.body.error, videoUrl).toBe('a valid YouTube channel URL is required')
    }

    const signup = await request(app).post('/api/auth/signup').send({
      email: 'new-player@tko.cam',
      password: 'password123',
      username: 'new_player',
      youtube_url: 'youtube.com/@NewPlayer/?view=1',
      notifications_requested: true,
      terms_accepted: true,
      terms_version: TERMS_VERSION,
      terms_accepted_at: '2000-01-01T00:00:00.000Z',
      privacy_accepted: true,
      privacy_version: PRIVACY_VERSION,
      age_consent_13_plus: true,
    })
    expect(signup.status).toBe(200)

    const userId = signup.body.user.id
    const account = (await pool.query('select user_metadata,created_at from users where id=$1', [userId])).rows[0]
    const metadata = typeof account.user_metadata === 'string'
      ? JSON.parse(account.user_metadata)
      : account.user_metadata
    expect(metadata.youtube_url).toBe('https://www.youtube.com/@NewPlayer')
    expect(metadata.notifications_requested).toBe(true)
    expect(metadata.terms_accepted_at).not.toBe('2000-01-01T00:00:00.000Z')
    expect(Number.isNaN(new Date(metadata.terms_accepted_at).getTime())).toBe(false)

    const links = await pool.query('select url from user_youtube_links where user_id=$1', [userId])
    expect(links.rows).toEqual([{ url: 'https://www.youtube.com/@NewPlayer' }])

    metadata.reelone_tier = 'pro'
    await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(metadata), userId])
    const roster = await request(app)
      .post('/api/internal/auto-merge-channels')
      .set('x-tko-service', SERVICE_KEY)
      .send({})
    expect(roster.status).toBe(200)
    expect(roster.body.channels).toContainEqual(expect.objectContaining({
      user_id: userId,
      signed_up_at: new Date(account.created_at).toISOString(),
    }))
  })

  it('uses account creation for a legacy account with no agreement timestamp', async () => {
    const inserted = await pool.query(
      `insert into users (email, user_metadata)
       values ($1,$2) returning id,created_at`,
      ['legacy@tko.cam', JSON.stringify({ username: 'legacy', reelone_tier: 'pro' })],
    )
    const userId = inserted.rows[0].id
    await pool.query('insert into profiles (id, username) values ($1,$2)', [userId, 'legacy'])
    await pool.query(
      'insert into user_youtube_links (user_id, url) values ($1,$2)',
      [userId, 'https://www.youtube.com/@legacy'],
    )

    const roster = await request(app)
      .post('/api/internal/auto-merge-channels')
      .set('x-tko-service', SERVICE_KEY)
      .send({})
    const legacy = roster.body.channels.find((channel: any) => channel.user_id === userId)
    expect(legacy).toBeTruthy()
    expect(legacy.signed_up_at).toBe(new Date(inserted.rows[0].created_at).toISOString())
  })

  it('records a server-owned cutoff when a legacy member accepts the current agreement', async () => {
    const inserted = await pool.query(
      `insert into users (email, user_metadata)
       values ($1,$2) returning id,email,created_at`,
      ['returning-member@tko.cam', JSON.stringify({ username: 'returning_member', reelone_tier: 'pro' })],
    )
    const account = inserted.rows[0]
    await pool.query(
      'insert into profiles (id, username) values ($1,$2)',
      [account.id, 'returning_member'],
    )
    await pool.query(
      'insert into user_youtube_links (user_id, url) values ($1,$2)',
      [account.id, 'https://www.youtube.com/@returning_member'],
    )
    const token = jwt.sign(
      { sub: account.id, email: account.email },
      process.env.JWT_SECRET || 'dev-secret-change-me',
      { expiresIn: '1h' },
    )

    const accepted = await request(app)
      .post('/api/fn/accept-current-legal')
      .set('authorization', `Bearer ${token}`)
      .send({
        terms_accepted: true,
        terms_version: TERMS_VERSION,
        privacy_accepted: true,
        privacy_version: PRIVACY_VERSION,
      })
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    expect(accepted.body.ok).toBe(true)
    expect(Number.isNaN(new Date(accepted.body.accepted_at).getTime())).toBe(false)

    const refreshed = await request(app)
      .get('/api/auth/me')
      .set('authorization', `Bearer ${token}`)
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200)
    expect(refreshed.body.user.user_metadata).toMatchObject({
      terms_accepted: true,
      terms_version: TERMS_VERSION,
      terms_accepted_at: accepted.body.accepted_at,
      privacy_accepted: true,
      privacy_version: PRIVACY_VERSION,
    })

    const roster = await request(app)
      .post('/api/internal/auto-merge-channels')
      .set('x-tko-service', SERVICE_KEY)
      .send({})
    expect(roster.body.channels).toContainEqual(expect.objectContaining({
      user_id: account.id,
      signed_up_at: new Date(account.created_at).toISOString(),
    }))
  })
})
