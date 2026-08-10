import { describe, expect, it } from 'vitest'
import {
  MAX_BATTLE_CLIPS,
  hasAnyBattleMedia,
  mergeBattleMedia,
  normalizeClipUrls,
  normalizeLiveUrl,
  readSideMedia,
  sideForPlayer,
} from './battleMedia'

describe('normalizeLiveUrl', () => {
  it('accepts a plain https URL as-is', () => {
    expect(normalizeLiveUrl('https://www.youtube.com/live/aaaaaaaaaa1')).toEqual({
      ok: true,
      url: 'https://www.youtube.com/live/aaaaaaaaaa1',
    })
    expect(normalizeLiveUrl('https://twitch.tv/somebody')).toEqual({
      ok: true,
      url: 'https://twitch.tv/somebody',
    })
  })

  it('treats empty input as CLEAR, not error', () => {
    expect(normalizeLiveUrl(null)).toEqual({ ok: true, url: null })
    expect(normalizeLiveUrl(undefined)).toEqual({ ok: true, url: null })
    expect(normalizeLiveUrl('')).toEqual({ ok: true, url: null })
    expect(normalizeLiveUrl('   ')).toEqual({ ok: true, url: null })
  })

  it('refuses non-https and junk', () => {
    for (const bad of [
      'http://insecure.example/live',
      'javascript:alert(1)',
      'ftp://old.example',
      'no scheme at all',
      42,
      { url: 'https://x.example' },
      `https://example.com/${'a'.repeat(500)}`,
    ]) {
      expect(normalizeLiveUrl(bad).ok).toBe(false)
    }
  })
})

describe('normalizeClipUrls', () => {
  it('canonicalizes every YouTube shape to a watch URL and dedupes', () => {
    const result = normalizeClipUrls([
      'https://youtu.be/aliceclip01',
      'https://www.youtube.com/watch?v=aliceclip02',
      'https://www.youtube.com/shorts/aliceclip03',
      'aliceclip01', // bare id, duplicate of the first
    ])
    expect(result).toEqual({
      ok: true,
      urls: [
        'https://www.youtube.com/watch?v=aliceclip01',
        'https://www.youtube.com/watch?v=aliceclip02',
        'https://www.youtube.com/watch?v=aliceclip03',
      ],
    })
  })

  it('an empty list clears', () => {
    expect(normalizeClipUrls([])).toEqual({ ok: true, urls: [] })
    expect(normalizeClipUrls(null)).toEqual({ ok: true, urls: [] })
  })

  it('one junk entry refuses the whole write', () => {
    for (const bad of [
      ['https://vimeo.com/123456789'],
      ['https://youtu.be/aliceclip01', 'utter junk'],
      [123],
      'https://youtu.be/aliceclip01', // not a list
    ]) {
      expect(normalizeClipUrls(bad).ok).toBe(false)
    }
  })

  it('enforces the per-side cap AFTER dedupe', () => {
    const distinct = Array.from(
      { length: MAX_BATTLE_CLIPS + 1 },
      (_, index) => `clipnumb00${index}`,
    )
    expect(normalizeClipUrls(distinct).ok).toBe(false)
    // The same clip pasted twice is not "too many".
    const duplicated = Array.from({ length: MAX_BATTLE_CLIPS + 1 }, () => 'clipnumb001')
    expect(normalizeClipUrls(duplicated)).toEqual({
      ok: true,
      urls: ['https://www.youtube.com/watch?v=clipnumb001'],
    })
  })
})

describe('sideForPlayer', () => {
  const battle = { player_a: 'user-a', player_b: 'user-b' }
  it('maps each fighter to their slot and everyone else to null', () => {
    expect(sideForPlayer(battle, 'user-a')).toBe('a')
    expect(sideForPlayer(battle, 'user-b')).toBe('b')
    expect(sideForPlayer(battle, 'user-c')).toBeNull()
    expect(sideForPlayer(battle, null)).toBeNull()
    expect(sideForPlayer({ player_a: 'user-a', player_b: null }, 'user-b')).toBeNull()
  })
})

describe('mergeBattleMedia', () => {
  it('patches one side without touching the other', () => {
    const existing = {
      a: { live_url: 'https://a.example/live', clip_urls: ['https://www.youtube.com/watch?v=aliceclip01'] },
      b: { live_url: 'https://b.example/live' },
    }
    const next = mergeBattleMedia(existing, 'a', { live_url: 'https://a.example/new' })
    expect(next.a).toEqual({
      live_url: 'https://a.example/new',
      clip_urls: ['https://www.youtube.com/watch?v=aliceclip01'],
    })
    expect(next.b).toEqual({ live_url: 'https://b.example/live' })
  })

  it('drops a side that ends up empty', () => {
    const existing = { a: { live_url: 'https://a.example/live' } }
    const next = mergeBattleMedia(existing, 'a', { live_url: null })
    expect(next).toEqual({})
  })

  it('absent patch keys keep the stored value; present keys replace it', () => {
    const existing = { b: { live_url: 'https://b.example/live', clip_urls: ['https://www.youtube.com/watch?v=aliceclip01'] } }
    const clipsOnly = mergeBattleMedia(existing, 'b', { clip_urls: [] })
    expect(clipsOnly.b).toEqual({ live_url: 'https://b.example/live' })
  })

  it('survives junk stored values (string, garbage JSON, null)', () => {
    expect(mergeBattleMedia('not json', 'a', { live_url: 'https://x.example' })).toEqual({
      a: { live_url: 'https://x.example' },
    })
    expect(
      mergeBattleMedia('{"a":{"live_url":"https://kept.example"}}', 'b', {
        live_url: 'https://y.example',
      }),
    ).toEqual({
      a: { live_url: 'https://kept.example' },
      b: { live_url: 'https://y.example' },
    })
    expect(mergeBattleMedia(null, 'b', { clip_urls: ['https://www.youtube.com/watch?v=aliceclip01'] })).toEqual({
      b: { clip_urls: ['https://www.youtube.com/watch?v=aliceclip01'] },
    })
  })
})

describe('readSideMedia / hasAnyBattleMedia', () => {
  it('reads defensively from unknown shapes', () => {
    expect(readSideMedia(undefined, 'a')).toEqual({ live_url: null, clip_urls: [] })
    expect(readSideMedia({ a: { live_url: 7, clip_urls: 'nope' } }, 'a')).toEqual({
      live_url: null,
      clip_urls: [],
    })
    expect(
      readSideMedia({ b: { clip_urls: ['https://ok.example', 42, ''] } }, 'b').clip_urls,
    ).toEqual(['https://ok.example'])
  })

  it('detects whether anything watchable is attached', () => {
    expect(hasAnyBattleMedia(null)).toBe(false)
    expect(hasAnyBattleMedia({})).toBe(false)
    expect(hasAnyBattleMedia({ a: {} })).toBe(false)
    expect(hasAnyBattleMedia({ b: { live_url: 'https://x.example' } })).toBe(true)
    expect(hasAnyBattleMedia({ a: { clip_urls: ['https://x.example'] } })).toBe(true)
  })
})
