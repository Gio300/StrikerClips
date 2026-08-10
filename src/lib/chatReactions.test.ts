import { describe, it, expect } from 'vitest'
import {
  MAX_REACTIONS_PER_USER,
  QUICK_REACTIONS,
  aggregateByMessage,
  aggregateReactions,
  applyLocalToggle,
  hasReacted,
  normalizeReactionEmoji,
  reactionCountForUser,
  reactionLabel,
  type ReactionRow,
} from './chatReactions'

const row = (message_id: string, user_id: string | null, emoji: string): ReactionRow => ({
  message_id,
  user_id,
  emoji,
})

describe('chatReactions — normalizeReactionEmoji', () => {
  it('accepts plain emoji, variation selectors and ZWJ sequences', () => {
    expect(normalizeReactionEmoji('🔥')).toBe('🔥')
    expect(normalizeReactionEmoji('❤️')).toBe('❤️')
    expect(normalizeReactionEmoji('👍🏽')).toBe('👍🏽')
    expect(normalizeReactionEmoji('👨‍👩‍👧')).toBe('👨‍👩‍👧')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeReactionEmoji('  🔥 ')).toBe('🔥')
  })

  it('rejects text, markup, empty values and oversized payloads', () => {
    expect(normalizeReactionEmoji('lol')).toBeNull()
    expect(normalizeReactionEmoji('<img src=x onerror=alert(1)>')).toBeNull()
    expect(normalizeReactionEmoji('🔥 nice')).toBeNull()
    expect(normalizeReactionEmoji('')).toBeNull()
    expect(normalizeReactionEmoji('   ')).toBeNull()
    expect(normalizeReactionEmoji('🔥'.repeat(20))).toBeNull()
  })

  it('rejects non-strings', () => {
    expect(normalizeReactionEmoji(null)).toBeNull()
    expect(normalizeReactionEmoji(undefined)).toBeNull()
    expect(normalizeReactionEmoji(42)).toBeNull()
    expect(normalizeReactionEmoji({ emoji: '🔥' })).toBeNull()
  })

  it('every quick reaction is itself valid', () => {
    for (const emoji of QUICK_REACTIONS) expect(normalizeReactionEmoji(emoji)).toBe(emoji)
  })
})

describe('chatReactions — aggregateReactions', () => {
  it('counts per emoji and marks the viewer', () => {
    const rows = [
      row('m1', 'ana', '🔥'),
      row('m1', 'bo', '🔥'),
      row('m1', 'ana', '👍'),
    ]
    expect(aggregateReactions(rows, 'ana')).toEqual([
      { emoji: '🔥', count: 2, mine: true, userIds: ['ana', 'bo'] },
      { emoji: '👍', count: 1, mine: true, userIds: ['ana'] },
    ])
  })

  it('mine is false for a signed-out or non-reacting viewer', () => {
    const rows = [row('m1', 'ana', '🔥')]
    expect(aggregateReactions(rows, null)[0].mine).toBe(false)
    expect(aggregateReactions(rows, 'bo')[0].mine).toBe(false)
  })

  it('collapses a duplicated (user, emoji) pair — a double tap is still one', () => {
    const rows = [row('m1', 'ana', '🔥'), row('m1', 'ana', '🔥')]
    expect(aggregateReactions(rows, 'ana')).toEqual([
      { emoji: '🔥', count: 1, mine: true, userIds: ['ana'] },
    ])
  })

  it('orders by count desc, ties by first appearance (stable chips)', () => {
    const rows = [
      row('m1', 'ana', '👍'),
      row('m1', 'bo', '🔥'),
      row('m1', 'cy', '🔥'),
      row('m1', 'dee', '💀'),
    ]
    expect(aggregateReactions(rows, null).map((t) => t.emoji)).toEqual(['🔥', '👍', '💀'])
  })

  it('discards rows with an invalid emoji or no user', () => {
    const rows = [
      row('m1', 'ana', 'not-an-emoji'),
      row('m1', null, '🔥'),
      row('m1', '', '🔥'),
      row('m1', 'bo', '🔥'),
    ]
    expect(aggregateReactions(rows, null)).toEqual([
      { emoji: '🔥', count: 1, mine: false, userIds: ['bo'] },
    ])
  })

  it('is total on empty / junk input', () => {
    expect(aggregateReactions([], 'ana')).toEqual([])
    expect(aggregateReactions(null, 'ana')).toEqual([])
    expect(aggregateReactions(undefined, null)).toEqual([])
    expect(aggregateReactions([null as unknown as ReactionRow], null)).toEqual([])
  })
})

