import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'
import { ONBOARDING_REMINDER_CAMPAIGN } from './onboardingReminder'
import { setPushSender, type StoredSubscription } from './webPush'

const SERVICE_KEY = 'onboarding-reminder-test-key'
const TEST_PUBLIC_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
const TEST_PRIVATE_KEY = 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls'

const ORIGINAL_ENV = {
  service: process.env.TKO_SERVICE_KEY,
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
  subject: process.env.VAPID_SUBJECT,
}

const restore = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function addProfile(pool: any, username: string): Promise<string> {
  const id = randomUUID()
  await pool.query('insert into profiles (id, username) values ($1, $2)', [id, username])
  return id
}

async function addSubscription(pool: any, userId: string, endpoint: string): Promise<void> {
  await pool.query(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
     values ($1, $2, $3, $4)`,
    [userId, endpoint, 'BPtestPublicKeyValueGoesHere', 'dGVzdEF1dGhTZWNyZXQ'],
  )
}

describe('POST /api/internal/onboarding-reminder', () => {
  beforeEach(() => {
    process.env.TKO_SERVICE_KEY = SERVICE_KEY
    process.env.VAPID_PUBLIC_KEY = TEST_PUBLIC_KEY
    process.env.VAPID_PRIVATE_KEY = TEST_PRIVATE_KEY
    process.env.VAPID_SUBJECT = 'mailto:test@tko.cam'
  })

  afterEach(() => {
    setPushSender(null)
    restore('TKO_SERVICE_KEY', ORIGINAL_ENV.service)
    restore('VAPID_PUBLIC_KEY', ORIGINAL_ENV.publicKey)
    restore('VAPID_PRIVATE_KEY', ORIGINAL_ENV.privateKey)
    restore('VAPID_SUBJECT', ORIGINAL_ENV.subject)
  })

  it('uses a fresh brand-neutral campaign that opens the resumable chat setup', () => {
    expect(ONBOARDING_REMINDER_CAMPAIGN).toMatchObject({
      id: '00000000-0000-4000-8000-000020260810',
      kind: 'onboarding_ask_tko_chat_v1_2026_08_10',
      title: 'Finish your account setup',
      link: '/setup',
      tag: 'onboarding:ask-tko:chat-v1:2026-08-10',
    })
    expect(ONBOARDING_REMINDER_CAMPAIGN.body).toContain('gamer tag')
    expect(ONBOARDING_REMINDER_CAMPAIGN.body).toContain('setup assistant')
    expect(ONBOARDING_REMINDER_CAMPAIGN.body).toContain('YouTube gameplay link')
    expect(ONBOARDING_REMINDER_CAMPAIGN.body).toContain('Review each change')
    expect(ONBOARDING_REMINDER_CAMPAIGN.title).not.toContain('TKO')
    expect(ONBOARDING_REMINDER_CAMPAIGN.body).not.toContain('TKO')
  })

  it('fails closed without the service key and requires an explicit dry_run boolean', async () => {
    const app = createApp(makeDb())

    expect((await request(app).post('/api/internal/onboarding-reminder').send({ dry_run: true })).status)
      .toBe(401)
    expect((await request(app).post('/api/internal/onboarding-reminder')
      .set('x-tko-service', 'wrong-key')
      .send({ dry_run: true })).status).toBe(401)

    delete process.env.TKO_SERVICE_KEY
    expect((await request(app).post('/api/internal/onboarding-reminder')
      .set('x-tko-service', SERVICE_KEY)
      .send({ dry_run: true })).status).toBe(401)

    process.env.TKO_SERVICE_KEY = SERVICE_KEY
    const malformed = await request(app).post('/api/internal/onboarding-reminder')
      .set('x-tko-service', SERVICE_KEY)
      .send({ dry_run: 'true' })
    expect(malformed.status).toBe(400)
    expect(malformed.body.error).toBe('dry_run_boolean_required')
  })

  it('dry-runs without writes, notifies every profile once, and pushes only newly notified subscribers', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const alice = await addProfile(pool, 'campaign-alice')
    const bob = await addProfile(pool, 'campaign-bob')
    const carol = await addProfile(pool, 'campaign-carol')
    await addSubscription(pool, alice, 'https://push.test/alice-phone')
    await addSubscription(pool, bob, 'https://push.test/bob-phone')
    await addSubscription(pool, bob, 'https://push.test/bob-tablet')

    const sent: Array<{ endpoint: string; payload: any }> = []
    setPushSender(async (subscription: StoredSubscription, payloadJson: string) => {
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payloadJson) })
      return { ok: true, statusCode: 201 }
    })

    const dryRun = await request(app).post('/api/internal/onboarding-reminder')
      .set('x-tko-service', SERVICE_KEY)
      .send({ dry_run: true })
    expect(dryRun.status).toBe(200)
    expect(dryRun.body).toMatchObject({
      ok: true,
      dry_run: true,
      campaign_id: ONBOARDING_REMINDER_CAMPAIGN.id,
      kind: ONBOARDING_REMINDER_CAMPAIGN.kind,
      accounts_total: 3,
      already_notified: 0,
      notifications_pending: 3,
      notifications_created: 0,
      push_users_eligible: 2,
      push: { configured: true, attempted: 0, delivered: 0, removed: 0 },
    })
    expect((await pool.query('select 1 from notifications')).rows).toHaveLength(0)
    expect(sent).toHaveLength(0)

    const applied = await request(app).post('/api/internal/onboarding-reminder')
      .set('x-tko-service', SERVICE_KEY)
      .send({ dry_run: false })
    expect(applied.status).toBe(200)
    expect(applied.body).toMatchObject({
      ok: true,
      dry_run: false,
      accounts_total: 3,
      already_notified: 0,
      notifications_pending: 0,
      notifications_created: 3,
      push_users_eligible: 2,
      push: { configured: true, attempted: 3, delivered: 3, removed: 0 },
    })

    const notices = (await pool.query(
      `select user_id, kind, title, body, link, related_id
         from notifications
        order by user_id`,
    )).rows
    expect(notices).toHaveLength(3)
    expect(notices.map((row: any) => String(row.user_id)).sort()).toEqual([alice, bob, carol].sort())
    for (const notice of notices) {
      expect(notice).toMatchObject({
        kind: ONBOARDING_REMINDER_CAMPAIGN.kind,
        title: ONBOARDING_REMINDER_CAMPAIGN.title,
        body: ONBOARDING_REMINDER_CAMPAIGN.body,
        link: ONBOARDING_REMINDER_CAMPAIGN.link,
      })
      expect(String(notice.related_id)).toBe(ONBOARDING_REMINDER_CAMPAIGN.id)
    }
    expect(sent.map((item) => item.endpoint).sort()).toEqual([
      'https://push.test/alice-phone',
      'https://push.test/bob-phone',
      'https://push.test/bob-tablet',
    ])
    for (const item of sent) {
      expect(item.payload).toEqual({
        title: ONBOARDING_REMINDER_CAMPAIGN.title,
        body: ONBOARDING_REMINDER_CAMPAIGN.body,
        url: ONBOARDING_REMINDER_CAMPAIGN.link,
        tag: ONBOARDING_REMINDER_CAMPAIGN.tag,
      })
    }

    const retried = await request(app).post('/api/internal/onboarding-reminder')
      .set('x-tko-service', SERVICE_KEY)
      .send({ dry_run: false })
    expect(retried.status).toBe(200)
    expect(retried.body).toMatchObject({
      ok: true,
      accounts_total: 3,
      already_notified: 3,
      notifications_created: 0,
      push_users_eligible: 0,
      push: { configured: true, attempted: 0, delivered: 0, removed: 0 },
    })
    expect((await pool.query('select 1 from notifications')).rows).toHaveLength(3)
    expect(sent).toHaveLength(3)
  })

  it('does not let the previous roster reminder suppress this new chat campaign', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const userId = await addProfile(pool, 'previous-campaign-member')
    await pool.query(
      `insert into notifications (user_id,kind,title,body,link,related_id)
       values ($1,'onboarding_setup_reminder_2026_08_09','Old setup reminder','Old body',
               '/profile?tab=about#my-clan-rosters',$2)`,
      [userId, '00000000-0000-4000-8000-000020260809'],
    )

    const first = await request(app).post('/api/internal/onboarding-reminder')
      .set('x-tko-service', SERVICE_KEY)
      .send({ dry_run: false })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({
      accounts_total: 1,
      already_notified: 0,
      notifications_created: 1,
    })

    const current = await pool.query(
      `select link from notifications where user_id=$1 and kind=$2 and related_id=$3`,
      [userId, ONBOARDING_REMINDER_CAMPAIGN.kind, ONBOARDING_REMINDER_CAMPAIGN.id],
    )
    expect(current.rows).toEqual([{ link: '/setup' }])

    const retry = await request(app).post('/api/internal/onboarding-reminder')
      .set('x-tko-service', SERVICE_KEY)
      .send({ dry_run: false })
    expect(retry.status).toBe(200)
    expect(retry.body).toMatchObject({
      accounts_total: 1,
      already_notified: 1,
      notifications_created: 0,
    })
    expect((await pool.query('select id from notifications where user_id=$1', [userId])).rows).toHaveLength(2)
  })
})
