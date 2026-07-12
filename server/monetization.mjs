// ============================================================================
//  server/monetization.mjs — KillCam ad-free entitlement + upload-credit ledger
//
//  This is the SERVER-SIDE source of truth for monetization. The client never
//  decides whether a user sees ads or how many credits they have — it only
//  reads these endpoints and reflects the answer.
//
//  Model
//  ─────
//   • Free tier: FREE_MONTHLY_CREDITS upload credits granted once per calendar
//     month (lazy refill — no cron needed), each upload costs UPLOAD_COST.
//   • Watch-to-earn: a completed rewarded-ad view grants REWARD_CREDITS, capped
//     at REWARD_DAILY_CAP credits/day. Idempotent per reward token (anti-replay).
//   • Pro tier (ad_free): ads are suppressed AND a larger monthly grant lands.
//     ad_free is flipped ONLY by the Stripe webhook or the internal setter.
//
//  Endpoints (all JSON, same-origin):
//   GET  /api/entitlement                → { adFree, tier, credits, limits, rewardRemainingToday }
//   GET  /api/credits                    → { balance, ledger[] }
//   POST /api/credits/consume {amount,ref}→ spend for an upload (402 if short)
//   POST /api/ads/reward {token,provider}→ grant watch-to-earn credits (429 at cap)
//   POST /api/billing/stripe-webhook     → (raw body, HMAC-verified) flip ad_free
//   POST /api/billing/set-entitlement    → internal S2S setter (x-internal-secret)
// ============================================================================

import crypto from 'node:crypto'
import { pool, query } from './db.mjs'

// ── Tunables (env-overridable) ──────────────────────────────────────────────
const FREE_MONTHLY_CREDITS = int(process.env.KC_FREE_MONTHLY_CREDITS, 10)
const PRO_MONTHLY_CREDITS  = int(process.env.KC_PRO_MONTHLY_CREDITS, 500)
const REWARD_CREDITS       = int(process.env.KC_REWARD_CREDITS, 2)      // per completed view
const REWARD_DAILY_CAP     = int(process.env.KC_REWARD_DAILY_CAP, 10)   // max earned credits/day
const UPLOAD_COST          = int(process.env.KC_UPLOAD_COST, 1)         // credits per upload

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ''
const INTERNAL_ADMIN_SECRET = process.env.INTERNAL_ADMIN_SECRET || ''

