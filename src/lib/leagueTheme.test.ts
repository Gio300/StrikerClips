import { describe, it, expect } from 'vitest'
import {
  contrastRatio,
  DEFAULT_LEAGUE_CONFIG,
  hexToChannels,
  isStockLeagueColors,
  leagueThemeVars,
  loadLeagueTheme,
  normalizeHex,
  saveLeagueTheme,
  clearLeagueTheme,
  shadeHex,
  LEAGUE_THEME_VAR_NAMES,
  STOCK_LEAGUE_COLORS,
  STOCK_DARK_VARS,
  TKO_NEUTRAL,
  TKO_NEUTRAL_BOARD_VARS,
  TKO_NEUTRAL_STUDIO_VARS,
  type LeaguePatch,
  type ThemeStorage,
} from './leagueTheme'

/** "r g b" triplet → #rrggbb, so contrast checks can read the var maps. */
function channelsToHex(triplet: string): string {
  const [r, g, b] = triplet.split(' ').map(Number)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/** In-memory storage stand-in so tests never touch a real localStorage. */
function memStorage(): ThemeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v) },
    removeItem: (k) => { data.delete(k) },
  }
}

describe('leagueTheme — color math', () => {
  it('normalizeHex accepts 6-digit hex with or without #', () => {
    expect(normalizeHex('#FF5B3D')).toBe('#ff5b3d')
    expect(normalizeHex('2ed3dc')).toBe('#2ed3dc')
  })
  it('normalizeHex expands 3-digit shorthand', () => {
    expect(normalizeHex('#f80')).toBe('#ff8800')
  })
  it('normalizeHex returns null on junk (so defaults survive)', () => {
    expect(normalizeHex('crimson')).toBeNull()
    expect(normalizeHex('')).toBeNull()
    expect(normalizeHex(null)).toBeNull()
  })
  it('hexToChannels produces the "r g b" triplet tailwind wants', () => {
    expect(hexToChannels('#ff5b3d')).toBe('255 91 61')
    expect(hexToChannels('#07070a')).toBe('7 7 10')
  })
  it('shadeHex mixes toward black or white', () => {
    expect(shadeHex('#808080', -1)).toBe('#000000')
    expect(shadeHex('#808080', 1)).toBe('#ffffff')
    expect(shadeHex('#ff0000', 0)).toBe('#ff0000')
  })
  it('contrastRatio matches the WCAG anchors', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5) // symmetric
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5)
    // #767676 on white is the canonical "just passes AA" gray.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThan(4.5)
  })
})

// Contrast floors for the marketing board. PALETTE V3 (operator 2026-08-03)
// flipped this board from a bright blue field with white ink to the measured
// LIGHT product surface — paper canvas, white panels, dark ink. The floors
// below are the same ones the original "hard to see" audit pinned; only the
// PAIRS moved, because the body ink is no longer literally white. The ink now
// comes out of the skin itself (--league-ink), which is the whole point: a
// board can flip families without any surface hardcoding white.
describe('leagueTheme — TKO board skins stay WCAG-AA legible', () => {
  const field = channelsToHex(TKO_NEUTRAL_BOARD_VARS['--league-dark'])
  const card = channelsToHex(TKO_NEUTRAL_BOARD_VARS['--league-dark-card'])
  const cta = channelsToHex(TKO_NEUTRAL_BOARD_VARS['--league-kunai'])
  const ctaLabel = channelsToHex(TKO_NEUTRAL_BOARD_VARS['--league-on-primary'])
  const link = channelsToHex(TKO_NEUTRAL_BOARD_VARS['--league-accent'])
  const cam = channelsToHex(TKO_NEUTRAL_BOARD_VARS['--brand-cam'])
  const ink = channelsToHex(TKO_NEUTRAL_BOARD_VARS['--league-ink'])
  const inkMuted = channelsToHex(TKO_NEUTRAL_BOARD_VARS['--league-ink-muted'])
  const chakra = channelsToHex(TKO_NEUTRAL_BOARD_VARS['--league-chakra'])

  it('browse board: body ink clears 4.5:1 on field and cards', () => {
    expect(contrastRatio(ink, field)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ink, card)).toBeGreaterThanOrEqual(4.5)
  })
  it('browse board: SECONDARY ink clears 4.5:1 on field and cards', () => {
    expect(contrastRatio(inkMuted, field)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(inkMuted, card)).toBeGreaterThanOrEqual(4.5)
  })
  it('browse board: CTA label clears 4.5:1 on the kunai plate', () => {
    expect(contrastRatio(ctaLabel, cta)).toBeGreaterThanOrEqual(4.5)
  })
  it('browse board: link ink clears 4.5:1 on the field', () => {
    expect(contrastRatio(link, field)).toBeGreaterThanOrEqual(4.5)
  })
  it('browse board: highlight ink clears 4.5:1 on field and cards', () => {
    expect(contrastRatio(chakra, field)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(chakra, card)).toBeGreaterThanOrEqual(4.5)
  })
  it('browse board: ".cam" wordmark ink clears 3:1 (large type) on the field', () => {
    expect(contrastRatio(cam, field)).toBeGreaterThanOrEqual(3)
  })
  it('browse board: panels are LIGHTER than the field (paper plates on paper)', () => {
    // The v2 board was ink plates on a bright field; v3 is white cards lifted
    // OFF a paper canvas, so the direction inverts — cards sit further from
    // the ink than the field does.
    expect(contrastRatio(ink, card)).toBeGreaterThan(contrastRatio(ink, field))
  })

  it('studio: ".cam" wordmark is the azure link ink — 4.5:1+ on the paper field', () => {
    const studioCam = channelsToHex(TKO_NEUTRAL_STUDIO_VARS['--brand-cam'])
    expect(studioCam).toBe(TKO_NEUTRAL.azure)
    expect(contrastRatio(studioCam, TKO_NEUTRAL.canvas)).toBeGreaterThanOrEqual(4.5)
  })
})

