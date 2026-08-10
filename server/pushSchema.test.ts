/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PUSH_SCHEMA_STATEMENTS, applyPushSchema } from './pushSchema'
import { makeDb } from './testHarness'

/**
 * THE PUSH MIGRATION, UNDER TEST — same treatment as the chat foundation, for
 * the same reasons. Nothing in this file is about notifications; it is about the
 * DDL being the sort of thing that can run on every boot forever without ever
 * being the reason a boot went wrong.
 */

const CREATES_TABLE = (sql: string) => /^create table\b/i.test(sql)

/**
 * True when `text` contains any C0 control character or DEL.
 *
 * Deliberately a character-code scan rather than a regex literal: writing the
 * escape sequence for a control character into a source file is how a stray BEL
 * got smuggled into this repo's DDL in the first place. Nothing in this file
 * needs to CONTAIN one in order to test for one.
 */
function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 32 || code === 127) return true
  }
  return false
}

describe('push schema statements — idempotent by construction', () => {
  it('is a non-empty list of uniquely named statements', () => {
    expect(PUSH_SCHEMA_STATEMENTS.length).toBeGreaterThan(0)
    const names = PUSH_SCHEMA_STATEMENTS.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name.trim()).toBe(name)
  })

  it('every statement is safe to run on a database that already has it', () => {
    // This DDL runs on EVERY boot. Anything that is not a no-op the second time
    // is a statement that will start failing the moment it succeeds once.
    const idempotent = [
      /^create table if not exists /i,
      /^create (unique )?index if not exists /i,
      /^alter table [\w.]+ add column if not exists /i,
    ]
    for (const statement of PUSH_SCHEMA_STATEMENTS) {
      const ok = idempotent.some((shape) => shape.test(statement.sql))
      expect(ok, `${statement.name} is not idempotent by construction: ${statement.sql}`).toBe(true)
    }
  })

  it('carries NO control characters and NO backticks', () => {
    // Both have bitten this repo: a stray BEL sat undetected in a DDL string for
    // months, and a backtick silently ends a template literal.
    for (const statement of PUSH_SCHEMA_STATEMENTS) {
      expect(
        hasControlCharacter(statement.sql),
        `${statement.name} carries a control character`,
      ).toBe(false)
      expect(statement.sql, `${statement.name} carries a backtick`).not.toContain('`')
      expect(statement.sql).toBe(statement.sql.trim())
    }
  })

  it('is ONE statement per entry', () => {
    // A semicolon would put two statements back into one query, and therefore
    // into one implicit transaction — the exact defect this shape removes.
    for (const statement of PUSH_SCHEMA_STATEMENTS) {
      expect(statement.sql, `${statement.name} contains a semicolon`).not.toContain(';')
    }
  })
})

describe('push schema statements — actually executed', () => {
  it('EXECUTES every statement, index included, against a real engine', async () => {
    const pool: any = makeDb()
    for (const statement of PUSH_SCHEMA_STATEMENTS) {
      // `create table if not exists` is skipped for the same reason as in the
      // chat suite: pg-mem cannot parse the no-op path. makeDb runs it for real
      // on a fresh database, which is the assertion that it works at all.
      if (CREATES_TABLE(statement.sql)) continue
      await expect(pool.query(statement.sql)).resolves.toBeTruthy()
    }
  })

  it('makes the ENDPOINT unique — one browser install is one row', async () => {
    const pool: any = makeDb()
    const user = await seedProfile(pool, 'push_schema_probe')
    const insert = () =>
      pool.query(
        `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
         values ($1, 'https://push.example/x', 'k', 's')`,
        [user],
      )
    await insert()
    // Without this constraint the same phone accumulates a row per subscribe
    // call, and every message fans out to it several times over.
    await expect(insert()).rejects.toThrow()
  })

  it('defaults created_at and last_seen_at so a row is never undatable', async () => {
    const pool: any = makeDb()
    const user = await seedProfile(pool, 'push_schema_dates')
    const row = await pool.query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
       values ($1, 'https://push.example/dates', 'k', 's')
       returning created_at, last_seen_at, user_agent`,
      [user],
    )
    expect(row.rows[0].created_at).toBeTruthy()
    expect(row.rows[0].last_seen_at).toBeTruthy()
    expect(row.rows[0].user_agent).toBeNull()
  })
})

describe('applyPushSchema — one failure costs exactly itself', () => {
  let errors: string[]

  beforeEach(() => {
    errors = []
    vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      errors.push(args.map(String).join(' '))
    })
  })
  afterEach(() => vi.restoreAllMocks())

  /** A pool that refuses exactly the statements whose sql matches. */
  function poolRefusing(match: RegExp) {
    const seen: string[] = []
    const pool = {
      query: async (sql: string) => {
        seen.push(sql)
        if (match.test(sql)) throw new Error('permission denied')
        return { rows: [] }
      },
    }
    return { pool: pool as any, seen }
  }

  it('keeps going after a refused statement and names it', async () => {
    const { pool, seen } = poolRefusing(/create index/i)
    const result = await applyPushSchema(pool)
    expect(result.failed).toEqual(['push_subscriptions.user_index'])
    expect(seen).toHaveLength(PUSH_SCHEMA_STATEMENTS.length)
    expect(errors.some((line) => /push_subscriptions.user_index/.test(line))).toBe(true)
  })

  it('never throws, so a database that refuses everything still boots', async () => {
    const { pool } = poolRefusing(/.*/)
    const result = await applyPushSchema(pool)
    expect(result.failed).toHaveLength(PUSH_SCHEMA_STATEMENTS.length)
    expect(result.applied).toHaveLength(0)
  })

  it('reports a clean run with no noise', async () => {
    const { pool } = poolRefusing(/(?!)/)
    const result = await applyPushSchema(pool)
    expect(result.failed).toEqual([])
    expect(result.applied).toHaveLength(PUSH_SCHEMA_STATEMENTS.length)
    expect(errors).toEqual([])
  })
})

/** A profiles row, which push_subscriptions.user_id points at. */
async function seedProfile(pool: any, username: string): Promise<string> {
  const user = await pool.query(
    "insert into users (email, password_hash) values ($1,'x') returning id",
    [`${username}@tko.cam`],
  )
  const id = user.rows[0].id as string
  await pool.query('insert into profiles (id, username) values ($1,$2)', [id, username])
  return id
}
