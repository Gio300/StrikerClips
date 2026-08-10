import { describe, expect, it } from 'vitest'
import { officialMarketplaceLabels } from './Shop'

describe('marketplace official branding', () => {
  it('uses SSL throughout the SSL marketplace', () => {
    expect(officialMarketplaceLabels('SSL')).toEqual({
      marketplace: 'SSL Marketplace',
      seller: 'SSL official',
      storefront: 'SSL',
    })
  })

  it('keeps TKO labels on the TKO address', () => {
    expect(officialMarketplaceLabels('TKO')).toEqual({
      marketplace: 'TKO Marketplace',
      seller: 'TKO official',
      storefront: 'TKO',
    })
  })
})
