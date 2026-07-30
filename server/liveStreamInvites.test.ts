/* eslint-disable @typescript-eslint/no-explicit-any */
// CO-STREAM INVITES — role-based, self-service angle add.
//
// A host (or an accepted co-host) invites another player to co-stream. The
// invited player then adds THEIR OWN stream link as an angle (live-angle-add-self)
// — the host doesn't paste everyone's links. The ROLE CEILING (interpreted as the
// streaming TIER LEVEL): you may invite a player only at your role or LOWER, never
// higher. Covered here:
//   1. host invites a same-or-lower tier player  → pending + a notification
//   2. inviting a HIGHER-tier player              → refused (role-too-high)
//   3. the invitee accepts, then self-adds their own angle (their id + link)
//   4. a non-invited player cannot self-add
//   5. only the invitee may respond; both sides can read their own invites
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

const ADULT_DOB = '1995-06-15'
type Who = { token: string; id: string }

async function signUp(app: any, name: string): Promise<Who> {
  const r = await request(app).post('/api/auth/signup').send({
    email: `${name}@live-invites.test`,
    password: 'password123',
    username: name,
    date_of_birth: ADULT_DOB,
  })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}

function db(app: any, who: Who | null, body: any) {
  const r = request(app).post('/api/db').send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

function fn(app: any, who: Who | null, name: string, body: any) {
  const r = request(app).post(`/api/fn/${name}`).send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

async function setTier(pool: any, userId: string, tier: string) {
  const current = await pool.query('select user_metadata from users where id=$1', [userId])
  const meta = current.rows[0]?.user_metadata || {}
  meta.reelone_tier = tier
  meta.reelone_tier_expires = null
  await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), userId])
}

async function startStream(app: any, who: Who) {
  return db(app, who, {
    table: 'live_streams',
    action: 'insert',
    single: true,
    values: {
      youtube_url: 'https://youtu.be/dQw4w9WgXcQ',
      title: 'invite stream',
      placement: 'profile',
      is_live: true,
    },
  })
}

