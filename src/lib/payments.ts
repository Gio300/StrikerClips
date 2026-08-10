/**
 * Payments (Stripe) — frontend helper + the env-var contract the OPERATOR must
 * set on the SERVER for real billing to switch on.
 *
 * Until the server has a Stripe secret key, every payments endpoint returns
 * 503 { error: 'stripe_not_configured' } and this helper reports it so the UI
 * can gracefully fall back to the "payments go live" notice. Nothing here needs
 * a client-side Stripe key: checkout runs entirely through our own /api backend.
 *
 * ── SERVER env vars (set on the Express / Cloud Run service, NEVER in the client) ──
 *   STRIPE_SECRET_KEY      sk_live_... (or sk_test_...)  — REQUIRED to turn payments on.
 *   STRIPE_WEBHOOK_SECRET  whsec_...  — verifies POST /api/stripe/webhook signatures.
 *   APP_URL                https://tko.cam — checkout success/cancel + Connect return URLs.
 *   STRIPE_PRICE_AD_FREE / STRIPE_PRICE_PRO / STRIPE_PRICE_SUPPORTER / STRIPE_PRICE_CREATOR
 *                          — monthly subscription price ids.
 *   STRIPE_PRICE_PACK_SMALL / _MEDIUM / _LARGE / _MEGA
 *                          — one-time token-pack price ids.
 *
 * Create the products/prices and print these ids by running (manually):
 *   npx tsx scripts/stripe-setup.ts     (with STRIPE_SECRET_KEY in the env)
 */

import { apiUrl } from './apiBase'

/** Human-readable list of the SERVER secrets that switch payments on. */
export const PAYMENTS_SERVER_ENV = {
  STRIPE_SECRET_KEY: 'sk_live_... — REQUIRED; enables checkout, webhook and Connect',
  STRIPE_WEBHOOK_SECRET: 'whsec_... — verifies POST /api/stripe/webhook signatures',
  APP_URL: 'https://tko.cam/app — checkout + Connect return URLs',
} as const

const TOKEN_KEY = 'kc_token'

/** The bearer token the realSupabase shim stores at sign-in. */
function authToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

function authHeaders(): Record<string, string> {
  const token = authToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  IS BILLING ON?  — GET /api/payments/config
//
//  The Store and the Upgrade page ask this BEFORE showing a purchase button, so
//  the UI has exactly two honest states: a working checkout, or a visible
//  "payments aren't enabled yet" notice. There is deliberately no third state
//  where a button appears to work and silently credits something for free.
//
//  The response contains no secrets — only booleans saying which prices the
//  operator has actually configured on the server.
// ─────────────────────────────────────────────────────────────────────────

export type PaymentsConfig = {
  /** STRIPE_SECRET_KEY is set on the server. */
  configured: boolean
  /** tier key -> a Stripe price id is configured for it */
  tiers: Record<string, boolean>
  /** pack id -> a Stripe price id is configured for it */
  packs: Record<string, boolean>
  /** Length of the Stripe-managed free trial, in days. */
  trialDays: number
}

export const PAYMENTS_OFF: PaymentsConfig = {
  configured: false, tiers: {}, packs: {}, trialDays: 7,
}

/**
 * Read the server's payment configuration. Never throws — any failure reports
 * "not configured", which is the safe direction: the UI hides purchase buttons
 * rather than showing ones that cannot work.
 */
export async function fetchPaymentsConfig(): Promise<PaymentsConfig> {
  try {
    const res = await fetch(apiUrl('/payments/config'), { headers: { Accept: 'application/json' } })
    if (!res.ok) return PAYMENTS_OFF
    const data = await res.json() as Partial<PaymentsConfig> | null
    if (!data || typeof data.configured !== 'boolean') return PAYMENTS_OFF
    return {
      configured: data.configured,
      tiers: data.tiers ?? {},
      packs: data.packs ?? {},
      trialDays: typeof data.trialDays === 'number' ? data.trialDays : 7,
    }
  } catch {
    return PAYMENTS_OFF
  }
}

/** Is this specific tier purchasable right now? */
export function canBuyTier(cfg: PaymentsConfig, tier: string): boolean {
  return cfg.configured && cfg.tiers[tier] === true
}

/** Is this specific token pack purchasable right now? */
export function canBuyPack(cfg: PaymentsConfig, pack: string): boolean {
  return cfg.configured && cfg.packs[pack] === true
}

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; notConfigured: true }
  | { ok: false; notConfigured: false; error: string }

/**
 * POST /api/checkout with the caller's JWT (from localStorage, same key the
 * realSupabase shim uses). Returns a discriminated result and never throws.
 *
 * `trialDays` asks Stripe for a managed free trial: the card is collected now,
 * nothing is charged for N days, and Stripe auto-charges on day N. That is what
 * makes a trial conversion a REAL charge rather than a simulated one.
 *
 * Note there is no `priceId` any more — the server resolves the price from the
 * tier/pack key. Accepting one from the client would let a caller point a
 * subscription checkout at the $0.99 pack price.
 */
