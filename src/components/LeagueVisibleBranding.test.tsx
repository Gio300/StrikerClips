import { create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { LeagueBottomAttribution } from './LeagueVisibleBranding'
import { SSL_DISPLAY_BRAND, TKO_DISPLAY_BRAND } from '@/lib/displayBrand'

describe('SSL bottom attribution', () => {
  it('renders the one exact attribution for SSL and nowhere for stock TKO', () => {
    const ssl = create(<LeagueBottomAttribution display={SSL_DISPLAY_BRAND} />)
    expect(ssl.root.findAllByProps({ 'data-tko-attribution': true })).toHaveLength(1)
    expect(ssl.root.findByType('span').children.join('')).toBe('Powered by TKO.cam')

    const stock = create(<LeagueBottomAttribution display={TKO_DISPLAY_BRAND} />)
    expect(stock.toJSON()).toBeNull()
  })
})
