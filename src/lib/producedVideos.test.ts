import { describe, it, expect } from 'vitest'
import {
  combineProducedVideo,
  dedupeProducedVideos,
  latestProducedVersions,
  mergeParticipants,
  mergeProducedVideoSources,
  producedVideoRoute,
  producedVideoTitle,
  watchUrlFor,
  type ClipRecordLite,
  type ProducedVideo,
} from './producedVideos'
import { canonicalShareUrl } from './canonicalUrl'

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
  participants: [],
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

  it('labels each participant with the handle stored on its own angle', () => {
    const out = latestProducedVersions([
      {
        id: 'v1',
        match_key: 'match-1',
        version: 1,
        youtube_id: 'trio',
        angle_count: 3,
        participant_ids: ['p1', 'p2', 'p3'],
        clip_ids: [],
        source_angles: [
          { user_id: 'p2', handle: 'Hammy' },
          { user_id: 'p1', handle: 'kissatronix' },
        ],
        reason: 'verified_auto_merge',
        created_at: '2026-07-25T02:00:00Z',
      },
    ])
    expect(out[0].participants).toEqual([
      { id: 'p1', handle: 'kissatronix' },
      { id: 'p2', handle: 'Hammy' },
      { id: 'p3', handle: null },
    ])
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

// A produced video's Share used to send canonicalCurrentUrl() — the PROFILE or
// feed page the card sat on. There is now a page per video, and Share sends it.
describe('producedVideoRoute (the share target)', () => {
  const loc = (origin: string) => {
    const u = new URL(origin)
    return { protocol: u.protocol, hostname: u.hostname, origin: u.origin }
  }

  it('is the per-video app route, not the page the card sits on', () => {
    expect(producedVideoRoute('mJ-zg4bnQ8w')).toBe('/produced/mJ-zg4bnQ8w')
  })

  it('escapes an id so it can never break out of the path', () => {
    expect(producedVideoRoute('a/b?c')).toBe('/produced/a%2Fb%3Fc')
  })

  it('shares a real public link from the installed app (never localhost)', () => {
    expect(canonicalShareUrl(producedVideoRoute('mJ-zg4bnQ8w'), loc('https://localhost'), '/')).toBe(
      'https://tko.cam/app/produced/mJ-zg4bnQ8w',
    )
  })

  it('keeps the league domain when the sharer is on one', () => {
    expect(
      canonicalShareUrl(producedVideoRoute('mJ-zg4bnQ8w'), loc('https://shinobistrikerleague.com'), '/'),
    ).toBe('https://shinobistrikerleague.com/produced/mJ-zg4bnQ8w')
  })
})

describe('mergeParticipants', () => {
  it('unions players and takes the first handle anyone knows', () => {
    expect(
      mergeParticipants(
        [{ id: 'p1', handle: null }, { id: 'p2', handle: 'Hammy' }],
        [{ id: 'p1', handle: 'MrJerry' }, { id: 'p3', handle: null }],
      ),
    ).toEqual([
      { id: 'p1', handle: 'MrJerry' },
      { id: 'p2', handle: 'Hammy' },
      { id: 'p3', handle: null },
    ])
  })

  it('drops entries with no player id', () => {
    expect(mergeParticipants([{ id: '', handle: 'ghost' }], [])).toEqual([])
  })
})

describe('combineProducedVideo (single-video reader)', () => {
  it('unions BOTH tables instead of letting one hide the other', () => {
    const out = combineProducedVideo(
      video({
        youtubeId: 'vid',
        title: '3-camera synchronized match',
        participants: [{ id: 'p1', handle: null }, { id: 'p2', handle: null }],
        angleCount: 3,
        matchId: 'match-1',
      }),
      video({
        youtubeId: 'vid',
        title: 'Multi-angle · Flag · Leaf',
        participants: [{ id: 'p2', handle: 'Hammy' }, { id: 'p3', handle: 'MrJerry' }],
        angleCount: 2,
      }),
    )!
    expect(out.angleCount).toBe(3)
    expect(out.matchId).toBe('match-1')
    // The clip records carry map/mode; the version row only counts cameras.
    expect(out.title).toBe('Multi-angle · Flag · Leaf')
    expect(out.participants).toEqual([
      { id: 'p1', handle: null },
      { id: 'p2', handle: 'Hammy' },
      { id: 'p3', handle: 'MrJerry' },
    ])
    expect(out.playerIds).toEqual(['p1', 'p2', 'p3'])
    expect(out.handles).toEqual(['Hammy', 'MrJerry'])
  })

  it('keeps the camera-count title when the records have no map/mode', () => {
    const out = combineProducedVideo(
      video({ title: '2-camera synchronized match' }),
      video({ title: 'Multi-angle match' }),
    )!
    expect(out.title).toBe('2-camera synchronized match')
  })

  it('works when only one source has the video, and null when neither does', () => {
    expect(combineProducedVideo(null, video({ youtubeId: 'only-legacy' }))!.youtubeId).toBe('only-legacy')
    expect(combineProducedVideo(video({ youtubeId: 'only-canonical' }), null)!.youtubeId).toBe('only-canonical')
    expect(combineProducedVideo(null, null)).toBeNull()
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

  // The bug this guards: playerIds and handles were built as two independent
  // de-duplications, so ONE player without a handle shifted every later label
  // onto the wrong profile. Ids and labels now travel as pairs.
  it('keeps each gamertag with ITS OWN player when one angle has no handle', () => {
    const out = dedupeProducedVideos([
      rec({ composite_youtube_id: 'v', player_id: 'p1', player_handle: null }),
      rec({ composite_youtube_id: 'v', player_id: 'p2', player_handle: 'Hammy' }),
    ])
    expect(out[0].participants).toEqual([
      { id: 'p1', handle: null },
      { id: 'p2', handle: 'Hammy' },
    ])
  })

  it('fills in a handle that only a LATER angle row carried', () => {
    const out = dedupeProducedVideos([
      rec({ composite_youtube_id: 'v', player_id: 'p1', player_handle: null }),
      rec({ composite_youtube_id: 'v', player_id: 'p1', player_handle: 'Hammy' }),
    ])
    expect(out[0].participants).toEqual([{ id: 'p1', handle: 'Hammy' }])
    expect(out[0].handles).toEqual(['Hammy'])
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
