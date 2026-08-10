import { describe, expect, it } from 'vitest'
import { isSavedYouTubeClip, savedYouTubeClips } from './savedYouTubeClips'

describe('saved YouTube footage', () => {
  it('never offers a connected channel or playlist as a footage clip', () => {
    for (const url of [
      'https://www.youtube.com/@KyubiiReign',
      'https://www.youtube.com/@KyubiiReign/videos',
      'https://www.youtube.com/channel/UC1234567890',
      'https://www.youtube.com/c/KyubiiReign',
      'https://www.youtube.com/user/KyubiiReign',
      'https://www.youtube.com/playlist?list=PL123',
    ]) {
      expect(isSavedYouTubeClip({ url }), url).toBe(false)
    }
  })

  it('keeps actual watch, short, live, and compact video links', () => {
    const urls = [
      'https://www.youtube.com/watch?v=abcdefghijk',
      'https://youtu.be/lmnopqrstuv',
      'https://www.youtube.com/shorts/123456789ab',
      'https://www.youtube.com/live/ZYXWVUTSRQP',
    ]
    expect(savedYouTubeClips(urls.map((url) => ({ url }))).map((row) => row.url)).toEqual(urls)
  })

  it('rejects a channel even when its query happens to contain a video-shaped id', () => {
    expect(isSavedYouTubeClip({
      url: 'https://www.youtube.com/@KyubiiReign?v=abcdefghijk',
    })).toBe(false)
  })
})
