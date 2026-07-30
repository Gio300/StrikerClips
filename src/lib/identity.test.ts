import { describe, it, expect } from 'vitest'
import {
  CLAN_NAME_MAX,
  CLAN_TAG_MAX,
  USERNAME_MAX,
  checkReason,
  clanLabel,
  formatTag,
  isTaken,
  normalizeHandle,
  normalizeTag,
  suggestAlternatives,
  takenMessage,
  validateClanName,
  validateTag,
  validateUsername,
} from './identity'

describe('identity — normalizeHandle', () => {
  it('is case-insensitive', () => {
    expect(normalizeHandle('Rekt')).toBe('rekt')
    expect(normalizeHandle('REKT')).toBe(normalizeHandle('rekt'))
  })

  it('trims and collapses whitespace', () => {
    expect(normalizeHandle('  Rekt   Squad  ')).toBe('rekt squad')
    expect(normalizeHandle('\tAnbu\nIntel ')).toBe('anbu intel')
  })

  it('NFKC-normalizes so look-alike forms collide', () => {
    // Full-width "ＲＥＫＴ" must not be able to clone "rekt".
    expect(normalizeHandle('ＲＥＫＴ')).toBe('rekt')
  })

  it('handles empty / nullish input', () => {
    expect(normalizeHandle('')).toBe('')
    expect(normalizeHandle('   ')).toBe('')
  })
})

describe('identity — normalizeTag / formatTag', () => {
  it('uppercases and strips whitespace, keeping symbols', () => {
    expect(normalizeTag('ai')).toBe('AI')
    expect(normalizeTag('kmh')).toBe('KMH')
    expect(normalizeTag(' k-m ')).toBe('K-M')
    expect(normalizeTag('a i')).toBe('AI')
  })

  it('renders the [AI] badge, and nothing when there is no tag', () => {
    expect(formatTag('ai')).toBe('[AI]')
    expect(formatTag('')).toBe('')
    expect(formatTag(null)).toBe('')
    expect(formatTag(undefined)).toBe('')
  })

  it('builds the tag-prefixed clan label', () => {
    expect(clanLabel('Anbu Intel', 'ai')).toBe('[AI] Anbu Intel')
    expect(clanLabel('Anbu Intel', null)).toBe('Anbu Intel')
  })
})

describe('identity — validateUsername', () => {
  it('accepts handle-shaped names', () => {
    expect(validateUsername('rekt').ok).toBe(true)
    expect(validateUsername('striker_fan').ok).toBe(true)
    expect(validateUsername('gg99').ok).toBe(true)
  })

  it('rejects empty, spaced and symbol-laden names with a reason', () => {
    expect(checkReason(validateUsername(''))).toMatch(/enter a username/i)
    expect(checkReason(validateUsername('rekt squad'))).toMatch(/space/i)
    expect(checkReason(validateUsername('rekt!'))).toMatch(/letters, numbers and underscores/i)
    expect(checkReason(validateUsername('🔥🔥🔥'))).toBeTruthy()
  })

  it('enforces length bounds', () => {
    expect(checkReason(validateUsername('ab'))).toMatch(/at least 3/i)
    expect(validateUsername('abc').ok).toBe(true)
    expect(validateUsername('a'.repeat(USERNAME_MAX)).ok).toBe(true)
    expect(checkReason(validateUsername('a'.repeat(USERNAME_MAX + 1)))).toMatch(/max out/i)
  })

  it('enforces the shared nameQuality floor (>= 2 alphanumerics)', () => {
    expect(checkReason(validateUsername('a__'))).toMatch(/letters or numbers/i)
    expect(validateUsername('a_b').ok).toBe(true)
  })
})

describe('identity — validateClanName', () => {
  it('accepts display-shaped names with spaces and other scripts', () => {
    expect(validateClanName('Anbu Intel').ok).toBe(true)
    expect(validateClanName('клан').ok).toBe(true)
    expect(validateClanName('GG').ok).toBe(true)
  })

  it('rejects emoji-only and empty names', () => {
    expect(checkReason(validateClanName('   '))).toMatch(/enter a clan name/i)
    expect(checkReason(validateClanName('🔥🔥'))).toMatch(/letters or numbers/i)
  })

  it('enforces length bounds', () => {
    expect(validateClanName('a'.repeat(CLAN_NAME_MAX)).ok).toBe(true)
    expect(checkReason(validateClanName('a'.repeat(CLAN_NAME_MAX + 1)))).toMatch(/max out/i)
  })
})

