/* eslint-disable @typescript-eslint/no-explicit-any */
// =============================================================================
// PHONE PUSH — SECURITY REGRESSIONS
//
// Two holes found by adversarial review of the push slice, both reproduced by
// running the code, both reachable from any ordinary authenticated account.
//
//   1. SPOOFED MENTION -> ARBITRARY PUSH TO ANYONE'S PHONE.
//      sanitizeMentions() proves the message TEXT and the mention's `username`
//      agree. It cannot prove the attached `userId` is that person's -- both
//      fields come from the client. So "gg @alice was clean" carrying Carol's
//      id passed every check and pushed attacker-chosen text to Carol's phone.
//      Fixed by resolving each (id, username) pair against profiles and keeping
//      only the pairs the database itself agrees on.
//
//   2. ENDPOINT HIJACK -> SILENCING SOMEONE'S PHONE.
//      saveSubscription() deleted by endpoint alone, so posting another user's
//      endpoint re-bound their device to the caller. The victim's next DM
//      produced zero pushes, with nothing to notice. An endpoint is not a
//      secret -- it travels in logs and error reports. Fixed by requiring the
//      endpoint's CURRENT p256dh/auth as proof for a cross-user re-bind.
//
// Both failures are silent by design when they trip, so only a test keeps them
// closed.
// =============================================================================
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'
import { setPushSender, type PushSender } from './webPush'

const ADULT_DOB = '1995-06-15'
const TEST_PUBLIC_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
const TEST_PRIVATE_KEY = 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls'

type Who = { token: string; id: string }

async function signUp(app: any, email: string, username: string): Promise<Who> {
  const r = await request(app).post('/api/auth/signup').send({
    email, password: 'password123', username, date_of_birth: ADULT_DOB,
  })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}
const fn = (app: any, who: Who, name: string, body: any) =>
  request(app).post(`/api/fn/${name}`).set('Authorization', `Bearer ${who.token}`).send(body)
const db = (app: any, who: Who, body: any) =>
  request(app).post('/api/db').set('Authorization', `Bearer ${who.token}`).send(body)

const sub = (endpoint: string, p256dh = 'k-real', auth = 'a-real') =>
  ({ subscription: { endpoint, keys: { p256dh, auth } } })

describe('push security', () => {
  let app: any, pool: any
  let mallory: Who, victim: Who, bystander: Who
  let sent: any[]

  beforeEach(async () => {
    process.env.VAPID_PUBLIC_KEY = TEST_PUBLIC_KEY
    process.env.VAPID_PRIVATE_KEY = TEST_PRIVATE_KEY
    process.env.VAPID_SUBJECT = 'mailto:ops@tko.cam'
    pool = makeDb()
    app = createApp(pool)
    sent = []
    // MUST return ok:true -- the send path only records a delivery when the
    // sender reports success. A fake that omits it records nothing, which makes
    // every "expect(sent).toHaveLength(0)" pass for the wrong reason. That is
    // exactly how a security test comes out green while proving nothing.
    const sender: PushSender = async (s: any, payload: any) => {
      sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) })
      return { ok: true, statusCode: 201 } as any
    }
    setPushSender(sender)
    mallory = await signUp(app, 'sec-mallory@tko.cam', 'sec_mallory')
    victim = await signUp(app, 'sec-victim@tko.cam', 'sec_victim')
    bystander = await signUp(app, 'sec-bystander@tko.cam', 'sec_bystander')
  })

  // ── 1. spoofed mention ────────────────────────────────────────────────────
  it('refuses a mention whose userId does not belong to the username in the text', async () => {
    await fn(app, victim, 'push-subscribe', sub('https://push.example.com/victim'))
    const stream = (await pool.query(
      `insert into live_streams (user_id, title, youtube_url, is_live)
       values ($1,$2,$3,true) returning id`,
      [mallory.id, 'sec stream', 'https://www.youtube.com/watch?v=abcdefghijk'],
    )).rows[0]

    // The text names sec_mallory. The attached id is the VICTIM's.
    const r = await db(app, mallory, {
      table: 'stream_messages', action: 'insert',
      values: {
        stream_id: stream.id, user_id: mallory.id,
        content: 'gg @sec_mallory was clean',
        mentions: [{ user_id: victim.id, username: 'sec_mallory', start: 3, end: 15 }],
      },
    })
    expect(r.status).toBe(200)          // the message still posts
    expect(sent, 'victim must not be buzzed by a forged pairing').toHaveLength(0)
  })

  it('still notifies a genuine mention', async () => {
    await fn(app, victim, 'push-subscribe', sub('https://push.example.com/victim-ok'))
    const stream = (await pool.query(
      `insert into live_streams (user_id, title, youtube_url, is_live)
       values ($1,$2,$3,true) returning id`,
      [mallory.id, 'sec stream 2', 'https://www.youtube.com/watch?v=bbcdefghijk'],
    )).rows[0]
    const r = await db(app, mallory, {
      table: 'stream_messages', action: 'insert',
      values: {
        stream_id: stream.id, user_id: mallory.id,
        content: 'gg @sec_victim was clean',
        mentions: [{ user_id: victim.id, username: 'sec_victim', start: 3, end: 14 }],
      },
    })
    expect(r.status).toBe(200)
    // The fix must not break the feature it protects.
    expect(sent).toHaveLength(1)
    expect(sent[0].endpoint).toBe('https://push.example.com/victim-ok')
  })

  // ── 2. endpoint hijack ────────────────────────────────────────────────────
  it('refuses to re-bind another user endpoint without its current keys', async () => {
    const ep = 'https://push.example.com/victim-device'
    expect((await fn(app, victim, 'push-subscribe', sub(ep))).body.ok).toBe(true)

    // Mallory knows the endpoint string but not the device's keys.
    const steal = await fn(app, mallory, 'push-subscribe', sub(ep, 'k-guess', 'a-guess'))
    expect(steal.body.ok, 'a keyless cross-user claim must fail').toBe(false)

    const owner = await pool.query(
      'select user_id from push_subscriptions where endpoint = $1', [ep])
    expect(String(owner.rows[0].user_id), 'endpoint must still be the victim\'s')
      .toBe(String(victim.id))
  })

  it('allows the real device to re-bind, keys in hand', async () => {
    const ep = 'https://push.example.com/shared-phone'
    await fn(app, victim, 'push-subscribe', sub(ep))
    // Same browser, same PushManager keys, different account signing in.
    const rebind = await fn(app, bystander, 'push-subscribe', sub(ep))
    expect(rebind.body.ok, 'a genuine re-bind must still work').toBe(true)
    const owner = await pool.query(
      'select user_id from push_subscriptions where endpoint = $1', [ep])
    expect(String(owner.rows[0].user_id)).toBe(String(bystander.id))
    expect(owner.rows).toHaveLength(1)   // never two accounts on one device
  })
})