describe('live_stream_invites — role-based co-stream invite + self-service angle', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let host: Who // supporter (level 2)
  let peer: Who // supporter (level 2) — same role, invitable
  let lower: Who // pro (level 1) — lower role, invitable
  let higher: Who // creator (level 3) — HIGHER role, NOT invitable
  let streamId = ''

  beforeAll(async () => {
    host = await signUp(app, 'inv_host')
    peer = await signUp(app, 'inv_peer')
    lower = await signUp(app, 'inv_lower')
    higher = await signUp(app, 'inv_higher')
    await setTier(pool, host.id, 'supporter')
    await setTier(pool, peer.id, 'supporter')
    await setTier(pool, lower.id, 'pro')
    await setTier(pool, higher.id, 'creator')
    // The invited peer has a linked YouTube handle so self-add resolves it.
    await pool.query('insert into user_youtube_links (user_id, url) values ($1,$2)', [
      peer.id,
      'https://www.youtube.com/@inv_peer',
    ])
    const started = await startStream(app, host)
    expect(started.status).toBe(200)
    streamId = started.body.data.id
  })
  afterAll(async () => { await pool.end() })

  it('the host invites a same-tier player → pending invite + a notification', async () => {
    const r = await fn(app, host, 'live-invite', { liveStreamId: streamId, userId: peer.id })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.invite.status).toBe('pending')
    expect(r.body.invite.invitee_id).toBe(peer.id)
    expect(r.body.invite.inviter_id).toBe(host.id)

    // The invitee got a live_invite notification.
    const notes = await pool.query(
      "select * from notifications where user_id=$1 and kind='live_invite'",
      [peer.id],
    )
    expect(notes.rows).toHaveLength(1)
    expect(notes.rows[0].related_id).toBe(streamId)
    expect(notes.rows[0].actor_id).toBe(host.id)
  })

  it('the host may also invite a LOWER-tier player', async () => {
    const r = await fn(app, host, 'live-invite', { liveStreamId: streamId, userId: lower.id })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.invite.status).toBe('pending')
  })

  it('inviting a HIGHER-tier player is refused by the role ceiling', async () => {
    const r = await fn(app, host, 'live-invite', { liveStreamId: streamId, userId: higher.id })
    expect(r.status).toBe(403)
    expect(r.body.ok).toBe(false)
    expect(r.body.reason).toBe('role-too-high')
    // No invite row was written for the higher-tier player.
    const rows = await pool.query(
      'select id from live_stream_invites where live_stream_id=$1 and invitee_id=$2',
      [streamId, higher.id],
    )
    expect(rows.rows).toHaveLength(0)
  })

  it('a re-invite of the same player is idempotent (no duplicate row)', async () => {
    const r = await fn(app, host, 'live-invite', { liveStreamId: streamId, userId: peer.id })
    expect(r.status).toBe(200)
    const rows = await pool.query(
      'select id from live_stream_invites where live_stream_id=$1 and invitee_id=$2',
      [streamId, peer.id],
    )
    expect(rows.rows).toHaveLength(1)
  })

  it('a stranger cannot invite on someone else\'s show', async () => {
    const r = await fn(app, lower, 'live-invite', { liveStreamId: streamId, userId: peer.id })
    // `lower` has only a PENDING (not accepted) invite → not a co-host yet.
    expect(r.status).toBe(403)
    expect(r.body.reason).not.toBe('role-too-high')
  })

  it('a non-invited / non-accepted player cannot self-add an angle', async () => {
    const outsider = await signUp(app, 'inv_outsider')
    await setTier(pool, outsider.id, 'pro')
    const r = await fn(app, outsider, 'live-angle-add-self', { liveStreamId: streamId })
    expect(r.status).toBe(403)
  })

  it('a pending (not yet accepted) invitee cannot self-add', async () => {
    const r = await fn(app, peer, 'live-angle-add-self', { liveStreamId: streamId })
    expect(r.status).toBe(403)
  })

  it('only the invitee may respond to their invite', async () => {
    const invite = await pool.query(
      'select id from live_stream_invites where live_stream_id=$1 and invitee_id=$2',
      [streamId, peer.id],
    )
    const inviteId = invite.rows[0].id
    const denied = await fn(app, lower, 'live-invite-respond', { inviteId, accept: true })
    expect(denied.status).toBe(403)
  })

  it('the invitee accepts, then self-adds their OWN angle (their id + their link)', async () => {
    const invite = await pool.query(
      'select id from live_stream_invites where live_stream_id=$1 and invitee_id=$2',
      [streamId, peer.id],
    )
    const inviteId = invite.rows[0].id

    const acc = await fn(app, peer, 'live-invite-respond', { inviteId, accept: true })
    expect(acc.status).toBe(200)
    expect(acc.body.invite.status).toBe('accepted')

    // Now the accepted peer adds their OWN stream — resolved from their link.
    const self = await fn(app, peer, 'live-angle-add-self', { liveStreamId: streamId })
    expect(self.status).toBe(200)
    expect(self.body.ok).toBe(true)
    expect(self.body.angle.user_id).toBe(peer.id)
    expect(self.body.angle.youtube_url).toBe('https://www.youtube.com/@inv_peer')

    // Re-adding refreshes in place (no duplicate angle for the same player).
    const again = await fn(app, peer, 'live-angle-add-self', {
      liveStreamId: streamId,
      youtubeUrl: 'https://youtu.be/abcdefghijk',
    })
    expect(again.status).toBe(200)
    const angles = await pool.query(
      'select id from live_stream_angles where live_stream_id=$1 and user_id=$2',
      [streamId, peer.id],
    )
    expect(angles.rows).toHaveLength(1)
  })

  it('declining an invite blocks the self-add', async () => {
    const invite = await pool.query(
      'select id from live_stream_invites where live_stream_id=$1 and invitee_id=$2',
      [streamId, lower.id],
    )
    const inviteId = invite.rows[0].id
    const dec = await fn(app, lower, 'live-invite-respond', { inviteId, accept: false })
    expect(dec.status).toBe(200)
    expect(dec.body.invite.status).toBe('declined')
    const r = await fn(app, lower, 'live-angle-add-self', { liveStreamId: streamId })
    expect(r.status).toBe(403)
  })

  it('both the invitee and the inviter can read their own invite; a stranger sees none', async () => {
    // Invitee reads "you're invited".
    const asInvitee = await db(app, peer, {
      table: 'live_stream_invites', action: 'select', columns: '*',
      filters: [{ col: 'live_stream_id', op: 'eq', val: streamId }],
    })
    expect(asInvitee.status).toBe(200)
    expect(asInvitee.body.data.some((i: any) => i.invitee_id === peer.id)).toBe(true)

    // Inviter (host) reads who they invited (ownerAny covers inviter_id too).
    const asInviter = await db(app, host, {
      table: 'live_stream_invites', action: 'select', columns: '*',
      filters: [{ col: 'live_stream_id', op: 'eq', val: streamId }],
    })
    expect(asInviter.status).toBe(200)
    expect(asInviter.body.data.length).toBeGreaterThanOrEqual(2)

    // A stranger reads none of them.
    const outsider = await signUp(app, 'inv_reader')
    const asStranger = await db(app, outsider, {
      table: 'live_stream_invites', action: 'select', columns: '*',
      filters: [{ col: 'live_stream_id', op: 'eq', val: streamId }],
    })
    expect(asStranger.status).toBe(200)
    expect(asStranger.body.data).toHaveLength(0)
  })

  it('an accepted co-host may invite another peer (delegation), still capped by role', async () => {
    // peer (supporter, accepted) invites a fresh pro player → allowed.
    const fresh = await signUp(app, 'inv_delegated')
    await setTier(pool, fresh.id, 'pro')
    const ok = await fn(app, peer, 'live-invite', { liveStreamId: streamId, userId: fresh.id })
    expect(ok.status).toBe(200)
    expect(ok.body.invite.status).toBe('pending')

    // ...but peer (level 2) still cannot invite a creator (level 3).
    const capped = await fn(app, peer, 'live-invite', { liveStreamId: streamId, userId: higher.id })
    expect(capped.status).toBe(403)
    expect(capped.body.reason).toBe('role-too-high')
  })
})