describe('identity — validateTag format rules', () => {
  it('accepts 2-5 letters/digits', () => {
    expect(validateTag('AI').ok).toBe(true)
    expect(validateTag('KMH').ok).toBe(true)
    expect(validateTag('ai').ok).toBe(true)
    expect(validateTag('T4K0').ok).toBe(true)
    expect(validateTag('ABCDE').ok).toBe(true)
  })

  it('rejects too short / too long', () => {
    expect(checkReason(validateTag('A'))).toMatch(/at least 2/i)
    expect(checkReason(validateTag('A'.repeat(CLAN_TAG_MAX + 1)))).toMatch(/max out/i)
  })

  it('allows symbols but still rejects spaces and empty', () => {
    expect(validateTag('A-I').ok).toBe(true)   // symbols are allowed now
    expect(validateTag('AI!').ok).toBe(true)
    expect(validateTag('K.O').ok).toBe(true)
    expect(checkReason(validateTag('A I'))).toMatch(/space/i)
    expect(checkReason(validateTag(''))).toMatch(/enter a clan tag/i)
  })
})

describe('identity — isTaken', () => {
  it('collides case-insensitively: "Rekt" vs "rekt"', () => {
    expect(isTaken('Rekt', ['rekt'])).toBe(true)
    expect(isTaken('rekt', ['rekt'])).toBe(true)
    expect(isTaken('REKT', ['rekt'])).toBe(true)
  })

  it('ignores surrounding whitespace differences', () => {
    expect(isTaken('  Rekt  ', ['rekt'])).toBe(true)
    expect(isTaken('Rekt  Squad', ['rekt squad'])).toBe(true)
  })

  it('reports a free name as free', () => {
    expect(isTaken('rekt2', ['rekt', 'gg'])).toBe(false)
    expect(isTaken('rekt', [])).toBe(false)
  })

  it('uses the tag normalizer for tags', () => {
    expect(isTaken('ai', ['AI'], normalizeTag)).toBe(true)
    expect(isTaken('AI', ['KMH'], normalizeTag)).toBe(false)
  })

  it('treats an empty candidate as not taken (validation catches it first)', () => {
    expect(isTaken('', ['rekt'])).toBe(false)
  })
})

describe('identity — suggestAlternatives', () => {
  it('proposes 3 free variants for a taken handle', () => {
    const taken = ['rekt']
    const s = suggestAlternatives('Rekt', taken)
    expect(s).toHaveLength(3)
    for (const v of s) expect(isTaken(v, taken)).toBe(false)
  })

  it('skips variants that are themselves taken', () => {
    const taken = ['rekt', 'rekt2', 'rekt3']
    const s = suggestAlternatives('rekt', taken)
    expect(s).toHaveLength(3)
    expect(s).not.toContain('rekt2')
    expect(s).not.toContain('rekt3')
    for (const v of s) expect(isTaken(v, taken)).toBe(false)
  })

  it('respects the tag length cap by trimming the base', () => {
    const s = suggestAlternatives('ABCDE', ['abcde'], {
      maxLength: CLAN_TAG_MAX,
      normalize: normalizeTag,
    })
    expect(s).toHaveLength(3)
    for (const v of s) {
      expect(v.length).toBeLessThanOrEqual(CLAN_TAG_MAX)
      expect(validateTag(v).ok).toBe(true)
    }
  })

  it('keeps username suggestions inside the username cap', () => {
    const long = 'a'.repeat(USERNAME_MAX)
    const s = suggestAlternatives(long, [long.toLowerCase()])
    for (const v of s) {
      expect(v.length).toBeLessThanOrEqual(USERNAME_MAX)
      expect(validateUsername(v).ok).toBe(true)
    }
  })

  it('returns nothing for an empty candidate or a zero count', () => {
    expect(suggestAlternatives('', ['rekt'])).toEqual([])
    expect(suggestAlternatives('rekt', ['rekt'], { count: 0 })).toEqual([])
  })
})

describe('identity — takenMessage', () => {
  it('lists the suggestions when we have them', () => {
    expect(takenMessage('username', ['rekt2', 'rekt3', 'rekt4'])).toBe(
      "That username's taken — try rekt2, rekt3, rekt4",
    )
  })

  it('degrades gracefully with no suggestions', () => {
    expect(takenMessage('clan tag', [])).toMatch(/taken/i)
  })
})
