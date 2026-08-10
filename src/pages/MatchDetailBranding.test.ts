import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('multi-angle match branding', () => {
  it('uses the active league name in player-visible status and recovery copy', () => {
    const source = readFileSync(new URL('./MatchDetail.tsx', import.meta.url), 'utf8')
    expect(source).toContain("const brandName = league?.name || 'TKO'")
    expect(source).toContain('{brandName} multi-angle game')
    expect(source).not.toContain('>TKO multi-angle game<')
    expect(source).not.toContain('current TKO version')
  })
})