export async function requestCheckout(
  payload: { tier?: string; pack?: string; trialDays?: number },
): Promise<CheckoutResult> {
  try {
    const res = await fetch(apiUrl('/checkout'), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    })
    if (res.status === 503) return { ok: false, notConfigured: true }
    const data = await res.json().catch(() => null as { url?: string; error?: string; detail?: string } | null)
    if (res.ok && data?.url) return { ok: true, url: data.url }
    if (data?.error === 'stripe_not_configured') return { ok: false, notConfigured: true }
    return { ok: false, notConfigured: false, error: data?.detail || data?.error || 'Checkout failed' }
  } catch (e) {
    return { ok: false, notConfigured: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  SELF-SERVE CANCELLATION — Stripe's hosted Customer Portal.
//
//  Cancelling has to be as easy as subscribing (FTC negative-option rule; CA,
//  NY and other state auto-renewal statutes). Subscribing is two clicks in the
//  app, so cancelling is one button that opens the portal — where Stripe itself
//  handles the cancel, the card swap and the invoice history, and tells our
//  webhook about it so the tier actually lapses.
//
//  `no_customer` is a NORMAL answer, not a failure: a free account, a redeem
//  code or a founder pass never created a Stripe customer and has nothing to
//  manage. The UI says so plainly instead of showing an error.
// ─────────────────────────────────────────────────────────────────────────

export type PortalResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'not_configured' | 'no_customer' | 'error'; message: string }

/** Copy for each non-success outcome. Pure, so the wording is unit-testable. */
export const PORTAL_MESSAGES = {
  not_configured: 'Billing is not enabled on this deploy, so there is no subscription to manage.',
  no_customer: 'You have no paid subscription on this account, so there is nothing to cancel.',
  error: 'Could not open the billing portal. Please try again.',
} as const

type PortalPayload = { ok?: boolean; url?: string; error?: string; detail?: string } | null

/**
 * Interpret the server's reply to POST /api/billing/portal. Pure — split out so
 * every branch (including the ones that need a live Stripe) is testable.
 */
export function parsePortalResponse(status: number, data: PortalPayload): PortalResult {
  if (data?.ok === true && data.url) return { ok: true, url: data.url }
  if (status === 503 || data?.error === 'stripe_not_configured') {
    return { ok: false, reason: 'not_configured', message: PORTAL_MESSAGES.not_configured }
  }
  if (data?.error === 'no_customer') {
    return { ok: false, reason: 'no_customer', message: PORTAL_MESSAGES.no_customer }
  }
  return { ok: false, reason: 'error', message: data?.detail || data?.error || PORTAL_MESSAGES.error }
}

/**
 * Ask the server for a Stripe Customer Portal URL. Never throws.
 *
 * `returnTo` is the in-app path Stripe sends the user back to; the server
 * clamps it to a same-site path, so a caller cannot turn it into a redirect.
 */
export async function requestBillingPortal(
  input: { returnTo?: string } = {},
): Promise<PortalResult> {
  try {
    const res = await fetch(apiUrl('/billing/portal'), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ returnTo: input.returnTo ?? '/upgrade' }),
    })
    const data = await res.json().catch(() => null) as PortalPayload
    return parsePortalResponse(res.status, data)
  } catch (e) {
    return {
      ok: false,
      reason: 'error',
      message: e instanceof Error ? e.message : PORTAL_MESSAGES.error,
    }
  }
}

/** What the server knows about the caller's subscription right now. */
export type BillingSubscription = {
  configured: boolean
  hasBillingAccount: boolean
  tier: string
  tierExpiresAt: string | null
  subscription: {
    id: string
    status: string
    tier: string
    cancelAtPeriodEnd: boolean
    currentPeriodEnd: string | null
  } | null
}

export const BILLING_UNKNOWN: BillingSubscription = {
  configured: false, hasBillingAccount: false, tier: '', tierExpiresAt: null, subscription: null,
}

/**
 * GET /api/billing/subscription. Never throws — any failure reports "no billing
 * account", which hides the manage button rather than showing one that cannot
 * work.
 */
export async function fetchBillingSubscription(): Promise<BillingSubscription> {
  try {
    const res = await fetch(apiUrl('/billing/subscription'), { headers: authHeaders() })
    if (!res.ok) return BILLING_UNKNOWN
    const data = await res.json().catch(() => null) as Partial<BillingSubscription> | null
    if (!data || typeof data.configured !== 'boolean') return BILLING_UNKNOWN
    return {
      configured: data.configured,
      hasBillingAccount: data.hasBillingAccount === true,
      tier: typeof data.tier === 'string' ? data.tier : '',
      tierExpiresAt: typeof data.tierExpiresAt === 'string' ? data.tierExpiresAt : null,
      subscription: data.subscription ?? null,
    }
  } catch {
    return BILLING_UNKNOWN
  }
}

/** Display names for the tier keys. Mirrors LEVEL_TIER_NAME / trialTierName. */
export const TIER_LABELS: Record<string, string> = {
  ad_free: 'Ad-Free',
  pro: 'Pro',
  supporter: 'Elite',
  creator: 'Legend',
}

