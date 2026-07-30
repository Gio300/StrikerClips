import { describe, expect, it } from 'vitest'
import { moveListItem } from './reelEditor'

describe('moveListItem', () => {
  it('moves an item while preserving the rest of the timeline', () => {
    expect(moveListItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('returns an unchanged copy for invalid moves', () => {
    const original = ['a', 'b']
    const result = moveListItem(original, 0, 4)
    expect(result).toEqual(original)
    expect(result).not.toBe(original)
  })
})
