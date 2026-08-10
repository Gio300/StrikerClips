/* eslint-disable @typescript-eslint/no-explicit-any */
// =============================================================================
// PHONE PUSH — the four guarantees that make this feature shippable.
//
//   1. subscribe / unsubscribe is a real round trip, and one browser install is
//      one row no matter how many times it subscribes.
//   2. a push service answering 410 Gone means the row is DELETED, not retried
//      forever. Otherwise the table fills with corpses and every send to that
//      member gets slower for good.
//   3. the SENDER is never notified about their own message, and neither is a
//      member who is currently sitting in that exact conversation. (The "why did
//      my phone buzz for a message I am looking at" bug.)
//   4. with no VAPID keys configured, NOTHING happens: no rows, no sends, no
//      throw, and the client is told the feature is off so it hides the control.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'
import {
  isDeadSubscription,
  parseIncomingSubscription,
  pushRecipients,
  readVapidConfig,
  sendPushToUser,
  serializePayload,
  setPushSender,
  type PushSender,
  type StoredSubscription,
} from './webPush'

const ADULT_DOB = '1995-06-15'

// A real-looking (but inert) VAPID pair. These are only ever handed to the FAKE
// sender in this file — nothing here talks to a push service.
const TEST_PUBLIC_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
const TEST_PRIVATE_KEY = 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls'

type Who = { token: string; id: string }

async function signUp(app: any, email: string, username: string): Promise<Who> {
  const response = await request(app).post('/api/auth/signup').send({
    email,
    password: 'password123',
    username,
    date_of_birth: ADULT_DOB,
  })
  expect(response.status).toBe(200)
  return { token: response.body.token, id: response.body.user.id }
}

function fn(app: any, who: Who, name: string, body: any) {
  return request(app)
    .post(`/api/fn/${name}`)
    .set('Authorization', `Bearer ${who.token}`)
    .send(body)
}

function subscriptionBody(endpoint: string) {
  return {
    subscription: {
      endpoint,
      keys: { p256dh: 'BPtestPublicKeyValueGoesHere', auth: 'dGVzdEF1dGhTZWNyZXQ' },
    },
  }
}

/** A recording sender. `statusFor` decides what the push service "answers". */
function fakeSender(statusFor: (endpoint: string) => number | null = () => 201) {
  const sent: { endpoint: string; payload: any }[] = []
  const sender: PushSender = async (subscription: StoredSubscription, payloadJson: string) => {
    const status = statusFor(subscription.endpoint)
    if (status !== null && status >= 200 && status < 300) {
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payloadJson) })
      return { ok: true, statusCode: status }
    }
    return { ok: false, statusCode: status, message: 'rejected' }
  }
  return { sender, sent }
}

const ORIGINAL_ENV = {
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT,
}

function configureVapid() {
  process.env.VAPID_PUBLIC_KEY = TEST_PUBLIC_KEY
  process.env.VAPID_PRIVATE_KEY = TEST_PRIVATE_KEY
  process.env.VAPID_SUBJECT = 'mailto:test@tko.cam'
}

function unconfigureVapid() {
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
  delete process.env.VAPID_SUBJECT
}

describe('phone push — recipient rules (pure)', () => {
  it('NEVER notifies the sender about their own message', () => {
    const recipients = pushRecipients({
      candidates: ['alice', 'bob', 'carol'],
      senderId: 'bob',
    })
    expect(recipients).toEqual(['alice', 'carol'])
  })

  it('never notifies someone who is currently in that exact conversation', () => {
    const recipients = pushRecipients({
      candidates: ['alice', 'bob', 'carol'],
      senderId: 'bob',
      // Carol has the thread open right now — her phone must stay quiet.
      activeUserIds: ['carol', 'bob'],
    })
    expect(recipients).toEqual(['alice'])
  })

  it('de-duplicates and ignores blanks, case-insensitively', () => {
    const recipients = pushRecipients({
      candidates: ['Alice', 'alice', '', null as any, '  ', 'Carol'],
      senderId: 'BOB',
      activeUserIds: [null as any, ''],
    })
    expect(recipients).toEqual(['Alice', 'Carol'])
  })

  it('notifies nobody when the sender is the only candidate', () => {
    expect(pushRecipients({ candidates: ['bob'], senderId: 'bob' })).toEqual([])
  })
})

