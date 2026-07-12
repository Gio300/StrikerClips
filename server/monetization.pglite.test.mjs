// ============================================================================
//  monetization.pglite.test.mjs — end-to-end verification of the ad-free
//  entitlement + upload-credit ledger + rewarded-ad flow against REAL Postgres.
//
//  Uses PGlite (Postgres compiled to WASM) so it runs with no Docker/Cloud SQL:
//      npm i -D @electric-sql/pglite
//      node server/monetization.pglite.test.mjs
//
//  It boots the ACTUAL Express handlers from monetization.mjs (not a re-impl)
//  and asserts: free monthly grant + idempotency, rewarded earn + anti-replay +
//  daily cap, atomic fail-closed spend, the ad-free flip + its auth guard, and
//  Stripe webhook HMAC signature verification. Exits non-zero on any failure.
// ============================================================================
import crypto from 'node:crypto'
import express from 'express'
import { PGlite } from '@electric-sql/pglite'

process.env.INTERNAL_ADMIN_SECRET = 'testsecret'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testkey'

const db = await import('./db.mjs')
const { mountMonetization, handleStripeWebhook } = await import('./monetization.mjs')

const pgl = await PGlite.create()
db.__setPool({
  query: (t, p) => pgl.query(t, p),
  connect: async () => ({ query: (t, p) => pgl.query(t, p), release() {} }),
  on() {}, end() { return pgl.close() },
})

await db.bootstrap()
const U = '11111111-1111-1111-1111-111111111111'
await db.query(`insert into public.users (id, email, password_hash) values ($1,'u@test','x') on conflict do nothing`, [U])
await db.query(`insert into public.profiles (id, username) values ($1,'tester') on conflict do nothing`, [U])

const app = express()
app.post('/api/billing/stripe-webhook', express.raw({ type: '*/*' }), handleStripeWebhook)
app.use(express.json())
mountMonetization(app, { getUserId: (req) => req.headers['x-test-user'] || null })
const server = app.listen(0)
await new Promise(r => server.once('listening', r))
const base = `http://127.0.0.1:${server.address().port}`

let pass = 0, fail = 0
const ok = (c, l, got) => c ? (pass++, console.log('  ✓', l)) : (fail++, console.log('  ✗', l, '-', JSON.stringify(got)))
async function req(method, path, { body, headers } = {}) {
  const h = Object.assign({ 'x-test-user': U }, headers || {})
  let payload = body
  if (body && typeof body !== 'string') { h['content-type'] = 'application/json'; payload = JSON.stringify(body) }
  const r = await fetch(base + path, { method, headers: h, body: payload })
  let j = null; try { j = await r.json() } catch {}
  return { status: r.status, j }
}

let e = await req('GET', '/api/entitlement')
ok(e.j.adFree === false && e.j.tier === 'free' && e.j.credits === 10, 'free defaults + monthly grant (10)', e.j)
e = await req('GET', '/api/entitlement')
ok(e.j.credits === 10, 'monthly grant idempotent (still 10)', e.j.credits)

let r = await req('POST', '/api/ads/reward', { body: { token: 't1' } })
ok(r.j.credited === 2 && r.j.balance === 12, 'rewarded +2 -> 12', r.j)
r = await req('POST', '/api/ads/reward', { body: { token: 't1' } })
ok(r.j.duplicate === true && r.j.balance === 12, 'reward replay idempotent', r.j)
for (const t of ['t2', 't3', 't4', 't5']) r = await req('POST', '/api/ads/reward', { body: { token: t } })
ok(r.j.balance === 20 && r.j.rewardRemainingToday === 0, 'daily cap -> 20, remaining 0', r.j)
r = await req('POST', '/api/ads/reward', { body: { token: 't6' } })
ok(r.status === 429 && r.j.credited === 0, 'over cap -> 429', r.j)

let s = await req('POST', '/api/credits/consume', { body: { amount: 5 } })
ok(s.status === 200 && s.j.balance === 15, 'consume 5 -> 15', s.j)
s = await req('POST', '/api/credits/consume', { body: { amount: 1000 } })
ok(s.status === 402, 'overspend -> 402', s.j)

let noauth = await req('POST', '/api/billing/set-entitlement', { headers: { 'x-internal-secret': 'wrong' }, body: { userId: U, adFree: true } })
ok(noauth.status === 403, 'set-entitlement bad secret -> 403', noauth.status)
await req('POST', '/api/billing/set-entitlement', { headers: { 'x-internal-secret': 'testsecret' }, body: { userId: U, adFree: true } })
e = await req('GET', '/api/entitlement')
ok(e.j.adFree === true && e.j.tier === 'pro', 'ad-free flip -> pro', e.j)

const evt = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', metadata: { userId: U } } } })
const sig = (b) => { const t = 1700000000; return `t=${t},v1=${crypto.createHmac('sha256', 'whsec_testkey').update(t + '.' + b).digest('hex')}` }
let wh = await fetch(base + '/api/billing/stripe-webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=bad' }, body: evt })
ok(wh.status === 400, 'webhook bad signature -> 400', wh.status)
wh = await fetch(base + '/api/billing/stripe-webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig(evt) }, body: evt })
ok(wh.status === 200, 'webhook good signature -> 200', wh.status)
e = await req('GET', '/api/entitlement')
ok(e.j.adFree === false, 'subscription.deleted -> adFree false', e.j)

console.log(`\n=== ${pass} passed, ${fail} failed ===`)
server.close(); await pgl.close()
process.exit(fail === 0 ? 0 : 1)
