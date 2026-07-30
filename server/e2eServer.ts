/* eslint-disable no-console */
// Full-stack E2E server: the REAL built frontend (dist/) served over the REAL
// API (createApp) backed by an in-memory Postgres (pg-mem). No external DB, no
// prod pollution. Playwright drives http://localhost:PORT so the actual React
// UI runs against the actual backend logic — exactly what a phone/emulator sees.
//
//   build first:  VITE_REAL_BACKEND=1 VITE_MOCK_BACKEND= VITE_BASE_PATH= vite build
//   run:          tsx server/e2eServer.ts        (PORT env optional, default 8799)
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createApp } from './app'
import { makeDb } from './testHarness'

process.env.MERCH_MODE ||= 'simulate'
process.env.MERCH_PAYOUT_HOLD_DAYS ||= '0'

const pool = makeDb()
const app = createApp(pool)

// Test-only entitlement grant. This server is never part of the production
// image; it lets full-stack proofs create authorized broadcasters while the
// real API continues to fail closed for unpaid accounts.
app.post('/__e2e/grant-creator', async (req, res) => {
  const userId = String(req.body?.user_id || '')
  if (!userId) return res.status(400).json({ error: 'user_id required' })
  const current = await pool.query('select user_metadata from users where id=$1', [userId])
  if (current.rowCount !== 1) return res.status(404).json({ error: 'user not found' })
  const raw = current.rows[0]?.user_metadata
  const meta = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
  meta.reelone_tier = 'creator'
  meta.reelone_tier_expires = null
  await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), userId])
  res.json({ ok: true, tier: 'creator' })
})

app.post('/__e2e/grant-host', async (req, res) => {
  const userId = String(req.body?.user_id || '')
  if (!userId) return res.status(400).json({ error: 'user_id required' })
  const current = await pool.query('select user_metadata from users where id=$1', [userId])
  if (current.rowCount !== 1) return res.status(404).json({ error: 'user not found' })
  const raw = current.rows[0]?.user_metadata
  const meta = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
  meta.tko_host = true
  await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), userId])
  res.json({ ok: true, host: true })
})

app.post('/__e2e/mark-youtube-connected', async (req, res) => {
  try {
    const userId = String(req.body?.user_id || '')
    if (!userId) return res.status(400).json({ error: 'user_id required' })
    const current = await pool.query('select id from user_youtube_links where user_id=$1 limit 1', [userId])
    if (!current.rows[0]) {
      await pool.query(
        'insert into user_youtube_links (user_id,url,title) values ($1,$2,$3)',
        [userId, `https://www.youtube.com/@e2e-${userId.slice(0, 8)}`, 'E2E linked channel'],
      )
    }
    return res.json({ ok: true })
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'youtube seed failed',
    })
  }
})

app.post('/__e2e/seed-artifact', async (req, res) => {
  try {
    const userId = String(req.body?.user_id || '')
    if (!userId) return res.status(400).json({ error: 'user_id required' })
    const profile = await pool.query('select id from profiles where id=$1', [userId])
    if (profile.rowCount !== 1) return res.status(404).json({ error: 'user not found' })
    const suffix = userId.replace(/-/g, '').slice(0, 10)
    const artifact = await pool.query(
      `insert into artifacts (owner_id,slug,name,rarity,capability,image_url)
       values ($1,$2,'Ember Bot Mark','legendary','forge',$3)
       returning id,name,image_url`,
      [
        userId,
        `ember-bot-${suffix}`,
        'http://localhost:8799/features/forge.jpg',
      ],
    )
    return res.json({ ok: true, artifact: artifact.rows[0] })
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'artifact seed failed',
    })
  }
})

// Read-only proof surface used by Playwright to compare what the browser shows
// with the authoritative backend state. It exists only in this E2E process.
app.get('/__e2e/physical-state', async (_req, res) => {
  const [products, orders, events, earnings] = await Promise.all([
    pool.query('select id,seller_user_id,title,status,shopify_product_gid from physical_merch_products order by created_at'),
    pool.query('select id,buyer_id,status,shopify_order_gid,provider_order_id,dry_run from physical_merch_orders order by created_at'),
    pool.query('select provider,topic,provider_event_id,order_id,status from physical_merch_events order by received_at'),
    pool.query(`
      select e.order_item_id,i.order_id,e.status,e.stripe_transfer_id
      from physical_merch_earnings e
      join physical_merch_order_items i on i.id=e.order_item_id
      order by e.created_at
    `),
  ])
  res.json({
    products: products.rows,
    orders: orders.rows,
    events: events.rows,
    earnings: earnings.rows,
  })
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(__dirname, '..', 'dist')

if (!existsSync(path.join(appDir, 'index.html'))) {
  console.error(`[e2e] dist/index.html missing — build with VITE_BASE_PATH= first (${appDir})`)
  process.exit(1)
}

// version.json must never be cached (PWA update path).
app.get(['/version.json', '/app/version.json'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const vf = path.join(appDir, 'version.json')
  if (existsSync(vf)) return res.sendFile(vf)
  res.json({ buildId: 'e2e' })
})

// The app is built with base '/', so serve it at the root. API stays under /api.
app.use(express.static(appDir, {
  setHeaders(res, filePath) { if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store') },
}))
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' })
  res.setHeader('Cache-Control', 'no-store')
  res.sendFile(path.join(appDir, 'index.html'))
})

const port = Number(process.env.PORT || 8799)
app.listen(port, () => console.log(`[e2e] full-stack server on http://localhost:${port} (real UI + real API + pg-mem)`))
