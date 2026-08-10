/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * THE ROSTER CARRIES THE CLAN — rung 1 of the naming ladder.
 *
 * OPERATOR 2026-08-07: "coach dee says ai clan every time.. there are different
 * clans.. if you don't have their clans name.. just use their name.. be sure to
 * get their clan name from their profile on the app unless you can see their
 * clan tag.. but for now.. only say the name of a clan if it's on the actual
 * app."
 *
 * The renderer used to hold `CLAN = "AI CLAN"` as a module constant and speak it
 * for every squad in the league — 202 times in the log, and not one other clan
 * name, because there was no other value it could take. It now refuses to say
 * any clan it cannot source, which makes THIS endpoint the source.
 *
 * A clan is a `servers` row with kind='clan' — there is no `clans` table — and a
 * player reaches it through clan_members.server_id. `role` is the "position"
 * the same instruction asks for.
 *
 * The property that matters most is the NEGATIVE one: a player in no clan must
 * come back with no clan field at all, so the factory has nothing to default.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { makeDb } from './testHarness'
import { createApp } from './app'

const SERVICE_KEY = 'test-service-key'

async function member(pool: any, opts: { username: string; tier?: string }) {
  const meta: any = { username: opts.username, reelone_tier: opts.tier ?? 'creator' }
  const u = await pool.query(
    'insert into users (email, user_metadata) values ($1,$2) returning id',
    [`${opts.username}@kc.gg`, JSON.stringify(meta)],
  )
  const id = u.rows[0].id
  await pool.query('insert into profiles (id, username) values ($1,$2)', [id, opts.username])
  await pool.query('insert into user_youtube_links (user_id, url) values ($1,$2)',
    [id, `https://www.youtube.com/@${opts.username}`])
  return id
}

async function clan(pool: any, name: string, tag: string | null) {
  const r = await pool.query(
    `insert into servers (name, kind, clan_tag) values ($1,'clan',$2) returning id`,
    [name, tag],
  )
  return r.rows[0].id
}

async function join(pool: any, serverId: string, userId: string, role: string, joinedAt?: string) {
  await pool.query(
    `insert into clan_members (server_id, user_id, role${joinedAt ? ', joined_at' : ''})
     values ($1,$2,$3${joinedAt ? ',$4' : ''})`,
    joinedAt ? [serverId, userId, role, joinedAt] : [serverId, userId, role],
  )
}

async function roster(app: any) {
  const r = await request(app)
    .post('/api/internal/auto-merge-channels')
    .set('x-tko-service', SERVICE_KEY)
    .send({})
  expect(r.status).toBe(200)
  const by: Record<string, any> = {}
  for (const c of r.body.channels) by[c.username] = c
  return by
}

describe('roster clan fields', () => {
  let app: any
  let pool: any
  beforeEach(() => {
    process.env.TKO_SERVICE_KEY = SERVICE_KEY
    pool = makeDb()
    app = createApp(pool)
  })

  it('carries the clan NAME, tag and position from the app', async () => {
    const uid = await member(pool, { username: 'dreamfire' })
    const cid = await clan(pool, 'Doho', 'Doho')
    await join(pool, cid, uid, 'officer')

    const by = await roster(app)
    expect(by.dreamfire).toMatchObject({
      clan: 'Doho', clan_tag: 'Doho', clan_role: 'officer',
    })
  })

  it('OMITS the clan entirely for a player in no clan', async () => {
    // The load-bearing one. An absent key is what makes the renderer say
    // nothing; an empty string arriving as a real field is the sort of thing
    // that grows a `|| "AI CLAN"` a month later.
    await member(pool, { username: 'loner' })
    const by = await roster(app)
    expect(by.loner).toBeTruthy()
    expect('clan' in by.loner).toBe(false)
    expect('clan_tag' in by.loner).toBe(false)
    expect('clan_role' in by.loner).toBe(false)
  })

  it('never sends the old constant for anybody', async () => {
    await member(pool, { username: 'loner' })
    const withClan = await member(pool, { username: 'increw' })
    const cid = await clan(pool, 'Doho', 'Doho')
    await join(pool, cid, withClan, 'member')
    const r = await request(app)
      .post('/api/internal/auto-merge-channels')
      .set('x-tko-service', SERVICE_KEY)
      .send({})
    expect(JSON.stringify(r.body).toLowerCase()).not.toContain('ai clan')
  })

  it('omits the tag when the clan has none, but keeps the name', async () => {
    const uid = await member(pool, { username: 'notag' })
    const cid = await clan(pool, 'No Tag Crew', null)
    await join(pool, cid, uid, 'leader')
    const by = await roster(app)
    expect(by.notag.clan).toBe('No Tag Crew')
    expect('clan_tag' in by.notag).toBe(false)
    expect(by.notag.clan_role).toBe('leader')
  })

  it('picks the OLDEST membership so the answer is stable across passes', async () => {
    // A player in two clans must not flip clan between renders.
    const uid = await member(pool, { username: 'twoclans' })
    const first = await clan(pool, 'FirstCrew', 'FC')
    const second = await clan(pool, 'SecondCrew', 'SC')
    await join(pool, first, uid, 'member', '2020-01-01T00:00:00Z')
    await join(pool, second, uid, 'leader', '2026-01-01T00:00:00Z')
    const by = await roster(app)
    expect(by.twoclans.clan).toBe('FirstCrew')
  })

  it('a clan with no name is not a clan', async () => {
    const uid = await member(pool, { username: 'blankclan' })
    const cid = await clan(pool, '   ', 'XX')
    await join(pool, cid, uid, 'member')
    const by = await roster(app)
    expect('clan' in by.blankclan).toBe(false)
  })

  it('still returns the roster when the clan tables are unusable', async () => {
    // Fail-soft, exactly like the league join beside it: no clan is a correct
    // answer, a 500 is not. Losing the roster would stop ALL video production.
    const uid = await member(pool, { username: 'survivor' })
    const cid = await clan(pool, 'Doho', 'Doho')
    await join(pool, cid, uid, 'member')
    const original = pool.query.bind(pool)
    pool.query = async (text: string, params?: any[]) => {
      if (/clan_members/i.test(text)) throw new Error('relation "clan_members" does not exist')
      return original(text, params)
    }
    const by = await roster(app)
    expect(by.survivor).toBeTruthy()
    expect('clan' in by.survivor).toBe(false)
  })

  it('is still refused without the service key', async () => {
    const r = await request(app).post('/api/internal/auto-merge-channels').send({})
    expect(r.status).toBe(401)
  })
})
