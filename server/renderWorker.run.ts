#!/usr/bin/env tsx
/* eslint-disable no-console */
// ===========================================================================
// RENDER WORKER — production entrypoint.
//
// Connects to the SAME database the live app writes (render_jobs queue), and
// for each pending job: pulls the bunch's source clips, bakes a multi-angle
// composite with ffmpeg, uploads it to the TKO YouTube channel, and — via the
// tested queue logic in renderWorker.ts — writes the link back onto the match +
// clips and notifies every participant "your multi-angle video is live".
//
// The queue mechanics (claim/complete/fail/notify) are the unit-tested code in
// renderWorker.ts; this file only supplies the real "assemble + upload" muscle
// and the poll loop. It runs anywhere with node + ffmpeg + yt-dlp + network.
//
// Required env:
//   DATABASE_URL   (or INSTANCE_CONNECTION_NAME + DB_USER/DB_PASSWORD/DB_NAME)
//   YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN
// Optional:
//   FFMPEG_PATH (default 'ffmpeg')   YT_DLP_PATH (default 'yt-dlp')
//   POLL_MS (default 15000)          run with --once to drain then exit.
// ===========================================================================
import 'dotenv/config'
import { Pool } from 'pg'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { drainQueue, type RenderAndUpload, type RenderJob } from './renderWorker'
import { ensureSchema } from './ensureSchema'
import { buildVideoReactionAudio, type ReactionAudio } from './tkoReactions'

const execFileP = promisify(execFile)
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp'
const BRAND_WATERMARK =
  process.env.TKO_WATERMARK_PATH ||
  join(process.cwd(), 'public', 'brand', 'tko-video-watermark.png')

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`missing required env ${name}`)
  return v
}

