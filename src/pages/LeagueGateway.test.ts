import { describe, it, expect } from 'vitest'
import { MAKE_A_LEAGUE_BOARD_VARS } from './LeagueGateway'
import {
  contrastRatio,
  hexToChannels,
  shadeHex,
  TKO_NEUTRAL,
  TKO_NEUTRAL_BOARD_VARS,
} from '@/lib/leagueTheme'

// The /make-a-league surface wears brand board 03, derived from the TKO_NEUTRAL
// token table and never from ad-hoc constants. Browse keeps the main marketing
// board.
//
// PALETTE V3 2026-08-03 (operator: the live page must match the LIGHT reference
// image): both boards moved off the bright blue / deep royal fields onto the
// measured light family — paper canvas, white panels, dark ink, one sapphire
// CTA. The pricing board keeps its own identity by TINTING the paper
// (TKO_NEUTRAL.paper) and inking its links royal. The AA floors below are the
// same ones the earlier "hard to see" audit pinned; only the PAIRS moved,
// because body ink now comes out of the skin (--league-ink) instead of being
// hardcoded white at every call site.

/** "r g b" triplet → #rrggbb for contrast checks. */
function channelsToHex(triplet: string): string {
  const [r, g, b] = triplet.split(' ').map(Number)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

describe('LeagueGateway — the Make-a-league board skin', () => {
  it('derives the tinted-paper family straight from TKO_NEUTRAL', () => {
    expect(MAKE_A_LEAGUE_BOARD_VARS['--league-dark'])
      .toBe(hexToChannels(TKO_NEUTRAL.paper))
    expect(MAKE_A_LEAGUE_BOARD_VARS['--league-dark-card'])
      .toBe(hexToChannels(TKO_NEUTRAL.surface))
    expect(MAKE_A_LEAGUE_BOARD_VARS['--league-kunai'])
      .toBe(hexToChannels(TKO_NEUTRAL.blue))
    expect(MAKE_A_LEAGUE_BOARD_VARS['--league-kunai-dark'])
      .toBe(hexToChannels(TKO_NEUTRAL.royal))
    expect(MAKE_A_LEAGUE_BOARD_VARS['--league-accent'])
      .toBe(hexToChannels(TKO_NEUTRAL.royal))
    expect(MAKE_A_LEAGUE_BOARD_VARS['--league-chakra'])
      .toBe(hexToChannels(TKO_NEUTRAL.forest))
    expect(MAKE_A_LEAGUE_BOARD_VARS['--league-ink'])
      .toBe(hexToChannels(TKO_NEUTRAL.ink))
    expect(MAKE_A_LEAGUE_BOARD_VARS['--league-ink-muted'])
      .toBe(hexToChannels(TKO_NEUTRAL.inkMuted))
    expect(MAKE_A_LEAGUE_BOARD_VARS['--brand-cam'])
      .toBe(hexToChannels(TKO_NEUTRAL.royal))
  })

  it('covers every slot the marketing board covers (a full subtree skin)', () => {
    expect(Object.keys(MAKE_A_LEAGUE_BOARD_VARS).sort())
      .toEqual(Object.keys(TKO_NEUTRAL_BOARD_VARS).sort())
  })

  it('carries the ink slots, or the light field would render white-on-white', () => {
    for (const name of ['--league-ink', '--league-ink-muted', '--league-on-primary']) {
      expect(MAKE_A_LEAGUE_BOARD_VARS[name]).toBeDefined()
      expect(TKO_NEUTRAL_BOARD_VARS[name]).toBeDefined()
    }
  })

  it('is a DIFFERENT board than browse — tinted paper, not the plain canvas', () => {
    expect(MAKE_A_LEAGUE_BOARD_VARS['--league-dark'])
      .not.toBe(TKO_NEUTRAL_BOARD_VARS['--league-dark'])
    expect(MAKE_A_LEAGUE_BOARD_VARS['--league-accent'])
      .not.toBe(TKO_NEUTRAL_BOARD_VARS['--league-accent'])
    expect(MAKE_A_LEAGUE_BOARD_VARS['--league-kunai-2'])
      .not.toBe(TKO_NEUTRAL_BOARD_VARS['--league-kunai-2'])
  })

  it('…but stays in the LIGHT family (both fields are paper, not ink)', () => {
    for (const map of [MAKE_A_LEAGUE_BOARD_VARS, TKO_NEUTRAL_BOARD_VARS]) {
      const field = channelsToHex(map['--league-dark'])
      // white is closer to the field than black is → the field is light
      expect(contrastRatio('#ffffff', field)).toBeLessThan(contrastRatio('#000000', field))
      expect(map['--league-ink']).toBe(hexToChannels(TKO_NEUTRAL.ink))
    }
  })
})

describe('LeagueGateway — the Make-a-league board stays WCAG-AA legible', () => {
  const field = channelsToHex(MAKE_A_LEAGUE_BOARD_VARS['--league-dark'])
  const card = channelsToHex(MAKE_A_LEAGUE_BOARD_VARS['--league-dark-card'])
  const cta = channelsToHex(MAKE_A_LEAGUE_BOARD_VARS['--league-kunai'])
  const ctaLabel = channelsToHex(MAKE_A_LEAGUE_BOARD_VARS['--league-on-primary'])
  const link = channelsToHex(MAKE_A_LEAGUE_BOARD_VARS['--league-accent'])
  const cam = channelsToHex(MAKE_A_LEAGUE_BOARD_VARS['--brand-cam'])
  const chakra = channelsToHex(MAKE_A_LEAGUE_BOARD_VARS['--league-chakra'])
  const ink = channelsToHex(MAKE_A_LEAGUE_BOARD_VARS['--league-ink'])
  const inkMuted = channelsToHex(MAKE_A_LEAGUE_BOARD_VARS['--league-ink-muted'])

  it('body ink clears 4.5:1 on field and cards', () => {
    expect(contrastRatio(ink, field)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ink, card)).toBeGreaterThanOrEqual(4.5)
  })
  it('secondary ink clears 4.5:1 on field and cards', () => {
    expect(contrastRatio(inkMuted, field)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(inkMuted, card)).toBeGreaterThanOrEqual(4.5)
  })
  it('CTA label clears 4.5:1 on the kunai plate', () => {
    expect(contrastRatio(ctaLabel, cta)).toBeGreaterThanOrEqual(4.5)
  })
  it('royal links clear 4.5:1 on the tinted paper field', () => {
    expect(contrastRatio(link, field)).toBeGreaterThanOrEqual(4.5)
  })
  it('".cam" wordmark ink clears 3:1 (large type) on the field', () => {
    expect(contrastRatio(cam, field)).toBeGreaterThanOrEqual(3)
  })
  it('forest chakra accents clear 4.5:1 on the white cards', () => {
    expect(contrastRatio(chakra, card)).toBeGreaterThanOrEqual(4.5)
  })
  it('panels are LIGHTER than the field (paper plates lifted off the board)', () => {
    expect(contrastRatio(ink, card)).toBeGreaterThan(contrastRatio(ink, field))
  })
  it('hairline rules step DOWN from the field so the cards have edges', () => {
    const border = channelsToHex(MAKE_A_LEAGUE_BOARD_VARS['--league-dark-border'])
    expect(border).toBe(shadeHex(TKO_NEUTRAL.paper, -0.13))
    expect(contrastRatio(border, field)).toBeGreaterThan(1.15)
  })
})