describe('phone push — payload and subscription parsing (pure)', () => {
  it('accepts the browser shape and rejects anything unusable', () => {
    expect(
      parseIncomingSubscription({
        endpoint: 'https://push.example/abc',
        keys: { p256dh: 'key', auth: 'secret' },
      }),
    ).toEqual({ endpoint: 'https://push.example/abc', p256dh: 'key', auth: 'secret', userAgent: null })

    expect(parseIncomingSubscription(null)).toBeNull()
    expect(parseIncomingSubscription({ endpoint: 'https://push.example/abc' })).toBeNull()
    // Not https — never a real push endpoint, and not somewhere we will POST to.
    expect(
      parseIncomingSubscription({
        endpoint: 'http://internal.local/abc',
        keys: { p256dh: 'key', auth: 'secret' },
      }),
    ).toBeNull()
  })

  it('always carries a title and a collapse tag on the wire', () => {
    const payload = JSON.parse(
      serializePayload({ title: '', body: 'hello', url: '/messages', tag: 'dm:1' }),
    )
    expect(payload.title).toBe('TKO.cam')
    expect(payload.tag).toBe('dm:1')
    expect(payload.url).toBe('/messages')
  })

  it('treats only 404 and 410 as a dead subscription', () => {
    expect(isDeadSubscription(404)).toBe(true)
    expect(isDeadSubscription(410)).toBe(true)
    expect(isDeadSubscription(429)).toBe(false)
    expect(isDeadSubscription(500)).toBe(false)
    expect(isDeadSubscription(null)).toBe(false)
  })
})

