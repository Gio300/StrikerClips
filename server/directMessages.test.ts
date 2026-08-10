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
  let carol: Who
  let outsider: Who

  beforeEach(async () => {
    pool = makeDb()
    app = createApp(pool)
    alice = await signUp(app, 'dm-alice@tko.cam', 'dm_alice')
    bob = await signUp(app, 'dm-bob@tko.cam', 'dm_bob')
    carol = await signUp(app, 'dm-carol@tko.cam', 'dm_carol')
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

  it('creates a private named group thread and scopes it to all members', async () => {
    const opened = await fn(app, alice, 'dm-group-open', {
      name: 'Tournament crew',
      usernames: ['dm_bob', 'dm_carol'],
    })
    expect(opened.status).toBe(200)
    expect(opened.body.participant_count).toBe(3)

    const conversationId = opened.body.conversation_id
    const conversation = await pool.query(
      'select name, pair_key from dm_conversations where id=$1',
      [conversationId],
    )
    expect(conversation.rows[0]).toMatchObject({ name: 'Tournament crew', pair_key: null })

    const members = await pool.query(
      'select user_id from dm_participants where conversation_id=$1 order by user_id',
      [conversationId],
    )
    expect(members.rows.map((row: any) => row.user_id)).toEqual(
      [alice.id, bob.id, carol.id].sort(),
    )

    const sent = await db(app, carol, {
      table: 'dm_messages',
      action: 'insert',
      single: true,
      values: { conversation_id: conversationId, content: 'Bracket is ready.' },
    })
    expect(sent.status).toBe(200)

    const visible = await db(app, bob, {
      table: 'dm_messages',
      action: 'select',
      filters: [{ col: 'conversation_id', op: 'eq', val: conversationId }],
    })
    expect(visible.body.data).toHaveLength(1)

    const hidden = await db(app, outsider, {
      table: 'dm_messages',
      action: 'select',
      filters: [{ col: 'conversation_id', op: 'eq', val: conversationId }],
    })
    expect(hidden.body.data).toEqual([])
  })

  it('adds people to a direct thread, converts it to a group, and honors every member block', async () => {
    const direct = await fn(app, alice, 'dm-open', { targetUserId: bob.id })
    const conversationId = direct.body.conversation_id

    await db(app, bob, {
      table: 'blocks',
      action: 'insert',
      values: { blocker_id: bob.id, blocked_id: carol.id },
    })
    const blocked = await fn(app, alice, 'dm-members-add', {
      conversationId,
      usernames: ['dm_carol'],
    })
    expect(blocked.status).toBe(403)

    const added = await fn(app, alice, 'dm-members-add', {
      conversationId,
      usernames: ['dm_outsider'],
    })
    expect(added.status, JSON.stringify(added.body)).toBe(200)
    expect(added.body.participant_count).toBe(3)

    const conversation = await pool.query(
      'select name, pair_key from dm_conversations where id=$1',
      [conversationId],
    )
    expect(conversation.rows[0]).toMatchObject({ name: 'Group chat', pair_key: null })
    const participants = await pool.query(
      'select user_id from dm_participants where conversation_id=$1 order by user_id',
      [conversationId],
    )
    expect(participants.rows.map((row: any) => row.user_id)).toEqual(
      [alice.id, bob.id, outsider.id].sort(),
    )
  })

  it('requires two other players and refuses blocked group members', async () => {
    const tooSmall = await fn(app, alice, 'dm-group-open', {
      name: 'Not a group',
      usernames: ['dm_bob'],
    })
    expect(tooSmall.status).toBe(400)

    await db(app, bob, {
      table: 'blocks',
      action: 'insert',
      values: { blocker_id: bob.id, blocked_id: alice.id },
    })
    const blocked = await fn(app, alice, 'dm-group-open', {
      name: 'Blocked group',
      usernames: ['dm_bob', 'dm_carol'],
    })
    expect(blocked.status).toBe(403)
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

  it('searches every available player and hides blocks in either direction', async () => {
    const visible = await fn(app, alice, 'dm-user-search', { query: 'dm_' })
    expect(visible.status).toBe(200)
    expect(visible.body.users.map((user: any) => user.username)).toEqual(
      expect.arrayContaining(['dm_bob', 'dm_carol', 'dm_outsider']),
    )
    expect(visible.body.users.some((user: any) => user.id === alice.id)).toBe(false)

    await db(app, bob, {
      table: 'blocks',
      action: 'insert',
      values: { blocker_id: bob.id, blocked_id: alice.id },
    })
    await db(app, alice, {
      table: 'blocks',
      action: 'insert',
      values: { blocker_id: alice.id, blocked_id: carol.id },
    })

    const filtered = await fn(app, alice, 'dm-user-search', { query: 'dm_' })
    expect(filtered.status).toBe(200)
    expect(filtered.body.users.map((user: any) => user.username)).toEqual(['dm_outsider'])
  })

  it('sends through the server and creates recipient activity', async () => {
    const opened = await fn(app, alice, 'dm-open', { targetUserId: bob.id })
    const sent = await fn(app, alice, 'dm-send', {
      conversationId: opened.body.conversation_id,
      content: '  Your match invite is ready.  ',
    })

    expect(sent.status).toBe(200)
    expect(sent.body.message.content).toBe('Your match invite is ready.')

    const notification = await pool.query(
      `select kind,title,body,link,actor_id
         from notifications where user_id=$1 order by created_at desc limit 1`,
      [bob.id],
    )
    expect(notification.rows[0]).toMatchObject({
      kind: 'direct_message',
      title: 'dm_alice sent you a message',
      body: 'Your match invite is ready.',
      link: `/messages?conversation=${opened.body.conversation_id}`,
      actor_id: alice.id,
    })
  })
})
