import { describe, expect, it } from 'vitest'
import {
  interleaveCreators,
  orderCreatorFeed,
  PRODUCED_WATCH_LIMIT,
  producedVideoCreatorKey,
  REELS_DIVERSITY_SCAN_FACTOR,
  reelsFetchWindow,
  REELS_PAGE_SIZE,
  reelFeedMediaLabel,
  takeFeedPage,
} from './feedDiversity'

type Item = { id: string; creator: string }

describe('creator-diverse feeds', () => {
  const source: Item[] = [
    { id: 'a1', creator: 'a' },
    { id: 'a2', creator: 'a' },
    { id: 'a3', creator: 'a' },
    { id: 'b1', creator: 'b' },
    { id: 'b2', creator: 'b' },
    { id: 'c1', creator: 'c' },
  ]

  it('round-robins creators while preserving each creator chronology', () => {
    expect(interleaveCreators(source, (item) => item.creator).map((item) => item.id)).toEqual([
      'a1', 'b1', 'c1', 'a2', 'b2', 'a3',
    ])
  })

  it('keeps searched results in understandable chronological order', () => {
    expect(orderCreatorFeed(source, (item) => item.creator, 'kyubi')).toEqual(source)
    expect(orderCreatorFeed(source, (item) => item.creator, '')).not.toEqual(source)
  })

  it('keeps every item exactly once and leaves a one-creator feed stable', () => {
    const onlyA = source.slice(0, 3)
    expect(interleaveCreators(onlyA, (item) => item.creator)).toEqual(onlyA)
    expect(new Set(interleaveCreators(source, (item) => item.creator).map((item) => item.id))).toEqual(
      new Set(source.map((item) => item.id)),
    )
  })

  it('keeps the public feed launch window deliberately bounded', () => {
    expect(REELS_PAGE_SIZE).toBe(24)
    expect(PRODUCED_WATCH_LIMIT).toBe(48)
    expect(REELS_DIVERSITY_SCAN_FACTOR).toBe(3)
    expect(reelsFetchWindow(REELS_PAGE_SIZE)).toBe(72)
    const page = takeFeedPage(Array.from({ length: 25 }, (_, index) => index))
    expect(page.items).toHaveLength(24)
    expect(page.hasMore).toBe(true)
  })
})

describe('feed media labels', () => {
  it('replaces misleading zero-clip copy for playable and factory reels', () => {
    expect(reelFeedMediaLabel({ combined_video_url: 'https://youtu.be/abcdefghijk', clip_ids: [] }))
      .toBe('Playable video')
    expect(reelFeedMediaLabel({
      combined_video_url: 'https://youtu.be/abcdefghijk',
      league_slug: 'tko',
      clip_ids: [],
    })).toBe('Produced video')
  })

  it('still reports a truthful source count for assembled reels', () => {
    expect(reelFeedMediaLabel({ clip_ids: ['one'] })).toBe('1 clip')
    expect(reelFeedMediaLabel({ clip_ids: ['one', 'two'] })).toBe('2 clips')
    expect(reelFeedMediaLabel({ clip_ids: [] })).toBe('Saved reel')
  })
})

describe('produced-video creator identity', () => {
  it('prefers a participant id, then a handle, then the video id', () => {
    expect(producedVideoCreatorKey({ youtubeId: 'video', participants: [{ id: 'player' }], handles: ['name'] }))
      .toBe('player')
    expect(producedVideoCreatorKey({ youtubeId: 'video', participants: [], handles: ['name'] })).toBe('name')
    expect(producedVideoCreatorKey({ youtubeId: 'video', participants: [], handles: [] })).toBe('video')
  })
})
