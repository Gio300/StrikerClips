/**
 * Build identity and the "is a newer build available?" decision.
 *
 * WHY THIS EXISTS
 * Testers install tko.cam to their home screen and then never see a new build,
 * because an installed PWA happily runs whatever HTML shell + JS chunk it has
 * cached. Two independent mechanisms push them forward:
 *
 *   1. The service worker (public/sw.js) reports a *waiting* worker when a new
 *      shell has been fetched. That is the fast path.
 *   2. This module's `/version.json` poll. Every build stamps a `buildId` into
 *      the bundle (import.meta.env.VITE_BUILD_ID + a <meta name="tko-build">
 *      tag) and emits a matching `version.json` next to it. If the served id
 *      differs from the running one, a new build exists — regardless of what
 *      the service worker thinks it is doing.
 *
 * Everything here is pure so it can be unit-tested without a browser: the
 * decision "should we nag the user to update" must never be guesswork.
 */

export interface VersionPayload {
  /** Opaque, per-build identifier. Equality is the only thing that matters. */
  buildId: string
  /** Epoch ms the build was produced. Used only as a monotonic safety guard. */
  builtAt?: number
}

/**
 * Values a build id can degrade to when an env var is unset, cleared by a
 * `.bat` (`set VITE_BUILD_ID=`), or stringified by a bundler define. A build
 * running one of these is a dev/unstamped build and must never nag.
 */
const PLACEHOLDER_IDS = new Set(['', 'dev', 'undefined', 'null', 'unknown'])

/** True when `id` is a real, comparable build stamp. */
export function isRealBuildId(id: string | null | undefined): boolean {
  if (typeof id !== 'string') return false
  return !PLACEHOLDER_IDS.has(id.trim().toLowerCase())
}

/**
 * Coerce whatever `/version.json` returned into a payload, or null.
 *
 * Deliberately forgiving about `builtAt` (number, numeric string, or ISO date)
 * and deliberately strict about `buildId` — a missing/blank id means "we cannot
 * tell", which must read as "do not prompt", never as "update available".
 */
export function parseVersionPayload(raw: unknown): VersionPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const buildId = typeof obj.buildId === 'string' ? obj.buildId.trim() : ''
  if (!isRealBuildId(buildId)) return null

  const builtAt = coerceTimestamp(obj.builtAt)
  return builtAt === undefined ? { buildId } : { buildId, builtAt }
}

function coerceTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * The core test: does the served build differ from the one we are running?
 *
 * Returns false whenever we cannot be sure (either side missing, unstamped dev
 * build, identical ids). A false positive here means an infinite reload loop on
 * every tester's phone, so "unsure" always means "stay put".
 */
export function isNewerBuild(
  running: string | null | undefined,
  served: string | null | undefined,
): boolean {
  if (!isRealBuildId(running) || !isRealBuildId(served)) return false
  return (running as string).trim() !== (served as string).trim()
}

/**
 * `isNewerBuild` plus a monotonic guard.
 *
 * A load balancer mid-rollout, or a stale CDN edge, can hand back the PREVIOUS
 * build's version.json. Without this guard the app would bounce between two
 * builds forever. When both sides carry a `builtAt`, an older-or-equal
 * timestamp is never treated as an update.
 */
export function shouldPromptUpdate(
  running: VersionPayload | null | undefined,
  served: VersionPayload | null | undefined,
): boolean {
  if (!running || !served) return false
  if (!isNewerBuild(running.buildId, served.buildId)) return false
  if (typeof running.builtAt === 'number' && typeof served.builtAt === 'number') {
    return served.builtAt > running.builtAt
  }
  return true
}

/* ------------------------------------------------------------------ *
 * Path helpers — the app is served at '/' on mobile and '/app/' on web,
 * so every update-related URL has to be derived from Vite's BASE_URL
 * rather than hard-coded. Pure, so the /app deploy is covered by tests.
 * ------------------------------------------------------------------ */

/** Normalise any base to a leading+trailing-slash form: '/app' → '/app/'. */
export function normalizeBase(base: string | null | undefined): string {
  const raw = (base ?? '').trim()
  if (!raw || raw === '.' || raw === './') return '/'
  const withLead = raw.startsWith('/') ? raw : `/${raw}`
  return withLead.endsWith('/') ? withLead : `${withLead}/`
}

/**
 * Where the service worker script lives. It MUST sit inside the base path:
 * a worker at '/sw.js' cannot claim '/app/' without a Service-Worker-Allowed
 * header, and one at '/app/sw.js' gets scope '/app/' for free.
 */
export function swUrl(base: string | null | undefined): string {
  return `${normalizeBase(base)}sw.js`
}

/** The scope that worker will control. */
export function swScope(base: string | null | undefined): string {
  return normalizeBase(base)
}

/** Where the build stamp is served from, alongside the bundle it describes. */
export function versionUrl(base: string | null | undefined): string {
  return `${normalizeBase(base)}version.json`
}
