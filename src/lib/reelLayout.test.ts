import { describe, it, expect } from 'vitest'
import {
  encodeLayoutMarker,
  decodeLayoutMarker,
  isLayoutMarker,
  isPlayableUrl,
  resolveLayout,
  resolveSlots,
  resolveKit,
  type ReelKitPicks,
} from './reelLayout'

describe('reelLayout — layout marker (pre-kit behavior unchanged)', () => {
  it('encodes and decodes a bare layout', () => {
    expect(encodeLayoutMarker('action')).toBe('reelone-layout://action')
    expect(decodeLayoutMarker('reelone-layout://action')).toEqual({ layout: 'action' })
  })

  it('still decodes legacy schemes and slot counts', () => {
    expect(decodeLayoutMarker('clutchlens-layout://grid?slots=4')).toEqual({ layout: 'grid', slots: 4 })
    expect(decodeLayoutMarker('shinobi-layout://pip')).toEqual({ layout: 'pip' })
  })

  it('markers are never playable; real URLs never markers', () => {
    expect(isPlayableUrl('reelone-layout://ultra')).toBe(false)
    expect(isLayoutMarker('https://cdn.example/v.mp4')).toBe(false)
    expect(isPlayableUrl('https://cdn.example/v.mp4')).toBe(true)
  })
})

describe('reelLayout — league template kit picks in the marker', () => {
  const kit: ReelKitPicks = {
    intro: 'vs-01',
    outro: 'king-02',
    banner: 'fire',
    music: 'suno_shinobi_striker_league.mp3',
    league: 'shinobistrikerleague',
  }

  it('round-trips kit picks (with and without slots)', () => {
    const marker = encodeLayoutMarker('ultra', { slots: 4, kit })
    expect(decodeLayoutMarker(marker)).toEqual({ layout: 'ultra', slots: 4, kit })

    const noSlots = encodeLayoutMarker('action', { kit })
    expect(decodeLayoutMarker(noSlots)).toEqual({ layout: 'action', kit })
  })

  it('skips empty/blank picks so partial kits stay minimal', () => {
    const marker = encodeLayoutMarker('concat', { kit: { banner: 'smoke', intro: '', music: '  ' } })
    expect(marker).toBe('reelone-layout://concat?banner=smoke')
    expect(decodeLayoutMarker(marker)).toEqual({ layout: 'concat', kit: { banner: 'smoke' } })
  })

  it('URI-encodes unusual file names safely', () => {
    const marker = encodeLayoutMarker('concat', { kit: { music: 'my anthem&v2.mp3' } })
    expect(decodeLayoutMarker(marker)?.kit).toEqual({ music: 'my anthem&v2.mp3' })
  })

  it('a kit-only concat marker behaves exactly like a null URL for readers', () => {
    // CreateHighlight now writes this for YouTube+concat reels with picks;
    // players must fall through to clip playback just as with null.
    const marker = encodeLayoutMarker('concat', { kit: { banner: 'dark' } })
    const reel = { combined_video_url: marker }
    expect(resolveLayout(reel)).toBe('concat')
    expect(resolveSlots(reel)).toBeNull()
    expect(isPlayableUrl(marker)).toBe(false)
    expect(resolveKit(reel)).toEqual({ banner: 'dark' })
  })

  it('resolveKit is null for plain markers, real URLs, and absent values', () => {
    expect(resolveKit({ combined_video_url: 'reelone-layout://grid?slots=4' })).toBeNull()
    expect(resolveKit({ combined_video_url: 'https://cdn.example/v.mp4' })).toBeNull()
    expect(resolveKit({ combined_video_url: null })).toBeNull()
    expect(resolveKit({})).toBeNull()
  })
})
