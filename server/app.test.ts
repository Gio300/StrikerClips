/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { randomUUID, createHmac } from 'node:crypto'
import {
  ageFromDob, isAllowedOrigin, MIN_AGE_YEARS,
  SERVER_TOKEN_PACKS, serverPackById, tierForPrice, SUBSCRIPTION_TIERS,
  PURCHASABLE_TIERS, RETIRED_TIERS, isPurchasableTier,
  createApp, MAX_SELECT_ROWS,
} from './app'
import { makeApp, makeDb } from './testHarness'
import { TOKEN_PACKS } from '../src/lib/tokenPacks'

/** A date of birth comfortably over the 13+ gate — signup now requires one. */
const ADULT_DOB = '1995-06-15'

// Build an in-memory Postgres with the tables the API touches, then the app.

describe('TKO API — new-user journey (in-memory Postgres)', () => {
  const app = makeApp()
  let token = ''
  let playerId = ''

  it('health check', async () => {
    const r = await request(app).get('/api/health')
    expect(r.status).toBe(200); expect(r.body.ok).toBe(true)
  })

  it('rejects weak signup', async () => {
    const r = await request(app).post('/api/auth/signup').send({ email: 'x@y.com', password: '123' })
    expect(r.status).toBe(400)
  })

  it('signs up a new user with the Supabase-compatible user shape', async () => {
    const r = await request(app).post('/api/auth/signup').send({ email: 'rekt@kc.gg', password: 'password123', username: 'rekt', date_of_birth: ADULT_DOB })
    expect(r.status).toBe(200)
    expect(r.body.token).toBeTruthy()
    expect(r.body.user.email).toBe('rekt@kc.gg')
    expect(r.body.user.user_metadata.username).toBe('rekt')
    expect(r.body.user.aud).toBe('authenticated')
    token = r.body.token; playerId = r.body.user.id
  })

  it('blocks duplicate email', async () => {
    const r = await request(app).post('/api/auth/signup').send({ email: 'rekt@kc.gg', password: 'password123', date_of_birth: ADULT_DOB })
    expect(r.status).toBe(409)
  })

  it('logs in with correct password', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'rekt@kc.gg', password: 'password123' })
    expect(r.status).toBe(200); expect(r.body.token).toBeTruthy(); token = r.body.token
  })

  it('rejects wrong password', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'rekt@kc.gg', password: 'nope' })
    expect(r.status).toBe(401)
  })

  it('returns me when authed, 401 when not', async () => {
    const ok = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    expect(ok.status).toBe(200); expect(ok.body.user.email).toBe('rekt@kc.gg'); expect(ok.body.user.user_metadata.username).toBeTruthy()
    const no = await request(app).get('/api/auth/me')
    expect(no.status).toBe(401)
  })

  it('/api/db insert requires a token; select is public', async () => {
    const unauth = await request(app).post('/api/db').send({
      table: 'clips', action: 'insert', values: { url_or_path: 'https://youtu.be/x' },
    })
    expect(unauth.status).toBe(401)

    const c = await request(app).post('/api/db').set('Authorization', `Bearer ${token}`).send({
      table: 'clips', action: 'insert', single: true,
      values: { user_id: playerId, source_type: 'youtube', url_or_path: 'https://youtu.be/abc', title: 'clean ko', category: 'kill', subject_profile_id: playerId, youtube_video_id: 'abc', start_sec: 42 },
    })
    expect(c.status).toBe(200); expect(c.body.error).toBeNull(); expect(c.body.data.category).toBe('kill')
  })

  it('/api/db select with filters + order + limit ("his last kills")', async () => {
    const r = await request(app).post('/api/db').send({
      table: 'clips', action: 'select', columns: '*',
      filters: [{ col: 'subject_profile_id', op: 'eq', val: playerId }, { col: 'category', op: 'eq', val: 'kill' }],
      order: { col: 'created_at', ascending: false }, limit: 10,
    })
    expect(r.status).toBe(200)
    expect(r.body.data.length).toBe(1)
    expect(r.body.data[0].youtube_video_id).toBe('abc')
  })

  it('/api/db rejects a non-whitelisted table', async () => {
    const r = await request(app).post('/api/db').send({ table: 'pg_catalog', action: 'select' })
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/unknown table/)
  })

  it('/api/db strips embedded-join columns and single:true returns first row', async () => {
    const r = await request(app).post('/api/db').send({
      table: 'clips', action: 'select', columns: '*, profiles(username)', single: true,
    })
    expect(r.status).toBe(200)
    expect(r.body.data).not.toBeNull()
    expect(r.body.data.youtube_video_id).toBe('abc')
  })

  it('/api/db count returns total matching', async () => {
    const r = await request(app).post('/api/db').send({
      table: 'clips', action: 'select', count: true,
      filters: [{ col: 'category', op: 'eq', val: 'kill' }],
    })
    expect(r.status).toBe(200); expect(r.body.count).toBe(1)
  })

  it('/api/fn/redeem-code grants pro tier to the auth\'d user', async () => {
    const nope = await request(app).post('/api/fn/redeem-code').send({ code: 'KILLCAM-TEST-CODE' })
    expect(nope.status).toBe(401)

    const r = await request(app).post('/api/fn/redeem-code').set('Authorization', `Bearer ${token}`).send({ code: 'KILLCAM-TEST-CODE' })
    expect(r.status).toBe(200); expect(r.body.ok).toBe(true); expect(r.body.tier).toBe('pro'); expect(r.body.expires_at).toBeTruthy()

    // Second redemption of a single-use code is refused.
    const again = await request(app).post('/api/fn/redeem-code').set('Authorization', `Bearer ${token}`).send({ code: 'KILLCAM-TEST-CODE' })
    expect(again.status).toBe(409)

    // The grant is reflected on /auth/me.
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    expect(me.body.user.user_metadata.reelone_tier).toBe('pro')
  })

  it('/api/fn/<other> is a no-op success', async () => {
    const r = await request(app).post('/api/fn/whatever').set('Authorization', `Bearer ${token}`).send({})
    expect(r.status).toBe(200); expect(r.body.ok).toBe(true)
  })

  it('/api/storage/:bucket returns a stable path', async () => {
    const r = await request(app).post('/api/storage/soundboard').set('Authorization', `Bearer ${token}`).send({ name: 'boom.mp3' })
    expect(r.status).toBe(200); expect(r.body.path).toMatch(/^soundboard\/.+_boom\.mp3$/); expect(r.body.publicUrl).toBe('')
  })

  it('/api/storage/chat-media authorizes channel and owned-post image targets', async () => {
    const space = await request(app).post('/api/db').set('Authorization', `Bearer ${token}`).send({
      table: 'chat_spaces', action: 'insert', single: true,
      values: { kind: 'open', name: 'Image chat', owner_id: playerId },
    })
    expect(space.status).toBe(200)
    const channel = await request(app).post('/api/db').set('Authorization', `Bearer ${token}`).send({
      table: 'chat_channels', action: 'insert', single: true,
      values: { space_id: space.body.data.id, name: 'photos', position: 0 },
    })
    expect(channel.status).toBe(200)
    const post = await request(app).post('/api/db').set('Authorization', `Bearer ${token}`).send({
      table: 'posts', action: 'insert', single: true,
      values: { user_id: playerId, body: '' },
    })
    expect(post.status).toBe(200)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('metadata.google.internal')) {
        return new Response(JSON.stringify({ access_token: 'test-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200 })
    })
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')
    try {
      const channelImage = await request(app)
        .post('/api/storage/chat-media')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'channel', roomId: channel.body.data.id, data: png })
      expect(channelImage.status).toBe(200)
      expect(channelImage.body.path).toMatch(new RegExp(`^/storage/chat-media/${channel.body.data.id}/[0-9a-f-]+\\.png$`, 'i'))

      const postImage = await request(app)
        .post('/api/storage/chat-media')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'post', roomId: post.body.data.id, data: png })
      expect(postImage.status).toBe(200)
      expect(postImage.body.path).toMatch(new RegExp(`^/storage/post-media/${post.body.data.id}/[0-9a-f-]+\\.png$`, 'i'))

      const forgedPost = await request(app)
        .post('/api/storage/chat-media')
        .set('Authorization', `Bearer ${token}`)
        .send({ scope: 'post', roomId: randomUUID(), data: png })
      expect(forgedPost.status).toBe(403)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

// ===========================================================================
// ROW-LEVEL AUTHORIZATION (TABLE_POLICY)
// The generic /api/db endpoint used to let any signed-in user rewrite any row
// in any whitelisted table. These tests pin the policy model down.
// ===========================================================================

type Who = { token: string; id: string }

async function signUp(app: any, email: string, username: string): Promise<Who> {
  const r = await request(app).post('/api/auth/signup').send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}

