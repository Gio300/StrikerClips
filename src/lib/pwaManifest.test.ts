import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  brandDisplayName,
  buildLeagueManifest,
  DEFAULT_BRAND_NAME,
  hasLeaguePwaIcons,
  installLabel,
  LEAGUE_PWA_ICON_DIRS,
  leagueAppleTouchIcon,
  leagueManifestIcons,
  manifestHref,
  STOCK_DARK,
  syncManifestLink,
  TKO_MANIFEST,
} from './pwaManifest'

/**
 * THE PWA IS THE MOST VISIBLE WHITE-LABEL SURFACE THERE IS.
 *
 * A member of Shinobi Striker League taps "install" on their league's own
 * domain and a TKO icon lands on their home screen — that was the operator's
 * report (2026-08-06), and it happened because one static manifest served
 * every host. These tests pin the three things that must never regress:
 *
 *   1. TKO's manifest is EXACTLY what it always was (an installed app that
 *      changes identity is a lost user, not a cosmetic bug),
 *   2. a league's manifest carries the league's name AND real icons, and
 *   3. every icon a manifest names actually exists on disk — a 404 there does
 *      not fall through to the next entry, it silently drops the install to a
 *      generic glyph.
 */

const ROOT = join(__dirname, '..', '..')

describe('TKO_MANIFEST — the constant IS public/manifest.json', () => {
  it('deep-equals the shipped file, so the route and the static file cannot drift', () => {
    const onDisk = JSON.parse(readFileSync(join(ROOT, 'public', 'manifest.json'), 'utf8'))
    expect(TKO_MANIFEST).toEqual(onDisk)
  })

  it('keeps the pinned /app/ id — site and in-app installs are one TKO app', () => {
    expect(TKO_MANIFEST.id).toBe('/app/')
    expect(TKO_MANIFEST.name).toBe('TKO.cam')
    expect(TKO_MANIFEST.short_name).toBe('TKO')
  })
})

describe('brandDisplayName — a league name a human can read', () => {
  it('folds an ALL-CAPS stored name to title case', () => {
    // The leagues row really does say this; the app only looks right because
    // CSS uppercases it. A manifest string has no stylesheet.
    expect(brandDisplayName('SHINOBI STRIKER LEAGUE')).toBe('Shinobi Striker League')
    expect(brandDisplayName('CIRCUS RUNAWAYS')).toBe('Circus Runaways')
  })

  it("leaves an author's own mixed casing completely alone", () => {
    expect(brandDisplayName('Shinobi Striker League')).toBe('Shinobi Striker League')
    expect(brandDisplayName('TKO.cam')).toBe('TKO.cam')
    expect(brandDisplayName('eSports FC')).toBe('eSports FC')
  })

  it('keeps short all-caps runs, so acronyms survive', () => {
    expect(brandDisplayName('SSL')).toBe('SSL')
    expect(brandDisplayName('TKO')).toBe('TKO')
    expect(brandDisplayName('NA WEST LEAGUE')).toBe('NA West League')
  })

  it('degrades to empty for junk rather than inventing a name', () => {
    expect(brandDisplayName('')).toBe('')
    expect(brandDisplayName('   ')).toBe('')
    expect(brandDisplayName(null)).toBe('')
    expect(brandDisplayName(undefined)).toBe('')
  })
})

describe('installLabel — the six call sites now read one string', () => {
  it('is the operator\'s sentence on SSL', () => {
    expect(installLabel('SHINOBI STRIKER LEAGUE')).toBe('Install Shinobi Striker League')
  })

  it('defaults to TKO whenever no league owns the address', () => {
    expect(installLabel(null)).toBe(`Install ${DEFAULT_BRAND_NAME}`)
    expect(installLabel(undefined)).toBe('Install TKO')
    expect(installLabel('')).toBe('Install TKO')
  })
})

