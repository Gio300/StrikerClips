import { describe, it, expect } from 'vitest'
import {
  AVATAR_ACCENTS,
  AVATAR_MAX_BYTES,
  avatarAccentFor,
  dataUrlBytes,
  initialsFor,
  isSafeAvatarUrl,
  normalizeAvatarUrl,
} from './avatar'

describe('initialsFor', () => {
  it('takes the first letter of a single name', () => {
    expect(initialsFor('patternaft3r')).toBe('P')
  })
  it('takes two initials from two words', () => {
    expect(initialsFor('Gio Awaken')).toBe('GA')
    expect(initialsFor('gio_awaken')).toBe('GA')
    expect(initialsFor('gio.awaken')).toBe('GA')
    expect(initialsFor('gio-awaken')).toBe('GA')
  })
  it('stops at two initials', () => {
    expect(initialsFor('a b c d')).toBe('AB')
  })
  it('strips a leading @', () => {
    expect(initialsFor('@shinobi')).toBe('S')
  })
  it('falls back to ? for empty / unusable names', () => {
    expect(initialsFor('')).toBe('?')
    expect(initialsFor('   ')).toBe('?')
    expect(initialsFor(null)).toBe('?')
    expect(initialsFor(undefined)).toBe('?')
    expect(initialsFor('🔥🔥')).toBe('?')
  })
  it('handles digits and non-latin letters', () => {
    expect(initialsFor('3lite')).toBe('3')
    expect(initialsFor('日本 語')).toBe('日語')
  })
})

describe('avatarAccentFor', () => {
  it('is stable for the same seed', () => {
    expect(avatarAccentFor('user-1')).toBe(avatarAccentFor('user-1'))
  })
  it('is case- and whitespace-insensitive', () => {
    expect(avatarAccentFor('  User-1 ')).toBe(avatarAccentFor('user-1'))
  })
  it('always returns a real brand accent', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'gio', '']) {
      expect(AVATAR_ACCENTS).toContain(avatarAccentFor(seed))
    }
  })
  it('spreads across more than one accent', () => {
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) => avatarAccentFor(`user-${i}`)),
    )
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('dataUrlBytes', () => {
  it('returns 0 for non-data URLs', () => {
    expect(dataUrlBytes('https://example.com/a.png')).toBe(0)
  })
  it('decodes base64 length to byte length', () => {
    // "hello" -> aGVsbG8= (5 bytes)
    expect(dataUrlBytes('data:image/png;base64,aGVsbG8=')).toBe(5)
  })
})

describe('isSafeAvatarUrl', () => {
  it('accepts https and http image links', () => {
    expect(isSafeAvatarUrl('https://cdn.example.com/me.jpg')).toBe(true)
    expect(isSafeAvatarUrl('http://cdn.example.com/me.jpg')).toBe(true)
  })
  it('accepts a small base64 image data URL', () => {
    expect(isSafeAvatarUrl('data:image/jpeg;base64,aGVsbG8=')).toBe(true)
  })
  it('rejects javascript: and other schemes', () => {
    expect(isSafeAvatarUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeAvatarUrl('ftp://example.com/a.png')).toBe(false)
    expect(isSafeAvatarUrl('/relative/path.png')).toBe(false)
  })
  it('rejects non-image and scriptable data URLs', () => {
    expect(isSafeAvatarUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isSafeAvatarUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
  })
  it('rejects a data URL over the size cap', () => {
    const huge = 'data:image/jpeg;base64,' + 'A'.repeat(AVATAR_MAX_BYTES * 2)
    expect(isSafeAvatarUrl(huge)).toBe(false)
  })
  it('rejects empty and whitespace-bearing values', () => {
    expect(isSafeAvatarUrl('')).toBe(false)
    expect(isSafeAvatarUrl('   ')).toBe(false)
    expect(isSafeAvatarUrl('https://example.com/a b.png')).toBe(false)
  })
})

describe('normalizeAvatarUrl', () => {
  it('trims and keeps an acceptable value', () => {
    expect(normalizeAvatarUrl('  https://e.com/a.png ')).toBe('https://e.com/a.png')
  })
  it('maps empty input to null (clear my picture)', () => {
    expect(normalizeAvatarUrl('')).toBeNull()
    expect(normalizeAvatarUrl(null)).toBeNull()
    expect(normalizeAvatarUrl(undefined)).toBeNull()
  })
  it('maps an unacceptable value to null rather than storing it', () => {
    expect(normalizeAvatarUrl('javascript:alert(1)')).toBeNull()
  })
})
