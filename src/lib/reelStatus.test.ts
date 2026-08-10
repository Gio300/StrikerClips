import { describe, expect, it } from 'vitest'
import { reelBadgeLabel, reelStatus } from './reelStatus'

describe('reelStatus', () => {
  it('does not call a layout marker or empty row rendered', () => {
    expect(reelStatus({ combined_video_url: 'reelone-layout://grid?slots=4' })).toBe('saved')
    expect(reelStatus({ combined_video_url: null })).toBe('saved')
    expect(reelBadgeLabel({ combined_video_url: null }, true)).toBe('JUST SAVED')
  })

  it('distinguishes a playable upload from a factory-produced reel', () => {
    const url = 'https://cdn.example/video.mp4'
    expect(reelStatus({ combined_video_url: url })).toBe('playable')
    expect(reelBadgeLabel({ combined_video_url: url })).toBe('PLAYABLE')
    expect(reelStatus({ combined_video_url: url, league_slug: 'tko' })).toBe('produced')
    expect(reelBadgeLabel({ combined_video_url: url, league_slug: 'tko' })).toBe('PRODUCED')
  })
})
