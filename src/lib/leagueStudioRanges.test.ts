import { describe, it, expect } from 'vitest'
import {
  LEAGUE_COLOR_SLOTS,
  LEAGUE_PREVIEW_PARTS,
  LEAGUE_STUDIO_RANGES,
  PART_FIELDS,
  PART_LABEL,
  normalizeLeaguePreviewPart,
  resolveLibraryTrack,
  sanitizeLeagueStudioPatch,
  toHexColor,
} from './leagueStudioRanges'
import { MUSIC_LIBRARY } from './leagueAssets'
import { applyChatIntent, DEFAULT_LEAGUE_CONFIG } from './leagueConfig'

// ===========================================================================
// THE GUARDRAIL SUITE — whatever the AI (or a hostile client/server) emits,
// only whitelisted template fields inside their ranges may survive. The
// league app is always the same app wearing the league's skin; these tests
// are the proof that a chat patch can never change anything structural.
// ===========================================================================

describe('leagueStudioRanges — the ranges constant', () => {
  it('whitelists exactly the template fields', () => {
    expect([...LEAGUE_STUDIO_RANGES.fields]).toEqual([
      'name', 'tagline', 'colors', 'music', 'logoUrl',
    ])
    expect([...LEAGUE_COLOR_SLOTS]).toEqual(['primary', 'secondary', 'accent', 'text'])
  })

  it('locks the music range to the TKO library', () => {
    expect(LEAGUE_STUDIO_RANGES.music.files).toEqual(MUSIC_LIBRARY.map((t) => t.file))
  })

  it('every preview part maps to a whitelisted-field subset and a label', () => {
    for (const part of LEAGUE_PREVIEW_PARTS) {
      expect(PART_FIELDS[part].length).toBeGreaterThan(0)
      for (const field of PART_FIELDS[part]) {
        expect(LEAGUE_STUDIO_RANGES.fields).toContain(field)
      }
      expect(PART_LABEL[part].length).toBeGreaterThan(0)
    }
  })
})

describe('leagueStudioRanges — helpers', () => {
  it('toHexColor normalizes #rgb / bare hex and rejects everything else', () => {
    expect(toHexColor('#AB12CD')).toBe('#ab12cd')
    expect(toHexColor('ab12cd')).toBe('#ab12cd')
    expect(toHexColor('#ABC')).toBe('#aabbcc')
    expect(toHexColor('red')).toBeNull()
    expect(toHexColor('#12345')).toBeNull()
    expect(toHexColor(42)).toBeNull()
    expect(toHexColor(null)).toBeNull()
  })

  it('resolveLibraryTrack matches file, id, or label; unknowns are null', () => {
    expect(resolveLibraryTrack('tensorverse-shadow-kage-suno.mp3'))
      .toBe('tensorverse-shadow-kage-suno.mp3')
    expect(resolveLibraryTrack('tensorverse-shadow-kage-suno'))
      .toBe('tensorverse-shadow-kage-suno.mp3')
    expect(resolveLibraryTrack('Shadow Kage')).toBe('tensorverse-shadow-kage-suno.mp3')
    expect(resolveLibraryTrack('shadow kage')).toBe('tensorverse-shadow-kage-suno.mp3')
    expect(resolveLibraryTrack('')).toBe('')
    expect(resolveLibraryTrack('   ')).toBe('')
    expect(resolveLibraryTrack('never-heard-of-it.mp3')).toBeNull()
    expect(resolveLibraryTrack(7)).toBeNull()
  })

  it('normalizeLeaguePreviewPart accepts known parts only', () => {
    expect(normalizeLeaguePreviewPart('colors')).toBe('colors')
    expect(normalizeLeaguePreviewPart(' Banner ')).toBe('banner')
    expect(normalizeLeaguePreviewPart('tier')).toBeNull()
    expect(normalizeLeaguePreviewPart(42)).toBeNull()
    expect(normalizeLeaguePreviewPart(undefined)).toBeNull()
  })
})

