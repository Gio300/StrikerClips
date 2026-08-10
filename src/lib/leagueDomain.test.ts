import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  domainLeagueSlug,
  previewLeagueSlug,
  resolveLeagueAddress,
  resolveTakeover,
  routerBasename,
  seedLeagueBySlug,
  signedOutLandingPath,
  toThemeConfig,
} from './leagueDomain'
import { fetchLeagueBySlug, SEED_LEAGUES } from './leagueConfig'
import { leagueThemeVars, STOCK_LEAGUE_COLORS, STOCK_DARK_VARS, type ThemeStorage } from './leagueTheme'
import { activeLeagueSlug } from '@/components/LeagueWatermark'

/** In-memory storage stand-in (matches the broadcastTheme test pattern). */
function memStorage(): ThemeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v) },
    removeItem: (k) => { data.delete(k) },
  }
}

describe('leagueDomain — hostname resolution (reuses activeLeagueSlug)', () => {
  it('tko.cam and localhost are NOT league domains', () => {
    expect(domainLeagueSlug('tko.cam', '', null)).toBeNull()
    expect(domainLeagueSlug('www.tko.cam', '', null)).toBeNull()
    expect(domainLeagueSlug('localhost', '', null)).toBeNull()
    expect(domainLeagueSlug('127.0.0.1', '', null)).toBeNull()
  })

  it("a league's own domain resolves to its slug", () => {
    expect(domainLeagueSlug('shinobistrikerleague.com', '', null)).toBe('shinobistrikerleague')
    expect(domainLeagueSlug('www.shinobistrikerleague.com', '', null)).toBe('shinobistrikerleague')
  })

  it('subdomains of tko.cam resolve to the subdomain slug', () => {
    expect(domainLeagueSlug('blaze.tko.cam', '', null)).toBe('blaze')
  })

  it('the Amplify default domain is league #1', () => {
    expect(domainLeagueSlug('main.d123.amplifyapp.com', '', null)).toBe('shinobistrikerleague')
  })

  it('stays in lock-step with the watermark rule (single source of truth)', () => {
    for (const host of ['shinobistrikerleague.com', 'tko.cam', 'blaze.tko.cam']) {
      expect(domainLeagueSlug(host, '', null)).toBe(activeLeagueSlug(host))
    }
  })
})

describe('leagueDomain — ?league= preview override', () => {
  it('a valid ?league= slug wins over the hostname (localhost preview)', () => {
    expect(domainLeagueSlug('localhost', '?league=shinobistrikerleague', null)).toBe(
      'shinobistrikerleague',
    )
  })

  it('junk values are ignored (fail-soft, stock look)', () => {
    expect(previewLeagueSlug('?league=NOT%20A%20SLUG!!', null)).toBeNull()
    expect(previewLeagueSlug('?league=', null)).toBeNull()
    expect(previewLeagueSlug('', null)).toBeNull()
  })

  it('is sticky across navigations (param dropped, storage keeps it)', () => {
    const s = memStorage()
    expect(previewLeagueSlug('?league=blaze', s)).toBe('blaze')
    // next client-side navigation has no param — the preview persists
    expect(previewLeagueSlug('', s)).toBe('blaze')
    expect(domainLeagueSlug('localhost', '', s)).toBe('blaze')
  })

  it('?league=off ends the preview', () => {
    const s = memStorage()
    previewLeagueSlug('?league=blaze', s)
    expect(previewLeagueSlug('?league=off', s)).toBeNull()
    expect(previewLeagueSlug('', s)).toBeNull()
  })
})

describe('leagueDomain - native white-label lock', () => {
  it('keeps an SSL binary on SSL even at Capacitor localhost', () => {
    expect(resolveLeagueAddress(
      'localhost',
      '',
      null,
      '/',
      'shinobistrikerleague',
    )).toEqual({ slug: 'shinobistrikerleague', source: 'native' })
  })

  it('cannot be overridden by a preview, path, or hostname', () => {
    expect(resolveLeagueAddress(
      'blaze.tko.cam',
      '?league=blaze',
      null,
      '/blaze',
      'shinobistrikerleague',
    )).toEqual({ slug: 'shinobistrikerleague', source: 'native' })
  })

  it('ignores an invalid native slug and keeps normal web precedence', () => {
    expect(resolveLeagueAddress(
      'shinobistrikerleague.com',
      '?league=blaze',
      null,
      '/',
      'NOT A SLUG',
    )).toEqual({ slug: 'blaze', source: 'preview' })
  })
})

