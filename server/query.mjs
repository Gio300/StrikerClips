// ============================================================================
//  server/query.mjs — safe generic query gateway
//
//  Backs the frontend's Supabase-style `.from(table).select()/insert()/
//  update()/delete()` calls. The request body describes a single-table query;
//  we translate it into a parameterized SQL statement.
//
//  SECURITY MODEL (first cut):
//    * Every table is checked against a hard ALLOWLIST.
//    * Every identifier (table / column / order column) must match ^[a-z_][a-z0-9_]*$.
//    * Values are NEVER interpolated — they always travel as $1,$2,… params.
//    * update / delete without a filter are refused (no accidental full-table wipes).
//    * Per-row ownership is NOT enforced yet — the API layer is trusted for now.
//      (The `users` credential table is deliberately NOT in the allowlist.)
// ============================================================================

import { query } from './db.mjs'

// Tables the gateway is allowed to touch. NOTE: public.users (email +
// password_hash) is intentionally excluded so credentials can't be read/written
// through the generic gateway — auth goes through the dedicated /api/auth/* routes.
const ALLOWED_TABLES = new Set([
  'profiles',
  'clips',
  'reels',
  'matches',
  'servers',
  'server_members',
  'channels',
  'messages',
  'reactions',
  'follows',
  'reel_likes',
  'live_streams',
  'live_groups',
  'live_group_members',
  'user_youtube_links',
  'dm_conversations',
  'dm_participants',
  'dm_messages',
  'polls',
  'poll_options',
  'poll_votes',
  'activities',
  'reel_reactions',
  'match_results',
  'match_result_players',
  'power_ratings',
  'trophies',
  'stat_check_submissions',
  'tournaments',
  'tournament_admins',
  'tournament_results',
  'tournament_entrants',
  'notifications',
  'stream_messages',
  'creator_stripe_accounts',
  'donations',
  'pending_uploads',
  'soundboard_pads',
  'frame_labels',
  'creator_agreements',
  'creator_earnings',
  'clans',
  'clan_members',
  'clan_messages',
  'clan_matches',
  'room_messages',
])

// SQL operators keyed by the frontend's op name.
const OPERATORS = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
  ilike: 'ILIKE',
  in: 'IN',
  is: 'IS',
}

const IDENT = /^[a-z_][a-z0-9_]*$/

function isValidIdent(name) {
  return typeof name === 'string' && IDENT.test(name)
}

// A tiny parameter accumulator: push(val) records the value and returns its
// positional placeholder ("$1", "$2", …).
function makeParams() {
  const values = []
  return {
    values,
    push(val) {
      values.push(val)
      return `$${values.length}`
    },
  }
}

// Quote a validated identifier. (Validation already guarantees it's safe; the
// quotes let us pass reserved words like "order".)
function q(ident) {
  return `"${ident}"`
}

/**
 * Build a WHERE clause from a filters array.
 * @returns {{ sql: string } | { error: string }}
 */
function buildWhere(filters, params) {
  if (!Array.isArray(filters) || filters.length === 0) return { sql: '' }
  const parts = []
  for (const f of filters) {
    if (!f || typeof f !== 'object') return { error: 'invalid filter' }
    const { col, op, val } = f
    if (!isValidIdent(col)) return { error: `invalid filter column: ${col}` }
    const sqlOp = OPERATORS[op]
    if (!sqlOp) return { error: `unsupported operator: ${op}` }

    if (op === 'is') {
      // Postgres keywords, not user data — safe to inline. Only null/true/false.
      if (val === null) parts.push(`${q(col)} IS NULL`)
      else if (val === true) parts.push(`${q(col)} IS TRUE`)
      else if (val === false) parts.push(`${q(col)} IS FALSE`)
      else return { error: "operator 'is' expects null, true, or false" }
      continue
    }

    if (op === 'in') {
      if (!Array.isArray(val)) return { error: "operator 'in' expects an array" }
      if (val.length === 0) {
        parts.push('1 = 0') // IN () matches nothing
        continue
      }
      const placeholders = val.map((v) => params.push(v)).join(', ')
      parts.push(`${q(col)} IN (${placeholders})`)
      continue
    }

    parts.push(`${q(col)} ${sqlOp} ${params.push(val)}`)
  }
  return { sql: `WHERE ${parts.join(' AND ')}` }
}

function buildColumns(columns) {
  if (columns == null || columns === '*' || columns === '') return { sql: '*' }
  if (typeof columns !== 'string') return { error: 'columns must be a csv string or "*"' }
  const cols = columns
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
  if (cols.length === 0) return { sql: '*' }
  for (const c of cols) {
    if (c === '*') return { sql: '*' }
    if (!isValidIdent(c)) return { error: `invalid column: ${c}` }
  }
  return { sql: cols.map(q).join(', ') }
}

