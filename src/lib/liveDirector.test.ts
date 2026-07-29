import { describe, expect, it } from 'vitest'
import {
  beatFromElapsed,
  cameraGrid,
  directorPlan,
  eventAwareShot,
  shotAt,
  shotFeeds,
  shotLabel,
  toggleCastSelection,
  SHOT_MS,
} from './liveDirector'

describe('directorPlan', () => {
  it('is a single static shot for zero or one angle', () => {
    expect(directorPlan(0)).toEqual([{ layout: 'single', featured: 0 }])
    expect(directorPlan(1)).toEqual([{ layout: 'single', featured: 0 }])
  })

  it('cuts through each angle then a split for a pair', () => {
    expect(directorPlan(2)).toEqual([
      { layout: 'single', featured: 0 },
      { layout: 'single', featured: 1 },
      { layout: 'split', featured: 0, secondary: 1 },
    ])
  })

  it('includes an all-camera beat for larger stages', () => {
    const plan = directorPlan(3)
    expect(plan.filter((shot) => shot.layout === 'single')).toHaveLength(3)
    expect(plan[plan.length - 1]).toEqual({
      layout: 'grid',
      featured: 0,
      feeds: [0, 1, 2],
    })
  })

  it('caps an automatic stage at eight feeds', () => {
    const plan = directorPlan(12)
    expect(plan.filter((shot) => shot.layout === 'single')).toHaveLength(8)
    expect(shotFeeds(plan[plan.length - 1], 12)).toHaveLength(8)
  })
})

describe('shotAt and timing', () => {
  it('wraps around the plan and handles negatives', () => {
    const plan = directorPlan(2)
    expect(shotAt(plan, 0)).toEqual(plan[0])
    expect(shotAt(plan, 3)).toEqual(plan[0])
    expect(shotAt(plan, 4)).toEqual(plan[1])
    expect(shotAt(plan, -1)).toEqual(plan[2])
  })

  it('advances one beat per SHOT_MS', () => {
    expect(beatFromElapsed(0)).toBe(0)
    expect(beatFromElapsed(SHOT_MS - 1)).toBe(0)
    expect(beatFromElapsed(SHOT_MS)).toBe(1)
    expect(beatFromElapsed(SHOT_MS * 3.5)).toBe(3)
  })
})

describe('shot labels', () => {
  it('names single, split, and grid shots', () => {
    expect(shotLabel({ layout: 'single', featured: 1 }, ['@a', '@b'])).toBe('Featuring @b')
    expect(shotLabel({ layout: 'split', featured: 0, secondary: 1 }, ['@a', '@b'])).toBe('@a + @b')
    expect(shotLabel(
      { layout: 'grid', featured: 0, feeds: [0, 1, 2] },
      ['@a', '@b', '@c'],
    )).toBe('3 cameras')
  })
})

describe('camera selection', () => {
  it('supports stable one through eight camera layouts', () => {
    expect(cameraGrid(1)).toEqual({ columns: 1, rows: 1 })
    expect(cameraGrid(3)).toEqual({ columns: 2, rows: 2 })
    expect(cameraGrid(6)).toEqual({ columns: 3, rows: 2 })
    expect(cameraGrid(8)).toEqual({ columns: 4, rows: 2 })
  })

  it('toggles unique camera picks and respects the cap', () => {
    let selected: number[] = []
    for (let index = 0; index < 10; index += 1) {
      selected = toggleCastSelection(selected, index, 10)
    }
    expect(selected).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(toggleCastSelection(selected, 3, 10)).toEqual([0, 1, 2, 4, 5, 6, 7])
  })
})

describe('event-aware cuts', () => {
  it('features a recent knockout over the timer rotation', () => {
    expect(eventAwareShot(
      { layout: 'single', featured: 0 },
      [{ angle: 3, kind: 'knockout', atMs: 9_000 }],
      10_000,
      4,
    )).toEqual({ layout: 'single', featured: 3 })
  })

  it('combines two simultaneous important objectives', () => {
    expect(eventAwareShot(
      { layout: 'single', featured: 0 },
      [
        { angle: 2, kind: 'flag_capture', atMs: 9_400 },
        { angle: 5, kind: 'base_capture', atMs: 9_000 },
      ],
      10_000,
      8,
    )).toEqual({ layout: 'split', featured: 2, secondary: 5 })
  })
})
