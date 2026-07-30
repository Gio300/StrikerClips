import { describe, it, expect } from 'vitest'
import { commonSlot, addProposals, matchState, applyProposal, isScheduled, type KingMatch } from './kingSchedule'

const base: KingMatch = {
  id: 'm1', playerA: 'a', playerB: 'b',
  proposalsA: [], proposalsB: [], agreedTime: null, winnerId: null,
}

describe('commonSlot', () => {
  it('is the earliest overlapping time', () => {
    expect(commonSlot(['2026-08-02T20:00Z', '2026-08-01T18:00Z'], ['2026-08-01T18:00Z', '2026-08-03T20:00Z']))
      .toBe('2026-08-01T18:00Z')
  })
  it('is null when they do not overlap', () => {
    expect(commonSlot(['2026-08-01T18:00Z'], ['2026-08-02T18:00Z'])).toBeNull()
  })
})

describe('addProposals', () => {
  it('dedupes and sorts', () => {
    expect(addProposals(['b', 'a'], ['a', 'c', ''])).toEqual(['a', 'b', 'c'])
  })
})

describe('applyProposal → scheduling', () => {
  it('schedules the moment proposals overlap', () => {
    let m = applyProposal(base, 'a', ['2026-08-01T18:00Z', '2026-08-02T20:00Z'])
    expect(isScheduled(m)).toBe(false)
    expect(matchState(m)).toBe('proposing')
    m = applyProposal(m, 'b', ['2026-08-02T20:00Z'])
    expect(isScheduled(m)).toBe(true)
    expect(m.agreedTime).toBe('2026-08-02T20:00Z')
  })
  it('ignores proposals from non-participants', () => {
    const m = applyProposal(base, 'stranger', ['2026-08-01T18:00Z'])
    expect(m.proposalsA).toEqual([])
    expect(m.proposalsB).toEqual([])
  })
})

describe('matchState lifecycle', () => {
  const t = '2026-08-01T18:00:00Z'
  it('scheduled before the time, awaiting_result after', () => {
    expect(matchState({ agreedTime: t, winnerId: null }, Date.parse(t) - 1000)).toBe('scheduled')
    expect(matchState({ agreedTime: t, winnerId: null }, Date.parse(t) + 1000)).toBe('awaiting_result')
  })
  it('done once a winner is set', () => {
    expect(matchState({ agreedTime: t, winnerId: 'a' })).toBe('done')
  })
})
