/**
 * DOMAIN TAKEOVER — when the SPA is served from a league's own domain, the
 * ENTIRE app wears that league (operator 2026-08-02: "Shinobi Striker League
 * takes this whole app over — branding seen everywhere on
 * shinobistrikerleague.com. TKO.cam is the marketing/signup site to make your
 * league site.").
 *
 * This module is the glue between three existing pieces:
 *   • src/components/LeagueWatermark.tsx — `activeLeagueSlug()` is THE
 *     hostname→slug rule (reused here, never duplicated).
 *   • src/lib/leagueConfig.ts — `fetchLeagueBySlug()` pulls the league's
 *     config (GET /api/league/:slug/config, fail-soft to the seeds).
 *   • src/lib/leagueTheme.ts + LeagueThemeProvider — apply the config as CSS
 *     variables so all app chrome re-skins.
 *
 * PRIORITY RULE (resolveTakeover): only an ADDRESS re-skins the chrome — never
 * a membership. League branding lives on league ADDRESSES; bare tko.cam is
 * ALWAYS TKO-branded chrome (operator 2026-08-03: a member's league logo must
 * never replace the TKO lockup on tko.cam). A signed-in member's league slug
 * (fetchMemberLeague → setActiveLeagueSlug) still routes league-scoped
 * surfaces, but it produces NO chrome takeover. Fail-soft everywhere: any
 * resolution or fetch failure means the stock TKO look — never a broken app.
 *
 * WHICH ADDRESSES (operator 2026-08-04 — URL identity is a tier benefit, see
 * src/lib/leagueUrls.ts for the entitlement table):
 *   RUNG 1  tko.cam/<slug>       every tier   — pathLeagueSlug()
 *   RUNG 2  <slug>.tko.cam       Pro League+  — activeLeagueSlug()
 *   RUNG 3  <their own domain>   Enterprise   — activeLeagueSlug()
 * All three land in the SAME takeover, so the skin, the watermark, the splash
 * and the title are identical whichever address a visitor arrived on.
 *
 * PRECEDENCE: explicit `?league=` preview > path > hostname. The preview param
 * is the operator's override and must beat everything; a path prefix is an
 * explicit choice by whoever built the link, so it beats the ambient hostname.
 */

import { activeLeagueSlug } from '@/components/LeagueWatermark'
import { LEAGUE_SLUG_RE, SEED_LEAGUES, type LeagueConfig } from './leagueConfig'
import { leaguePathPrefix, pathLeagueSlug } from './leagueUrls'
// leagueTheme's ThemeStorage carries the optional removeItem we need here.
import type { LeagueConfig as LeagueThemeConfig, ThemeStorage } from './leagueTheme'

/**
 * `?league=<slug>` — the preview override. localhost can never BE
 * shinobistrikerleague.com, so this query param forces the domain-takeover
 * path for local verification, AND doubles as a shareable preview param
 * (e.g. the Studio's "see the full app wearing your league" link after
 * saving). It reads as a domain slug, so it follows the same DOMAIN-WINS
 * rule. STICKY for the browser session (sessionStorage) so in-app navigation
 * — which drops query params — keeps the takeover; `?league=off` (or any
 * invalid value) ends the preview.
 */
export const LEAGUE_PREVIEW_PARAM = 'league'
const PREVIEW_STORE_KEY = 'tko_league_preview'

/** Sanitize a candidate slug (query param / hostname label) or return null. */
function cleanSlug(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toLowerCase()
  return LEAGUE_SLUG_RE.test(s) ? s : null
}

function sessionStore(): ThemeStorage | null {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage
  } catch { /* access blocked (SSR / private mode) */ }
  return null
}

/**
 * The ?league= preview override, if any (see above). A valid slug in the URL
 * starts (and re-pins) the sticky session preview; a present-but-invalid
 * value (e.g. `?league=off`) ends it; an absent param reads the sticky value.
 */
export function previewLeagueSlug(
  search = typeof window !== 'undefined' ? window.location.search : '',
  store: ThemeStorage | null = sessionStore(),
): string | null {
  let raw: string | null = null
  try {
    raw = new URLSearchParams(search).get(LEAGUE_PREVIEW_PARAM)
  } catch { /* malformed search — treat as absent */ }
  if (raw !== null) {
    // 'off' is reserved: ?league=off explicitly ends the sticky preview.
    const slug = raw.trim().toLowerCase() === 'off' ? null : cleanSlug(raw)
    try {
      if (slug) store?.setItem(PREVIEW_STORE_KEY, slug)
      else if (store?.removeItem) store.removeItem(PREVIEW_STORE_KEY)
      else store?.setItem(PREVIEW_STORE_KEY, '')
    } catch { /* quota */ }
    return slug
  }
  try {
    return cleanSlug(store?.getItem(PREVIEW_STORE_KEY))
  } catch {
    return null
  }
}

/** Where a resolved league slug came from — the three rungs plus the preview. */
export type LeagueAddressSource = 'native' | 'preview' | 'path' | 'hostname'

/**
 * THE resolution, with its source: `?league=` preview > PATH prefix > HOSTNAME.
 * Pure and fully injectable so the precedence can be stated in a test without
 * a DOM.
 */
