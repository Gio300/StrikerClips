import { describe, expect, it } from 'vitest'
import { buildSquadData } from './squadData'

describe('buildSquadData', () => {
  it('uses followed and same-clan profiles instead of demo people', () => {
    const result = buildSquadData(
      'viewer',
      [{ following_id: 'followed' }],
      [{ server_id: 'clan' }],
      [
        { server_id: 'clan', user_id: 'viewer' },
        { server_id: 'clan', user_id: 'clanmate' },
        { server_id: 'other', user_id: 'stranger' },
      ],
      [
        { id: 'followed', username: 'Followed', avatar_url: null },
        { id: 'clanmate', username: 'Clanmate', avatar_url: 'avatar.jpg' },
        { id: 'stranger', username: 'Stranger', avatar_url: null },
      ],
      [],
      [],
    )

    expect(result.members.map((member) => member.name)).toEqual(['Clanmate', 'Followed'])
    expect(result.members[0].avatarUrl).toBe('avatar.jpg')
  })

  it('finds clanmates when the viewer is known only as the clan owner', () => {
    const result = buildSquadData(
      'owner',
      [],
      [{ server_id: 'owned-clan' }],
      [{ server_id: 'owned-clan', user_id: 'member' }],
      [{ id: 'member', username: 'Clan Member', avatar_url: null }],
      [],
      [],
    )

    expect(result.members.map((member) => member.name)).toEqual(['Clan Member'])
  })

  it('includes produced videos and YouTube reels, deduped per owner', () => {
    const result = buildSquadData(
      'viewer',
      [{ following_id: 'member' }],
      [],
      [],
      [{ id: 'member', username: 'Kyubi', avatar_url: null }],
      [{
        player_id: 'member',
        player_handle: 'Kyubi',
        category: 'win',
        composite_youtube_id: 'abcdefghijk',
        recorded_at: '2026-08-09T02:00:00Z',
        created_at: null,
      }],
      [
        { user_id: 'member', title: 'Same video', combined_video_url: 'https://youtu.be/abcdefghijk', created_at: '2026-08-09T03:00:00Z' },
        { user_id: 'member', title: 'Another reel', combined_video_url: 'https://youtube.com/watch?v=lmnopqrstuv', created_at: '2026-08-09T04:00:00Z' },
        { user_id: 'member', title: 'Local render', combined_video_url: '/storage/private.mp4', created_at: '2026-08-09T05:00:00Z' },
      ],
    )

    expect(result.clips.map((clip) => clip.id)).toEqual(['lmnopqrstuv', 'abcdefghijk'])
    expect(result.clips.find((clip) => clip.id === 'abcdefghijk')?.category).toBe('win')
  })

  it('never exposes a raw source archive as a reusable produced clip', () => {
    const result = buildSquadData(
      'viewer',
      [{ following_id: 'member' }],
      [],
      [],
      [{ id: 'member', username: 'Member', avatar_url: null }],
      [{
        player_id: 'member',
        player_handle: 'Member',
        category: 'kill',
        composite_youtube_id: null,
        recorded_at: null,
        created_at: '2026-08-09T02:00:00Z',
      }],
      [],
    )

    expect(result.clips).toEqual([])
  })
})
