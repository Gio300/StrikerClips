// ============================================================================
//  server/index.mjs — KillCam backend (Express, ES module)
//
//  Replaces Supabase. Serves:
//    * a JSON API under /api/*   (auth, generic query gateway, health, storage stub)
//    * the built SPA from ./dist (with an SPA history fallback)
//
//  Auth is JWT (Bearer header OR httpOnly `token` cookie) + bcrypt password
//  hashes. The frontend talks to this same-origin, so no CORS is required.
// ============================================================================

import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

import { pool, query, bootstrap } from './db.mjs'
import { handleQuery } from './query.mjs'
import { attachRealtime, publishInsert, startPgListener, RT_KEYS } from './realtime.mjs'
import { processMentions } from './mentions.mjs'
import { mountMonetization, handleStripeWebhook } from './monetization.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(__dirname, '..', 'dist')

const PORT = process.env.PORT || 8080
const JWT_SECRET = process.env.JWT_SECRET || 'killcam-dev-secret-change-me'
const TOKEN_TTL = '30d'
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
}

const app = express()
app.disable('x-powered-by')

// Stripe webhook MUST see the raw body to verify the signature, so it is
// registered BEFORE the JSON body parser. (See monetization.mjs.)
app.post('/api/billing/stripe-webhook', express.raw({ type: '*/*' }), handleStripeWebhook)

app.use(express.json({ limit: '5mb' }))
app.use(cookieParser())

// ─────────────────────────────────────────────────────────────────────────
//  Auth helpers
// ─────────────────────────────────────────────────────────────────────────
function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: TOKEN_TTL })
}

/** Extract + verify the caller's user id from Bearer header or cookie. */
function getUserId(req) {
  try {
    let token = null
    const auth = req.headers.authorization
    if (auth && auth.startsWith('Bearer ')) token = auth.slice(7).trim()
    if (!token && req.cookies) token = req.cookies.token || null
    if (!token) return null
    const payload = jwt.verify(token, JWT_SECRET)
    return payload.sub || null
  } catch {
    return null
  }
}

/** Look up a { id, email, username } view of a user by id. */
async function loadUser(userId) {
  const { rows } = await query(
    `SELECT u.id, u.email, p.username
       FROM public.users u
       LEFT JOIN public.profiles p ON p.id = u.id
      WHERE u.id = $1`,
    [userId],
  )
  return rows[0] || null
}

/** Turn a desired username into a unique one, trying a few random suffixes. */
async function uniqueUsername(desired) {
  let base = (desired || '').trim().replace(/[^a-zA-Z0-9_]/g, '_')
  if (!base) base = 'user'
  let candidate = base
  for (let i = 0; i < 6; i++) {
    const { rows } = await query('SELECT 1 FROM public.profiles WHERE username = $1', [candidate])
    if (rows.length === 0) return candidate
    candidate = `${base}_${Math.random().toString(36).slice(2, 6)}`
  }
  return `${base}_${Date.now().toString(36)}`
}

// ─────────────────────────────────────────────────────────────────────────
//  Auth routes
// ─────────────────────────────────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, username } = req.body || {}
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' })
    }
    const normEmail = String(email).trim().toLowerCase()

    const existing = await query('SELECT 1 FROM public.users WHERE email = $1', [normEmail])
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'email already registered' })
    }

    const passwordHash = await bcrypt.hash(String(password), 10)
    const uname = await uniqueUsername(username || normEmail.split('@')[0])

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const inserted = await client.query(
        'INSERT INTO public.users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [normEmail, passwordHash],
      )
      const user = inserted.rows[0]
      await client.query('INSERT INTO public.profiles (id, username) VALUES ($1, $2)', [user.id, uname])
      await client.query('COMMIT')

      const token = signToken(user.id)
      res.cookie('token', token, COOKIE_OPTS)
      return res.status(201).json({
        user: { id: user.id, email: user.email, username: uname },
        token,
      })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      // 23505 = unique_violation (email or username raced us)
      if (err && err.code === '23505') {
        return res.status(409).json({ error: 'email or username already taken' })
      }
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('[signup]', err.message)
    return res.status(500).json({ error: 'signup failed' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' })
    }
    const normEmail = String(email).trim().toLowerCase()

    const { rows } = await query(
      `SELECT u.id, u.email, u.password_hash, p.username
         FROM public.users u
         LEFT JOIN public.profiles p ON p.id = u.id
        WHERE u.email = $1`,
      [normEmail],
    )
    const row = rows[0]
    if (!row) return res.status(401).json({ error: 'invalid credentials' })

    const ok = await bcrypt.compare(String(password), row.password_hash)
    if (!ok) return res.status(401).json({ error: 'invalid credentials' })

    const token = signToken(row.id)
    res.cookie('token', token, COOKIE_OPTS)
    return res.json({
      user: { id: row.id, email: row.email, username: row.username },
      token,
    })
  } catch (err) {
    console.error('[login]', err.message)
    return res.status(500).json({ error: 'login failed' })
  }
})

