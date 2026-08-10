#!/usr/bin/env tsx
/* eslint-disable no-console */
import 'dotenv/config'
import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import { parseMediaOcrSamples, type MediaAliasCatalogEntry, type MediaOcrSample } from './mediaAnalysis'
import {
  buildMediaSamplingPlan,
  buildYtDlpDownloadAttempts,
  buildYtDlpLiveWindowAttempts,
  isNonRetryableYouTubeAccessError,
  type AnalysisRange,
} from './mediaAnalysisWorker'
import { detectMatchSegments } from './matchDetection'

const execFileP = promisify(execFile)
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'
const TESSERACT = process.env.TESSERACT_PATH || 'tesseract'
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp'

type MediaSource = {
  id: string
  owner_id: string
  live_stream_id?: string | null
  provider: string
  source_kind: string
  source_url: string
  external_id?: string | null
  source_fingerprint: string
  status: string
  recorded_at?: string | null
  created_at?: string | null
  duration_sec?: number | null
  analysis_cursor_sec?: number | null
}

type ClaimedJob = {
  id: string
  attempts: number
  job_kind: 'match_boundaries_v1'
  source: MediaSource
}

type AliasCatalogResponse = {
  aliases: MediaAliasCatalogEntry[]
}

type FrameRef = {
  file: string
  atSec: number
  evidenceRef: string
}

function required(name: string): string {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`missing required env ${name}`)
  return value
}

function apiRoot(): string {
  const configured = String(process.env.TKO_API_BASE || 'https://tko.cam').replace(/\/+$/, '')
  return configured.endsWith('/api') ? configured : `${configured}/api`
}

async function apiJson<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 120_000,
): Promise<T> {
  const response = await fetch(`${apiRoot()}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-tko-service': required('TKO_SERVICE_KEY'),
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`TKO API ${response.status}: ${text.slice(0, 800)}`)
  return (text ? JSON.parse(text) : {}) as T
}

async function claimJob(workerId: string): Promise<ClaimedJob | null> {
  const response = await apiJson<{ job: ClaimedJob | null }>('/internal/media-analysis/jobs/claim', {
    method: 'POST',
    body: JSON.stringify({
      worker_id: workerId,
      lease_seconds: 3_600,
      job_kind: 'match_boundaries_v1',
    }),
  })
  return response.job || null
}

async function completeJob(
  jobId: string,
  ok: boolean,
  cursorSec: number,
  error?: string,
  retryable = true,
): Promise<void> {
  await apiJson(`/internal/media-analysis/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: 'POST',
    body: JSON.stringify({ ok, cursor_sec: cursorSec, error: error || null, retryable }),
  })
}

async function aliasCatalog(sourceId: string): Promise<MediaAliasCatalogEntry[]> {
  const response = await apiJson<AliasCatalogResponse>(
    `/internal/media-analysis/aliases?source_id=${encodeURIComponent(sourceId)}`,
    { method: 'GET' },
  )
  return response.aliases || []
}

function googleStorageHttps(raw: string): string {
  if (!raw.startsWith('gs://')) return raw
  const withoutScheme = raw.slice(5)
  const slash = withoutScheme.indexOf('/')
  if (slash < 1) throw new Error('invalid gs:// media source')
  const bucket = withoutScheme.slice(0, slash)
  const object = withoutScheme.slice(slash + 1).split('/').map(encodeURIComponent).join('/')
  return `https://storage.googleapis.com/${bucket}/${object}`
}

async function downloadHttp(rawUrl: string, destination: string): Promise<void> {
  const url = googleStorageHttps(rawUrl)
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
    headers: { 'user-agent': 'TKOcamMediaWorker/1.0 (+https://tko.cam)' },
  })
  if (!response.ok || !response.body) throw new Error(`media download HTTP ${response.status}`)
  const maximumBytes = Math.max(100 * 1024 * 1024, Number(process.env.MEDIA_MAX_SOURCE_BYTES || 6_000_000_000))
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maximumBytes) throw new Error(`media source exceeds ${maximumBytes} bytes`)
  let received = 0
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += Buffer.byteLength(chunk)
      if (received > maximumBytes) callback(new Error(`media source exceeds ${maximumBytes} bytes`))
      else callback(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(response.body as any), limiter, createWriteStream(destination))
}

function isYouTubeUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')
  } catch {
    return false
  }
}

