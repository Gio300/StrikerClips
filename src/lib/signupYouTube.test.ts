import { describe, expect, it } from 'vitest'
import {
  normalizeConnectedYouTubeChannelUrl,
  normalizeSignupYouTubeUrl,
  youtubeHandleFromChannelUrl,
} from './signupYouTube'

describe('signup YouTube URL', () => {
  it('normalizes channel handles and channel ids', () => {
    expect(normalizeSignupYouTubeUrl('youtube.com/@ShinobiPlayer/')).toBe(
      'https://www.youtube.com/@ShinobiPlayer',
    )
    expect(normalizeSignupYouTubeUrl('https://m.youtube.com/channel/UC12345678901234567890?view=1')).toBe(
      'https://www.youtube.com/channel/UC12345678901234567890',
    )
  })

  it('rejects video sources, non-YouTube URLs, and empty home URLs', () => {
    expect(normalizeSignupYouTubeUrl('https://youtu.be/abcdefghijk?si=tracking')).toBeNull()
    expect(normalizeSignupYouTubeUrl('https://youtube.com/watch?v=abcdefghijk')).toBeNull()
    expect(normalizeSignupYouTubeUrl('https://youtube.com/shorts/abcdefghijk')).toBeNull()
    expect(normalizeSignupYouTubeUrl('https://youtube.com/live/abcdefghijk')).toBeNull()
    expect(normalizeSignupYouTubeUrl('https://example.com/@player')).toBeNull()
    expect(normalizeSignupYouTubeUrl('https://youtube.com')).toBeNull()
  })

  it('separates the account channel from saved clip URLs', () => {
    expect(normalizeConnectedYouTubeChannelUrl('youtube.com/@ShinobiPlayer/videos')).toBe(
      'https://www.youtube.com/@ShinobiPlayer',
    )
    expect(normalizeConnectedYouTubeChannelUrl('https://youtube.com/channel/UC123/live')).toBe(
      'https://www.youtube.com/channel/UC123',
    )
    expect(normalizeConnectedYouTubeChannelUrl('https://youtu.be/abcdefghijk')).toBeNull()
    expect(normalizeConnectedYouTubeChannelUrl('https://youtube.com/watch?v=abcdefghijk')).toBeNull()
    expect(youtubeHandleFromChannelUrl('youtube.com/@ShinobiPlayer/live')).toBe('ShinobiPlayer')
  })
})
