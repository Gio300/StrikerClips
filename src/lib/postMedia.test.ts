import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isSafePostImageUrl } from './postMedia'

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'https://tko.cam' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('post image URLs', () => {
  const postId = '123e4567-e89b-42d3-a456-426614174000'
  const fileId = '123e4567-e89b-42d3-a456-426614174001'

  it('allows only the same-origin immutable post-media path', () => {
    expect(isSafePostImageUrl(`https://tko.cam/api/storage/post-media/${postId}/${fileId}.webp`)).toBe(true)
    expect(isSafePostImageUrl(`https://example.com/api/storage/post-media/${postId}/${fileId}.webp`)).toBe(false)
    expect(isSafePostImageUrl(`https://tko.cam/api/storage/chat-media/${postId}/${fileId}.webp`)).toBe(false)
  })

  it('rejects malformed ids, executable formats, and data URLs', () => {
    expect(isSafePostImageUrl('data:image/png;base64,AAAA')).toBe(false)
    expect(isSafePostImageUrl(`https://tko.cam/api/storage/post-media/not-a-post/${fileId}.jpg`)).toBe(false)
    expect(isSafePostImageUrl(`https://tko.cam/api/storage/post-media/${postId}/${fileId}.svg`)).toBe(false)
  })
})