// The stock TKO look — DEFAULT_LEAGUE_CONFIG — is what the gateway boards, the
// marketing page, the Studio chrome and the Studio's phone MOCKUP all wear.
// Palette v3 made it the measured LIGHT surface, so these pin the exact map and
// its AA floors. (index.css :root is a SEPARATE map now — see the next block.)
describe('leagueTheme — the light TKO stock look (boards · Studio · mockup)', () => {
  const V = leagueThemeVars(DEFAULT_LEAGUE_CONFIG)
  const dark = channelsToHex(V['--league-dark'])
  const card = channelsToHex(V['--league-dark-card'])
  const kunai = channelsToHex(V['--league-kunai'])
  const accent = channelsToHex(V['--league-accent'])
  const chakra = channelsToHex(V['--league-chakra'])
  const ink = channelsToHex(V['--league-ink'])
  const inkMuted = channelsToHex(V['--league-ink-muted'])
  const onPrimary = channelsToHex(V['--league-on-primary'])

  it('is the measured light map (paper canvas, white panels, dark ink)', () => {
    expect(V['--league-dark']).toBe('236 238 242')        // #eceef2 paper canvas
    expect(V['--league-dark-card']).toBe('255 255 255')   // #ffffff panels
    expect(V['--league-dark-elevated']).toBe('245 246 248') // #f5f6f8 insets
    expect(V['--league-dark-border']).toBe('210 212 215')   // #d2d4d7 hairlines
    expect(V['--league-kunai']).toBe('43 105 228')        // #2b69e4 sapphire CTA
    expect(V['--league-accent']).toBe('37 96 212')        // #2560d4 azure links
    expect(V['--league-chakra']).toBe('15 115 80')        // #0f7350 forest ink
    expect(V['--league-ink']).toBe('22 32 46')            // #16202e
    expect(V['--league-ink-muted']).toBe('86 95 110')     // #565f6e
    // the Studio subtree and the browse board derive from the same look
    expect(TKO_NEUTRAL_STUDIO_VARS['--league-dark']).toBe(V['--league-dark'])
    expect(TKO_NEUTRAL_STUDIO_VARS['--league-kunai']).toBe(V['--league-kunai'])
    expect(TKO_NEUTRAL_BOARD_VARS['--league-dark']).toBe(V['--league-dark'])
    expect(TKO_NEUTRAL_BOARD_VARS['--league-ink']).toBe(V['--league-ink'])
  })

  it('body + secondary text clear 4.5:1 on the light surfaces', () => {
    expect(contrastRatio(ink, dark)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ink, card)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(inkMuted, dark)).toBeGreaterThanOrEqual(4.5) // muted body
    expect(contrastRatio(inkMuted, card)).toBeGreaterThanOrEqual(4.5)
  })
  it('CTA label clears 4.5:1 on the sapphire kunai plate', () => {
    expect(contrastRatio(onPrimary, kunai)).toBeGreaterThanOrEqual(4.5)
  })
  it('accent links + chakra highlights clear 4.5:1 on the field', () => {
    expect(contrastRatio(accent, dark)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(chakra, dark)).toBeGreaterThanOrEqual(4.5)
  })
  it('the sapphire CTA fill clears the 3:1 large/UI floor as ink on the field', () => {
    expect(contrastRatio(kunai, dark)).toBeGreaterThanOrEqual(3)
  })
})

