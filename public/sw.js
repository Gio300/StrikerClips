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
// Cache names are keyed to BUILD_ID. Activation retains the current cache and
// one prior cache so an open tab can finish loading its original lazy chunks.
const CACHE_PREFIX = `tko-shell::${SCOPE_PATH}::`
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`
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
      const scoped = keys.filter((key) => key.startsWith(CACHE_PREFIX))
      const previous = scoped.filter((key) => key !== CACHE_NAME).slice(-1)
      const keep = new Set([CACHE_NAME, ...previous])
      await Promise.all(scoped.filter((key) => !keep.has(key)).map((key) => caches.delete(key)))
      // Only caches created by this worker are removed — never storage.
      await self.clients.claim()
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if (typeof client.postMessage === 'function') {
          client.postMessage({ type: 'TKO_UPDATE_ACTIVATED', buildId: BUILD_ID })
        }
      }
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
  if (cached && isUsableAssetResponse(request, cached)) return cached
  if (cached) await cache.delete(request)
  const response = await fetch(request)
  if (isUsableAssetResponse(request, response)) {
    await cache.put(request, response.clone())
  }
  return response
}

/** Never cache an HTML fallback under a JavaScript or stylesheet URL. */
function isUsableAssetResponse(request, response) {
  if (!response || !response.ok || response.type !== 'basic') return false
  const contentType = (response.headers && response.headers.get('content-type')) || ''
  const normalized = contentType.toLowerCase()
  if (normalized.includes('text/html')) return false

  let pathname = ''
  try {
    pathname = new URL(request.url).pathname.toLowerCase()
  } catch {
    pathname = ''
  }
  const destination = request.destination || ''
  if (destination === 'script' || /\.(?:m?js)$/.test(pathname)) {
    return /(?:java|ecma)script/.test(normalized)
  }
  if (destination === 'style' || pathname.endsWith('.css')) {
    return normalized.includes('text/css')
  }
  return true
}

// =============================================================================
// WEB PUSH — the phone buzz.
//
// Everything above this line is about CACHING and is untouched by what follows:
// the two handlers below never open a cache, never intercept a fetch and never
// call skipWaiting, so the update path keeps behaving exactly as documented.
//
// PAYLOAD. The server (server/webPush.ts) sends one JSON object:
//   { title, body, url, tag }
// `url` is an APP ROUTE ('/messages', '/tournaments/<id>'), never an absolute
// URL — see resolveNotificationUrl, which re-bases it onto SCOPE_PATH so the
// same payload lands correctly whether this worker was registered at '/' or at
// '/app/'. Anything cross-origin, scheme-bearing or escaping the scope is
// dropped for the scope root rather than followed.
//
// COLLAPSING. Every notification carries a `tag`. A tag REPLACES the notification
// already showing under the same tag instead of stacking beside it, so twenty
// messages in one conversation are one line in the shade that keeps updating —
// not twenty. The server keys the tag to the conversation/room, so two different
// conversations still show as two notifications. `renotify: true` makes the
// replacement still buzz, which is the whole point of the feature.
//
// DEGRADE, NEVER THROW. An unparseable payload still shows a generic
// notification (a push event that resolves without showNotification is
// punished by the browser with a "this site was updated in the background"
// system notice), and every await is individually guarded.
// =============================================================================

/** Icons live beside the manifest, so they are scope-relative like it is. */
const NOTIFY_ICON = `${SCOPE_PATH}icons/icon-192.png`
const NOTIFY_BADGE = `${SCOPE_PATH}icons/favicon-48.png`
const WORKER_HOSTNAME = new URL(self.location.origin).hostname.toLowerCase()
const IS_SSL_APP = WORKER_HOSTNAME === 'shinobistrikerleague.com'
  || WORKER_HOSTNAME.endsWith('.shinobistrikerleague.com')
const NOTIFY_FALLBACK_TITLE = IS_SSL_APP ? 'SSL' : 'TKO.cam'
const NOTIFY_MAX_TITLE = 120
const NOTIFY_MAX_BODY = 300

/** Read the push payload as an object. Never throws; worst case is `{}`. */
function readPushPayload(event) {
  if (!event || !event.data) return {}
  try {
    const parsed = event.data.json()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    /* not JSON — fall through to the text reading below */
  }
  try {
    const text = event.data.text()
    return text ? { body: text } : {}
  } catch {
    return {}
  }
}

function trimmedString(value, max) {
  if (typeof value !== 'string') return ''
  const clean = value.trim()
  return clean ? clean.slice(0, max) : ''
}

function visibleNotificationTitle(value) {
  const title = trimmedString(value, NOTIFY_MAX_TITLE) || NOTIFY_FALLBACK_TITLE
  if (!IS_SSL_APP || title === 'Powered by TKO.cam') return title
  return title
    .replace(/https?:\/\/(?:www\.)?tko\.cam(?=\/|\b)/gi, 'https://shinobistrikerleague.com')
    .replace(/Ask TKO/g, 'Ask SSL')
    .replace(/TKO\.cam/g, 'SSL')
    .replace(/\bTKO\b/g, 'SSL')
}

/**
 * Turn a payload `url` into a same-origin, in-scope path.
 *
 * The worker owns the base: '/messages' from the server becomes '/app/messages'
 * under the '/app/' registration and stays '/messages' under the root one, which
 * is why the leading slashes are stripped before resolving. A payload that tries
 * to name another origin ('https://evil/'), another scheme ('javascript:') or to
 * climb out of the scope ('../') gets the scope root instead.
 *
 * IDEMPOTENT, and that is load-bearing. `push` resolves the url and stores the
 * RESULT in `notification.data`; `notificationclick` resolves it again on the
 * way out. Without the already-in-scope check below, the second pass would
 * re-base an already-based path and produce '/app/app/messages' — a 404 for
 * every notification anyone ever tapped on the web deploy.
 */
function resolveNotificationUrl(raw) {
  const fallback = SCOPE_PATH
  const value = trimmedString(raw, 2048)
  if (!value) return fallback
  if (value.startsWith('//')) return fallback
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return fallback
  // Already inside our scope (a second pass, or a server that sent a full path):
  // resolve it as-is. Otherwise it is a scope-relative app route.
  const relative = value.startsWith(SCOPE_PATH) ? value : value.replace(/^\/+/, '')
  try {
    const url = new URL(relative, self.location.origin + SCOPE_PATH)
    if (url.origin !== self.location.origin) return fallback
    if (!url.pathname.startsWith(SCOPE_PATH)) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

self.addEventListener('push', (event) => {
  const payload = readPushPayload(event)
  const title = visibleNotificationTitle(payload.title)
  const url = resolveNotificationUrl(payload.url)
  // A tag is mandatory, not optional: without one every message stacks. When the
  // server does not name a conversation we still collapse per destination, which
  // is the closest honest approximation of "the same thread".
  const tag = trimmedString(payload.tag, NOTIFY_MAX_TITLE) || `tko::${url}`
  const options = {
    body: trimmedString(payload.body, NOTIFY_MAX_BODY),
    icon: NOTIFY_ICON,
    badge: NOTIFY_BADGE,
    tag,
    renotify: true,
    data: { url, tag },
  }
  event.waitUntil(
    self.registration.showNotification(title, options).catch(() => {
      // Last resort: a bare notification still beats the browser's own
      // "updated in the background" notice.
      return self.registration
        .showNotification(NOTIFY_FALLBACK_TITLE, { tag, data: { url, tag } })
        .catch(() => {})
    }),
  )
})

/** The client's pathname, or null when it is not one of ours. */
function ourClientPath(client) {
  try {
    const url = new URL(client.url)
    if (url.origin !== self.location.origin) return null
    if (!url.pathname.startsWith(SCOPE_PATH)) return null
    return url.pathname
  } catch {
    return null
  }
}

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification
  try {
    if (notification) notification.close()
  } catch {
    /* already gone */
  }
  const data = (notification && notification.data) || {}
  const url = resolveNotificationUrl(data.url)

  event.waitUntil(
    (async () => {
      const target = new URL(url, self.location.origin)
      let windows = []
      try {
        windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      } catch {
        windows = []
      }
      const ours = windows.filter((client) => ourClientPath(client) !== null)

      // Already looking at this exact conversation? Focus it and change nothing —
      // navigating would remount the room and throw away the scroll position.
      const exact = ours.find((client) => ourClientPath(client) === target.pathname)
      if (exact && typeof exact.focus === 'function') {
        try {
          await exact.focus()
          return
        } catch {
          /* fall through to the generic paths below */
        }
      }

      // Some other TKO tab is open: reuse it rather than piling up windows.
      const existing = ours[0]
      if (existing) {
        try {
          if (typeof existing.focus === 'function') await existing.focus()
        } catch {
          /* focus can be refused; navigation below is still worth trying */
        }
        if (typeof existing.navigate === 'function') {
          try {
            await existing.navigate(target.href)
            return
          } catch {
            /* an uncontrolled client cannot be navigated — open a window instead */
          }
        } else {
          return
        }
      }

      if (typeof self.clients.openWindow === 'function') {
        try {
          await self.clients.openWindow(target.href)
        } catch {
          /* nothing more we can do; the notification is already dismissed */
        }
      }
    })(),
  )
})
