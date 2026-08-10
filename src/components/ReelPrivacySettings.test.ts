import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REEL_USE_PRIVACY,
  REEL_USE_PRIVACY_OPTIONS,
  REEL_USE_PRIVACY_VALUES,
  normalizeReelUsePrivacy,
} from '@/lib/reelPrivacy'

const SRC = join(__dirname, '..')
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8')

describe('More > Privacy', () => {
  it('uses followers of followers as the safe default and exposes every requested choice', () => {
    expect(DEFAULT_REEL_USE_PRIVACY).toBe('followers_of_followers')
    expect(normalizeReelUsePrivacy('unknown')).toBe(DEFAULT_REEL_USE_PRIVACY)
    expect(REEL_USE_PRIVACY_OPTIONS.map((option) => option.value)).toEqual([
      'followers_of_followers',
      'followers',
      'clan_members',
      'clan_officers',
      'tournaments',
      'lives',
      'only_me',
      'anyone',
    ])
    expect(new Set(REEL_USE_PRIVACY_OPTIONS.map((option) => option.value))).toEqual(
      new Set(REEL_USE_PRIVACY_VALUES),
    )
  })

  it('puts Privacy directly in More and keeps the legal policy separate', () => {
    expect(read('components/BottomNav.tsx')).toContain("to: '/privacy-settings', label: 'Privacy'")
    expect(read('App.tsx')).toContain('path="privacy-settings"')
    expect(read('App.tsx')).toContain('path="privacy" element={<Privacy />}')
  })

  it('uses one tap-to-save radio list', () => {
    const page = read('pages/ReelPrivacy.tsx')
    expect(page).toContain('Who can use my reels?')
    expect(page).toContain('type="radio"')
    expect(page).toContain('saveReelUsePrivacy')
  })
})
