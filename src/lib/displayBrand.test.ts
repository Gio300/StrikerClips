import { describe, expect, it } from 'vitest'
import {
  leagueDisplayBrand,
  kingDisplayName,
  kingLadderDisplayName,
  rewriteVisibleBrandText,
  shouldShowInlineTkoAttribution,
  SSL_DISPLAY_BRAND,
  TKO_DISPLAY_BRAND,
} from './displayBrand'

describe('league-aware visible branding', () => {
  it('derives King UI labels without changing internal identifiers', () => {
    expect(kingDisplayName(SSL_DISPLAY_BRAND)).toBe('SSL King')
    expect(kingLadderDisplayName(SSL_DISPLAY_BRAND)).toBe('SSL King ladder')
    expect(kingDisplayName(TKO_DISPLAY_BRAND)).toBe('TKO King')
    expect(kingLadderDisplayName(TKO_DISPLAY_BRAND)).toBe('TKO King ladder')
  })

  it('uses SSL only for the Shinobi Striker League address takeover', () => {
    expect(leagueDisplayBrand({
      slug: 'shinobistrikerleague',
      name: 'SHINOBI STRIKER LEAGUE',
      source: 'domain',
    })).toEqual(SSL_DISPLAY_BRAND)
    expect(leagueDisplayBrand({ slug: 'shinobistrikerleague', source: 'stored' })).toEqual(TKO_DISPLAY_BRAND)
    expect(leagueDisplayBrand({ slug: 'circusrunaways', name: 'Circus Runaways', source: 'domain' })).toEqual(TKO_DISPLAY_BRAND)
    expect(leagueDisplayBrand({ slug: null, source: null })).toEqual(TKO_DISPLAY_BRAND)
  })

  it('rewrites platform UI copy while preserving the exact attribution', () => {
    expect(rewriteVisibleBrandText(
      'Ask TKO can open TKO King inside TKO.cam. Powered by TKO.cam',
      SSL_DISPLAY_BRAND,
    )).toBe('Ask SSL can open SSL King inside SSL. Powered by TKO.cam')
    expect(rewriteVisibleBrandText('Ask TKO', TKO_DISPLAY_BRAND)).toBe('Ask TKO')
  })

  it('maps visible TKO links to the real SSL origin instead of a display label', () => {
    expect(rewriteVisibleBrandText(
      'Open https://tko.cam/reels/demo or http://www.tko.cam/setup',
      SSL_DISPLAY_BRAND,
    )).toBe(
      'Open https://shinobistrikerleague.com/reels/demo or https://shinobistrikerleague.com/setup',
    )
    expect(rewriteVisibleBrandText(
      'Powered by TKO.cam · https://tko.cam/help',
      SSL_DISPLAY_BRAND,
    )).toBe('Powered by TKO.cam · https://shinobistrikerleague.com/help')
  })

  it('reserves SSL attribution for the global bottom line without changing other entitlement behavior', () => {
    expect(shouldShowInlineTkoAttribution(SSL_DISPLAY_BRAND, true)).toBe(false)
    expect(shouldShowInlineTkoAttribution(SSL_DISPLAY_BRAND, false)).toBe(false)
    expect(shouldShowInlineTkoAttribution(TKO_DISPLAY_BRAND, true)).toBe(false)
    expect(shouldShowInlineTkoAttribution(TKO_DISPLAY_BRAND, false)).toBe(true)
  })
})
