import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke } },
}))

import {
  loadConnectedYouTubeChannel,
  loadConnectedYouTubeUploads,
} from './youtubeSettings'

describe('YouTube account settings client', () => {
  beforeEach(() => invoke.mockReset())

  it('preserves the channel and videos returned by the uploads action', async () => {
    const channel = { id: 'link-1', url: 'https://www.youtube.com/@Player' }
    const videos = [{
      id: 'abcdefghijk',
      title: 'Triple K.O.',
      description: '',
      publishedAt: 1_786_200_000_000,
    }]
    invoke.mockResolvedValue({ data: { ok: true, channel, videos }, error: null })

    await expect(loadConnectedYouTubeUploads()).resolves.toEqual({ channel, videos })
    expect(invoke).toHaveBeenCalledWith('youtube-channel-settings', {
      body: { action: 'uploads' },
    })
  })

  it('returns the saved channel for the get action', async () => {
    const channel = { id: 'link-1', url: 'https://www.youtube.com/@Player' }
    invoke.mockResolvedValue({ data: { ok: true, channel }, error: null })

    await expect(loadConnectedYouTubeChannel()).resolves.toEqual(channel)
  })
})
