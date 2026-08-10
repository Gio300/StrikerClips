/* eslint-disable @typescript-eslint/no-explicit-any */
// Chat presence + typing, and the Ask TKO rate limit.
//
// The registry is unit-tested directly (expiry, caps, ghost-proofing) and the
// `chat-presence` fn is exercised end-to-end through the real createApp against
// the in-memory harness, because the parts that matter — identity coming from
// the JWT and not the request body, and a 400 on a junk room — only exist at
// that seam.
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { makeDb } from './testHarness'
import { createApp, ASK_MAX_PER_WINDOW } from './app'
import {
  ChatPresenceRegistry,
  chatRoomKey,
  slidingWindowAllow,
  MAX_MEMBERS_PER_ROOM,
  PRESENCE_TTL_MS,
  TYPING_TTL_MS,
} from './chatPresence'

const ADULT_DOB = '1995-06-15'
const NOW = 1_800_000_000_000

async function signUp(app: any, email: string, username: string) {
  const r = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token as string, id: r.body.user.id as string }
}

describe('chatRoomKey', () => {
  it('accepts the four real scopes and rejects everything else', () => {
    expect(chatRoomKey('stream', 's1')).toBe('stream:s1')
    expect(chatRoomKey('dm', 'd1')).toBe('dm:d1')
    expect(chatRoomKey('reels', 'r1')).toBeNull()
  })

  it('bounds the key space — no free-text room names', () => {
    expect(chatRoomKey('stream', '')).toBeNull()
    expect(chatRoomKey('stream', 'a'.repeat(129))).toBeNull()
    expect(chatRoomKey('stream', "'; drop table profiles; --")).toBeNull()
  })
})

describe('ChatPresenceRegistry', () => {
  let reg: ChatPresenceRegistry
  beforeEach(() => { reg = new ChatPresenceRegistry() })

  it('tracks a heartbeat and reports the member', () => {
    reg.touch('stream:s1', 'u1', {}, NOW)
    expect(reg.members('stream:s1', NOW).map((m) => m.userId)).toEqual(['u1'])
  })

  it('EXPIRES a member whose heartbeat went stale — no ghost in the roster', () => {
    reg.touch('stream:s1', 'u1', {}, NOW)
    expect(reg.members('stream:s1', NOW + PRESENCE_TTL_MS - 1)).toHaveLength(1)
    expect(reg.members('stream:s1', NOW + PRESENCE_TTL_MS + 1)).toHaveLength(0)
    // …and the emptied room is dropped, so nothing accumulates.
    expect(reg.roomCount()).toBe(0)
  })

  it('EXPIRES a typing flag on its own — a client killed mid-keystroke stops typing', () => {
    reg.touch('stream:s1', 'u1', { typing: true }, NOW)
    const entry = reg.members('stream:s1', NOW)[0]
    expect(entry.typingUntil).toBe(NOW + TYPING_TTL_MS)
    // No "stop typing" message exists to be lost: the instant simply passes.
    expect(entry.typingUntil).toBeLessThan(NOW + TYPING_TTL_MS + 1)
  })

  it('does not extend typing on an ordinary heartbeat', () => {
    reg.touch('stream:s1', 'u1', { typing: true }, NOW)
    reg.touch('stream:s1', 'u1', {}, NOW + 3_000)
    // Still the ORIGINAL expiry — heartbeating is not typing.
    expect(reg.members('stream:s1', NOW + 3_000)[0].typingUntil).toBe(NOW + TYPING_TTL_MS)
  })

  it('extends typing when the user keeps typing', () => {
    reg.touch('stream:s1', 'u1', { typing: true }, NOW)
    reg.touch('stream:s1', 'u1', { typing: true }, NOW + 3_000)
    expect(reg.members('stream:s1', NOW + 3_000)[0].typingUntil).toBe(NOW + 3_000 + TYPING_TTL_MS)
  })

  it('removes a member on an explicit leave', () => {
    reg.touch('stream:s1', 'u1', {}, NOW)
    reg.touch('stream:s1', 'u2', {}, NOW)
    reg.leave('stream:s1', 'u1')
    expect(reg.members('stream:s1', NOW).map((m) => m.userId)).toEqual(['u2'])
  })

  it('keeps rooms isolated from each other', () => {
    reg.touch('stream:s1', 'u1', {}, NOW)
    reg.touch('dm:d1', 'u2', {}, NOW)
    expect(reg.members('stream:s1', NOW)).toHaveLength(1)
    expect(reg.members('dm:d1', NOW)).toHaveLength(1)
  })

  it('caps members per room instead of growing without bound', () => {
    for (let i = 0; i < MAX_MEMBERS_PER_ROOM + 50; i++) {
      reg.touch('stream:s1', `u${i}`, {}, NOW)
    }
    expect(reg.members('stream:s1', NOW).length).toBeLessThanOrEqual(MAX_MEMBERS_PER_ROOM)
  })

  it('reclaims capacity once the crowd goes stale', () => {
    for (let i = 0; i < MAX_MEMBERS_PER_ROOM; i++) reg.touch('stream:s1', `u${i}`, {}, NOW)
    const later = NOW + PRESENCE_TTL_MS + 1
    reg.touch('stream:s1', 'newcomer', {}, later)
    expect(reg.members('stream:s1', later).map((m) => m.userId)).toEqual(['newcomer'])
  })

  it('sweeps every room at once', () => {
    reg.touch('stream:s1', 'u1', {}, NOW)
    reg.touch('dm:d1', 'u2', {}, NOW)
    reg.sweep(NOW + PRESENCE_TTL_MS + 1)
    expect(reg.roomCount()).toBe(0)
  })

  it('ignores empty keys and ids rather than creating junk rooms', () => {
    reg.touch('', 'u1', {}, NOW)
    reg.touch('stream:s1', '', {}, NOW)
    expect(reg.roomCount()).toBe(0)
  })
})

