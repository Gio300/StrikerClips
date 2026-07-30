import { describe, it, expect } from 'vitest'
import {
  dedupeProducedVideos,
  latestProducedVersions,
  mergeProducedVideoSources,
  producedVideoTitle,
  watchUrlFor,
  type ClipRecordLite,
  type ProducedVideo,
} from './producedVideos'

const rec = (over: Partial<ClipRecordLite>): ClipRecordLite => ({
  composite_youtube_id: null,
  youtube_id: null,
  player_id: null,
  player_handle: null,
  map: null,
  mode: null,
  category: null,
  match_id: null,
  recorded_at: null,
  created_at: null,
  ...over,
})

const video = (over: Partial<ProducedVideo>): ProducedVideo => ({
  youtubeId: 'video',
  title: 'Multi-angle match',
  thumbnail: 'thumb',
  watchUrl: 'watch',
  playerIds: [],
  handles: [],
  angleCount: 2,
  matchId: null,
  createdAt: null,
  ...over,
})

describe('latestProducedVersions', () => {
  it('replaces an older two-camera cut with the newest version of that match', () => {
    const out = latestProducedVersions([
      {
        id: 'v1',
        match_key: 'match-1',
        version: 1,
        youtube_id: 'old-pair',
        angle_count: 2,
        participant_ids: ['p1', 'p2'],
        clip_ids: [],
        reason: 'render',
        created_at: '2026-07-25T01:00:00Z',
      },
      {
        id: 'v2',
        match_key: 'match-1',
        version: 2,
        youtube_id: 'new-triple',
        angle_count: 3,
        participant_ids: ['p1', 'p2', 'p3'],
        clip_ids: [],
        reason: 'verified_auto_merge',
        created_at: '2026-07-25T02:00:00Z',
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].youtubeId).toBe('new-triple')
    expect(out[0].angleCount).toBe(3)
    expect(out[0].playerIds).toEqual(['p1', 'p2', 'p3'])
  })

  it('never promotes a superseded upload', () => {
    const out = latestProducedVersions([
      {
        id: 'v1',
        match_key: 'match-1',
        version: 1,
        youtube_id: 'current',
        angle_count: 3,
        participant_ids: ['p1', 'p2', 'p3'],
        clip_ids: [],
        reason: 'render',
        created_at: '2026-07-25T01:00:00Z',
      },
      {
        id: 'v2',
        match_key: 'match-1',
        version: 2,
        youtube_id: 'obsolete-race',
        angle_count: 2,
        participant_ids: ['p1', 'p2'],
        clip_ids: [],
        reason: 'superseded',
        created_at: '2026-07-25T02:00:00Z',
      },
    ])
    expect(out.map((video) => video.youtubeId)).toEqual(['current'])
  })
})

describe('mergeProducedVideoSources', () => {
  it('keeps newer legacy renders visible when canonical data is stale', () => {
    const out = mergeProducedVideoSources(
      [video({ youtubeId: 'canonical-old', matchId: 'match-1', createdAt: '2026-07-25T01:00:00Z' })],
      [video({ youtubeId: 'legacy-new', matchId: 'match-2', createdAt: '2026-07-27T01:00:00Z' })],
    )

    expect(out.map((item) => item.youtubeId)).toEqual(['legacy-new', 'canonical-old'])
  })

  it('uses the newest render when both sources identify the same match', () => {
    const out = mergeProducedVideoSources(
      [video({ youtubeId: 'canonical-old', matchId: 'match-1', createdAt: '2026-07-25T01:00:00Z' })],
      [video({ youtubeId: 'legacy-new', matchId: 'match-1', createdAt: '2026-07-27T01:00:00Z' })],
    )

    expect(out.map((item) => item.youtubeId)).toEqual(['legacy-new'])
  })

  it('does not duplicate one YouTube upload referenced by both tables', () => {
    const out = mergeProducedVideoSources(
      [video({ youtubeId: 'same-upload', matchId: 'match-1', createdAt: '2026-07-27T01:00:00Z' })],
      [video({ youtubeId: 'same-upload', matchId: null, createdAt: '2026-07-27T01:00:00Z' })],
    )

    expect(out).toHaveLength(1)
  })
})

describe('producedVideoTitle', () => {
  it('uses mode + map when present', () => {
    expect(producedVideoTitle({ mode: 'Flag', map: 'Hidden Leaf' })).toBe('Multi-angle · Flag · Hidden Leaf')
  })
  it('falls back to a plain label when there is no metadata', () => {
    expect(producedVideoTitle({ mode: null, map: null })).toBe('Multi-angle match')
  })
})

describe('watchUrlFor', () => {
  it('builds a YouTube watch URL', () => {
    expect(watchUrlFor('abc123')).toBe('https://www.youtube.com/watch?v=abc123')
  })
})

describe('dedupeProducedVideos', () => {
  it('collapses every angle of one match into ONE video and unions its players', () => {
    const rows = [
      rec({ composite_youtube_id: 'vid1', player_id: 'p1', player_handle: 'Ann', map: 'Leaf', mode: 'Flag', created_at: '2026-01-01T00:00:00Z' }),
      rec({ composite_youtube_id: 'vid1', player_id: 'p2', player_handle: 'Ben', created_at: '2026-01-01T00:00:00Z' }),
      rec({ composite_youtube_id: 'vid1', player_id: 'p1', player_handle: 'Ann', created_at: '2026-01-01T00:00:00Z' }), // dup player
    ]
    const out = dedupeProducedVideos(rows)
    expect(out).toHaveLength(1)
    expect(out[0].youtubeId).toBe('vid1')
    expect(out[0].angleCount).toBe(3)
    expect(out[0].playerIds).toEqual(['p1', 'p2'])
    expect(out[0].handles).toEqual(['Ann', 'Ben'])
    expect(out[0].title).toBe('Multi-angle · Flag · Leaf')
  })

  it('drops rows with no composite id (not yet produced)', () => {
    const out = dedupeProducedVideos([rec({ composite_youtube_id: null, player_id: 'p1' })])
    expect(out).toHaveLength(0)
  })

  it('drops raw source clips — a youtube_id without a composite is NOT a produced video', () => {
    // This is the fix: a user's own raw upload (youtube_id set, composite unset)
    // must never surface as a produced video linking to their personal channel.
    const out = dedupeProducedVideos([rec({ youtube_id: 'raw-on-user-channel', composite_youtube_id: null, player_id: 'p1' })])
    expect(out).toHaveLength(0)
  })

  it('orders videos newest first by best timestamp', () => {
    const rows = [
      rec({ composite_youtube_id: 'old', recorded_at: '2026-01-01T00:00:00Z' }),
      rec({ composite_youtube_id: 'new', recorded_at: '2026-06-01T00:00:00Z' }),
      rec({ composite_youtube_id: 'old', recorded_at: '2026-02-01T00:00:00Z' }), // newer angle of "old"
    ]
    const out = dedupeProducedVideos(rows)
    expect(out.map((v) => v.youtubeId)).toEqual(['new', 'old'])
    // "old" keeps the newest of its two angle timestamps.
    expect(out[1].createdAt).toBe('2026-02-01T00:00:00Z')
  })
})
