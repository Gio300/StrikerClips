/**
 * leagueUrls — THE one place a league's URL IDENTITY lives.
 *
 * Operator 2026-08-04: "users can attach their website name to our app if they
 * pay for that level on TKO for their branding.. or they just get
 * tko.cam/their league name."
 *
 * So a league's address is a TIER BENEFIT with three rungs, cheapest first:
 *
 *   1. PATH      `https://tko.cam/<slug>`      every tier. No infra at all —
 *                the SPA already owns the root of tko.cam, so a path prefix is
 *                free to hand out the moment a league row exists.
 *   2. SUBDOMAIN `https://<slug>.tko.cam`      Pro League and up. Needs ONE
 *                wildcard DNS record + a wildcard cert on the tko.cam origin
 *                (see DEPLOY.md "League URLs") — infra the operator does once,
 *                then every Pro league is served by it.
 *   3. CUSTOM    `https://<their-own-domain>`  the TOP plan (Dynasty, and
 *                Enterprise above it). The league proves it owns the domain
 *                with a TXT record, then the operator attaches it to the
 *                origin.
 *
 * The ladder itself — which plans exist, what each costs, what each unlocks,
 * and whether the row was actually PAID for (`leagues.plan_status`) — belongs
 * to src/lib/leaguePlans.ts. This module only decides which ADDRESS each rung
 * on that ladder answers on, and it defers to leaguePlans for the
 * `custom_domain` capability, so it can never be looser than the catalogue.
 *
 * Both halves of the app import this module — the browser (routing, the
 * Studio's URL panel, share links) and the server (`/api/fn/league-url-*`,
 * the host gate). It is deliberately DOM-free and dependency-free so the
 * Express process can `import` it exactly as it already imports
 * leagueStudioRanges/leagueAssets.
 *
 * THE RULE ABOUT ENFORCEMENT: everything in here is shared VOCABULARY. The
 * client uses it to show honest UI (a locked rung with an upgrade CTA, never
 * a hidden one — the Forge pattern); the server uses it as the LAW. A client
 * that lies about its tier gets a 403 from the fn and a redirect from the host
 * gate.
 */

import {
  LEAGUE_PLAN_IDS,
  isLeaguePlanId,
  leagueCan,
  leaguePlanById,
  planIsPaid,
  type LeaguePlanId,
} from './leaguePlans'

// ───────────────────────────────────────────────────────────────────────────
//  The three rungs + the plan ladder
// ───────────────────────────────────────────────────────────────────────────

/** The three ways a league can be addressed, cheapest → dearest. */
export type LeagueUrlRung = 'path' | 'subdomain' | 'custom'

export const LEAGUE_URL_RUNGS: readonly LeagueUrlRung[] = ['path', 'subdomain', 'custom'] as const

/**
 * The MINIMUM plan each rung requires.
 *
 * Read against LEAGUE_PLAN_IDS (starter → pro → dynasty → enterprise, the
 * ladder src/lib/leaguePlans.ts sells), so "mid tier and up" and "top tier
 * only" are one comparison. Custom domain sits at DYNASTY — the top plan a
 * card can actually buy — because Enterprise is a lead-capture with no
 * self-serve checkout, and pinning the rung there would make it unsellable.
 */
export const RUNG_MIN_TIER: Record<LeagueUrlRung, LeaguePlanId> = {
  path: 'starter',
  subdomain: 'pro',
  custom: 'dynasty',
}

/** Coerce anything into a known plan id (unknown/absent → the cheapest). */
export function leagueTier(tier: string | null | undefined): LeaguePlanId {
  const t = String(tier ?? '').trim().toLowerCase()
  return isLeaguePlanId(t) ? t : 'starter'
}

/** Position on the ladder — `leagueTierLevel('dynasty') > leagueTierLevel('pro')`. */
export function leagueTierLevel(tier: string | null | undefined): number {
  return LEAGUE_PLAN_IDS.indexOf(leagueTier(tier))
}

