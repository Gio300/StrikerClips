import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeChatImage, parseChatImage } from './chatMedia'

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'https://tko.cam' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chat image message markers', () => {
  it('round trips an image served by the private chat-media path', () => {
    const image = {
      url: 'https://tko.cam/api/storage/chat-media/123e4567-e89b-42d3-a456-426614174000/123e4567-e89b-42d3-a456-426614174001.jpg',
      alt: 'Round win | final\nframe',
    }
    const encoded = encodeChatImage(image)
    expect(parseChatImage(encoded)).toEqual({
      url: image.url,
      alt: 'Round win final frame',
    })
  })

  it('rejects off-origin and off-path image markers', () => {
    expect(() => encodeChatImage({ url: 'https://example.com/photo.jpg', alt: 'Nope' })).toThrow(
      'Unsupported chat image URL.',
    )
    expect(parseChatImage('[[tko-image:v1:https://tko.cam/not-chat.jpg|Nope]]')).toBeNull()
    expect(parseChatImage('ordinary message')).toBeNull()
  })
})
