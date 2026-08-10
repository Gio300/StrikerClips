// =============================================================================
// chatFoundationSchema — the chat DDL, as INDIVIDUALLY APPLIED STATEMENTS.
//
// WHY THIS IS NOT ONE STRING. It used to be: one `pool.query(CHAT_FOUNDATION_DDL)`
// wrapped in a single swallow-and-log catch. `pool.query` with several statements
// sends ONE simple query, and libpq runs a simple query as ONE IMPLICIT
// TRANSACTION — so the first statement to fail rolled back everything that had
// already succeeded in that batch, and the catch printed one line and moved on.
// The concrete failure that motivated this split: `alter column created_at set
// not null` fails on any deployment that still holds a row with a null
// created_at (the backfill above it also being rolled back), and it took the
// (room, created_at) indexes down with it — leaving every chat poll doing a
// sequential scan on a table nobody knew was unindexed, with nothing in the log
// naming which statement died.
//
// So: one statement per entry, each NAMED, each independently idempotent, each
// run in its own query with its own try/catch and its own loud log line. A
// statement that cannot apply on this deployment costs exactly itself.
//
// IDEMPOTENT BY CONSTRUCTION. Every entry is `create … if not exists`,
// `add column if not exists`, `alter column set …` (already a no-op when it
// holds), or an `update … where … is null` that matches nothing on a second
// run. This runs on EVERY boot (server/ensureSchema.ts) and in every test
// (server/testHarness.ts).
//
// NO CONTROL CHARACTERS, NO BACKTICKS. This file has been bitten by both: a
// stray BEL smuggled into a DDL string sat undetected in ensureSchema.ts for
// months, and a backtick inside a template literal silently ends the literal.
// Every statement below is a plain single-quoted string, and
// chatFoundationSchema.test.ts asserts both properties for every entry.
// =============================================================================
import type { Pool } from 'pg'

/** One named, independently applicable, idempotent DDL statement. */
export interface SchemaStatement {
  /** Stable identifier used in logs and in tests. Never reuse one. */
  name: string
  /** Exactly one SQL statement. No trailing semicolon, no second statement. */
  sql: string
}

/**
 * The four message tables the chat surfaces read, with the column that names the
 * room and the name of their (room, created_at) composite index.
 * KEEP IN SYNC with CHAT_TABLES in src/lib/chatMessages.ts.
 */
const MESSAGE_TABLES: readonly { table: string; roomCol: string; index: string }[] = [
  { table: 'stream_messages', roomCol: 'stream_id', index: 'idx_stream_messages_stream' },
  { table: 'tournament_messages', roomCol: 'tournament_id', index: 'tournament_messages_scope_idx' },
  { table: 'chat_messages', roomCol: 'channel_id', index: 'idx_chat_messages_channel' },
  { table: 'dm_messages', roomCol: 'conversation_id', index: 'idx_dm_messages_conversation' },
]

function messageTableStatements(): SchemaStatement[] {
  const out: SchemaStatement[] = []
  for (const { table, roomCol, index } of MESSAGE_TABLES) {
    // Structural @mentions + reply-to. See src/lib/chatMentions.ts: "mentions"
    // stores [{user_id, username, start, end}] so the renderer slices the body at
    // known offsets instead of re-scanning the text for "@name".
    out.push({
      name: `${table}.mentions`,
      sql: `alter table public.${table} add column if not exists mentions jsonb not null default '[]'::jsonb`,
    })
    out.push({
      name: `${table}.reply_to`,
      sql: `alter table public.${table} add column if not exists reply_to uuid`,
    })
    // LIVE DELIVERY, part 1 — created_at MUST BE NOT NULL. The poll reads
    // "created_at >= cursor"; a null created_at never satisfies it, so such a row
    // is INVISIBLE TO THE POLL FOREVER. Backfill first (a null gets the closest
    // instant we can honestly give it), then constrain so it cannot come back.
    // The backfill and the constraint are SEPARATE statements on purpose: if the
    // constraint is refused, the backfill must still stick.
    out.push({
      name: `${table}.created_at.backfill`,
      sql: `update public.${table} set created_at = now() where created_at is null`,
    })
    out.push({
      name: `${table}.created_at.default`,
      sql: `alter table public.${table} alter column created_at set default now()`,
    })
    out.push({
      name: `${table}.created_at.not_null`,
      sql: `alter table public.${table} alter column created_at set not null`,
    })
    // LIVE DELIVERY, part 2 — without this composite, that cursor read is a
    // sequential scan of the room on every tick of every open tab.
    out.push({
      name: `${table}.room_index`,
      sql: `create index if not exists ${index} on public.${table} (${roomCol}, created_at)`,
    })
  }
  return out
}

