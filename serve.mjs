// Zero-dependency static server for the hosted web deploy on Cloud Run.
//
// URL layout (single origin, e.g. tko.cam):
//   /            → marketing site  (dist-site/, Vite base '/')   SPA fallback
//   /app, /app/* → the product app (dist/,      Vite base '/app/') SPA fallback
//
// The app MUST be built with base '/app/' (VITE_BASE_PATH=/app/ npm run build)
// so its asset URLs are '/app/assets/…'. The marketing site is built with the
// default base '/' (npm run build:site → dist-site/index.html).
//
// Graceful degradation: if dist-site/ is absent, the app is served at '/' too,
// so the origin never hard-404s a whole surface.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { join, normalize, extname } from 'node:path'

const CWD = process.cwd()
const SITE = join(CWD, 'dist-site') // marketing site → '/'
const APP = join(CWD, 'dist') // product app → '/app'
const PORT = process.env.PORT || 8080

const HAS_SITE = existsSync(join(SITE, 'index.html'))
const APP_PREFIX = '/app'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// The service worker script and the build stamp must NEVER be cached, or a
// deployed build stays invisible to already-installed testers (see
// src/lib/appVersion.ts and public/sw.js). HTML shells name the hashed assets,
// so they are no-cache too; only the hashed assets get a real max-age.
const NEVER_CACHE = /(^|\/)(sw\.js|version\.json)$/

async function send(res, file, status = 200) {
  const body = await readFile(file)
  const ext = extname(file).toLowerCase()
  const cache = NEVER_CACHE.test(file.replace(/\\/g, '/'))
    ? 'no-cache, no-store, must-revalidate'
    : ext === '.html'
      ? 'no-cache'
      : 'public, max-age=3600'
  res.writeHead(status, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': cache,
  })
  res.end(body)
}

// Resolve a request path within `root`, guarding against traversal.
function resolveIn(root, relPath) {
  const rel = normalize(relPath).replace(/^(\.\.[/\\])+/, '')
  return join(root, rel)
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])

    // Cloud Run health check.
    if (urlPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end('{"ok":true}')
    }

    // The build stamp lives in the APP bundle (only `vite build` emits it).
    // Alias it at the root too so either origin path answers with JSON rather
    // than falling through to the marketing SPA shell.
    if (urlPath === '/version.json') {
      const stamp = join(APP, 'version.json')
      if (existsSync(stamp)) return await send(res, stamp)
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      })
      return res.end('{"buildId":"unknown"}')
    }

    // ---- App surface: /app and everything under it ----
    if (urlPath === APP_PREFIX || urlPath.startsWith(APP_PREFIX + '/')) {
      const sub = urlPath.slice(APP_PREFIX.length) || '/'
      const file = resolveIn(APP, sub)
      if (existsSync(file) && statSync(file).isFile()) return await send(res, file)
      // SPA fallback for client-side routes under /app.
      return await send(res, join(APP, 'index.html'))
    }

    // ---- Marketing surface: everything else at '/' ----
    if (HAS_SITE) {
      const file = resolveIn(SITE, urlPath)
      if (existsSync(file) && statSync(file).isFile()) return await send(res, file)
      return await send(res, join(SITE, 'index.html'))
    }

    // Degraded mode: no marketing build present → serve the app at root.
    const appFile = resolveIn(APP, urlPath)
    if (existsSync(appFile) && statSync(appFile).isFile()) return await send(res, appFile)
    return await send(res, join(APP, 'index.html'))
  } catch {
    res.writeHead(500)
    res.end('Server error')
  }
})

server.listen(PORT, () =>
  console.log(
    `TKO static server on :${PORT} — site '${HAS_SITE ? '/' : '(missing)'}' + app '${APP_PREFIX}'`,
  ),
)