describe('phone push — subscriptions and delivery', () => {
  let pool: any
  let app: any
  let alice: Who
  let bob: Who

  beforeEach(async () => {
    configureVapid()
    setPushSender(null)
    pool = makeDb()
    app = createApp(pool)
    alice = await signUp(app, 'push-alice@tko.cam', 'push_alice')
    bob = await signUp(app, 'push-bob@tko.cam', 'push_bob')
  })

  afterEach(() => {
    setPushSender(null)
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete (process.env as any)[key]
      else (process.env as any)[key] = value
    }
  })

  it('reports the public key so the browser can subscribe', async () => {
    const response = await fn(app, alice, 'push-config', {})
    expect(response.status).toBe(200)
    expect(response.body.enabled).toBe(true)
    expect(response.body.publicKey).toBe(TEST_PUBLIC_KEY)
  })

  it('reports read-only push configuration before signup without authentication', async () => {
    const response = await request(app).get('/api/push/config')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      ok: true,
      enabled: true,
      publicKey: TEST_PUBLIC_KEY,
    })
  })

  it('round trips subscribe and unsubscribe', async () => {
    const endpoint = 'https://push.example.com/alice-device-1'

    const subscribed = await fn(app, alice, 'push-subscribe', subscriptionBody(endpoint))
    expect(subscribed.status).toBe(200)
    expect(subscribed.body.ok).toBe(true)

    const stored = await pool.query('select user_id, endpoint, auth from push_subscriptions')
    expect(stored.rows).toHaveLength(1)
    expect(String(stored.rows[0].user_id)).toBe(alice.id)
    expect(stored.rows[0].endpoint).toBe(endpoint)

    const unsubscribed = await fn(app, alice, 'push-unsubscribe', { endpoint })
    expect(unsubscribed.status).toBe(200)
    expect(unsubscribed.body.removed).toBe(1)

    const after = await pool.query('select 1 from push_subscriptions')
    expect(after.rows).toHaveLength(0)
  })

  it('keeps one browser install to one row, and re-binds it when the device changes hands', async () => {
    const endpoint = 'https://push.example.com/shared-phone'
    await fn(app, alice, 'push-subscribe', subscriptionBody(endpoint))
    await fn(app, alice, 'push-subscribe', subscriptionBody(endpoint))

    let rows = await pool.query('select user_id from push_subscriptions')
    expect(rows.rows).toHaveLength(1)

    // Bob signs in on the same phone. The endpoint must move, not duplicate —
    // otherwise Alice's messages would buzz on a device she no longer holds.
    await fn(app, bob, 'push-subscribe', subscriptionBody(endpoint))
    rows = await pool.query('select user_id from push_subscriptions')
    expect(rows.rows).toHaveLength(1)
    expect(String(rows.rows[0].user_id)).toBe(bob.id)
  })

  it('will not let one member unsubscribe another member device', async () => {
    const endpoint = 'https://push.example.com/alice-device-2'
    await fn(app, alice, 'push-subscribe', subscriptionBody(endpoint))

    const attacked = await fn(app, bob, 'push-unsubscribe', { endpoint })
    expect(attacked.status).toBe(200)
    expect(attacked.body.removed).toBe(0)

    const rows = await pool.query('select 1 from push_subscriptions')
    expect(rows.rows).toHaveLength(1)
  })

  it('DELETES a subscription the push service reports as gone (410)', async () => {
    const live = 'https://push.example.com/alive'
    const dead = 'https://push.example.com/dead'
    await fn(app, alice, 'push-subscribe', subscriptionBody(live))
    await fn(app, alice, 'push-subscribe', subscriptionBody(dead))
    expect((await pool.query('select 1 from push_subscriptions')).rows).toHaveLength(2)

    const { sender, sent } = fakeSender((endpoint) => (endpoint === dead ? 410 : 201))
    const summary = await sendPushToUser(
      pool,
      alice.id,
      { title: 'hi', body: 'there' },
      { sender },
    )

    expect(summary.attempted).toBe(2)
    expect(summary.delivered).toBe(1)
    expect(summary.removed).toBe(1)
    expect(sent.map((s) => s.endpoint)).toEqual([live])

    const rows = await pool.query('select endpoint from push_subscriptions')
    expect(rows.rows.map((r: any) => r.endpoint)).toEqual([live])
  })

  it('KEEPS a subscription after a transient failure — a bad minute is not death', async () => {
    const endpoint = 'https://push.example.com/flaky'
    await fn(app, alice, 'push-subscribe', subscriptionBody(endpoint))

    const { sender } = fakeSender(() => 503)
    const summary = await sendPushToUser(pool, alice.id, { title: 'hi' }, { sender })

    expect(summary.attempted).toBe(1)
    expect(summary.delivered).toBe(0)
    expect(summary.removed).toBe(0)
    expect((await pool.query('select 1 from push_subscriptions')).rows).toHaveLength(1)
  })

  it('never throws when the transport blows up', async () => {
    await fn(app, alice, 'push-subscribe', subscriptionBody('https://push.example.com/boom'))
    const exploding: PushSender = async () => {
      throw new Error('socket hang up')
    }
    const summary = await sendPushToUser(pool, alice.id, { title: 'hi' }, { sender: exploding })
    expect(summary.configured).toBe(true)
    expect(summary.delivered).toBe(0)
    // Not dead, just broken — the row survives.
    expect((await pool.query('select 1 from push_subscriptions')).rows).toHaveLength(1)
  })

  it('buzzes the recipient of a direct message, once, with a conversation tag', async () => {
    const endpoint = 'https://push.example.com/bob-phone'
    await fn(app, bob, 'push-subscribe', subscriptionBody(endpoint))

    const { sender, sent } = fakeSender()
    setPushSender(sender)

    const opened = await fn(app, alice, 'dm-open', { targetUserId: bob.id })
    expect(opened.status).toBe(200)
    const conversationId = opened.body.conversation_id

    const sendResult = await fn(app, alice, 'dm-send', {
      conversationId,
      content: 'yo, ranked in 10?',
    })
    expect(sendResult.status).toBe(200)

    expect(sent).toHaveLength(1)
    expect(sent[0].endpoint).toBe(endpoint)
    expect(sent[0].payload.title).toContain('push_alice')
    expect(sent[0].payload.body).toBe('yo, ranked in 10?')
    expect(sent[0].payload.url).toBe(`/messages?conversation=${conversationId}`)
    // Keyed to the conversation so a burst collapses into one line.
    expect(sent[0].payload.tag).toBe(`dm:${conversationId}`)
  })

  it('never buzzes the SENDER of a direct message', async () => {
    // Alice is subscribed; Bob is not. Alice sends. Nothing may go anywhere.
    await fn(app, alice, 'push-subscribe', subscriptionBody('https://push.example.com/alice-own'))

    const { sender, sent } = fakeSender()
    setPushSender(sender)

    const opened = await fn(app, alice, 'dm-open', { targetUserId: bob.id })
    const sendResult = await fn(app, alice, 'dm-send', {
      conversationId: opened.body.conversation_id,
      content: 'talking to myself',
    })
    expect(sendResult.status).toBe(200)
    expect(sent).toHaveLength(0)
  })

  it('does not buzz a recipient who is sitting in that exact conversation', async () => {
    const endpoint = 'https://push.example.com/bob-reading'
    await fn(app, bob, 'push-subscribe', subscriptionBody(endpoint))

    const opened = await fn(app, alice, 'dm-open', { targetUserId: bob.id })
    const conversationId = opened.body.conversation_id

    // Bob's tab heartbeats into the presence registry for THIS conversation.
    const presence = await fn(app, bob, 'chat-presence', { scope: 'dm', roomId: conversationId })
    expect(presence.status).toBe(200)

    const { sender, sent } = fakeSender()
    setPushSender(sender)

    const sendResult = await fn(app, alice, 'dm-send', {
      conversationId,
      content: 'you are literally looking at this',
    })
    expect(sendResult.status).toBe(200)
    expect(sent).toHaveLength(0)
  })

  it('buzzes a member @mentioned in a room, and not the author', async () => {
    const bobEndpoint = 'https://push.example.com/bob-mention'
    await fn(app, bob, 'push-subscribe', subscriptionBody(bobEndpoint))
    await fn(app, alice, 'push-subscribe', subscriptionBody('https://push.example.com/alice-mention'))

    const streamId = (
      await pool.query(
        `insert into live_streams (user_id, title, youtube_url, is_live)
         values ($1, $2, $3, true) returning id`,
        [alice.id, 'ranked night', 'https://www.youtube.com/watch?v=abcdefghijk'],
      )
    ).rows[0].id

    const { sender, sent } = fakeSender()
    setPushSender(sender)

    const content = 'gg @push_bob that was clean'
    const inserted = await request(app)
      .post('/api/db')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({
        table: 'stream_messages',
        action: 'insert',
        values: {
          stream_id: streamId,
          user_id: alice.id,
          content,
          mentions: [
            { user_id: bob.id, username: 'push_bob', start: 3, end: 12 },
            // Alice mentioning herself must not buzz her own phone.
            { user_id: alice.id, username: 'push_alice', start: -1, end: -1 },
          ],
        },
      })
    expect(inserted.status).toBe(200)

    expect(sent).toHaveLength(1)
    expect(sent[0].endpoint).toBe(bobEndpoint)
    expect(sent[0].payload.title).toBe('@push_alice mentioned you')
    expect(sent[0].payload.body).toBe(content)
    expect(sent[0].payload.url).toBe(`/watch/${streamId}`)
    expect(sent[0].payload.tag).toBe(`mention:stream:${streamId}`)
  })
})

