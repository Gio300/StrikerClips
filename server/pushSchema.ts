// =============================================================================
// pushSchema — DDL for web-push subscriptions, as INDIVIDUALLY APPLIED
// STATEMENTS.
//
// Same shape and same reasoning as server/chatFoundationSchema.ts: one statement
// per entry, each NAMED, each independently idempotent, each run in its own
// query with its own try/catch and its own log line. `pool.query(oneBigString)`
// is a single simple query and therefore ONE implicit transaction, so one
// refused statement would roll back every statement that had already succeeded
// beside it — which is how this repo previously lost a set of indexes without
// anything in the log naming the culprit.
//
// IDEMPOTENT BY CONSTRUCTION. Every entry is `create … if not exists` or
// `add column if not exists`. This runs on EVERY boot (server/ensureSchema.ts)
// and in every test (server/testHarness.ts).
//
// NO CONTROL CHARACTERS, NO BACKTICKS. This repo has been bitten by both — a
// stray BEL smuggled into a DDL string sat undetected for months, and a backtick
// inside a template literal silently ends the literal. Every statement below is
// a plain single-quoted string, and pushSchema.test.ts asserts both properties
// for every entry.
//
// WHY endpoint IS THE UNIQUE KEY, not (user_id, endpoint). A push endpoint is
// issued by the browser's push service and identifies ONE browser install. If a
// phone is handed to another member and they sign in, the same endpoint must
// re-bind to the new user — never fan a message out to both. Uniqueness on the
// endpoint alone is what makes that re-bind a single row rather than a leak.
// =============================================================================
import type { Pool } from 'pg'
import type { SchemaStatement } from './chatFoundationSchema'

export const PUSH_SCHEMA_STATEMENTS: readonly SchemaStatement[] = [
  {
    name: 'push_subscriptions.table',
    sql:
      'create table if not exists public.push_subscriptions (' +
      ' id uuid primary key default uuid_generate_v4(),' +
      ' user_id uuid not null references public.profiles(id) on delete cascade,' +
      ' endpoint text not null unique,' +
      ' p256dh text not null,' +
      ' auth text not null,' +
      ' user_agent text,' +
      ' created_at timestamptz not null default now(),' +
      ' last_seen_at timestamptz not null default now()' +
      ')',
  },
  // Heals a table created by an earlier shape of this file. No-ops otherwise.
  {
    name: 'push_subscriptions.user_agent',
    sql: 'alter table public.push_subscriptions add column if not exists user_agent text',
  },
  {
    name: 'push_subscriptions.last_seen_at',
    sql:
      'alter table public.push_subscriptions' +
      ' add column if not exists last_seen_at timestamptz not null default now()',
  },
  // Every send starts with "which subscriptions does this user have?".
  {
    name: 'push_subscriptions.user_index',
    sql:
      'create index if not exists push_subscriptions_user_idx' +
      ' on public.push_subscriptions(user_id)',
  },
]

/** What one application of the push schema did. */
export interface PushSchemaResult {
  /** Names of the statements that applied (or were already in place). */
  applied: string[]
  /** Names of the statements that failed, in order. Empty is the happy path. */
  failed: string[]
}

/**
 * Apply every statement, one query at a time, and NEVER let one failure hide the
 * rest or reach the caller.
 *
 * At boot a non-empty `failed` means "log it and carry on": with no
 * push_subscriptions table nobody can subscribe, so the feature simply stays
 * off — which is exactly the state the whole slice is designed to degrade to.
 */
export async function applyPushSchema(pool: Pool): Promise<PushSchemaResult> {
  const applied: string[] = []
  const failed: string[] = []
  for (const statement of PUSH_SCHEMA_STATEMENTS) {
    try {
      await pool.query(statement.sql)
      applied.push(statement.name)
    } catch (error: any) {
      failed.push(statement.name)
      console.error(
        `[ensureSchema] push schema statement FAILED: ${statement.name} — ${error?.message || error}`,
      )
    }
  }
  if (failed.length > 0) {
    console.error(
      `[ensureSchema] push schema applied ${applied.length}/${PUSH_SCHEMA_STATEMENTS.length};` +
        ` FAILED: ${failed.join(', ')}`,
    )
  }
  return { applied, failed }
}
