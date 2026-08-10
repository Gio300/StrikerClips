import { describe, it, expect } from 'vitest'
import {
  BRAND_SLOTS,
  PREVIEW_SCREENS,
  isUnbrandedDraft,
  placeholderFor,
} from './PhonePreview'
import { DEFAULT_LEAGUE_CONFIG } from '@/lib/leagueConfig'
import { LEAGUE_PREVIEW_PARTS, PART_LABEL } from '@/lib/leagueStudioRanges'

// The NEUTRAL DEFAULT rule (operator 2026-08-02): before a league customizes
// anything, the phone preview shows the app with NO branding — no league
// lockup, no TKO pitch. "Unbranded" is the untouched default draft.

describe('PhonePreview — isUnbrandedDraft', () => {
  const base = { ...DEFAULT_LEAGUE_CONFIG, colors: { ...DEFAULT_LEAGUE_CONFIG.colors } }

  it('the untouched default draft is unbranded', () => {
    expect(isUnbrandedDraft(base)).toBe(true)
  })

  it('naming the league brands the preview', () => {
    expect(isUnbrandedDraft({ ...base, slug: 'blaze', name: 'Blaze League' })).toBe(false)
  })

  it('uploading a logo brands the preview', () => {
    expect(isUnbrandedDraft({ ...base, logoUrl: 'data:image/png;base64,AAAA' })).toBe(false)
  })

  it('changing only colors keeps the branding off (still just the app demo)', () => {
    expect(
      isUnbrandedDraft({ ...base, colors: { ...base.colors, primary: '#a61e2e' } }),
    ).toBe(true)
  })
})

// Every unbranded brand slot renders an "Add …" placeholder that, when tapped,
// drops a blue reference chip scoped to a real preview PART. This proves the
// label↔part wiring the UI depends on: a placeholder can only ever reference a
// valid part, so the chip it drops is always one the AI (and the local
// fallback) know how to scope.
describe('PhonePreview — placeholder → chip wiring', () => {
  it('every brand slot references a real, chip-able preview part', () => {
    for (const slot of BRAND_SLOTS) {
      expect(LEAGUE_PREVIEW_PARTS).toContain(slot.part)
      // The chip that would be dropped has a human label.
      expect(PART_LABEL[slot.part].length).toBeGreaterThan(0)
    }
  })

  it('placeholders invite branding with an "Add …" label', () => {
    for (const slot of BRAND_SLOTS) {
      expect(slot.placeholder).toMatch(/^Add /)
      expect(placeholderFor(slot.part)).toBe(slot.placeholder)
    }
  })

  it('placeholderFor falls back to the chip label for non-slot parts (colors)', () => {
    expect(placeholderFor('colors')).toBe(PART_LABEL.colors)
  })

  it('exposes the five navigable app screens', () => {
    expect(PREVIEW_SCREENS).toEqual(['home', 'reels', 'live', 'tournament', 'standings'])
  })
})