export function resolveLeagueAddress(
  hostname = typeof window !== 'undefined' ? window.location.hostname : '',
  search = typeof window !== 'undefined' ? window.location.search : '',
  store: ThemeStorage | null = sessionStore(),
  pathname = typeof window !== 'undefined' ? window.location.pathname : '',
  nativeSlug = import.meta.env?.VITE_NATIVE_LEAGUE_SLUG,
): { slug: string | null; source: LeagueAddressSource | null } {
  // A white-label native binary is one league's app at every URL. This lock is
  // injected at build time because Capacitor serves its bundle from localhost.
  const native = cleanSlug(nativeSlug)
  if (native) return { slug: native, source: 'native' }
  const preview = previewLeagueSlug(search, store)
  if (preview) return { slug: preview, source: 'preview' }
  const fromPath = cleanSlug(pathLeagueSlug(pathname))
  if (fromPath) return { slug: fromPath, source: 'path' }
  const fromHost = cleanSlug(activeLeagueSlug(hostname))
  if (fromHost) return { slug: fromHost, source: 'hostname' }
  return { slug: null, source: null }
}

/**
 * The league this page load is served AS: the ?league= preview override
 * first, then the PATH prefix (`tko.cam/<slug>` — rung 1), then the hostname
 * rule (activeLeagueSlug — tko.cam/localhost → null, <slug>.tko.cam → slug,
 * a league's own domain → its first label).
 */
export function domainLeagueSlug(
  hostname = typeof window !== 'undefined' ? window.location.hostname : '',
  search = typeof window !== 'undefined' ? window.location.search : '',
  store: ThemeStorage | null = sessionStore(),
  pathname = typeof window !== 'undefined' ? window.location.pathname : '',
  nativeSlug = import.meta.env?.VITE_NATIVE_LEAGUE_SLUG,
): string | null {
  return resolveLeagueAddress(hostname, search, store, pathname, nativeSlug).slug
}

/**
 * The router basename + link prefix for this page load: the bundle base plus
 * `/<slug>` when the PATH rung is in play. main.tsx feeds this to
 * <BrowserRouter basename>, which is what makes every existing <Route> and
 * <Link to="/x"> render as `/<slug>/x` inside a path takeover with zero
 * per-route changes.
 */
export function routerBasename(
  basePath = (import.meta.env?.BASE_URL as string | undefined) ?? '/',
  pathname = typeof window !== 'undefined' ? window.location.pathname : '',
): string {
  const base = String(basePath || '/').replace(/\/+$/, '')
  return `${base}${leaguePathPrefix(pathname, base)}` || '/'
}

/**
 * Where a signed-out visitor at `/` lands (operator 2026-08-02): a league's
 * domain IS their app, so signed-out visitors get the app's own league-branded
 * LOGIN/SIGNUP — never TKO's league-growth gateway. The gateway funnel
 * (/leagues, /make-a-league) is the front door on tko.cam/localhost only
 * (both stay reachable anywhere by direct URL).
 */
export function signedOutLandingPath(domainSlug: string | null): string {
  return domainSlug ? '/login' : '/leagues'
}

/**
 * One source, on purpose. All three rungs — `tko.cam/<slug>`, `<slug>.tko.cam`
 * and a league's own domain — produce the SAME 'domain' takeover, because the
 * operator's requirement is that they be indistinguishable in effect: same
 * colors, logo, name, watermark, splash and title. Only MEMBERSHIP is excluded.
 */
export type TakeoverSource = 'domain'

/**
 * THE merge rule, pure and testable: ONLY the ADDRESS produces a takeover.
 * On bare tko.cam (no address league) the chrome — lockup, title, colors —
 * stays stock TKO regardless of the visitor's league membership (operator
 * 2026-08-03: "league branding lives on league domains only"). The member
 * slug is still accepted so the rule keeps one signature (and the tests can
 * state it), but it is deliberately never a chrome source; league-scoped
 * member surfaces read getActiveLeagueSlug() directly instead.
 */
export function resolveTakeover(
  domainSlug: string | null,
  _memberSlug: string | null | undefined,
): { slug: string | null; source: TakeoverSource | null } {
  if (domainSlug) return { slug: domainSlug, source: 'domain' }
  return { slug: null, source: null }
}

/**
 * Synchronous seed lookup — lets a bundled launch league (SSL) paint its skin
 * on the very first frame while fetchLeagueBySlug refines it from the API.
 */
export function seedLeagueBySlug(slug: string | null | undefined): LeagueConfig | null {
  const clean = cleanSlug(slug)
  if (!clean) return null
  const seed = SEED_LEAGUES.find((l) => l.slug === clean)
  return seed ? { ...seed, colors: { ...seed.colors } } : null
}

/**
 * leagueConfig schema (the Studio / API / renderer shape) → leagueTheme schema
 * (what applyLeagueTheme turns into --league-* CSS variables). No background
 * mapping: league configs carry no surface color, so the app's dark chrome
 * stays stock and only the brand hues re-skin.
 */
export function toThemeConfig(cfg: LeagueConfig): LeagueThemeConfig {
  return {
    slug: cfg.slug,
    name: cfg.name,
    domain: cfg.domain,
    tagline: cfg.tagline,
    logo_url: cfg.logoUrl || undefined,
    video_ownership: cfg.video_ownership,
    tier: cfg.tier,
    // Carried so the chrome's white-label gate can read BOTH columns; without
    // it every takeover would look like an unpaid league to leagueCan().
    plan_status: cfg.plan_status,
    colors: {
      primary: cfg.colors.primary,
      secondary: cfg.colors.secondary,
      accent: cfg.colors.accent,
      text: cfg.colors.text,
    },
  }
}
