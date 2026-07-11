// ============================================================================
//  server/db.mjs — Postgres connection pool + schema bootstrap
//
//  Connection modes (env-driven):
//    * Cloud SQL  — set INSTANCE_CONNECTION_NAME (e.g.
//        "reelone-498406:us-central1:reelone-db"). We connect over the Cloud SQL
//        unix socket at /cloudsql/<INSTANCE_CONNECTION_NAME>.
//    * Local/TCP  — otherwise use DB_HOST/DB_PORT (default 127.0.0.1:5432).
//
//  DB_USER (default 'reelone_app'), DB_NAME (default 'reelone'), and
//  DB_PASSWORD all come from the environment. The password is NEVER hardcoded.
// ============================================================================

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))

const {
  INSTANCE_CONNECTION_NAME,
  DB_HOST,
  DB_PORT,
  DB_USER,
  DB_NAME,
  DB_PASSWORD,
} = process.env

const user = DB_USER || 'reelone_app'
const database = DB_NAME || 'reelone'
const password = DB_PASSWORD // undefined is fine (trust auth / local)

const config = INSTANCE_CONNECTION_NAME
  ? {
      // Cloud SQL unix socket. node-postgres treats a host starting with "/"
      // as a directory containing the .s.PGSQL.<port> socket file.
      host: `/cloudsql/${INSTANCE_CONNECTION_NAME}`,
      user,
      database,
      password,
      max: 10,
    }
  : {
      host: DB_HOST || '127.0.0.1',
      port: Number(DB_PORT) || 5432,
      user,
      database,
      password,
      max: 10,
    }

export const pool = new Pool(config)

// Don't let an idle-client error take down the process.
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message)
})

/**
 * Run a parameterized query against the pool.
 * @param {string} text
 * @param {any[]} [params]
 */
export function query(text, params) {
  return pool.query(text, params)
}

/**
 * Split a SQL script into individual statements, respecting dollar-quoted
 * bodies ($$…$$ / $tag$…$tag$), single-quoted strings, and -- / block comments.
 * Needed so we can run statements ONE AT A TIME (a single multi-statement query
 * aborts entirely on the first error).
 */
function splitSqlStatements(sql) {
  const out = []
  let cur = ''
  let i = 0
  const n = sql.length
  let dollarTag = null
  while (i < n) {
    const ch = sql[i]
    if (dollarTag) {
      if (ch === '$' && sql.slice(i).startsWith(dollarTag)) {
        cur += dollarTag
        i += dollarTag.length
        dollarTag = null
        continue
      }
      cur += ch; i++; continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const eol = sql.indexOf('\n', i); const end = eol === -1 ? n : eol
      cur += sql.slice(i, end); i = end; continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const c = sql.indexOf('*/', i); const end = c === -1 ? n : c + 2
      cur += sql.slice(i, end); i = end; continue
    }
    if (ch === "'") {
      let j = i + 1
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue }
        if (sql[j] === "'") { j++; break }
        j++
      }
      cur += sql.slice(i, j); i = j; continue
    }
    if (ch === '$') {
      const m = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/)
      if (m) { dollarTag = m[0]; cur += dollarTag; i += dollarTag.length; continue }
    }
    if (ch === ';') { out.push(cur); cur = ''; i++; continue }
    cur += ch; i++
  }
  if (cur.trim()) out.push(cur)
  return out
}

/**
 * Apply server/schema.sql, ONE STATEMENT AT A TIME so a single failing
 * statement (e.g. an ALTER on a pre-existing table this role doesn't own) is
 * skipped instead of aborting the whole schema. Idempotent, never throws.
 * @returns {Promise<boolean>} true if every statement applied cleanly
 */
export async function bootstrap() {
  try {
    const sql = await readFile(join(__dirname, 'schema.sql'), 'utf8')
    const statements = splitSqlStatements(sql)
    let ok = 0
    let skipped = 0
    for (const stmt of statements) {
      const s = stmt.trim()
      if (!s) continue
      try {
        await pool.query(s)
        ok++
      } catch (err) {
        skipped++
        console.warn('[db] stmt skipped:', (err.message || '').slice(0, 140))
      }
    }
    console.log(`[db] schema bootstrap: ${ok} ok, ${skipped} skipped`)
    return skipped === 0
  } catch (err) {
    console.error('[db] schema bootstrap read failed (continuing anyway):', err.message)
    return false
  }
}

export default { pool, query, bootstrap }