describe('leagueDomain — RUNG 1: the tko.cam/<slug> path takeover', () => {
  it('a path prefix resolves the league on plain tko.cam', () => {
    expect(domainLeagueSlug('tko.cam', '', null, '/shinobistrikerleague')).toBe(
      'shinobistrikerleague',
    )
    expect(domainLeagueSlug('tko.cam', '', null, '/shinobistrikerleague/reels/9')).toBe(
      'shinobistrikerleague',
    )
    expect(resolveLeagueAddress('tko.cam', '', null, '/blaze').source).toBe('path')
  })

  it("a reserved route is NEVER a league (the app's own doors keep working)", () => {
    expect(domainLeagueSlug('tko.cam', '', null, '/tournaments/abc')).toBeNull()
    expect(domainLeagueSlug('tko.cam', '', null, '/studio')).toBeNull()
    expect(domainLeagueSlug('tko.cam', '', null, '/leagues')).toBeNull()
    expect(domainLeagueSlug('tko.cam', '', null, '/reset-password')).toBeNull()
    expect(domainLeagueSlug('tko.cam', '', null, '/roster-invite')).toBeNull()
    expect(routerBasename('/', '/reset-password?token=one-time-code')).toBe('/')
    expect(domainLeagueSlug('tko.cam', '', null, '/')).toBeNull()
  })

  it('PRECEDENCE: ?league= preview > path > hostname', () => {
    // preview beats both
    expect(resolveLeagueAddress('shinobistrikerleague.com', '?league=blaze', null, '/other')).toEqual({
      slug: 'blaze', source: 'preview',
    })
    // path beats the hostname
    expect(resolveLeagueAddress('shinobistrikerleague.com', '', null, '/blaze')).toEqual({
      slug: 'blaze', source: 'path',
    })
    // hostname is the fallback
    expect(resolveLeagueAddress('shinobistrikerleague.com', '', null, '/reels')).toEqual({
      slug: 'shinobistrikerleague', source: 'hostname',
    })
    // nothing anywhere
    expect(resolveLeagueAddress('tko.cam', '', null, '/reels')).toEqual({ slug: null, source: null })
  })

  it('a path takeover lands on the league-branded login, like a domain does', () => {
    expect(signedOutLandingPath(domainLeagueSlug('tko.cam', '', null, '/shinobistrikerleague'))).toBe('/login')
    expect(signedOutLandingPath(domainLeagueSlug('tko.cam', '', null, '/reels'))).toBe('/leagues')
  })

  it('routerBasename mounts the whole app under the prefix (and nowhere else)', () => {
    expect(routerBasename('/', '/shinobistrikerleague/tournaments/1')).toBe('/shinobistrikerleague')
    // No prefix → exactly what main.tsx computed before rung 1 existed.
    expect(routerBasename('/', '/tournaments/1')).toBe('/')
    expect(routerBasename('/app/', '/app/blaze/reels')).toBe('/app/blaze')
    expect(routerBasename('/app/', '/app/reels')).toBe('/app')
  })
})

describe('leagueDomain — resolveTakeover (the merge rule)', () => {
  it('DOMAIN WINS over the member league', () => {
    expect(resolveTakeover('shinobistrikerleague', 'someotherleague')).toEqual({
      slug: 'shinobistrikerleague',
      source: 'domain',
    })
  })

  it('a member league NEVER re-skins tko.cam chrome (operator 2026-08-03: no crossed logos)', () => {
    // League branding lives on league DOMAINS only. A signed-in SSL member
    // browsing tko.cam keeps the stock TKO lockup/title/colors.
    expect(resolveTakeover(null, 'shinobistrikerleague')).toEqual({
      slug: null,
      source: null,
    })
  })

  it('no league anywhere → stock TKO', () => {
    expect(resolveTakeover(null, '')).toEqual({ slug: null, source: null })
    expect(resolveTakeover(null, null)).toEqual({ slug: null, source: null })
  })

  it('garbage member slugs are ignored (fail-soft)', () => {
    expect(resolveTakeover(null, 'NOT A SLUG')).toEqual({ slug: null, source: null })
  })
})

