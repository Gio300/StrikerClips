#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * youtube-uploader.ts — picks rows out of `public.pending_uploads`,
 * downloads the source video(s) referenced on the reel, bakes a multi-angle
 * composite with ffmpeg, uploads to the ReelOne YouTube channel, and writes
 * the resulting `youtube_video_id` back to the row.
 *
 * Operator setup is documented in `docs/youtube-uploader.md`. Required env:
 *
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY     # bypasses RLS so we can update any row
 *   YOUTUBE_CLIENT_ID
 *   YOUTUBE_CLIENT_SECRET
 *   YOUTUBE_REFRESH_TOKEN         # generated once via OAuth playground
 *   YOUTUBE_CHANNEL_ID            # cosmetic — used in description
 *   FFMPEG_PATH                   # optional; defaults to imageio-ffmpeg if absent
 *
 * Run:
 *   npm run youtube-uploader
 *   npm run youtube-uploader -- --once   # process the queue, then exit
 *
 * The worker is intentionally simple: one reel at a time, no concurrency.
 * Long-form encoding + the YouTube API both top out at single-stream
 * throughput from a small VPS, so threading wouldn't help.
 */

import 'dotenv/config'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import process from 'node:process'

const execFileP = promisify(execFile)

interface ReelRow {
  id: string
  title: string
  description: string | null
  user_id: string
  clip_ids: string[] | null
  layout: string | null
  combined_video_url: string | null
}

interface ClipRow {
  id: string
  url_or_path: string
  source_type: 'youtube' | 'upload' | string
  start_sec: number | null
  end_sec: number | null
}

interface PendingUploadRow {
  id: string
  reel_id: string
  status: 'queued' | 'processing' | 'uploaded' | 'failed'
  attempts: number
}

