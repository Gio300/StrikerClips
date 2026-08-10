import { MemoryRouter } from 'react-router-dom'
import TestRenderer from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SSL_DISPLAY_BRAND, TKO_DISPLAY_BRAND } from '@/lib/displayBrand'
import { TkoKingHero } from './TkoKingHero'

let display = SSL_DISPLAY_BRAND

vi.mock('@/components/LeagueThemeProvider', () => ({
  useLeagueTheme: () => ({ display }),
}))

const mounted: TestRenderer.ReactTestRenderer[] = []

function renderHero() {
  const renderer = TestRenderer.create(
    <MemoryRouter><TkoKingHero /></MemoryRouter>,
  )
  mounted.push(renderer)
  return JSON.stringify(renderer.toJSON())
}

afterEach(() => {
  for (const renderer of mounted.splice(0)) renderer.unmount()
})

describe('King hero address branding', () => {
  it('renders SSL King on the SSL address without leaking the legacy label', () => {
    display = SSL_DISPLAY_BRAND
    const rendered = renderHero()
    expect(rendered).toContain('SSL King')
    expect(rendered).not.toContain('TKO King')
  })

  it('leaves the TKO address wording unchanged', () => {
    display = TKO_DISPLAY_BRAND
    const rendered = renderHero()
    expect(rendered).toContain('TKO King')
    expect(rendered).not.toContain('SSL King')
  })
})
