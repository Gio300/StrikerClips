/**
 * leagueCheckout.ts — the client half of the league-owner purchase path.
 *
 * Mirrors src/lib/payments.ts (the member ladder) deliberately: no client-side
 * Stripe key, no price id ever travels from the browser, and every function
 * returns a discriminated result instead of throwing. The server resolves the
 * price from the plan key, so a caller cannot point a Dynasty checkout at the
 * Starter price.
 *
 * ── THE DEGRADE PATH IS THE POINT ────────────────────────────────────────────
 * Before the operator has created the Stripe products, `startLeagueCheckout()`
 * does NOT fail. The server captures the prospect (email, plan, league name)
 * into `league_leads` and answers `{ lead: true }`, which this surfaces as a
 * distinct result so the UI can say "we've got your details" rather than
 * "something went wrong". A pricing page that 400s on the day you launch is how
 * you lose the first ten customers.
 *
 * SERVER env vars that switch real league checkout on (Cloud Run):
 *   STRIPE_PRICE_LEAGUE_STARTER   $49/mo   price id
 *   STRIPE_PRICE_LEAGUE_PRO       $149/mo  price id
 *   STRIPE_PRICE_LEAGUE_DYNASTY   $399/mo  price id
 * (plus STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / APP_URL, already required
 * by the member ladder — see DEPLOY.md.)
 */

import { apiUrl } from './apiBase'
import type { LeaguePlanId } from './leaguePlans'

const TOKEN_KEY = 'kc_token'

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

// ───────────────────────────────────────────────────────────────────────────
//  Which plans can actually be bought right now?
// ───────────────────────────────────────────────────────────────────────────

export type LeaguePlansConfig = {
  /** STRIPE_SECRET_KEY is set on the server. */
  configured: boolean
  /** plan id -> a Stripe price is configured AND the plan is self-serve. */
  purchasable: Record<string, boolean>
}

export const LEAGUE_PLANS_OFF: LeaguePlansConfig = { configured: false, purchasable: {} }

/**
 * Read the server's league-plan configuration. Never throws — any failure
 * reports "nothing purchasable", which routes every prospect down the
 * lead-capture path instead of a broken checkout button.
 */
export async function fetchLeaguePlansConfig(): Promise<LeaguePlansConfig> {
  try {
    const res = await fetch(apiUrl('/league/plans'), { headers: { Accept: 'application/json' } })
    if (!res.ok) return LEAGUE_PLANS_OFF
    const data = await res.json() as Partial<LeaguePlansConfig> | null
    if (!data || typeof data.configured !== 'boolean') return LEAGUE_PLANS_OFF
    return { configured: data.configured, purchasable: data.purchasable ?? {} }
  } catch {
    return LEAGUE_PLANS_OFF
  }
}

/** Is this specific plan buyable with a card right now? */
export function canBuyLeaguePlan(cfg: LeaguePlansConfig, plan: string): boolean {
  return cfg.purchasable[plan] === true
}

// ───────────────────────────────────────────────────────────────────────────
//  Checkout
// ───────────────────────────────────────────────────────────────────────────

export type LeagueCheckoutResult =
  /** Go to Stripe. */
  | { ok: true; kind: 'checkout'; url: string }
  /** No price configured yet — the prospect was captured instead. */
  | { ok: true; kind: 'lead'; reason: string }
  | { ok: false; error: string }

/**
 * POST /api/league/checkout — reserve the league slug and open a Checkout
 * Session for `plan`.
 *
 * Requires a signed-in caller (the league needs an owner). The plans page sends
 * a signed-out visitor through /signup first, then returns them here.
 */
export async function startLeagueCheckout(input: {
  plan: LeaguePlanId
  leagueName: string
  leagueSlug: string
}): Promise<LeagueCheckoutResult> {
  try {
    const res = await fetch(apiUrl('/league/checkout'), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(input),
    })
    const data = await res.json().catch(() => null) as
      | { url?: string; lead?: boolean; reason?: string; error?: string; detail?: string }
      | null
    if (res.ok && data?.lead) {
      return { ok: true, kind: 'lead', reason: data.reason || 'no_price' }
    }
    if (res.ok && data?.url) return { ok: true, kind: 'checkout', url: data.url }
    return { ok: false, error: data?.detail || data?.error || 'Checkout could not be opened' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Lead capture
// ───────────────────────────────────────────────────────────────────────────

export type LeagueLeadResult = { ok: boolean; error?: string }

/**
 * POST /api/league/lead — record a prospect we cannot charge: Enterprise (no
 * checkout by design), or any plan whose Stripe price is not configured yet.
 *
 * Deliberately works SIGNED OUT. Requiring an account before we will even take
 * an email address loses the lead we are trying to keep.
 */
export async function captureLeagueLead(input: {
  email: string
  plan: LeaguePlanId
  leagueName?: string
  leagueSlug?: string
  note?: string
}): Promise<LeagueLeadResult> {
  try {
    const res = await fetch(apiUrl('/league/lead'), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(input),
    })
    const data = await res.json().catch(() => null) as { ok?: boolean; error?: string; detail?: string } | null
    if (res.ok && data?.ok) return { ok: true }
    return { ok: false, error: data?.detail || data?.error || 'Could not save your details' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}