// The in-app product chrome (index.css :root) stays the neutral NAVY: the
// signed-in surfaces are a video/esports shell and were not part of the v3
// light restyle. This block is the map index.css must mirror — it is no longer
// leagueThemeVars(DEFAULT_LEAGUE_CONFIG), so it is pinned literally here.
describe('leagueTheme — the in-app navy chrome (index.css :root)', () => {
  const ROOT = {
    dark: '#1a2636',
    card: '#232f3e',
    elevated: '#2a3544',
    border: '#384250',
    kunai: '#2b69e4',
    accent: '#a8c3e1',
    chakra: '#40c094',
    ink: '#f3f4f6',
    inkMuted: '#cbd5e1',
    onPrimary: '#ffffff',
  }

  it('keeps the measured navy tokens (the surfaces index.css declares)', () => {
    expect(ROOT.dark).toBe(TKO_NEUTRAL.navy)
    expect(ROOT.kunai).toBe(TKO_NEUTRAL.blue)
    expect(ROOT.accent).toBe(TKO_NEUTRAL.cyan)
    expect(ROOT.chakra).toBe(TKO_NEUTRAL.teal)
    expect(ROOT.ink).toBe(TKO_NEUTRAL.inkOnDark)
    expect(ROOT.inkMuted).toBe(TKO_NEUTRAL.inkMutedOnDark)
  })
  it('body + secondary ink clear 4.5:1 on the navy surfaces', () => {
    expect(contrastRatio(ROOT.ink, ROOT.dark)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ROOT.ink, ROOT.card)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ROOT.inkMuted, ROOT.dark)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ROOT.inkMuted, ROOT.card)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#9ca3af', ROOT.dark)).toBeGreaterThanOrEqual(4.5) // legacy gray-400
  })
  it('white CTA label clears 4.5:1 on the sapphire kunai plate', () => {
    expect(contrastRatio(ROOT.onPrimary, ROOT.kunai)).toBeGreaterThanOrEqual(4.5)
  })
  it('accent links + chakra highlights clear 4.5:1 on the field', () => {
    expect(contrastRatio(ROOT.accent, ROOT.dark)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ROOT.chakra, ROOT.dark)).toBeGreaterThanOrEqual(4.5)
  })
  it('the sapphire accent clears the 3:1 large/UI floor as ink on the field', () => {
    expect(contrastRatio(ROOT.kunai, ROOT.dark)).toBeGreaterThanOrEqual(3)
  })
})