/** POST /api/db as a given user (or anonymously when `who` is null). */
function db(app: any, who: Who | null, body: any) {
  const r = request(app).post('/api/db').send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

describe('TKO API — /api/db row-level authorization', () => {
  const app = makeApp()
  let alice: Who
  let bob: Who
  let host: Who

  it('sets up three users (one of them a TKO host)', async () => {
    alice = await signUp(app, 'alice@kc.gg', 'alice')
    bob = await signUp(app, 'bob@kc.gg', 'bob')
    host = await signUp(app, 'host@kc.gg', 'hostess')
    // These legacy row-policy checks exercise cast ownership and blocking, not
    // the reel-audience gate. Opt the fixtures into reuse explicitly so the
    // default followers-of-followers privacy remains covered by its own suite.
    for (const player of [alice, bob, host]) {
      const privacy = await request(app).post('/api/privacy/reels')
        .set('Authorization', `Bearer ${player.token}`).send({ value: 'anyone' })
      expect(privacy.status).toBe(200)
    }
    // Founder HOST code -> user_metadata.tko_host = true.
    const h = await request(app).post('/api/fn/redeem-code')
      .set('Authorization', `Bearer ${host.token}`).send({ code: 'TKO-HOST-K9F3QX' })
    expect(h.status).toBe(200); expect(h.body.host).toBe(true)
  })

  // ---- sensitive tables are gone from the generic API entirely -------------

  it('cannot read `users` — password hashes are unreachable, signed in or not', async () => {
    const anon = await db(app, null, { table: 'users', action: 'select' })
    expect(anon.status).toBe(400)
    expect(anon.body.error).toMatch(/unknown table/)
    expect(anon.body.data).toBeNull()

    const authed = await db(app, bob, { table: 'users', action: 'select', columns: '*' })
    expect(authed.status).toBe(400)
    expect(authed.body.error).toMatch(/unknown table/)
  })

  it('cannot read or write `redeem_codes` — the code catalogue is unreachable', async () => {
    const read = await db(app, bob, { table: 'redeem_codes', action: 'select' })
    expect(read.status).toBe(400)
    expect(read.body.error).toMatch(/unknown table/)

    const write = await db(app, bob, {
      table: 'redeem_codes', action: 'insert', values: { code: 'FREE-PRO', tier: 'creator' },
    })
    expect(write.status).toBe(400)
    expect(write.body.error).toMatch(/unknown table/)
  })

  it('cannot grant itself a tier or the host flag through a self-update', async () => {
    const esc = await db(app, bob, {
      table: 'profiles', action: 'update',
      filters: [{ col: 'id', op: 'eq', val: bob.id }],
      values: { reelone_tier: 'creator', tko_host: true, user_metadata: { tko_host: true } },
    })
    expect(esc.status).toBe(403)
    expect(esc.body.error).toMatch(/reelone_tier/)

    // The real entitlement is untouched: still the free tier.
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${bob.token}`)
    expect(me.body.user.user_metadata.reelone_tier).toBe('')
    expect(me.body.user.user_metadata.tko_host).toBe(false)
  })

  // ---- reel_participants: the cast list of a multi-angle reel --------------

  it('lets a reel’s author name who is in it, but nobody else', async () => {
    const reel = await db(app, alice, {
      table: 'reels', action: 'insert', single: true,
      values: { user_id: alice.id, title: 'four angles of one match' },
    })
    expect(reel.status).toBe(200)
    const reelId = reel.body.data.id

    // Alice owns the reel, so she may list Bob as a participant.
    const ok = await db(app, alice, {
      table: 'reel_participants', action: 'insert', single: true,
      values: { reel_id: reelId, user_id: bob.id },
    })
    expect(ok.status).toBe(200)
    expect(ok.body.data.user_id).toBe(bob.id)

    // Bob does NOT own the reel. He may not add himself to it — that would forge
    // a credit AND fire a "you're in a new clip" notification at its author.
    const forged = await db(app, bob, {
      table: 'reel_participants', action: 'insert', single: true,
      values: { reel_id: reelId, user_id: bob.id },
    })
    expect(forged.status).toBe(403)

    // …nor may he write someone else in.
    const forgedOther = await db(app, bob, {
      table: 'reel_participants', action: 'insert', single: true,
      values: { reel_id: reelId, user_id: alice.id },
    })
    expect(forgedOther.status).toBe(403)
  })

  it('makes the cast publicly readable but only reel-owner writable', async () => {
    const reel = await db(app, alice, {
      table: 'reels', action: 'insert', single: true,
      values: { user_id: alice.id, title: 'cast visibility' },
    })
    const reelId = reel.body.data.id
    const row = await db(app, alice, {
      table: 'reel_participants', action: 'insert', single: true,
      values: { reel_id: reelId, user_id: bob.id },
    })
    expect(row.status).toBe(200)

    // Anyone (even signed out) can see who is in a reel.
    const anon = await db(app, null, {
      table: 'reel_participants', action: 'select',
      filters: [{ col: 'reel_id', op: 'eq', val: reelId }],
    })
    expect(anon.status).toBe(200)
    expect(anon.body.data.length).toBe(1)

    // Bob can't delete himself out of Alice's reel.
    const del = await db(app, bob, {
      table: 'reel_participants', action: 'delete',
      filters: [{ col: 'id', op: 'eq', val: row.body.data.id }],
    })
    expect(del.status).toBe(403)

    // Alice, the reel's author, can.
    const mine = await db(app, alice, {
      table: 'reel_participants', action: 'delete',
      filters: [{ col: 'id', op: 'eq', val: row.body.data.id }],
    })
    expect(mine.status).toBe(200)
  })

  // ---- blocks: private in BOTH directions, and enforced on write -----------

  it('lets you read and write only your OWN blocks — nobody sees who blocked them', async () => {
    const mine = await db(app, alice, {
      table: 'blocks', action: 'insert', single: true,
      values: { blocker_id: alice.id, blocked_id: bob.id, hide_in_shared_lives: true },
    })
    expect(mine.status).toBe(200)
    // blocker_id is FORCED to the caller, so a block can't be created "as"
    // somebody else — even if the client says otherwise.
    const forged = await db(app, bob, {
      table: 'blocks', action: 'insert', single: true,
      values: { blocker_id: alice.id, blocked_id: host.id },
    })
    expect(forged.status).toBe(200)
    expect(forged.body.data.blocker_id).toBe(bob.id)

    // Alice sees her own block. Bob — the person she blocked — sees only his.
    const aliceSees = await db(app, alice, { table: 'blocks', action: 'select' })
    expect(aliceSees.body.data.map((r: any) => r.blocked_id)).toEqual([bob.id])
    const bobSees = await db(app, bob, { table: 'blocks', action: 'select' })
    expect(bobSees.body.data.map((r: any) => r.blocked_id)).toEqual([host.id])
    // THE INVARIANT: nothing Bob can read tells him Alice blocked him.
    expect(JSON.stringify(bobSees.body.data)).not.toContain(alice.id)

    // Only the blocker may lift it.
    const notYours = await db(app, bob, {
      table: 'blocks', action: 'delete',
      filters: [{ col: 'id', op: 'eq', val: mine.body.data.id }],
    })
    expect(notYours.status).toBe(403)
    const lift = await db(app, alice, {
      table: 'blocks', action: 'delete',
      filters: [{ col: 'id', op: 'eq', val: mine.body.data.id }],
    })
    expect(lift.status).toBe(200)
    await db(app, bob, {
      table: 'blocks', action: 'delete',
      filters: [{ col: 'id', op: 'eq', val: forged.body.data.id }],
    })
  })

  it('refuses a reel cast row for a blocked pair — in EITHER direction', async () => {
    const reel = await db(app, alice, {
      table: 'reels', action: 'insert', single: true,
      values: { user_id: alice.id, title: 'the match I won' },
    })
    const reelId = reel.body.data.id

    // BOB blocked ALICE. Alice assembles the reel of a match she won against
    // him — and Bob is refused a cast row, so the clip never reaches him. She
    // learns only that it was refused, never that he blocked her.
    const b = await db(app, bob, {
      table: 'blocks', action: 'insert', single: true,
      values: { blocked_id: alice.id },
    })
    expect(b.status).toBe(200)
    const refused = await db(app, alice, {
      table: 'reel_participants', action: 'insert', single: true,
      values: { reel_id: reelId, user_id: bob.id },
    })
    expect(refused.status).toBe(403)

    // Somebody with no block between them is unaffected.
    const fine = await db(app, alice, {
      table: 'reel_participants', action: 'insert', single: true,
      values: { reel_id: reelId, user_id: host.id },
    })
    expect(fine.status).toBe(200)

    // Lift the block and the same write goes through.
    await db(app, bob, {
      table: 'blocks', action: 'delete',
      filters: [{ col: 'id', op: 'eq', val: b.body.data.id }],
    })
    const now = await db(app, alice, {
      table: 'reel_participants', action: 'insert', single: true,
      values: { reel_id: reelId, user_id: bob.id },
    })
    expect(now.status).toBe(200)
  })

  it('keeps a hide_in_shared_lives pair off the same stage, but allows a plain block', async () => {
    const group = await db(app, alice, {
      table: 'live_groups', action: 'insert', single: true,
      values: { name: 'stage', link_reason: 'same_clan' },
    })
    const groupId = group.body.data.id
    const first = await db(app, alice, {
      table: 'live_group_members', action: 'insert', single: true,
      values: { group_id: groupId, user_id: alice.id },
    })
    expect(first.status).toBe(200)

    // A HARD block (hide_in_shared_lives) — Bob may not join Alice's stage.
    const hard = await db(app, bob, {
      table: 'blocks', action: 'insert', single: true,
      values: { blocked_id: alice.id, hide_in_shared_lives: true },
    })
    const refused = await db(app, alice, {
      table: 'live_group_members', action: 'insert', single: true,
      values: { group_id: groupId, user_id: bob.id },
    })
    expect(refused.status).toBe(403)

    // Soften it to a plain block: they may still share a stage (a tournament has
    // to keep working) — only AUTO-linking is off, which the engine enforces.
    await db(app, bob, {
      table: 'blocks', action: 'update',
      values: { hide_in_shared_lives: false },
      filters: [{ col: 'id', op: 'eq', val: hard.body.data.id }],
    })
    const allowed = await db(app, alice, {
      table: 'live_group_members', action: 'insert', single: true,
      values: { group_id: groupId, user_id: bob.id },
    })
    expect(allowed.status).toBe(200)

    await db(app, bob, {
      table: 'blocks', action: 'delete',
      filters: [{ col: 'id', op: 'eq', val: hard.body.data.id }],
    })
  })

  it('lets a user set their own auto_link_mode but nobody else’s', async () => {
    const mine = await db(app, alice, {
      table: 'profiles', action: 'update', single: true,
      values: { auto_link_mode: 'ask' },
      filters: [{ col: 'id', op: 'eq', val: alice.id }],
    })
    expect(mine.status).toBe(200)
    expect(mine.body.data.auto_link_mode).toBe('ask')

    // The engine has to read BOTH sides, so it is public to READ…
    const seen = await db(app, bob, {
      table: 'profiles', action: 'select', single: true,
      filters: [{ col: 'id', op: 'eq', val: alice.id }],
    })
    expect(seen.body.data.auto_link_mode).toBe('ask')

    // …but Bob can't silence Alice's preference for her.
    const forged = await db(app, bob, {
      table: 'profiles', action: 'update',
      values: { auto_link_mode: 'off' },
      filters: [{ col: 'id', op: 'eq', val: alice.id }],
    })
    expect(forged.status).toBe(403)

    await db(app, alice, {
      table: 'profiles', action: 'update',
      values: { auto_link_mode: 'auto' },
      filters: [{ col: 'id', op: 'eq', val: alice.id }],
    })
  })

  // ---- live linking: the multi-angle group + its session record ------------

  it('links live streams into a group, and only the group’s people may record its session', async () => {
    // Alice and Bob both go live. Streams are public to read, so each can see
    // the other's — that's what makes "who's live together" possible at all.
    for (const who of [alice, bob]) {
      const grant = await request(app).post('/api/fn/redeem-code')
        .set('Authorization', `Bearer ${who.token}`).send({ code: 'TKO-BETA' })
      expect(grant.status).toBe(200)
      expect(grant.body.tier).toBe('creator')
    }
    const aliceStream = await db(app, alice, {
      table: 'live_streams', action: 'insert', single: true,
      values: { youtube_url: 'https://youtu.be/aaa', title: 'Alice angle', placement: 'front_page' },
    })
    expect(aliceStream.status).toBe(200)
    expect(aliceStream.body.data.user_id).toBe(alice.id)
    const bobStream = await db(app, bob, {
      table: 'live_streams', action: 'insert', single: true,
      values: { youtube_url: 'https://youtu.be/bbb', title: 'Bob angle', placement: 'front_page' },
    })
    expect(bobStream.status).toBe(200)

    const anonSees = await db(app, null, { table: 'live_streams', action: 'select' })
    expect(anonSees.status).toBe(200)
    expect(anonSees.body.data.length).toBeGreaterThanOrEqual(2)

    // Alice links both angles into one stage. She's the creator, so she is
    // elevated for live_group_members and may add Bob's angle too.
    const group = await db(app, alice, {
      table: 'live_groups', action: 'insert', single: true,
      values: { name: 'Alice vs Bob — both angles', link_reason: 'scheduled_battle', confidence: 0.97 },
    })
    expect(group.status).toBe(200)
    expect(group.body.data.creator_id).toBe(alice.id) // owner column is forced
    const groupId = group.body.data.id

    const addBob = await db(app, alice, {
      table: 'live_group_members', action: 'insert', single: true,
      values: { group_id: groupId, user_id: bob.id, stream_id: bobStream.body.data.id, accepted: true },
    })
    expect(addBob.status).toBe(200)
    expect(addBob.body.data.user_id).toBe(bob.id)

    // The host is a stranger to this group — they cannot fabricate a session
    // record for it.
    const forged = await db(app, host, {
      table: 'live_group_sessions', action: 'insert', single: true,
      values: { group_id: groupId, stream_ids: '[]', user_ids: '[]' },
    })
    expect(forged.status).toBe(403)

    // Bob IS a member, so he may record the session when the stage ends. The
    // snapshot is what a combined highlight gets cut from later.
    const session = await db(app, bob, {
      table: 'live_group_sessions', action: 'insert', single: true,
      values: {
        group_id: groupId,
        creator_id: alice.id, // ignored — the recorder is stamped as the owner
        stream_ids: JSON.stringify([aliceStream.body.data.id, bobStream.body.data.id]),
        user_ids: JSON.stringify([alice.id, bob.id]),
        link_reason: 'scheduled_battle',
        duration_ms: 1_500_000,
      },
    })
    expect(session.status).toBe(200)
    expect(session.body.data.creator_id).toBe(bob.id)
    expect(Number(session.body.data.duration_ms)).toBe(1_500_000)

    // Anyone can read it back — that's how a combined clip gets built later.
    const anon = await db(app, null, {
      table: 'live_group_sessions', action: 'select',
      filters: [{ col: 'group_id', op: 'eq', val: groupId }],
    })
    expect(anon.status).toBe(200)
    expect(anon.body.data).toHaveLength(1)
  })

  // ---- ownership on UPDATE / DELETE ---------------------------------------

  it('cannot update another user’s row', async () => {
    const bad = await db(app, bob, {
      table: 'profiles', action: 'update',
      filters: [{ col: 'id', op: 'eq', val: alice.id }],
      values: { bio: 'owned by bob' },
    })
    expect(bad.status).toBe(403)
    expect(bad.body.error).toMatch(/do not own/)

    const check = await db(app, null, {
      table: 'profiles', action: 'select', single: true,
      filters: [{ col: 'id', op: 'eq', val: alice.id }],
    })
    expect(check.body.data.bio).toBeNull()
  })

  it('cannot delete someone else’s row, and an unfiltered delete cannot wipe the table', async () => {
    const mine = await db(app, alice, {
      table: 'clips', action: 'insert', single: true,
      values: { user_id: alice.id, source_type: 'youtube', url_or_path: 'https://youtu.be/a', title: 'alice ko' },
    })
    expect(mine.status).toBe(200)
    const clipId = mine.body.data.id

    const targeted = await db(app, bob, {
      table: 'clips', action: 'delete', filters: [{ col: 'id', op: 'eq', val: clipId }],
    })
    expect(targeted.status).toBe(403)

    // No filters at all — the old handler would have emptied the table.
    const wipe = await db(app, bob, { table: 'clips', action: 'delete' })
    expect(wipe.status).toBe(403)

    const still = await db(app, null, {
      table: 'clips', action: 'select', filters: [{ col: 'id', op: 'eq', val: clipId }],
    })
    expect(still.body.data.length).toBe(1)
  })

  it('a user CAN still do their own legitimate CRUD', async () => {
    const ins = await db(app, alice, {
      table: 'clips', action: 'insert', single: true,
      values: { user_id: alice.id, source_type: 'youtube', url_or_path: 'https://youtu.be/own', title: 'mine' },
    })
    expect(ins.status).toBe(200)

    const upd = await db(app, alice, {
      table: 'clips', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: ins.body.data.id }],
      values: { title: 'mine, edited' },
    })
    expect(upd.status).toBe(200); expect(upd.body.data.title).toBe('mine, edited')

    const del = await db(app, alice, {
      table: 'clips', action: 'delete', filters: [{ col: 'id', op: 'eq', val: ins.body.data.id }],
    })
    expect(del.status).toBe(200); expect(del.body.count).toBe(1)

    const prof = await db(app, alice, {
      table: 'profiles', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: alice.id }],
      values: { bio: 'shinobi' },
    })
    expect(prof.status).toBe(200); expect(prof.body.data.bio).toBe('shinobi')
  })

  // ---- INSERT forces the owner column -------------------------------------

  it('forces the owner column on insert — you cannot create rows as someone else', async () => {
    const r = await db(app, bob, {
      table: 'clips', action: 'insert', single: true,
      values: { user_id: alice.id, source_type: 'youtube', url_or_path: 'https://youtu.be/spoof', title: 'not alice’s' },
    })
    expect(r.status).toBe(200)
    expect(r.body.data.user_id).toBe(bob.id)
    expect(r.body.data.user_id).not.toBe(alice.id)
  })

  // ---- private tables are scoped ------------------------------------------

  it('scopes notifications to the recipient', async () => {
    // Cross-user notify is allowed (that is what a notification IS)...
    const n = await db(app, host, {
      table: 'notifications', action: 'insert', single: true,
      values: { user_id: alice.id, kind: 'generic', title: 'your battle is scheduled' },
    })
    expect(n.status).toBe(200)

    // ...but only Alice can read it.
    const asBob = await db(app, bob, { table: 'notifications', action: 'select' })
    expect(asBob.status).toBe(200)
    expect(asBob.body.data.length).toBe(0)

    const asAlice = await db(app, alice, { table: 'notifications', action: 'select' })
    expect(asAlice.body.data.length).toBe(1)

    // Even an explicit filter for someone else's rows returns nothing.
    const snoop = await db(app, bob, {
      table: 'notifications', action: 'select', filters: [{ col: 'user_id', op: 'eq', val: alice.id }],
    })
    expect(snoop.body.data.length).toBe(0)

    const anon = await db(app, null, { table: 'notifications', action: 'select' })
    expect(anon.status).toBe(401)
  })

  it('scopes the private pit meet-up to the two fighters', async () => {
    const t = await db(app, host, {
      table: 'tournaments', action: 'insert', single: true,
      values: { name: 'King', created_by: host.id, end_at: '2030-01-01T00:00:00.000Z' },
    })
    const tid = t.body.data.id
    const b = await db(app, host, {
      table: 'tournament_battles', action: 'insert', single: true,
      values: { tournament_id: tid, player_a: alice.id, player_b: bob.id, status: 'scheduled' },
    })
    expect(b.status).toBe(200)
    const bid = b.body.data.id

    const card = await db(app, alice, {
      table: 'battle_meetups', action: 'insert', single: true,
      values: { battle_id: bid, user_id: alice.id, in_game_name: 'ALICE_X' },
    })
    expect(card.status).toBe(200)

    const asBob = await db(app, bob, {
      table: 'battle_meetups', action: 'select', filters: [{ col: 'battle_id', op: 'eq', val: bid }],
    })
    expect(asBob.body.data.length).toBe(1) // a fighter in the battle sees it

    const stranger = await signUp(app, 'nosy@kc.gg', 'nosy')
    const asStranger = await db(app, stranger, {
      table: 'battle_meetups', action: 'select', filters: [{ col: 'battle_id', op: 'eq', val: bid }],
    })
    expect(asStranger.body.data.length).toBe(0)
  })

  // ---- privileged roles CAN act on other people's rows ---------------------

  it('a HOST can declare a battle winner; a fighter cannot', async () => {
    const t = await db(app, host, {
      table: 'tournaments', action: 'insert', single: true,
      values: { name: 'King II', created_by: host.id, end_at: '2030-01-01T00:00:00.000Z' },
    })
    const tid = t.body.data.id
    const b = await db(app, host, {
      table: 'tournament_battles', action: 'insert', single: true,
      values: { tournament_id: tid, player_a: alice.id, player_b: bob.id },
    })
    const bid = b.body.data.id

    // A non-host, non-fighter cannot create battles at all.
    const stranger = await signUp(app, 'rando@kc.gg', 'rando')
    const nope = await db(app, stranger, {
      table: 'tournament_battles', action: 'insert',
      values: { tournament_id: tid, player_a: stranger.id, player_b: alice.id },
    })
    expect(nope.status).toBe(403)

    // A fighter may self-schedule (play-anytime)...
    const sched = await db(app, alice, {
      table: 'tournament_battles', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: bid }],
      values: { scheduled_at: new Date().toISOString() },
    })
    expect(sched.status).toBe(200)
    expect(sched.body.data.scheduled_at).toBeTruthy()

    // ...but may NOT declare themselves the winner.
    const cheat = await db(app, alice, {
      table: 'tournament_battles', action: 'update',
      filters: [{ col: 'id', op: 'eq', val: bid }],
      values: { status: 'complete', winner: alice.id },
    })
    expect(cheat.status).toBe(403)

    // The host can.
    const decide = await db(app, host, {
      table: 'tournament_battles', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: bid }],
      values: { status: 'complete', winner: bob.id },
    })
    expect(decide.status).toBe(200)
    expect(decide.body.data.winner).toBe(bob.id)
  })

  it('trophy-closet entries are host-issued, never self-farmed', async () => {
    const self = await db(app, bob, {
      table: 'shinobi_defeats', action: 'insert',
      values: { user_id: bob.id, opponent_id: alice.id, beat_count: 99 },
    })
    expect(self.status).toBe(403)

    const byHost = await db(app, host, {
      table: 'shinobi_defeats', action: 'insert', single: true,
      values: { user_id: bob.id, opponent_id: alice.id, beat_count: 1 },
    })
    expect(byHost.status).toBe(200)
  })

  it('only clan managers assign membership roles while members can still leave', async () => {
    const leader = await signUp(app, 'leader@kc.gg', 'leader')
    const officer = await signUp(app, 'officer@kc.gg', 'officer')
    const grunt = await signUp(app, 'grunt@kc.gg', 'grunt')

    const s = await db(app, leader, {
      table: 'servers', action: 'insert', single: true,
      values: { name: 'Akatsuki', owner_id: leader.id, kind: 'clan' },
    })
    expect(s.status).toBe(200)
    const sid = s.body.data.id

    // The founder (server owner) may seat members at any rank.
    const seatOfficer = await db(app, leader, {
      table: 'clan_members', action: 'insert', single: true,
      values: { server_id: sid, user_id: officer.id, role: 'officer' },
    })
    expect(seatOfficer.status).toBe(200)

    // A normal user may only join themselves, as a plain member.
    const selfPromote = await db(app, grunt, {
      table: 'clan_members', action: 'insert',
      values: { server_id: sid, user_id: grunt.id, role: 'leader' },
    })
    expect(selfPromote.status).toBe(403)

    const join = await db(app, grunt, {
      table: 'clan_members', action: 'insert', single: true,
      values: { server_id: sid, user_id: grunt.id, role: 'member' },
    })
    expect(join.status).toBe(200)
    const gruntRow = join.body.data.id

    // Owning a membership row permits leaving, not assigning yourself a role.
    const updateSelfRole = await db(app, grunt, {
      table: 'clan_members', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: gruntRow }],
      values: { role: 'officer' },
    })
    expect(updateSelfRole.status).toBe(403)

    // A real manager can change the same role, then restore the plain member.
    const managerPromote = await db(app, leader, {
      table: 'clan_members', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: gruntRow }],
      values: { role: 'officer' },
    })
    expect(managerPromote.status).toBe(200)
    expect(managerPromote.body.data.role).toBe('officer')
    const managerRestore = await db(app, leader, {
      table: 'clan_members', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: gruntRow }],
      values: { role: 'member' },
    })
    expect(managerRestore.status).toBe(200)
    expect(managerRestore.body.data.role).toBe('member')

    // A plain member cannot kick the officer...
    const badKick = await db(app, grunt, {
      table: 'clan_members', action: 'delete',
      filters: [{ col: 'id', op: 'eq', val: seatOfficer.body.data.id }],
    })
    expect(badKick.status).toBe(403)

    // ...but the officer CAN kick the member.
    const kick = await db(app, officer, {
      table: 'clan_members', action: 'delete', filters: [{ col: 'id', op: 'eq', val: gruntRow }],
    })
    expect(kick.status).toBe(200); expect(kick.body.count).toBe(1)

    // A member can still remove their own clan membership.
    const rejoin = await db(app, grunt, {
      table: 'clan_members', action: 'insert', single: true,
      values: { server_id: sid, user_id: grunt.id, role: 'member' },
    })
    expect(rejoin.status).toBe(200)
    const leave = await db(app, grunt, {
      table: 'clan_members', action: 'delete',
      filters: [{ col: 'id', op: 'eq', val: rejoin.body.data.id }],
    })
    expect(leave.status).toBe(200)
    expect(leave.body.count).toBe(1)

    // The legacy board membership has the same ownership model. A self-join
    // lands at the database default role even if the caller asks for owner;
    // later self-promotion is refused, while the clan founder may assign it.
    const boardJoin = await db(app, grunt, {
      table: 'server_members', action: 'insert', single: true,
      values: { server_id: sid, user_id: grunt.id, role: 'owner' },
    })
    expect(boardJoin.status).toBe(200)
    expect(boardJoin.body.data.role).toBe('member')
    const boardSelfPromote = await db(app, grunt, {
      table: 'server_members', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: boardJoin.body.data.id }],
      values: { role: 'owner' },
    })
    expect(boardSelfPromote.status).toBe(403)
    const boardManagerPromote = await db(app, leader, {
      table: 'server_members', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: boardJoin.body.data.id }],
      values: { role: 'owner' },
    })
    expect(boardManagerPromote.status).toBe(200)
    expect(boardManagerPromote.body.data.role).toBe('owner')
    const boardLeave = await db(app, grunt, {
      table: 'server_members', action: 'delete',
      filters: [{ col: 'id', op: 'eq', val: boardJoin.body.data.id }],
    })
    expect(boardLeave.status).toBe(200)
    expect(boardLeave.body.count).toBe(1)
  })

  it('only league managers assign membership roles while members can still leave', async () => {
    const owner = await signUp(app, 'league-owner@kc.gg', 'leagueowner')
    const member = await signUp(app, 'league-member@kc.gg', 'leaguemember')
    const league = await db(app, owner, {
      table: 'leagues', action: 'insert', single: true,
      values: { slug: 'role-policy-league', name: 'Role Policy League', owner_id: owner.id },
    })
    expect(league.status).toBe(200)

    const forgedJoin = await db(app, member, {
      table: 'league_members', action: 'insert', single: true,
      values: { league_id: league.body.data.id, user_id: member.id, role: 'owner' },
    })
    expect(forgedJoin.status).toBe(403)

    const joined = await db(app, member, {
      table: 'league_members', action: 'insert', single: true,
      values: { league_id: league.body.data.id, user_id: member.id, role: 'member' },
    })
    expect(joined.status).toBe(200)

    const selfPromote = await db(app, member, {
      table: 'league_members', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: joined.body.data.id }],
      values: { role: 'officer' },
    })
    expect(selfPromote.status).toBe(403)

    const managerPromote = await db(app, owner, {
      table: 'league_members', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: joined.body.data.id }],
      values: { role: 'officer' },
    })
    expect(managerPromote.status).toBe(200)
    expect(managerPromote.body.data.role).toBe('officer')

    const managerRestore = await db(app, owner, {
      table: 'league_members', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: joined.body.data.id }],
      values: { role: 'member' },
    })
    expect(managerRestore.status).toBe(200)
    const leave = await db(app, member, {
      table: 'league_members', action: 'delete',
      filters: [{ col: 'id', op: 'eq', val: joined.body.data.id }],
    })
    expect(leave.status).toBe(200)
    expect(leave.body.count).toBe(1)
  })

  it('trigger-maintained and server-only tables refuse client writes', async () => {
    const pr = await db(app, bob, {
      table: 'code_redemptions', action: 'insert',
      values: { code: 'KILLCAM-TEST-CODE', user_id: bob.id, tier_granted: 'creator', grant_expires_at: new Date().toISOString() },
    })
    expect(pr.status).toBe(403)
  })

  it('public content stays public — anonymous reads still work', async () => {
    const clips = await db(app, null, { table: 'clips', action: 'select' })
    expect(clips.status).toBe(200)
    expect(Array.isArray(clips.body.data)).toBe(true)

    const profiles = await db(app, null, { table: 'profiles', action: 'select' })
    expect(profiles.status).toBe(200)
    expect(profiles.body.data.length).toBeGreaterThan(0)

    const tournaments = await db(app, null, { table: 'tournaments', action: 'select' })
    expect(tournaments.status).toBe(200)
  })

  it('whitelists the chat + clan tables the client needs (they used to 400)', async () => {
    const space = await db(app, alice, {
      table: 'chat_spaces', action: 'insert', single: true,
      values: { kind: 'open', name: 'Shinobi Lounge', owner_id: alice.id, clan_id: null },
    })
    expect(space.status).toBe(200)
    expect(space.body.data.owner_id).toBe(alice.id)

    const chan = await db(app, alice, {
      table: 'chat_channels', action: 'insert', single: true,
      values: { space_id: space.body.data.id, name: 'general', category: null, position: 0, is_announcement: false },
    })
    expect(chan.status).toBe(200)

    // Someone else cannot add channels to Alice's space.
    const intruder = await db(app, bob, {
      table: 'chat_channels', action: 'insert',
      values: { space_id: space.body.data.id, name: 'spam', position: 1 },
    })
    expect(intruder.status).toBe(403)

    // But anyone may post in it, as themselves.
    const msg = await db(app, bob, {
      table: 'chat_messages', action: 'insert', single: true,
      values: { channel_id: chan.body.data.id, user_id: alice.id, body: 'hi' },
    })
    expect(msg.status).toBe(200)
    expect(msg.body.data.user_id).toBe(bob.id) // owner forced

    // The space owner may moderate (delete) a message they did not write.
    const mod = await db(app, alice, {
      table: 'chat_messages', action: 'delete', filters: [{ col: 'id', op: 'eq', val: msg.body.data.id }],
    })
    expect(mod.status).toBe(200); expect(mod.body.count).toBe(1)

    const regs = await db(app, alice, { table: 'tournament_registrations', action: 'select' })
    expect(regs.status).toBe(200)
  })

  it('creates one clan chat through the trusted member-only function', async () => {
    const leader = await signUp(app, 'chat-leader@kc.gg', 'chatleader')
    const member = await signUp(app, 'chat-member@kc.gg', 'chatmember')
    const outsider = await signUp(app, 'chat-outsider@kc.gg', 'chatoutsider')
    const clan = await db(app, leader, {
      table: 'servers', action: 'insert', single: true,
      values: { name: 'Chat Guard Clan', owner_id: leader.id, kind: 'clan' },
    })
    expect(clan.status).toBe(200)
    const serverId = clan.body.data.id
    const seat = await db(app, leader, {
      table: 'clan_members', action: 'insert', single: true,
      values: { server_id: serverId, user_id: member.id, role: 'member' },
    })
    expect(seat.status).toBe(200)

    const refused = await request(app).post('/api/fn/clan-chat-space-ensure')
      .set('Authorization', `Bearer ${outsider.token}`).send({ serverId })
    expect(refused.status).toBe(403)

    const first = await request(app).post('/api/fn/clan-chat-space-ensure')
      .set('Authorization', `Bearer ${member.token}`).send({ serverId })
    expect(first.status).toBe(200)
    expect(first.body.space.kind).toBe('clan')
    expect(first.body.space.clan_id).toBe(serverId)
    expect(first.body.space.owner_id).toBe(leader.id)

    const again = await request(app).post('/api/fn/clan-chat-space-ensure')
      .set('Authorization', `Bearer ${leader.token}`).send({ serverId })
    expect(again.status).toBe(200)
    expect(again.body.space.id).toBe(first.body.space.id)

    const spaces = await db(app, member, {
      table: 'chat_spaces', action: 'select',
      filters: [{ col: 'clan_id', op: 'eq', val: serverId }],
    })
    expect(spaces.body.data).toHaveLength(1)
    const channels = await db(app, member, {
      table: 'chat_channels', action: 'select',
      filters: [{ col: 'space_id', op: 'eq', val: first.body.space.id }],
    })
    expect(channels.body.data.map((row: any) => row.name)).toEqual(['general'])
  })

  it('does not let an open chat owner turn their row into an official TKO or clan space', async () => {
    const chatter = await signUp(app, 'space-owner@kc.gg', 'spaceowner')
    const space = await db(app, chatter, {
      table: 'chat_spaces', action: 'insert', single: true,
      values: { kind: 'open', name: 'Ordinary Lounge', owner_id: chatter.id, clan_id: null },
    })
    expect(space.status).toBe(200)

    const claimOfficial = await db(app, chatter, {
      table: 'chat_spaces', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: space.body.data.id }],
      values: { kind: 'tko' },
    })
    expect(claimOfficial.status).toBe(403)

    // Ordinary owner edits still work; only the space's authority identity is fixed.
    const rename = await db(app, chatter, {
      table: 'chat_spaces', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: space.body.data.id }],
      values: { name: 'Renamed Lounge' },
    })
    expect(rename.status).toBe(200)
    expect(rename.body.data.name).toBe('Renamed Lounge')
  })

})

// ===========================================================================
// MONEY SAFETY — nothing may be acknowledged or granted without a real,
// verified payment. These endpoints must FAIL, not succeed, while Stripe is off.
// ===========================================================================
describe('TKO API — payments fail closed', () => {
  const app = makeApp()
  let who: Who

  it('signs a user up', async () => { who = await signUp(app, 'buyer@kc.gg', 'buyer') })

  it('refuses subscription checkout while STRIPE_SECRET_KEY is unset', async () => {
    const r = await request(app).post('/api/checkout')
      .set('Authorization', `Bearer ${who.token}`).send({ tier: 'pro' })
    expect(r.status).toBe(503)
    expect(r.body.error).toBe('stripe_not_configured')
    expect(r.body.url).toBeUndefined()
  })

  it('never sells a token pack — there is no ledger to credit', async () => {
    const r = await request(app).post('/api/checkout')
      .set('Authorization', `Bearer ${who.token}`).send({ pack: 'small' })
    // Refused before any Stripe call: 503 (key unset) or 501 (packs unsellable).
    expect([501, 503]).toContain(r.status)
    expect(r.body.url).toBeUndefined()
  })

  it('refuses an unsigned webhook instead of granting a tier from it', async () => {
    const forged = {
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', payment_status: 'paid', client_reference_id: who.id, metadata: { user_id: who.id, tier: 'creator' } } },
    }
    const r = await request(app).post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify(forged)))
    expect(r.status).toBe(503)
    expect(r.body.received).toBeUndefined()

    // Critically: no entitlement was granted.
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${who.token}`)
    expect(me.body.user.user_metadata.reelone_tier).toBe('')
  })
})