async function downloadWithYtDlp(url: string, destination: string): Promise<void> {
  const attempts = buildYtDlpDownloadAttempts({
    url,
    destination,
    nodePath: process.env.YT_DLP_NODE_PATH || '/usr/local/bin/node',
    providerHome: process.env.BGUTIL_PROVIDER_HOME || '/opt/bgutil-ytdlp-pot-provider/server',
    cookiesPath: process.env.YOUTUBE_COOKIES_PATH || null,
    ffmpegLocation: FFMPEG,
  })
  const failures: string[] = []
  for (const attempt of attempts) {
    try {
      console.log(`[media-worker] yt-dlp attempt: ${attempt.name}`)
      await execFileP(YT_DLP, attempt.args, {
        timeout: 20 * 60_000,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, TOKEN_TTL: process.env.TOKEN_TTL || '6' },
      })
      const downloaded = await stat(destination)
      if (!downloaded.isFile() || downloaded.size <= 0) {
        throw new Error('yt-dlp completed without producing the requested media file')
      }
      return
    } catch (error) {
      const detail = error as Error & { stderr?: string }
      const message = String(detail.stderr || detail.message || error).replace(/\s+/g, ' ').trim()
      failures.push(`${attempt.name}: ${message.slice(0, 500)}`)
      await rm(destination, { force: true }).catch(() => {})
    }
  }
  const failure = `yt-dlp exhausted ${attempts.length} safe download path(s): ${failures.join(' | ')}`
  if (isNonRetryableYouTubeAccessError(failure)) {
    throw Object.assign(
      new Error(`YouTube blocked cloud retrieval after all configured safe paths: ${failure}`),
      { retryable: false },
    )
  }
  throw new Error(failure)
}

async function downloadLiveWindowWithYtDlp(
  url: string,
  destination: string,
  windowSec: number,
): Promise<void> {
  const attempts = buildYtDlpLiveWindowAttempts({
    url,
    destination,
    nodePath: process.env.YT_DLP_NODE_PATH || '/usr/local/bin/node',
    providerHome: process.env.BGUTIL_PROVIDER_HOME || '/opt/bgutil-ytdlp-pot-provider/server',
    cookiesPath: process.env.YOUTUBE_COOKIES_PATH || null,
    ffmpegLocation: FFMPEG,
  }, windowSec)
  const failures: string[] = []
  for (const attempt of attempts) {
    try {
      console.log(`[media-worker] yt-dlp attempt: ${attempt.name}`)
      await execFileP(YT_DLP, attempt.args, {
        timeout: Math.max(90_000, (windowSec + 75) * 1_000),
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, TOKEN_TTL: process.env.TOKEN_TTL || '6' },
      })
      const downloaded = await stat(destination)
      if (!downloaded.isFile() || downloaded.size <= 0) {
        throw new Error('yt-dlp completed without producing the requested live media file')
      }
      return
    } catch (error) {
      const detail = error as Error & { stderr?: string }
      const message = String(detail.stderr || detail.message || error).replace(/\s+/g, ' ').trim()
      failures.push(`${attempt.name}: ${message.slice(0, 500)}`)
      await rm(destination, { force: true }).catch(() => {})
    }
  }
  const failure = `live snapshot exhausted ${attempts.length} path(s): ${failures.join(' | ')}`
  if (isNonRetryableYouTubeAccessError(failure)) {
    throw Object.assign(new Error(failure), { retryable: false })
  }
  throw new Error(failure)
}

async function resolveSource(source: MediaSource, directory: string): Promise<string> {
  const destination = join(directory, 'source.mp4')
  if (source.provider === 'youtube' || isYouTubeUrl(source.source_url) || source.source_kind.endsWith('_live')) {
    await downloadWithYtDlp(source.source_url, destination)
  } else {
    await downloadHttp(source.source_url, destination)
  }
  return destination
}

async function probeDuration(file: string): Promise<number> {
  const { stdout } = await execFileP(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ], { timeout: 60_000 })
  const duration = Number.parseFloat(String(stdout).trim())
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('ffprobe could not read source duration')
  return duration
}

async function extractRangeFrames(
  source: string,
  directory: string,
  range: AnalysisRange,
  intervalSec: number,
  prefix: string,
): Promise<FrameRef[]> {
  const outputDir = join(directory, prefix)
  await mkdir(outputDir, { recursive: true })
  const length = Math.max(0.1, range.endSec - range.startSec)
  await execFileP(FFMPEG, [
    '-hide_banner', '-loglevel', 'error',
    '-ss', range.startSec.toFixed(3),
    '-i', source,
    '-t', length.toFixed(3),
    '-vf', `fps=1/${intervalSec},scale='min(1280,iw)':-2,unsharp=5:5:0.35`,
    '-q:v', '4',
    '-start_number', '0',
    '-y', join(outputDir, 'frame-%06d.jpg'),
  ], { timeout: 30 * 60_000, maxBuffer: 16 * 1024 * 1024 })
  const files = (await readdir(outputDir))
    .filter((file) => /^frame-\d+\.jpg$/i.test(file))
    .sort()
  return files.map((file, index) => {
    const atSec = Math.min(range.endSec, range.startSec + index * intervalSec)
    return {
      file: join(outputDir, file),
      atSec,
      evidenceRef: `${prefix}/${basename(file)}@${atSec.toFixed(2)}`,
    }
  })
}