describe('phone push — with no VAPID keys configured', () => {
  let pool: any
  let app: any
  let alice: Who
  let bob: Who

  beforeEach(async () => {
    unconfigureVapid()
    setPushSender(null)
    pool = makeDb()
    app = createApp(pool)
    alice = await signUp(app, 'quiet-alice@tko.cam', 'quiet_alice')
    bob = await signUp(app, 'quiet-bob@tko.cam', 'quiet_bob')
  })

  afterEach(() => {
    setPushSender(null)
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete (process.env as any)[key]
      else (process.env as any)[key] = value
    }
  })

  it('reads as unconfigured, so the client hides the control', async () => {
    expect(readVapidConfig({})).toBeNull()
    const response = await fn(app, alice, 'push-config', {})
    expect(response.status).toBe(200)
    expect(response.body.enabled).toBe(false)
    expect(response.body.publicKey).toBeNull()
  })

  it('refuses to store a subscription rather than banking one for later', async () => {
    const response = await fn(
      app,
      alice,
      'push-subscribe',
      subscriptionBody('https://push.example.com/nope'),
    )
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(false)
    expect(response.body.enabled).toBe(false)
    expect((await pool.query('select 1 from push_subscriptions')).rows).toHaveLength(0)
  })

  it('sends nothing, touches nothing, and throws nothing when a DM is sent', async () => {
    // A subscription written before the keys were removed. Even so: silence.
    await pool.query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
       values ($1, $2, $3, $4)`,
      [bob.id, 'https://push.example.com/legacy', 'key', 'secret'],
    )

    const { sender, sent } = fakeSender()
    setPushSender(sender)

    const opened = await fn(app, alice, 'dm-open', { targetUserId: bob.id })
    const sendResult = await fn(app, alice, 'dm-send', {
      conversationId: opened.body.conversation_id,
      content: 'this must not buzz anybody',
    })

    // The MESSAGE still sends. That is the point of "degrade, never crash".
    expect(sendResult.status).toBe(200)
    expect(sendResult.body.ok).toBe(true)
    expect(sent).toHaveLength(0)

    const summary = await sendPushToUser(pool, bob.id, { title: 'hi' }, { sender })
    expect(summary.configured).toBe(false)
    expect(summary.attempted).toBe(0)
  })
})