describe('leagueDomain — seeds + theme conversion (the takeover skin)', () => {
  it('seedLeagueBySlug finds bundled launch leagues and copies them', () => {
    const ssl = seedLeagueBySlug('shinobistrikerleague')
    expect(ssl?.name).toBe('SHINOBI STRIKER LEAGUE')
    // Mutating the copy must not poison the seed table.
    ssl!.colors.primary = '#000000'
    expect(SEED_LEAGUES[0].colors.primary).toBe(STOCK_LEAGUE_COLORS.primary)
    expect(seedLeagueBySlug('nosuchleague')).toBeNull()
    expect(seedLeagueBySlug(null)).toBeNull()
  })

  it('SSL is a BRANDING-ONLY takeover: stock colors PIN the stock-dark chrome', () => {
    const ssl = seedLeagueBySlug('shinobistrikerleague')!
    // The seed carries the stock-dark trio, not the SSL logo palette.
    expect(ssl.colors).toEqual({ ...STOCK_LEAGUE_COLORS })
    const theme = toThemeConfig(ssl)
    expect(theme.name).toBe('SHINOBI STRIKER LEAGUE')
    expect(theme.tier).toBe('enterprise')
    expect(theme.video_ownership).toBe('league')
    expect(theme.logo_url).toBeUndefined() // empty string → undefined
    // Stock colors pin STOCK_DARK_VARS: the SSL domain renders the ninja dark
    // (#07070a + orange) INDEPENDENT of tko.cam's neutral-navy :root, so the
    // takeover is byte-identical to the pre-navy chrome.
    expect(leagueThemeVars(theme)).toEqual(STOCK_DARK_VARS)
    expect(leagueThemeVars(theme)['--league-dark']).toBe('7 7 10')
    expect(leagueThemeVars(theme)['--league-kunai']).toBe('255 91 61')
  })

  it('END TO END: domain beats member; the SSL takeover pins the stock dark', () => {
    const { slug, source } = resolveTakeover(
      domainLeagueSlug('shinobistrikerleague.com', '', null),
      'someotherleague',
    )
    expect(source).toBe('domain')
    const vars = leagueThemeVars(toThemeConfig(seedLeagueBySlug(slug)!))
    expect(vars['--league-kunai']).toBe('255 91 61') // stock orange, not navy
    expect(vars['--league-dark']).toBe('7 7 10')     // stock #07070a field
  })
})

describe('leagueDomain — signed-out landing (a league domain IS the app)', () => {
  it('league domains land on the league-branded login, never the TKO gateway', () => {
    expect(signedOutLandingPath(domainLeagueSlug('shinobistrikerleague.com', '', null))).toBe('/login')
    expect(signedOutLandingPath(domainLeagueSlug('www.shinobistrikerleague.com', '', null))).toBe('/login')
    expect(signedOutLandingPath(domainLeagueSlug('main.d123.amplifyapp.com', '', null))).toBe('/login')
    expect(signedOutLandingPath(domainLeagueSlug('blaze.tko.cam', '', null))).toBe('/login')
  })

  it('tko.cam/localhost keep the league-growth gateway front door', () => {
    expect(signedOutLandingPath(domainLeagueSlug('tko.cam', '', null))).toBe('/leagues')
    expect(signedOutLandingPath(domainLeagueSlug('www.tko.cam', '', null))).toBe('/leagues')
    expect(signedOutLandingPath(domainLeagueSlug('localhost', '', null))).toBe('/leagues')
  })

  it('the ?league= preview forces the league-domain landing on localhost too', () => {
    expect(signedOutLandingPath(domainLeagueSlug('localhost', '?league=shinobistrikerleague', null))).toBe('/login')
  })
})

describe('leagueConfig — fetchLeagueBySlug (fail-soft)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('maps a live API row into a full LeagueConfig', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        slug: 'blaze',
        name: 'Blaze League',
        domain: 'blazeleague.gg',
        tagline: 'burn bright',
        colors: { primary: '#ff0000' },
        logo_url: 'https://cdn.example/blaze.png',
        music: { track: 'suno_blaze.mp3' },
        video_ownership: 'league',
        tier: 'pro',
      }),
    })))
    const cfg = await fetchLeagueBySlug('blaze')
    expect(cfg?.name).toBe('Blaze League')
    expect(cfg?.colors.primary).toBe('#ff0000')
    expect(cfg?.colors.secondary).toBeTruthy() // normalized over defaults
    expect(cfg?.logoUrl).toBe('https://cdn.example/blaze.png')
    expect(cfg?.music).toBe('suno_blaze.mp3')
    expect(cfg?.tier).toBe('pro')
    expect(cfg?.video_ownership).toBe('league')
  })

  it('falls back to the seeded launch leagues when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const cfg = await fetchLeagueBySlug('shinobistrikerleague')
    expect(cfg?.name).toBe('SHINOBI STRIKER LEAGUE')
    expect(cfg?.tier).toBe('enterprise')
  })

  it('resolves null — never throws — for unknown slugs with a dead API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await expect(fetchLeagueBySlug('nosuchleague')).resolves.toBeNull()
  })

  it('falls back to seeds on a non-OK response too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    const cfg = await fetchLeagueBySlug('shinobistrikerleague')
    expect(cfg?.name).toBe('SHINOBI STRIKER LEAGUE')
  })

  it('rejects malformed slugs without ever touching the network', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    await expect(fetchLeagueBySlug('NOT A SLUG')).resolves.toBeNull()
    await expect(fetchLeagueBySlug('')).resolves.toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})