async function mapLimit<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let next = 0
  const run = async () => {
    while (next < values.length) {
      const index = next++
      output[index] = await task(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run))
  return output
}

async function ocrFrames(frames: FrameRef[]): Promise<MediaOcrSample[]> {
  const concurrency = Math.max(1, Math.min(4, Number(process.env.MEDIA_OCR_CONCURRENCY || 2)))
  const samples = await mapLimit(frames, concurrency, async (frame) => {
    try {
      const { stdout } = await execFileP(TESSERACT, [
        frame.file, 'stdout', '-l', 'eng', '--psm', '11',
        '-c', 'preserve_interword_spaces=1',
      ], {
        timeout: 45_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, OMP_THREAD_LIMIT: '1' },
      })
      return { atSec: frame.atSec, text: String(stdout || '').trim(), evidenceRef: frame.evidenceRef }
    } catch (error) {
      console.warn(`[media-worker] OCR skipped ${frame.evidenceRef}: ${(error as Error).message}`)
      return { atSec: frame.atSec, text: '', evidenceRef: frame.evidenceRef }
    }
  })
  return samples.filter((sample) => sample.text)
}

function mergeSamples(samples: MediaOcrSample[]): MediaOcrSample[] {
  const merged = new Map<number, MediaOcrSample>()
  for (const sample of samples.sort((a, b) => a.atSec - b.atSec)) {
    const key = Math.round(sample.atSec * 2)
    const previous = merged.get(key)
    if (!previous) {
      merged.set(key, sample)
      continue
    }
    const combined = previous.text.includes(sample.text)
      ? previous.text
      : sample.text.includes(previous.text)
        ? sample.text
        : `${previous.text}\n${sample.text}`
    merged.set(key, {
      atSec: Math.min(previous.atSec, sample.atSec),
      text: combined,
      evidenceRef: `${previous.evidenceRef}|${sample.evidenceRef}`,
    })
  }
  return [...merged.values()].sort((a, b) => a.atSec - b.atSec)
}