describe('sanitizeLeagueStudioPatch — clamps and drops', () => {
  it('passes a fully valid patch through (normalized)', () => {
    const { patch, dropped } = sanitizeLeagueStudioPatch({
      name: '  Blaze League  ',
      tagline: 'rise and grind',
      colors: { primary: 'FF0000', accent: '#ABC' },
      music: 'Shadow Kage',
      logoUrl: '',
    })
    expect(patch).toEqual({
      name: 'Blaze League',
      tagline: 'rise and grind',
      colors: { primary: '#ff0000', accent: '#aabbcc' },
      music: 'tensorverse-shadow-kage-suno.mp3',
      logoUrl: '',
    })
    expect(dropped).toEqual([])
  })

  it('clamps the name to its cap and drops an empty one', () => {
    const long = sanitizeLeagueStudioPatch({ name: 'x'.repeat(200) })
    expect(long.patch?.name).toHaveLength(LEAGUE_STUDIO_RANGES.name.maxLength)

    const empty = sanitizeLeagueStudioPatch({ name: '   ' })
    expect(empty.patch).toBeNull()
    expect(empty.dropped).toContain('name')

    const notString = sanitizeLeagueStudioPatch({ name: 42 })
    expect(notString.patch).toBeNull()
    expect(notString.dropped).toContain('name')
  })

  it('clamps the tagline (and allows clearing it with "")', () => {
    const long = sanitizeLeagueStudioPatch({ tagline: 'y'.repeat(500) })
    expect(long.patch?.tagline).toHaveLength(LEAGUE_STUDIO_RANGES.tagline.maxLength)

    const clear = sanitizeLeagueStudioPatch({ tagline: '' })
    expect(clear.patch).toEqual({ tagline: '' })

    const bad = sanitizeLeagueStudioPatch({ tagline: { evil: true } })
    expect(bad.patch).toBeNull()
    expect(bad.dropped).toContain('tagline')
  })

  it('keeps only valid hex colors on known slots', () => {
    const { patch, dropped } = sanitizeLeagueStudioPatch({
      colors: {
        primary: '#123456',
        accent: 'gold',            // a WORD, not hex — dropped
        text: '#GGGGGG',           // not hex — dropped
        bogus: '#ffffff',          // unknown slot — dropped
      },
    })
    expect(patch).toEqual({ colors: { primary: '#123456' } })
    expect(dropped).toEqual(
      expect.arrayContaining(['colors.accent', 'colors.text', 'colors.bogus']),
    )
  })

  it('drops a colors value that is not an object, or is empty', () => {
    expect(sanitizeLeagueStudioPatch({ colors: 'red' }).dropped).toContain('colors')
    expect(sanitizeLeagueStudioPatch({ colors: ['#fff'] }).dropped).toContain('colors')
    expect(sanitizeLeagueStudioPatch({ colors: {} }).dropped).toContain('colors')
    expect(sanitizeLeagueStudioPatch({ colors: {} }).patch).toBeNull()
  })

  it('drops non-library music, resolves id/label to the file', () => {
    const bad = sanitizeLeagueStudioPatch({ music: 'https://evil.example/track.mp3' })
    expect(bad.patch).toBeNull()
    expect(bad.dropped).toContain('music')

    const byLabel = sanitizeLeagueStudioPatch({ music: 'Samurai Siren' })
    expect(byLabel.patch).toEqual({ music: 'meditativetiger-samurai-siren.mp3' })

    const off = sanitizeLeagueStudioPatch({ music: '' })
    expect(off.patch).toEqual({ music: '' })
  })

  it('logoUrl can ONLY be cleared — any actual URL is dropped', () => {
    expect(sanitizeLeagueStudioPatch({ logoUrl: '' }).patch).toEqual({ logoUrl: '' })
    for (const evil of ['https://evil.example/a.png', 'data:image/png;base64,AAAA', 'x']) {
      const r = sanitizeLeagueStudioPatch({ logoUrl: evil })
      expect(r.patch).toBeNull()
      expect(r.dropped).toContain('logoUrl')
    }
  })

  it('NOTHING STRUCTURAL survives — slug/domain/tier/ownership/unknowns all drop', () => {
    const { patch, dropped } = sanitizeLeagueStudioPatch({
      slug: 'evil',
      domain: 'evil.example',
      tier: 'enterprise',
      video_ownership: 'league',
      assets: { intros: [] },
      routes: ['/admin'],
      name: 'Still Fine',
    })
    expect(patch).toEqual({ name: 'Still Fine' })
    expect(dropped).toEqual(
      expect.arrayContaining(['slug', 'domain', 'tier', 'video_ownership', 'assets', 'routes']),
    )
  })

  it('non-object input yields a null patch, never a throw', () => {
    expect(sanitizeLeagueStudioPatch(null)).toEqual({ patch: null, dropped: [] })
    expect(sanitizeLeagueStudioPatch(undefined)).toEqual({ patch: null, dropped: [] })
    expect(sanitizeLeagueStudioPatch('name=x')).toEqual({ patch: null, dropped: ['patch'] })
    expect(sanitizeLeagueStudioPatch([{ name: 'x' }])).toEqual({ patch: null, dropped: ['patch'] })
    expect(sanitizeLeagueStudioPatch(42)).toEqual({ patch: null, dropped: ['patch'] })
  })
})