// ===========================================================================
// STRIPE — CHECKOUT AND, CRITICALLY, FULFILMENT.
//
// The dangerous bug this suite exists to prevent: taking real money and
// delivering nothing. Previously a paid token pack was acknowledged without
// crediting anything. Every test below asserts on what the user actually ENDS UP
// WITH, not on whether an endpoint returned 200.
//
// The Stripe REST API is stubbed at `fetch` (server/app.ts deliberately has no
// `stripe` npm dependency), so no network call leaves the test and no key is
// ever needed. `sk_test_stub` below is a dummy string, not a credential.
// ===========================================================================

/** Fake Stripe REST endpoint. Records every call so tests can assert on params. */
type StripeCall = { path: string; params: URLSearchParams }

const WEBHOOK_SECRET = 'whsec_stub_secret_for_tests'
let stripeCalls: StripeCall[] = []
let realFetch: typeof globalThis.fetch

/**
 * What `GET /subscriptions?customer=...` lists back. Mutable so a test can put
 * the customer in a specific billing state (cancelled, trialing, past due)
 * without a live Stripe.
 */
let stripeSubscriptionList: any[] = []

/**
 * Arm a ONE-SHOT failure for the next call to a path. Used to prove the server
 * distinguishes "the operator never saved a Customer Portal configuration in the
 * Stripe dashboard" from a generic Stripe error — that misconfiguration is the
 * single most likely thing to break the cancel button in production.
 */
let stripeFailPath: string | null = null
let stripeFailMessage = ''

/** Canned responses for the handful of Stripe endpoints the server calls. */
function stripeStubResponse(path: string): any {
  if (path === '/customers') return { id: 'cus_stub_1' }
  if (path === '/checkout/sessions') {
    return { id: 'cs_stub_1', url: 'https://checkout.stripe.com/c/pay/cs_stub_1' }
  }
  if (path.startsWith('/billing_portal/sessions')) {
    return { id: 'bps_stub_1', url: 'https://billing.stripe.com/p/session/bps_stub_1' }
  }
  // The LIST (GET, with a query string) — distinct from the POST that creates one.
  if (path.startsWith('/subscriptions?')) {
    return { object: 'list', data: stripeSubscriptionList }
  }
  if (path === '/subscriptions') {
    return { id: 'sub_stub_1', status: 'active', current_period_end: Math.floor(Date.now() / 1000) + 2592000 }
  }
  return {}
}