const SUPABASE_URL = required('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = required('SUPABASE_SERVICE_ROLE_KEY')
const YOUTUBE_CLIENT_ID = required('YOUTUBE_CLIENT_ID')
const YOUTUBE_CLIENT_SECRET = required('YOUTUBE_CLIENT_SECRET')
const YOUTUBE_REFRESH_TOKEN = required('YOUTUBE_REFRESH_TOKEN')
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'
const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const onceFlag = process.argv.includes('--once')

main().catch((err) => {
  console.error('[uploader] fatal:', err)
  process.exit(1)
})

async function main() {
  console.log('[uploader] starting; supabase=', SUPABASE_URL)
  for (;;) {
    const { data: queue, error } = await supabase
      .from('pending_uploads')
      .select('id, reel_id, status, attempts')
      .eq('status', 'queued')
      .order('queued_at', { ascending: true })
      .limit(1)

    if (error) {
      console.error('[uploader] queue read error:', error.message)
    } else if (queue && queue.length > 0) {
      await processOne(queue[0] as PendingUploadRow)
    } else if (onceFlag) {
      console.log('[uploader] queue empty — exiting because --once')
      return
    } else {
      console.log('[uploader] queue empty; sleeping 30s')
      await sleep(30_000)
      continue
    }

    if (onceFlag) return
    await sleep(2_000)
  }
}

async function processOne(row: PendingUploadRow) {
  console.log(`[uploader] picking up ${row.id} (reel ${row.reel_id})`)
  await supabase
    .from('pending_uploads')
    .update({ status: 'processing', attempts: row.attempts + 1 })
    .eq('id', row.id)

  let workdir: string | null = null
  try {
    const reel = await fetchReel(row.reel_id)
    const clips = await fetchClips(reel.clip_ids ?? [])
    const youtubeClips = clips.filter((c) => c.source_type === 'youtube')
    if (youtubeClips.length === 0) {
      throw new Error('No YouTube source clips on reel — uploader requires at least one yt-dlp-able URL.')
    }

    workdir = await mkdtemp(join(tmpdir(), 'reelone-upload-'))
    console.log(`[uploader] workdir ${workdir}`)

    // 1. Download each source clip with yt-dlp.
    const localFiles: string[] = []
    for (const c of youtubeClips) {
      const localPath = join(workdir, `${c.id}.mp4`)
      await execFileP(YT_DLP_PATH, [
        '-f', 'bv*[height<=1080]+ba/b[height<=1080]/best',
        '--merge-output-format', 'mp4',
        '-o', localPath,
        c.url_or_path,
      ], { maxBuffer: 1024 * 1024 * 64 })
      localFiles.push(localPath)
    }

    // 2. Bake composite. We keep this simple: if the reel uses an existing
    //    `combined_video_url` (already a baked mp4 stored in Supabase Storage)
    //    we just download that. Otherwise we fall back to a 2x2 grid for up
    //    to 4 angles, or single source for 1 angle.
    const finalPath = join(workdir, 'final.mp4')
    if (reel.combined_video_url && /\.(mp4|webm|mov)$/i.test(reel.combined_video_url)) {
      await downloadFile(reel.combined_video_url, finalPath)
    } else if (localFiles.length === 1) {
      // Single-source: re-encode for YouTube-friendly settings.
      await runFfmpeg([
        '-y',
        '-i', localFiles[0],
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-c:a', 'aac', '-b:a', '160k',
        finalPath,
      ])
    } else {
      // 2x2 (or up to 2x2) grid using xstack.
      const inputs = localFiles.slice(0, 4)
      const args: string[] = ['-y']
      for (const f of inputs) args.push('-i', f)
      const layout = inputs.length === 2
        ? '0_0|w0_0'
        : inputs.length === 3
          ? '0_0|w0_0|0_h0'
          : '0_0|w0_0|0_h0|w0_h0'
      const filter =
        inputs
          .map((_, i) => `[${i}:v]scale=960:540,setsar=1[v${i}]`)
          .join(';') +
        ';' +
        inputs.map((_, i) => `[v${i}]`).join('') +
        `xstack=inputs=${inputs.length}:layout=${layout}[v];` +
        inputs.map((_, i) => `[${i}:a]`).join('') +
        `amix=inputs=${inputs.length}:dropout_transition=0[a]`
      args.push(
        '-filter_complex', filter,
        '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-c:a', 'aac', '-b:a', '160k',
        finalPath,
      )
      await runFfmpeg(args)
    }

    // 3. Upload to YouTube.
    const accessToken = await getAccessToken()
    const ownerHandle = await fetchOwnerHandle(reel.user_id)
    const description = (reel.description ?? '').trim() +
      `\n\nOriginal angle by @${ownerHandle ?? 'reelone-creator'} on ReelOne.\n` +
      `Multi-angle composite generated automatically. https://reelone.app/reels/${reel.id}`
    const videoId = await youtubeUpload({
      accessToken,
      filePath: finalPath,
      title: reel.title.slice(0, 95),
      description: description.slice(0, 4900),
      tags: ['ReelOne', 'gaming', 'highlight'],
    })

    await supabase
      .from('pending_uploads')
      .update({
        status: 'uploaded',
        youtube_video_id: videoId,
        uploaded_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    console.log(`[uploader] reel ${row.reel_id} uploaded as https://youtu.be/${videoId}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[uploader] reel ${row.reel_id} failed:`, message)
    await supabase
      .from('pending_uploads')
      .update({ status: 'failed', error: message })
      .eq('id', row.id)
  } finally {
    if (workdir) {
      try { await rm(workdir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }
}

// ─── Supabase helpers ────────────────────────────────────────────────────

async function fetchReel(reelId: string): Promise<ReelRow> {
  const { data, error } = await supabase
    .from('reels')
    .select('id, title, description, user_id, clip_ids, layout, combined_video_url')
    .eq('id', reelId)
    .single()
  if (error || !data) throw new Error(`reel ${reelId} not found: ${error?.message}`)
  return data as ReelRow
}

async function fetchClips(ids: string[]): Promise<ClipRow[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('clips')
    .select('id, url_or_path, source_type, start_sec, end_sec')
    .in('id', ids)
  if (error) throw error
  return (data ?? []) as ClipRow[]
}

async function fetchOwnerHandle(userId: string): Promise<string | null> {
  const { data } = await supabase.from('profiles').select('username').eq('id', userId).maybeSingle()
  return (data?.username as string | undefined) ?? null
}

// ─── ffmpeg helpers ─────────────────────────────────────────────────────

async function runFfmpeg(args: string[]): Promise<void> {
  console.log('[ffmpeg]', args.join(' '))
  await execFileP(FFMPEG_PATH, args, { maxBuffer: 1024 * 1024 * 256 })
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(dest, buf)
}

// ─── YouTube helpers ────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    client_id: YOUTUBE_CLIENT_ID,
    client_secret: YOUTUBE_CLIENT_SECRET,
    refresh_token: YOUTUBE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!res.ok) throw new Error(`google token refresh failed: ${await res.text()}`)
  const json = await res.json() as { access_token: string }
  return json.access_token
}

interface UploadInput {
  accessToken: string
  filePath: string
  title: string
  description: string
  tags: string[]
}

async function youtubeUpload(input: UploadInput): Promise<string> {
  const meta = {
    snippet: {
      title: input.title,
      description: input.description,
      tags: input.tags,
      categoryId: '20', // "Gaming"
    },
    status: { privacyStatus: 'public', madeForKids: false },
  }

  const fileSize = (await stat(input.filePath)).size
  // Resumable upload: step 1 — start the session.
  const startRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(fileSize),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(meta),
    },
  )
  if (!startRes.ok) throw new Error(`youtube start failed: ${await startRes.text()}`)
  const uploadUrl = startRes.headers.get('Location')
  if (!uploadUrl) throw new Error('youtube did not return resumable Location header')

  // Step 2 — push the bytes in one shot. Files are small enough (<1 GB)
  // that single-shot is reliable; switch to chunks if you go larger.
  const fileBuf = await readFile(input.filePath)
  const finalRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(fileSize),
    },
    body: fileBuf,
  })
  if (!finalRes.ok) throw new Error(`youtube upload failed: ${await finalRes.text()}`)
  const json = await finalRes.json() as { id: string }
  return json.id
}

// ─── tiny utils ─────────────────────────────────────────────────────────

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`[uploader] missing required env var ${name}`)
    process.exit(1)
  }
  return v
}

// Make the SupabaseClient type usage explicit for editors that get confused.
export type _Unused = SupabaseClient
