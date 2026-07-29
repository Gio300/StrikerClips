import { describe, it, expect } from 'vitest'
import { canUseClip, clipsFor, groupByCategory, demoSquad, type SquadClip } from './squad'

const base = (over: Partial<SquadClip>): SquadClip => ({
  id: 'x', ownerId: 'u1', ownerName: 'A', category: 'kill', title: 't', publishedAt: 0, visibility: 'followers', ...over,
})

describe('squad visibility', () => {
  it('owner always can use their own clip', () => {
    expect(canUseClip(base({ visibility: 'private' }), 'u1', false)).toBe(true)
  })
  it('private clips are blocked for others', () => {
    expect(canUseClip(base({ visibility: 'private' }), 'u2', true)).toBe(false)
  })
  it('followers-only needs you to be in their circle; public is open', () => {
    expect(canUseClip(base({ visibility: 'followers' }), 'u2', true)).toBe(true)
    expect(canUseClip(base({ visibility: 'followers' }), 'u2', false)).toBe(false)
    expect(canUseClip(base({ visibility: 'public' }), 'u2', false)).toBe(true)
  })
})

describe('clipsFor + grouping', () => {
  it('returns a members clips newest-first', () => {
    const clips = [
      base({ id: 'a', ownerId: 'u1', publishedAt: 100 }),
      base({ id: 'b', ownerId: 'u1', publishedAt: 300 }),
      base({ id: 'c', ownerId: 'u2', publishedAt: 200 }),
    ]
    const r = clipsFor(clips, 'u1', 'viewer')
    expect(r.map((c) => c.id)).toEqual(['b', 'a'])
  })
  it('groups by category in display order', () => {
    const clips = [
      base({ id: 'a', category: 'flag' }),
      base({ id: 'b', category: 'kill' }),
      base({ id: 'c', category: 'kill' }),
    ]
    const g = groupByCategory(clips)
    expect(g[0].category).toBe('kill') // kill before flag
    expect(g[0].clips.length).toBe(2)
    expect(g[1].category).toBe('flag')
  })
})

describe('demoSquad', () => {
  it('gives members with usable clips', () => {
    const { members, clips } = demoSquad(1_000_000_000_000)
    expect(members.length).toBeGreaterThan(0)
    const rektClips = clipsFor(clips, 'u_rekt', 'me')
    expect(rektClips.length).toBeGreaterThan(0)
    expect(groupByCategory(rektClips).length).toBeGreaterThan(0)
  })
})
