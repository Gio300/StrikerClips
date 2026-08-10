/*
 * Deletes only TKO-channel verticals whose current public YouTube title names
 * Coach Dee, then removes the exact matching reel rows through the guarded API.
 * Default is a read-only dry run. Pass --execute to mutate.
 */

type ReelVideo = {
  id: string
  username: string | null
  video_url: string
  created_at: string
}

const origin = String(process.env.TKO_AUDIT_URL || '').replace(/\/$/, '')
const serviceKey = String(process.env.TKO_SERVICE_KEY || '')
const clientId = String(process.env.TKO_YOUTUBE_CLIENT_ID || '').trim()
const clientSecret = String(process.env.TKO_YOUTUBE_CLIENT_SECRET || '').trim()
const refreshToken = String(process.env.TKO_YOUTUBE_REFRESH_TOKEN || '').trim()
const execute = process.argv.includes('--execute')
if (!origin || !serviceKey) throw new Error('set TKO_AUDIT_URL and TKO_SERVICE_KEY')
if (execute && (!clientId || !clientSecret || !refreshToken)) {
  throw new Error('set the three TKO_YOUTUBE_* OAuth variables before --execute')
}

function youtubeId(url: string): string | null {
  return url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{6,20})/)?.[1] || null
}

const auditResponse = await fetch(`${origin}/api/internal/media-backlog-audit?recent_hours=720&limit=2000`, {
  headers: { 'x-tko-service': serviceKey },
})
if (!auditResponse.ok) throw new Error(`audit endpoint returned ${auditResponse.status}`)
const audit = await auditResponse.json() as { reel_videos?: ReelVideo[] }
const reels = (audit.reel_videos || []).filter((row) => youtubeId(row.video_url))

async function inspect(row: ReelVideo) {
  const endpoint = new URL('https://www.youtube.com/oembed')
  endpoint.searchParams.set('url', row.video_url)
  endpoint.searchParams.set('format', 'json')
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(12_000) })
    if (!response.ok) return null
    const metadata = await response.json() as { title?: string; author_url?: string }
    return { row, title: String(metadata.title || ''), authorUrl: String(metadata.author_url || '') }
  } catch { return null }
}

const inspected: NonNullable<Awaited<ReturnType<typeof inspect>>>[] = []
const pending = [...reels]
await Promise.all(Array.from({ length: Math.min(12, pending.length) }, async () => {
  for (;;) {
    const row = pending.shift()
    if (!row) return
    const result = await inspect(row)
    if (result) inspected.push(result)
  }
}))

const coachPattern = /\bcoach\s*dee\b|coachdee/i
const targets = inspected.filter((item) =>
  coachPattern.test(item.title)
  && /youtube\.com\/@T\.K\.O_Games/i.test(item.authorUrl),
).map((item) => ({
  reel_id: item.row.id,
  youtube_id: youtubeId(item.row.video_url)!,
  username: item.row.username,
  title: item.title,
}))

const dryRunResponse = await fetch(`${origin}/api/internal/media-produced-delete`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-tko-service': serviceKey },
  body: JSON.stringify({
    reason: 'coach-dee-produced-vertical-cleanup',
    items: targets.map(({ reel_id, youtube_id }) => ({ reel_id, youtube_id })),
  }),
})
if (!dryRunResponse.ok) throw new Error(`cleanup dry run returned ${dryRunResponse.status}`)
const dryRun = await dryRunResponse.json() as { matched?: number; missing?: number }

const byPlayer = [...new Set(targets.map((target) => target.username || '(unknown)'))]
  .sort((a, b) => a.localeCompare(b))
  .map((username) => ({
    username,
    count: targets.filter((target) => (target.username || '(unknown)') === username).length,
  }))

if (!execute) {
  console.log(JSON.stringify({
    dry_run: true,
    inspected: inspected.length,
    coach_dee_tko_targets: targets.length,
    database_matches: Number(dryRun.matched || 0),
    database_missing: Number(dryRun.missing || 0),
    estimated_delete_quota_units: targets.length * 50,
    by_player: byPlayer,
  }, null, 2))
  process.exit(0)
}
if (Number(dryRun.matched || 0) !== targets.length || Number(dryRun.missing || 0) !== 0) {
  throw new Error('database dry run did not match every exact Coach Dee target')
}

const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }),
})
if (!tokenResponse.ok) {
  throw new Error(`OAuth refresh failed (${tokenResponse.status}): ${(await tokenResponse.text()).slice(0, 500)}`)
}
const token = await tokenResponse.json() as { access_token?: string; scope?: string }
if (!token.access_token) throw new Error('OAuth refresh returned no access token')

const tokenInfoResponse = await fetch(
  `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token.access_token)}`,
)
const tokenInfo = tokenInfoResponse.ok
  ? await tokenInfoResponse.json() as { scope?: string }
  : { scope: token.scope || '' }
const scopes = String(tokenInfo.scope || token.scope || '')
if (!/(?:^|\s)https:\/\/www\.googleapis\.com\/auth\/(?:youtube|youtube\.force-ssl)(?:\s|$)/.test(scopes)) {
  throw new Error('configured YouTube refresh token lacks a delete-capable scope; no videos were deleted')
}

const deleted: Array<{ reel_id: string; youtube_id: string }> = []
const failures: Array<{ youtube_id: string; status: number; detail: string }> = []
for (const target of targets) {
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(target.youtube_id)}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${token.access_token}` } },
  )
  if (response.status === 204 || response.status === 404) {
    deleted.push({ reel_id: target.reel_id, youtube_id: target.youtube_id })
    continue
  }
  const detail = (await response.text()).slice(0, 500)
  failures.push({ youtube_id: target.youtube_id, status: response.status, detail })
  if (response.status === 403 && /quotaExceeded/i.test(detail)) break
}

let databaseDeleted = 0
if (deleted.length) {
  const cleanupResponse = await fetch(`${origin}/api/internal/media-produced-delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tko-service': serviceKey },
    body: JSON.stringify({
      reason: 'coach-dee-produced-vertical-cleanup',
      dry_run: false,
      items: deleted,
    }),
  })
  if (!cleanupResponse.ok) throw new Error(`database cleanup returned ${cleanupResponse.status}`)
  const cleanup = await cleanupResponse.json() as { deleted?: number }
  databaseDeleted = Number(cleanup.deleted || 0)
}

console.log(JSON.stringify({
  dry_run: false,
  requested: targets.length,
  youtube_deleted_or_already_absent: deleted.length,
  database_deleted: databaseDeleted,
  failures,
}, null, 2))
