import { describe, it, expect } from 'vitest'
import { alnumCount, isValidName, nameQualityError, nameRuleHint, MIN_NAME_ALNUM } from './nameQuality'

describe('nameQuality — alnumCount', () => {
  it('counts unicode letters and digits, ignoring symbols/emoji/whitespace', () => {
    expect(alnumCount('GG')).toBe(2)
    expect(alnumCount('a1')).toBe(2)
    expect(alnumCount('  x  ')).toBe(1)
    expect(alnumCount('!!!')).toBe(0)
    expect(alnumCount('🔥🔥🔥')).toBe(0)
    expect(alnumCount('Zé')).toBe(2)
    expect(alnumCount('клан')).toBe(4)
  })
})

describe('nameQuality — nameQualityError', () => {
  it('rejects whitespace-only names', () => {
    expect(nameQualityError('   ')).toMatch(/enter a name/i)
    expect(nameQualityError('')).toMatch(/enter a name/i)
  })

  it('rejects emoji-only names', () => {
    expect(nameQualityError('🔥🔥')).toMatch(/letters or numbers/i)
    expect(nameQualityError('👑')).toBeTruthy()
  })

  it('rejects symbol-only and too-short names', () => {
    expect(nameQualityError('!!')).toBeTruthy()
    expect(nameQualityError('x')).toBeTruthy() // 1 alnum < 2
  })

  it('accepts names with at least 2 alphanumerics', () => {
    expect(nameQualityError('GG')).toBeNull()
    expect(nameQualityError('  Striker Legends ')).toBeNull()
    expect(nameQualityError('🔥Ace🔥')).toBeNull() // A + c + e = 3 alnum
    expect(nameQualityError('клан')).toBeNull()
  })

  it('honors a custom label and minimum', () => {
    expect(nameQualityError('', { label: 'clan name' })).toMatch(/enter a clan name/i)
    expect(nameQualityError('ab', { min: 3 })).toMatch(/at least 3/i)
    expect(nameQualityError('abc', { min: 3 })).toBeNull()
  })
})

describe('nameQuality — isValidName + hint', () => {
  it('isValidName mirrors the error helper', () => {
    expect(isValidName('GG')).toBe(true)
    expect(isValidName('🔥')).toBe(false)
    expect(isValidName('  ')).toBe(false)
  })

  it('nameRuleHint mentions the minimum', () => {
    expect(nameRuleHint('clan name')).toContain('clan name')
    expect(nameRuleHint()).toContain(String(MIN_NAME_ALNUM))
  })
})