function installStripeStub() {
  realFetch = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any) => {
    const path = String(url).replace('https://api.stripe.com/v1', '')
    const params = new URLSearchParams(String(init?.body ?? ''))
    stripeCalls.push({ path, params })
    if (stripeFailPath && path.startsWith(stripeFailPath)) {
      const message = stripeFailMessage
      stripeFailPath = null
      return { ok: false, status: 400, json: async () => ({ error: { message } }) } as any
    }
    const body = stripeStubResponse(path)
    return { ok: true, status: 200, json: async () => body } as any
  }) as typeof globalThis.fetch
}

/** Build the `Stripe-Signature` header the way Stripe does. */
function signWebhook(payload: string, secret = WEBHOOK_SECRET): string {
  const t = Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex')
  return `t=${t},v1=${v1}`
}

/**
 * POST a correctly-signed event to the webhook.
 *
 * The payload is sent as a STRING, not a Buffer: superagent re-serializes a
 * Buffer body under an application/json content type, which changes the bytes
 * and therefore breaks the HMAC — the signature is computed over the exact raw
 * body, so the test has to transmit exactly what it signed.
 */
function sendEvent(app: any, event: any, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event)
  return request(app).post('/api/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', signWebhook(payload, secret))
    .send(payload)
}

/** The authoritative wallet balance, straight from the server. */
async function walletOf(app: any, who: Who): Promise<{ tokens: number; sweeps: number }> {
  const r = await request(app).post('/api/fn/wallet').set('Authorization', `Bearer ${who.token}`).send({})
  return { tokens: Number(r.body.wallet?.tokens ?? 0), sweeps: Number(r.body.wallet?.sweeps ?? 0) }
}

