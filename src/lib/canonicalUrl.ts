/**
 * canonicalUrl — build PUBLIC share URLs.
 *
 * The installed app (Capacitor APK, PWA, dev server) runs on a private origin —
 * `https://localhost`, `capacitor://localhost`, `http://127.0.0.1:5173` — so a
 * share link built from `window.location.origin` is dead on arrival for the
 * recipient (operator 2026-08-02: sharing a tournament produced
 * `https://localhost/tournaments/<id>?chat=1`).
 *
 * Rules:
 *   1. If the current origin is PUBLIC (a real https/http host on the internet:
 *      tko.cam, a league's own domain like shinobistrikerleague.com, an
 *      *.amplifyapp.com preview) → keep it, plus the bundle's own base path
 *      (BASE_URL is '/app/' on the hosted web deploy, '/' on mobile + league
 *      domains). Running ON a league domain therefore keeps that league's
 *      public domain in the link.
 *   2. Otherwise (localhost / 127.0.0.1 / LAN IPs / capacitor: / ionic: /
 *      file: / bare hostnames) → fall back to the canonical app origin
 *      `https://tko.cam` + the canonical web app base `/app`, where the SPA is
 *      mounted for the public (see DEPLOY.md "marketing at `/`, app at `/app`").
 *
 * Every share-link construction site must route through these helpers — never
 * through `window.location.origin`/`href` directly.
 *
 * LEAGUE PATH RUNG (operator 2026-08-04): a league's cheapest address is a
 * PATH — `https://tko.cam/<slug>` (see src/lib/leagueUrls.ts). A link built
 * from INSIDE that takeover must keep the prefix, or sharing a tournament from
 * `tko.cam/shinobistrikerleague` hands the recipient a bare TKO-skinned page
 * and quietly undoes the league's whole address. So every URL built here
 * carries `leaguePathPrefix()` — which is '' everywhere else, because on bare
 * tko.cam, on a `<slug>.tko.cam` subdomain, on a league's own domain and in
 * the mobile app the HOST already carries the identity.
 */

import { leaguePathPrefix } from './leagueUrls'

export const CANONICAL_ORIGIN = 'https://tko.cam'
export const CANONICAL_APP_BASE = '/app'

/** Minimal location shape so tests can inject values without a DOM. */
export type ShareLocationLike = {
  protocol: string
  hostname: string
  origin: string
}

const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

/** Is `protocol//hostname` an origin a stranger's device can actually reach? */
export function isPublicOrigin(protocol: string, hostname: string): boolean {
  const proto = String(protocol || '').replace(/:$/, '').toLowerCase()
  // capacitor://, ionic://, file:// and anything non-http(s) is app-internal.
  if (proto !== 'http' && proto !== 'https') return false
  const host = String(hostname || '').toLowerCase()
  if (!host || PRIVATE_HOSTS.has(host)) return false
  if (host.endsWith('.localhost') || host.endsWith('.local')) return false
  // Private / link-local IPv4 ranges (dev boxes, phones on the same wifi).
  if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false
  // A bare single-label hostname ("desktop-abc") is not publicly resolvable.
  if (!host.includes('.')) return false
  return true
}

function currentLocation(): ShareLocationLike | null {
  if (typeof window === 'undefined' || !window.location) return null
  const { protocol, hostname, origin } = window.location
  return { protocol, hostname, origin }
}

/** Normalize a Vite base path ('/app/' → '/app', '/' → ''). */
function normalizeBase(basePath: string): string {
  const trimmed = String(basePath ?? '/').replace(/\/+$/, '')
  if (!trimmed || trimmed === '/') return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/**
 * The public origin + app base path share links should be built on.
 * E.g. 'https://tko.cam/app' or 'https://shinobistrikerleague.com'.
 */
export function shareOrigin(
  loc: ShareLocationLike | null = currentLocation(),
  basePath: string = (import.meta.env?.BASE_URL as string | undefined) ?? '/',
): string {
  if (loc && isPublicOrigin(loc.protocol, loc.hostname)) {
    return `${loc.origin}${normalizeBase(basePath)}`
  }
  return `${CANONICAL_ORIGIN}${CANONICAL_APP_BASE}`
}

/**
 * Build a public share URL for an APP ROUTE (router path, e.g.
 * `/tournaments/<id>?chat=1`). The route is the path the SPA's router sees —
 * WITHOUT any '/app' base and WITHOUT the league path prefix; both are added
 * here when needed, which is exactly what the router's basename strips off on
 * the way in. So every existing caller keeps passing plain app routes and
 * automatically produces league-correct links inside a path takeover.
 */
export function canonicalShareUrl(
  routePath: string,
  loc?: ShareLocationLike | null,
  basePath?: string,
  /** League path prefix ('/shinobistrikerleague'); injectable for tests. */
  leaguePath: string = leaguePathPrefix(),
): string {
  const p = routePath.startsWith('/') ? routePath : `/${routePath}`
  const origin = shareOrigin(
    loc ?? currentLocation(),
    basePath ?? ((import.meta.env?.BASE_URL as string | undefined) ?? '/'),
  )
  return `${origin}${leaguePath}${p}`
}

/**
 * Canonicalize the CURRENT page URL for sharing: strip the bundle's base path
 * AND the league path prefix off the current pathname to recover the app
 * route, then rebuild both on the public share origin. Keeps query + hash.
 */
export function canonicalCurrentUrl(): string {
  if (typeof window === 'undefined' || !window.location) {
    return `${CANONICAL_ORIGIN}${CANONICAL_APP_BASE}/`
  }
  const { pathname, search, hash } = window.location
  // The router's basename = bundle base + league prefix, so the same pair is
  // what has to come off here for canonicalShareUrl to put it back exactly once.
  const base = normalizeBase((import.meta.env?.BASE_URL as string | undefined) ?? '/')
  const mount = `${base}${leaguePathPrefix()}`
  let route = pathname
  if (mount && (route === mount || route.startsWith(`${mount}/`))) {
    route = route.slice(mount.length) || '/'
  }
  return canonicalShareUrl(`${route}${search}${hash}`)
}