/**
 * THE entitlement check. Server-side this is the law; client-side it is UI.
 *
 * Two independent gates, both required for rungs 2 and 3:
 *   • the plan must be PAID (`plan_status` active/comped) — `leagues.tier`
 *     defaults to 'starter' and is editable from the Studio, so tier alone
 *     would let anyone type themselves a free address, and
 *   • the plan must sit at or above the rung's floor.
 *
 * Rung 1 is deliberately outside both. `tko.cam/<slug>` is the operator's
 * explicit no-pay option ("or they just get tko.cam/their league name"), so a
 * league row is the only requirement — an unpaid draft still has an address to
 * share. It grants an ADDRESS, not a skin: whether the app re-brands there is
 * leaguePlans' `branded_app` capability, gated separately.
 *
 * Rung 3 additionally defers to leaguePlans' own `custom_domain` capability, so
 * this module can only ever be STRICTER than the plan catalogue, never looser.
 */
export function canUseUrlRung(
  rung: LeagueUrlRung,
  tier: string | null | undefined,
  planStatus?: string | null | undefined,
): boolean {
  if (rung === 'path') return true
  if (!planIsPaid(planStatus)) return false
  if (leagueTierLevel(tier) < leagueTierLevel(RUNG_MIN_TIER[rung])) return false
  if (rung === 'custom') return leagueCan('custom_domain', tier, planStatus)
  return true
}

/** User-facing name of the plan that unlocks a rung ("Pro League", "Dynasty"). */
export function urlRungTierName(rung: LeagueUrlRung): string {
  return leaguePlanById(RUNG_MIN_TIER[rung])?.name ?? 'a paid'
}

/** The highest rung this league may use — what the Studio calls "your address". */
export function bestUrlRung(
  tier: string | null | undefined,
  planStatus?: string | null | undefined,
): LeagueUrlRung {
  if (canUseUrlRung('custom', tier, planStatus)) return 'custom'
  if (canUseUrlRung('subdomain', tier, planStatus)) return 'subdomain'
  return 'path'
}

// ───────────────────────────────────────────────────────────────────────────
//  Hosts
// ───────────────────────────────────────────────────────────────────────────

/** The canonical TKO apex. Subdomain rung = `<slug>.` + this. */
export const TKO_APEX = 'tko.cam'

/**
 * Subdomain labels that are INFRASTRUCTURE, never a league. Without this a
 * wildcard DNS record would happily let `api.tko.cam` resolve to a league
 * called "api" and take the whole app over with its skin.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www', 'api', 'app', 'admin', 'cdn', 'static', 'assets', 'media', 'img', 'images',
  'mail', 'smtp', 'imap', 'pop', 'mx', 'ns', 'ns1', 'ns2', 'dns',
  'dev', 'stage', 'staging', 'test', 'preview', 'beta', 'alpha', 'demo',
  'status', 'health', 'metrics', 'grafana', 'monitor',
  'docs', 'blog', 'help', 'support', 'shop', 'store', 'pay', 'billing', 'checkout',
  'auth', 'login', 'signup', 'account', 'accounts', 'id', 'sso', 'oauth',
  'live', 'stream', 'rtmp', 'ws', 'socket', 'webhook', 'webhooks',
  'files', 'download', 'downloads', 'upload', 'uploads', 'ftp',
  'internal', 'private', 'vpn', 'proxy', 'gateway', 'lb', 'origin',
])

/**
 * Top-level PATH segments the app already owns. `/<slug>` may only ever be a
 * league when it is none of these — otherwise the day someone registers a
 * league called "tournaments" the whole tournaments section disappears.
 *
 * Kept deliberately WIDER than today's route table: every current top-level
 * route from src/App.tsx, every static directory the server serves, plus the
 * obvious future doors (pricing, settings, admin…). A name reserved here and
 * never used costs nothing; a name missed here is a broken app.
 */