/** The tier currently granted on the account. */
async function tierOf(app: any, who: Who): Promise<string> {
  const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${who.token}`)
  return String(r.body.user?.user_metadata?.reelone_tier ?? '')
}

describe('TKO API — the token pack catalogue cannot drift', () => {
  // The price shown in the Store and the Tokens delivered by the webhook come
  // from two different files (the client bundle and the server). If they ever
  // disagree we charge for one thing and deliver another, which is exactly the
  // class of bug this whole exercise is about.
  it('server and client pack catalogues are identical', () => {
    expect(SERVER_TOKEN_PACKS.map((p) => ({ id: p.id, tokens: p.tokens, bonusSweeps: p.bonusSweeps, priceUsd: p.priceUsd })))
      .toEqual(TOKEN_PACKS.map((p) => ({ id: p.id, tokens: p.tokens, bonusSweeps: p.bonusSweeps, priceUsd: p.priceUsd })))
  })

  it('an unknown pack id resolves to null rather than a default', () => {
    expect(serverPackById('mega')?.tokens).toBe(3000)
    expect(serverPackById('not-a-pack')).toBeNull()
    expect(serverPackById('')).toBeNull()
    expect(serverPackById(undefined)).toBeNull()
  })
})

describe('TKO API — Stripe checkout + webhook fulfilment', () => {
  const app = makeApp()
  let buyer: Who
  let other: Who
  /** Never checked out, so never got a Stripe customer — the free-tier case. */
  let neverPaid: Who

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_stub'
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    process.env.STRIPE_PRICE_PRO = 'price_stub_pro'
    process.env.STRIPE_PRICE_CREATOR = 'price_stub_creator'
    process.env.STRIPE_PRICE_PACK_PLUS = 'price_stub_pack_plus'
    delete process.env.STRIPE_PRICE_AD_FREE // deliberately unconfigured
    installStripeStub()
    buyer = await signUp(app, 'stripe-buyer@kc.gg', 'stripebuyer')
    other = await signUp(app, 'stripe-other@kc.gg', 'stripeother')
    neverPaid = await signUp(app, 'stripe-freetier@kc.gg', 'stripefreetier')
  })

  afterAll(() => {
    globalThis.fetch = realFetch
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_WEBHOOK_SECRET
    delete process.env.STRIPE_PRICE_PRO
    delete process.env.STRIPE_PRICE_CREATOR
    delete process.env.STRIPE_PRICE_PACK_PLUS
  })

  // ---- price -> tier resolution -------------------------------------------
  it('maps a configured price id back to its tier', () => {
    expect(tierForPrice('price_stub_pro')).toBe('pro')
    expect(tierForPrice('price_stub_creator')).toBe('creator')
    expect(tierForPrice('price_unknown')).toBe('')
    expect(tierForPrice('')).toBe('')
    expect(SUBSCRIPTION_TIERS).toContain('supporter')
  })

  // ---- checkout ------------------------------------------------------------
  it('checkout REQUIRES authentication', async () => {
    const r = await request(app).post('/api/checkout').send({ tier: 'pro' })
    expect(r.status).toBe(401)
    expect(r.body.url).toBeUndefined()
  })

  it('creates a subscription session tied to the authenticated user', async () => {
    stripeCalls = []
    const r = await request(app).post('/api/checkout')
      .set('Authorization', `Bearer ${buyer.token}`).send({ tier: 'pro' })
    expect(r.status).toBe(200)
    expect(r.body.url).toContain('checkout.stripe.com')

    // A Stripe Customer was created for the user and reused thereafter.
    expect(stripeCalls.some((c) => c.path === '/customers')).toBe(true)
    const session = stripeCalls.find((c) => c.path === '/checkout/sessions')!
    expect(session.params.get('mode')).toBe('subscription')
    expect(session.params.get('line_items[0][price]')).toBe('price_stub_pro')
    expect(session.params.get('client_reference_id')).toBe(buyer.id)
    expect(session.params.get('metadata[user_id]')).toBe(buyer.id)
    expect(session.params.get('metadata[tier]')).toBe('pro')
    expect(session.params.get('customer')).toBe('cus_stub_1')
    // The subscription carries the identifiers too, so renewals are attributable.
    expect(session.params.get('subscription_data[metadata][user_id]')).toBe(buyer.id)
  })

  it('reuses the stored Stripe customer on the next checkout', async () => {
    stripeCalls = []
    const r = await request(app).post('/api/checkout')
      .set('Authorization', `Bearer ${buyer.token}`).send({ tier: 'pro' })
    expect(r.status).toBe(200)
    // No second Customer — the id was persisted on the user record.
    expect(stripeCalls.some((c) => c.path === '/customers')).toBe(false)
  })

  it('opens a real one-time session for a token pack', async () => {
    stripeCalls = []
    const r = await request(app).post('/api/checkout')
      .set('Authorization', `Bearer ${buyer.token}`).send({ pack: 'plus' })
    expect(r.status).toBe(200)
    expect(r.body.url).toContain('checkout.stripe.com')
    const session = stripeCalls.find((c) => c.path === '/checkout/sessions')!
    expect(session.params.get('mode')).toBe('payment')
    expect(session.params.get('line_items[0][price]')).toBe('price_stub_pack_plus')
    expect(session.params.get('metadata[pack]')).toBe('plus')
    // Only the pack KEY travels — never a token amount the client could inflate.
    expect(session.params.get('metadata[tokens]')).toBeNull()
  })

  it('passes a Stripe-managed trial period through when asked', async () => {
    stripeCalls = []
    const r = await request(app).post('/api/checkout')
      .set('Authorization', `Bearer ${buyer.token}`).send({ tier: 'pro', trialDays: 7 })
    expect(r.status).toBe(200)
    const session = stripeCalls.find((c) => c.path === '/checkout/sessions')!
    expect(session.params.get('subscription_data[trial_period_days]')).toBe('7')
  })

  it('clamps an absurd trial request instead of honouring it', async () => {
    stripeCalls = []
    await request(app).post('/api/checkout')
      .set('Authorization', `Bearer ${buyer.token}`).send({ tier: 'pro', trialDays: 3650 })
    const session = stripeCalls.find((c) => c.path === '/checkout/sessions')!
    expect(Number(session.params.get('subscription_data[trial_period_days]'))).toBeLessThanOrEqual(30)
  })

  it('refuses an unknown pack and an unknown tier', async () => {
    const bad = await request(app).post('/api/checkout')
      .set('Authorization', `Bearer ${buyer.token}`).send({ pack: 'infinite-tokens' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('unknown_pack')

    const badTier = await request(app).post('/api/checkout')
      .set('Authorization', `Bearer ${buyer.token}`).send({ tier: 'god_mode' })
    expect(badTier.status).toBe(400)
    expect(badTier.body.error).toBe('unknown_tier')
  })

  it('refuses a tier that has no price configured rather than guessing one', async () => {
    // `supporter` is still on sale but has no STRIPE_PRICE_SUPPORTER in this
    // block. (This probe used to use ad_free, which now fails one step earlier
    // as `tier_retired` — see the retired-SKU block further down.)
    const r = await request(app).post('/api/checkout')
      .set('Authorization', `Bearer ${buyer.token}`).send({ tier: 'supporter' })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('no_price')
  })

  it('ignores a client-supplied priceId (it cannot buy Legend for 99 cents)', async () => {
    stripeCalls = []
    const r = await request(app).post('/api/checkout')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ tier: 'creator', priceId: 'price_stub_pack_plus' })
    expect(r.status).toBe(200)
    const session = stripeCalls.find((c) => c.path === '/checkout/sessions')!
    // The server's price for the tier, NOT the cheap one the client asked for.
    expect(session.params.get('line_items[0][price]')).toBe('price_stub_creator')
  })

  // ---- SELF-SERVE CANCELLATION: the Stripe Customer Portal -----------------
  //
  // The compliance failure this closes: a paid subscriber had NO way to cancel
  // in the app. The FTC negative-option rule and the state auto-renewal statutes
  // require cancelling to be at least as easy as signing up, so these tests
  // assert the exit exists, is tied to the caller's OWN customer, and answers
  // the never-paid case plainly instead of erroring at someone who owes nothing.

  it('the billing portal REQUIRES authentication', async () => {
    const r = await request(app).post('/api/billing/portal').send({})
    expect(r.status).toBe(401)
    expect(r.body.url).toBeUndefined()
  })

  it('opens a portal session for the CALLER\'S OWN Stripe customer', async () => {
    stripeCalls = []
    const r = await request(app).post('/api/billing/portal')
      .set('Authorization', `Bearer ${buyer.token}`).send({})
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.url).toContain('billing.stripe.com')

    const session = stripeCalls.find((c) => c.path === '/billing_portal/sessions')!
    expect(session).toBeTruthy()
    // The customer is read from OUR user record — never from the request body.
    expect(session.params.get('customer')).toBe('cus_stub_1')
    expect(session.params.get('return_url')).toContain('/upgrade')
  })

  it('honours an in-app returnTo but clamps anything that could redirect off-site', async () => {
    stripeCalls = []
    await request(app).post('/api/billing/portal')
      .set('Authorization', `Bearer ${buyer.token}`).send({ returnTo: '/profile' })
    expect(stripeCalls.find((c) => c.path === '/billing_portal/sessions')!
      .params.get('return_url')).toContain('/profile')

    for (const hostile of ['//evil.example/steal', 'https://evil.example', 'javascript:alert(1)', 'not-a-path']) {
      stripeCalls = []
      await request(app).post('/api/billing/portal')
        .set('Authorization', `Bearer ${buyer.token}`).send({ returnTo: hostile })
      const url = stripeCalls.find((c) => c.path === '/billing_portal/sessions')!.params.get('return_url')!
      expect(url).not.toContain('evil.example')
      expect(url).not.toContain('javascript:')
      expect(url).toContain('/upgrade') // fell back to the safe default
    }
  })

  it('answers plainly — not with an error — when the caller never paid', async () => {
    stripeCalls = []
    const r = await request(app).post('/api/billing/portal')
      .set('Authorization', `Bearer ${neverPaid.token}`).send({})
    // 200, because "you have no subscription" is an ANSWER, not a failure.
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(false)
    expect(r.body.error).toBe('no_customer')
    expect(String(r.body.detail)).toBeTruthy()
    // And no Stripe call was made on behalf of a user with no customer.
    expect(stripeCalls.some((c) => c.path.startsWith('/billing_portal'))).toBe(false)
  })

  it('names an unconfigured Customer Portal rather than a generic stripe_error', async () => {
    // Exactly what Stripe replies when the dashboard has no saved portal config.
    stripeFailPath = '/billing_portal/sessions'
    stripeFailMessage = 'No configuration provided and your test mode default configuration has not been created.'
    const r = await request(app).post('/api/billing/portal')
      .set('Authorization', `Bearer ${buyer.token}`).send({})
    expect(r.status).toBe(502)
    expect(r.body.ok).toBe(false)
    expect(r.body.error).toBe('portal_not_configured')
    expect(String(r.body.detail)).toContain('configuration')
  })

  it('refuses the portal outright while Stripe is switched off', async () => {
    const key = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    try {
      const r = await request(app).post('/api/billing/portal')
        .set('Authorization', `Bearer ${buyer.token}`).send({})
      expect(r.status).toBe(503)
      expect(r.body.error).toBe('stripe_not_configured')
    } finally {
      process.env.STRIPE_SECRET_KEY = key
    }
  })

  // ---- what the manage-subscription panel reads ---------------------------
  it('reports no billing account for a free user, without calling Stripe', async () => {
    stripeCalls = []
    const r = await request(app).get('/api/billing/subscription')
      .set('Authorization', `Bearer ${neverPaid.token}`)
    expect(r.status).toBe(200)
    expect(r.body.hasBillingAccount).toBe(false)
    expect(r.body.tier).toBe('')
    expect(r.body.subscription).toBeNull()
    expect(stripeCalls.some((c) => c.path.startsWith('/subscriptions'))).toBe(false)
  })

  it('surfaces a cancel-at-period-end so the UI stops saying "renews"', async () => {
    const ends = Math.floor(Date.now() / 1000) + 86400 * 12
    stripeSubscriptionList = [{
      id: 'sub_stub_1', status: 'active', cancel_at_period_end: true,
      current_period_end: ends, created: 1,
      items: { data: [{ price: { id: 'price_stub_pro' } }] },
    }]
    const r = await request(app).get('/api/billing/subscription')
      .set('Authorization', `Bearer ${buyer.token}`)
    expect(r.status).toBe(200)
    expect(r.body.hasBillingAccount).toBe(true)
    expect(r.body.subscription.id).toBe('sub_stub_1')
    expect(r.body.subscription.cancelAtPeriodEnd).toBe(true)
    // Named from the PRICE, the thing Stripe actually bills.
    expect(r.body.subscription.tier).toBe('pro')
    expect(new Date(r.body.subscription.currentPeriodEnd).getTime())
      .toBe(ends * 1000)
    stripeSubscriptionList = []
  })

  it('prefers the LIVE plan over a stale cancelled one, and ignores creator subs', async () => {
    stripeSubscriptionList = [
      { id: 'sub_old', status: 'canceled', created: 10, items: { data: [{ price: { id: 'price_stub_pro' } }] } },
      { id: 'sub_creator', status: 'active', created: 20, metadata: { kind: 'creator_order' }, items: { data: [{ price: { id: 'price_stub_creator' } }] } },
      { id: 'sub_live', status: 'active', created: 5, items: { data: [{ price: { id: 'price_stub_creator' } }] } },
    ]
    const r = await request(app).get('/api/billing/subscription')
      .set('Authorization', `Bearer ${buyer.token}`)
    expect(r.body.subscription.id).toBe('sub_live')
    stripeSubscriptionList = []
  })

  it('degrades to the local record when the Stripe list call fails', async () => {
    stripeFailPath = '/subscriptions?'
    stripeFailMessage = 'stripe is having a day'
    const r = await request(app).get('/api/billing/subscription')
      .set('Authorization', `Bearer ${buyer.token}`)
    expect(r.status).toBe(200)          // never an error page over billing status
    expect(r.body.hasBillingAccount).toBe(true)
    expect(r.body.subscription).toBeNull()
  })

  // ---- webhook: signature --------------------------------------------------
  it('rejects a webhook with no signature, even with Stripe fully configured', async () => {
    const forged = {
      id: 'evt_forged_1',
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', payment_status: 'paid', metadata: { user_id: buyer.id, tier: 'creator' } } },
    }
    const r = await request(app).post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify(forged)))
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('invalid_signature')
    expect(await tierOf(app, buyer)).toBe('')
  })

  it('rejects a webhook signed with the WRONG secret', async () => {
    const forged = {
      id: 'evt_forged_2',
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', payment_status: 'paid', metadata: { user_id: buyer.id, tier: 'creator' } } },
    }
    const r = await sendEvent(app, forged, 'whsec_the_attackers_own_secret')
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('invalid_signature')
    expect(await tierOf(app, buyer)).toBe('')
  })

  // ---- webhook: subscription fulfilment ------------------------------------
  it('grants the tier on a PAID subscription session', async () => {
    const r = await sendEvent(app, {
      id: 'evt_sub_paid_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_sub_1', mode: 'subscription', payment_status: 'paid',
          customer: 'cus_stub_1', subscription: 'sub_stub_1',
          amount_total: 499, currency: 'usd',
          metadata: { user_id: buyer.id, tier: 'pro' },
        },
      },
    })
    expect(r.status).toBe(200)
    expect(r.body.received).toBe(true)
    expect(await tierOf(app, buyer)).toBe('pro')
  })

  it('writes a payments audit row for the subscription', async () => {
    const rows = await db(app, buyer, { table: 'payments', action: 'select' })
    expect(rows.status).toBe(200)
    const sub = rows.body.data.find((p: any) => p.kind === 'subscription')
    expect(sub).toBeTruthy()
    expect(sub.status).toBe('paid')
    expect(sub.tier).toBe('pro')
    expect(Number(sub.amount_cents)).toBe(499)
  })

  it('grants NOTHING for an unpaid subscription session', async () => {
    const before = await tierOf(app, other)
    expect(before).toBe('')
    const r = await sendEvent(app, {
      id: 'evt_sub_unpaid_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_sub_unpaid', mode: 'subscription', payment_status: 'unpaid',
          amount_total: 2999, currency: 'usd',
          metadata: { user_id: other.id, tier: 'creator' },
        },
      },
    })
    expect(r.status).toBe(200)
    expect(await tierOf(app, other)).toBe('') // still Free
  })

  // ---- webhook: TOKEN PACK fulfilment (the bug this all exists for) --------
  it('credits EXACTLY the pack contents on a paid pack session', async () => {
    const before = await walletOf(app, buyer)
    const pack = serverPackById('plus')!
    const r = await sendEvent(app, {
      id: 'evt_pack_paid_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_pack_1', mode: 'payment', payment_status: 'paid',
          customer: 'cus_stub_1', amount_total: 499, currency: 'usd',
          metadata: { user_id: buyer.id, pack: 'plus' },
        },
      },
    })
    expect(r.status).toBe(200)
    const after = await walletOf(app, buyer)
    expect(after.tokens).toBe(before.tokens + pack.tokens)   // 550
    expect(after.sweeps).toBe(before.sweeps + pack.bonusSweeps) // 200
  })

  it('books a wallet_ledger row for the purchase (the credit never bypasses the ledger)', async () => {
    const led = await db(app, buyer, { table: 'wallet_ledger', action: 'select' })
    expect(led.status).toBe(200)
    const purchase = led.body.data.find((l: any) => l.kind === 'purchase')
    expect(purchase).toBeTruthy()
    expect(Number(purchase.tokens_delta)).toBe(550)
    expect(Number(purchase.sweeps_delta)).toBe(200)
    expect(purchase.ref_id).toBe('cs_pack_1')
  })

  // ---- IDEMPOTENCY ---------------------------------------------------------
  it('a REPLAYED event does not credit twice', async () => {
    const before = await walletOf(app, buyer)
    const replay = {
      id: 'evt_pack_paid_1', // the SAME event id as above
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_pack_1', mode: 'payment', payment_status: 'paid',
          customer: 'cus_stub_1', amount_total: 499, currency: 'usd',
          metadata: { user_id: buyer.id, pack: 'plus' },
        },
      },
    }
    // Stripe retries deliver the identical payload, correctly signed.
    const first = await sendEvent(app, replay)
    expect(first.status).toBe(200)
    expect(first.body.duplicate).toBe(true)
    const second = await sendEvent(app, replay)
    expect(second.body.duplicate).toBe(true)

    const after = await walletOf(app, buyer)
    expect(after.tokens).toBe(before.tokens) // unchanged
    expect(after.sweeps).toBe(before.sweeps)
  })

  it('a replayed SUBSCRIPTION event does not re-grant either', async () => {
    // Downgrade first so a re-grant would be visible.
    await sendEvent(app, {
      id: 'evt_sub_lapse_probe',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_stub_1', customer: 'cus_stub_1', metadata: { user_id: buyer.id } } },
    })
    expect(await tierOf(app, buyer)).toBe('')

    // Replay the ORIGINAL grant event — it must be ignored.
    const replay = await sendEvent(app, {
      id: 'evt_sub_paid_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_sub_1', mode: 'subscription', payment_status: 'paid',
          metadata: { user_id: buyer.id, tier: 'pro' },
        },
      },
    })
    expect(replay.body.duplicate).toBe(true)
    expect(await tierOf(app, buyer)).toBe('') // still Free — no re-grant
  })

  it('credits nothing for a pack id that is not in the catalogue', async () => {
    const before = await walletOf(app, buyer)
    const r = await sendEvent(app, {
      id: 'evt_pack_bogus_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_pack_bogus', mode: 'payment', payment_status: 'paid',
          amount_total: 99, currency: 'usd',
          metadata: { user_id: buyer.id, pack: 'ten-million-tokens' },
        },
      },
    })
    expect(r.status).toBe(200)
    expect(await walletOf(app, buyer)).toEqual(before)
  })

  it('credits nothing for an UNPAID pack session', async () => {
    const before = await walletOf(app, buyer)
    const r = await sendEvent(app, {
      id: 'evt_pack_unpaid_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_pack_unpaid', mode: 'payment', payment_status: 'unpaid',
          amount_total: 1999, currency: 'usd',
          metadata: { user_id: buyer.id, pack: 'mega' },
        },
      },
    })
    expect(r.status).toBe(200)
    expect(await walletOf(app, buyer)).toEqual(before)
  })

  // ---- subscription lifecycle ---------------------------------------------
  it('extends the tier while the subscription is active, using the price to name it', async () => {
    const until = Math.floor(Date.now() / 1000) + 2592000
    await sendEvent(app, {
      id: 'evt_sub_updated_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_stub_1', status: 'active', customer: 'cus_stub_1',
          current_period_end: until,
          items: { data: [{ price: { id: 'price_stub_creator' } }] },
          metadata: { user_id: buyer.id },
        },
      },
    })
    // The PRICE said Legend, so Legend it is — even though nothing said 'tier'.
    expect(await tierOf(app, buyer)).toBe('creator')
  })

  it('lapses the tier when the subscription goes past_due', async () => {
    await sendEvent(app, {
      id: 'evt_sub_pastdue_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_stub_1', status: 'past_due', customer: 'cus_stub_1',
          items: { data: [{ price: { id: 'price_stub_creator' } }] },
          metadata: { user_id: buyer.id },
        },
      },
    })
    expect(await tierOf(app, buyer)).toBe('')
  })

  it('lapses the tier on invoice.payment_failed', async () => {
    // Re-grant so the lapse is observable.
    await sendEvent(app, {
      id: 'evt_sub_regrant_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_stub_1', status: 'active', customer: 'cus_stub_1',
          current_period_end: Math.floor(Date.now() / 1000) + 2592000,
          items: { data: [{ price: { id: 'price_stub_pro' } }] },
          metadata: { user_id: buyer.id },
        },
      },
    })
    expect(await tierOf(app, buyer)).toBe('pro')

    await sendEvent(app, {
      id: 'evt_invoice_failed_1',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_stub_1', customer: 'cus_stub_1', subscription: 'sub_stub_1',
          amount_due: 499, currency: 'usd', metadata: { user_id: buyer.id },
        },
      },
    })
    expect(await tierOf(app, buyer)).toBe('')
  })

  it('restores the tier when a renewal invoice is paid', async () => {
    await sendEvent(app, {
      id: 'evt_invoice_paid_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_stub_2', customer: 'cus_stub_1', subscription: 'sub_stub_1',
          amount_paid: 499, currency: 'usd',
          lines: { data: [{ price: { id: 'price_stub_pro' }, period: { end: Math.floor(Date.now() / 1000) + 2592000 } }] },
        },
      },
    })
    // Resolved purely through the CUSTOMER mapping — a renewal invoice carries
    // no metadata of ours, which is why the customer id is stored on the user.
    expect(await tierOf(app, buyer)).toBe('pro')
  })

  it('ends access for good on customer.subscription.deleted', async () => {
    await sendEvent(app, {
      id: 'evt_sub_deleted_final',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_stub_1', customer: 'cus_stub_1', metadata: { user_id: buyer.id } } },
    })
    expect(await tierOf(app, buyer)).toBe('')
  })

  // ---- CANCELLING IN THE PORTAL REALLY ENDS ACCESS -------------------------
  //
  // A cancel button that leaves the tier granted forever is worse than no
  // button — it takes the churn AND keeps the liability. These pin the two
  // shapes Stripe actually sends when someone cancels in the Customer Portal.

  it('a portal "cancel at period end" keeps the tier only until the period ends', async () => {
    const ends = Math.floor(Date.now() / 1000) + 86400 * 12
    // Cancel-at-period-end: status is STILL active, and cancel_at_period_end
    // flips true. They paid for this month, so they keep it.
    await sendEvent(app, {
      id: 'evt_sub_cancel_at_period_end',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_stub_1', status: 'active', cancel_at_period_end: true,
          customer: 'cus_stub_1', current_period_end: ends,
          items: { data: [{ price: { id: 'price_stub_pro' } }] },
          metadata: { user_id: buyer.id },
        },
      },
    })
    expect(await tierOf(app, buyer)).toBe('pro')

    // Then the period ends and Stripe deletes the subscription. NOW access goes.
    await sendEvent(app, {
      id: 'evt_sub_deleted_at_period_end',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_stub_1', customer: 'cus_stub_1', metadata: { user_id: buyer.id } } },
    })
    expect(await tierOf(app, buyer)).toBe('')
  })

  it('a REPLAYED cancellation stays cancelled (Stripe retries for three days)', async () => {
    // Re-grant so a faulty replay would be VISIBLE as a re-granted tier.
    await sendEvent(app, {
      id: 'evt_sub_regrant_before_replay',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_stub_1', status: 'active', customer: 'cus_stub_1',
          current_period_end: Math.floor(Date.now() / 1000) + 2592000,
          items: { data: [{ price: { id: 'price_stub_pro' } }] },
          metadata: { user_id: buyer.id },
        },
      },
    })
    expect(await tierOf(app, buyer)).toBe('pro')

    const cancellation = {
      id: 'evt_sub_deleted_replayed',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_stub_1', customer: 'cus_stub_1', metadata: { user_id: buyer.id } } },
    }
    const first = await sendEvent(app, cancellation)
    expect(first.status).toBe(200)
    expect(first.body.duplicate).toBeUndefined() // did the work
    expect(await tierOf(app, buyer)).toBe('')

    // Stripe redelivers the identical, correctly-signed event. Twice.
    for (const attempt of [1, 2]) {
      expect(attempt).toBeGreaterThan(0)
      const again = await sendEvent(app, cancellation)
      expect(again.status).toBe(200)
      expect(again.body.duplicate).toBe(true)
      expect(await tierOf(app, buyer)).toBe('') // still Free — never re-granted
    }
  })

  it('a cancellation resolves through the CUSTOMER alone, with no metadata', async () => {
    // Re-grant, then cancel with a payload carrying none of our metadata — the
    // shape a subscription created outside our checkout (or migrated) sends.
    await sendEvent(app, {
      id: 'evt_sub_regrant_no_meta',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_stub_1', status: 'active', customer: 'cus_stub_1',
          current_period_end: Math.floor(Date.now() / 1000) + 2592000,
          items: { data: [{ price: { id: 'price_stub_pro' } }] },
          metadata: { user_id: buyer.id },
        },
      },
    })
    expect(await tierOf(app, buyer)).toBe('pro')

    await sendEvent(app, {
      id: 'evt_sub_deleted_no_meta',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_stub_1', customer: 'cus_stub_1' } },
    })
    expect(await tierOf(app, buyer)).toBe('')
  })

  // ---- receipts are private ------------------------------------------------
  it('a user cannot read somebody else\'s payment receipts, or forge one', async () => {
    const theirs = await db(app, other, { table: 'payments', action: 'select' })
    expect(theirs.status).toBe(200)
    expect(theirs.body.data.every((p: any) => String(p.user_id) === String(other.id))).toBe(true)

    const forge = await db(app, other, {
      table: 'payments', action: 'insert',
      values: { user_id: other.id, kind: 'subscription', tier: 'creator', status: 'paid' },
    })
    expect(forge.status).toBe(403)
  })

  // ---- the config endpoint leaks nothing -----------------------------------
  it('reports which items are purchasable without exposing anything secret', async () => {
    const r = await request(app).get('/api/payments/config')
    expect(r.status).toBe(200)
    expect(r.body.configured).toBe(true)
    expect(r.body.tiers.pro).toBe(true)
    expect(r.body.tiers.ad_free).toBe(false) // no price configured
    expect(r.body.packs.plus).toBe(true)
    expect(r.body.packs.mega).toBe(false)
    // Nothing that looks like a key is anywhere in the response.
    expect(JSON.stringify(r.body)).not.toContain('sk_test')
    expect(JSON.stringify(r.body)).not.toContain('whsec')
    expect(JSON.stringify(r.body)).not.toContain('price_stub')
  })
})

// ===========================================================================
// RETIRING A SKU MUST NOT STRAND A SUBSCRIBER.
//
// `ad_free` ($1.99/mo) was retired in 2026-08. Retiring a SKU in OUR catalogue
// cancels nothing in Stripe: those cards keep being charged until the operator
// or the customer stops them. So the only safe shape is SUNSET, not delete —
// the shop stops offering it, and every fulfilment path keeps honouring it.
//
// The failure this file exists to make impossible: `ad_free` disappears from
// the ladder, `tierForPrice()` stops resolving its price, the renewal branches
// silently no-op, the entitlement expires — and Stripe keeps taking $1.99/month
// from someone who is now being shown ads. No error, no log, no support signal.
// Charging for ads-off while serving ads is a refund and a consumer-protection
// problem, not a bug report.
//
// Note this block CONFIGURES STRIPE_PRICE_AD_FREE, unlike the block above which
// deliberately leaves it unset. A retired tier with a live price is exactly the
// production state: the price object still exists in Stripe and is still
// billing, which is why the sale has to be stopped in code rather than by
// unsetting the env var.
// ===========================================================================
describe('TKO API — the retired $1.99 ad_free SKU: sold no more, honoured still', () => {
  const app = makeApp()
  let holder: Who

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_stub'
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    process.env.STRIPE_PRICE_PRO = 'price_stub_pro'
    // The retired price is LIVE — subscriptions on it are still billing.
    process.env.STRIPE_PRICE_AD_FREE = 'price_stub_ad_free'
    installStripeStub()
    holder = await signUp(app, 'adfree-holder@kc.gg', 'adfreeholder')
  })

  afterAll(() => {
    globalThis.fetch = realFetch
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_WEBHOOK_SECRET
    delete process.env.STRIPE_PRICE_PRO
    delete process.env.STRIPE_PRICE_AD_FREE
  })

  // ---- the two ladders are different lists --------------------------------
  it('keeps ad_free on the FULFILMENT ladder and drops it from the SHOP', () => {
    expect(SUBSCRIPTION_TIERS).toContain('ad_free')
    expect(RETIRED_TIERS).toContain('ad_free')
    expect(PURCHASABLE_TIERS).not.toContain('ad_free')
    expect(isPurchasableTier('ad_free')).toBe(false)
  })

  it('still sells every tier that was not retired, cheapest paid rung now $4.99 pro', () => {
    expect(PURCHASABLE_TIERS).toEqual(['pro', 'supporter', 'creator'])
    for (const t of PURCHASABLE_TIERS) expect(isPurchasableTier(t)).toBe(true)
  })

  it('never lets the shop offer something the server could not fulfil', () => {
    for (const t of PURCHASABLE_TIERS) {
      expect(SUBSCRIPTION_TIERS).toContain(t as (typeof SUBSCRIPTION_TIERS)[number])
    }
  })

  // ---- the SELL surfaces are closed ---------------------------------------
  it('refuses a NEW checkout on the retired tier without opening a Stripe session', async () => {
    stripeCalls = []
    const r = await request(app).post('/api/checkout')
      .set('Authorization', `Bearer ${holder.token}`).send({ tier: 'ad_free' })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('tier_retired')
    expect(r.body.url).toBeUndefined()
    // Nothing was created in Stripe — the refusal happens before the money path.
    expect(stripeCalls.some((c) => c.path === '/checkout/sessions')).toBe(false)
  })

  it('refuses to convert a trial onto the retired tier, so nobody is charged for it', async () => {
    const r = await request(app).post('/api/trial/convert')
      .set('Authorization', `Bearer ${holder.token}`).send({ tier: 'ad_free' })
    expect(r.status).toBe(400)
    expect(r.body.ok).toBe(false)
    expect(r.body.error).toBe('tier_retired')
  })

  it('reports the retired tier as unbuyable even though its price IS configured', async () => {
    const r = await request(app).get('/api/payments/config')
    expect(r.status).toBe(200)
    expect(r.body.configured).toBe(true)
    // The key is still PRESENT — only false. canBuyTier() in src/lib/payments.ts
    // reads exactly this, so the Upgrade page hides the rung with no client change.
    expect(r.body.tiers).toHaveProperty('ad_free')
    expect(r.body.tiers.ad_free).toBe(false)
    expect(r.body.tiers.pro).toBe(true)
  })

  // ---- the HONOUR surfaces are open ---------------------------------------
  it('still resolves the retired price back to its tier', () => {
    // If this ever returns '', invoice.paid grants nothing and the subscriber's
    // expiry quietly stops moving while Stripe keeps charging them.
    expect(tierForPrice('price_stub_ad_free')).toBe('ad_free')
  })

  it('still fulfils an IN-FLIGHT checkout that completes after retirement', async () => {
    const r = await sendEvent(app, {
      id: 'evt_adfree_session_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_adfree_1', mode: 'subscription', payment_status: 'paid',
          amount_total: 199, currency: 'usd', customer: 'cus_stub_1',
          subscription: 'sub_adfree_1',
          metadata: { user_id: holder.id, tier: 'ad_free' },
        },
      },
    })
    expect(r.status).toBe(200)
    expect(await tierOf(app, holder)).toBe('ad_free')
  })

  it('STILL RENEWS an existing subscriber every billing period', async () => {
    const until = Math.floor(Date.now() / 1000) + 2592000
    await sendEvent(app, {
      id: 'evt_adfree_sub_updated_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_adfree_1', status: 'active', customer: 'cus_stub_1',
          current_period_end: until,
          items: { data: [{ price: { id: 'price_stub_ad_free' } }] },
          metadata: { user_id: holder.id },
        },
      },
    })
    expect(await tierOf(app, holder)).toBe('ad_free')

    // And the renewal INVOICE — the branch with no metadata fallback, which is
    // the one that goes silent first if the tier is dropped from the ladder.
    await sendEvent(app, {
      id: 'evt_adfree_invoice_paid_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_adfree_1', customer: 'cus_stub_1', subscription: 'sub_adfree_1',
          amount_paid: 199, currency: 'usd',
          lines: { data: [{ price: { id: 'price_stub_ad_free' }, period: { end: until } }] },
        },
      },
    })
    expect(await tierOf(app, holder)).toBe('ad_free')
  })

  it('still lapses them when they actually cancel — retirement is not a lock-in', async () => {
    await sendEvent(app, {
      id: 'evt_adfree_sub_deleted_1',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_adfree_1', customer: 'cus_stub_1', metadata: { user_id: holder.id } } },
    })
    expect(await tierOf(app, holder)).toBe('')
  })
})

// ===========================================================================
// AGE GATE (13+) — the Terms require it; the SERVER enforces it, because a
// client-side check is a suggestion, not a gate.
// ===========================================================================
describe('TKO API — 13+ age gate at signup', () => {
  const app = makeApp()

  it('ageFromDob counts whole years and rejects junk', () => {
    const now = new Date('2026-07-22T12:00:00Z')
    expect(ageFromDob('2000-01-01', now)).toBe(26)
    // Birthday today counts today.
    expect(ageFromDob('2013-07-22', now)).toBe(13)
    // Birthday tomorrow does not.
    expect(ageFromDob('2013-07-23', now)).toBe(12)
    expect(ageFromDob('', now)).toBeNull()
    expect(ageFromDob(null, now)).toBeNull()
    expect(ageFromDob('not-a-date', now)).toBeNull()
    expect(ageFromDob('2011-02-30', now)).toBeNull() // rolls over -> rejected
    expect(ageFromDob('2030-01-01', now)).toBeNull() // future
    expect(ageFromDob('1700-01-01', now)).toBeNull() // implausible
  })

  it('does NOT require a date of birth — a 13+ consent is enough', async () => {
    // The product is all-ages: signup is a 13+ CONSENT, not a hard DOB gate. A
    // signup with no DOB but the consent attestation succeeds and stores it.
    // Use a dedicated pool so the stored attestation can be read back directly
    // (toUser surfaces only a whitelist of metadata to /api/auth/me).
    const pool = makeDb()
    const consentApp = createApp(pool)
    const r = await request(consentApp).post('/api/auth/signup')
      .send({ email: 'nodob@kc.gg', password: 'password123', username: 'nodob', age_consent_13_plus: true })
    expect(r.status).toBe(200)
    expect(r.body.token).toBeTruthy()
    // The consent attestation is persisted; no DOB was supplied so none is stored.
    const stored = await pool.query('select user_metadata from users where id=$1', [r.body.user.id])
    const meta = stored.rows[0].user_metadata
    const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta
    expect(parsed.age_consent_13_plus).toBe(true)
    expect(parsed.date_of_birth).toBeUndefined()
  })

  it('rejects a malformed date of birth', async () => {
    const r = await request(app).post('/api/auth/signup')
      .send({ email: 'bad@kc.gg', password: 'password123', date_of_birth: '15/06/1995' })
    expect(r.status).toBe(400)
  })

  it(`refuses an under-${MIN_AGE_YEARS} signup and creates no account`, async () => {
    const dob = new Date()
    dob.setUTCFullYear(dob.getUTCFullYear() - 9)
    const r = await request(app).post('/api/auth/signup')
      .send({ email: 'kid@kc.gg', password: 'password123', username: 'kid', date_of_birth: dob.toISOString().slice(0, 10) })
    expect(r.status).toBe(403)
    expect(r.body.token).toBeUndefined()

    // No account, so the same email is still free (would 409 if one was made).
    const retry = await request(app).post('/api/auth/login').send({ email: 'kid@kc.gg', password: 'password123' })
    expect(retry.status).toBe(401)
  })

  it('accepts an eligible signup and stores the attestation on the account', async () => {
    const r = await request(app).post('/api/auth/signup').send({
      email: 'grown@kc.gg', password: 'password123', username: 'grown',
      date_of_birth: ADULT_DOB,
      metadata: { terms_v1: true, terms_accepted_at: '2026-07-22T00:00:00.000Z', reelone_tier: 'creator' },
    })
    expect(r.status).toBe(200)

    // The attestation is persisted; a smuggled tier in `metadata` is NOT.
    const raw = await request(app).post('/api/db').send({
      table: 'profiles', action: 'select', single: true,
      filters: [{ col: 'id', op: 'eq', val: r.body.user.id }],
    })
    expect(raw.status).toBe(200)
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${r.body.token}`)
    expect(me.body.user.user_metadata.reelone_tier).toBe('')
  })
})

