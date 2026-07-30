import { describe, expect, it } from 'vitest'
import { externalVideoLinksIn, parseExternalVideoUrl } from './ExternalVideoPreview'

describe('parseExternalVideoUrl', () => {
  it('builds a privacy-friendly YouTube embed from a structured URL', () => {
    const video = parseExternalVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(video).toMatchObject({
      platform: 'YouTube',
      portrait: false,
    })
    expect(video?.embedUrl).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })

  it('embeds Facebook share videos without injecting post HTML', () => {
    const video = parseExternalVideoUrl('https://www.facebook.com/share/v/1JvE3Q9X3V/')
    expect(video?.platform).toBe('Facebook')
    expect(video?.embedUrl).toContain('facebook.com/plugins/video.php?')
    expect(video?.embedUrl).toContain('href=')
  })

  it('supports Instagram reels and TikTok video IDs', () => {
    expect(parseExternalVideoUrl('https://www.instagram.com/reel/ABC_def-12/')?.embedUrl)
      .toBe('https://www.instagram.com/reel/ABC_def-12/embed/')
    expect(parseExternalVideoUrl('https://www.tiktok.com/@player/video/7481234567890123456')?.embedUrl)
      .toContain('/player/v1/7481234567890123456')
  })

  it('uses a compact fallback for shortened TikTok links', () => {
    expect(parseExternalVideoUrl('https://vm.tiktok.com/ZM123abc/')).toMatchObject({
      platform: 'TikTok',
      embedUrl: null,
    })
  })

  it('rejects unsafe protocols, lookalike hosts, and non-video profile links', () => {
    expect(parseExternalVideoUrl('javascript:alert(1)')).toBeNull()
    expect(parseExternalVideoUrl('https://youtube.com.attacker.example/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(parseExternalVideoUrl('https://www.instagram.com/some-player/')).toBeNull()
  })
})

describe('externalVideoLinksIn', () => {
  it('finds and deduplicates supported video links while tolerating punctuation', () => {
    const body = [
      'Watch this (https://youtu.be/dQw4w9WgXcQ).',
      'Again: https://youtu.be/dQw4w9WgXcQ',
      'and https://example.com/not-a-video',
    ].join(' ')

    expect(externalVideoLinksIn(body)).toHaveLength(1)
  })
})