describe('chatReactions — aggregateByMessage', () => {
  it('buckets by message id', () => {
    const rows = [row('m1', 'ana', '🔥'), row('m2', 'bo', '👍'), row('m1', 'bo', '🔥')]
    const map = aggregateByMessage(rows, 'ana')
    expect(map.get('m1')).toEqual([{ emoji: '🔥', count: 2, mine: true, userIds: ['ana', 'bo'] }])
    expect(map.get('m2')).toEqual([{ emoji: '👍', count: 1, mine: false, userIds: ['bo'] }])
    expect(map.get('nope')).toBeUndefined()
  })

  it('skips rows with no message id', () => {
    expect(aggregateByMessage([row('', 'ana', '🔥')], 'ana').size).toBe(0)
  })
})

describe('chatReactions — hasReacted / reactionCountForUser', () => {
  const rows = [row('m1', 'ana', '🔥'), row('m1', 'ana', '👍'), row('m1', 'bo', '🔥')]

  it('finds the viewer own reaction only', () => {
    expect(hasReacted(rows, 'm1', '🔥', 'ana')).toBe(true)
    expect(hasReacted(rows, 'm1', '💀', 'ana')).toBe(false)
    expect(hasReacted(rows, 'm2', '🔥', 'ana')).toBe(false)
    expect(hasReacted(rows, 'm1', '🔥', null)).toBe(false)
    expect(hasReacted(rows, 'm1', 'lol', 'ana')).toBe(false)
  })

  it('counts distinct emoji for the viewer', () => {
    expect(reactionCountForUser(rows, 'm1', 'ana')).toBe(2)
    expect(reactionCountForUser(rows, 'm1', 'bo')).toBe(1)
    expect(reactionCountForUser(rows, 'm1', null)).toBe(0)
  })
})

describe('chatReactions — applyLocalToggle', () => {
  it('adds the viewer reaction', () => {
    const out = applyLocalToggle([], 'm1', '🔥', 'ana')
    expect(out.changed).toBe(true)
    expect(out.added).toBe(true)
    expect(out.rows).toEqual([row('m1', 'ana', '🔥')])
  })

  it('removes it on a second toggle', () => {
    const first = applyLocalToggle([], 'm1', '🔥', 'ana')
    const second = applyLocalToggle(first.rows, 'm1', '🔥', 'ana')
    expect(second.changed).toBe(true)
    expect(second.added).toBe(false)
    expect(second.rows).toEqual([])
  })

  it('leaves other users and other messages alone', () => {
    const start = [row('m1', 'bo', '🔥'), row('m2', 'ana', '🔥')]
    const out = applyLocalToggle(start, 'm1', '🔥', 'ana')
    expect(out.rows).toHaveLength(3)
    const back = applyLocalToggle(out.rows, 'm1', '🔥', 'ana')
    expect(back.rows).toEqual(start)
  })

  it('refuses a bad emoji, a signed-out viewer or a missing message', () => {
    expect(applyLocalToggle([], 'm1', 'lol', 'ana').changed).toBe(false)
    expect(applyLocalToggle([], 'm1', '🔥', null).changed).toBe(false)
    expect(applyLocalToggle([], '', '🔥', 'ana').changed).toBe(false)
  })

  it('caps how many distinct emoji one user may add', () => {
    let rows: ReactionRow[] = []
    for (const emoji of QUICK_REACTIONS.slice(0, MAX_REACTIONS_PER_USER)) {
      rows = applyLocalToggle(rows, 'm1', emoji, 'ana').rows
    }
    expect(reactionCountForUser(rows, 'm1', 'ana')).toBe(MAX_REACTIONS_PER_USER)
    const over = applyLocalToggle(rows, 'm1', '🎉', 'ana')
    expect(over.changed).toBe(false)
    expect(over.rows).toHaveLength(MAX_REACTIONS_PER_USER)
    // Removing an existing one is still allowed at the cap.
    expect(applyLocalToggle(rows, 'm1', QUICK_REACTIONS[0], 'ana').changed).toBe(true)
  })

  it('normalizes the emoji it stores', () => {
    const out = applyLocalToggle([], 'm1', '  🔥  ', 'ana')
    expect(out.rows).toEqual([row('m1', 'ana', '🔥')])
  })
})

describe('chatReactions — reactionLabel', () => {
  it('reads naturally in a screen reader', () => {
    expect(reactionLabel({ emoji: '🔥', count: 1, mine: false, userIds: ['bo'] })).toBe('1 reaction 🔥')
    expect(reactionLabel({ emoji: '🔥', count: 3, mine: true, userIds: ['a', 'b', 'c'] })).toBe(
      '3 reactions 🔥, including you',
    )
  })
})