app.get('/api/auth/me', async (req, res) => {
  try {
    const userId = getUserId(req)
    if (!userId) return res.status(401).json({ error: 'not authenticated' })
    const user = await loadUser(userId)
    if (!user) return res.status(401).json({ error: 'not authenticated' })
    return res.json({ user })
  } catch (err) {
    console.error('[me]', err.message)
    return res.status(500).json({ error: 'lookup failed' })
  }
})

app.post('/api/auth/logout', (req, res) => {
  try {
    res.clearCookie('token', { ...COOKIE_OPTS, maxAge: undefined })
    return res.json({ ok: true })
  } catch (err) {
    console.error('[logout]', err.message)
    return res.status(500).json({ error: 'logout failed' })
  }
})

// ─────────────────────────────────────────────────────────────────────────
//  Monetization — ad-free entitlement, credit ledger, rewarded ads, billing
//  (server-side source of truth; shares the JWT auth via getUserId)
// ─────────────────────────────────────────────────────────────────────────
mountMonetization(app, { getUserId })

// ─────────────────────────────────────────────────────────────────────────
//  Generic query gateway
// ─────────────────────────────────────────────────────────────────────────
app.post('/api/query', async (req, res) => {
  try {
    const body = req.body || {}
    const result = await handleQuery(body, getUserId(req))
    // Live fan-out + @mention pings for successful realtime-table inserts.
    if (!result.error && body.action === 'insert' && body.table && RT_KEYS[body.table]) {
      const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : []
      for (const row of rows) {
        publishInsert(pool, body.table, row)
        processMentions(body.table, row)
          .then((notifs) => { for (const n of notifs) publishInsert(pool, 'notifications', n) })
          .catch(() => {})
      }
    }
    return res.json(result)
  } catch (err) {
    console.error('[query]', err.message)
    return res.status(500).json({ data: null, error: 'query failed' })
  }
})

// ─────────────────────────────────────────────────────────────────────────
//  Health + storage stub
// ─────────────────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  let db = false
  try {
    await query('SELECT 1')
    db = true
  } catch (err) {
    console.error('[health] db check failed:', err.message)
  }
  return res.json({ ok: true, db })
})

app.post('/api/storage/sign', (_req, res) => {
  return res.status(503).json({ error: 'storage not configured' })
})

// Any other unmatched /api route is a JSON 404 (never falls through to the SPA).
app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'not found' })
})

// ─────────────────────────────────────────────────────────────────────────
//  Static SPA + history fallback (registered AFTER all /api routes)
// ─────────────────────────────────────────────────────────────────────────
app.use(express.static(DIST_DIR))

app.get('*', (_req, res) => {
  res.sendFile(join(DIST_DIR, 'index.html'), (err) => {
    if (err) res.status(404).send('Not found')
  })
})

// Final safety net — never leak stack traces.
app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err && err.message)
  if (res.headersSent) return
  res.status(500).json({ error: 'internal server error' })
})

// ─────────────────────────────────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────────────────────────────────
async function start() {
  await bootstrap() // applies schema.sql; logs + continues even on failure
  const server = http.createServer(app)
  attachRealtime(server) // WebSocket fan-out at /ws
  startPgListener(pool) // cross-instance realtime via Postgres LISTEN/NOTIFY
  server.listen(PORT, () => {
    console.log(`[server] KillCam backend listening on :${PORT}`)
  })
}

start()
