/**
 * scripts/stripe-setup.ts — the TKO / KillCam Stripe catalogue bootstrap.
 *
 * Creates the subscription ladder and the one-time Token packs on Stripe using
 * DIRECT REST calls via node's global `fetch` (deliberately NO `stripe` npm
 * dependency, so nothing new lands in package.json / the lockfile).
 *
 * ── IT IS SAFE TO RE-RUN ──────────────────────────────────────────────────
 * This script used to be additive: every run created a duplicate set of
 * products, so a second run silently forked the catalogue. It is now IDEMPOTENT
 * in both directions:
 *
 *   PRODUCTS are created with a DETERMINISTIC ID (`tko_sub_pro`,
 *   `tko_pack_mega`, …). Stripe lets you choose a product id, so we simply GET
 *   it first and reuse it if it exists. No search, no indexing lag.
 *
 *   PRICES carry a deterministic `lookup_key` (`tko_sub_pro`, …) and are found
 *   with `GET /prices?lookup_keys[]=…`, which is exact and immediate. Prices are
 *   immutable in Stripe, so when the amount in this file differs from the live
 *   price we create a NEW price and move the lookup key onto it
 *   (`transfer_lookup_key=true`), leaving the old one in place for existing
 *   subscribers. That is the correct Stripe way to change a price and it is
 *   reported loudly in the output.
 *
 * ── IT NEVER RUNS AUTOMATICALLY ───────────────────────────────────────────
 * Run it by hand, with the secret key supplied through the ENVIRONMENT. The key
 * is never read from a file, never written anywhere, and never printed.
 *
 *   # macOS / Linux
 *   STRIPE_SECRET_KEY=sk_live_xxx npx tsx scripts/stripe-setup.ts
 *
 *   # Windows PowerShell
 *   $env:STRIPE_SECRET_KEY="sk_live_xxx"; npx tsx scripts/stripe-setup.ts
 *
 *   # dry run — show what WOULD be created/changed, touch nothing
 *   STRIPE_SECRET_KEY=sk_test_xxx npx tsx scripts/stripe-setup.ts --dry-run
 *
 * It prints the resulting price ids as env-var lines. Put them in the SERVER
 * environment (Cloud Run / Secret Manager) so /api/checkout can resolve each
 * item — see DEPLOY.md.
 *
 * Start against a TEST key (sk_test_...) and run the whole flow end to end
 * before you ever point this at a live key.
 */

const STRIPE_API = 'https://api.stripe.com/v1'
const KEY = process.env.STRIPE_SECRET_KEY || ''
const DRY_RUN = process.argv.includes('--dry-run')

if (!KEY) {
  console.error('STRIPE_SECRET_KEY is not set — aborting. See the header of this file for usage.')
  process.exit(1)
}

/** Never print the key. Only ever say which MODE it is, which is not a secret. */
const MODE = KEY.startsWith('sk_live_') ? 'LIVE' : KEY.startsWith('sk_test_') ? 'TEST' : 'UNKNOWN'

type StripeResult = { ok: boolean; status: number; json: any }

