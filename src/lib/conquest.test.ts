import { describe, it, expect } from 'vitest'
import {
  POWER, powerForResult, titleForLand, kageTitle, targetBoardSize, standings,
} from './conquest'

describe('shinobi conquest', () => {
  it('grants power for wins, losses, uploads', () => {
    expect(powerForResult('win')).toBe(POWER.WIN)
    expect(powerForResult('loss')).toBe(POWER.LOSS)
    expect(POWER.WIN).toBeGreaterThan(POWER.LOSS)
    expect(POWER.LOSS).toBeGreaterThan(0)       // a loss still earns some
    expect(POWER.UPLOAD).toBeGreaterThan(0)     // uploading raises power
  })

  it('assigns titles by land held', () => {
    expect(titleForLand(0).name).toBe('Wanderer')
    expect(titleForLand(1).name).toBe('Feudal Lord')
    expect(titleForLand(6).name).toBe('Jonin Commander')
    expect(titleForLand(10).name).toBe('Kage')
    expect(titleForLand(50).name).toBe('Shinobi Emperor')
  })

  it('names Kage banners by regional rank', () => {
    expect(kageTitle(0)).toBe('Hokage')
    expect(kageTitle(1)).toBe('Raikage')
    expect(kageTitle(99)).toBe('Kage')
  })

  it('grows the board when it fills past 70%', () => {
    expect(targetBoardSize(3, 0, 0)).toBeGreaterThanOrEqual(12)      // seed
    expect(targetBoardSize(3, 8, 10)).toBeGreaterThan(10)           // 80% full → grow
    expect(targetBoardSize(3, 5, 10)).toBe(10)                      // 50% → stable
  })

  it('ranks clans by land and titles the leader', () => {
    const s = standings([
      { clanId: 'a', clanName: 'Leaf', clanTag: 'LF', land: 2 },
      { clanId: 'b', clanName: 'Cloud', clanTag: 'CL', land: 11 },
      { clanId: 'c', clanName: 'Sand', clanTag: 'SD', land: 0 },
    ])
    expect(s[0].clanId).toBe('b')
    expect(s[0].rank).toBe(0)
    expect(s[0].title.name).toBe('Kage')
    expect(s[2].title.name).toBe('Wanderer')
  })
})
