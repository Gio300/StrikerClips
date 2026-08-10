import { describe, expect, it } from 'vitest'
import {
  buildMediaSamplingPlan,
  buildYtDlpDownloadAttempts,
  buildYtDlpLiveWindowAttempts,
  isNonRetryableYouTubeAccessError,
} from './mediaAnalysisWorker'

describe('media analysis sampling plan', () => {
  it('samples ordinary matches densely enough to catch short result overlays', () => {
    const plan = buildMediaSamplingPlan(600, [], { maxCoarseFrames: 220, maxDenseFrames: 1_800 })
    expect(plan.coarseIntervalSec).toBe(6)
    expect(plan.denseIntervalSec).toBe(2)
    expect(plan.denseRanges).toEqual([{ startSec: 0, endSec: 600 }])
    expect(plan.estimatedDenseFrames).toBe(300)
  })

  it('focuses the dense pass on detected matches inside a long PS4 recording', () => {
    const plan = buildMediaSamplingPlan(7_200, [
      { startSec: 600, endSec: 960 },
      { startSec: 1_800, endSec: 2_220 },
    ])
    expect(plan.coarseIntervalSec).toBe(33)
    expect(plan.denseIntervalSec).toBe(2)
    expect(plan.denseRanges).toEqual([
      { startSec: 596, endSec: 964 },
      { startSec: 1_796, endSec: 2_224 },
    ])
    expect(plan.estimatedDenseFrames).toBe(398)
  })

  it('caps dense OCR work for a long source without known boundaries', () => {
    const plan = buildMediaSamplingPlan(14_400, [], { maxDenseFrames: 1_800 })
    expect(plan.denseIntervalSec).toBe(8)
    expect(plan.estimatedDenseFrames).toBe(1_800)
  })
})

describe('media worker YouTube download paths', () => {
  it('tries the automatic token provider before the account-free fallback', () => {
    const attempts = buildYtDlpDownloadAttempts({
      url: 'https://youtu.be/example',
      destination: '/tmp/source.mp4',
      ffmpegLocation: '/opt/ffmpeg/bin/ffmpeg',
    })
    expect(attempts.map((attempt) => attempt.name)).toEqual([
      'automatic proof-of-origin token',
      'account-free Android VR fallback',
      'default public-video fallback',
    ])
    expect(attempts[0].args).toContain('youtubepot-bgutilscript:server_home=/opt/bgutil-ytdlp-pot-provider/server')
    expect(attempts[0].args).toContain('youtube:player_client=mweb')
    expect(attempts[0].args).toContain('node:/usr/local/bin/node')
    expect(attempts[1].args).toContain('youtube:player_client=android_vr;player_skip=webpage')
    expect(attempts[2].args).toContain('--ffmpeg-location')
    expect(attempts[2].args).toContain('/opt/ffmpeg/bin/ffmpeg')
  })

  it('only enables account cookies when an explicit file is configured', () => {
    const attempts = buildYtDlpDownloadAttempts({
      url: 'https://youtu.be/example',
      destination: '/tmp/source.mp4',
      cookiesPath: '/secrets/youtube-cookies.txt',
    })
    expect(attempts).toHaveLength(4)
    expect(attempts[3].args).toContain('--cookies')
    expect(attempts[3].args).toContain('/secrets/youtube-cookies.txt')
  })

  it('recognizes a cloud access wall as terminal but leaves ordinary failures retryable', () => {
    expect(isNonRetryableYouTubeAccessError('Sign in to confirm you are not a bot')).toBe(true)
    expect(isNonRetryableYouTubeAccessError('HTTP Error 403: Forbidden')).toBe(true)
    expect(isNonRetryableYouTubeAccessError('temporary network timeout')).toBe(false)
  })

  it('hard-limits an active broadcast capture so a worker cannot follow it forever', () => {
    const attempts = buildYtDlpLiveWindowAttempts({
      url: 'https://youtube.com/@caster/live',
      destination: '/tmp/live-window.mp4',
    }, 24)
    expect(attempts).toHaveLength(3)
    for (const attempt of attempts) {
      expect(attempt.name).toContain('24s live window')
      expect(attempt.args).toContain('--downloader')
      expect(attempt.args).toContain('ffmpeg')
      expect(attempt.args).toContain('--downloader-args')
      expect(attempt.args).toContain('ffmpeg_o:-t 24')
      expect(attempt.args.at(-1)).toBe('https://youtube.com/@caster/live')
    }
  })
})
