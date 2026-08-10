import { describe, expect, it } from 'vitest'
import { nextMultiSelection } from './liveViewSelection'

describe('nextMultiSelection', () => {
  it('combines only the watched camera and the deliberately held camera', () => {
    expect(nextMultiSelection([], 2, 0)).toEqual([0, 2])
  })

  it('does not invent extra cameras when the watched camera is held', () => {
    expect(nextMultiSelection([], 0, 0)).toEqual([0])
  })

  it('adds and removes one explicitly held camera at a time', () => {
    expect(nextMultiSelection([0, 1], 2, 0)).toEqual([0, 1, 2])
    expect(nextMultiSelection([0, 1, 2], 1, 0)).toEqual([0, 2])
  })
})
