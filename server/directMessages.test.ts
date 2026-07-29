/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

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

describe('server-owned direct conversations', () => {
  let pool: any
  let app: any
  let alice: Who
  let bob: Who
  let outsider: Who

  beforeEach(async () => {
    pool = makeDb()
    app = createApp(pool)
    alice = await signUp(app, 'dm-alice@tko.cam', 'dm_alice')
    bob = await signUp(app, 'dm-bob@tko.cam', 'dm_bob')
    outsider = await signUp(app, 'dm-outsider@tko.cam', 'dm_outsider')
  })

  it('atomically opens one two-person thread from either direction', async () => {
    const [fromAlice, fromBob] = await Promise.all([
      fn(app, alice, 'dm-open', { targetUserId: bob.id }),
      fn(app, bob, 'dm-open', { targetUserId: alice.id }),
    ])

    expect(fromAlice.status).toBe(200)
    expect(fromBob.status).toBe(200)
    expect(fromAlice.body.conversation_id).toBe(fromBob.body.conversation_id)

    const conversations = await pool.query('select id, pair_key from dm_conversations')
    expect(conversations.rows).toHaveLength(1)
    expect(conversations.rows[0].pair_key).toContain(alice.id)
    expect(conversations.rows[0].pair_key).toContain(bob.id)

    const participants = await pool.query(
      'select user_id from dm_participants where conversation_id=$1 order by user_id',
      [fromAlice.body.conversation_id],
    )
    expect(participants.rows.map((row: any) => row.user_id)).toEqual(
      [alice.id, bob.id].sort(),
    )
  })

  it('persists member messages, scopes reads, and rejects forged sends', async () => {
    const opened = await fn(app, alice, 'dm-open', { targetUserId: bob.id })
    const conversationId = opened.body.conversation_id

    const directCreate = await db(app, outsider, {
      table: 'dm_conversations',
      action: 'insert',
      values: { name: 'forged' },
    })
    expect(directCreate.status).toBe(403)

    const sent = await db(app, alice, {
      table: 'dm_messages',
      action: 'insert',
      single: true,
      values: {
        conversation_id: conversationId,
        user_id: outsider.id,
        content: '  Ready for the match?  ',
      },
    })
    expect(sent.status).toBe(200)
    expect(sent.body.data.user_id).toBe(alice.id)
    expect(sent.body.data.content).toBe('Ready for the match?')

    const readByBob = await db(app, bob, {
      table: 'dm_messages',
      action: 'select',
      filters: [{ col: 'conversation_id', op: 'eq', val: conversationId }],
    })
    expect(readByBob.status).toBe(200)
    expect(readByBob.body.data).toHaveLength(1)

    const hiddenFromOutsider = await db(app, outsider, {
      table: 'dm_messages',
      action: 'select',
      filters: [{ col: 'conversation_id', op: 'eq', val: conversationId }],
    })
    expect(hiddenFromOutsider.status).toBe(200)
    expect(hiddenFromOutsider.body.data).toEqual([])

    const forgedSend = await db(app, outsider, {
      table: 'dm_messages',
      action: 'insert',
      values: {
        conversation_id: conversationId,
        user_id: outsider.id,
        content: 'I should not be here.',
      },
    })
    expect(forgedSend.status).toBe(403)
  })

  it('refuses to open or continue a blocked conversation', async () => {
    const block = await db(app, bob, {
      table: 'blocks',
      action: 'insert',
      values: { blocker_id: bob.id, blocked_id: alice.id },
    })
    expect(block.status).toBe(200)

    const opened = await fn(app, alice, 'dm-open', { targetUserId: bob.id })
    expect(opened.status).toBe(403)
    expect(opened.body.error).toBe('This conversation is unavailable.')
  })
})
