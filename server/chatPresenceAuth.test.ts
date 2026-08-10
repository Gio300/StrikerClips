/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regression guard for the chat-presence room-membership gate.
 *
 * The handler authenticates the caller (uid) and validates that the room key is
 * well-formed, but for `scope:'dm'` neither of those proves the caller belongs
 * in the conversation. Before the gate existed, any signed-in stranger could
 * POST someone else's conversation id and both READ the roster (each
 * participant's user id, username, avatar and last-seen) and WRITE themselves
 * into it -- a private two-person DM would render "outsider is typing...".
 *
 * These tests fail loudly if that gate is ever removed or narrowed.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

const ADULT_DOB = '1995-06-15'
type Who = { token: string; id: string }

async function signUp(app: any, email: string, username: string): Promise<Who> {
  const response = await request(app).post('/api/auth/signup').send({
    email, password: 'password123', username, date_of_birth: ADULT_DOB,
  })
  expect(response.status).toBe(200)
  return { token: response.body.token, id: response.body.user.id }
}

function fn(app: any, who: Who, name: string, body: any) {
  return request(app).post(`/api/fn/${name}`)
    .set('Authorization', `Bearer ${who.token}`).send(body)
}

describe('chat-presence enforces DM room membership', () => {
  let app: any
  let alice: Who
  let bob: Who
  let outsider: Who
  let conversationId: string

  beforeEach(async () => {
    app = createApp(makeDb())
    alice = await signUp(app, 'pres-alice@tko.cam', 'pres_alice')
    bob = await signUp(app, 'pres-bob@tko.cam', 'pres_bob')
    outsider = await signUp(app, 'pres-outsider@tko.cam', 'pres_outsider')
    const opened = await fn(app, alice, 'dm-open', { targetUserId: bob.id })
    expect(opened.status).toBe(200)
    conversationId = opened.body.conversation_id
  })

  it('lets a participant join their own DM presence room', async () => {
    const res = await fn(app, alice, 'chat-presence', {
      scope: 'dm', roomId: conversationId,
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.members.map((m: any) => m.userId)).toContain(alice.id)
  })

  it('refuses a stranger, and leaks neither the roster nor the conversation', async () => {
    const res = await fn(app, outsider, 'chat-presence', {
      scope: 'dm', roomId: conversationId,
    })
    // 404 rather than 403 -- a 403 would confirm the conversation exists and
    // turn the endpoint into an id-enumeration oracle.
    expect(res.status).toBe(404)
    expect(res.body.ok).toBe(false)
    expect(JSON.stringify(res.body)).not.toContain(alice.id)
    expect(JSON.stringify(res.body)).not.toContain(bob.id)
    expect(res.body.members).toBeUndefined()
  })

  it('a refused stranger cannot appear as typing to the real participants', async () => {
    await fn(app, outsider, 'chat-presence', {
      scope: 'dm', roomId: conversationId, typing: true,
    })
    const seen = await fn(app, bob, 'chat-presence', {
      scope: 'dm', roomId: conversationId,
    })
    expect(seen.status).toBe(200)
    expect(seen.body.members.map((m: any) => m.userId)).not.toContain(outsider.id)
  })

  it('still allows non-DM scopes without a membership table', async () => {
    // stream/tournament/channel rooms are public surfaces; the gate must not
    // accidentally lock those, which would silently kill presence everywhere.
    const res = await fn(app, outsider, 'chat-presence', {
      scope: 'stream', roomId: conversationId,
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})
