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
import {
  assertRenderJobHasCombatEvidence,
  drainQueue,
  type RenderAndUpload,
  type RenderJob,
} from './renderWorker'
import { ensureSchema } from './ensureSchema'
import { buildVideoReactionAudio, type ReactionAudio } from './tkoReactions'
import { resolveAutoReelPolicy, type AutoReelPolicy } from './autoReelPolicy'

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
type ResolvedSource = {
  file: string
  clipRecordId: string
  sourceId: string | null
  segmentId: string | null
  segmentStart: number
  segmentEnd: number | null
  highlightAt: number | null
  highlightConfidence: number
}

type RenderInput = ResolvedSource & {
  start: number
  duration: number
}

function finiteNumber(value: unknown, fallback: number | null = null): number | null {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

async function resolveSources(pool: Pool, job: RenderJob, dir: string): Promise<ResolvedSource[]> {
  const sources: ResolvedSource[] = []
  for (let i = 0; i < job.clip_ids.length; i++) {
    const id = job.clip_ids[i]
    const r = await pool.query(
      `select cr.youtube_id,cr.source_id,cr.segment_id,
              cr.source_start_sec,cr.source_end_sec,c.url_or_path,c.source_type
         from clip_records cr left join clips c on c.id = cr.clip_id
        where cr.id = $1`,
      [id],
    )
    const row = r.rows[0] || {}
    const dest = join(dir, `src_${i}.mp4`)
    try {
      if (row.url_or_path && row.source_type === 'upload') {
        await downloadFile(String(row.url_or_path), dest)
      } else if (row.youtube_id) {
        await ytDlp(`https://www.youtube.com/watch?v=${row.youtube_id}`, dest)
      } else if (row.url_or_path) {
        await downloadFile(String(row.url_or_path), dest)
      } else {
        throw new Error(`clip ${id} has no resolvable source`)
      }
    } catch (error: any) {
      console.warn(`[render-worker] skipping unavailable angle ${id}:`, error?.message || error)
      continue
    }
    sources.push({
      file: dest,
      clipRecordId: String(id),
      sourceId: row.source_id ? String(row.source_id) : null,
      segmentId: row.segment_id ? String(row.segment_id) : null,
      segmentStart: Math.max(0, finiteNumber(row.source_start_sec, 0) ?? 0),
      segmentEnd: finiteNumber(row.source_end_sec),
      highlightAt: null,
      highlightConfidence: 0,
    })
  }
  if (sources.length === 0) throw new Error('render job has no resolvable source angles')
  return sources
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

async function attachHighlightEvents(
  pool: Pool,
  matchId: string,
  sources: ResolvedSource[],
): Promise<void> {
  const verified = await pool.query(
    `select match_clock_sec,confidence
       from verified_combat_events
      where match_group_id=$1 and event_type='ko'
      order by confidence desc,evidence_count desc,match_clock_sec desc
      limit 1`,
    [matchId],
  )
  const targetClock = finiteNumber(verified.rows[0]?.match_clock_sec)
  const raw = await pool.query(
    `select source_id,segment_id,at_sec,match_clock_sec,confidence,event_type
       from combat_events
      where match_group_id=$1
        and event_type in ('ko','death')
        and verification_status <> 'ambiguous'
      order by confidence desc,at_sec desc`,
    [matchId],
  )

  for (const source of sources) {
    const candidates = raw.rows.filter((row) =>
      (source.sourceId && String(row.source_id) === source.sourceId) ||
      (source.segmentId && String(row.segment_id) === source.segmentId),
    )
    candidates.sort((a, b) => {
      if (targetClock != null) {
        const aClock = finiteNumber(a.match_clock_sec)
        const bClock = finiteNumber(b.match_clock_sec)
        const aDistance = aClock == null ? Number.POSITIVE_INFINITY : Math.abs(aClock - targetClock)
        const bDistance = bClock == null ? Number.POSITIVE_INFINITY : Math.abs(bClock - targetClock)
        if (aDistance !== bDistance) return aDistance - bDistance
      }
      return (finiteNumber(b.confidence, 0) ?? 0) - (finiteNumber(a.confidence, 0) ?? 0)
    })
    const event = candidates[0]
    if (!event) continue
    source.highlightAt = finiteNumber(event.at_sec)
    source.highlightConfidence = finiteNumber(event.confidence, 0) ?? 0
  }
}

async function prepareRenderInputs(
  sources: ResolvedSource[],
  policy: AutoReelPolicy,
): Promise<{ inputs: RenderInput[]; durationSeconds: number }> {
  const prepared: RenderInput[] = []
  for (const source of sources) {
    const fileDuration = await probeDuration(source.file)
    const segmentStart = Math.min(source.segmentStart, Math.max(0, fileDuration - 0.25))
    const requestedEnd = source.segmentEnd == null ? fileDuration : source.segmentEnd
    const segmentEnd = Math.max(segmentStart + 0.25, Math.min(requestedEnd, fileDuration))
    const available = segmentEnd - segmentStart
    if (available < 1) continue

    const requestedDuration = policy.maxDurationSeconds == null
      ? available
      : Math.min(policy.maxDurationSeconds, available)
    const latestStart = Math.max(segmentStart, segmentEnd - requestedDuration)
    const desiredStart = source.highlightAt == null
      ? segmentStart
      : source.highlightAt - policy.preRollSeconds
    const start = Math.max(segmentStart, Math.min(desiredStart, latestStart))
    const duration = Math.min(requestedDuration, segmentEnd - start)
    if (duration < 1) continue
    prepared.push({ ...source, segmentStart, segmentEnd, start, duration })
  }

  prepared.sort((a, b) => {
    const aHasHighlight = a.highlightAt == null ? 0 : 1
    const bHasHighlight = b.highlightAt == null ? 0 : 1
    if (aHasHighlight !== bHasHighlight) return bHasHighlight - aHasHighlight
    if (a.highlightConfidence !== b.highlightConfidence) {
      return b.highlightConfidence - a.highlightConfidence
    }
    return b.duration - a.duration
  })

  const inputs = prepared.slice(0, Math.max(1, policy.maxAngles))
  if (inputs.length === 0) throw new Error('no usable source windows remain after segment trimming')
  if (policy.orientation === 'landscape') inputs.sort((a, b) => b.duration - a.duration)
  const durations = inputs.map((input) => input.duration)
  const durationSeconds = policy.orientation === 'vertical'
    ? Math.min(...durations)
    : Math.max(...durations)
  return { inputs, durationSeconds }
}

async function composite(
  sources: RenderInput[],
  out: string,
  reactions: ReactionAudio[],
  durationSeconds: number,
  policy: AutoReelPolicy,
): Promise<void> {
  const n = Math.min(sources.length, policy.maxAngles, 4)
  const inputs = sources.slice(0, n)
  const args: string[] = []
  for (const input of inputs) {
    args.push(
      '-ss', input.start.toFixed(3),
      '-t', Math.min(input.duration, durationSeconds).toFixed(3),
      '-i', input.file,
    )
  }
  args.push('-i', BRAND_WATERMARK)
  for (const reaction of reactions) args.push('-i', reaction.file)
  const duration = durationSeconds.toFixed(3)
  const filterParts = inputs.map((_, i) =>
    `[${i}:v]setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${duration},` +
    `trim=duration=${duration},setsar=1[src${i}]`,
  )

  if (policy.orientation === 'vertical') {
    filterParts.push(
      `[src0]split=2[front0][back0]`,
      `[back0]scale=${policy.width}:${policy.height}:force_original_aspect_ratio=increase,` +
        `crop=${policy.width}:${policy.height},gblur=sigma=28,eq=brightness=-0.24[bg]`,
    )
    if (n === 1) {
      filterParts.push(
        `[front0]scale=${policy.width}:-2[panel0]`,
        `[bg][panel0]overlay=0:(H-h)/2[base]`,
      )
    } else {
      filterParts.push(
        `[front0]scale=${policy.width}:540:force_original_aspect_ratio=decrease,` +
          `pad=${policy.width}:540:(ow-iw)/2:(oh-ih)/2:color=black[panel0]`,
        `[src1]scale=${policy.width}:540:force_original_aspect_ratio=decrease,` +
          `pad=${policy.width}:540:(ow-iw)/2:(oh-ih)/2:color=black[panel1]`,
        `[bg][panel0]overlay=0:360[vertical1]`,
        `[vertical1][panel1]overlay=0:1020[base]`,
      )
    }
  } else if (n === 1) {
    filterParts.push(
      `[src0]scale=${policy.width}:${policy.height}:force_original_aspect_ratio=decrease,` +
        `pad=${policy.width}:${policy.height}:(ow-iw)/2:(oh-ih)/2:color=black[base]`,
    )
  } else if (n === 2) {
    filterParts.push(
      `[src0]scale=960:1080:force_original_aspect_ratio=decrease,` +
        `pad=960:1080:(ow-iw)/2:(oh-ih)/2:color=black[panel0]`,
      `[src1]scale=960:1080:force_original_aspect_ratio=decrease,` +
        `pad=960:1080:(ow-iw)/2:(oh-ih)/2:color=black[panel1]`,
      `[panel0][panel1]xstack=inputs=2:layout=0_0|w0_0:fill=black[base]`,
    )
  } else {
    const layout = n === 3 ? '0_0|w0_0|0_h0' : '0_0|w0_0|0_h0|w0_h0'
    inputs.forEach((_, index) => {
      filterParts.push(
        `[src${index}]scale=960:540:force_original_aspect_ratio=decrease,` +
          `pad=960:540:(ow-iw)/2:(oh-ih)/2:color=black[panel${index}]`,
      )
    })
    const panels = inputs.map((_, index) => `[panel${index}]`).join('')
    filterParts.push(`${panels}xstack=inputs=${n}:layout=${layout}:fill=black[base]`)
  }

  filterParts.push(
    `[${n}:v]format=rgba,colorchannelmixer=aa=0.76[brand]`,
    `[brand][base]scale2ref=w=oh*mdar:h=ih*0.045[wm][base2]`,
    `[base2][wm]overlay=W-w-20:H-h-20[v]`,
  )
  let audioMap = ['-map', '0:a?']
  if (reactions.length > 0) {
    const reactionLabels: string[] = []
    filterParts.push(`[0:a]aresample=48000,atrim=duration=${duration},volume=0.82[game]`)
    reactions.forEach((reaction, index) => {
      const inputIndex = n + 1 + index
      const delayMs = Math.max(0, Math.round(durationSeconds * reaction.fraction * 1000))
      filterParts.push(
        `;[${inputIndex}:a]aresample=48000,` +
        `aformat=sample_fmts=fltp:channel_layouts=stereo,volume=1.0,` +
        `adelay=${delayMs}:all=1[reaction${index}]`,
      )
      reactionLabels.push(`[reaction${index}]`)
    })
    filterParts.push(
      `;[game]${reactionLabels.join('')}amix=inputs=${1 + reactions.length}:` +
      'duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[mix]',
    )
    audioMap = ['-map', '[mix]']
  }
  const filter = filterParts.join(';').replaceAll(';;', ';')
  args.push(
    '-filter_complex', filter,
    '-map', '[v]',
    ...audioMap,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-t', duration, '-movflags', '+faststart', '-y', out,
  )
  console.log('[ffmpeg]', args.join(' '))
  await execFileP(FFMPEG, args, { maxBuffer: 1024 * 1024 * 256 })
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

async function youtubeUpload(
  filePath: string,
  title: string,
  description: string,
  shortForm: boolean,
): Promise<string> {
  const accessToken = await getAccessToken()
  const meta = {
    snippet: {
      title,
      description,
      tags: ['ShinobiStriker', 'TKO', 'multi-angle', ...(shortForm ? ['Shorts'] : [])],
      categoryId: '20',
    },
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
    // This check runs before downloads, FFmpeg, OAuth, or YouTube quota use.
    await assertRenderJobHasCombatEvidence(pool, job)
    const policy = await resolveAutoReelPolicy(pool as Pool, job.participant_ids)
    if (!policy.automatic) {
      throw new Error('automatic rendering requires an active Pro, Elite, or Legend membership')
    }
    const sources = await resolveSources(pool as Pool, job, dir)
    await attachHighlightEvents(pool as Pool, job.match_id, sources)
    const prepared = await prepareRenderInputs(sources, policy)
    const out = join(dir, 'combined.mp4')
    const reactions = await buildVideoReactionAudio(job.match_id, policy.reactionCount)
    await composite(prepared.inputs, out, reactions, prepared.durationSeconds, policy)
    const title = `Shinobi Striker — ${job.clip_ids.length}-angle match | TKO.cam`
    const description =
      `Every angle of one match, assembled automatically by TKO.cam.\n\n` +
      `Upload your own footage and get auto-matched: https://tko.cam`
    const shortForm = policy.orientation === 'vertical'
    const publishTitle = shortForm
      ? `TKO ${policy.profile === 'quick_vertical' ? 'Quick Cut' : 'Enhanced Cut'} #Shorts`
      : `Shinobi Striker - ${prepared.inputs.length}-angle TKO Director Cut`
    const publishDescription =
      `One match, ${prepared.inputs.length} verified angle${prepared.inputs.length === 1 ? '' : 's'}, ` +
      `assembled automatically by TKO.cam (${policy.profile}).\n\n` + description
    const youtubeId = await youtubeUpload(out, publishTitle || title, publishDescription, shortForm)
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
