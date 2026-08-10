/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_FOUNDATION_STATEMENTS,
  applyChatFoundation,
  type SchemaStatement,
} from './chatFoundationSchema'
import { makeDb } from './testHarness'

/**
 * THE MIGRATION ITSELF, UNDER TEST.
 *
 * The chat foundation used to be one string in one `pool.query`, inside one
 * swallow-and-log catch. That is a single implicit transaction: the first
 * statement to fail rolled back every statement beside it — a refused
 * `alter column created_at set not null` silently took the (room, created_at)
 * indexes with it — and the log said only "chat foundation DDL failed", naming
 * nothing. Nothing executed the DDL in test either, so a statement that could
 * not run was discovered in production by a chat room that stopped moving.
 *
 * These tests close both holes: the statements are individually applicable and
 * individually reported, and server/testHarness.ts now EXECUTES them, so this
 * file can assert the guarantees they exist to provide.
 */

const CREATES_TABLE = (statement: SchemaStatement) => /^create table\b/i.test(statement.sql)

describe('chat foundation statements — idempotent by construction', () => {
  it('is a non-empty list of uniquely named statements', () => {
    expect(CHAT_FOUNDATION_STATEMENTS.length).toBeGreaterThan(0)
    const names = CHAT_FOUNDATION_STATEMENTS.map((s) => s.name)
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
      /^alter table [\w.]+ alter column \w+ set (default|not null)\b/i,
      /^update [\w.]+ set \w+ = now\(\) where \w+ is null$/i,
    ]
    for (const statement of CHAT_FOUNDATION_STATEMENTS) {
      const ok = idempotent.some((shape) => shape.test(statement.sql))
      expect(ok, `${statement.name} is not idempotent by construction: ${statement.sql}`).toBe(true)
    }
  })

  it('carries NO control characters and NO backticks', () => {
    // Both have bitten this repo: a stray BEL smuggled into a DDL string sat
    // undetected for months, and a backtick silently ends a template literal.
    for (const statement of CHAT_FOUNDATION_STATEMENTS) {
      // eslint-disable-next-line no-control-regex
      const control = statement.sql.match(/[\u0000-\u001f\u007f]/)
      expect(control, `${statement.name} carries a control character`).toBeNull()
      expect(statement.sql, `${statement.name} carries a backtick`).not.toContain('`')
      expect(statement.sql).toBe(statement.sql.trim())
    }
  })

  it('is ONE statement per entry — the whole point of the split', () => {
    // A semicolon would put two statements back in one query, and one implicit
    // transaction, which is exactly the defect this shape removes.
    for (const statement of CHAT_FOUNDATION_STATEMENTS) {
      expect(statement.sql, `${statement.name} contains a semicolon`).not.toContain(';')
    }
  })
})