export const RESERVED_ROOT_PATHS: ReadonlySet<string> = new Set([
  // ── src/App.tsx route table (top-level segments) ───────────────────────
  'marketing', 'download', 'leagues', 'make-a-league', 'league-plans', 'studio',
  'create', 'video', 'clans', 'login', 'signup', 'setup', 'forgot-password', 'reset-password',
  'session-bridge', 'roster-invite', 'legal', 'help', 'support',
  'terms', 'privacy', 'data-deletion', 'account', 'reels', 'videos', 'produced',
  'highlight', 'matches', 'tournaments', 'king', 'boards', 'chat', 'messages',
  'live', 'watch', 'live-stage', 'live-streams', 'director', 'host',
  'live-dashboard', 'broadcast', 'program', 'go-live', 'my-clips', 'ai',
  'discover', 'connect', 'settings', 'privacy-settings', 'villages',
  'rankings', 'stat-check', 'stat-check-room',
  'submit-result', 'notifications', 'live-invites', 'dashboard', 'creator',
  'redeem', 'rewards', 'forge', 'conquest', 'store', 'shop', 'physical',
  'oracle', 'upgrade', 'browser', 'profile',
  // ── server-served paths + static directories (server/index.ts, public/) ──
  'api', 'app', 'assets', 'icons', 'brand', 'features', 'game-profiles',
  'conquest-map', 'sw', 'version', 'manifest', 'favicon', 'robots', 'sitemap',
  'well-known',
  // ── reserved for the future (cheap now, impossible later) ───────────────
  'admin', 'search', 'pricing', 'about', 'blog', 'docs', 'press',
  'contact', 'careers', 'status', 'health', 'metrics', 'auth', 'oauth',
  'callback', 'logout', 'signin', 'signout', 'register', 'billing', 'checkout',
  'invite', 'join', 'new', 'edit', 'delete', 'static', 'public', 'internal',
  'tko', 'cam', 'league',
])

/** Valid slug shape — the same rule as LEAGUE_SLUG_RE / the DB constraint. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

/** True when `segment` can never be a league (it is the app's own name). */
export function isReservedLeaguePath(segment: string | null | undefined): boolean {
  return RESERVED_ROOT_PATHS.has(String(segment ?? '').trim().toLowerCase())
}

/** True when `label` can never be a league subdomain (it is infrastructure). */
export function isReservedSubdomain(label: string | null | undefined): boolean {
  return RESERVED_SUBDOMAINS.has(String(label ?? '').trim().toLowerCase())
}

// ───────────────────────────────────────────────────────────────────────────
//  RUNG 1 — the path prefix
// ───────────────────────────────────────────────────────────────────────────