// Same connection logic as server/index.ts so the worker reads the exact queue
// the deployed app fills.
function makePool(): Pool {
  const connectionString =
    process.env.DATABASE_URL ||
    (process.env.INSTANCE_CONNECTION_NAME
      ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD || '')}@/${process.env.DB_NAME}?host=/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`
      : undefined)
  if (!connectionString) throw new Error('set DATABASE_URL (or the Cloud SQL DB_* vars)')
  return new Pool({ connectionString })
}

// ─── source resolution ────────────────────────────────────────────────────
async function resolveSources(pool: Pool, job: RenderJob, dir: string): Promise<string[]> {
  const files: string[] = []
  for (let i = 0; i < job.clip_ids.length; i++) {
    const id = job.clip_ids[i]
    const r = await pool.query(
      `select cr.youtube_id, c.url_or_path, c.source_type
         from clip_records cr left join clips c on c.id = cr.clip_id
        where cr.id = $1`,
      [id],
    )
    const row = r.rows[0] || {}
    const dest = join(dir, `src_${i}.mp4`)
    if (row.url_or_path && row.source_type === 'upload') {
      await downloadFile(String(row.url_or_path), dest)
    } else if (row.youtube_id) {
      await ytDlp(`https://www.youtube.com/watch?v=${row.youtube_id}`, dest)
    } else if (row.url_or_path) {
      await downloadFile(String(row.url_or_path), dest)
    } else {
      throw new Error(`clip ${id} has no resolvable source`)
    }
    files.push(dest)
  }
  if (files.length < 2) throw new Error('need ≥2 source angles to composite')
  return files
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`)
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

async function ytDlp(url: string, dest: string): Promise<void> {
  await execFileP(YT_DLP, [
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
    '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]',
    '--merge-output-format', 'mp4',
    '-o', dest,
    url,
  ], {
    maxBuffer: 1024 * 1024 * 64,
  })
}

// ─── composite (up to 2x2 grid) ───────────────────────────────────────────
async function probeDuration(source: string): Promise<number> {
  const { stdout } = await execFileP(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    source,
  ])
  const seconds = Number.parseFloat(stdout.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`could not probe duration for ${source}`)
  return seconds
}

async function composite(
  sources: string[],
  out: string,
  reactions: ReactionAudio[],
  durationSeconds: number,
): Promise<void> {
  const n = Math.min(sources.length, 4)
  const inputs = sources.slice(0, n)
  const cols = n <= 1 ? 1 : 2
  const layout =
    n === 2 ? '0_0|w0_0' : n === 3 ? '0_0|w0_0|0_h0' : '0_0|w0_0|0_h0|w0_h0'
  const args: string[] = []
  for (const f of inputs) args.push('-i', f)
  args.push('-i', BRAND_WATERMARK)
  for (const reaction of reactions) args.push('-i', reaction.file)
  const scale = inputs.map((_, i) => `[${i}:v]scale=960:540,setsar=1[v${i}]`).join(';')
  const stackIn = inputs.map((_, i) => `[v${i}]`).join('')
  let filter =
    `${scale};${stackIn}xstack=inputs=${inputs.length}:layout=${layout}[base];` +
    `[${n}:v][base]scale2ref=w=oh*mdar:h=ih*0.055[wm][base2];` +
    `[wm]format=rgba,colorchannelmixer=aa=0.82[brand];` +
    `[base2][brand]overlay=W-w-24:H-h-24[v]`
  let audioMap = ['-map', '0:a?']
  if (reactions.length > 0) {
    const reactionLabels: string[] = []
    filter += ';[0:a]aresample=48000,volume=0.82[game]'
    reactions.forEach((reaction, index) => {
      const inputIndex = n + 1 + index
      const delayMs = Math.max(0, Math.round(durationSeconds * reaction.fraction * 1000))
      filter +=
        `;[${inputIndex}:a]aresample=48000,` +
        `aformat=sample_fmts=fltp:channel_layouts=stereo,volume=1.0,` +
        `adelay=${delayMs}:all=1[reaction${index}]`
      reactionLabels.push(`[reaction${index}]`)
    })
    filter +=
      `;[game]${reactionLabels.join('')}amix=inputs=${1 + reactions.length}:` +
      'duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[mix]'
    audioMap = ['-map', '[mix]']
  }
  args.push(
    '-filter_complex', filter,
    '-map', '[v]',
    ...audioMap,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-shortest', '-y', out,
  )
  console.log('[ffmpeg]', args.join(' '))
  await execFileP(FFMPEG, args, { maxBuffer: 1024 * 1024 * 256 })
  void cols
}

// ─── YouTube upload (fetch-based, no extra deps) ───────────────────────────
async function getAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: required('YOUTUBE_CLIENT_ID'),
      client_secret: required('YOUTUBE_CLIENT_SECRET'),
      refresh_token: required('YOUTUBE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }).toString(),
  })
  if (!res.ok) throw new Error(`google token refresh failed: ${await res.text()}`)
  return ((await res.json()) as { access_token: string }).access_token
}

async function youtubeUpload(filePath: string, title: string, description: string): Promise<string> {
  const accessToken = await getAccessToken()
  const meta = {
    snippet: { title, description, tags: ['ShinobiStriker', 'TKO', 'multi-angle'], categoryId: '20' },
    status: { privacyStatus: 'public', madeForKids: false },
  }
  const fileSize = (await stat(filePath)).size
  const start = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(fileSize),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(meta),
    },
  )
  if (!start.ok) throw new Error(`youtube start failed: ${await start.text()}`)
  const uploadUrl = start.headers.get('Location')
  if (!uploadUrl) throw new Error('youtube: no resumable Location header')
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(fileSize) },
    body: await readFile(filePath),
  })
  if (!put.ok) throw new Error(`youtube upload failed: ${await put.text()}`)
  return ((await put.json()) as { id: string }).id
}

// ─── the injected render function ──────────────────────────────────────────
const renderAndUpload: RenderAndUpload = async (pool, job) => {
  const dir = await mkdtemp(join(tmpdir(), 'tko-render-'))
  try {
    const sources = await resolveSources(pool as Pool, job, dir)
    const out = join(dir, 'combined.mp4')
    const durationSeconds = await probeDuration(sources[0])
    const reactions = await buildVideoReactionAudio(job.match_id)
    await composite(sources, out, reactions, durationSeconds)
    const title = `Shinobi Striker — ${job.clip_ids.length}-angle match | TKO.cam`
    const description =
      `Every angle of one match, assembled automatically by TKO.cam.\n\n` +
      `Upload your own footage and get auto-matched: https://tko.cam`
    const youtubeId = await youtubeUpload(out, title, description)
    return { youtubeId, videoUrl: `https://youtu.be/${youtubeId}` }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// ─── main loop ─────────────────────────────────────────────────────────────
async function main() {
  const once = process.argv.includes('--once')
  const pool = makePool()
  const pollMs = Number(process.env.POLL_MS || 15000)
  console.log(`[render-worker] started (once=${once}, poll=${pollMs}ms)`)
  // Fail fast if creds are missing, before we claim any job.
  required('YOUTUBE_CLIENT_ID'); required('YOUTUBE_CLIENT_SECRET'); required('YOUTUBE_REFRESH_TOKEN')
  // Self-heal: make sure the auto-match + render tables exist (the live DB may
  // predate them). Idempotent, so it is safe on every boot.
  try { await ensureSchema(pool); console.log('[render-worker] schema ensured') }
  catch (e: any) { console.error('[render-worker] ensureSchema failed:', e?.message || e) }
  do {
    const handled = await drainQueue(pool as any, renderAndUpload).catch((e) => {
      console.error('[render-worker] drain error:', e?.message || e)
      return 0
    })
    if (handled) console.log(`[render-worker] handled ${handled} job(s)`)
    if (!once) await sleep(pollMs)
  } while (!once)
  await pool.end()
}

main().catch((e) => { console.error('[render-worker] fatal:', e); process.exit(1) })
