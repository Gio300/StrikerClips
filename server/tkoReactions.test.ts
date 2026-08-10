import { describe, expect, it } from 'vitest'
import { selectVideoReactions, TKO_REACTIONS } from './tkoReactions'

describe('TKO video reaction bank', () => {
  it('contains at least 100 unique sayings', () => {
    expect(TKO_REACTIONS.length).toBeGreaterThanOrEqual(100)
    expect(new Set(TKO_REACTIONS.map((reaction) => reaction.id)).size).toBe(TKO_REACTIONS.length)
    expect(new Set(TKO_REACTIONS.map((reaction) => reaction.text.toLowerCase())).size).toBe(
      TKO_REACTIONS.length,
    )
  })

  it('keeps supplied TKO calls in the bank', () => {
    const text = new Set(TKO_REACTIONS.map((reaction) => reaction.text))
    expect(text.has("He got ghost on 'em.")).toBe(true)
    expect(text.has('This is really live on TKO right now!')).toBe(true)
    expect(text.has("He's giving MVP right now.")).toBe(true)
    expect(text.has('A ninja must see through deception.')).toBe(true)
  })

  it('selects a relevant opening, big-play call, and closing call', () => {
    const selected = selectVideoReactions('match-42')
    expect(selected).toHaveLength(3)
    expect(selected[0].reaction.tags.some((tag) => ['opening', 'live', 'hype'].includes(tag))).toBe(true)
    expect(selected[1].reaction.tags.some((tag) => ['knockout', 'replay', 'hype'].includes(tag))).toBe(true)
    expect(selected[2].reaction.tags.some((tag) => ['victory', 'closing', 'mvp'].includes(tag))).toBe(true)
    expect(new Set(selected.map((item) => item.reaction.id)).size).toBe(3)
  })

  it('is repeatable for retries and varies across matches', () => {
    const first = selectVideoReactions('match-42').map((item) => item.reaction.id)
    const retry = selectVideoReactions('match-42').map((item) => item.reaction.id)
    const other = selectVideoReactions('match-43').map((item) => item.reaction.id)
    expect(retry).toEqual(first)
    expect(other).not.toEqual(first)
  })

  it('scales speech down for cheaper short-form cuts', () => {
    expect(selectVideoReactions('match-42', 0)).toEqual([])
    const quick = selectVideoReactions('match-42', 1)
    expect(quick).toHaveLength(1)
    expect(quick[0].reaction.tags.some((tag) => ['knockout', 'replay', 'hype'].includes(tag))).toBe(true)
    const enhanced = selectVideoReactions('match-42', 2)
    expect(enhanced).toHaveLength(2)
    expect(enhanced[1].reaction.tags.some((tag) => ['victory', 'closing', 'mvp'].includes(tag))).toBe(true)
  })
})