/** Normalize a Vite base path ('/app/' → '/app', '/' → ''). */
function normalizeBase(basePath: string | null | undefined): string {
  const trimmed = String(basePath ?? '/').replace(/\/+$/, '')
  if (!trimmed || trimmed === '/') return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/** The pathname of the current page, or '' outside a browser. */
function currentPathname(): string {
  if (typeof window === 'undefined' || !window.location) return ''
  return window.location.pathname || ''
}

/** The bundle's base path ('/app' on the legacy web deploy, '' today). */
function currentBase(): string {
  const raw = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  return normalizeBase(raw)
}

/**
 * The league a PATH addresses: the first segment after the bundle base, when
 * it is a well-formed slug that is not one of the app's own route names.
 *
 * `/shinobistrikerleague`         → 'shinobistrikerleague'
 * `/shinobistrikerleague/reels`   → 'shinobistrikerleague'  (survives nav)
 * `/tournaments/abc`              → null  (reserved — the app's own route)
 * `/`                             → null
 *
 * SHAPE ONLY. Whether a league by that slug EXISTS is answered by the API
 * (fetchLeagueBySlug); LeagueThemeProvider drops the prefix when it doesn't.
 */
export function pathLeagueSlug(
  pathname: string = currentPathname(),
  basePath: string = currentBase(),
): string | null {
  const base = normalizeBase(basePath)
  let p = String(pathname || '')
  if (base && (p === base || p.startsWith(`${base}/`))) p = p.slice(base.length)
  const first = p.split('/').filter(Boolean)[0]
  if (!first) return null
  const seg = decodeURIComponent(first).toLowerCase()
  if (!SLUG_RE.test(seg)) return null
  if (isReservedLeaguePath(seg)) return null
  return seg
}

/**
 * The router/link prefix this page load runs under — '/shinobistrikerleague'
 * on the path rung, '' everywhere else (tko.cam proper, a subdomain, a
 * league's own domain, the mobile app). Share links and the router basename
 * are both built on this, which is what makes a link copied from INSIDE a
 * path takeover stay inside it.
 */
export function leaguePathPrefix(
  pathname: string = currentPathname(),
  basePath: string = currentBase(),
): string {
  const slug = pathLeagueSlug(pathname, basePath)
  return slug ? `/${slug}` : ''
}

/** The same pathname with the league prefix removed (used to fail-soft out). */
export function stripLeaguePathPrefix(
  pathname: string = currentPathname(),
  basePath: string = currentBase(),
): string {
  const base = normalizeBase(basePath)
  const prefix = leaguePathPrefix(pathname, basePath)
  if (!prefix) return pathname
  const rest = String(pathname).slice(base.length + prefix.length)
  return `${base}${rest || '/'}`
}

// ───────────────────────────────────────────────────────────────────────────
//  RUNG 2/3 — hostnames
// ───────────────────────────────────────────────────────────────────────────

/** Lowercase a hostname and drop `www.` + any trailing dot / port. */
export function normalizeHost(host: string | null | undefined): string {
  return String(host ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
}

/**
 * The league a `<slug>.tko.cam` SUBDOMAIN addresses, or null. Reserved
 * infrastructure labels (api, cdn, www…) and the bare apex resolve to null.
 */
export function subdomainLeagueSlug(host: string | null | undefined): string | null {
  const h = normalizeHost(host)
  if (!h || h === TKO_APEX) return null
  if (!h.endsWith(`.${TKO_APEX}`)) return null
  const label = h.slice(0, -(TKO_APEX.length + 1))
  // Only ONE label deep: `a.b.tko.cam` is not a league.
  if (!label || label.includes('.')) return null
  if (!SLUG_RE.test(label) || isReservedSubdomain(label)) return null
  return label
}

/**
 * CUSTOM DOMAINS WHOSE FIRST LABEL IS NOT THEIR SLUG.
 *
 * The first-label rule below is right for `blaze.com` → `blaze` and wrong for
 * `thecircusrunaways.com`, whose league is `circusrunaways` (the article is in
 * the domain, not the slug — and `tko.cam/circusrunaways` has to keep working).
 * GET /api/league/by-host corrects a mismatch, but only AFTER a round trip, so
 * seeding the known host is what makes the FIRST frame correct. The API stays
 * the authority for every host not listed.
 */
export const KNOWN_LEAGUE_HOSTS: Record<string, string> = {
  'thecircusrunaways.com': 'circusrunaways',
}

/**
 * THE hostname → league rule. The SAME SPA serves tko.cam AND every league's
 * own domain, so the hostname IS the league context: tko.cam / localhost → no
 * league; `<slug>.tko.cam` → slug (rung 2); a league's own domain → its first
 * label (rung 3); the Amplify default domain is league #1's.
 *
 * INFRASTRUCTURE SUBDOMAINS ARE NOT LEAGUES: once the wildcard `*.tko.cam`
 * record exists (DEPLOY.md "League URLs — the three rungs"), `api.tko.cam` /
 * `cdn.tko.cam` also reach this app. subdomainLeagueSlug() refuses the
 * reserved labels, so an infrastructure host can never be taken over by a
 * league that happened to register that name.
 *
 * IT LIVES HERE, NOT IN A COMPONENT (moved 2026-08-06, re-exported from
 * src/components/LeagueWatermark.tsx so every existing importer is unchanged):
 * server/app.ts needs the identical answer when it builds the per-host PWA
 * manifest, and a second copy of this rule on the server is exactly how a
 * league ends up branded in the app and TKO on the home screen. It is a GUESS,
 * not an entitlement — `decideHostGate` below is what decides whether an
 * address may be SERVED, and the server confirms the guessed slug against a
 * real leagues row before dressing anything in it.
 */
export function activeLeagueSlug(hostname: string | null | undefined): string | null {
  const host = normalizeHost(hostname)
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === TKO_APEX) return null
  if (host.endsWith(`.${TKO_APEX}`)) return subdomainLeagueSlug(host)
  if (host.endsWith('.amplifyapp.com')) return 'shinobistrikerleague'
  const known = KNOWN_LEAGUE_HOSTS[host]
  if (known) return known
  return host.split('.')[0] || null
}

/**
 * Is `host` a domain a league could plausibly CLAIM as its own? Must be a
 * real multi-label public hostname, never tko.cam or anything under it (those
 * are rungs 1 and 2, handed out by tier, not claimed).
 */
export function isClaimableCustomDomain(host: string | null | undefined): boolean {
  const h = normalizeHost(host)
  if (!h) return false
  if (h.length > 253) return false
  if (h === TKO_APEX || h.endsWith(`.${TKO_APEX}`)) return false
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false
  const labels = h.split('.')
  if (labels.length < 2) return false
  if (labels.some((l) => !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return false
  // A bare TLD-looking last label must be alphabetic (".com", not ".123").
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1])) return false
  return true
}

