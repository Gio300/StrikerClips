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
  const meta = current.rows[0]?.user_metadata || {}
  meta.reelone_tier = 'creator'
  meta.reelone_tier_expires = null
  await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(meta), userId])
  res.json({ ok: true, tier: 'creator' })
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
