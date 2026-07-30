import { describe, it, expect } from 'vitest'
import {
  MIN_AGE_YEARS,
  ageOnDate,
  validateDateOfBirth,
  isOldEnough,
  maxEligibleDob,
  buildAgeAttestation,
} from './age'

/** A fixed "today" so none of these tests rot as the calendar moves. */
const NOW = new Date('2026-07-22T12:00:00Z')

describe('ageOnDate', () => {
  it('counts whole years', () => {
    expect(ageOnDate('2000-07-22', NOW)).toBe(26)
    expect(ageOnDate('1990-01-01', NOW)).toBe(36)
  })

  it('counts a birthday ON the day, not the day after', () => {
    expect(ageOnDate('2013-07-22', NOW)).toBe(13) // 13 today
    expect(ageOnDate('2013-07-21', NOW)).toBe(13) // 13 yesterday
    expect(ageOnDate('2013-07-23', NOW)).toBe(12) // 13 tomorrow
  })

  it('handles a leap-day birth date', () => {
    expect(ageOnDate('2012-02-29', NOW)).toBe(14)
  })

  it('returns null for anything that is not a real calendar date', () => {
    expect(ageOnDate('', NOW)).toBeNull()
    expect(ageOnDate('nope', NOW)).toBeNull()
    expect(ageOnDate('22/07/2013', NOW)).toBeNull()
    expect(ageOnDate('2013-7-2', NOW)).toBeNull()
    expect(ageOnDate('2013-13-01', NOW)).toBeNull()
    expect(ageOnDate('2011-02-30', NOW)).toBeNull() // would roll to Mar 2
    expect(ageOnDate('2013-04-31', NOW)).toBeNull()
  })

  it('is negative for a future date rather than silently passing', () => {
    expect(ageOnDate('2030-01-01', NOW)).toBeLessThan(0)
  })
})

describe('validateDateOfBirth', () => {
  it('accepts someone comfortably over the line', () => {
    const r = validateDateOfBirth('1995-06-15', NOW)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.age).toBe(31)
  })

  it(`accepts exactly ${MIN_AGE_YEARS} on the birthday itself`, () => {
    const r = validateDateOfBirth('2013-07-22', NOW)
    expect(r.ok).toBe(true)
  })

  it('rejects one day short of the birthday', () => {
    const r = validateDateOfBirth('2013-07-23', NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('too_young')
      expect(r.message).toContain(String(MIN_AGE_YEARS))
    }
  })

  it('rejects an empty field as "required", not as an error', () => {
    const r = validateDateOfBirth('', NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('required')
    expect(validateDateOfBirth(null, NOW).ok).toBe(false)
    expect(validateDateOfBirth(undefined, NOW).ok).toBe(false)
  })

  it('rejects malformed input', () => {
    const r = validateDateOfBirth('15/06/1995', NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid')
  })

  it('rejects a future date of birth', () => {
    const r = validateDateOfBirth('2030-01-01', NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('future')
  })

  it('rejects an implausibly old date (a typo, not a user)', () => {
    const r = validateDateOfBirth('1700-01-01', NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('implausible')
  })

  it('fails closed — every rejection carries a message the UI can show', () => {
    for (const bad of ['', 'x', '2030-01-01', '1700-01-01', '2020-01-01']) {
      const r = validateDateOfBirth(bad, NOW)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message.length).toBeGreaterThan(0)
    }
  })

  it('tolerates surrounding whitespace', () => {
    expect(validateDateOfBirth('  1995-06-15  ', NOW).ok).toBe(true)
  })
})

describe('isOldEnough', () => {
  it('mirrors validateDateOfBirth', () => {
    expect(isOldEnough('1995-06-15', NOW)).toBe(true)
    expect(isOldEnough('2020-01-01', NOW)).toBe(false)
    expect(isOldEnough('', NOW)).toBe(false)
  })
})

describe('maxEligibleDob', () => {
  it('is the newest date of birth that still passes', () => {
    const max = maxEligibleDob(NOW)
    expect(max).toBe('2013-07-22')
    expect(isOldEnough(max, NOW)).toBe(true)

    // One day later must fail — so the <input max> and the gate agree exactly.
    const dayAfter = new Date(Date.UTC(2013, 6, 23)).toISOString().slice(0, 10)
    expect(isOldEnough(dayAfter, NOW)).toBe(false)
  })
})

describe('buildAgeAttestation', () => {
  it('records what we store on the account', () => {
    const a = buildAgeAttestation('1995-06-15', NOW)
    expect(a).not.toBeNull()
    expect(a).toMatchObject({
      date_of_birth: '1995-06-15',
      age_at_signup: 31,
      age_verified_13_plus: true,
    })
    expect(a?.age_attested_at).toBe(NOW.toISOString())
  })

  it('returns null rather than attesting for someone who failed the gate', () => {
    expect(buildAgeAttestation('2020-01-01', NOW)).toBeNull()
    expect(buildAgeAttestation('', NOW)).toBeNull()
  })
})
