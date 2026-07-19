import { describe, it, expect } from 'vitest'
import {
  initProgram,
  programPosition,
  applyAction,
  viewerTarget,
  nextMomentAfter,
  shouldResync,
} from './watchParty'

const T0 = 1_000_000_000_000

describe('watchParty engine', () => {
  it('advances position while playing, freezes when paused', () => {
    let s = initProgram('vid', T0)
    s = applyAction(s, { type: 'load', videoId: 'vid', atSec: 10 }, T0)
    s = applyAction(s, { type: 'play' }, T0)
    expect(programPosition(s, T0 + 4000)).toBeCloseTo(14, 5) // +4s
    s = applyAction(s, { type: 'pause' }, T0 + 4000)
    expect(programPosition(s, T0 + 9000)).toBeCloseTo(14, 5) // frozen at 14
  })

  it('runBack subtracts from the live position', () => {
    let s = applyAction(initProgram('v', T0), { type: 'play' }, T0)
    s = applyAction(s, { type: 'seek', toSec: 30 }, T0 + 1000)
    s = applyAction(s, { type: 'runBack', seconds: 10 }, T0 + 1000)
    expect(programPosition(s, T0 + 1000)).toBeCloseTo(20, 5)
  })

  it('slow-mo sets rate 0.5 from a point and plays', () => {
    let s = applyAction(initProgram('v', T0), { type: 'slowmo', fromSec: 100 }, T0)
    expect(s.rate).toBe(0.5)
    expect(s.playing).toBe(true)
    // after 10s wall-clock at 0.5x → +5s
    expect(programPosition(s, T0 + 10_000)).toBeCloseTo(105, 5)
    s = applyAction(s, { type: 'normalSpeed' }, T0 + 10_000)
    expect(s.rate).toBe(1)
    expect(programPosition(s, T0 + 10_000)).toBeCloseTo(105, 5) // re-anchored, no jump
  })

  it('viewer stays delaySec behind the host', () => {
    let s = applyAction(initProgram('v', T0), { type: 'play' }, T0)
    const t = T0 + 20_000 // host at 20s
    const v = viewerTarget(s, t, 5)
    expect(v.positionSec).toBeCloseTo(15, 5)
    expect(v.playing).toBe(true)
    // early on, before delay elapsed, viewer waits at 0 and isn't playing yet
    const early = viewerTarget(s, T0 + 3000, 5)
    expect(early.positionSec).toBe(0)
    expect(early.playing).toBe(false)
  })

  it('finds the next tagged moment ahead of the playhead', () => {
    let s = applyAction(initProgram('v', T0), { type: 'seek', toSec: 42 }, T0)
    const moments = [10, 30, 55, 80]
    expect(nextMomentAfter(moments, s, T0)).toBe(55)
    s = applyAction(s, { type: 'seek', toSec: 90 }, T0)
    expect(nextMomentAfter(moments, s, T0)).toBeNull()
  })

  it('resync only triggers past tolerance', () => {
    expect(shouldResync(10, 10.5)).toBe(false)
    expect(shouldResync(10, 13)).toBe(true)
  })
})