async function call(
  path: string,
  params?: Record<string, string>,
  method: 'GET' | 'POST' = 'POST',
): Promise<StripeResult> {
  const qs = method === 'GET' && params ? `?${new URLSearchParams(params).toString()}` : ''
  const res = await fetch(`${STRIPE_API}${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'POST' && params ? new URLSearchParams(params).toString() : undefined,
  })
  let json: any = {}
  try { json = await res.json() } catch { json = {} }
  return { ok: res.ok, status: res.status, json }
}

async function post(path: string, params: Record<string, string>): Promise<any> {
  const r = await call(path, params, 'POST')
  if (!r.ok) throw new Error(`POST ${path} failed: ${r.json?.error?.message || r.status}`)
  return r.json
}

// ---------------------------------------------------------------------------
// Idempotent primitives
// ---------------------------------------------------------------------------

/** Fetch a product by its deterministic id, or null when it does not exist. */
async function findProduct(id: string): Promise<any | null> {
  const r = await call(`/products/${encodeURIComponent(id)}`, undefined, 'GET')
  if (r.ok) return r.json
  if (r.status === 404) return null
  throw new Error(`GET /products/${id} failed: ${r.json?.error?.message || r.status}`)
}

/** Fetch the active price carrying this lookup key, or null. */
async function findPrice(lookupKey: string): Promise<any | null> {
  const r = await call('/prices', { 'lookup_keys[0]': lookupKey, active: 'true', limit: '1' }, 'GET')
  if (!r.ok) throw new Error(`GET /prices failed: ${r.json?.error?.message || r.status}`)
  return r.json?.data?.[0] ?? null
}

type Action = 'reused' | 'created' | 'repriced'

/** Create the product only if its deterministic id is not already taken. */
async function ensureProduct(
  id: string, name: string, metadata: Record<string, string>,
): Promise<{ id: string; action: Action }> {
  const existing = await findProduct(id)
  if (existing) return { id: existing.id, action: 'reused' }
  if (DRY_RUN) return { id, action: 'created' }
  const created = await post('/products', {
    id,
    name,
    ...Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`metadata[${k}]`, v])),
  })
  return { id: created.id, action: 'created' }
}

/**
 * Ensure a price with this lookup key exists at exactly `amountCents`.
 *
 * Prices are immutable in Stripe, so a changed amount means a NEW price object;
 * `transfer_lookup_key` moves the key across so this script (and anything else
 * keyed on it) keeps resolving to the current one. Existing subscribers stay on
 * the old price until they are explicitly migrated — which is what you want, and
 * why the change is called out loudly in the output.
 */
async function ensurePrice(
  lookupKey: string,
  productId: string,
  amountCents: number,
  recurringMonthly: boolean,
  metadata: Record<string, string>,
): Promise<{ id: string; action: Action; previous?: string }> {
  const existing = await findPrice(lookupKey)
  if (existing) {
    const sameAmount = Number(existing.unit_amount) === amountCents
    const sameCurrency = String(existing.currency) === 'usd'
    const sameInterval = recurringMonthly
      ? existing.recurring?.interval === 'month'
      : !existing.recurring
    if (sameAmount && sameCurrency && sameInterval) return { id: existing.id, action: 'reused' }
    if (DRY_RUN) return { id: `(new price for ${lookupKey})`, action: 'repriced', previous: existing.id }
    const replacement = await post('/prices', {
      product: productId,
      currency: 'usd',
      unit_amount: String(amountCents),
      lookup_key: lookupKey,
      transfer_lookup_key: 'true',
      ...(recurringMonthly ? { 'recurring[interval]': 'month' } : {}),
      ...Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`metadata[${k}]`, v])),
    })
    return { id: replacement.id, action: 'repriced', previous: existing.id }
  }
  if (DRY_RUN) return { id: `(new price for ${lookupKey})`, action: 'created' }
  const created = await post('/prices', {
    product: productId,
    currency: 'usd',
    unit_amount: String(amountCents),
    lookup_key: lookupKey,
    ...(recurringMonthly ? { 'recurring[interval]': 'month' } : {}),
    ...Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`metadata[${k}]`, v])),
  })
  return { id: created.id, action: 'created' }
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

/**
 * THE SUBSCRIPTION LADDER. `tierKey` must match the app's entitlement keys
 * (src/lib/tiers.ts, src/pages/Upgrade.tsx) and SUBSCRIPTION_TIERS in
 * server/app.ts. `envKey` is what the server reads to resolve the price.
 */
const SUBSCRIPTIONS = [
  // RETIRED 2026-08 — `ad_free` ($1.99/mo, STRIPE_PRICE_AD_FREE) is deliberately
  // ABSENT so re-running this script never re-creates the product or the price.
  //
  // Stripe's flat $0.30 is 15.1 points of an 18.0% total fee at $1.99
  // (2.9% + $0.30 = $0.3577), and any SKU under $4.23 pays Stripe over 10%.
  // $4.99 Pro is now the entry paid tier. See RETIRED_TIERS in server/app.ts
  // for the full note.
  //
  // The tier is still HONOURED everywhere — existing subscribers renew and stay
  // ad-free. This script only stops the SKU being re-listed; it does not and
  // must not archive or delete the live price object, which is the operator's
  // call in the Stripe dashboard.
  { tierKey: 'pro', name: 'TKO Pro', amountCents: 499, envKey: 'STRIPE_PRICE_PRO' },
  { tierKey: 'supporter', name: 'TKO Elite', amountCents: 999, envKey: 'STRIPE_PRICE_SUPPORTER' },
  { tierKey: 'creator', name: 'TKO Legend', amountCents: 2999, envKey: 'STRIPE_PRICE_CREATOR' },
] as const

/**
 * THE TOKEN PACKS — a byte-for-byte mirror of src/lib/tokenPacks.ts and
 * SERVER_TOKEN_PACKS in server/app.ts. If these three ever disagree, the price
 * charged and the Tokens delivered disagree too, so server/app.test.ts asserts
 * the app-side pair are identical and the token counts are printed below for a
 * human to eyeball against the Store page.
 */
const PACKS = [
  { packKey: 'starter', name: 'TKO Tokens — Starter', amountCents: 99, tokens: 100, bonusSweeps: 40, envKey: 'STRIPE_PRICE_PACK_STARTER' },
  { packKey: 'plus', name: 'TKO Tokens — Plus', amountCents: 499, tokens: 550, bonusSweeps: 200, envKey: 'STRIPE_PRICE_PACK_PLUS' },
  { packKey: 'pro', name: 'TKO Tokens — Pro', amountCents: 999, tokens: 1200, bonusSweeps: 400, envKey: 'STRIPE_PRICE_PACK_PRO' },
  { packKey: 'mega', name: 'TKO Tokens — Mega', amountCents: 1999, tokens: 3000, bonusSweeps: 800, envKey: 'STRIPE_PRICE_PACK_MEGA' },
] as const

/**
 * THE LEAGUE-OWNER PLANS — a different product from the subscription ladder
 * above: bought by a league OWNER, not a player. Mirrored from LEAGUE_PLANS in
 * src/lib/leaguePlans.ts, which the app and the server both read; the amounts
 * here and there must agree or we charge for one plan and grant another.
 *
 * The env keys are deliberately in their own namespace. Both ladders contain
 * the key 'pro', so if a league plan resolved through `STRIPE_PRICE_PRO` a
 * league checkout would open against the $4.99 MEMBER price.
 *
 * 'enterprise' is absent on purpose: it has no checkout, it captures a lead.
 */
const LEAGUE_PLANS = [
  { planKey: 'starter', name: 'TKO League — Starter', amountCents: 4900, envKey: 'STRIPE_PRICE_LEAGUE_STARTER' },
  { planKey: 'pro', name: 'TKO League — Pro', amountCents: 14900, envKey: 'STRIPE_PRICE_LEAGUE_PRO' },
  { planKey: 'dynasty', name: 'TKO League — Dynasty', amountCents: 39900, envKey: 'STRIPE_PRICE_LEAGUE_DYNASTY' },
] as const

type Created = { envKey: string; priceId: string; label: string; action: Action; previous?: string }

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

async function main(): Promise<void> {
  console.log(`\nTKO Stripe catalogue bootstrap — ${MODE} key${DRY_RUN ? ' — DRY RUN (nothing will be written)' : ''}`)
  if (MODE === 'LIVE' && !DRY_RUN) {
    console.log('⚠  This is a LIVE key. Real products and prices will be created.')
  }

  const out: Created[] = []

  console.log('\nSubscriptions:')
  for (const s of SUBSCRIPTIONS) {
    const productId = `tko_sub_${s.tierKey}`
    const lookupKey = `tko_sub_${s.tierKey}`
    const product = await ensureProduct(productId, s.name, {
      brand: 'tko', kind: 'subscription', tier: s.tierKey,
    })
    const price = await ensurePrice(lookupKey, product.id, s.amountCents, true, {
      brand: 'tko', tier: s.tierKey,
    })
    console.log(`  ${s.name.padEnd(20)} ${usd(s.amountCents)}/mo   product:${product.action} price:${price.action}`)
    out.push({
      envKey: s.envKey, priceId: price.id, action: price.action, previous: price.previous,
      label: `${s.name} (${usd(s.amountCents)}/mo)`,
    })
  }

  console.log('\nLeague plans (bought by a league OWNER):')
  for (const p of LEAGUE_PLANS) {
    const productId = `tko_league_${p.planKey}`
    const lookupKey = `tko_league_${p.planKey}`
    const product = await ensureProduct(productId, p.name, {
      brand: 'tko', kind: 'league_plan', plan: p.planKey,
    })
    const price = await ensurePrice(lookupKey, product.id, p.amountCents, true, {
      brand: 'tko', league_plan: p.planKey,
    })
    console.log(`  ${p.name.padEnd(24)} ${usd(p.amountCents).padStart(8)}/mo   product:${product.action} price:${price.action}`)
    out.push({
      envKey: p.envKey, priceId: price.id, action: price.action, previous: price.previous,
      label: `${p.name} (${usd(p.amountCents)}/mo)`,
    })
  }

  console.log('\nToken packs:')
  for (const p of PACKS) {
    const productId = `tko_pack_${p.packKey}`
    const lookupKey = `tko_pack_${p.packKey}`
    const product = await ensureProduct(productId, p.name, {
      brand: 'tko', kind: 'token_pack', pack: p.packKey,
      // Informational only — the SERVER re-derives the credited amounts from its
      // own catalogue at fulfilment. Never trusted from metadata.
      tokens: String(p.tokens), bonus_sweeps: String(p.bonusSweeps),
    })
    const price = await ensurePrice(lookupKey, product.id, p.amountCents, false, {
      brand: 'tko', pack: p.packKey,
    })
    console.log(
      `  ${p.name.padEnd(24)} ${usd(p.amountCents).padStart(7)}  ` +
      `-> ${String(p.tokens).padStart(5)} Tokens + ${String(p.bonusSweeps).padStart(3)} Sweeps   ` +
      `product:${product.action} price:${price.action}`,
    )
    out.push({
      envKey: p.envKey, priceId: price.id, action: price.action, previous: price.previous,
      label: `${p.name} (${usd(p.amountCents)} one-time -> ${p.tokens} Tokens + ${p.bonusSweeps} Sweeps)`,
    })
  }

  const repriced = out.filter((o) => o.action === 'repriced')
  if (repriced.length) {
    console.log('\n⚠  PRICE CHANGES — a new Stripe Price was created and the lookup key moved to it.')
    console.log('   Existing subscribers stay on the OLD price until you migrate them deliberately.')
    for (const r of repriced) console.log(`   ${r.envKey}: ${r.previous} -> ${r.priceId}`)
  }

  console.log('\n# ---------------------------------------------------------------')
  console.log('# TKO Stripe price ids — set these in the SERVER environment.')
  console.log('# (Cloud Run: --set-env-vars, or Secret Manager — see DEPLOY.md.)')
  console.log('# ---------------------------------------------------------------\n')
  for (const o of out) console.log(`${o.envKey}=${o.priceId}   # ${o.label}`)

  console.log('\nStill to do by hand:')
  console.log('  1. Set STRIPE_SECRET_KEY on the server (Secret Manager, never in the repo).')
  console.log('  2. Register the webhook endpoint  <APP_URL>/api/stripe/webhook  in the Stripe')
  console.log('     dashboard and set STRIPE_WEBHOOK_SECRET to the whsec_... it gives you.')
  console.log('     Events: checkout.session.completed, customer.subscription.created,')
  console.log('             customer.subscription.updated, customer.subscription.deleted,')
  console.log('             invoice.paid, invoice.payment_failed, account.updated')
  console.log('  3. Set APP_URL (e.g. https://tko.cam/app) for the success/cancel redirects.')
  console.log('  4. Set the price env vars printed above.')
  console.log('\nUntil STRIPE_SECRET_KEY is set the app shows "payments not enabled" and')
  console.log('charges nothing — it never silently grants anything for free.\n')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