describe('buildLeagueManifest — a league identity, not a TKO one', () => {
  const ssl = buildLeagueManifest({
    slug: 'shinobistrikerleague',
    name: 'SHINOBI STRIKER LEAGUE',
    tagline: 'rise. strike. reign.',
  })

  it('names the league everywhere the OS shows a name', () => {
    expect(ssl.name).toBe('Shinobi Striker League')
    expect(ssl.short_name).toBe('Shinobi Striker League')
    expect(ssl.description).toContain('Shinobi Striker League — rise. strike. reign.')
    expect(ssl.name).not.toContain('TKO')
  })

  it('carries the league\'s OWN icons, never TKO\'s', () => {
    expect(ssl.icons).toEqual(leagueManifestIcons('shinobistrikerleague'))
    for (const icon of ssl.icons) {
      expect(icon.src).toContain('leagues/shinobistrikerleague/')
    }
    expect(ssl.icons.map((i) => i.purpose)).toEqual(['any', 'any', 'maskable', 'maskable'])
  })

  it('is origin-scoped on the league\'s own address (matches league_pwa.py)', () => {
    expect(ssl.id).toBe('/')
    expect(ssl.start_url).toBe('.')
    expect(ssl.scope).toBe('.')
  })

  it('scopes a PATH-rung install to its prefix so it cannot swallow tko.cam', () => {
    const path = buildLeagueManifest({
      slug: 'blaze', name: 'BLAZE', pathScope: '/blaze',
    })
    expect(path.id).toBe('/blaze/')
    expect(path.start_url).toBe('/blaze/')
    expect(path.scope).toBe('/blaze/')
    expect(path.id).not.toBe(TKO_MANIFEST.id)
  })

  it('keeps the stock dark chrome — league configs carry no surface color', () => {
    expect(ssl.background_color).toBe(STOCK_DARK)
    expect(ssl.theme_color).toBe(STOCK_DARK)
    expect(ssl.background_color).toBe(TKO_MANIFEST.background_color)
  })

  it('falls back to TKO icons (never a 404) for a league with none bundled', () => {
    const bare = buildLeagueManifest({ slug: 'circusrunaways', name: 'CIRCUS RUNAWAYS' })
    expect(hasLeaguePwaIcons('circusrunaways')).toBe(false)
    expect(bare.icons).toEqual(TKO_MANIFEST.icons)
    // The NAME is still the league's — a partial win beats a broken install.
    expect(bare.name).toBe('Circus Runaways')
  })

  it('degrades a nameless row to TKO rather than shipping a blank app name', () => {
    expect(buildLeagueManifest({ slug: 'x', name: '   ' }).name).toBe('TKO')
  })
})

describe('LEAGUE_PWA_ICON_DIRS — every icon it promises exists on disk', () => {
  it('has both manifest sizes present in public/ for every registered slug', () => {
    const slugs = Object.keys(LEAGUE_PWA_ICON_DIRS)
    expect(slugs.length).toBeGreaterThan(0)
    for (const slug of slugs) {
      for (const icon of leagueManifestIcons(slug)) {
        const file = join(ROOT, 'public', icon.src)
        expect(existsSync(file), `${icon.src} is named by the manifest but missing`).toBe(true)
      }
    }
  })

  it('ships the 180px apple-touch-icon too — iOS never reads the manifest', () => {
    for (const slug of Object.keys(LEAGUE_PWA_ICON_DIRS)) {
      const href = leagueAppleTouchIcon(slug)
      expect(href).toBeTruthy()
      expect(existsSync(join(ROOT, 'public', (href as string).slice(1)))).toBe(true)
    }
  })

  it('respects the deploy base, and is null for a league with no icons', () => {
    expect(leagueAppleTouchIcon('shinobistrikerleague', '/app/')).toBe(
      '/app/leagues/shinobistrikerleague/icon-180.png',
    )
    // Null means "leave the static TKO tag alone", which is the honest answer.
    expect(leagueAppleTouchIcon('circusrunaways')).toBeNull()
    expect(leagueAppleTouchIcon(null)).toBeNull()
  })
})

describe('manifestHref / syncManifestLink — the host-aware URL', () => {
  it('is the plain file when no league needs naming', () => {
    expect(manifestHref('/')).toBe('/manifest.json')
    expect(manifestHref('/app/')).toBe('/app/manifest.json')
    expect(manifestHref('/app', null)).toBe('/app/manifest.json')
  })

  it('names the league for the path rung, url-encoded', () => {
    expect(manifestHref('/', 'shinobistrikerleague')).toBe(
      '/manifest.json?league=shinobistrikerleague',
    )
    expect(manifestHref('/app/', 'a b')).toBe('/app/manifest.json?league=a%20b')
  })

  it('rewrites the link it finds and reports success', () => {
    let href = '/manifest.json'
    const doc = {
      querySelector: (sel: string) =>
        sel === 'link#app-manifest'
          ? { setAttribute: (_n: string, v: string) => { href = v } }
          : null,
    }
    expect(syncManifestLink(doc, '/', 'shinobistrikerleague')).toBe(true)
    expect(href).toBe('/manifest.json?league=shinobistrikerleague')
  })

  it('never throws when there is no document or no link — TKO\'s manifest stands', () => {
    expect(syncManifestLink(null, '/', 'x')).toBe(false)
    expect(syncManifestLink({ querySelector: () => null }, '/', 'x')).toBe(false)
    expect(syncManifestLink(
      { querySelector: () => { throw new Error('detached') } }, '/', 'x',
    )).toBe(false)
  })
})
