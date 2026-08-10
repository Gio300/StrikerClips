// 2026-08-02 operator migration — the boot statements that associate the
// existing player base with the SHINOBI STRIKER LEAGUE. Run here against the
// same pg-mem schema the API suite uses, so the exact SQL production executes
// in server/index.ts bootstrapTables() is what is proven idempotent.
import { describe, it, expect, beforeEach } from 'vitest'
import { makeDb } from './testHarness'
import {
  SSL_LEAGUE_SLUG,
  SSL_FOUNDING_USERNAMES,
  sslMemberMigration2026_08_02,
} from './sslMemberMigration'

const OPERATOR_EMAIL = 'operator@example.com'

async function seedLeague(pool: any): Promise<string> {
  const r = await pool.query(
    `insert into leagues (slug, name, domain, video_ownership, tier)
     values ($1, 'SHINOBI STRIKER LEAGUE', 'shinobistrikerleague.com', 'league', 'pro')
     returning id`,
    [SSL_LEAGUE_SLUG],
  )
  return r.rows[0].id
}

async function seedUser(pool: any, username: string, email?: string): Promise<string> {
  const u = await pool.query(
    `insert into users (email, user_metadata) values ($1, $2) returning id`,
    [email ?? `${username.toLowerCase()}@example.com`, JSON.stringify({ username })],
  )
  const id = u.rows[0].id
  await pool.query(`insert into profiles (id, username) values ($1, $2)`, [id, username])
  return id
}

async function runMigration(pool: any, operatorEmail?: string | null) {
  // Mirror the production loop: every statement independently, in order.
  for (const stmt of sslMemberMigration2026_08_02(operatorEmail)) {
    await pool.query(stmt)
  }
}

const members = async (pool: any) =>
  (await pool.query('select user_id, role from league_members order by role, user_id')).rows

describe('2026-08-02 operator migration — SSL league membership', () => {
  let pool: any
  let leagueId: string

  beforeEach(async () => {
    pool = makeDb()
    leagueId = await seedLeague(pool)
  })

  it('adds the named existing players as members, by case-insensitive username', async () => {
    const hammy = await seedUser(pool, 'Hammy')
    const kissa = await seedUser(pool, 'kissatronix')
    const pattern = await seedUser(pool, 'PatternAfterError')
    const jerry = await seedUser(pool, 'MrJerry')
    await seedUser(pool, 'Valeriesolos') // unrelated — must NOT be enrolled

    await runMigration(pool)

    const rows = await members(pool)
    expect(rows).toHaveLength(4)
    expect(rows.map((r: any) => r.user_id).sort()).toEqual([hammy, kissa, pattern, jerry].sort())
    expect(rows.every((r: any) => r.role === 'member')).toBe(true)
  })

  it('tolerates named players that have not registered yet (GlizzardOfOz)', async () => {
    // Only two of the five names exist — the join simply matches nothing for
    // the rest; nothing throws, nothing is invented.
    await seedUser(pool, 'Hammy')
    await seedUser(pool, 'MrJerry')
    await runMigration(pool)
    expect(await members(pool)).toHaveLength(2)
    expect(SSL_FOUNDING_USERNAMES).toContain('glizzardofoz')
  })

  it('is idempotent — a second boot inserts nothing new', async () => {
    await seedUser(pool, 'Hammy')
    const operator = await seedUser(pool, 'ssl_op', OPERATOR_EMAIL)
    await runMigration(pool, OPERATOR_EMAIL)
    const first = await members(pool)
    expect(first).toHaveLength(2)

    await runMigration(pool, OPERATOR_EMAIL)

    const second = await members(pool)
    expect(second).toEqual(first)
    const owner = second.find((r: any) => r.user_id === operator)
    expect(owner?.role).toBe('owner')
  })

  it('enrolls the operator as owner by account email and claims leagues.owner_id', async () => {
    const operator = await seedUser(pool, 'ssl_op', OPERATOR_EMAIL)
    await runMigration(pool, ` ${OPERATOR_EMAIL.toUpperCase()} `) // env var whitespace/case survives

    const rows = await members(pool)
    expect(rows).toEqual([{ user_id: operator, role: 'owner' }])
    const league = await pool.query('select owner_id from leagues where id=$1', [leagueId])
    expect(league.rows[0].owner_id).toBe(operator)
  })

  it('never demotes the operator when their username is also on the named list', async () => {
    const operator = await seedUser(pool, 'MrJerry', OPERATOR_EMAIL)
    await runMigration(pool, OPERATOR_EMAIL)

    const rows = await members(pool)
    expect(rows).toEqual([{ user_id: operator, role: 'owner' }])
  })

  it('never overwrites an existing league owner', async () => {
    const existingOwner = await seedUser(pool, 'founder')
    await pool.query('update leagues set owner_id=$1 where id=$2', [existingOwner, leagueId])
    await seedUser(pool, 'ssl_op', OPERATOR_EMAIL)

    await runMigration(pool, OPERATOR_EMAIL)

    const league = await pool.query('select owner_id from leagues where id=$1', [leagueId])
    expect(league.rows[0].owner_id).toBe(existingOwner)
  })

  it('without SSL_OPERATOR_EMAIL (or with a malformed value) only the username statements run', async () => {
    await seedUser(pool, 'Hammy')
    await runMigration(pool, undefined)
    await runMigration(pool, "bad'value; drop table league_members; --")
    const rows = await members(pool)
    expect(rows).toHaveLength(1)
    expect(rows[0].role).toBe('member')
    // The malformed value produced NO operator statements at all — only the
    // per-username member inserts remain.
    expect(sslMemberMigration2026_08_02("x' or 1=1 --")).toHaveLength(SSL_FOUNDING_USERNAMES.length)
  })

  it('skips the operator statements cleanly when no account has that email', async () => {
    await seedUser(pool, 'kissatronix')
    await runMigration(pool, 'nobody-here@example.com')
    const rows = await members(pool)
    expect(rows).toHaveLength(1)
    const league = await pool.query('select owner_id from leagues where id=$1', [leagueId])
    expect(league.rows[0].owner_id).toBeNull()
  })
})
