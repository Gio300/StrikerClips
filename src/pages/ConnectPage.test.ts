import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('YouTube footage page', () => {
  it('separates a connected channel from individually saved video links', () => {
    const source = readFileSync(new URL('./Connect.tsx', import.meta.url), 'utf8')
    expect(source).toContain('Check or change my connected channel')
    expect(source).toContain('/settings#youtube')
    expect(source).toContain('This saves footage; it does not replace')
    expect(source).toContain('Your saved videos')
  })

  it('uses the active league name instead of hard-coding TKO into the explanation', () => {
    const source = readFileSync(new URL('./Connect.tsx', import.meta.url), 'utf8')
    expect(source).toContain('league?.name')
    expect(source).not.toContain('BRAND.name')
  })
})