function int(v, dflt) { var n = parseInt(v, 10); return Number.isFinite(n) ? n : dflt }
function thisMonth() { const d = new Date(); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') }

// ── Row bootstrapping + lazy monthly refill (inside a caller's transaction) ──
async function ensureAndRefill(client, userId) {
  // entitlement row
  const ent = await client.query(
    `insert into public.entitlements (user_id) values ($1)
       on conflict (user_id) do update set user_id = excluded.user_id
     returning ad_free, tier`,
    [userId],
  )
  const tier = ent.rows[0].tier
  const adFree = ent.rows[0].ad_free

  // credits row (locked for the rest of the txn)
  await client.query(
    `insert into public.upload_credits (user_id, balance, last_refill_month)
       values ($1, 0, null) on conflict (user_id) do nothing`,
    [userId],
  )
  const cur = await client.query(
    'select balance, last_refill_month from public.upload_credits where user_id = $1 for update',
    [userId],
  )
  let balance = cur.rows[0].balance
  const month = thisMonth()

  if (cur.rows[0].last_refill_month !== month) {
    const grant = tier === 'pro' ? PRO_MONTHLY_CREDITS : FREE_MONTHLY_CREDITS
    balance += grant
    await client.query(
      'update public.upload_credits set balance = $2, last_refill_month = $3, updated_at = now() where user_id = $1',
      [userId, balance, month],
    )
    await client.query(
      `insert into public.credit_ledger (user_id, delta, balance_after, reason, ref)
         values ($1, $2, $3, 'monthly_grant', $4)`,
      [userId, grant, balance, month],
    )
  }
  return { adFree, tier, balance }
}

// How many rewarded credits has this user already earned today (UTC)?
async function rewardedToday(client, userId) {
  const { rows } = await client.query(
    `select coalesce(sum(delta), 0)::int as earned
       from public.credit_ledger
      where user_id = $1 and reason = 'rewarded_ad'
        and created_at >= date_trunc('day', now() at time zone 'utc')`,
    [userId],
  )
  return rows[0].earned
}

const LIMITS = {
  uploadCost: UPLOAD_COST,
  freeMonthly: FREE_MONTHLY_CREDITS,
  proMonthly: PRO_MONTHLY_CREDITS,
  rewardCredits: REWARD_CREDITS,
  rewardDailyCap: REWARD_DAILY_CAP,
}

/**
 * Mount the JSON monetization routes. `getUserId(req)` verifies the caller's JWT
 * (shared with index.mjs so there is one auth path).
 */
export function mountMonetization(app, { getUserId }) {
  // ── entitlement: the endpoint ads.js reads to decide whether to show ads ──
  // Anonymous callers get a clean { adFree:false } (200) so public pages work.
  app.get('/api/entitlement', async (req, res) => {
    const userId = getUserId(req)
    if (!userId) {
      return res.json({ adFree: false, tier: 'anon', credits: 0, limits: LIMITS, rewardRemainingToday: 0 })
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { adFree, tier, balance } = await ensureAndRefill(client, userId)
      const earned = await rewardedToday(client, userId)
      await client.query('COMMIT')
      return res.json({
        adFree, tier, credits: balance, limits: LIMITS,
        rewardRemainingToday: Math.max(0, REWARD_DAILY_CAP - earned),
      })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.error('[entitlement]', err.message)
      return res.status(500).json({ error: 'entitlement lookup failed' })
    } finally {
      client.release()
    }
  })

  // ── credits: balance + recent ledger ──
  app.get('/api/credits', async (req, res) => {
    const userId = getUserId(req)
    if (!userId) return res.status(401).json({ error: 'not authenticated' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { balance } = await ensureAndRefill(client, userId)
      await client.query('COMMIT')
      const led = await query(
        `select delta, balance_after, reason, ref, created_at
           from public.credit_ledger where user_id = $1
          order by created_at desc limit 20`,
        [userId],
      )
      return res.json({ balance, ledger: led.rows })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.error('[credits]', err.message)
      return res.status(500).json({ error: 'credits lookup failed' })
    } finally {
      client.release()
    }
  })

  // ── consume: spend credits for an upload (atomic, fails closed if short) ──
  app.post('/api/credits/consume', async (req, res) => {
    const userId = getUserId(req)
    if (!userId) return res.status(401).json({ error: 'not authenticated' })
    const amount = Math.max(1, int((req.body || {}).amount, UPLOAD_COST))
    const ref = (req.body || {}).ref || null
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { adFree, tier, balance } = await ensureAndRefill(client, userId)
      if (balance < amount) {
        await client.query('ROLLBACK')
        return res.status(402).json({
          error: 'insufficient_credits', balance, needed: amount,
          hint: 'watch a rewarded ad to earn more, or upgrade to remove limits',
        })
      }
      const next = balance - amount
      await client.query(
        'update public.upload_credits set balance = $2, updated_at = now() where user_id = $1',
        [userId, next],
      )
      await client.query(
        `insert into public.credit_ledger (user_id, delta, balance_after, reason, ref)
           values ($1, $2, $3, 'upload', $4)`,
        [userId, -amount, next, ref],
      )
      await client.query('COMMIT')
      return res.json({ ok: true, balance: next, adFree, tier })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.error('[consume]', err.message)
      return res.status(500).json({ error: 'consume failed' })
    } finally {
      client.release()
    }
  })

  // ── reward: grant watch-to-earn credits for a completed rewarded-ad view ──
  //  `token` must be unique per completed view (server- or SDK-issued). Replays
  //  are idempotent (no double credit). Enforces the daily earn cap.
  app.post('/api/ads/reward', async (req, res) => {
    const userId = getUserId(req)
    if (!userId) return res.status(401).json({ error: 'not authenticated' })
    const body = req.body || {}
    const token = String(body.token || '').trim()
    const provider = String(body.provider || 'house').slice(0, 32)
    if (!token) return res.status(400).json({ error: 'reward token required' })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { balance } = await ensureAndRefill(client, userId)

      // anti-replay: only the FIRST insert of (provider, token) proceeds
      const claim = await client.query(
        `insert into public.ad_rewards (user_id, provider, reward_token, credited)
           values ($1, $2, $3, false)
           on conflict (provider, reward_token) do nothing
         returning id`,
        [userId, provider, token],
      )
      if (claim.rows.length === 0) {
        await client.query('ROLLBACK')
        return res.status(200).json({ ok: true, duplicate: true, balance,
          credited: 0, message: 'reward already granted' })
      }

      const earned = await rewardedToday(client, userId)
      if (earned >= REWARD_DAILY_CAP) {
        // Keep the claim row (marks the view) but grant nothing today.
        await client.query('COMMIT')
        return res.status(429).json({ ok: false, reason: 'daily_cap_reached',
          balance, credited: 0, rewardRemainingToday: 0 })
      }
      const grant = Math.min(REWARD_CREDITS, REWARD_DAILY_CAP - earned)
      const next = balance + grant
      await client.query('update public.upload_credits set balance = $2, updated_at = now() where user_id = $1', [userId, next])
      await client.query('update public.ad_rewards set credited = true where id = $1', [claim.rows[0].id])
      await client.query(
        `insert into public.credit_ledger (user_id, delta, balance_after, reason, ref)
           values ($1, $2, $3, 'rewarded_ad', $4)`,
        [userId, grant, next, provider + ':' + token.slice(0, 40)],
      )
      await client.query('COMMIT')
      return res.json({ ok: true, credited: grant, balance: next,
        rewardRemainingToday: Math.max(0, REWARD_DAILY_CAP - (earned + grant)) })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.error('[reward]', err.message)
      return res.status(500).json({ error: 'reward failed' })
    } finally {
      client.release()
    }
  })

  // ── internal server-to-server entitlement setter ──
  //  Lets the Stripe-pricing service flip ad_free without the webhook path.
  //  Guarded by a shared secret; refuses if INTERNAL_ADMIN_SECRET is unset.
  app.post('/api/billing/set-entitlement', async (req, res) => {
    if (!INTERNAL_ADMIN_SECRET || req.headers['x-internal-secret'] !== INTERNAL_ADMIN_SECRET) {
      return res.status(403).json({ error: 'forbidden' })
    }
    const b = req.body || {}
    if (!b.userId) return res.status(400).json({ error: 'userId required' })
    try {
      await setEntitlement({
        userId: b.userId,
        adFree: b.adFree === true,
        tier: b.adFree === true ? 'pro' : 'free',
        source: b.source || 'manual',
        stripeCustomerId: b.stripeCustomerId,
        stripeSubscriptionId: b.stripeSubscriptionId,
        currentPeriodEnd: b.currentPeriodEnd,
      })
      return res.json({ ok: true })
    } catch (err) {
      console.error('[set-entitlement]', err.message)
      return res.status(500).json({ error: 'set failed' })
    }
  })
}

