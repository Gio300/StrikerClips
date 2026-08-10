/*
 * Read-only reconciliation of reel rows against public YouTube metadata.
 * It uses oEmbed, not the YouTube Data API, so it consumes no API quota.
 *
 * Required env:
 *   TKO_AUDIT_URL     tagged/backend origin
 *   TKO_SERVICE_KEY   internal service key
 */

type ReelVideo = {
  id: string
  user_id: string
  username: string | null
  title: string
  video_url: string
  created_at: string
}

type OEmbed = {
  title?: string
  author_name?: string
  author_url?: string
}

const origin = String(process.env.TKO_AUDIT_URL || '').replace(/\/$/, '')
const serviceKey = String(process.env.TKO_SERVICE_KEY || '')
if (!origin || !serviceKey) throw new Error('set TKO_AUDIT_URL and TKO_SERVICE_KEY')

const auditResponse = await fetch(`${origin}/api/internal/media-backlog-audit?recent_hours=720&limit=2000`, {
  headers: { 'x-tko-service': serviceKey },
})
if (!auditResponse.ok) throw new Error(`audit endpoint returned ${auditResponse.status}`)
const audit = await auditResponse.json() as { reel_videos?: ReelVideo[] }
const rows = (audit.reel_videos || []).filter((row) => /youtu(?:\.be|be\.com)/i.test(row.video_url))

async function inspect(row: ReelVideo) {
  const endpoint = new URL('https://www.youtube.com/oembed')
  endpoint.searchParams.set('url', row.video_url)
  endpoint.searchParams.set('format', 'json')
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(12_000) })
    if (!response.ok) return { ...row, available: false, youtube_title: null, author: null, author_url: null }
    const metadata = await response.json() as OEmbed
    return {
      ...row,
      available: true,
      youtube_title: metadata.title || null,
      author: metadata.author_name || null,
      author_url: metadata.author_url || null,
    }
  } catch {
    return { ...row, available: false, youtube_title: null, author: null, author_url: null }
  }
}

const inspected: Awaited<ReturnType<typeof inspect>>[] = []
const pending = [...rows]
await Promise.all(Array.from({ length: Math.min(12, pending.length) }, async () => {
  for (;;) {
    const row = pending.shift()
    if (!row) return
    inspected.push(await inspect(row))
  }
}))

const coachPattern = /\bcoach\s*dee\b|coachdee/i
const coachDee = inspected.filter((row) => coachPattern.test(String(row.youtube_title || '')))
const byPlayer = [...new Set(inspected.map((row) => row.username || '(unknown)'))]
  .sort((a, b) => a.localeCompare(b))
  .map((username) => ({
    username,
    total: inspected.filter((row) => (row.username || '(unknown)') === username).length,
    available: inspected.filter((row) => (row.username || '(unknown)') === username && row.available).length,
    coach_dee: coachDee.filter((row) => (row.username || '(unknown)') === username).length,
  }))

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  total_reel_youtube_rows: inspected.length,
  available: inspected.filter((row) => row.available).length,
  unavailable: inspected.filter((row) => !row.available).length,
  tko_channel_rows: inspected.filter((row) => /youtube\.com\/@T\.K\.O_Games/i.test(String(row.author_url || ''))).length,
  by_player: byPlayer,
  coach_dee_verticals: coachDee.map((row) => ({
    reel_id: row.id,
    username: row.username,
    youtube_title: row.youtube_title,
    video_url: row.video_url,
    created_at: row.created_at,
  })),
}, null, 2))
