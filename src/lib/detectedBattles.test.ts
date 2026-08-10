import { describe, expect, it } from 'vitest'
import {
  detectedBattleLabel,
  detectedBattleWatchUrl,
  isVisibleDetectedBattle,
  type DetectedBattleRow,
} from './detectedBattles'

function row(overrides: Partial<DetectedBattleRow> = {}): DetectedBattleRow {
  return {
    id: 'clip-1', segment_id: 'segment-1', youtube_id: 'MWBcNzQMqxc',
    source_start_sec: 264, source_end_sec: 468, duration_sec: 204,
    boundary_confidence: 0.92, score_verification_status: 'shadow',
    mode: 'combat_battle', map: null,
    recorded_at: '2026-08-08T00:00:00Z', created_at: '2026-08-08T00:00:00Z',
    ...overrides,
  }
}

describe('detected livestream battle cards', () => {
  it('shows a strong server-created YouTube segment and links to its start', () => {
    const battle = row()
    expect(isVisibleDetectedBattle(battle)).toBe(true)
    expect(detectedBattleWatchUrl(battle)).toBe('https://www.youtube.com/watch?v=MWBcNzQMqxc&t=264s')
    expect(detectedBattleLabel(battle.mode)).toBe('Combat Battle')
  })

  it('hides manual, short, or low-confidence records', () => {
    expect(isVisibleDetectedBattle(row({ segment_id: null }))).toBe(false)
    expect(isVisibleDetectedBattle(row({ duration_sec: 30 }))).toBe(false)
    expect(isVisibleDetectedBattle(row({ boundary_confidence: 0.69 }))).toBe(false)
    expect(isVisibleDetectedBattle(row({ score_verification_status: 'legacy' }))).toBe(false)
  })
})