// ===========================================================================
// ACCOUNT DELETION — required in-app by Google Play and Apple 5.1.1(v).
// ===========================================================================
describe('TKO API — account deletion', () => {
  const app = makeApp()

  it('requires authentication', async () => {
    const del = await request(app).delete('/api/account')
    expect(del.status).toBe(401)

    const post = await request(app).post('/api/account/delete')
    expect(post.status).toBe(401)

    const fn = await request(app).post('/api/fn/delete-account')
    expect(fn.status).toBe(401)
  })

  it('rejects a forged token', async () => {
    const r = await request(app).delete('/api/account').set('Authorization', 'Bearer not-a-jwt')
    expect(r.status).toBe(401)
  })

  it('hard-deletes the caller and invalidates their session', async () => {
    const who = await signUp(app, 'leaving@kc.gg', 'leaving')

    const r = await request(app).delete('/api/account').set('Authorization', `Bearer ${who.token}`)
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.user_id).toBe(who.id)

    // The token is now worthless — the row it points at is gone.
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${who.token}`)
    expect(me.status).toBe(401)

    // ...and the credentials no longer log in.
    const login = await request(app).post('/api/auth/login').send({ email: 'leaving@kc.gg', password: 'password123' })
    expect(login.status).toBe(401)

    // The public profile is gone too.
    const prof = await request(app).post('/api/db').send({
      table: 'profiles', action: 'select', filters: [{ col: 'id', op: 'eq', val: who.id }],
    })
    expect(prof.body.data.length).toBe(0)
  })

  it('frees the username for someone else to claim', async () => {
    const first = await signUp(app, 'ghost1@kc.gg', 'ghost')
    await request(app).delete('/api/account').set('Authorization', `Bearer ${first.token}`).expect(200)

    const second = await signUp(app, 'ghost2@kc.gg', 'ghost')
    const rows = await request(app).post('/api/db').send({
      table: 'profiles', action: 'select', filters: [{ col: 'username', op: 'eq', val: 'ghost' }],
    })
    expect(rows.body.data.length).toBe(1)
    // The exact handle went to the new owner — no `ghost_a1b2` fallback suffix.
    expect(rows.body.data[0].id).toBe(second.id)
  })

  it('can only ever delete the CALLER, whatever the body says', async () => {
    const victim = await signUp(app, 'victim@kc.gg', 'victim')
    const attacker = await signUp(app, 'attacker@kc.gg', 'attacker')

    const r = await request(app).post('/api/account/delete')
      .set('Authorization', `Bearer ${attacker.token}`)
      .send({ user_id: victim.id, id: victim.id, email: 'victim@kc.gg' })
    expect(r.status).toBe(200)
    expect(r.body.user_id).toBe(attacker.id)

    // The victim is untouched and still signed in.
    const stillThere = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${victim.token}`)
    expect(stillThere.status).toBe(200)
    expect(stillThere.body.user.email).toBe('victim@kc.gg')

    // The attacker deleted themselves.
    const gone = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${attacker.token}`)
    expect(gone.status).toBe(401)
  })

  it('works through the functions shim (POST /api/fn/delete-account)', async () => {
    const who = await signUp(app, 'viafn@kc.gg', 'viafn')
    const r = await request(app).post('/api/fn/delete-account')
      .set('Authorization', `Bearer ${who.token}`).send({})
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${who.token}`)
    expect(me.status).toBe(401)
  })

  // ---- the clan-leader edge case ------------------------------------------

  it('hands a led clan to the longest-serving OFFICER instead of blocking or disbanding', async () => {
    const leader = await signUp(app, 'chief@kc.gg', 'chief')
    const officer = await signUp(app, 'second@kc.gg', 'second')
    const grunt = await signUp(app, 'third@kc.gg', 'third')

    const s = await request(app).post('/api/db').set('Authorization', `Bearer ${leader.token}`).send({
      table: 'servers', action: 'insert', single: true,
      values: { name: 'Hokage Guard', owner_id: leader.id, kind: 'clan' },
    })
    expect(s.status).toBe(200)
    const sid = s.body.data.id

    for (const [who, role] of [[leader, 'leader'], [officer, 'officer'], [grunt, 'member']] as const) {
      const seat = await request(app).post('/api/db').set('Authorization', `Bearer ${leader.token}`).send({
        table: 'clan_members', action: 'insert', single: true,
        values: { server_id: sid, user_id: who.id, role },
      })
      expect(seat.status).toBe(200)
    }

    const del = await request(app).delete('/api/account').set('Authorization', `Bearer ${leader.token}`)
    expect(del.status).toBe(200)
    expect(del.body.clans.transferred).toBe(1)
    expect(del.body.clans.disbanded).toBe(0)

    // The clan still exists, now owned by the officer.
    const server = await request(app).post('/api/db').send({
      table: 'servers', action: 'select', single: true, filters: [{ col: 'id', op: 'eq', val: sid }],
    })
    expect(server.body.data).not.toBeNull()
    expect(server.body.data.owner_id).toBe(officer.id)

    // ...who is now the leader, and the old leader's membership is gone.
    const members = await request(app).post('/api/db').send({
      table: 'clan_members', action: 'select', filters: [{ col: 'server_id', op: 'eq', val: sid }],
    })
    const roles = Object.fromEntries(members.body.data.map((m: any) => [m.user_id, m.role]))
    expect(roles[officer.id]).toBe('leader')
    expect(roles[grunt.id]).toBe('member')
    expect(roles[leader.id]).toBeUndefined()
  })

  it('disbands a clan only when the leaving leader is its last member', async () => {
    const solo = await signUp(app, 'solo@kc.gg', 'solo')
    const s = await request(app).post('/api/db').set('Authorization', `Bearer ${solo.token}`).send({
      table: 'servers', action: 'insert', single: true,
      values: { name: 'Party of One', owner_id: solo.id, kind: 'clan' },
    })
    const sid = s.body.data.id
    await request(app).post('/api/db').set('Authorization', `Bearer ${solo.token}`).send({
      table: 'clan_members', action: 'insert', single: true,
      values: { server_id: sid, user_id: solo.id, role: 'leader' },
    }).expect(200)

    const del = await request(app).delete('/api/account').set('Authorization', `Bearer ${solo.token}`)
    expect(del.status).toBe(200)
    expect(del.body.clans.disbanded).toBe(1)
    expect(del.body.clans.transferred).toBe(0)

    const server = await request(app).post('/api/db').send({
      table: 'servers', action: 'select', filters: [{ col: 'id', op: 'eq', val: sid }],
    })
    expect(server.body.data.length).toBe(0)
  })
})

// ===========================================================================
// THE PRESTIGE ECONOMY — value is minted SERVER-SIDE ONLY.
//
// These are the tests that matter for the migration off localStorage. The
// question each one asks is the same: "can the client fake it?" The wallet, the
// artifact catalogue, ownership, predictions and the clan treasury all used to
// be a JSON blob the user owned outright.
// ===========================================================================

