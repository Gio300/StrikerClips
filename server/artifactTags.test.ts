/* eslint-disable @typescript-eslint/no-explicit-any */
// ARTIFACT TAGS — a clan tag a user equips and shows off everywhere. Clan
// leaders list (and charge for) their clan's tag; members buy + equip it.
// Built on makeDb + createApp directly so the test can seed a wallet (the only
// value a client can't mint itself) and read rows back through the real API.
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { makeDb } from './testHarness'
import { createApp } from './app'

const ADULT_DOB = '1995-06-15'

async function signUp(app: any, email: string, username: string) {
  const r = await request(app).post('/api/auth/signup').send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token as string, id: r.body.user.id as string }
}
const fn = (app: any, token: string, name: string, body: any) =>
  request(app).post(`/api/fn/${name}`).set('Authorization', `Bearer ${token}`).send(body)
const db = (app: any, token: string | null, body: any) => {
  const r = request(app).post('/api/db').send(body)
  return token ? r.set('Authorization', `Bearer ${token}`) : r
}

describe('artifact tags', () => {
  let app: any
  let pool: any
  let leader: { token: string; id: string }
  let member: { token: string; id: string }
  let serverId: string

  beforeEach(async () => {
    pool = makeDb()
    app = createApp(pool)
    leader = await signUp(app, 'leader@kc.gg', 'leader')
    member = await signUp(app, 'member@kc.gg', 'member')
    // The leader creates a clan (owner_id forced to them → they are its manager).
    const s = await db(app, leader.token, {
      table: 'servers', action: 'insert', single: true,
      values: { name: 'Akatsuki', owner_id: leader.id, kind: 'clan' },
    })
    serverId = s.body.data.id
  })

  it('leader creates → member buys (wallet debited) → equip appears on profile', async () => {
    const create = await fn(app, leader.token, 'artifact-tag-create', {
      clanId: serverId, tagText: 'Akatsuki', price: 100, rarity: 'legendary',
    })
    expect(create.status).toBe(200)
    expect(create.body.ok).toBe(true)
    const tagId = create.body.tag.id
    expect(create.body.tag.price).toBe(100)

    // Fund the buyer with EXACTLY the price (the one value a client can't mint
    // itself). Funding the exact price lets us assert a clean debit to zero — the
    // convention the existing money tests use (server/moneyChaos.test.ts) so the
    // assertion doesn't depend on pg-mem's parameterized-subtraction quirk; the
    // trusted spendTokens path is correct on real Postgres.
    await pool.query('insert into wallets (user_id, tokens, sweeps) values ($1, 100, 0)', [member.id])

    const buy = await fn(app, member.token, 'artifact-tag-buy', { tagId })
    expect(buy.body.ok).toBe(true)
    expect(buy.body.wallet.tokens).toBe(0) // 100 - 100 debited server-side

    // The debit booked an append-only spend ledger row of -100.
    const led = await pool.query(
      `select coalesce(sum(tokens_delta),0)::int s from wallet_ledger where user_id=$1 and kind='spend'`, [member.id])
    expect(led.rows[0].s).toBe(-100)

    // The clan treasury received the price (leaders charge for their tag).
    const treasury = await pool.query('select treasury_tokens from servers where id=$1', [serverId])
    expect(Number(treasury.rows[0].treasury_tokens)).toBe(100)

    // Buying equipped it; the equipped tag is exposed on the profile payload.
    const prof = await db(app, null, {
      table: 'profiles', action: 'select', single: true,
      filters: [{ col: 'id', op: 'eq', val: member.id }],
    })
    expect(prof.body.data.equipped_tag_text).toBe('Akatsuki')
    expect(prof.body.data.equipped_tag_rarity).toBe('legendary')
    expect(prof.body.data.equipped_tag_id).toBe(tagId)
  })

  it('a profiles select that EXPLICITLY lists the synthetic tag columns succeeds (Wall/feed crash)', async () => {
    // The Wall + News Feed (and chat/rankings/DMs) request the equipped tag
    // fields by name: .select('id, username, avatar_url, power_level,
    // equipped_tag_text, equipped_tag_rarity'). Those are NOT real columns on
    // profiles — they're re-added by the decoration. Before the fix the column
    // list reached Postgres and the read crashed ("column ... does not exist").
    const create = await fn(app, leader.token, 'artifact-tag-create', { clanId: serverId, tagText: 'Akatsuki', price: 0 })
    const tagId = create.body.tag.id
    await fn(app, member.token, 'artifact-tag-buy', { tagId }) // free buy grants + equips

    const feedCols = 'id, username, avatar_url, power_level, equipped_tag_text, equipped_tag_rarity'

    // Single row (a profile card): must succeed and carry the decorated tag.
    const one = await db(app, null, {
      table: 'profiles', action: 'select', single: true, columns: feedCols,
      filters: [{ col: 'id', op: 'eq', val: member.id }],
    })
    expect(one.status).toBe(200)
    expect(one.body.error).toBeNull()
    expect(one.body.data.equipped_tag_text).toBe('Akatsuki')
    expect(one.body.data.equipped_tag_rarity).toBe('common')

    // Array (a feed of many profiles): must also succeed; the leader has no
    // equipped tag, so the synthetic field is present and null (not a crash).
    const many = await db(app, null, {
      table: 'profiles', action: 'select', columns: feedCols,
    })
    expect(many.status).toBe(200)
    expect(many.body.error).toBeNull()
    const leaderRow = many.body.data.find((r: any) => r.id === leader.id)
    expect(leaderRow).toBeTruthy()
    expect(leaderRow).toHaveProperty('equipped_tag_text')
    expect(leaderRow.equipped_tag_text).toBeNull()
    const memberRow = many.body.data.find((r: any) => r.id === member.id)
    expect(memberRow.equipped_tag_text).toBe('Akatsuki')
  })

  it('a non-leader cannot create (and therefore cannot charge) a tag', async () => {
    const r = await fn(app, member.token, 'artifact-tag-create', { clanId: serverId, tagText: 'Sneaky', price: 999 })
    expect(r.status).toBe(403)
    const rows = await pool.query('select count(*)::int n from artifact_tags')
    expect(rows.rows[0].n).toBe(0)
  })

  it('refuses the buy when the balance is insufficient', async () => {
    const create = await fn(app, leader.token, 'artifact-tag-create', { clanId: serverId, tagText: 'Pricey', price: 500 })
    const tagId = create.body.tag.id
    // member has no wallet / 0 tokens
    const buy = await fn(app, member.token, 'artifact-tag-buy', { tagId })
    expect(buy.body.ok).toBe(false)
    expect(buy.body.reason).toBe('insufficient')
    // Not owned, not equipped.
    const owned = await pool.query('select count(*)::int n from user_artifact_tags where user_id=$1', [member.id])
    expect(owned.rows[0].n).toBe(0)
    const eq = await pool.query('select count(*)::int n from user_equipped_tag where user_id=$1', [member.id])
    expect(eq.rows[0].n).toBe(0)
  })

  it('equip requires ownership; unequip clears it', async () => {
    const create = await fn(app, leader.token, 'artifact-tag-create', { clanId: serverId, tagText: 'Free', price: 0 })
    const tagId = create.body.tag.id

    // Cannot equip a tag you don't own.
    const bad = await fn(app, member.token, 'artifact-tag-equip', { tagId })
    expect(bad.body.ok).toBe(false)
    expect(bad.body.reason).toBe('not-owned')

    // A free buy grants + equips it.
    const buy = await fn(app, member.token, 'artifact-tag-buy', { tagId })
    expect(buy.body.ok).toBe(true)
    // Now equip works (idempotent), and unequip clears it.
    expect((await fn(app, member.token, 'artifact-tag-equip', { tagId })).body.ok).toBe(true)
    expect((await fn(app, member.token, 'artifact-tag-unequip', {})).body.ok).toBe(true)
    const eq = await pool.query('select count(*)::int n from user_equipped_tag where user_id=$1', [member.id])
    expect(eq.rows[0].n).toBe(0)
  })
})
