// Minimal zero-dependency static server for the built SPA on Cloud Run.
// Serves ./dist, falls back to index.html for client-side routes, listens on $PORT.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { join, normalize, extname } from 'node:path'

const DIST = join(process.cwd(), 'dist')
const PORT = process.env.PORT || 8080

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
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

async function send(res, file, status = 200) {
  const body = await readFile(file)
  res.writeHead(status, {
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
  })
  res.end(body)
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    // Prevent path traversal; resolve within DIST.
    const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
    let file = join(DIST, rel)
    if (existsSync(file) && statSync(file).isFile()) return await send(res, file)
    // SPA fallback: any unknown route serves index.html.
    return await send(res, join(DIST, 'index.html'))
  } catch {
    res.writeHead(500)
    res.end('Server error')
  }
})

server.listen(PORT, () => console.log(`KillCam static server on :${PORT}`))
