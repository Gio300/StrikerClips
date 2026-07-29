import { describe, expect, it } from 'vitest'
import {
  activityTargetName,
  dedupeActivities,
  directConversationId,
  mergeFeedAudience,
} from './social'

describe('social feed helpers', () => {
  it('builds a stable, unique audience from follows and clanmates', () => {
    expect(
      mergeFeedAudience('me', ['followed', 'clanmate'], ['clanmate', 'me', 'other']),
    ).toEqual(['me', 'followed', 'clanmate', 'other'])
  })

  it('deduplicates trigger and client copies of the same activity', () => {
    const rows = [
      {
        id: 'older',
        user_id: 'me',
        type: 'follow' as const,
        target_id: 'them',
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'newer',
        user_id: 'me',
        type: 'follow' as const,
        target_id: 'them',
        created_at: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'other',
        user_id: 'me',
        type: 'reel_like' as const,
        target_id: 'reel',
        created_at: '2026-01-01T00:00:02.000Z',
      },
    ]
    expect(dedupeActivities(rows).map((row) => row.id)).toEqual(['other', 'newer'])
  })

  it('uses a resolved follow target, then recorded metadata, without vague "someone" copy', () => {
    expect(activityTargetName({
      target: { username: 'Hinata' } as never,
      target_meta: {},
    })).toBe('Hinata')
    expect(activityTargetName({
      target: null,
      target_meta: { username: 'Sakura' },
    })).toBe('Sakura')
    expect(activityTargetName({ target: null, target_meta: {} })).toBe('a player')
  })
})

describe('direct conversation matching', () => {
  it('matches only a true two-person thread', () => {
    const conversations = [
      { id: 'group', participantIds: ['me', 'target', 'third'] },
      { id: 'direct', participantIds: ['target', 'me'] },
    ]
    expect(directConversationId(conversations, 'me', 'target')).toBe('direct')
  })

  it('does not treat a self-only or unrelated conversation as a direct thread', () => {
    expect(
      directConversationId([
        { id: 'pending', participantIds: ['me'] },
        { id: 'other', participantIds: ['me', 'third'] },
      ], 'me', 'target'),
    ).toBeNull()
  })
})