async function analyzeSource(job: ClaimedJob): Promise<number> {
  const source = job.source
  if (source.status === 'recording' && source.source_kind.endsWith('_live')) {
    const directory = await mkdtemp(join(tmpdir(), 'tko-live-'))
    try {
      const aliases = await aliasCatalog(source.id)
      const windowSec = Math.max(8, Math.min(60, Number(process.env.MEDIA_LIVE_WINDOW_SECONDS || 24)))
      const localSource = join(directory, 'live-window.mp4')
      await downloadLiveWindowWithYtDlp(source.source_url, localSource, windowSec)
      const duration = await probeDuration(localSource)
      const frames = await extractRangeFrames(
        localSource,
        directory,
        { startSec: 0, endSec: duration },
        Math.max(1, Number(process.env.MEDIA_LIVE_SAMPLE_SECONDS || 2)),
        'live',
      )
      const samples = await ocrFrames(frames)
      if (!samples.length) throw new Error('live OCR returned no readable frames')
      const evidence = parseMediaOcrSamples(samples, aliases, {
        sourceOwnerId: source.owner_id,
        sourceRecordedAt: new Date(),
      })
      const state = await apiJson<{ state?: { phase?: string; match_ref?: string } | null }>(
        '/internal/live-match-state',
        {
          method: 'POST',
          body: JSON.stringify({
            sourceId: source.id,
            observations: evidence.observations,
            participants: evidence.participants,
            combatEvents: evidence.combatEvents,
            results: evidence.results,
            final: false,
            detectorVersion: 'tko-live-tesseract-v1',
            observedAt: new Date().toISOString(),
          }),
        },
        2 * 60_000,
      )
      console.log('[media-worker] live state accepted', JSON.stringify({
        sourceId: source.id,
        streamId: source.live_stream_id || null,
        phase: state.state?.phase || null,
        matchRef: state.state?.match_ref || null,
        samples: samples.length,
        combatEvents: evidence.combatEvents.length,
        results: evidence.results.length,
      }))
      return Number(source.analysis_cursor_sec || 0) + duration
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => {})
    }
  }
  const directory = await mkdtemp(join(tmpdir(), 'tko-media-'))
  try {
    const aliases = await aliasCatalog(source.id)
    const localSource = await resolveSource(source, directory)
    const duration = await probeDuration(localSource)
    const maxCoarseFrames = Number(process.env.MEDIA_MAX_COARSE_FRAMES || 220)
    const maxDenseFrames = Number(process.env.MEDIA_MAX_DENSE_FRAMES || 1_800)
    const coarsePlan = buildMediaSamplingPlan(duration, [], { maxCoarseFrames, maxDenseFrames })
    const coarseFrames = await extractRangeFrames(
      localSource,
      directory,
      { startSec: 0, endSec: duration },
      coarsePlan.coarseIntervalSec,
      'coarse',
    )
    const coarseSamples = await ocrFrames(coarseFrames)
    const coarseEvidence = parseMediaOcrSamples(coarseSamples, aliases, {
      sourceOwnerId: source.owner_id,
      sourceRecordedAt: source.recorded_at || source.created_at || null,
    })
    const coarseSegments = detectMatchSegments(coarseEvidence.observations, { sourceDurationSec: duration })
    const densePlan = buildMediaSamplingPlan(duration, coarseSegments, { maxCoarseFrames, maxDenseFrames })
    console.log('[media-worker] sample plan', JSON.stringify({
      sourceId: source.id,
      duration: Math.round(duration),
      aliases: aliases.length,
      coarseFrames: coarsePlan.estimatedCoarseFrames,
      denseFrames: densePlan.estimatedDenseFrames,
      denseRanges: densePlan.denseRanges.length,
    }))
    const denseFrameGroups = await Promise.all(densePlan.denseRanges.map((range, index) =>
      extractRangeFrames(localSource, directory, range, densePlan.denseIntervalSec, `dense-${index}`),
    ))
    const denseSamples = await ocrFrames(denseFrameGroups.flat())
    const samples = mergeSamples([...coarseSamples, ...denseSamples])
    if (!samples.length) throw new Error('OCR returned no readable frames')
    const evidence = parseMediaOcrSamples(samples, aliases, {
      sourceOwnerId: source.owner_id,
      sourceRecordedAt: source.recorded_at || source.created_at || null,
    })
    const response = await apiJson<{ ingestion?: { segmentIds?: string[] }; matches?: unknown[] }>(
      '/internal/media-evidence',
      {
        method: 'POST',
        body: JSON.stringify({
          sourceId: source.id,
          sourceDurationSec: duration,
          ownerAlias: evidence.ownerAlias,
          observations: evidence.observations,
          participants: evidence.participants,
          combatEvents: evidence.combatEvents,
          results: evidence.results,
          final: true,
          detectorVersion: 'tko-tesseract-ocr-v1',
        }),
      },
      5 * 60_000,
    )
    console.log('[media-worker] evidence accepted', JSON.stringify({
      sourceId: source.id,
      samples: samples.length,
      segments: response.ingestion?.segmentIds?.length || 0,
      participants: evidence.participants.length,
      combatEvents: evidence.combatEvents.length,
      results: evidence.results.length,
    }))
    return duration
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

async function main(): Promise<void> {
  required('TKO_SERVICE_KEY')
  const once = process.argv.includes('--once')
  const workerId = String(process.env.MEDIA_WORKER_ID || `ocr-${hostname()}-${process.pid}`).slice(0, 120)
  const maxJobs = Math.max(1, Math.min(20, Number(process.env.MEDIA_WORKER_MAX_JOBS || 3)))
  const pollMs = Math.max(5_000, Number(process.env.MEDIA_WORKER_POLL_MS || 30_000))
  console.log(`[media-worker] started id=${workerId} once=${once} maxJobs=${maxJobs}`)
  do {
    let handled = 0
    while (handled < maxJobs) {
      const job = await claimJob(workerId)
      if (!job) break
      handled++
      try {
        const cursor = await analyzeSource(job)
        await completeJob(job.id, true, cursor)
      } catch (error) {
        const message = (error as Error).message || String(error)
        const retryable = (error as Error & { retryable?: boolean }).retryable !== false
        console.error(`[media-worker] job ${job.id} failed:`, message)
        await completeJob(
          job.id,
          false,
          Number(job.source.analysis_cursor_sec || 0),
          message,
          retryable,
        ).catch((completionError) => {
          console.error(`[media-worker] could not record job failure ${job.id}:`, completionError)
        })
      }
    }
    if (handled) console.log(`[media-worker] handled ${handled} job(s)`)
    if (!once) await sleep(pollMs)
  } while (!once)
}

main().catch((error) => {
  console.error('[media-worker] fatal:', error)
  process.exit(1)
})
