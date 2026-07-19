import { describe, it, expect } from 'vitest'
import { activeAt, slotsOpenAt, canGoLiveNow, nextOpenSlot, tierCanHostOnChannel, type SlotClaim } from './streamSlots'

const claims = (arr: [number, number][]): SlotClaim[] => arr.map(([s, e], i) => ({ userId: 'u' + i, startsAt: s, endsAt: e }))

describe('streamSlots — tier gate', () => {
  it('only Pro can host on our channel', () => {
    expect(tierCanHostOnChannel(false)).toBe(false)
    expect(tierCanHostOnChannel(true)).toBe(true)
  })
})

describe('streamSlots — occupancy', () => {
  const c = claims([[0, 10], [0, 10], [5, 15]])
  it('counts active + open at an instant', () => {
    expect(activeAt(c, 3)).toBe(2)
    expect(activeAt(c, 7)).toBe(3)
    expect(slotsOpenAt(c, 3, 3)).toBe(1)
    expect(slotsOpenAt(c, 7, 3)).toBe(0)
  })
})

describe('streamSlots — go live now (first-come-first-serve)', () => {
  it('free user blocked; pro allowed only when a slot is open', () => {
    const full = claims([[0, 10], [0, 10], [0, 10]]) // 3/3 taken
    expect(canGoLiveNow(false, [], 1).ok).toBe(false)
    expect(canGoLiveNow(true, [], 1).ok).toBe(true)
    expect(canGoLiveNow(true, full, 1).ok).toBe(false)
    expect(canGoLiveNow(true, full, 11).ok).toBe(true) // claims ended
  })
})

describe('streamSlots — scheduling', () => {
  it('finds the next open window', () => {
    // 3 slots; all full 0..10, one still going to 20
    const c = claims([[0, 10], [0, 10], [0, 20]])
    // a 5-long window: at t=0 there are 3 active → not free until one ends at 10
    expect(nextOpenSlot(c, 0, 5, 3)).toBe(10)
    // with capacity 3 and only 1 active after 10, now() is free immediately
    expect(nextOpenSlot(c, 12, 5, 3)).toBe(12)
  })
})
