import { describe, it, expect } from 'vitest'
import {
  BLOCK_CLIP_WARNING,
  UNFOLLOW_FIRST_BODY,
  blockedIdsOf,
  blocksBetween,
  canAutoLink,
  canShareClip,
  canShareLiveStage,
  dropHiddenConflicts,
  isBlockedPair,
  isHiddenPair,
  myBlockOf,
  normalizeBlock,
  normalizeBlocks,
  pairBlockState,
  type BlockFact,
} from './blocking'

const block = (blockerId: string, blockedId: string, hideInSharedLives = false): BlockFact => ({
  blockerId,
  blockedId,
  hideInSharedLives,
})

describe('normalizeBlock', () => {
  it('reads a raw row', () => {
    const b = normalizeBlock({
      blocker_id: 'u-a',
      blocked_id: 'u-b',
      hide_in_shared_lives: true,
      created_at: '2024-01-01T00:00:00.000Z',
    })
    expect(b).toMatchObject({ blockerId: 'u-a', blockedId: 'u-b', hideInSharedLives: true })
    expect(b!.createdAt).toBe(Date.parse('2024-01-01T00:00:00.000Z'))
  })

  it('defaults hide_in_shared_lives to false — the narrower block', () => {
    expect(normalizeBlock({ blocker_id: 'a', blocked_id: 'b' })!.hideInSharedLives).toBe(false)
    expect(
      normalizeBlock({ blocker_id: 'a', blocked_id: 'b', hide_in_shared_lives: null })!
        .hideInSharedLives,
    ).toBe(false)
  })

  it('drops incomplete and self-blocks rather than poisoning the engine', () => {
    expect(normalizeBlock({ blocker_id: 'a', blocked_id: '' })).toBeNull()
    expect(normalizeBlock({ blocker_id: '', blocked_id: 'b' })).toBeNull()
    expect(normalizeBlock({ blocker_id: 'a', blocked_id: 'a' })).toBeNull()
    expect(normalizeBlocks([{ blocker_id: 'a', blocked_id: 'a' }, { blocker_id: 'a', blocked_id: 'b' }])).toHaveLength(1)
  })
})

describe('a block is directional data but a symmetric rule', () => {
  const blocks = [block('u-a', 'u-b')]

  it('finds the pair from either side', () => {
    expect(blocksBetween(blocks, 'u-a', 'u-b')).toHaveLength(1)
    expect(blocksBetween(blocks, 'u-b', 'u-a')).toHaveLength(1)
    expect(isBlockedPair(blocks, 'u-b', 'u-a')).toBe(true)
  })

  it('never auto-links a blocked pair, in EITHER direction', () => {
    expect(canAutoLink(blocks, 'u-a', 'u-b')).toBe(false)
    expect(canAutoLink(blocks, 'u-b', 'u-a')).toBe(false)
  })

  it('leaves unrelated people alone', () => {
    expect(isBlockedPair(blocks, 'u-a', 'u-c')).toBe(false)
    expect(canAutoLink(blocks, 'u-c', 'u-d')).toBe(true)
  })

  it('is never blocked against yourself', () => {
    expect(isBlockedPair([block('u-a', 'u-b')], 'u-a', 'u-a')).toBe(false)
  })
})

describe('hide_in_shared_lives — how far the block reaches', () => {
  const soft = [block('u-a', 'u-b', false)]
  const hard = [block('u-a', 'u-b', true)]

  it('false: they may still co-appear on a stage, but are NEVER auto-linked', () => {
    expect(canShareLiveStage(soft, 'u-a', 'u-b')).toBe(true)
    expect(canAutoLink(soft, 'u-a', 'u-b')).toBe(false)
    expect(isHiddenPair(soft, 'u-a', 'u-b')).toBe(false)
  })

  it('true: they may not share a live stage at all', () => {
    expect(canShareLiveStage(hard, 'u-a', 'u-b')).toBe(false)
    expect(canAutoLink(hard, 'u-a', 'u-b')).toBe(false)
    expect(isHiddenPair(hard, 'u-b', 'u-a')).toBe(true)
  })

  it('EITHER setting removes them from each other’s combined clips', () => {
    expect(canShareClip(soft, 'u-a', 'u-b')).toBe(false)
    expect(canShareClip(hard, 'u-a', 'u-b')).toBe(false)
  })

  it('the stricter of two opposing blocks wins', () => {
    const both = [block('u-a', 'u-b', false), block('u-b', 'u-a', true)]
    expect(pairBlockState(both, 'u-a', 'u-b')).toEqual({ blocked: true, hidden: true })
  })

  it('reports a clean state for a pair with no block', () => {
    expect(pairBlockState([], 'u-a', 'u-b')).toEqual({ blocked: false, hidden: false })
  })
})

describe('dropHiddenConflicts', () => {
  it('keeps the earlier id and drops the one hidden from it', () => {
    const blocks = [block('u-a', 'u-c', true)]
    expect(dropHiddenConflicts(blocks, ['u-a', 'u-b', 'u-c'])).toEqual(['u-a', 'u-b'])
    // Reverse the order and the OTHER one survives — first listed always wins.
    expect(dropHiddenConflicts(blocks, ['u-c', 'u-b', 'u-a'])).toEqual(['u-c', 'u-b'])
  })

  it('keeps a soft-blocked pair together (they may co-appear)', () => {
    expect(dropHiddenConflicts([block('u-a', 'u-c', false)], ['u-a', 'u-c'])).toEqual(['u-a', 'u-c'])
  })

  it('dedupes and ignores blanks', () => {
    expect(dropHiddenConflicts([], ['u-a', 'u-a', '', '  '])).toEqual(['u-a'])
  })
})

describe('reading your own blocks', () => {
  const blocks = [block('me', 'u-b'), block('me', 'u-c', true), block('u-d', 'me')]

  it('lists only the people I blocked, not the people who blocked me', () => {
    expect(blockedIdsOf(blocks, 'me')).toEqual(['u-b', 'u-c'])
  })

  it('finds my own block of one person', () => {
    expect(myBlockOf(blocks, 'me', 'u-c')?.hideInSharedLives).toBe(true)
    // A block pointing AT me is not mine to read or lift.
    expect(myBlockOf(blocks, 'me', 'u-d')).toBeNull()
  })
})

describe('copy', () => {
  it('leads with unfollow and is honest about what a block costs', () => {
    expect(UNFOLLOW_FIRST_BODY).toContain('stop seeing their posts')
    expect(BLOCK_CLIP_WARNING).toContain("won't get multi-angle clips")
    expect(BLOCK_CLIP_WARNING).toContain('including ones you won')
  })
})
