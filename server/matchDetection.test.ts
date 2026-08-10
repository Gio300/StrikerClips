import { describe, expect, it } from 'vitest'
import { detectMatchSegments, matchSegmentFingerprint, parseGameTimer } from './matchDetection'

describe('automatic match-boundary detection', () => {
  it('splits repeated players and identical modes when the match timer resets', () => {
    const segments = detectMatchSegments([
      { atSec: 10, text: 'Combat Battle - Battle Start', roster: ['Hammy', 'Pattern'] },
      { atSec: 20, text: '6:50', roster: ['Hammy', 'Pattern'] },
      { atSec: 300, text: '2:10' },
      { atSec: 390, text: 'Victory - Results' },
      { atSec: 460, text: 'Combat Battle - Battle Start', roster: ['Hammy', 'Pattern'] },
      { atSec: 470, text: '6:51', roster: ['Hammy', 'Pattern'] },
      { atSec: 760, text: '2:01' },
      { atSec: 840, text: 'Defeat - Results' },
    ], { sourceDurationSec: 900 })

    expect(segments).toHaveLength(2)
    expect(segments.map((segment) => segment.startSec)).toEqual([10, 460])
    expect(segments.map((segment) => segment.endReason)).toEqual(['result_cue', 'result_cue'])
    expect(segments[0].roster).toEqual(['Hammy', 'Pattern'])
    expect(matchSegmentFingerprint('one-source', segments[0]))
      .not.toBe(matchSegmentFingerprint('one-source', segments[1]))
  })

  it('splits a new match when a timer jumps upward even if start/results frames are missing', () => {
    const segments = detectMatchSegments([
      { atSec: 30, timerSec: 375 },
      { atSec: 180, timerSec: 225 },
      { atSec: 330, timerSec: 75 },
      { atSec: 405, timerSec: 410 },
      { atSec: 560, timerSec: 255 },
      { atSec: 720, timerSec: 95 },
    ], { sourceDurationSec: 800 })

    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ startSec: 30, endSec: 330, endReason: 'timer_reset' })
    expect(segments[1]).toMatchObject({ startSec: 405, endSec: 800, startReason: 'timer_reset' })
  })

  it('supports a partial recording that begins after the match start', () => {
    const segments = detectMatchSegments([
      { atSec: 0, text: '4:22' },
      { atSec: 120, text: '2:22' },
      { atSec: 235, text: 'Victory Results' },
    ], { sourceDurationSec: 240 })

    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      startSec: 0,
      endSec: 235,
      startReason: 'timer_detected',
      endReason: 'result_cue',
    })
  })

  it('ignores low-confidence zero timer reads inside a running match', () => {
    const segments = detectMatchSegments([
      { atSec: 250, timerSec: 420, confidence: 0.88 },
      { atSec: 278, timerSec: 0, confidence: 0.5 },
      { atSec: 282, timerSec: 397, confidence: 0.88 },
      { atSec: 600, timerSec: 80, confidence: 0.88 },
      { atSec: 828, timerSec: 420, confidence: 0.88 },
      { atSec: 1_000, timerSec: 248, confidence: 0.88 },
    ], { sourceDurationSec: 1_100 })

    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ startSec: 250, endSec: 600, endReason: 'timer_reset' })
    expect(segments[1]).toMatchObject({ startSec: 828, endSec: 1_100, startReason: 'timer_reset' })
  })

  it('does not split a match when its mode label is repeatedly OCRed as a start cue', () => {
    const segments = detectMatchSegments([
      { atSec: 10, text: 'Combat Battle - Battle Start', confidence: 0.96 },
      { atSec: 40, text: 'Combat Battle', confidence: 0.96 },
      { atSec: 80, timerSec: 360, confidence: 0.88 },
      { atSec: 120, text: 'Combat Battle', confidence: 0.96 },
      { atSec: 300, text: 'Victory - Results', confidence: 0.96 },
    ], { sourceDurationSec: 320 })

    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ startSec: 10, endSec: 300, endReason: 'result_cue' })
  })

  it('does not treat a mode label by itself as a match start', () => {
    const segments = detectMatchSegments([
      { atSec: 120, text: 'Flag Battle', confidence: 0.5 },
      { atSec: 162, text: 'Combat Battle', confidence: 0.5 },
      { atSec: 246, text: 'Battle Start', confidence: 0.96 },
      { atSec: 256, timerSec: 420, confidence: 0.88 },
      { atSec: 480, cue: 'result', confidence: 0.96 },
    ], { sourceDurationSec: 500 })

    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ startSec: 246, endSec: 480 })
  })

  it('does not split a running timer on a low-confidence result read', () => {
    const segments = detectMatchSegments([
      { atSec: 264, timerSec: 415, confidence: 0.88 },
      { atSec: 432, cue: 'result', confidence: 0.5 },
      { atSec: 436, timerSec: 245, confidence: 0.88 },
      { atSec: 468, cue: 'result', confidence: 0.96 },
    ], { sourceDurationSec: 500 })

    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ startSec: 264, endSec: 468, endReason: 'result_cue' })
  })

  it('parses only plausible game-clock text', () => {
    expect(parseGameTimer('Time 06:47 remaining')).toBe(407)
    expect(parseGameTimer('uploaded 12:99')).toBeNull()
  })
})
