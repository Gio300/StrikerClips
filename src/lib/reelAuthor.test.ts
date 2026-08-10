import { describe, expect, it, vi } from 'vitest'
import { ensureReelAuthor, reelAuthorName, reelAuthorProfile, type ReelWithAuthor } from './reelAuthor'

const reel = (over: Partial<ReelWithAuthor> = {}): ReelWithAuthor => ({
  id: 'reel',
  user_id: 'kyubi-id',
  title: 'Battle',
  clip_ids: [],
  combined_video_url: 'https://youtu.be/abcdefghijk',
  thumbnail: null,
  created_at: '2026-08-09T00:00:00Z',
  ...over,
})

describe('reel author fallback', () => {
  it('loads the explicit user profile when an embedded join is absent', async () => {
    const load = vi.fn(async () => ({ username: 'KyubiiReign', power_level: 1234 }))
    const resolved = await ensureReelAuthor(reel(), load)
    expect(load).toHaveBeenCalledWith('kyubi-id')
    expect(reelAuthorName(resolved)).toBe('KyubiiReign')
    expect(reelAuthorProfile(resolved)?.power_level).toBe(1234)
  })

  it('keeps a valid joined profile and does not fetch twice', async () => {
    const load = vi.fn(async () => ({ username: 'wrong' }))
    const resolved = await ensureReelAuthor(reel({ profiles: { username: 'KyubiiReign' } }), load)
    expect(load).not.toHaveBeenCalled()
    expect(reelAuthorName(resolved)).toBe('KyubiiReign')
  })

  it('uses a friendly anonymous label, never Unknown, when no profile exists', async () => {
    const resolved = await ensureReelAuthor(reel(), async () => null)
    expect(reelAuthorName(resolved)).toBe('Anonymous shinobi')
    expect(reelAuthorName(resolved)).not.toBe('Unknown')
  })
})