/**
 * The chat foundation, in application order.
 *
 * tournament_messages is CREATED here: the API policy and TournamentChat both
 * read and write it, but it had no DDL in db/schema.sql or any migration, so
 * tournament chat errored out on a slim schema.
 */
export const CHAT_FOUNDATION_STATEMENTS: readonly SchemaStatement[] = [
  {
    name: 'tournament_messages.table',
    sql:
      'create table if not exists public.tournament_messages (' +
      ' id uuid primary key default uuid_generate_v4(),' +
      ' tournament_id uuid not null,' +
      ' user_id uuid references public.profiles(id) on delete set null,' +
      ' content text not null,' +
      ' created_at timestamptz not null default now()' +
      ')',
  },
  ...messageTableStatements(),
  // Reactions are polymorphic across those four tables, so "surface" names which
  // one "message_id" points into. No FK is possible for that reason; the unique
  // key is what makes a double-tap idempotent at the database, not just in the UI.
  {
    name: 'chat_reactions.table',
    sql:
      'create table if not exists public.chat_reactions (' +
      ' id uuid primary key default uuid_generate_v4(),' +
      " surface text not null check (surface in ('stream','tournament','channel','dm'))," +
      ' message_id uuid not null,' +
      ' user_id uuid not null references public.profiles(id) on delete cascade,' +
      ' emoji text not null,' +
      ' created_at timestamptz not null default now(),' +
      ' unique (surface, message_id, user_id, emoji)' +
      ')',
  },
  {
    name: 'chat_reactions.message_index',
    sql:
      'create index if not exists chat_reactions_message_idx' +
      ' on public.chat_reactions(surface, message_id, created_at)',
  },
  {
    name: 'chat_reactions.user_index',
    sql: 'create index if not exists chat_reactions_user_idx on public.chat_reactions(user_id)',
  },
]

/** What one application of the chat foundation did. */
export interface ChatFoundationResult {
  /** Names of the statements that applied (or were already in place). */
  applied: string[]
  /** Names of the statements that failed, in order. Empty is the happy path. */
  failed: string[]
}

/**
 * Apply every statement, one query at a time, and NEVER let one failure hide
 * the rest.
 *
 * Each failure is logged on its own line naming the statement — the whole point
 * of the split is that "chat foundation DDL failed" is no longer a sentence
 * anyone has to debug from. The caller decides what a non-empty `failed` means;
 * at boot it means "log it and carry on", because chat degrades gracefully
 * without these columns (the client falls back to a legacy select and the server
 * probes before writing them).
 */
export async function applyChatFoundation(pool: Pool): Promise<ChatFoundationResult> {
  const applied: string[] = []
  const failed: string[] = []
  for (const statement of CHAT_FOUNDATION_STATEMENTS) {
    try {
      await pool.query(statement.sql)
      applied.push(statement.name)
    } catch (error: any) {
      failed.push(statement.name)
      console.error(
        `[ensureSchema] chat foundation statement FAILED: ${statement.name} — ${error?.message || error}`,
      )
    }
  }
  if (failed.length > 0) {
    console.error(
      `[ensureSchema] chat foundation applied ${applied.length}/${CHAT_FOUNDATION_STATEMENTS.length};` +
        ` FAILED: ${failed.join(', ')}`,
    )
  }
  return { applied, failed }
}
