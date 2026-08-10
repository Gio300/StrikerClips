/**
 * leagueUrlApi — the browser's door to POST /api/fn/league-url-*.
 *
 * Deliberately NOT routed through callFn(): that helper collapses every
 * non-2xx into `null`, and this flow's whole job is to say WHY — "Dynasty
 * unlocks this", "that domain is taken", "we can't see the TXT record yet".
 * So it speaks to the endpoint directly, the way src/lib/payments.ts does, and
 * hands the Studio a state object it can render without branching on HTTP.
 *
 * FAIL-SOFT: an unreachable server yields ok:false with a readable message and
 * a null state — the Studio then falls back to showing the rungs it can derive
 * from the DRAFT (leagueUrls.ts is pure), so the panel is never blank.
 */
import { apiUrl } from './apiBase'
import type { CustomDomainStatus, DomainVerificationRecord, LeagueUrlRung } from './leagueUrls'

const TOKEN_KEY = 'kc_token'

function authHeaders(): Record<string, string> {
  let token: string | null = null
  try { token = localStorage.getItem(TOKEN_KEY) } catch { /* private mode */ }
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export type LeagueUrlRungState = {
  /** The live address, or null when this rung isn't theirs (yet). */
  url: string | null
  entitled: boolean
  /** Tier name to put in the upgrade CTA ("Pro League"). */
  unlocks_with: string
}

export type LeagueUrlState = {
  slug: string
  tier: string
  /** `leagues.plan_status` — a tier only entitles anything once it is PAID. */
  plan_status: string
  rungs: Record<LeagueUrlRung, LeagueUrlRungState>
  custom_domain: string
  custom_domain_status: CustomDomainStatus
  /** The TXT record to publish, while a claim is pending. */
  verification: DomainVerificationRecord | null
  primary: string
}

export type LeagueUrlResult = {
  ok: boolean
  /** Present whenever the server answered at all — even on a refusal. */
  state: LeagueUrlState | null
  error: string
}

async function post(action: string, body: Record<string, unknown>): Promise<LeagueUrlResult> {
  try {
    const res = await fetch(apiUrl(`/fn/league-url-${action}`), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => null)) as (LeagueUrlState & { ok?: boolean; error?: string }) | null
    if (!data) {
      return { ok: false, state: null, error: 'The server didn\'t answer — try again in a moment.' }
    }
    // The handler returns the full state alongside a refusal, so a locked rung
    // still renders its real address list instead of going blank.
    const state = data.slug ? (data as unknown as LeagueUrlState) : null
    return {
      ok: res.ok && data.ok !== false,
      state,
      error: String(data.error ?? (res.ok ? '' : 'Something went wrong.')),
    }
  } catch {
    return { ok: false, state: null, error: "Couldn't reach the server — your draft is safe." }
  }
}

/** Current addresses + any pending domain challenge for a SAVED league. */
export function fetchLeagueUrlState(slug: string): Promise<LeagueUrlResult> {
  return post('status', { slug })
}

/** Claim a custom domain (top plan). Returns the TXT record to publish. */
export function claimLeagueDomain(slug: string, domain: string): Promise<LeagueUrlResult> {
  return post('claim', { slug, rung: 'custom', domain })
}

/** Ask the server to look for the TXT record now. */
export function verifyLeagueDomain(slug: string): Promise<LeagueUrlResult> {
  return post('verify', { slug })
}

/** Give the domain back (frees it for another league). */
export function releaseLeagueDomain(slug: string): Promise<LeagueUrlResult> {
  return post('release', { slug })
}

/**
 * RUNG 3 resolution: which league answers on this hostname?
 *
 * `<slug>.tko.cam` is decidable from the string alone, but a CUSTOM domain is
 * a database fact — `thebiggestleague.com` might belong to the league `blaze`.
 * The SPA boots from a static shell that carries no server state, so it asks.
 *
 * FAIL-SOFT and deliberately secondary: null means "keep whatever the
 * hostname heuristic already guessed" (activeLeagueSlug's first-label rule),
 * which is exactly how shinobistrikerleague.com resolved before this existed.
 */
export async function fetchLeagueSlugForHost(host: string): Promise<string | null> {
  const h = String(host ?? '').trim().toLowerCase()
  if (!h) return null
  try {
    const res = await fetch(apiUrl(`/league/by-host?host=${encodeURIComponent(h)}`))
    if (!res.ok) return null
    const data = (await res.json()) as { slug?: string } | null
    return data?.slug ? String(data.slug) : null
  } catch {
    return null
  }
}
