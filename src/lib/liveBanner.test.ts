import { describe, expect, it } from 'vitest'
import { buildLiveBannerSvg, isSafeLiveBannerUrl, normalizeLiveBannerUrl } from './liveBanner'

describe('live banners', () => {
  it('builds a branded template with escaped show text', () => {
    const svg = buildLiveBannerSvg({ title: 'Final <night>', teamA: 'Leaf & Co', teamB: 'Sand' })
    expect(svg).toContain('TKO<tspan')
    expect(svg).toContain('FINAL &lt;NIGHT&gt;')
    expect(svg).toContain('LEAF &amp; CO')
    expect(svg).toContain('SAND')
  })

  it('accepts secure links and compact raster data only', () => {
    expect(isSafeLiveBannerUrl('https://images.example/banner.jpg')).toBe(true)
    expect(isSafeLiveBannerUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeLiveBannerUrl('data:text/html;base64,AAAA')).toBe(false)
    expect(isSafeLiveBannerUrl('data:image/svg+xml,<svg/>')).toBe(false)
    expect(isSafeLiveBannerUrl('data:image/jpeg;base64,aGVsbG8=')).toBe(true)
  })

  it('normalizes invalid values to null', () => {
    expect(normalizeLiveBannerUrl('  https://images.example/banner.webp  ')).toBe('https://images.example/banner.webp')
    expect(normalizeLiveBannerUrl('http://insecure.example/banner.png')).toBeNull()
  })
})
