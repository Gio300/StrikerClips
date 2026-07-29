import { describe, it, expect } from 'vitest'
import {
  groupClipsByMatch,
  suggestOtherAngles,
  matchGroupFor,
  sameMatch,
  matchSignature,
  resultsCompatible,
  participantsOf,
  type ClipMeta,
} from './matchGrouping'

const T0 = 1_700_000_000_000 // fixed epoch ms so everything is deterministic
const S = 1000
const MIN = 60 * S

// Small builder so each test only states what it cares about.
const clip = (over: Partial<ClipMeta> & { clipId: string }): ClipMeta => ({
  playerId: over.playerId ?? over.clipId,
  recordedAt: T0,
  durationSec: 200,
  ...over,
})

describe('matchGrouping — sameMatch pairwise rule', () => {
  it('groups two angles: overlapping time + shared participant + compatible result', () => {
    const a = clip({ clipId: 'a', playerId: 'you', participants: ['you', 'rekt'], recordedAt: T0, resultSignature: { outcome: 'victory', scoreLine: '3-1' } })
    const b = clip({ clipId: 'b', playerId: 'rekt', participants: ['you', 'rekt'], recordedAt: T0 + 20 * S, resultSignature: { outcome: 'defeat', scoreLine: '1-3' } })
    expect(sameMatch(a, b)).toBe(true)
  })

  it('does NOT group when times are disjoint (a day apart)', () => {
    const a = clip({ clipId: 'a', participants: ['you', 'rekt'], recordedAt: T0 })
    const b = clip({ clipId: 'b', participants: ['you', 'rekt'], recordedAt: T0 + 24 * 60 * MIN })
    expect(sameMatch(a, b)).toBe(false)
  })

  it('does NOT group when there is no shared participant or lobby', () => {
    const a = clip({ clipId: 'a', playerId: 'you', participants: ['you', 'rekt'], recordedAt: T0 })
    const b = clip({ clipId: 'b', playerId: 'kaze', participants: ['kaze', 'auryn'], recordedAt: T0 + 10 * S })
    expect(sameMatch(a, b)).toBe(false)
  })

  it('does NOT group when the results contradict (draw vs victory, or different mode)', () => {
    const base = { participants: ['you', 'rekt'], recordedAt: T0 }
    const drawVsWin = sameMatch(
      clip({ clipId: 'a', ...base, resultSignature: { outcome: 'draw' } }),
      clip({ clipId: 'b', ...base, recordedAt: T0 + 5 * S, resultSignature: { outcome: 'victory' } }),
    )
    expect(drawVsWin).toBe(false)
    const modeClash = sameMatch(
      clip({ clipId: 'a', ...base, resultSignature: { mode: 'survival' } }),
      clip({ clipId: 'b', ...base, recordedAt: T0 + 5 * S, resultSignature: { mode: 'ninja_world_league' } }),
    )
    expect(modeClash).toBe(false)
  })

  it('groups by shared lobby id even without a shared participant', () => {
    const a = clip({ clipId: 'a', playerId: 'you', participants: ['you'], lobbyId: 'nwl-42', recordedAt: T0 })
    const b = clip({ clipId: 'b', playerId: 'ghost', participants: ['ghost'], lobbyId: 'NWL-42', recordedAt: T0 + 8 * S })
    expect(sameMatch(a, b)).toBe(true)
  })

  it('treats reversed score lines as compatible (opposing perspectives)', () => {
    expect(resultsCompatible({ scoreLine: '3-1' }, { scoreLine: '1-3' })).toBe(true)
    expect(resultsCompatible({ scoreLine: '3-1' }, { scoreLine: '2-2' })).toBe(false)
  })

  it('rejects a big duration mismatch', () => {
    const a = clip({ clipId: 'a', participants: ['you', 'rekt'], recordedAt: T0, durationSec: 60 })
    const b = clip({ clipId: 'b', participants: ['you', 'rekt'], recordedAt: T0 + 5 * S, durationSec: 600 })
    expect(sameMatch(a, b)).toBe(false)
  })
})