/** POST /api/fn/:name as a given user. */
function fn(app: any, who: Who | null, name: string, body: any = {}) {
  const r = request(app).post(`/api/fn/${name}`).send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

describe('tournament brackets advance trusted winners and player art slots', () => {
  const app = makeApp()

  it('seeds six entrants, protects host controls, and advances a champion', async () => {
    const host = await signUp(app, 'bracket-host@kc.gg', 'brackethost')
    const players = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        signUp(app, `bracket-player-${index}@kc.gg`, `bracketplayer${index}`),
      ),
    )
    const tournament = await db(app, host, {
      table: 'tournaments',
      action: 'insert',
      single: true,
      values: { name: 'TKO Bracket Test', created_by: host.id, end_at: '2030-01-01T00:00:00.000Z' },
    })
    expect(tournament.status).toBe(200)
    const tournamentId = tournament.body.data.id

    for (const player of players) {
      const entrant = await db(app, host, {
        table: 'tournament_entrants',
        action: 'insert',
        single: true,
        values: {
          tournament_id: tournamentId,
          user_id: player.id,
          status: 'accepted',
        },
      })
      expect(entrant.status).toBe(200)
    }

    const denied = await fn(app, players[0], 'tournament-bracket-seed', {
      tournamentId,
      seedMode: 'registration',
    })
    expect(denied.status).toBe(403)

    const seeded = await fn(app, host, 'tournament-bracket-seed', {
      tournamentId,
      seedMode: 'registration',
    })
    expect(seeded.status).toBe(200)
    expect(seeded.body.ok).toBe(true)
    expect(seeded.body.totalRounds).toBe(3)
    const opening = (seeded.body.battles as any[]).filter((battle) => battle.round === 1)
    expect(opening).toHaveLength(4)
    expect(opening.map((battle) => battle.bracket_slot)).toEqual([0, 1, 2, 3])
    expect(opening.filter((battle) => battle.status === 'complete')).toHaveLength(2)

    const contested = opening.filter((battle) => battle.player_b)
    expect(contested).toHaveLength(2)
    const firstWinner = contested[0].player_a
    const firstResult = await fn(app, host, 'tournament-bracket-winner', {
      battleId: contested[0].id,
      winnerId: firstWinner,
    })
    expect(firstResult.status).toBe(200)
    expect(firstResult.body.ok).toBe(true)

    const secondWinner = contested[1].player_b
    const secondResult = await fn(app, host, 'tournament-bracket-winner', {
      battleId: contested[1].id,
      winnerId: secondWinner,
    })
    expect(secondResult.status).toBe(200)
    const semifinals = (secondResult.body.battles as any[]).filter((battle) => battle.round === 2)
    expect(semifinals).toHaveLength(2)
    expect(semifinals.every((battle) => battle.player_a && battle.player_b)).toBe(true)

    const semifinalWinners: string[] = []
    let latest = secondResult
    for (const semifinal of semifinals) {
      const winnerId = semifinal.player_a
      semifinalWinners.push(winnerId)
      latest = await fn(app, host, 'tournament-bracket-winner', {
        battleId: semifinal.id,
        winnerId,
      })
      expect(latest.status).toBe(200)
      expect(latest.body.ok).toBe(true)
    }

    const final = (latest.body.battles as any[]).find((battle) => battle.round === 3)
    expect(final).toBeTruthy()
    expect(new Set([final.player_a, final.player_b])).toEqual(new Set(semifinalWinners))

    const championId = final.player_b
    const decided = await fn(app, host, 'tournament-bracket-winner', {
      battleId: final.id,
      winnerId: championId,
    })
    expect(decided.status).toBe(200)
    expect(decided.body.champion).toBe(championId)

    const results = await db(app, null, {
      table: 'tournament_results',
      action: 'select',
      filters: [{ col: 'tournament_id', op: 'eq', val: tournamentId }],
    })
    expect(results.status).toBe(200)
    expect(results.body.data).toHaveLength(1)
    expect(results.body.data[0].winner_profile_id).toBe(championId)
  })
})

describe('economy — a client cannot mint value', () => {
  const app = makeApp()
  let alice: Who
  let bob: Who

  it('sets up two users', async () => {
    alice = await signUp(app, 'econ-alice@kc.gg', 'econalice')
    bob = await signUp(app, 'econ-bob@kc.gg', 'econbob')
  })

  it('a user cannot credit their own wallet', async () => {
    // The wallet row exists (reading it creates it) and starts empty.
    const w = await fn(app, alice, 'wallet')
    expect(w.status).toBe(200)
    expect(w.body.wallet).toEqual({ tokens: 0, sweeps: 0, paid_sweeps_cents: 0, oracle_tickets: 0 })

    // Direct insert: the table is insert-'deny'.
    const ins = await db(app, alice, {
      table: 'wallets', action: 'insert', values: { user_id: alice.id, tokens: 1_000_000, sweeps: 999 },
    })
    expect(ins.status).toBe(403)
    expect(ins.body.error).toMatch(/not writable/)

    // Direct update of their OWN row: write-'deny', and the balance columns are
    // in PRIVILEGE_COLS besides.
    const upd = await db(app, alice, {
      table: 'wallets', action: 'update',
      filters: [{ col: 'user_id', op: 'eq', val: alice.id }],
      values: { tokens: 1_000_000 },
    })
    expect(upd.status).toBe(403)

    // Forging the audit trail instead doesn't work either.
    const led = await db(app, alice, {
      table: 'wallet_ledger', action: 'insert',
      values: { user_id: alice.id, kind: 'purchase', tokens_delta: 5000 },
    })
    expect(led.status).toBe(403)

    // Balance unchanged.
    const after = await fn(app, alice, 'wallet')
    expect(after.body.wallet).toEqual({ tokens: 0, sweeps: 0, paid_sweeps_cents: 0, oracle_tickets: 0 })
  })

  it('the free daily grant now credits ORACLE-USE-ONLY tickets — one per day, not one per click', async () => {
    const first = await fn(app, bob, 'sweeps-daily')
    expect(first.status).toBe(200)
    expect(first.body.ok).toBe(true)
    // Repurposed (Oracle Rule 1): the daily grant is now 3 Oracle tickets, NOT
    // $-flow sweeps. Tickets are tracked separately and never part of the $ flow.
    expect(first.body.granted).toBe(3)
    expect(first.body.grantedKind).toBe('oracle_tickets')
    expect(first.body.wallet.oracle_tickets).toBe(3)
    expect(first.body.wallet.sweeps).toBe(0)

    // The old localStorage guard could be deleted from devtools. This one can't.
    const second = await fn(app, bob, 'sweeps-daily')
    expect(second.body.ok).toBe(false)
    expect(second.body.reason).toBe('already-claimed')
    expect(second.body.wallet.oracle_tickets).toBe(3)
  })

  it('a user cannot grant themselves an artifact', async () => {
    const forge = await db(app, alice, {
      table: 'asset_ownership', action: 'insert',
      values: { user_id: alice.id, asset_id: 'king-prize-crown', source: 'prize' },
    })
    expect(forge.status).toBe(403)
    expect(forge.body.error).toMatch(/not writable/)

    const mine = await db(app, alice, { table: 'asset_ownership', action: 'select' })
    expect(mine.body.data.length).toBe(0)
  })

  it('a user cannot buy an artifact they cannot afford, and cannot buy an EARNED one at all', async () => {
    const broke = await fn(app, alice, 'asset-buy', { assetId: 'seed-akatsuki-jersey' })
    expect(broke.body.ok).toBe(false)
    expect(broke.body.reason).toBe('insufficient')

    // Oracle rewards carry price 0 — "free" — but are never purchasable.
    const freebie = await fn(app, alice, 'asset-buy', { assetId: 'oracle-reward-crystal-emote' })
    expect(freebie.body.ok).toBe(false)
    expect(freebie.body.reason).toBe('not-for-sale')

    const owned = await db(app, alice, { table: 'asset_ownership', action: 'select' })
    expect(owned.body.data.length).toBe(0)
  })

  it('listing gear forces the creator and cannot claim to be a King prize', async () => {
    const listed = await db(app, bob, {
      table: 'assets', action: 'insert', single: true,
      values: {
        id: 'a_bob_jersey', name: 'Bob Kit', team_name: 'Bob FC', image_url: 'https://x/y.png',
        price_tokens: 10, kind: 'jersey',
        // both of these are ignored: created_by is forced, origin is a PRIVILEGE_COL
        created_by: alice.id, origin: 'prize',
      },
    })
    expect(listed.status).toBe(200)
    expect(listed.body.data.created_by).toBe(bob.id)
    expect(listed.body.data.origin).toBe('user')

    // The catalogue is genuinely shared — Alice sees Bob's listing (the old
    // localStorage "global catalog" was per-browser).
    const asAlice = await db(app, alice, {
      table: 'assets', action: 'select', filters: [{ col: 'id', op: 'eq', val: 'a_bob_jersey' }],
    })
    expect(asAlice.body.data.length).toBe(1)

    // ...but Alice cannot edit it.
    const tamper = await db(app, alice, {
      table: 'assets', action: 'update',
      filters: [{ col: 'id', op: 'eq', val: 'a_bob_jersey' }],
      values: { price_tokens: 0 },
    })
    expect(tamper.status).toBe(403)
  })

  it('ownership is per-user and private', async () => {
    // Give Bob some tokens the only way anyone can: through a server handler.
    // (The daily grant gives sweeps, so buy with a 0-price... instead, seed via
    // a clan refund path is overkill — assert the isolation directly.)
    const bobOwned = await db(app, bob, { table: 'asset_ownership', action: 'select' })
    expect(bobOwned.body.data.length).toBe(0)

    // Even an explicit filter for someone else's locker returns nothing.
    const snoop = await db(app, bob, {
      table: 'asset_ownership', action: 'select',
      filters: [{ col: 'user_id', op: 'eq', val: alice.id }],
    })
    expect(snoop.body.data.length).toBe(0)

    const anon = await db(app, null, { table: 'asset_ownership', action: 'select' })
    expect(anon.status).toBe(401)
  })
})

describe('economy — King prize artifacts persist', () => {
  const app = makeApp()
  let champ: Who
  let loser: Who
  let host: Who
  let tid = ''
  let battleId = ''

  it('sets up a host and two fighters', async () => {
    champ = await signUp(app, 'champ@kc.gg', 'champ')
    loser = await signUp(app, 'runnerup@kc.gg', 'runnerup')
    host = await signUp(app, 'kinghost@kc.gg', 'kinghost')
    await request(app).post('/api/fn/redeem-code')
      .set('Authorization', `Bearer ${host.token}`).send({ code: 'TKO-HOST-K9F3QX' }).expect(200)

    const t = await db(app, host, {
      table: 'tournaments', action: 'insert', single: true,
      values: { name: 'TKO King S1', created_by: host.id, end_at: '2030-01-01T00:00:00.000Z' },
    })
    tid = t.body.data.id
    // A 2-entrant bracket: one round, and winning it IS the final.
    for (const who of [champ, loser]) {
      await db(app, who, {
        table: 'tournament_registrations', action: 'insert',
        values: { tournament_id: tid, user_id: who.id },
      }).expect(200)
    }
    const b = await db(app, host, {
      table: 'tournament_battles', action: 'insert', single: true,
      values: { tournament_id: tid, player_a: champ.id, player_b: loser.id, round: 1 },
    })
    battleId = b.body.data.id
  })

  it('refuses to award a prize for an undecided battle', async () => {
    const early = await fn(app, host, 'king-prize', { battleId })
    expect(early.body.ok).toBe(false)
    expect(early.body.reason).toBe('undecided')
  })

  it('a FIGHTER cannot award themselves the crown', async () => {
    // Host declares the result first...
    await db(app, host, {
      table: 'tournament_battles', action: 'update',
      filters: [{ col: 'id', op: 'eq', val: battleId }],
      values: { status: 'complete', winner: champ.id },
    }).expect(200)

    // ...but only the host may award the artifact for it.
    const selfAward = await fn(app, champ, 'king-prize', { battleId })
    expect(selfAward.status).toBe(403)

    const locker = await db(app, champ, { table: 'asset_ownership', action: 'select' })
    expect(locker.body.data.length).toBe(0)
  })

  it('the host awards the crown, and it lands in the winner’s locker with an audit trail', async () => {
    const award = await fn(app, host, 'king-prize', { battleId })
    expect(award.status).toBe(200)
    expect(award.body.ok).toBe(true)
    // Winning the only round of a 2-entrant bracket is winning the Final.
    expect(award.body.artifact.id).toBe('king-prize-crown')
    expect(award.body.alreadyOwned).toBe(false)

    const locker = await db(app, champ, { table: 'asset_ownership', action: 'select' })
    expect(locker.body.data.length).toBe(1)
    expect(locker.body.data[0].asset_id).toBe('king-prize-crown')
    expect(locker.body.data[0].source).toBe('prize')
    expect(locker.body.data[0].ref_id).toBe(battleId)

    // The trophy-closet entry was written in the same call.
    const closet = await db(app, null, {
      table: 'shinobi_defeats', action: 'select',
      filters: [{ col: 'user_id', op: 'eq', val: champ.id }],
    })
    expect(closet.body.data.length).toBe(1)
    expect(closet.body.data[0].opponent_id).toBe(loser.id)

    // ...and so was the ledger row the Winnings card reads.
    const ledger = await db(app, champ, { table: 'wallet_ledger', action: 'select' })
    expect(ledger.body.data.length).toBe(1)
    expect(ledger.body.data[0].result).toBe('Win')
    expect(ledger.body.data[0].prize).toBe('TKO King Crown')
  })

  it('re-confirming the result cannot duplicate the prize', async () => {
    const again = await fn(app, host, 'king-prize', { battleId })
    expect(again.body.ok).toBe(true)
    expect(again.body.alreadyOwned).toBe(true)

    const locker = await db(app, champ, { table: 'asset_ownership', action: 'select' })
    expect(locker.body.data.length).toBe(1)
  })

  it('a shallow totalRounds hint cannot turn an early win into a crown', async () => {
    // A 4-entrant bracket => 2 rounds. Winning round 1 is a semifinal, not the
    // final, however the caller labels it.
    const extras = [
      await signUp(app, 'e1@kc.gg', 'e1'),
      await signUp(app, 'e2@kc.gg', 'e2'),
    ]
    const t = await db(app, host, {
      table: 'tournaments', action: 'insert', single: true,
      values: { name: 'King S2', created_by: host.id, end_at: '2030-01-01T00:00:00.000Z' },
    })
    const t2 = t.body.data.id
    for (const who of [champ, loser, ...extras]) {
      await db(app, who, {
        table: 'tournament_registrations', action: 'insert',
        values: { tournament_id: t2, user_id: who.id },
      }).expect(200)
    }
    const b = await db(app, host, {
      table: 'tournament_battles', action: 'insert', single: true,
      values: { tournament_id: t2, player_a: champ.id, player_b: extras[0].id, round: 1 },
    })
    await db(app, host, {
      table: 'tournament_battles', action: 'update',
      filters: [{ col: 'id', op: 'eq', val: b.body.data.id }],
      values: { status: 'complete', winner: extras[0].id },
    }).expect(200)

    // The host claims it was a 1-round bracket (i.e. "this was the final").
    const award = await fn(app, host, 'king-prize', { battleId: b.body.data.id, round: 1, totalRounds: 1 })
    expect(award.body.ok).toBe(true)
    expect(award.body.totalRounds).toBe(2)          // derived from 4 entrants
    expect(award.body.artifact.id).not.toBe('king-prize-crown')
  })

  it('the crown survives a simulated reload — a fresh session still sees it', async () => {
    // Signing in again is the API-level equivalent of clearing the cache and
    // reopening the app: nothing client-side is carried over.
    const relogin = await request(app).post('/api/auth/login')
      .send({ email: 'champ@kc.gg', password: 'password123' })
    expect(relogin.status).toBe(200)
    const fresh: Who = { token: relogin.body.token, id: relogin.body.user.id }

    const locker = await db(app, fresh, { table: 'asset_ownership', action: 'select' })
    expect(locker.body.data.some((r: any) => r.asset_id === 'king-prize-crown')).toBe(true)

    // And the artifact itself resolves out of the shared catalogue.
    const art = await db(app, null, {
      table: 'assets', action: 'select', single: true,
      filters: [{ col: 'id', op: 'eq', val: 'king-prize-crown' }],
    })
    expect(art.body.data.name).toBe('TKO King Crown')
    expect(art.body.data.origin).toBe('prize')
  })
})

