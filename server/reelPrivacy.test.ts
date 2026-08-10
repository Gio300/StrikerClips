import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { canUsePlayerReels } from './reelPrivacy'
import { makeDb } from './testHarness'

type Account = { id: string; token: string }
const authorized = (token: string) => ({ Authorization: `Bearer ${token}` })

async function signUp(app: any, name: string): Promise<Account> {
  const response = await request(app).post('/api/auth/signup').send({
    email: `${name}@privacy.test`,
    username: name,
    password: 'safe-test-password',
    age_consent_13_plus: true,
  })
  expect(response.status).toBe(200)
  return { id: response.body.user.id, token: response.body.token }
}

describe('reel usage privacy', () => {
  let pool: any
  let app: any
  let owner: Account
  let actor: Account
  let bridge: Account

  beforeEach(async () => {
    pool = makeDb()
    app = createApp(pool)
    owner = await signUp(app, 'privacy_owner')
    actor = await signUp(app, 'privacy_actor')
    bridge = await signUp(app, 'privacy_bridge')
  })

  it('defaults to followers of followers and saves only an allowlisted choice', async () => {
    const initial = await request(app).get('/api/privacy/reels').set(authorized(owner.token))
    expect(initial.status).toBe(200)
    expect(initial.body.value).toBe('followers_of_followers')

    const invalid = await request(app)
      .post('/api/privacy/reels')
      .set(authorized(owner.token))
      .send({ value: 'everybody_and_their_bot' })
    expect(invalid.status).toBe(400)

    const saved = await request(app)
      .post('/api/privacy/reels')
      .set(authorized(owner.token))
      .send({ value: 'tournaments' })
    expect(saved.status).toBe(200)
    expect(saved.body.value).toBe('tournaments')
    expect(await canUsePlayerReels(pool, {
      ownerUserId: owner.id,
      actorUserId: actor.id,
      context: 'tournament',
    })).toBe(true)
    expect(await canUsePlayerReels(pool, {
      ownerUserId: owner.id,
      actorUserId: actor.id,
      context: 'general',
    })).toBe(false)
  })

  it('includes direct followers and the second-degree follower circle', async () => {
    expect(await canUsePlayerReels(pool, {
      ownerUserId: owner.id,
      actorUserId: actor.id,
      context: 'general',
    })).toBe(false)
    await pool.query('insert into follows (follower_id,following_id) values ($1,$2),($2,$3)', [
      actor.id,
      bridge.id,
      owner.id,
    ])
    expect(await canUsePlayerReels(pool, {
      ownerUserId: owner.id,
      actorUserId: actor.id,
      context: 'general',
    })).toBe(true)
  })

  it('enforces the choice when another player adds someone to a multi-angle reel', async () => {
    const created = await request(app)
      .post('/api/db')
      .set(authorized(actor.token))
      .send({ table: 'reels', action: 'insert', single: true, values: { title: 'Privacy test reel' } })
    expect(created.status).toBe(200)
    const reelId = created.body.data.id

    const refused = await request(app)
      .post('/api/db')
      .set(authorized(actor.token))
      .send({
        table: 'reel_participants',
        action: 'insert',
        single: true,
        values: { reel_id: reelId, user_id: owner.id },
      })
    expect(refused.status).toBe(403)

    await pool.query('insert into follows (follower_id,following_id) values ($1,$2),($2,$3)', [
      actor.id,
      bridge.id,
      owner.id,
    ])
    const allowed = await request(app)
      .post('/api/db')
      .set(authorized(actor.token))
      .send({
        table: 'reel_participants',
        action: 'insert',
        single: true,
        values: { reel_id: reelId, user_id: owner.id },
      })
    expect(allowed.status).toBe(200)
  })

  it('supports clan-member and clan-officer audiences', async () => {
    const clan = (await pool.query(
      `insert into servers (name,owner_id,kind) values ('Privacy Clan',$1,'clan') returning id`,
      [bridge.id],
    )).rows[0]
    await pool.query(
      `insert into clan_members (server_id,user_id,role)
       values ($1,$2,'member'),($1,$3,'officer')`,
      [clan.id, owner.id, actor.id],
    )

    await pool.query("update profiles set reel_usage_privacy='clan_members' where id=$1", [owner.id])
    expect(await canUsePlayerReels(pool, {
      ownerUserId: owner.id,
      actorUserId: actor.id,
      context: 'general',
    })).toBe(true)

    await pool.query("update profiles set reel_usage_privacy='clan_officers' where id=$1", [owner.id])
    expect(await canUsePlayerReels(pool, {
      ownerUserId: owner.id,
      actorUserId: actor.id,
      context: 'general',
    })).toBe(true)
  })
})
