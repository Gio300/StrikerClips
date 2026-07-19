import { describe, it, expect } from 'vitest'
import {
  parseWhen,
  parseDescribe,
  matchLibrary,
  scoreVideo,
  describeSummary,
  type LibraryVideo,
} from './describeClip'

const DAY = 86_400_000
// Fixed "now": Sat 2026-07-18 20:00 local. All windows computed relative to it.
const NOW = new Date(2026, 6, 18, 20, 0, 0).getTime()

function vid(partial: Partial<LibraryVideo> & { id: string }): LibraryVideo {
  return { title: '', description: '', publishedAt: NOW, ...partial }
}

describe('parseWhen', () => {
  it('returns undefined when no temporal phrase', () => {
    expect(parseWhen('my kills against rekt', NOW)).toBeUndefined()
  })

  it('parses yesterday as the prior local day', () => {
    const w = parseWhen('the ko yesterday', NOW)!
    expect(w.label).toBe('yesterday')
    // A clip stamped mid-yesterday should be inside the window.
    const midYesterday = NOW - DAY - 8 * 3600_000
    expect(w.fromMs! <= midYesterday && midYesterday < w.toMs!).toBe(true)
  })

  it('parses "3 days ago"', () => {
    const w = parseWhen('flag run 3 days ago', NOW)!
    expect(w.fromMs).toBeLessThan(NOW - 2 * DAY)
  })

  it('parses a weekday to the most recent past occurrence', () => {
    // NOW is Saturday; "on friday" → yesterday.
    const w = parseWhen('clutch on friday', NOW)!
    expect(w.label).toBe('friday')
    expect(w.toMs! - w.fromMs!).toBe(DAY)
  })
})

describe('parseDescribe', () => {
  it('pulls opponent, category, when, and limit together', () => {
    const q = parseDescribe('my last 5 ultimates against Rekt last night', NOW)
    expect(q.opponent).toBe('rekt')
    expect(q.category).toBe('ultimate')
    expect(q.limit).toBe(5)
    expect(q.when?.label).toBe('last night')
    expect(q.pronoun).toBe(true)
  })

  it('handles @handles', () => {
    const q = parseDescribe('kills vs @auryn today', NOW)
    expect(q.opponent).toBe('auryn')
    expect(q.category).toBe('kill')
    expect(q.when?.label).toBe('today')
  })
})

describe('matchLibrary', () => {
  const lib: LibraryVideo[] = [
    vid({ id: 'a', title: 'Insane ULTIMATE on Rekt', publishedAt: NOW - DAY - 3600_000 }), // yesterday
    vid({ id: 'b', title: 'Flag run vs auryn', publishedAt: NOW - 5 * DAY }), // last week
    vid({ id: 'c', title: 'Ultimate against Rekt', publishedAt: NOW - 20 * DAY }), // too old for "last night"
    vid({ id: 'd', title: 'random gameplay', publishedAt: NOW - DAY - 7200_000 }), // yesterday, no match
  ]

  it('filters by the when window and ranks the opponent+category match first', () => {
    const q = parseDescribe('my ultimate against Rekt last night', NOW)
    const res = matchLibrary(lib, q, 'me')
    expect(res[0].id).toBe('a') // yesterday + names Rekt + ultimate
    expect(res.map((v) => v.id)).not.toContain('c') // outside window
    expect(res.map((v) => v.id)).not.toContain('b') // outside window
  })

  it('returns everything (capped) when no filters given', () => {
    const q = parseDescribe('show me clips', NOW)
    const res = matchLibrary(lib, q)
    expect(res.length).toBe(lib.length)
  })

  it('scoreVideo rejects videos outside the when window', () => {
    const q = parseDescribe('kills today', NOW)
    const old = vid({ id: 'x', publishedAt: NOW - 10 * DAY })
    expect(scoreVideo(old, q)).toBe(-1)
  })
})

describe('describeSummary', () => {
  it('reads back what we understood', () => {
    const q = parseDescribe('my last 3 kills against Rekt yesterday', NOW)
    const s = describeSummary(q)
    expect(s).toContain('kills')
    expect(s).toContain('vs rekt')
    expect(s).toContain('yesterday')
  })
})