/** Human name for a tier key; '' (free) and anything unknown read as "Free". */
export function tierLabel(tier: string | null | undefined): string {
  return TIER_LABELS[String(tier ?? '')] ?? 'Free'
}

/**
 * One plain-English line about what happens next, for the manage-subscription
 * panel. Pure.
 *
 * The distinction that matters legally: a subscription that has been cancelled
 * ENDS on the period end and must not be described as "renews on" — that is the
 * exact wording an auto-renewal regulator reads.
 */
export function describeRenewal(
  billing: Pick<BillingSubscription, 'subscription' | 'tierExpiresAt'>,
  fmt: (iso: string) => string = (iso) => new Date(iso).toLocaleDateString(),
): string {
  const sub = billing.subscription
  const when = sub?.currentPeriodEnd || billing.tierExpiresAt || ''
  const date = when ? fmt(when) : ''
  if (sub) {
    if (sub.cancelAtPeriodEnd) {
      return date ? `Cancelled — access ends ${date}.` : 'Cancelled — access ends at the end of this billing period.'
    }
    if (sub.status === 'trialing') {
      return date ? `Free trial — first charge ${date}.` : 'Free trial running.'
    }
    if (sub.status === 'past_due' || sub.status === 'unpaid') {
      return 'Payment failed — update your card to keep this plan.'
    }
    if (sub.status === 'canceled') {
      return date ? `Cancelled — access ended ${date}.` : 'Cancelled.'
    }
    return date ? `Renews ${date}.` : 'Renews monthly.'
  }
  return date ? `Access runs to ${date}.` : ''
}

// ─────────────────────────────────────────────────────────────────────────
//  TRIAL → PAID CONVERSION.
//
//  There are two trial mechanisms, and the difference matters:
//
//  1. PREFERRED — a STRIPE-MANAGED trial. `startTrialCheckout()` opens a normal
//     Checkout Session with `trial_period_days`, so Stripe collects the card up
//     front, charges nothing for 7 days, and then AUTO-CHARGES on day 7 with no
//     involvement from us at all. The subscription lifecycle webhooks grant the
//     tier while it is `trialing`/`active` and lapse it the moment a renewal
//     fails. Nothing can go wrong here that leaves someone on a paid tier for
//     free, because Stripe owns the whole state machine.
//
//  2. LEGACY — trials started before (1) existed, recorded in user_metadata by
//     src/lib/trial.ts. Those have no Stripe subscription. `chargeTrialConversion`
//     converts one by asking the server to create a real subscription against
//     the card already on the user's Stripe customer.
//
//  BOTH FAIL CLOSED. If Stripe is not configured, if the user has no customer
//  record, if no card is on file, or if the card declines, the result is
//  `{ ok: false }` — and Upgrade.tsx then EXPIRES the trial instead of
//  converting it. A paid entitlement is only ever written on the back of a
//  charge that actually happened.
//
//  The one exception is an explicit DEV opt-in (VITE_SIMULATE_TRIAL_CHARGE=1) so
//  the trial state machine can be exercised locally. It is inert in any build
//  that does not set it, and `simulated` is carried through the result so
//  callers can always tell a real charge from a fake one.
// ─────────────────────────────────────────────────────────────────────────

export type TrialChargeResult = { ok: boolean; simulated: boolean; error?: string }

/** Dev-only escape hatch; never set in a production build. */
export function trialChargeSimulationEnabled(
  env: Record<string, string | undefined> | undefined = (import.meta as unknown as { env?: Record<string, string> }).env,
): boolean {
  return env?.VITE_SIMULATE_TRIAL_CHARGE === '1'
}

/**
 * Start a 7-day free trial as a real Stripe subscription: card collected by
 * Stripe now, first charge on day 7, cancellable from the customer portal.
 *
 * This replaces the old "I'll add a card" checkbox, which collected nothing and
 * therefore converted every trial into a permanently free paid tier.
 */
export async function startTrialCheckout(
  input: { tier: string; trialDays?: number },
): Promise<CheckoutResult> {
  return requestCheckout({ tier: input.tier, trialDays: input.trialDays ?? 7 })
}

/**
 * Convert a LEGACY (metadata-only) trial into a paid subscription by charging
 * the card on file, via POST /api/trial/convert.
 *
 * Returns `{ ok: false }` whenever a real charge did not happen — including
 * when billing is switched off entirely (503) — so a caller can never grant a
 * paid entitlement for a payment that did not occur.
 */
export async function chargeTrialConversion(
  input: { tier: string },
): Promise<TrialChargeResult> {
  if (trialChargeSimulationEnabled()) return { ok: true, simulated: true }
  try {
    const res = await fetch(apiUrl('/trial/convert'), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ tier: input.tier }),
    })
    if (res.status === 503) {
      return { ok: false, simulated: false, error: 'billing_not_live: payments are not enabled on this deploy' }
    }
    const data = await res.json().catch(() => null as { ok?: boolean; error?: string; detail?: string } | null)
    if (res.ok && data?.ok === true) return { ok: true, simulated: false }
    return {
      ok: false,
      simulated: false,
      error: data?.detail || data?.error || 'the trial conversion charge did not go through',
    }
  } catch (e) {
    return { ok: false, simulated: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}