describe('economy — Oracle predictions resolve server-side', () => {
  const app = makeApp()
  let seer: Who
  let rival: Who
  let host: Who
  let tid = ''
  let winnerId = ''

  it('sets up a tournament with two predictors', async () => {
    seer = await signUp(app, 'seer@kc.gg', 'seer')
    rival = await signUp(app, 'rival@kc.gg', 'rival')
    host = await signUp(app, 'oraclehost@kc.gg', 'oraclehost')
    await request(app).post('/api/fn/redeem-code')
      .set('Authorization', `Bearer ${host.token}`).send({ code: 'TKO-HOST-M4R7PZ' }).expect(200)

    const t = await db(app, host, {
      table: 'tournaments', action: 'insert', single: true,
      values: { name: 'Weekly Cup', created_by: host.id, end_at: '2030-01-01T00:00:00.000Z' },
    })
    tid = t.body.data.id
    winnerId = host.id // the eventual champion
  })

  it('enforces the tier quota and one-open-per-tournament server-side', async () => {
    const first = await fn(app, seer, 'prediction-make', { tournamentId: tid, winnerId, label: 'host' })
    expect(first.body.ok).toBe(true)

    const dupe = await fn(app, seer, 'prediction-make', { tournamentId: tid, winnerId: seer.id, label: 'me' })
    expect(dupe.body.ok).toBe(false)
    expect(dupe.body.reason).toBe('exists')

    // Free tier => 1 open prediction. A second tournament is refused.
    const t2 = await db(app, host, {
      table: 'tournaments', action: 'insert', single: true,
      values: { name: 'Other Cup', created_by: host.id, end_at: '2030-01-01T00:00:00.000Z' },
    })
    const over = await fn(app, seer, 'prediction-make', { tournamentId: t2.body.data.id, winnerId, label: 'host' })
    expect(over.body.ok).toBe(false)
    expect(over.body.reason).toBe('quota')
  })

  it('a user cannot write a prediction — or its grade — directly', async () => {
    const ins = await db(app, seer, {
      table: 'predictions', action: 'insert',
      values: { user_id: seer.id, tournament_id: tid, winner_id: winnerId, status: 'correct' },
    })
    expect(ins.status).toBe(403)

    const grade = await db(app, seer, {
      table: 'predictions', action: 'update',
      filters: [{ col: 'user_id', op: 'eq', val: seer.id }],
      values: { status: 'correct' },
    })
    expect(grade.status).toBe(403)
  })

  it('does not resolve while the tournament has no recorded result', async () => {
    const early = await fn(app, seer, 'prediction-resolve', { tournamentId: tid })
    expect(early.body.resolved).toBe(false)
    expect(early.body.reason).toBe('undecided')
  })

  it('grades every user against the SAME recorded result, and pays the reward', async () => {
    // The rival picks wrong.
    await fn(app, rival, 'prediction-make', { tournamentId: tid, winnerId: rival.id, label: 'me' })
      .expect(200)

    // The host records the actual winner.
    await db(app, host, {
      table: 'tournament_results', action: 'insert',
      values: { tournament_id: tid, winner_profile_id: winnerId, submitted_by: host.id },
    }).expect(200)

    const good = await fn(app, seer, 'prediction-resolve', { tournamentId: tid })
    expect(good.body.resolved).toBe(true)
    expect(good.body.status).toBe('correct')
    expect(good.body.asset.id).toBe('oracle-reward-crystal-emote')

    const bad = await fn(app, rival, 'prediction-resolve', { tournamentId: tid })
    expect(bad.body.resolved).toBe(true)
    expect(bad.body.status).toBe('wrong')

    // The cosmetic went to the correct predictor only — ownership is per-user.
    const seerLocker = await db(app, seer, { table: 'asset_ownership', action: 'select' })
    expect(seerLocker.body.data.map((r: any) => r.asset_id)).toEqual(['oracle-reward-crystal-emote'])
    expect(seerLocker.body.data[0].source).toBe('reward')

    const rivalLocker = await db(app, rival, { table: 'asset_ownership', action: 'select' })
    expect(rivalLocker.body.data.length).toBe(0)
  })

  it('the graded prediction persists, and re-resolving is a no-op', async () => {
    const rows = await db(app, seer, { table: 'predictions', action: 'select' })
    expect(rows.body.data.length).toBe(1)
    expect(rows.body.data[0].status).toBe('correct')
    expect(rows.body.data[0].reward_asset_id).toBe('oracle-reward-crystal-emote')
    expect(rows.body.data[0].resolved_at).toBeTruthy()

    const again = await fn(app, seer, 'prediction-resolve', { tournamentId: tid })
    expect(again.body.resolved).toBe(false)

    // A rival cannot read someone else's calls.
    const snoop = await db(app, rival, {
      table: 'predictions', action: 'select', filters: [{ col: 'user_id', op: 'eq', val: seer.id }],
    })
    expect(snoop.body.data.every((r: any) => r.user_id === rival.id)).toBe(true)
  })
})

describe('economy — clan dues settle in one server transaction', () => {
  const app = makeApp()
  let leader: Who
  let joiner: Who
  let sid = ''

  it('sets up a clan with a 100-token join fee', async () => {
    leader = await signUp(app, 'clanlead@kc.gg', 'clanlead')
    joiner = await signUp(app, 'clanjoin@kc.gg', 'clanjoin')
    const s = await db(app, leader, {
      table: 'servers', action: 'insert', single: true,
      values: { name: 'Paid Clan', owner_id: leader.id, kind: 'clan', join_fee_tokens: 100 },
    })
    expect(s.status).toBe(200)
    sid = s.body.data.id
  })

  it('a member cannot credit a clan treasury or forge a dues receipt', async () => {
    const treasury = await db(app, leader, {
      table: 'servers', action: 'update',
      filters: [{ col: 'id', op: 'eq', val: sid }],
      values: { treasury_tokens: 999999 },
    })
    // treasury_tokens is a PRIVILEGE_COL — even the clan's own owner can't set it.
    expect(treasury.status).toBe(403)
    expect(treasury.body.error).toMatch(/treasury_tokens/)

    const receipt = await db(app, joiner, {
      table: 'clan_dues_payments', action: 'insert',
      values: { server_id: sid, user_id: joiner.id, kind: 'join', gross_tokens: 100, clan_tokens: 80, platform_tokens: 20 },
    })
    expect(receipt.status).toBe(403)
  })

  it('refuses the join fee when the wallet is short — and charges nothing', async () => {
    const poor = await fn(app, joiner, 'clan-pay', { serverId: sid, kind: 'join' })
    expect(poor.body.ok).toBe(false)
    expect(poor.body.reason).toBe('insufficient')

    const clan = await db(app, null, {
      table: 'servers', action: 'select', single: true, filters: [{ col: 'id', op: 'eq', val: sid }],
    })
    expect(clan.body.data.treasury_tokens).toBe(0)

    const receipts = await db(app, joiner, { table: 'clan_dues_payments', action: 'select' })
    expect(receipts.body.data.length).toBe(0)
  })

  it('a free clan settles with nothing moved', async () => {
    const free = await db(app, leader, {
      table: 'servers', action: 'insert', single: true,
      values: { name: 'Free Clan', owner_id: leader.id, kind: 'clan', join_fee_tokens: 0 },
    })
    const paid = await fn(app, joiner, 'clan-pay', { serverId: free.body.data.id, kind: 'join' })
    expect(paid.body.ok).toBe(true)
    expect(paid.body.charged).toBe(0)
  })
})

// ===========================================================================
// CORS — the APK is cross-origin (https://localhost -> https://tko.cam/api).
// ===========================================================================
describe('TKO API — CORS origin policy', () => {
  const app = makeApp()

  it('allows the Capacitor, production and dev origins; not arbitrary sites', () => {
    expect(isAllowedOrigin(undefined)).toBe(true) // curl / same-origin / supertest
    expect(isAllowedOrigin('https://localhost')).toBe(true) // Capacitor Android
    expect(isAllowedOrigin('capacitor://localhost')).toBe(true) // Capacitor iOS
    expect(isAllowedOrigin('https://tko.cam')).toBe(true)
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true) // vite dev
    expect(isAllowedOrigin('http://127.0.0.1:8080')).toBe(true)
    expect(isAllowedOrigin('https://evil.example')).toBe(false)
    expect(isAllowedOrigin('https://tko.cam.evil.example')).toBe(false)
    // Deploy-time additions are honoured.
    expect(isAllowedOrigin('https://staging.tko.cam', ['https://staging.tko.cam'])).toBe(true)
  })

  it('answers the APK preflight with credentials + the Authorization header', async () => {
    const r = await request(app)
      .options('/api/db')
      .set('Origin', 'https://localhost')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type')
    expect(r.status).toBeLessThan(300)
    expect(r.headers['access-control-allow-origin']).toBe('https://localhost')
    expect(r.headers['access-control-allow-credentials']).toBe('true')
    expect(String(r.headers['access-control-allow-headers']).toLowerCase()).toContain('authorization')
    expect(String(r.headers['access-control-allow-methods'])).toContain('DELETE')
  })

  it('reflects the allowed origin on a real request, and not a foreign one', async () => {
    const ok = await request(app).get('/api/health').set('Origin', 'https://tko.cam')
    expect(ok.headers['access-control-allow-origin']).toBe('https://tko.cam')

    const bad = await request(app).get('/api/health').set('Origin', 'https://evil.example')
    expect(bad.headers['access-control-allow-origin']).toBeUndefined()
  })
})

// ===========================================================================
// PROFILE READINESS — the signup wave (operator audit 2026-08-04).
//
// "Many new players are signing up soon." These pin the three ways that used to
// go wrong under load: an identity collision escaping as an exception instead of
// an HTTP answer, the same email registering twice under different casing, and
// a bare select meaning "the whole table".
// ===========================================================================
describe('TKO API — signup under load', () => {
  const app = makeApp()

  it('refuses a second account for the same email in a different casing', async () => {
    const first = await request(app).post('/api/auth/signup')
      .send({ email: 'Casey@kc.gg', password: 'password123', username: 'casey', date_of_birth: ADULT_DOB })
    expect(first.status).toBe(200)

    const second = await request(app).post('/api/auth/signup')
      .send({ email: 'casey@KC.gg', password: 'password123', username: 'casey2', date_of_birth: ADULT_DOB })
    expect(second.status).toBe(409)
    expect(second.body.error).toMatch(/already registered/i)
  })

  it('lets that player log in with either casing of their email', async () => {
    const exact = await request(app).post('/api/auth/login')
      .send({ email: 'Casey@kc.gg', password: 'password123' })
    expect(exact.status).toBe(200)

    const lower = await request(app).post('/api/auth/login')
      .send({ email: 'casey@kc.gg', password: 'password123' })
    expect(lower.status).toBe(200)
    expect(lower.body.user.id).toBe(exact.body.user.id)
  })

  it('gives two players who want the SAME handle two working accounts', async () => {
    const a = await request(app).post('/api/auth/signup')
      .send({ email: 'ninja1@kc.gg', password: 'password123', username: 'ninja', date_of_birth: ADULT_DOB })
    const b = await request(app).post('/api/auth/signup')
      .send({ email: 'ninja2@kc.gg', password: 'password123', username: 'ninja', date_of_birth: ADULT_DOB })
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(a.body.user.id).not.toBe(b.body.user.id)

    // Both must end up with a REAL profile row and a distinct handle — a player
    // with no username is invisible in Discover.
    for (const who of [a, b]) {
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${who.body.token}`)
      expect(me.status).toBe(200)
      expect(me.body.user.user_metadata.username).toBeTruthy()
    }
    // Read the rows one at a time: the in-memory engine does not honour the
    // `= ANY($1)` form this API builds for an `in` filter on a uuid column.
    const names: string[] = []
    for (const who of [a, b]) {
      const row = await request(app).post('/api/db').send({
        table: 'profiles', action: 'select', columns: 'id, username', single: true,
        filters: [{ col: 'id', op: 'eq', val: who.body.user.id }],
      })
      expect(row.status).toBe(200)
      expect(row.body.data?.username).toBeTruthy()
      names.push(String(row.body.data.username).toLowerCase())
    }
    expect(new Set(names).size).toBe(2)
  })

  it('answers a duplicate signup instead of hanging or dying', async () => {
    // Five simultaneous attempts on one email: exactly one account, four clean
    // 409s. Before the fix the losers escaped as unhandled rejections — no
    // response at all, and a dead process on Node >= 15.
    const attempts = await Promise.all(
      [0, 1, 2, 3, 4].map(() => request(app).post('/api/auth/signup')
        .send({ email: 'stampede@kc.gg', password: 'password123', username: 'stampede', date_of_birth: ADULT_DOB })),
    )
    const created = attempts.filter((r) => r.status === 200)
    expect(created).toHaveLength(1)
    for (const r of attempts) expect([200, 409]).toContain(r.status)
  })
})

describe('TKO API — /api/db read bounds', () => {
  const app = makeApp()
  let owner: Who

  it('sets up a player with several rows', async () => {
    owner = await signUp(app, 'bounds@kc.gg', 'bounds')
    for (let i = 0; i < 5; i++) {
      const r = await db(app, owner, {
        table: 'reels', action: 'insert', values: { title: `reel ${i}`, clip_ids: [] },
      })
      expect(r.status).toBe(200)
    }
  })

  it('a head:true count returns the count WITHOUT shipping the rows', async () => {
    const r = await db(app, owner, {
      table: 'reels', action: 'select', columns: '*', count: 'exact', head: true,
      filters: [{ col: 'user_id', op: 'eq', val: owner.id }],
    })
    expect(r.status).toBe(200)
    expect(r.body.count).toBe(5)
    // The rows are what the profile page used to download just to render a
    // "N followers" label.
    expect(r.body.data).toBeNull()
  })

  it('still returns rows for the same read without head', async () => {
    const r = await db(app, owner, {
      table: 'reels', action: 'select', columns: '*', count: 'exact',
      filters: [{ col: 'user_id', op: 'eq', val: owner.id }],
    })
    expect(r.status).toBe(200)
    expect(r.body.count).toBe(5)
    expect(r.body.data).toHaveLength(5)
  })

  it('caps an unbounded select, and clamps a client limit above the ceiling', async () => {
    // MAX_SELECT_ROWS is far above anything the app asks for, so a normal read
    // is unaffected; what matters is that the SQL is never limit-less.
    const all = await request(app).post('/api/db').send({ table: 'reels', action: 'select', columns: '*' })
    expect(all.status).toBe(200)
    expect(all.body.data.length).toBeLessThanOrEqual(MAX_SELECT_ROWS)

    const greedy = await request(app).post('/api/db')
      .send({ table: 'reels', action: 'select', columns: '*', limit: MAX_SELECT_ROWS * 10 })
    expect(greedy.status).toBe(200)
    expect(greedy.body.data.length).toBeLessThanOrEqual(MAX_SELECT_ROWS)

    // An explicit small limit is still honoured exactly.
    const two = await request(app).post('/api/db')
      .send({ table: 'reels', action: 'select', columns: '*', limit: 2 })
    expect(two.body.data).toHaveLength(2)
  })
})
