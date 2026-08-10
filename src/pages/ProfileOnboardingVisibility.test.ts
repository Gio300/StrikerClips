import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('onboarding identity in the normal profile', () => {
  it('renders the persisted profiles.game_tag outside the setup screen', () => {
    const profile = readFileSync(new URL('./Profile.tsx', import.meta.url), 'utf8')
    const types = readFileSync(new URL('../types/database.ts', import.meta.url), 'utf8')

    expect(profile).toContain('viewProfile?.game_tag')
    expect(profile).toContain('Gamer tag')
    expect(profile).toContain('{viewProfile.game_tag}')
    expect(types).toContain('game_tag?: string | null')
  })
})
