import { describe, expect, it } from 'vitest'
import {
  FORGE_POWER_GROUPS,
  FORGE_POWER_OPTIONS,
  forgePowerByCode,
  forgePowersFromCodes,
} from './forgePowers'
import {
  FORGE_MAX_POWERS,
  FORGE_POWER_DESC_MAX,
  FORGE_POWER_NAME_MAX,
  sanitizeForgePowers,
} from './forgeTiers'

describe('forge power catalog', () => {
  it('every option is unique and survives the server sanitizer untouched', () => {
    // The Forge's dropdowns store these verbatim through
    // /api/fn/forge-artifact-save, which runs sanitizeForgePowers as the law.
    // A catalog entry the server would reject is a dropdown option that fails
    // at the moment someone forges — so hold the whole list to that bar.
    const codes = FORGE_POWER_OPTIONS.map((option) => option.code)
    expect(new Set(codes).size).toBe(codes.length)
    const names = FORGE_POWER_OPTIONS.map((option) => option.name)
    expect(new Set(names).size).toBe(names.length)

    for (const option of FORGE_POWER_OPTIONS) {
      expect(option.name.length).toBeGreaterThan(0)
      expect(option.name.length).toBeLessThanOrEqual(FORGE_POWER_NAME_MAX)
      expect(option.description.length).toBeLessThanOrEqual(FORGE_POWER_DESC_MAX)
      expect(FORGE_POWER_GROUPS).toContain(option.group)

      const check = sanitizeForgePowers([{ name: option.name, description: option.description }])
      expect(check.ok, `${option.code} must pass the server sanitizer`).toBe(true)
      // Stored exactly as listed — no squashing, no truncation.
      if (check.ok) expect(check.value[0]).toEqual({ name: option.name, description: option.description })
    }
  })

  it('offers at least one power in every dropdown group', () => {
    for (const group of FORGE_POWER_GROUPS) {
      expect(FORGE_POWER_OPTIONS.some((option) => option.group === group)).toBe(true)
    }
  })

  it('resolves codes to the stored { name, description } pairs', () => {
    const [first, second] = FORGE_POWER_OPTIONS
    expect(forgePowersFromCodes([first.code, second.code])).toEqual([
      { name: first.name, description: first.description },
      { name: second.name, description: second.description },
    ])
    expect(forgePowerByCode(first.code)).toEqual(first)
  })

  it('drops empty slots, unknown codes and duplicate picks', () => {
    const [first] = FORGE_POWER_OPTIONS
    // '' is an empty dropdown slot — the normal case, not an error.
    expect(forgePowersFromCodes(['', '', '', ''])).toEqual([])
    expect(forgePowersFromCodes(['not-a-power'])).toEqual([])
    // An artifact holds each power once, however the slots were filled.
    expect(forgePowersFromCodes([first.code, first.code, '', ''])).toEqual([
      { name: first.name, description: first.description },
    ])
  })

  it('a full set of dropdown slots never exceeds the 4-power cap', () => {
    // The cap is structural: there are exactly FORGE_MAX_POWERS slots, so even
    // filling every one of them lands inside what the server accepts.
    const full = FORGE_POWER_OPTIONS.slice(0, FORGE_MAX_POWERS).map((option) => option.code)
    const powers = forgePowersFromCodes(full)
    expect(powers).toHaveLength(FORGE_MAX_POWERS)
    expect(sanitizeForgePowers(powers).ok).toBe(true)

    // …and one more than the cap is what the server refuses, so the UI must
    // never be able to produce it.
    const over = FORGE_POWER_OPTIONS.slice(0, FORGE_MAX_POWERS + 1).map((option) => option.code)
    expect(sanitizeForgePowers(forgePowersFromCodes(over)).ok).toBe(false)
  })
})