describe('sanitizeLeagueStudioPatch — part scoping (click-to-reference)', () => {
  it('a part-scoped patch may only touch that part’s fields', () => {
    const { patch, dropped } = sanitizeLeagueStudioPatch(
      { tagline: 'new line', colors: { primary: '#000000' }, name: 'Sneaky' },
      'tagline',
    )
    expect(patch).toEqual({ tagline: 'new line' })
    expect(dropped).toEqual(expect.arrayContaining(['colors', 'name']))
  })

  it('banner scopes to colors; music scopes to music; logo scopes to logoUrl', () => {
    expect(
      sanitizeLeagueStudioPatch({ colors: { accent: '#f0f0c0' }, music: '' }, 'banner').patch,
    ).toEqual({ colors: { accent: '#f0f0c0' } })

    expect(
      sanitizeLeagueStudioPatch({ music: 'Shadow Kage', name: 'Nope' }, 'music').patch,
    ).toEqual({ music: 'tensorverse-shadow-kage-suno.mp3' })

    expect(
      sanitizeLeagueStudioPatch({ logoUrl: '', tagline: 'nope' }, 'logo').patch,
    ).toEqual({ logoUrl: '' })
  })

  it('still enforces the ranges INSIDE the scoped part', () => {
    const { patch, dropped } = sanitizeLeagueStudioPatch(
      { colors: { primary: 'not-a-color', secondary: '#222222' } },
      'colors',
    )
    expect(patch).toEqual({ colors: { secondary: '#222222' } })
    expect(dropped).toContain('colors.primary')
  })
})

// ===========================================================================
// The LOCAL fallback matcher honors the same part scoping — a part-tagged
// prompt can only ever patch that part's fields.
// ===========================================================================

describe('applyChatIntent — part-scoped local fallback', () => {
  const cfg = { ...DEFAULT_LEAGUE_CONFIG, colors: { ...DEFAULT_LEAGUE_CONFIG.colors } }

  it('name part treats the message as the new name', () => {
    const r = applyChatIntent(cfg, 'Blaze League', 'name')
    expect(r.patch).toEqual({ name: 'Blaze League' })
  })

  it('tagline part treats the message as the new tagline', () => {
    const r = applyChatIntent(cfg, 'rise and grind', 'tagline')
    expect(r.patch).toEqual({ tagline: 'rise and grind' })
  })

  it('banner part recolors the accent slot only', () => {
    const r = applyChatIntent(cfg, 'make it gold', 'banner')
    expect(r.patch?.colors?.accent).toBe('#f5c542')
    // Everything else in colors is carried over unchanged, no other fields.
    expect(Object.keys(r.patch ?? {})).toEqual(['colors'])
  })

  it('colors part accepts a bare color and slot words', () => {
    const pair = applyChatIntent(cfg, 'crimson and gold', 'colors')
    expect(pair.patch?.colors?.primary).toBe('#a61e2e')
    expect(pair.patch?.colors?.accent).toBe('#f5c542')

    const slot = applyChatIntent(cfg, 'text cream', 'colors')
    expect(slot.patch?.colors?.text).toBe('#f0f0c0')
  })

  it('music part matches the library without needing the word "music"', () => {
    const r = applyChatIntent(cfg, 'Samurai Siren', 'music')
    expect(r.patch).toEqual({ music: 'meditativetiger-samurai-siren.mp3' })
    expect(applyChatIntent(cfg, 'no music please', 'music').patch).toEqual({ music: '' })
  })

  it('logo part can only clear the logo', () => {
    expect(applyChatIntent(cfg, 'remove the logo', 'logo').patch).toEqual({ logoUrl: '' })
    const keep = applyChatIntent(cfg, 'make it a dragon', 'logo')
    expect(keep.patch).toBeNull()
  })
})