// The ink pair is DERIVED from the surface luminance, so a league that picks a
// light background can never end up with white-on-white copy (the exact bug
// that made the v3 restyle a two-line change instead of a 90-file one).
describe('leagueTheme — ink follows the surface', () => {
  it('a LIGHT league background emits dark ink and white panels', () => {
    const v = leagueThemeVars({ name: 'Paper', colors: { primary: '#2b69e4', background: '#eceef2' } })
    expect(v['--league-ink']).toBe(hexToChannels(TKO_NEUTRAL.ink))
    expect(v['--league-ink-muted']).toBe(hexToChannels(TKO_NEUTRAL.inkMuted))
    expect(v['--league-dark-card']).toBe('255 255 255')
    // …and the rules step DOWN from the field, or a light board has no edges
    expect(contrastRatio(channelsToHex(v['--league-dark-border']), '#eceef2'))
      .toBeGreaterThan(1.15)
  })
  it('a DARK league background emits light ink (unchanged behaviour)', () => {
    const v = leagueThemeVars({ name: 'Ink', colors: { primary: '#ff5b3d', background: '#0e1a2f' } })
    expect(v['--league-ink']).toBe(hexToChannels(TKO_NEUTRAL.inkOnDark))
    expect(v['--league-ink-muted']).toBe(hexToChannels(TKO_NEUTRAL.inkMutedOnDark))
  })
  it('every emitted ink pair clears 4.5:1 on its own field', () => {
    for (const background of ['#eceef2', '#e4eaf6', '#ffffff', '#0e1a2f', '#07070a', '#1a2636']) {
      const v = leagueThemeVars({ name: 'X', colors: { primary: '#2b69e4', background } })
      expect(contrastRatio(channelsToHex(v['--league-ink']), background)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(channelsToHex(v['--league-ink-muted']), background)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('a PASTEL primary flips the CTA label to ink instead of shipping white-on-white', () => {
    const pastel = leagueThemeVars({ name: 'Pastel', colors: { primary: '#ffd9a0' } })
    expect(pastel['--league-on-primary']).toBe(hexToChannels(TKO_NEUTRAL.ink))
    expect(contrastRatio(channelsToHex(pastel['--league-on-primary']), '#ffd9a0'))
      .toBeGreaterThanOrEqual(4.5)
  })
})

// SSL (shinobistrikerleague.com) is a branding-only takeover: it pins
// STOCK_DARK_VARS, so it stays the ninja dark independent of tko.cam's navy
// :root — byte-identical to the pre-navy look, and still WCAG-AA.
describe('leagueTheme — SSL stock-dark chrome stays AA + independent of :root', () => {
  const dark = channelsToHex(STOCK_DARK_VARS['--league-dark'])
  const kunai = channelsToHex(STOCK_DARK_VARS['--league-kunai'])
  const accent = channelsToHex(STOCK_DARK_VARS['--league-accent'])
  const chakra = channelsToHex(STOCK_DARK_VARS['--league-chakra'])

  it('is the exact pre-navy stock dark (#07070a field, orange brand)', () => {
    expect(dark).toBe('#07070a')
    expect(kunai).toBe('#ff5b3d')
  })
  it('body/accent/highlight clear 4.5:1 on the #07070a field', () => {
    expect(contrastRatio('#f3f4f6', dark)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(accent, dark)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(chakra, dark)).toBeGreaterThanOrEqual(4.5)
  })
  it('pins the LIGHT-ON-DARK ink pair (v3 added the slots; SSL must not flip)', () => {
    expect(STOCK_DARK_VARS['--league-ink']).toBe(hexToChannels(TKO_NEUTRAL.inkOnDark))
    expect(STOCK_DARK_VARS['--league-ink-muted']).toBe(hexToChannels(TKO_NEUTRAL.inkMutedOnDark))
    expect(contrastRatio(channelsToHex(STOCK_DARK_VARS['--league-ink']), dark))
      .toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(channelsToHex(STOCK_DARK_VARS['--league-ink-muted']), dark))
      .toBeGreaterThanOrEqual(4.5)
  })
  it('keeps the WHITE CTA label on the orange plate (byte-identical to pre-v3)', () => {
    // leagueThemeVars' derived rule would have flipped this 3.08:1 pair to dark
    // ink; SSL returns STOCK_DARK_VARS early, so the stock look is preserved.
    expect(STOCK_DARK_VARS['--league-on-primary']).toBe('255 255 255')
    expect(leagueThemeVars({ name: 'SSL', colors: { ...STOCK_LEAGUE_COLORS } })['--league-on-primary'])
      .toBe('255 255 255')
  })
})

describe('leagueTheme — leagueThemeVars', () => {
  it('maps primary/secondary/accent onto the kunai/accent/chakra slots', () => {
    const vars = leagueThemeVars({
      name: 'SSL',
      colors: { primary: '#484878', secondary: '#480000', accent: '#f0f0c0' },
    })
    expect(vars['--league-kunai']).toBe('72 72 120')
    expect(vars['--league-accent']).toBe('72 0 0')
    expect(vars['--league-chakra']).toBe('240 240 192')
    // derived companions exist
    expect(vars['--league-kunai-dark']).toBeDefined()
    expect(vars['--league-kunai-2']).toBeDefined()
    expect(vars['--league-accent-muted']).toBeDefined()
    expect(vars['--league-chakra-dark']).toBeDefined()
  })

  it('derives secondary and accent from primary when absent', () => {
    const vars = leagueThemeVars({ name: 'Solo', colors: { primary: '#ff5b3d' } })
    expect(vars['--league-accent']).toBeDefined()
    expect(vars['--league-chakra']).toBeDefined()
  })

  it('leaves the dark surfaces alone unless a background is given', () => {
    const noBg = leagueThemeVars({ name: 'X', colors: { primary: '#ff5b3d' } })
    expect(noBg['--league-dark']).toBeUndefined()

    const withBg = leagueThemeVars({
      name: 'X',
      colors: { primary: '#ff5b3d', background: '#0e1a2f' },
    })
    expect(withBg['--league-dark']).toBe('14 26 47')
    expect(withBg['--league-dark-card']).toBeDefined()
    expect(withBg['--league-dark-border']).toBeDefined()
    expect(withBg['--league-dark-elevated']).toBeDefined()
  })

  it('skips invalid colors instead of poisoning the variables', () => {
    const vars = leagueThemeVars({ name: 'Bad', colors: { primary: 'garbage' } })
    expect(vars['--league-kunai']).toBeUndefined()
  })

  it('only ever emits known variable names', () => {
    const vars = leagueThemeVars(DEFAULT_LEAGUE_CONFIG)
    const known = new Set<string>(LEAGUE_THEME_VAR_NAMES)
    for (const name of Object.keys(vars)) expect(known.has(name)).toBe(true)
  })

  it('BRANDING-ONLY league: stock colors PIN the stock-dark chrome (independent of :root)', () => {
    // A league whose colors equal the stock-dark trio pins STOCK_DARK_VARS —
    // the exact pre-navy index.css :root — so the takeover (SSL) renders its
    // ninja dark regardless of tko.cam's neutral-navy :root default. Before
    // 2026-08-03 this returned {} and inherited :root (which WAS the stock
    // dark); now :root is navy, so it must EMIT the dark map to stay unchanged.
    expect(isStockLeagueColors({ ...STOCK_LEAGUE_COLORS })).toBe(true)
    expect(leagueThemeVars({ name: 'SSL', colors: { ...STOCK_LEAGUE_COLORS } })).toEqual(STOCK_DARK_VARS)
    // …the stock-dark field + orange brand are pinned, independent of :root.
    expect(leagueThemeVars({ name: 'SSL', colors: { ...STOCK_LEAGUE_COLORS } })['--league-dark']).toBe('7 7 10')
    expect(leagueThemeVars({ name: 'SSL', colors: { ...STOCK_LEAGUE_COLORS } })['--league-kunai']).toBe('255 91 61')
    // Any real customization still re-skins…
    expect(isStockLeagueColors({ ...STOCK_LEAGUE_COLORS, primary: '#484878' })).toBe(false)
    expect(
      leagueThemeVars({ name: 'X', colors: { ...STOCK_LEAGUE_COLORS, primary: '#484878' } })['--league-kunai'],
    ).toBe('72 72 120')
    // …and a custom surface background disables the shortcut too.
    expect(isStockLeagueColors({ ...STOCK_LEAGUE_COLORS, background: '#0e1a2f' })).toBe(false)
    expect(
      leagueThemeVars({ name: 'X', colors: { ...STOCK_LEAGUE_COLORS, background: '#0e1a2f' } })['--league-dark'],
    ).toBe('14 26 47')
  })
})

describe('leagueTheme — load/save', () => {
  it('returns null (stock chrome) when nothing is stored', () => {
    const s = memStorage()
    expect(loadLeagueTheme('active', s)).toBeNull()
  })

  it('round-trips a saved config, keyed independently', () => {
    const s = memStorage()
    const ssl: LeaguePatch = {
      slug: 'ssl',
      name: 'SHINOBI STRIKER LEAGUE',
      colors: { primary: '#484878', secondary: '#480000', accent: '#f0f0c0' },
      tagline: 'rise. strike. reign.',
      video_ownership: 'league',
    }
    saveLeagueTheme('active', ssl, s)
    saveLeagueTheme('studio', { name: 'Draft League', colors: { primary: '#123456' } }, s)

    const a = loadLeagueTheme('active', s)
    expect(a?.name).toBe('SHINOBI STRIKER LEAGUE')
    expect(a?.colors.primary).toBe('#484878')
    // studio draft did not bleed into the active key
    const d = loadLeagueTheme('studio', s)
    expect(d?.name).toBe('Draft League')
  })

  it('merges partial patches — including nested colors — over the stored config', () => {
    const s = memStorage()
    saveLeagueTheme('k', { name: 'Blaze', colors: { primary: '#ff0000', accent: '#ffcc00' } }, s)
    saveLeagueTheme('k', { colors: { accent: '#00ffcc' } }, s)
    const t = loadLeagueTheme('k', s)
    expect(t?.name).toBe('Blaze')               // preserved
    expect(t?.colors.primary).toBe('#ff0000')   // preserved
    expect(t?.colors.accent).toBe('#00ffcc')    // patched
  })

  it('clearLeagueTheme drops the config back to stock', () => {
    const s = memStorage()
    saveLeagueTheme('k', { name: 'Gone', colors: { primary: '#ff0000' } }, s)
    clearLeagueTheme('k', s)
    expect(loadLeagueTheme('k', s)).toBeNull()
  })
})