describe('slidingWindowAllow', () => {
  it('allows up to the cap, then refuses with a wait', () => {
    let hits: number[] = []
    for (let i = 0; i < 3; i++) {
      const r = slidingWindowAllow(hits, NOW, 60_000, 3)
      expect(r.allowed).toBe(true)
      hits = r.hits
    }
    const blocked = slidingWindowAllow(hits, NOW, 60_000, 3)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBe(60_000)
  })

  it('lets the window slide — old hits stop counting', () => {
    const hits = [NOW, NOW, NOW]
    const r = slidingWindowAllow(hits, NOW + 60_001, 60_000, 3)
    expect(r.allowed).toBe(true)
    expect(r.hits).toEqual([NOW + 60_001])
  })
})

describe('POST /api/fn/chat-presence', () => {
  let app: any
  beforeEach(() => { app = createApp(makeDb()) })

  it('requires a signed-in caller', async () => {
    const r = await request(app).post('/api/fn/chat-presence').send({ scope: 'stream', roomId: 's1' })
    expect(r.status).toBe(401)
  })

  it('400s on a scope or room it does not recognise', async () => {
    const u = await signUp(app, 'p1@kc.gg', 'pone')
    for (const body of [{ scope: 'reels', roomId: 's1' }, { scope: 'stream', roomId: '' }, {}]) {
      const r = await request(app)
        .post('/api/fn/chat-presence')
        .set('Authorization', `Bearer ${u.token}`)
        .send(body)
      expect(r.status).toBe(400)
      expect(r.body.ok).toBe(false)
    }
  })

  it('returns the caller in the roster, with identity resolved from the JWT', async () => {
    const u = await signUp(app, 'p2@kc.gg', 'ptwo')
    const r = await request(app)
      .post('/api/fn/chat-presence')
      .set('Authorization', `Bearer ${u.token}`)
      // A hostile client sends a username; it must be ignored entirely.
      .send({ scope: 'stream', roomId: 's1', username: 'TKO Staff', userId: 'somebody-else' })
    expect(r.body.ok).toBe(true)
    expect(r.body.members).toHaveLength(1)
    expect(r.body.members[0].userId).toBe(u.id)
    expect(r.body.members[0].username).toBe('ptwo')
    expect(r.body.members[0].username).not.toBe('TKO Staff')
  })

  it('shows two people in the same room, and keeps other rooms separate', async () => {
    const a = await signUp(app, 'a@kc.gg', 'aaa')
    const b = await signUp(app, 'b@kc.gg', 'bbb')
    await request(app).post('/api/fn/chat-presence').set('Authorization', `Bearer ${a.token}`).send({ scope: 'stream', roomId: 's1' })
    const both = await request(app).post('/api/fn/chat-presence').set('Authorization', `Bearer ${b.token}`).send({ scope: 'stream', roomId: 's1' })
    expect(both.body.members.map((m: any) => m.userId).sort()).toEqual([a.id, b.id].sort())

    const other = await request(app).post('/api/fn/chat-presence').set('Authorization', `Bearer ${b.token}`).send({ scope: 'stream', roomId: 's2' })
    expect(other.body.members).toHaveLength(1)
  })

  // Scope is 'channel', not 'dm'. This case is about typing-flag SEMANTICS and
  // is scope-agnostic, but 'dm' now requires a real dm_participants row -- a
  // synthetic room id like 'd1' is correctly refused with 404. DM membership
  // itself is covered in server/chatPresenceAuth.test.ts.
  it('carries the typing flag as an expiry instant, not a boolean', async () => {
    const u = await signUp(app, 'p3@kc.gg', 'pthree')
    const quiet = await request(app).post('/api/fn/chat-presence').set('Authorization', `Bearer ${u.token}`).send({ scope: 'channel', roomId: 'd1' })
    expect(quiet.body.members[0].typingUntil).toBe(0)

    const typing = await request(app).post('/api/fn/chat-presence').set('Authorization', `Bearer ${u.token}`).send({ scope: 'channel', roomId: 'd1', typing: true })
    expect(typing.body.members[0].typingUntil).toBeGreaterThan(typing.body.now)
    expect(typing.body.members[0].typingUntil).toBeLessThanOrEqual(typing.body.now + TYPING_TTL_MS)
  })

  it('removes the caller on leaving', async () => {
    const a = await signUp(app, 'l1@kc.gg', 'lone')
    const b = await signUp(app, 'l2@kc.gg', 'ltwo')
    await request(app).post('/api/fn/chat-presence').set('Authorization', `Bearer ${a.token}`).send({ scope: 'channel', roomId: 'c1' })
    await request(app).post('/api/fn/chat-presence').set('Authorization', `Bearer ${b.token}`).send({ scope: 'channel', roomId: 'c1' })
    await request(app).post('/api/fn/chat-presence').set('Authorization', `Bearer ${a.token}`).send({ scope: 'channel', roomId: 'c1', leaving: true })
    const after = await request(app).post('/api/fn/chat-presence').set('Authorization', `Bearer ${b.token}`).send({ scope: 'channel', roomId: 'c1' })
    expect(after.body.members.map((m: any) => m.userId)).toEqual([b.id])
  })

  it('never leaks presence between app instances', async () => {
    const u = await signUp(app, 'iso@kc.gg', 'iso')
    await request(app).post('/api/fn/chat-presence').set('Authorization', `Bearer ${u.token}`).send({ scope: 'stream', roomId: 's1' })
    const fresh = createApp(makeDb())
    const v = await signUp(fresh, 'iso@kc.gg', 'iso')
    const r = await request(fresh).post('/api/fn/chat-presence').set('Authorization', `Bearer ${v.token}`).send({ scope: 'stream', roomId: 's1' })
    expect(r.body.members).toHaveLength(1)
  })
})

