import { describe, it, expect } from 'vitest'
import {
  breakpointForWidth,
  isPhoneWidth,
  maxVisiblePanes,
  allowedLayouts,
  coerceLayout,
  allowsCompositeShots,
  nextAngleIndex,
  swipeDirection,
  SWIPE_THRESHOLD_PX,
} from './stageLayout'

describe('breakpointForWidth', () => {
  it('treats real phone widths as phones', () => {
    expect(breakpointForWidth(320)).toBe('phone') // iPhone SE
    expect(breakpointForWidth(390)).toBe('phone') // iPhone 14
    expect(breakpointForWidth(430)).toBe('phone') // iPhone Pro Max
    expect(breakpointForWidth(639)).toBe('phone')
  })

  it('treats tablet widths as tablets', () => {
    expect(breakpointForWidth(640)).toBe('tablet')
    expect(breakpointForWidth(768)).toBe('tablet') // iPad portrait
    expect(breakpointForWidth(1023)).toBe('tablet')
  })

  it('treats laptop and up as desktop', () => {
    expect(breakpointForWidth(1024)).toBe('desktop')
    expect(breakpointForWidth(1800)).toBe('desktop')
  })

  it('degrades safely on a missing or nonsense width', () => {
    expect(breakpointForWidth(0)).toBe('phone')
    expect(breakpointForWidth(-100)).toBe('phone')
    expect(breakpointForWidth(Number.NaN)).toBe('phone')
  })

  it('exposes an isPhoneWidth shorthand', () => {
    expect(isPhoneWidth(390)).toBe(true)
    expect(isPhoneWidth(1024)).toBe(false)
  })
})

describe('maxVisiblePanes', () => {
  it('shows exactly one pane on a phone', () => {
    expect(maxVisiblePanes('phone')).toBe(1)
  })
  it('opens up on bigger screens', () => {
    expect(maxVisiblePanes('tablet')).toBe(4)
    expect(maxVisiblePanes('desktop')).toBe(8)
  })
})

describe('allowedLayouts', () => {
  it('never offers Quad on a phone, however many angles there are', () => {
    expect(allowedLayouts('phone', 4)).toEqual(['auto', 'single', 'sxs'])
    expect(allowedLayouts('phone', 8)).not.toContain('quad')
  })

  it('allows 2-up on a phone when there are two angles', () => {
    expect(allowedLayouts('phone', 2)).toContain('sxs')
  })

  it('offers Quad from tablet width up', () => {
    expect(allowedLayouts('tablet', 4)).toContain('quad')
    expect(allowedLayouts('desktop', 4)).toContain('quad')
  })

  it('hides Split/Quad when there are not enough angles to fill them', () => {
    expect(allowedLayouts('desktop', 1)).toEqual(['auto', 'single'])
    expect(allowedLayouts('desktop', 2)).toEqual(['auto', 'single', 'sxs'])
  })

  it('offers only single-shot layouts when composites are disabled', () => {
    // Action cam: single-shot by design at every width.
    expect(allowedLayouts('desktop', 8, false)).toEqual(['auto', 'single'])
    expect(allowedLayouts('phone', 8, false)).toEqual(['auto', 'single'])
  })
})

describe('coerceLayout', () => {
  it('passes through a layout that is legible at this width', () => {
    expect(coerceLayout('quad', 'desktop', 4)).toBe('quad')
    expect(coerceLayout('sxs', 'phone', 2)).toBe('sxs')
    expect(coerceLayout('single', 'phone', 4)).toBe('single')
  })

  it('falls back to the auto-director when Quad is picked on a phone', () => {
    // The whole point: unreadable tiles become one good feed, chosen for you.
    expect(coerceLayout('quad', 'phone', 4)).toBe('auto')
  })

  it('falls back when there are not enough angles for the split', () => {
    expect(coerceLayout('sxs', 'desktop', 1)).toBe('auto')
    expect(coerceLayout('quad', 'desktop', 2)).toBe('auto')
  })

  it('keeps auto and single valid everywhere', () => {
    for (const bp of ['phone', 'tablet', 'desktop'] as const) {
      expect(coerceLayout('auto', bp, 1)).toBe('auto')
      expect(coerceLayout('single', bp, 1)).toBe('single')
    }
  })
})

describe('allowsCompositeShots', () => {
  it('keeps the director in single-shot mode on phones', () => {
    expect(allowsCompositeShots('phone')).toBe(false)
  })
  it('lets the director composite on bigger screens', () => {
    expect(allowsCompositeShots('tablet')).toBe(true)
    expect(allowsCompositeShots('desktop')).toBe(true)
  })
})

describe('nextAngleIndex', () => {
  it('advances and wraps forward', () => {
    expect(nextAngleIndex(0, 4, 1)).toBe(1)
    expect(nextAngleIndex(3, 4, 1)).toBe(0)
  })
  it('advances and wraps backward', () => {
    expect(nextAngleIndex(0, 4, -1)).toBe(3)
    expect(nextAngleIndex(2, 4, -1)).toBe(1)
  })
  it('is a no-op with no angles', () => {
    expect(nextAngleIndex(0, 0, 1)).toBe(0)
  })
  it('handles an out-of-range current index', () => {
    expect(nextAngleIndex(9, 4, 1)).toBe(2)
    expect(nextAngleIndex(Number.NaN, 4, 1)).toBe(1)
  })
})

describe('swipeDirection', () => {
  it('reads a leftward swipe as "next angle"', () => {
    expect(swipeDirection(-120, 5)).toBe(1)
  })
  it('reads a rightward swipe as "previous angle"', () => {
    expect(swipeDirection(120, 5)).toBe(-1)
  })
  it('ignores taps and tiny drags', () => {
    expect(swipeDirection(0, 0)).toBe(0)
    expect(swipeDirection(SWIPE_THRESHOLD_PX - 1, 0)).toBe(0)
  })
  it('leaves vertical-dominant drags to the page scroller', () => {
    expect(swipeDirection(60, 200)).toBe(0)
    expect(swipeDirection(-60, 200)).toBe(0)
  })
  it('ignores nonsense input', () => {
    expect(swipeDirection(Number.NaN, 0)).toBe(0)
  })
})