// ── Stripe webhook (mounted separately in index.mjs with a RAW body) ─────────
//  We verify the `Stripe-Signature` header with HMAC-SHA256 (Node crypto) so we
//  don't need the stripe npm package. Only signature-valid events flip ad_free.
export async function handleStripeWebhook(req, res) {
  const raw = req.rawBody || req.body // Buffer when mounted with express.raw()
  const sig = req.headers['stripe-signature']
  if (!STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: 'webhook not configured' })
  if (!verifyStripeSignature(raw, sig, STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: 'invalid signature' })
  }
  let event
  try { event = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)) }
  catch { return res.status(400).json({ error: 'bad payload' }) }

  try {
    const obj = (event.data && event.data.object) || {}
    // KillCam links a Stripe customer/subscription to a user via metadata.userId
    // (set when the Checkout Session / subscription is created by the Stripe svc).
    const userId = (obj.metadata && obj.metadata.userId) ||
      (obj.subscription_details && obj.subscription_details.metadata && obj.subscription_details.metadata.userId) || null

    switch (event.type) {
      case 'checkout.session.completed':
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const active = obj.status ? ['active', 'trialing', 'complete', 'paid'].includes(obj.status) || obj.payment_status === 'paid'
          : true
        if (userId) {
          await setEntitlement({
            userId, adFree: active, tier: active ? 'pro' : 'free', source: 'stripe',
            stripeCustomerId: obj.customer, stripeSubscriptionId: obj.subscription || obj.id,
            currentPeriodEnd: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null,
          })
        }
        break
      }
      case 'customer.subscription.deleted': {
        // Look up by subscription id if metadata is absent on the cancel event.
        if (userId) await setEntitlement({ userId, adFree: false, tier: 'free', source: 'stripe', stripeSubscriptionId: obj.id })
        else if (obj.id) await query(
          `update public.entitlements set ad_free = false, tier = 'free', updated_at = now()
             where stripe_subscription_id = $1`, [obj.id])
        break
      }
      default: /* ignore other events */ break
    }
    return res.json({ received: true })
  } catch (err) {
    console.error('[stripe-webhook]', err.message)
    return res.status(500).json({ error: 'handler failed' })
  }
}

// Verify Stripe's `t=…,v1=…` signature header against the raw body.
function verifyStripeSignature(raw, header, secret) {
  try {
    if (!raw || !header) return false
    const parts = String(header).split(',').reduce((acc, kv) => {
      const [k, v] = kv.split('='); acc[k] = acc[k] || v; return acc
    }, {})
    const t = parts.t, v1 = parts.v1
    if (!t || !v1) return false
    const payload = (Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw))
    const signed = t + '.' + payload
    const expected = crypto.createHmac('sha256', secret).update(signed, 'utf8').digest('hex')
    const a = Buffer.from(expected), b = Buffer.from(v1)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch { return false }
}

// Upsert the entitlement row. Called by the webhook + the internal setter.
export async function setEntitlement(e) {
  await query(
    `insert into public.entitlements
       (user_id, ad_free, tier, source, stripe_customer_id, stripe_subscription_id, current_period_end, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7, now())
     on conflict (user_id) do update set
       ad_free = excluded.ad_free,
       tier    = excluded.tier,
       source  = coalesce(excluded.source, public.entitlements.source),
       stripe_customer_id     = coalesce(excluded.stripe_customer_id, public.entitlements.stripe_customer_id),
       stripe_subscription_id = coalesce(excluded.stripe_subscription_id, public.entitlements.stripe_subscription_id),
       current_period_end     = coalesce(excluded.current_period_end, public.entitlements.current_period_end),
       updated_at = now()`,
    [e.userId, e.adFree === true, e.tier || (e.adFree ? 'pro' : 'free'), e.source || null,
     e.stripeCustomerId || null, e.stripeSubscriptionId || null, e.currentPeriodEnd || null],
  )
}

export default { mountMonetization, handleStripeWebhook, setEntitlement }
