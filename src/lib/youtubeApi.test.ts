import { describe, it, expect } from 'vitest'
import { extractYouTubeId, isValidYouTubeUrl, youtubeLinkError } from './youtubeApi'

describe('youtubeApi — extractYouTubeId', () => {
  it('pulls the id from the common URL shapes', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeId('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ') // bare id
  })

  it('returns null for non-YouTube / garbage input', () => {
    expect(extractYouTubeId('')).toBeNull()
    expect(extractYouTubeId('hello world')).toBeNull()
    expect(extractYouTubeId('https://vimeo.com/12345')).toBeNull()
    expect(extractYouTubeId('https://example.com/watch?v=short')).toBeNull()
  })
})

describe('youtubeApi — isValidYouTubeUrl', () => {
  it('is true only for parseable links/ids', () => {
    expect(isValidYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
    expect(isValidYouTubeUrl('not a link')).toBe(false)
    expect(isValidYouTubeUrl('')).toBe(false)
  })
})

describe('youtubeApi — youtubeLinkError', () => {
  it('stays quiet on an empty box (nothing pasted yet)', () => {
    expect(youtubeLinkError('')).toBeNull()
    expect(youtubeLinkError('   ')).toBeNull()
  })

  it('flags an invalid paste with helpful copy', () => {
    const err = youtubeLinkError('twitch.tv/somestream')
    expect(err).toBeTruthy()
    expect(err).toMatch(/youtube\.com or youtu\.be/i)
  })

  it('returns null once a valid link is pasted', () => {
    expect(youtubeLinkError('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })
})
