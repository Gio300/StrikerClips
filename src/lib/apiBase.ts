/**
 * WHERE THE FRONTEND'S API CALLS ACTUALLY GO.
 *
 * The web build is served from the SAME ORIGIN as the Express API (Cloud Run
 * serves `dist` and mounts the API under `/api`), so a relative `/api` is
 * correct there and stays the default.
 *
 * The MOBILE build is not. Capacitor serves the bundle from `https://localhost`
 * (see capacitor.config.ts `androidScheme: 'https'`), so a relative `/api`
 * resolves to `https://localhost/api` — a URL that does not exist on the phone.
 * The APK therefore needs an ABSOLUTE base pointing at the deployed API origin.
 *
 * Set it at build time:
 *
 *   VITE_API_BASE=https://tko.cam        -> https://tko.cam/api
 *   VITE_API_BASE=https://tko.cam/       -> https://tko.cam/api   (slash trimmed)
 *   VITE_API_BASE=https://tko.cam/api    -> https://tko.cam/api   (not doubled)
 *   VITE_API_BASE=<unset>                -> /api                  (same-origin web)
 *
 * The server must send CORS for whatever origin the app runs under — see the
 * `cors()` configuration in server/app.ts, which allow-lists the Capacitor
 * origins (`https://localhost`, `capacitor://localhost`) and tko.cam.
 */

/** The path the Express API is mounted at, on every origin. */
export const API_PATH = '/api'

/**
 * Normalize a configured API base into a usable prefix.
 * Pure — exported separately from `API_BASE` so it is unit-testable without env.
 */
export function resolveApiBase(raw?: string | null): string {
  const value = String(raw ?? '').trim()
  // `undefined` arrives as the literal string "undefined" when an env var is
  // read off import.meta.env and stringified by a bundler define.
  if (!value || value === 'undefined' || value === 'null') return API_PATH
  const trimmed = value.replace(/\/+$/, '')
  if (!trimmed) return API_PATH
  // Already ends in /api (any casing) — don't produce ".../api/api".
  if (/\/api$/i.test(trimmed)) return trimmed
  return trimmed + API_PATH
}

/** True when the resolved base points at another origin (mobile / cross-origin). */
export function isAbsoluteApiBase(base: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(base)
}

/** Join the API base with a leading-slash path: apiUrl('/auth/me'). */
export function apiUrl(path: string, base: string = API_BASE): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return base + p
}

/** The base this build was compiled with. */
export const API_BASE: string = resolveApiBase(
  typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE : undefined,
)