describe('matchGrouping — groupClipsByMatch', () => {
  const angleA = clip({ clipId: 'a', playerId: 'you', participants: ['you', 'rekt', 'auryn'], recordedAt: T0, lobbyId: 'nwl-8842', resultSignature: { outcome: 'victory', scoreLine: '3-1', mode: 'nwl' } })
  const angleB = clip({ clipId: 'b', playerId: 'rekt', participants: ['you', 'rekt', 'auryn'], recordedAt: T0 + 15 * S, lobbyId: 'nwl-8842', resultSignature: { outcome: 'victory', scoreLine: '3-1', mode: 'nwl' } })
  const angleC = clip({ clipId: 'c', playerId: 'auryn', participants: ['you', 'rekt', 'auryn'], recordedAt: T0 + 30 * S, lobbyId: 'nwl-8842', resultSignature: { outcome: 'defeat', scoreLine: '1-3', mode: 'nwl' } })
  // A totally separate match a week later with different people.
  const other = clip({ clipId: 'z', playerId: 'kaze', participants: ['kaze', 'blitz'], recordedAt: T0 + 7 * 24 * 60 * MIN })

  it('collapses three angles into one group and keeps the loner separate', () => {
    const groups = groupClipsByMatch([angleA, angleB, angleC, other])
    expect(groups).toHaveLength(2)
    const big = groups.find((g) => g.clips.length === 3)!
    expect(big.clips.map((c) => c.clipId)).toEqual(['a', 'b', 'c']) // time-sorted
    expect(big.sharedParticipants).toEqual(['auryn', 'rekt', 'you'])
    expect(big.confidence).toBeGreaterThan(0.9)
  })

  it('produces a stable, order-independent matchId', () => {
    const g1 = groupClipsByMatch([angleA, angleB, angleC])
    const g2 = groupClipsByMatch([angleC, angleA, angleB]) // shuffled input
    expect(g1[0].matchId).toBe(g2[0].matchId)
    expect(g1[0].matchId).toMatch(/^m_[0-9a-f]{8}$/)
  })

  it('a weakly-linked pair has lower confidence than a strongly-linked bunch', () => {
    const weakA = clip({ clipId: 'w1', playerId: 'you', participants: ['you', 'rekt'], recordedAt: T0 })
    const weakB = clip({ clipId: 'w2', playerId: 'rekt', participants: ['you', 'rekt'], recordedAt: T0 + 40 * S })
    const weak = groupClipsByMatch([weakA, weakB])[0]
    const strong = groupClipsByMatch([angleA, angleB, angleC]).find((g) => g.clips.length === 3)!
    expect(weak.confidence).toBeLessThan(strong.confidence)
  })
})

describe('matchGrouping — suggestOtherAngles', () => {
  const target = clip({ clipId: 'a', playerId: 'you', participants: ['you', 'rekt'], recordedAt: T0, resultSignature: { outcome: 'victory', scoreLine: '3-1' } })
  const angle = clip({ clipId: 'b', playerId: 'rekt', participants: ['you', 'rekt'], recordedAt: T0 + 20 * S, resultSignature: { outcome: 'defeat', scoreLine: '1-3' } })
  const unrelated = clip({ clipId: 'c', playerId: 'kaze', participants: ['kaze'], recordedAt: T0 + 3 * 24 * 60 * MIN })

  it('returns the other angles of the same match, excluding the target', () => {
    const others = suggestOtherAngles(target, [angle, unrelated])
    expect(others.map((c) => c.clipId)).toEqual(['b'])
  })

  it('returns nothing when the target is alone', () => {
    expect(suggestOtherAngles(target, [unrelated])).toEqual([])
  })

  it('matchGroupFor includes the target itself', () => {
    const g = matchGroupFor(target, [angle, unrelated])
    expect(g?.clips.map((c) => c.clipId).sort()).toEqual(['a', 'b'])
  })
})

describe('matchGrouping — signature helpers', () => {
  it('participantsOf folds in the uploader and normalizes handles', () => {
    const c = clip({ clipId: 'a', playerId: 'You', participants: ['@Rekt', 'rekt'] })
    expect(participantsOf(c)).toEqual(['rekt', 'you'])
  })

  it('matchSignature is stable + normalizes the score', () => {
    const c = clip({ clipId: 'a', playerId: 'you', participants: ['rekt'], resultSignature: { scoreLine: '3 : 1', outcome: 'victory' }, durationSec: 205 })
    const sig = matchSignature(c)
    expect(sig.participants).toEqual(['rekt', 'you'])
    expect(sig.scoreLine).toBe('3-1')
    expect(sig.durationBucket).toBe(210)
    expect(sig.raw).toContain('rekt,you')
  })
})
