import { describe, expect, it } from 'vitest'
import { parseMediaOcrSamples, type MediaAliasCatalogEntry } from './mediaAnalysis'

const aliases: MediaAliasCatalogEntry[] = [
  {
    profileId: 'hammy-profile',
    displayAlias: 'Hammy',
    normalizedAlias: 'hammy',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: null,
    confidence: 0.99,
    isPrimary: true,
  },
  {
    profileId: 'gio-profile',
    displayAlias: 'Gio',
    normalizedAlias: 'gio',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: null,
    confidence: 0.99,
    isPrimary: true,
  },
]

describe('low-cost media OCR parsing', () => {
  it('extracts boundaries, known members, an exact KO, and an explicit result', () => {
    const parsed = parseMediaOcrSamples([
      { atSec: 0, text: 'BASE BATTLE\nBATTLE START\n7:00\nHammy\nGio', evidenceRef: 'frame-0001' },
      { atSec: 36, text: 'Hammy defeated Gio\n6:24', evidenceRef: 'frame-0013' },
      { atSec: 120, text: 'VICTORY\nKOs 4\nDeaths 1\nAssists 2\nScore 4 - 1', evidenceRef: 'frame-0041' },
    ], aliases, {
      sourceOwnerId: 'hammy-profile',
      sourceRecordedAt: '2026-07-31T12:00:00.000Z',
    })

    expect(parsed.observations.map((item) => item.cue)).toEqual(['start', 'timer', 'result'])
    expect(parsed.observations[0].mode).toBe('Base Battle')
    expect(new Set(parsed.participants.map((item) => item.alias))).toEqual(new Set(['Hammy', 'Gio']))
    expect(parsed.combatEvents).toEqual([expect.objectContaining({
      eventType: 'ko',
      killerAlias: 'Hammy',
      victimAlias: 'Gio',
      matchClockSec: 384,
      confidence: 0.96,
    })])
    expect(parsed.results).toEqual([expect.objectContaining({
      outcome: 'victory',
      kills: 4,
      deaths: 1,
      assists: 2,
      scoreLine: '4-1',
      explicitEvidence: true,
    })])
    expect(parsed.ownerAlias?.displayAlias).toBe('Hammy')
  })

  it('uses the verified source owner for an exact gray-screen defeat line', () => {
    const parsed = parseMediaOcrSamples([
      { atSec: 50, text: 'You were defeated by Hammy\n5:12', evidenceRef: 'gray-screen' },
    ], aliases, {
      sourceOwnerId: 'gio-profile',
      sourceRecordedAt: '2026-07-31T12:00:00.000Z',
    })

    expect(parsed.combatEvents).toEqual([expect.objectContaining({
      eventType: 'death',
      killerAlias: 'Hammy',
      victimAlias: 'Gio',
      matchClockSec: 312,
    })])
  })

  it('does not turn ordinary instructions into results or combat evidence', () => {
    const parsed = parseMediaOcrSamples([
      {
        atSec: 10,
        text: 'Defeat the enemy team to achieve victory. Explore this region with your allies.',
        evidenceRef: 'instructions',
      },
    ], aliases, {
      sourceOwnerId: 'gio-profile',
      sourceRecordedAt: '2026-07-31T12:00:00.000Z',
    })

    expect(parsed.results).toEqual([])
    expect(parsed.combatEvents).toEqual([])
    expect(parsed.participants).toEqual([])
    expect(parsed.observations[0].cue).toBe('unknown')
  })

  it('honors alias validity windows when names change', () => {
    const retired: MediaAliasCatalogEntry = {
      profileId: 'hammy-profile',
      displayAlias: 'OldHammy',
      normalizedAlias: 'oldhammy',
      validFrom: '2025-01-01T00:00:00.000Z',
      validTo: '2026-02-01T00:00:00.000Z',
      confidence: 0.99,
      isPrimary: false,
    }
    const parsed = parseMediaOcrSamples([
      { atSec: 20, text: 'OldHammy defeated Gio\n6:10', evidenceRef: 'late-frame' },
    ], [...aliases, retired], {
      sourceOwnerId: 'hammy-profile',
      sourceRecordedAt: '2026-07-31T12:00:00.000Z',
    })

    expect(parsed.participants.map((item) => item.alias)).toEqual(['Gio'])
    expect(parsed.combatEvents).toEqual([])
  })
})