/**
 * Normalize whatever the owner typed in the Studio into a bare hostname:
 * `https://WWW.Blaze.GG/join?x=1` → `blaze.gg`. Returns '' when it can't be
 * read as a claimable domain.
 */
export function normalizeCustomDomain(input: string | null | undefined): string {
  let raw = String(input ?? '').trim()
  if (!raw) return ''
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') // scheme
  raw = raw.split('/')[0].split('?')[0].split('#')[0] // path/query/hash
  const host = normalizeHost(raw)
  return isClaimableCustomDomain(host) ? host : ''
}

// ───────────────────────────────────────────────────────────────────────────
//  Ownership proof — the TXT challenge
// ───────────────────────────────────────────────────────────────────────────

/** DNS label the verification TXT record lives under. */
export const DOMAIN_VERIFY_PREFIX = '_tko-verify'
/** Value prefix, so an unrelated TXT record on the same name can't match. */
export const DOMAIN_VERIFY_VALUE_PREFIX = 'tko-verify='

export type DomainVerificationRecord = {
  /** Fully-qualified record name (`_tko-verify.blaze.gg`). */
  host: string
  /** Just the label to type into most registrars' "Host" box. */
  name: string
  type: 'TXT'
  value: string
}

/** Token shape — 32 lowercase hex chars. Checked before any DNS lookup. */
export const DOMAIN_VERIFY_TOKEN_RE = /^[a-f0-9]{32}$/

/**
 * The exact record a league owner must publish to prove they control the
 * domain. Rendered verbatim in the Studio and re-derived server-side before
 * the DNS lookup, so the two can never disagree about what counts as proof.
 */
export function domainVerificationRecord(
  domain: string,
  token: string,
): DomainVerificationRecord | null {
  const host = normalizeCustomDomain(domain)
  const t = String(token ?? '').trim().toLowerCase()
  if (!host || !DOMAIN_VERIFY_TOKEN_RE.test(t)) return null
  return {
    host: `${DOMAIN_VERIFY_PREFIX}.${host}`,
    name: DOMAIN_VERIFY_PREFIX,
    type: 'TXT',
    value: `${DOMAIN_VERIFY_VALUE_PREFIX}${t}`,
  }
}

/**
 * Does a set of TXT strings pulled from DNS contain the proof? Registrars and
 * resolvers chunk, quote and pad TXT values, so every candidate is trimmed and
 * unquoted before the compare.
 */