describe('Ask TKO rate limit', () => {
  let app: any
  beforeEach(() => { app = createApp(makeDb()) })

  it('throttles a burst from ONE user, per user, without ever 500ing', async () => {
    const u = await signUp(app, 'ask@kc.gg', 'asker')
    // No Vertex credentials in a test, so an ALLOWED call comes back
    // ok:false WITHOUT rateLimited — that is the model failing, not the gate.
    for (let i = 0; i < ASK_MAX_PER_WINDOW; i++) {
      const r = await request(app).post('/api/fn/ask').set('Authorization', `Bearer ${u.token}`).send({ question: `q${i}` })
      expect(r.status).toBe(200)
      expect(r.body.rateLimited).toBeUndefined()
    }
    const blocked = await request(app).post('/api/fn/ask').set('Authorization', `Bearer ${u.token}`).send({ question: 'one too many' })
    // 200 + ok:false is the convention `ask` already uses, so CommandBar falls
    // back to its local answers and chat shows a note instead of an error.
    expect(blocked.status).toBe(200)
    expect(blocked.body.ok).toBe(false)
    expect(blocked.body.rateLimited).toBe(true)
    expect(blocked.body.retryAfterMs).toBeGreaterThan(0)
  })

  it('is PER USER — one spammer cannot mute the assistant for the room', async () => {
    const spammer = await signUp(app, 'spam@kc.gg', 'spammer')
    const bystander = await signUp(app, 'calm@kc.gg', 'calm')
    for (let i = 0; i < ASK_MAX_PER_WINDOW + 3; i++) {
      await request(app).post('/api/fn/ask').set('Authorization', `Bearer ${spammer.token}`).send({ question: `q${i}` })
    }
    const ok = await request(app).post('/api/fn/ask').set('Authorization', `Bearer ${bystander.token}`).send({ question: 'am I ok?' })
    expect(ok.body.rateLimited).toBeUndefined()
  })

  it('does not spend budget on an empty question', async () => {
    const u = await signUp(app, 'blank@kc.gg', 'blank')
    for (let i = 0; i < ASK_MAX_PER_WINDOW + 5; i++) {
      const r = await request(app).post('/api/fn/ask').set('Authorization', `Bearer ${u.token}`).send({ question: '   ' })
      expect(r.status).toBe(400)
    }
    const real = await request(app).post('/api/fn/ask').set('Authorization', `Bearer ${u.token}`).send({ question: 'a real one' })
    expect(real.body.rateLimited).toBeUndefined()
  })

  it('requires a signed-in caller', async () => {
    const r = await request(app).post('/api/fn/ask').send({ question: 'hello' })
    expect(r.status).toBe(401)
  })
})
