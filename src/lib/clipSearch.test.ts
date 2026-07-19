import { describe, it, expect } from 'vitest'
import { parseClipQuery, rankClips, clipLink, type ClipRecord } from './clipSearch'

describe('parseClipQuery', () => {
  it('pulls category, limit, and player', () => {
    expect(parseClipQuery('show me his last 10 kills')).toMatchObject({ category: 'kill', limit: 10, pronoun: true })
    expect(parseClipQuery('his last 3 deaths')).toMatchObject({ category: 'death', limit: 3, pronoun: true })
    expect(parseClipQuery('top 5 ultimates from @auryn')).toMatchObject({ category: 'ultimate', limit: 5, playerHint: 'auryn' })
    expect(parseClipQuery('my flag runs')).toMatchObject({ category: 'flag', pronoun: true })
  })
  it('defaults limit to 10', () => {
    expect(parseClipQuery('his kills').limit).toBe(10)
  })
})

function clip(p: Partial<ClipRecord> & { id: string; createdAt: number; category: ClipRecord['category'] }): ClipRecord {
  return { playerId: p.playerName ?? 'p', playerName: 'Rekt', youtubeId: 'vid', startSec: 5, ...p } as ClipRecord
}

describe('rankClips', () => {
  const clips: ClipRecord[] = [
    clip({ id: 'a', category: 'kill', createdAt: 100, playerName: 'Rekt' }),
    clip({ id: 'b', category: 'kill', createdAt: 300, playerName: 'Rekt' }),
    clip({ id: 'c', category: 'death', createdAt: 200, playerName: 'Rekt' }),
    clip({ id: 'd', category: 'kill', createdAt: 400, playerName: 'Auryn' }),
  ]

  it('filters by category, newest first, capped', () => {
    const r = rankClips(clips, { category: 'kill', limit: 2 })
    expect(r.map((c) => c.id)).toEqual(['d', 'b']) // newest kills first
  })

  it('resolves a named player', () => {
    const r = rankClips(clips, { category: 'kill', limit: 10, playerHint: 'auryn' })
    expect(r.map((c) => c.id)).toEqual(['d'])
  })

  it('resolves a pronoun to the supplied target', () => {
    const r = rankClips(clips, { category: 'kill', limit: 10, pronoun: true }, 'Rekt')
    expect(r.map((c) => c.id)).toEqual(['b', 'a'])
  })
})

describe('clipLink', () => {
  it('builds a timestamped youtube link', () => {
    expect(clipLink(clip({ id: 'x', category: 'kill', createdAt: 1, youtubeId: 'abc', startSec: 42.7 }))).toBe('https://youtu.be/abc?t=42')
  })
})
