/* eslint-disable no-undef */
/**
 * TKO service worker — hand-rolled, deliberately small.
 *
 * Its ONLY jobs are (a) make the app installable and (b) let us detect a new
 * build. It is explicitly NOT an offline-first cache, because the failure mode
 * of an over-eager PWA cache is exactly the thing we are trying to fix: a
 * tester stuck on a build from three days ago with no way out but reinstalling.
 *
 * STRATEGY
 *   • Navigations (the HTML shell)  → NETWORK FIRST. The shell names the hashed
 *     JS/CSS, so a stale shell is a stale app. Cache is a last-resort offline
 *     fallback only.
 *   • Hashed build assets (BASE/assets/*) → CACHE FIRST. Safe by construction:
 *     the filename changes when the content does.
 *   • /api/*        → NEVER touched. No caching, no interception; auth and
 *     money paths must always hit the network.
 *   • version.json  → NEVER cached. It is the update signal itself.
 *   • Anything else (icons, videos, cross-origin) → left to the browser.
 *
 * UPDATE BEHAVIOUR — the important part
 *   This worker is deliberately AGGRESSIVE. A tester ("Hollywood") kept getting
 *   stranded on a days-old build behind an in-app "Update" banner he never
 *   tapped, so the update is now automatic:
 *     • install  → self.skipWaiting(): a freshly-installed worker activates
 *       immediately instead of sitting in `waiting` until every tab closes.
 *     • activate → self.clients.claim() + purge every OLD build's cache. The
 *       cache name is keyed to BUILD_ID, so the previous build's shell entry is
 *       deleted the instant the new worker takes over.
 *   The script itself carries BUILD_ID, so its bytes change every deploy — that
 *   is what makes the browser's periodic `registration.update()` actually see a
 *   new worker on a content-only deploy and install it. Combined with the app's
 *   /version.json poll + auto-reload (src/hooks/useAppUpdate.ts), a returning
 *   user is pushed onto the newest build within ~a minute, no tap required.
 *
 *   The SKIP_WAITING message handler is retained for the explicit "Update"
 *   button path, but the worker no longer WAITS for it.
 *
 *   Nothing here clears localStorage, IndexedDB or cookies. The auth JWT lives
 *   in localStorage (`kc_token`), which is untouched by cache eviction, so the
 *   post-update reload rehydrates the session and the tester stays signed in.
 *
 * SCOPE
 *   The same file is served from '/sw.js' (marketing site, scope '/') and
 *   '/app/sw.js' (product app, scope '/app/'). Everything below is derived from
 *   `self.registration.scope`, and the cache name is scope-keyed, so the two
 *   registrations never fight over each other's entries.
 */

const SCOPE_PATH = new URL(self.registration.scope).pathname // '/' or '/app/'
// Stamped at build time by vite.buildId.ts (closeBundle rewrites this token in
// the emitted sw.js). An un-stamped copy served straight from public/ keeps the
// literal placeholder, which we detect and collapse to 'dev'.
const RAW_BUILD_ID = '__TKO_BUILD_ID__'
const BUILD_ID = RAW_BUILD_ID.startsWith('__TKO_BUILD') ? 'dev' : RAW_BUILD_ID
// Cache name keyed to BUILD_ID: every new build gets a new cache, and the
// activate handler deletes any cache whose key is not the current one, so a
// stale shell can never outlive the build that produced it.
const CACHE_NAME = `tko-shell::${SCOPE_PATH}::${BUILD_ID}`
const SHELL_KEY = `${SCOPE_PATH}__shell__`

/**
 * The root-scope worker technically covers '/app/*' too. If the /app worker is
 * not registered yet and the network is down, we must not hand an /app
 * navigation the marketing shell — better to fail than to render the wrong app.
 */
const FOREIGN_PREFIX = SCOPE_PATH === '/' ? '/app' : null

self.addEventListener('install', () => {
  // Activate this worker as soon as it is installed instead of waiting for every
  // controlled tab to close. This is half of the force-update: the new worker
  // stops sitting in `waiting`. The other half is clients.claim() below.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k.startsWith('tko-shell::') && k !== CACHE_NAME)
          .map((k) => caches.delete(k)),
      )
      // Only caches created by this worker are removed — never storage.
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

function isBuildAsset(pathname) {
  return pathname.startsWith(`${SCOPE_PATH}assets/`)
}

function isNeverCached(pathname) {
  return (
    pathname.startsWith('/api/') ||
    pathname === '/api' ||
    pathname.endsWith('/version.json') ||
    pathname.endsWith('/sw.js')
  )
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return
  if (isNeverCached(url.pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request, url))
    return
  }

  if (isBuildAsset(url.pathname)) {
    event.respondWith(cacheFirstAsset(request))
  }
})

/**
 * Network first. A successful HTML response is stored under one stable key so
 * there is something to show offline; it is never preferred over the network.
 */
async function networkFirstShell(request, url) {
  try {
    const response = await fetch(request)
    if (response && response.ok && response.type === 'basic') {
      const copy = response.clone()
      const cache = await caches.open(CACHE_NAME)
      await cache.put(SHELL_KEY, copy)
    }
    return response
  } catch (err) {
    if (FOREIGN_PREFIX && url.pathname.startsWith(FOREIGN_PREFIX)) throw err
    const cached = await caches.match(SHELL_KEY, { cacheName: CACHE_NAME })
    if (cached) return cached
    throw err
  }
}

/** Cache first — content-hashed filenames make this immutable by definition. */
async function cacheFirstAsset(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok && response.type === 'basic') {
    cache.put(request, response.clone())
  }
  return response
}