export function txtRecordsProve(records: readonly string[], token: string): boolean {
  const t = String(token ?? '').trim().toLowerCase()
  if (!DOMAIN_VERIFY_TOKEN_RE.test(t)) return false
  const want = `${DOMAIN_VERIFY_VALUE_PREFIX}${t}`
  return records.some((r) => String(r ?? '').replace(/["\s]/g, '').toLowerCase() === want)
}

// ───────────────────────────────────────────────────────────────────────────
//  The addresses themselves
// ───────────────────────────────────────────────────────────────────────────

/** Verification states a claimed custom domain can be in. */
export type CustomDomainStatus = 'none' | 'pending' | 'verified'

export function customDomainStatus(raw: string | null | undefined): CustomDomainStatus {
  const s = String(raw ?? '').trim().toLowerCase()
  return s === 'pending' || s === 'verified' ? s : 'none'
}

export type LeagueUrlIdentity = {
  slug: string
  /** `leagues.tier` — WHICH plan. */
  tier: LeaguePlanId
  /** `leagues.plan_status` — whether that plan was PAID for. Both are needed. */
  planStatus: string
  /** The claimed custom domain, whatever its verification state. */
  customDomain: string
  customDomainStatus: CustomDomainStatus
}

/**
 * The public URL for one rung, or null when this league can't use it. `custom`
 * additionally requires a VERIFIED domain — a pending claim has no address yet.
 */
export function leagueUrlForRung(
  rung: LeagueUrlRung,
  id: Pick<LeagueUrlIdentity, 'slug'> & Partial<LeagueUrlIdentity>,
): string | null {
  const slug = String(id.slug ?? '').trim().toLowerCase()
  if (!SLUG_RE.test(slug)) return null
  if (!canUseUrlRung(rung, id.tier, id.planStatus)) return null
  if (rung === 'path') return `https://${TKO_APEX}/${slug}`
  if (rung === 'subdomain') return `https://${slug}.${TKO_APEX}`
  const domain = normalizeCustomDomain(id.customDomain)
  if (!domain || customDomainStatus(id.customDomainStatus) !== 'verified') return null
  return `https://${domain}`
}

/**
 * What the address WOULD be if the league were entitled — the greyed line on
 * a locked rung in the Studio. Locked does not mean hidden: an owner deciding
 * whether to upgrade should see the actual address they'd get, not a dash.
 * Never used for routing; entitlement is leagueUrlForRung's job.
 */
export function leagueUrlPreview(
  rung: LeagueUrlRung,
  slug: string,
  customDomain?: string | null,
): string | null {
  const s = String(slug ?? '').trim().toLowerCase()
  if (!SLUG_RE.test(s)) return null
  if (rung === 'path') return `https://${TKO_APEX}/${s}`
  if (rung === 'subdomain') return `https://${s}.${TKO_APEX}`
  const domain = normalizeCustomDomain(customDomain)
  return domain ? `https://${domain}` : null
}

/**
 * THE address to show a league owner: the best rung their tier actually
 * delivers today. Always resolves — the path rung is the floor and never
 * fails, which is the whole point of giving it away with every plan.
 */
export function primaryLeagueUrl(id: Pick<LeagueUrlIdentity, 'slug'> & Partial<LeagueUrlIdentity>): string {
  return (
    leagueUrlForRung('custom', id) ??
    leagueUrlForRung('subdomain', id) ??
    leagueUrlForRung('path', id) ??
    `https://${TKO_APEX}`
  )
}

/**
 * Server-side host gate answer: what to do with a request that arrived on
 * `host` for a league whose row says `id`.
 *
 *  • 'serve'    — this host is entitled; hand over the app.
 *  • 'redirect' — the league exists but this host is above its tier (or the
 *                 domain isn't verified). Fall back to the PATH rung, which
 *                 every league owns, so the league is never simply broken.
 *  • 'pass'     — not a league host at all; the normal server handles it.
 */
export type HostGateDecision =
  | { action: 'serve'; slug: string; rung: LeagueUrlRung }
  | { action: 'redirect'; slug: string; to: string; reason: 'tier' | 'unverified' }
  | { action: 'pass' }

export function decideHostGate(
  host: string | null | undefined,
  lookup: (kind: 'subdomain' | 'custom', key: string) => LeagueUrlIdentity | null,
): HostGateDecision {
  const h = normalizeHost(host)
  if (!h || h === TKO_APEX) return { action: 'pass' }

  const sub = subdomainLeagueSlug(h)
  if (sub) {
    const league = lookup('subdomain', sub)
    // An unknown subdomain is NOT a league — let the app boot normally (it
    // fails soft to the stock TKO look) rather than 404 a typo'd address.
    if (!league) return { action: 'pass' }
    if (!canUseUrlRung('subdomain', league.tier, league.planStatus)) {
      return { action: 'redirect', slug: league.slug, to: `/${league.slug}`, reason: 'tier' }
    }
    return { action: 'serve', slug: league.slug, rung: 'subdomain' }
  }

  if (!isClaimableCustomDomain(h)) return { action: 'pass' }
  const league = lookup('custom', h)
  if (!league) return { action: 'pass' }
  if (!canUseUrlRung('custom', league.tier, league.planStatus)) {
    return { action: 'redirect', slug: league.slug, to: `/${league.slug}`, reason: 'tier' }
  }
  if (customDomainStatus(league.customDomainStatus) !== 'verified') {
    return { action: 'redirect', slug: league.slug, to: `/${league.slug}`, reason: 'unverified' }
  }
  return { action: 'serve', slug: league.slug, rung: 'custom' }
}
