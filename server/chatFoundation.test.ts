/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

/**
 * The SERVER half of the chat foundation.
 *
 * The client sanitizes mentions before it sends them (src/lib/chatMentions.ts),
 * but a client is not a security boundary — `/api/fn/dm-send` and `/api/db` are.
 * These tests assert the two things that must hold no matter what a caller POSTs:
 *   • a `mentions` array is re-derived from the accepted content, so an entry
 *     whose offsets don't literally read "@username" is dropped;
 *   • `reply_to` must name a message in the SAME conversation, and a reaction's
 *     emoji must actually be emoji, written under the JWT's user.
 */

const ADULT_DOB = '1995-06-15'

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

function db(app: any, who: Who, body: any) {
  return request(app)
    .post('/api/db')
    .set('Authorization', `Bearer ${who.token}`)
    .send(body)
}

/** Read a jsonb column back as a JS value regardless of driver shape. */
function asArray(value: any): any[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

describe('chat foundation — dm-send mentions + reply_to', () => {
  let pool: any
  let app: any
  let alice: Who
  let bob: Who
  let carol: Who
  let conversationId: string

  beforeEach(async () => {
    pool = makeDb()
    app = createApp(pool)
    alice = await signUp(app, 'cf-alice@tko.cam', 'cf_alice')
    bob = await signUp(app, 'cf-bob@tko.cam', 'cf_bob')
    carol = await signUp(app, 'cf-carol@tko.cam', 'cf_carol')
    const opened = await fn(app, alice, 'dm-open', { targetUserId: bob.id })
    expect(opened.status).toBe(200)
    conversationId = opened.body.conversation_id
  })

  it('persists a well-formed mention', async () => {
    const content = 'gg @cf_bob nice clutch'
    const sent = await fn(app, alice, 'dm-send', {
      conversationId,
      content,
      mentions: [{ user_id: bob.id, username: 'cf_bob', start: 3, end: 10 }],
    })
    expect(sent.status).toBe(200)

    const stored = await pool.query('select content, mentions from dm_messages where id=$1', [
      sent.body.message.id,
    ])
    expect(stored.rows[0].content).toBe(content)
    expect(asArray(stored.rows[0].mentions)).toEqual([
      { user_id: bob.id, username: 'cf_bob', start: 3, end: 10 },
    ])
  })

  it('DROPS a forged mention whose offsets point at ordinary text', async () => {
    // "@cf_bob" really is at index 15 of an email address — the string matches,
    // but it is not on a word boundary, so it must never become a chip.
    const content = 'mail me at nate@cf_bob.cam'
    const sent = await fn(app, alice, 'dm-send', {
      conversationId,
      content,
      mentions: [{ user_id: bob.id, username: 'cf_bob', start: 15, end: 22 }],
    })
    expect(sent.status).toBe(200)

    const stored = await pool.query('select mentions from dm_messages where id=$1', [
      sent.body.message.id,
    ])
    expect(asArray(stored.rows[0].mentions)).toEqual([])
  })

  it('DROPS a mention that claims a different username than the text carries', async () => {
    const sent = await fn(app, alice, 'dm-send', {
      conversationId,
      content: 'hey @cf_bob',
      mentions: [{ user_id: carol.id, username: 'cf_carol', start: 4, end: 11 }],
    })
    expect(sent.status).toBe(200)
    const stored = await pool.query('select mentions from dm_messages where id=$1', [
      sent.body.message.id,
    ])
    expect(asArray(stored.rows[0].mentions)).toEqual([])
  })

  it('never lets a malformed mentions payload block the message', async () => {
    for (const mentions of ['not-json', 42, { nope: true }, [null, 'x'], undefined]) {
      const sent = await fn(app, alice, 'dm-send', { conversationId, content: 'still sends', mentions })
      expect(sent.status).toBe(200)
      expect(sent.body.message.content).toBe('still sends')
    }
  })

  it('accepts reply_to for a message in this conversation', async () => {
    const parent = await fn(app, alice, 'dm-send', { conversationId, content: 'first' })
    const reply = await fn(app, bob, 'dm-send', {
      conversationId,
      content: 'second',
      replyTo: parent.body.message.id,
    })
    expect(reply.status).toBe(200)
    const stored = await pool.query('select reply_to from dm_messages where id=$1', [
      reply.body.message.id,
    ])
    expect(stored.rows[0].reply_to).toBe(parent.body.message.id)
  })

  it('REFUSES a reply_to that belongs to a different conversation', async () => {
    // Alice also has a thread with Carol; a message there must not be quotable
    // from the Alice/Bob thread, or a reply preview leaks a private message.
    const other = await fn(app, alice, 'dm-open', { targetUserId: carol.id })
    const foreign = await fn(app, alice, 'dm-send', {
      conversationId: other.body.conversation_id,
      content: 'private to carol',
    })

    const sent = await fn(app, alice, 'dm-send', {
      conversationId,
      content: 'quoting the wrong thread',
      replyTo: foreign.body.message.id,
    })
    expect(sent.status).toBe(200)
    const stored = await pool.query('select reply_to from dm_messages where id=$1', [
      sent.body.message.id,
    ])
    expect(stored.rows[0].reply_to).toBeNull()
  })

  it('ignores a junk reply_to instead of failing the send', async () => {
    const sent = await fn(app, alice, 'dm-send', {
      conversationId,
      content: 'still sends',
      replyTo: 'not-a-uuid',
    })
    expect(sent.status).toBe(200)
    const stored = await pool.query('select reply_to from dm_messages where id=$1', [
      sent.body.message.id,
    ])
    expect(stored.rows[0].reply_to).toBeNull()
  })
})

describe('chat foundation — chat_reactions authorization', () => {
  let pool: any
  let app: any
  let alice: Who
  let bob: Who

  beforeEach(async () => {
    pool = makeDb()
    app = createApp(pool)
    alice = await signUp(app, 'cr-alice@tko.cam', 'cr_alice')
    bob = await signUp(app, 'cr-bob@tko.cam', 'cr_bob')
  })

  const MESSAGE_ID = '11111111-2222-4333-8444-555555555555'

  function react(who: Who, values: any) {
    return db(app, who, { table: 'chat_reactions', action: 'insert', values })
  }

  it('accepts a real emoji and stores it under the caller', async () => {
    const response = await react(alice, {
      surface: 'stream',
      message_id: MESSAGE_ID,
      user_id: alice.id,
      emoji: '🔥',
    })
    expect(response.status).toBe(200)
    const stored = await pool.query('select user_id, emoji from chat_reactions')
    expect(stored.rows).toHaveLength(1)
    expect(stored.rows[0].user_id).toBe(alice.id)
    expect(stored.rows[0].emoji).toBe('🔥')
  })

  it('FORCES user_id to the JWT — you cannot react as somebody else', async () => {
    const response = await react(alice, {
      surface: 'stream',
      message_id: MESSAGE_ID,
      user_id: bob.id,
      emoji: '🔥',
    })
    expect(response.status).toBe(200)
    const stored = await pool.query('select user_id from chat_reactions')
    expect(stored.rows[0].user_id).toBe(alice.id)
  })

  it('REFUSES a non-emoji payload — the column is not free text', async () => {
    for (const emoji of ['lol', '<img src=x onerror=alert(1)>', '', '🔥 nice', '🔥'.repeat(20)]) {
      const response = await react(alice, {
        surface: 'stream',
        message_id: MESSAGE_ID,
        user_id: alice.id,
        emoji,
      })
      expect(response.status).toBeGreaterThanOrEqual(400)
    }
    const stored = await pool.query('select 1 from chat_reactions')
    expect(stored.rows).toHaveLength(0)
  })

  it('REFUSES an unknown surface', async () => {
    const response = await react(alice, {
      surface: 'everywhere',
      message_id: MESSAGE_ID,
      user_id: alice.id,
      emoji: '🔥',
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it('trims a padded emoji rather than storing whitespace', async () => {
    const response = await react(alice, {
      surface: 'dm',
      message_id: MESSAGE_ID,
      user_id: alice.id,
      emoji: '  👍  ',
    })
    expect(response.status).toBe(200)
    const stored = await pool.query('select emoji from chat_reactions')
    expect(stored.rows[0].emoji).toBe('👍')
  })

  it('lets anyone READ reactions but only the owner delete their own', async () => {
    await react(alice, { surface: 'stream', message_id: MESSAGE_ID, user_id: alice.id, emoji: '🔥' })

    const read = await db(app, bob, {
      table: 'chat_reactions',
      action: 'select',
      columns: 'message_id, user_id, emoji',
      filters: [{ col: 'message_id', op: 'eq', val: MESSAGE_ID }],
    })
    expect(read.status).toBe(200)
    expect(read.body.data).toHaveLength(1)

    // Bob deleting Alice's reaction must remove nothing.
    await db(app, bob, {
      table: 'chat_reactions',
      action: 'delete',
      filters: [{ col: 'message_id', op: 'eq', val: MESSAGE_ID }],
    })
    const afterOther = await pool.query('select 1 from chat_reactions')
    expect(afterOther.rows).toHaveLength(1)

    await db(app, alice, {
      table: 'chat_reactions',
      action: 'delete',
      filters: [{ col: 'message_id', op: 'eq', val: MESSAGE_ID }],
    })
    const afterOwner = await pool.query('select 1 from chat_reactions')
    expect(afterOwner.rows).toHaveLength(0)
  })
})