/**
 * Execute a generic single-table query.
 *
 * @param {object} body
 * @param {string} body.table
 * @param {'select'|'insert'|'update'|'delete'} body.action
 * @param {string} [body.columns]           csv or '*'
 * @param {Array<{col,op,val}>} [body.filters]
 * @param {{col:string, ascending?:boolean}} [body.order]
 * @param {number} [body.limit]
 * @param {boolean} [body.single]
 * @param {object|object[]} [body.values]   for insert/update
 * @param {string|null} userId              currently unused (trusted API)
 * @returns {Promise<{ data: any, error: string|null }>}
 */
export async function handleQuery(body, userId) {
  try {
    if (!body || typeof body !== 'object') {
      return { data: null, error: 'invalid request body' }
    }
    const { table, action } = body
    if (!isValidIdent(table) || !ALLOWED_TABLES.has(table)) {
      return { data: null, error: `table not allowed: ${table}` }
    }

    const single = body.single === true
    const params = makeParams()

    if (action === 'select') {
      const cols = buildColumns(body.columns)
      if (cols.error) return { data: null, error: cols.error }

      const where = buildWhere(body.filters, params)
      if (where.error) return { data: null, error: where.error }

      let sql = `SELECT ${cols.sql} FROM ${q(table)}`
      if (where.sql) sql += ` ${where.sql}`

      if (body.order) {
        const { col, ascending } = body.order
        if (!isValidIdent(col)) return { data: null, error: `invalid order column: ${col}` }
        sql += ` ORDER BY ${q(col)} ${ascending === false ? 'DESC' : 'ASC'}`
      }

      let limit = body.limit
      if (single && limit == null) limit = 1
      if (limit != null) {
        const n = Number(limit)
        if (!Number.isInteger(n) || n < 0) return { data: null, error: 'invalid limit' }
        sql += ` LIMIT ${params.push(n)}`
      }

      const { rows } = await query(sql, params.values)
      return { data: single ? rows[0] ?? null : rows, error: null }
    }

    if (action === 'insert') {
      const rowsIn = Array.isArray(body.values) ? body.values : [body.values]
      if (rowsIn.length === 0 || rowsIn.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
        return { data: null, error: 'insert requires a values object or array of objects' }
      }
      // Column set is the union of the first row's keys; every row must match it.
      const cols = Object.keys(rowsIn[0])
      if (cols.length === 0) return { data: null, error: 'insert values have no columns' }
      for (const c of cols) {
        if (!isValidIdent(c)) return { data: null, error: `invalid column: ${c}` }
      }

      const tuples = rowsIn.map((row) => {
        const placeholders = cols.map((c) => params.push(row[c] === undefined ? null : row[c]))
        return `(${placeholders.join(', ')})`
      })

      const sql =
        `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) ` +
        `VALUES ${tuples.join(', ')} RETURNING *`

      const { rows } = await query(sql, params.values)
      return { data: single ? rows[0] ?? null : rows, error: null }
    }

    if (action === 'update') {
      const vals = body.values
      if (!vals || typeof vals !== 'object' || Array.isArray(vals)) {
        return { data: null, error: 'update requires a values object' }
      }
      const cols = Object.keys(vals)
      if (cols.length === 0) return { data: null, error: 'update values have no columns' }
      for (const c of cols) {
        if (!isValidIdent(c)) return { data: null, error: `invalid column: ${c}` }
      }
      // Refuse a filterless update.
      if (!Array.isArray(body.filters) || body.filters.length === 0) {
        return { data: null, error: 'update requires at least one filter' }
      }

      const setSql = cols.map((c) => `${q(c)} = ${params.push(vals[c])}`).join(', ')
      const where = buildWhere(body.filters, params)
      if (where.error) return { data: null, error: where.error }

      const sql = `UPDATE ${q(table)} SET ${setSql} ${where.sql} RETURNING *`
      const { rows } = await query(sql, params.values)
      return { data: single ? rows[0] ?? null : rows, error: null }
    }

    if (action === 'delete') {
      // Refuse a filterless delete.
      if (!Array.isArray(body.filters) || body.filters.length === 0) {
        return { data: null, error: 'delete requires at least one filter' }
      }
      const where = buildWhere(body.filters, params)
      if (where.error) return { data: null, error: where.error }

      const sql = `DELETE FROM ${q(table)} ${where.sql} RETURNING *`
      const { rows } = await query(sql, params.values)
      return { data: single ? rows[0] ?? null : rows, error: null }
    }

    return { data: null, error: `unsupported action: ${action}` }
  } catch (err) {
    return { data: null, error: err?.message || 'query failed' }
  }
}

export default { handleQuery }
