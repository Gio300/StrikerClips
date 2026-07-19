/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * KillCam API — the backend that replaces Supabase in front of the plain SQL
 * database (db/schema.sql). Own auth (bcrypt + JWT), CRUD, uploads. Written
 * against the `pg` Pool interface so the same app runs on real Postgres in
 * production and an in-memory Postgres (pg-mem) in tests.
 */
import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

type Pooly = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'

export function createApp(pool: Pooly) {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '2mb' }))

  const sign = (u: { id: string; email: string }) =>
    jwt.sign({ sub: u.id, email: u.email }, JWT_SECRET, { expiresIn: '30d' })

  function auth(req: Request, res: Response, next: NextFunction) {
    const h = req.headers.authorization || ''
    const t = h.startsWith('Bearer ') ? h.slice(7) : ''
    try { (req as any).user = jwt.verify(t, JWT_SECRET); next() } catch { res.status(401).json({ error: 'unauthorized' }) }
  }
  const uid = (req: Request) => (req as any).user.sub as string

  app.get('/health', (_req, res) => res.json({ ok: true }))

  // ---- auth ----
  app.post('/auth/signup', async (req, res) => {
    const { email, password, username } = req.body || {}
    if (!email || !password || String(password).length < 6) return res.status(400).json({ error: 'email + 6+ char password required' })
    const exists = await pool.query('select id from users where email=$1', [email])
    if (exists.rows.length) return res.status(409).json({ error: 'email already registered' })
    const hash = await bcrypt.hash(String(password), 10)
    const base = (username || String(email).split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '_')
    const meta = JSON.stringify({ username: base, reelone_tier: '' })
    const u = await pool.query('insert into users (email, password_hash, user_metadata) values ($1,$2,$3) returning id, email, user_metadata', [email, hash, meta])
    const user = u.rows[0]
    let uname = base
    const clash = await pool.query('select 1 from profiles where username=$1', [uname])
    if (clash.rows.length) uname = base + '_' + String(user.id).slice(0, 4)
    await pool.query('insert into profiles (id, username) values ($1,$2) on conflict (id) do nothing', [user.id, uname])
    res.json({ token: sign(user), user })
  })

  app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body || {}
    const r = await pool.query('select id, email, password_hash, user_metadata from users where email=$1', [email])
    const u = r.rows[0]
    if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash || ''))) return res.status(401).json({ error: 'invalid credentials' })
    res.json({ token: sign(u), user: { id: u.id, email: u.email, user_metadata: u.user_metadata } })
  })

  app.get('/auth/me', auth, async (req, res) => {
    const r = await pool.query('select u.id, u.email, u.user_metadata, p.username, p.power_level from users u left join profiles p on p.id=u.id where u.id=$1', [uid(req)])
    res.json({ user: r.rows[0] ?? null })
  })

  // ---- profiles ----
  app.get('/profiles/:id', async (req, res) => {
    const r = await pool.query('select id, username, avatar_url, bio, power_level, country from profiles where id=$1', [req.params.id])
    res.json({ profile: r.rows[0] ?? null })
  })

  // ---- clips (list + create + search) ----
  app.get('/clips', async (_req, res) => {
    const r = await pool.query('select * from clips order by created_at desc limit 100')
    res.json({ clips: r.rows })
  })
  app.post('/clips', auth, async (req, res) => {
    const { source_type, url_or_path, title, category, subject_profile_id, youtube_video_id, start_sec } = req.body || {}
    if (!url_or_path) return res.status(400).json({ error: 'url_or_path required' })
    const r = await pool.query(
      'insert into clips (user_id, source_type, url_or_path, title, category, subject_profile_id, youtube_video_id, start_sec) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *',
      [uid(req), source_type || 'youtube', url_or_path, title || null, category || null, subject_profile_id || null, youtube_video_id || null, start_sec ?? null],
    )
    res.json({ clip: r.rows[0] })
  })
  // "his last 10 kills": /clips/search?player=<id>&category=kill&limit=10
  app.get('/clips/search', async (req, res) => {
    const player = (req.query.player as string) || null
    const category = (req.query.category as string) || null
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 10))
    const r = await pool.query(
      `select * from clips where ($1::uuid is null or subject_profile_id=$1) and ($2::text is null or category=$2) order by created_at desc limit ${limit}`,
      [player, category],
    )
    res.json({ clips: r.rows })
  })

  return app
}
