import { describe, it, expect } from 'vitest'
import {
  EMOJI_GROUPS,
  EMOJI_LIST,
  EMOJI_SHORTCODES,
  emojiForShortcode,
  expandShortcodes,
  searchEmoji,
} from './chatEmoji'

describe('chatEmoji — the table', () => {
  it('has no duplicate shortcodes', () => {
    const codes = EMOJI_LIST.map((entry) => entry.shortcode)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('every entry carries a real character and a lookup-able shortcode', () => {
    for (const entry of EMOJI_LIST) {
      expect(entry.char.length).toBeGreaterThan(0)
      expect(emojiForShortcode(entry.shortcode)).toBe(entry.char)
    }
    expect(Object.keys(EMOJI_SHORTCODES)).toHaveLength(EMOJI_LIST.length)
  })

  it('groups are non-empty', () => {
    expect(EMOJI_GROUPS.length).toBeGreaterThan(0)
    for (const group of EMOJI_GROUPS) expect(group.emoji.length).toBeGreaterThan(0)
  })
})

describe('chatEmoji — expandShortcodes', () => {
  it('expands known shortcodes anywhere in the run', () => {
    expect(expandShortcodes(':fire:')).toBe('🔥')
    expect(expandShortcodes('that was :fire: honestly')).toBe('that was 🔥 honestly')
    expect(expandShortcodes(':fire::fire:')).toBe('🔥🔥')
  })

  it('leaves unknown shortcodes exactly as typed', () => {
    expect(expandShortcodes(':shipit:')).toBe(':shipit:')
    expect(expandShortcodes('gg :nope: wp')).toBe('gg :nope: wp')
  })

  it('does not eat ordinary colons — times, URLs, prose', () => {
    expect(expandShortcodes('starts at 12:30')).toBe('starts at 12:30')
    expect(expandShortcodes('https://tko.cam/live')).toBe('https://tko.cam/live')
    expect(expandShortcodes('note: read this')).toBe('note: read this')
    expect(expandShortcodes('a:B:c')).toBe('a:B:c')
  })

  it('handles the punctuation shortcodes', () => {
    expect(expandShortcodes(':+1:')).toBe('👍')
    expect(expandShortcodes(':-1:')).toBe('👎')
  })

  it('is total on empty / non-string input', () => {
    expect(expandShortcodes('')).toBe('')
    expect(expandShortcodes('no colons here')).toBe('no colons here')
    expect(expandShortcodes(null as unknown as string)).toBe('')
    expect(expandShortcodes(undefined as unknown as string)).toBe('')
  })

  it('never resolves an inherited Object.prototype key', () => {
    expect(emojiForShortcode('constructor')).toBeNull()
    expect(emojiForShortcode('__proto__')).toBeNull()
    expect(expandShortcodes(':constructor:')).toBe(':constructor:')
  })
})

describe('chatEmoji — searchEmoji', () => {
  it('returns the full list (capped) for an empty query', () => {
    expect(searchEmoji('').length).toBeGreaterThan(10)
    expect(searchEmoji('  ', 5)).toHaveLength(5)
  })

  it('puts prefix matches first', () => {
    const hits = searchEmoji('fi')
    expect(hits[0].shortcode).toBe('fire')
  })

  it('matches keywords too', () => {
    expect(searchEmoji('thumbsup').map((h) => h.char)).toContain('👍')
    expect(searchEmoji('champion').map((h) => h.char)).toContain('🏆')
  })

  it('tolerates a query typed with colons', () => {
    expect(searchEmoji(':fire:')[0].shortcode).toBe('fire')
  })

  it('returns nothing for a miss', () => {
    expect(searchEmoji('zzzzznotathing')).toEqual([])
  })
})
