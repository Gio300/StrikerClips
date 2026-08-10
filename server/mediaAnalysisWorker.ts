import type { DetectedMatchSegment } from './matchDetection'

export type AnalysisRange = { startSec: number; endSec: number }

export type MediaSamplingPlan = {
  coarseIntervalSec: number
  denseIntervalSec: number
  denseRanges: AnalysisRange[]
  estimatedCoarseFrames: number
  estimatedDenseFrames: number
}

export type YtDlpDownloadAttempt = {
  name: string
  args: string[]
}

export type YtDlpDownloadOptions = {
  url: string
  destination: string
  nodePath?: string
  providerHome?: string
  cookiesPath?: string | null
  ffmpegLocation?: string | null
}

export function isNonRetryableYouTubeAccessError(message: string): boolean {
  const value = String(message || '').toLowerCase()
  return value.includes('sign in to confirm you')
    || value.includes('not a bot')
    || value.includes('failed to extract any player response')
    || value.includes('http error 403')
}

function boundedPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function mergeRanges(ranges: AnalysisRange[]): AnalysisRange[] {
  const sorted = ranges
    .filter((range) => range.endSec > range.startSec)
    .sort((a, b) => a.startSec - b.startSec)
  const merged: AnalysisRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (!previous || range.startSec > previous.endSec + 2) {
      merged.push({ ...range })
    } else {
      previous.endSec = Math.max(previous.endSec, range.endSec)
    }
  }
  return merged
}

export function buildMediaSamplingPlan(
  durationSec: number,
  segments: Array<Pick<DetectedMatchSegment, 'startSec' | 'endSec'>> = [],
  options: { maxCoarseFrames?: number; maxDenseFrames?: number } = {},
): MediaSamplingPlan {
  const duration = boundedPositive(durationSec, 1)
  const maxCoarseFrames = Math.max(30, Math.round(options.maxCoarseFrames || 220))
  const maxDenseFrames = Math.max(60, Math.round(options.maxDenseFrames || 1_800))
  const coarseIntervalSec = Math.max(6, Math.ceil(duration / maxCoarseFrames))
  const padded = segments.length
    ? segments.map((segment) => ({
        startSec: Math.max(0, segment.startSec - 4),
        endSec: Math.min(duration, segment.endSec + 4),
      }))
    : [{ startSec: 0, endSec: duration }]
  const denseRanges = mergeRanges(padded)
  const denseDuration = denseRanges.reduce((total, range) => total + range.endSec - range.startSec, 0)
  const denseIntervalSec = Math.max(2, Math.ceil(denseDuration / maxDenseFrames))
  return {
    coarseIntervalSec,
    denseIntervalSec,
    denseRanges,
    estimatedCoarseFrames: Math.ceil(duration / coarseIntervalSec),
    estimatedDenseFrames: Math.ceil(denseDuration / denseIntervalSec),
  }
}

export function buildYtDlpDownloadAttempts(options: YtDlpDownloadOptions): YtDlpDownloadAttempt[] {
  const nodePath = options.nodePath || '/usr/local/bin/node'
  const providerHome = options.providerHome || '/opt/bgutil-ytdlp-pot-provider/server'
  const common = [
    '--ignore-config',
    '--no-playlist',
    '--js-runtimes', `node:${nodePath}`,
    '--remote-components', 'ejs:github',
    '--socket-timeout', '30',
    '--retries', '3',
    '--fragment-retries', '3',
    '--force-overwrites',
    ...(options.ffmpegLocation ? ['--ffmpeg-location', options.ffmpegLocation] : []),
    '-f', 'bv*[height<=720]+ba/b[height<=720]/best[height<=720]',
    '--merge-output-format', 'mp4',
    '-o', options.destination,
  ]
  const providerArgs = [
    '--extractor-args', `youtubepot-bgutilscript:server_home=${providerHome}`,
  ]
  const attempts: YtDlpDownloadAttempt[] = [
    {
      name: 'automatic proof-of-origin token',
      args: [
        ...common,
        ...providerArgs,
        '--extractor-args', 'youtube:player_client=mweb',
        options.url,
      ],
    },
    {
      name: 'account-free Android VR fallback',
      args: [
        ...common,
        '--extractor-args', 'youtube:player_client=android_vr;player_skip=webpage',
        options.url,
      ],
    },
    {
      // Completed livestream archives can be public and downloadable through
      // yt-dlp's normal extractor even when the forced mweb client reports
      // "live event has ended" and the Android client hits a bot wall.
      name: 'default public-video fallback',
      args: [...common, options.url],
    },
  ]
  if (options.cookiesPath) {
    attempts.push({
      name: 'explicit cookie fallback',
      args: [
        ...common,
        ...providerArgs,
        '--cookies', options.cookiesPath,
        '--extractor-args', 'youtube:player_client=web,web_safari',
        options.url,
      ],
    })
  }
  return attempts
}

/**
 * Capture a short window from an active broadcast. A normal yt-dlp invocation
 * follows a live HLS playlist until the broadcast ends, which would pin a
 * worker indefinitely. These attempts use ffmpeg as the external downloader
 * and put a hard duration on its output.
 */
export function buildYtDlpLiveWindowAttempts(
  options: YtDlpDownloadOptions,
  windowSec = 24,
): YtDlpDownloadAttempt[] {
  const duration = Math.max(8, Math.min(60, Math.round(windowSec)))
  return buildYtDlpDownloadAttempts(options).map((attempt) => {
    const args = [...attempt.args]
    const url = args.pop()
    return {
      name: `${attempt.name} (${duration}s live window)`,
      args: [
        ...args,
        '--downloader', 'ffmpeg',
        '--downloader-args', `ffmpeg_o:-t ${duration}`,
        String(url || options.url),
      ],
    }
  })
}
