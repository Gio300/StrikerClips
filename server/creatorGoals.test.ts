/* eslint-disable @typescript-eslint/no-explicit-any */
// CREATOR GOALS — the paid Creator/Streamer Dashboard.
//
//  1. A PAID streaming-tier user can set a goal, and it is PUBLIC-READABLE
//     through /api/db (viewers + the live banner render it).
//  2. A FREE user is REFUSED goal-set (403 — paid required); the client gate is
//     bypassable, this server gate is not.
//  3. goal-set is an UPSERT: setting the same kind again leaves exactly ONE
//     active goal of that kind for the caller.
//  4. A creator can remove their own goal.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

const ADULT_DOB = '1995-06-15'
type Who = { token: string; id: string }

async function signUp(app: any, name: string): Promise<Who> {
  const r = await request(app).post('/api/auth/signup').send({
    email: `${name}@creator-goals.test`,
    password: 'password123',
    username: name,
    date_of_birth: ADULT_DOB,
  })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}

function fn(app: any, who: Who | null, name: string, body: any) {
  const r = request(app).post(`/api/fn/${name}`).send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

function db(app: any, who: Who | null, body: any) {
  const r = request(app).post('/api/db').send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

async function setTier(pool: any, userId: string, tier: string) {
  const current = await pool.query('select user_metadata from users where id=$1', [userId])
  const meta = current.rows[0]?.user_metadata || {}
  meta.reelone_tier = tier
  meta.reelone_tier_expires = null
  await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), userId])
}

describe('creator goals — paid gate, public read, one-active-per-kind', () => {
  const pool = makeDb()
  const app = createApp(pool)
  let paid: Who
  let free: Who

  beforeAll(async () => {
    paid = await signUp(app, 'goal_paid')
    free = await signUp(app, 'goal_free')
    await setTier(pool, paid.id, 'pro')
  })
  afterAll(async () => { await pool.end() })

  it('a paid user can set a goal and it is public-readable', async () => {
    const r = await fn(app, paid, 'goal-set', { kind: 'followers', label: 'Road to 5,800', target: 5800 })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.goal.kind).toBe('followers')
    expect(r.body.goal.target).toBe(5800)
    expect(r.body.goal.active).toBe(true)
    // id is forced from the JWT — never trusted from the client.
    expect(r.body.goal.user_id).toBe(paid.id)

    // Public read (no auth) — viewers + the live banner use this.
    const read = await db(app, null, {
      table: 'creator_goals',
      action: 'select',
      filters: [{ col: 'user_id', op: 'eq', val: paid.id }, { col: 'active', op: 'is', val: true }],
    })
    expect(read.status).toBe(200)
    expect(read.body.data.length).toBe(1)
    expect(read.body.data[0].label).toBe('Road to 5,800')
  })

  it('a FREE user is refused goal-set (paid required)', async () => {
    const r = await fn(app, free, 'goal-set', { kind: 'followers', label: 'nope', target: 100 })
    expect(r.status).toBe(403)
    expect(r.body.ok).toBe(false)
    // Nothing was written for the free user.
    const read = await db(app, null, {
      table: 'creator_goals',
      action: 'select',
      filters: [{ col: 'user_id', op: 'eq', val: free.id }],
    })
    expect(read.body.data.length).toBe(0)
  })

  it('goal-set upserts one active goal per kind', async () => {
    // Re-set the same kind with a new target.
    const r = await fn(app, paid, 'goal-set', { kind: 'followers', label: 'Road to 6,000', target: 6000 })
    expect(r.body.ok).toBe(true)

    const active = await db(app, null, {
      table: 'creator_goals',
      action: 'select',
      filters: [{ col: 'user_id', op: 'eq', val: paid.id }, { col: 'kind', op: 'eq', val: 'followers' }, { col: 'active', op: 'is', val: true }],
    })
    expect(active.body.data.length).toBe(1)
    expect(active.body.data[0].target).toBe(6000)

    // A second, different kind coexists (one active PER KIND, not one total).
    await fn(app, paid, 'goal-set', { kind: 'donations', label: 'Tip goal', target: 50 })
    const allActive = await db(app, null, {
      table: 'creator_goals',
      action: 'select',
      filters: [{ col: 'user_id', op: 'eq', val: paid.id }, { col: 'active', op: 'is', val: true }],
    })
    expect(allActive.body.data.length).toBe(2)
  })

  it('rejects an invalid kind and a non-positive target', async () => {
    const bad1 = await fn(app, paid, 'goal-set', { kind: 'bogus', label: 'x', target: 10 })
    expect(bad1.status).toBe(400)
    const bad2 = await fn(app, paid, 'goal-set', { kind: 'followers', label: 'x', target: 0 })
    expect(bad2.status).toBe(400)
  })

  it('a creator can remove their own goal', async () => {
    const set = await fn(app, paid, 'goal-set', { kind: 'custom', label: 'Temp', target: 5 })
    const id = set.body.goal.id
    const rm = await fn(app, paid, 'goal-remove', { id })
    expect(rm.body.ok).toBe(true)
    expect(rm.body.removed).toBe(1)

    const read = await db(app, null, {
      table: 'creator_goals',
      action: 'select',
      filters: [{ col: 'id', op: 'eq', val: id }],
    })
    expect(read.body.data.length).toBe(0)
  })
})
