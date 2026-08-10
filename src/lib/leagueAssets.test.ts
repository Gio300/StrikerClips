import { describe, it, expect } from 'vitest'
import {
  INTRO_LIBRARY,
  OUTRO_LIBRARY,
  BANNER_LIBRARY,
  MUSIC_LIBRARY,
  leagueAssetKit,
  leagueMusicTrack,
  musicLabel,
} from './leagueAssets'
import { leagueKitFor, DEFAULT_LEAGUE_CONFIG, SEED_LEAGUES } from './leagueConfig'

describe('leagueAssets — the template vocabulary (lock-step with Loras/assets/brand)', () => {
  it('mirrors the renderer file names exactly', () => {
    // These literals ARE the contract with Loras/assets/brand +
    // common/tko_vertical.py — renaming either side breaks the render factory.
    expect(INTRO_LIBRARY.map((o) => o.file)).toEqual(['intro_vs_01.mp4'])
    expect(OUTRO_LIBRARY.map((o) => o.file)).toEqual(['outro_01.mp4', 'outro_02.mp4'])
    expect(BANNER_LIBRARY.map((o) => o.file)).toEqual([
      'banner_fire.jpg', 'banner_smoke.jpg', 'banner_dark.jpg',
    ])
  })

  it('uses stable, URL-safe pick ids (they ride in the reel layout marker)', () => {
    const all = [...INTRO_LIBRARY, ...OUTRO_LIBRARY, ...BANNER_LIBRARY, ...MUSIC_LIBRARY]
    for (const opt of all) {
      expect(opt.id).toMatch(/^[a-z0-9][a-z0-9._-]*$/)
      expect(opt.label.length).toBeGreaterThan(0)
    }
    // Ids are unique within each list.
    expect(new Set(BANNER_LIBRARY.map((o) => o.id)).size).toBe(BANNER_LIBRARY.length)
    expect(new Set(MUSIC_LIBRARY.map((o) => o.id)).size).toBe(MUSIC_LIBRARY.length)
  })
})

describe('leagueAssets — leagueMusicTrack (leagues.music jsonb shapes)', () => {
  it('reads a plain string, a {track} jsonb, and empties', () => {
    expect(leagueMusicTrack('a.mp3')).toBe('a.mp3')
    expect(leagueMusicTrack({ track: 'b.mp3' })).toBe('b.mp3')
    expect(leagueMusicTrack({})).toBe('')
    expect(leagueMusicTrack(null)).toBe('')
    expect(leagueMusicTrack(undefined)).toBe('')
    expect(leagueMusicTrack('  ')).toBe('')
  })
})

describe('leagueAssets — leagueAssetKit derivation', () => {
  it('null/absent league gets the full TKO house kit', () => {
    const kit = leagueAssetKit(null)
    expect(kit.intros).toEqual(INTRO_LIBRARY)
    expect(kit.outros).toEqual(OUTRO_LIBRARY)
    expect(kit.banners).toEqual(BANNER_LIBRARY)
    expect(kit.music).toEqual(MUSIC_LIBRARY)
  })

  it('hoists the league anthem to the front of the music list (no duplicate)', () => {
    const kit = leagueAssetKit({ music: { track: 'meditativetiger-samurai-siren.mp3' } })
    expect(kit.music[0].file).toBe('meditativetiger-samurai-siren.mp3')
    expect(kit.music[0].label).toBe('Samurai Siren')
    expect(kit.music.filter((t) => t.file === 'meditativetiger-samurai-siren.mp3')).toHaveLength(1)
    expect(kit.music).toHaveLength(MUSIC_LIBRARY.length)
  })

  it('prepends an unknown custom anthem with a friendly label', () => {
    const kit = leagueAssetKit({ music: 'our-league_anthem.mp3' })
    expect(kit.music[0]).toEqual({
      id: 'our-league_anthem',
      label: 'our league anthem',
      file: 'our-league_anthem.mp3',
    })
    expect(kit.music).toHaveLength(MUSIC_LIBRARY.length + 1)
  })

  it('never mutates the shared libraries (deterministic, side-effect free)', () => {
    const before = MUSIC_LIBRARY.length
    const kit = leagueAssetKit({ music: 'custom.mp3' })
    kit.music.pop()
    kit.banners.pop()
    expect(MUSIC_LIBRARY).toHaveLength(before)
    expect(BANNER_LIBRARY).toHaveLength(3)
    // Same input, same output.
    expect(leagueAssetKit({ music: 'custom.mp3' }).music[0].file).toBe('custom.mp3')
  })

  it('musicLabel resolves library files and falls back to the raw name', () => {
    expect(musicLabel('tensorverse-shadow-kage-suno.mp3')).toBe('Shadow Kage')
    expect(musicLabel('mystery.mp3')).toBe('mystery.mp3')
  })
})

describe('leagueConfig — leagueKitFor (the app-side accessor)', () => {
  it('defaults to the TKO house kit for null and for the TKO config', () => {
    expect(leagueKitFor(null).music).toEqual(MUSIC_LIBRARY)
    expect(leagueKitFor(DEFAULT_LEAGUE_CONFIG).banners).toEqual(BANNER_LIBRARY)
  })

  it('derives from the config music when no assets manifest is attached', () => {
    const ssl = SEED_LEAGUES.find((l) => l.slug === 'shinobistrikerleague')!
    const kit = leagueKitFor(ssl)
    expect(kit.music[0].file).toBe('suno_shinobi_striker_league.mp3')
    expect(kit.music[0].label).toBe('Shinobi Striker League')
  })

  it('prefers a server-attached assets manifest over re-derivation', () => {
    const kit = leagueKitFor({
      music: '',
      assets: {
        intros: [{ id: 'vs-01', label: 'Custom VS', file: 'intro_vs_01.mp4' }],
        outros: [],
        banners: [],
        music: [],
      },
    })
    expect(kit.intros[0].label).toBe('Custom VS')
    expect(kit.outros).toEqual([])
  })
})