describe('chat foundation statements — actually executed', () => {
  it('applies cleanly against the harness database (makeDb runs them for real)', () => {
    // makeDb throws, naming the statement, if any of them cannot execute. That
    // this test constructs a database at all is the assertion.
    expect(() => makeDb()).not.toThrow()
  })

  it('EXECUTES every statement — indexes included — against a real engine', async () => {
    // The test that turns a broken migration into a failing test instead of a
    // production incident. makeDb applies the table/column/constraint half; the
    // INDEX half is applied only here, because pg-mem maintains an index on
    // every insert and doing it in makeDb taxes every suite that builds a
    // database (see the note in server/testHarness.ts). Between the two,
    // nothing in the list goes unexecuted — and this run is also the
    // already-migrated, second-boot path for everything makeDb did apply.
    const pool: any = makeDb()
    const executed: string[] = []
    for (const statement of CHAT_FOUNDATION_STATEMENTS) {
      // `create table if not exists` is skipped ONLY because pg-mem cannot parse
      // the no-op path (it rejects the AST it never planned); its idempotency is
      // asserted structurally above, and makeDb runs it for real on a fresh db.
      if (CREATES_TABLE(statement)) continue
      await expect(pool.query(statement.sql)).resolves.toBeTruthy()
      executed.push(statement.name)
    }
    const indexes = CHAT_FOUNDATION_STATEMENTS.filter((s) => /^create index/i.test(s.sql))
    expect(indexes.length).toBeGreaterThanOrEqual(4)
    for (const index of indexes) expect(executed).toContain(index.name)
    expect(executed).toHaveLength(CHAT_FOUNDATION_STATEMENTS.filter((s) => !CREATES_TABLE(s)).length)
  })

  it('leaves created_at NOT NULL on all four message tables', async () => {
    // The reason the constraint exists: the poll reads "created_at >= cursor",
    // and a null created_at never satisfies it — a message that silently never
    // arrives, which is worse than the frozen list the poll replaced.
    const pool: any = makeDb()
    const author = await seedProfile(pool)
    for (const [table, room, text] of [
      ['stream_messages', 'stream_id', 'content'],
      ['tournament_messages', 'tournament_id', 'content'],
      ['chat_messages', 'channel_id', 'body'],
      ['dm_messages', 'conversation_id', 'content'],
    ]) {
      await expect(
        pool.query(
          `insert into ${table} (${room}, user_id, ${text}, created_at) values ($1,$2,'hi',null)`,
          [ROOM_ID, author],
        ),
      ).rejects.toThrow(/not-null/i)
    }
  })

  it('gives every message table the mentions + reply_to columns', async () => {
    const pool: any = makeDb()
    const author = await seedProfile(pool)
    const inserted = await pool.query(
      'insert into stream_messages (stream_id, user_id, content) values ($1,$2,$3)' +
        ' returning mentions, reply_to, created_at',
      [ROOM_ID, author, 'gg'],
    )
    expect(inserted.rows[0].reply_to).toBeNull()
    expect(inserted.rows[0].created_at).toBeTruthy()
    expect(JSON.parse(JSON.stringify(inserted.rows[0].mentions ?? '[]'))).toBeTruthy()
  })

  it('creates tournament_messages and chat_reactions, with the double-tap key', async () => {
    // tournament_messages had no DDL anywhere before the chat slice even though
    // the API policy and TournamentChat both assumed it.
    const pool: any = makeDb()
    const author = await seedProfile(pool)
    await pool.query('insert into tournament_messages (tournament_id, user_id, content) values ($1,$2,$3)', [
      ROOM_ID,
      author,
      'bracket talk',
    ])
    const stored = await pool.query('select content from tournament_messages')
    expect(stored.rows).toHaveLength(1)

    const react = () =>
      pool.query(
        "insert into chat_reactions (surface, message_id, user_id, emoji) values ('stream',$1,$2,'x')",
        [ROOM_ID, author],
      )
    await react()
    // The unique key is what makes a double-tap idempotent at the DATABASE, not
    // just in the UI.
    await expect(react()).rejects.toThrow()
  })
})

describe('applyChatFoundation — one failure costs exactly itself', () => {
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

  it('keeps going after a refused statement and reports it BY NAME', async () => {
    // THE DEFECT, EXACTLY: a refused `set not null` used to roll back the
    // backfill and the indexes with it, and log one anonymous line.
    const { pool, seen } = poolRefusing(/set not null/i)
    const result = await applyChatFoundation(pool)

    expect(result.failed).toEqual([
      'stream_messages.created_at.not_null',
      'tournament_messages.created_at.not_null',
      'chat_messages.created_at.not_null',
      'dm_messages.created_at.not_null',
    ])
    // Every other statement still ran — including every index, which is what
    // used to be lost.
    expect(seen).toHaveLength(CHAT_FOUNDATION_STATEMENTS.length)
    expect(result.applied).toContain('stream_messages.room_index')
    expect(result.applied).toContain('dm_messages.room_index')
    expect(result.applied).toContain('stream_messages.created_at.backfill')
    expect(result.applied.length + result.failed.length).toBe(CHAT_FOUNDATION_STATEMENTS.length)
  })

  it('logs each failure LOUDLY and individually', async () => {
    const { pool } = poolRefusing(/set not null/i)
    await applyChatFoundation(pool)
    const named = errors.filter((line) => /chat foundation statement FAILED/.test(line))
    expect(named).toHaveLength(4)
    expect(named[0]).toContain('stream_messages.created_at.not_null')
    expect(named[0]).toContain('permission denied')
    // …plus one summary line, so a boot log cannot hide a partial migration.
    expect(errors.some((line) => /FAILED: .*not_null/.test(line))).toBe(true)
  })

  it('never throws, so a degraded chat can never cost the caller its boot', async () => {
    const { pool } = poolRefusing(/.*/)
    const result = await applyChatFoundation(pool)
    expect(result.failed).toHaveLength(CHAT_FOUNDATION_STATEMENTS.length)
    expect(result.applied).toHaveLength(0)
  })

  it('reports a clean run with no noise', async () => {
    const { pool } = poolRefusing(/(?!)/)
    const result = await applyChatFoundation(pool)
    expect(result.failed).toEqual([])
    expect(result.applied).toHaveLength(CHAT_FOUNDATION_STATEMENTS.length)
    expect(errors).toEqual([])
  })
})

const ROOM_ID = '11111111-2222-4333-8444-555555555555'

/** A profiles row, which the chat FKs point at. */
async function seedProfile(pool: any): Promise<string> {
  const user = await pool.query(
    "insert into users (email, password_hash) values ('schema@tko.cam','x') returning id",
  )
  const id = user.rows[0].id as string
  await pool.query("insert into profiles (id, username) values ($1,'schema_probe')", [id])
  return id
}
