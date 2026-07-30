import { describe, it, expect } from 'vitest'
import {
  SPACE_KINDS,
  spaceKindLabel,
  normalizeCategory,
  normalizeChannelName,
  sortChannels,
  groupChannels,
  categoryNames,
  defaultChannelsForKind,
  canPost,
  canManageChannels,
  canDeleteChannel,
  canDeleteSpace,
  encodeChatPoll,
  parseChatPoll,
  validateChatPoll,
  type ChannelLike,
  type SpaceKind,
} from './chat'

// ───────────────────────────────────────────────────────────────────────────
//  Grouping + ordering
// ───────────────────────────────────────────────────────────────────────────

const ch = (
  id: string,
  name: string,
  category: string | null = null,
  position: number | null = 0,
  is_announcement = false,
): ChannelLike => ({ id, name, category, position, is_announcement })

describe('chat — channel ordering', () => {
  it('sorts by position, ties broken by name; nulls sink last', () => {
    const out = sortChannels([
      ch('c', 'zeta', null, 2),
      ch('a', 'alpha', null, 0),
      ch('b', 'beta', null, 0),
      ch('d', 'no-pos', null, null),
    ])
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('chat — groupChannels', () => {
  it('puts ungrouped channels first, then categories by lowest position', () => {
    const groups = groupChannels([
      ch('war1', 'strategy', 'WAR ROOM', 3),
      ch('gen', 'general', null, 0),
      ch('info1', 'rules', 'INFO', 1),
      ch('war2', 'callouts', 'WAR ROOM', 2),
    ])
    // ungrouped (null) first, then INFO (min pos 1), then WAR ROOM (min pos 2)
    expect(groups.map((g) => g.category)).toEqual([null, 'INFO', 'WAR ROOM'])
    // WAR ROOM channels ordered by position within the group
    const war = groups.find((g) => g.category === 'WAR ROOM')!
    expect(war.channels.map((c) => c.id)).toEqual(['war2', 'war1'])
  })

  it('treats empty/whitespace category as ungrouped', () => {
    const groups = groupChannels([ch('a', 'a', '   '), ch('b', 'b', '')])
    expect(groups).toHaveLength(1)
    expect(groups[0].category).toBeNull()
    expect(groups[0].channels).toHaveLength(2)
  })

  it('categoryNames lists real categories in order (no null bucket)', () => {
    const names = categoryNames([
      ch('g', 'general', null, 0),
      ch('x', 'x', 'OFF-TOPIC', 5),
      ch('y', 'y', 'INFO', 1),
    ])
    expect(names).toEqual(['INFO', 'OFF-TOPIC'])
  })
})

describe('chat — small helpers', () => {
  it('normalizeCategory trims and nulls empties', () => {
    expect(normalizeCategory('  WAR ROOM ')).toBe('WAR ROOM')
    expect(normalizeCategory('   ')).toBeNull()
    expect(normalizeCategory(null)).toBeNull()
  })

  it('normalizeChannelName slugifies to a discord-ish handle', () => {
    expect(normalizeChannelName('  General Chat! ')).toBe('general-chat')
    expect(normalizeChannelName('#Find A Clan')).toBe('find-a-clan')
    expect(normalizeChannelName('***')).toBe('general') // never empty
  })

  it('spaceKindLabel + SPACE_KINDS cover the three kinds', () => {
    expect(SPACE_KINDS).toEqual(['clan', 'open', 'tko'])
    expect(spaceKindLabel('clan')).toBe('Clan')
    expect(spaceKindLabel('open')).toBe('Open')
    expect(spaceKindLabel('tko')).toBe('TKO Official')
  })
})

describe('chat — defaultChannelsForKind ("make a chat")', () => {
  it('a clan/open space starts with a single #general', () => {
    for (const k of ['clan', 'open'] as SpaceKind[]) {
      const chans = defaultChannelsForKind(k)
      expect(chans).toHaveLength(1)
      expect(chans[0]).toMatchObject({ name: 'general', category: null, is_announcement: false })
    }
  })

  it('the TKO space seeds announcements (announcement) + community channels', () => {
    const chans = defaultChannelsForKind('tko')
    const ann = chans.find((c) => c.name === 'announcements')!
    expect(ann.is_announcement).toBe(true)
    expect(chans.map((c) => c.name)).toContain('find-a-clan')
    expect(chans.map((c) => c.name)).toContain('general')
    // only announcements is post-restricted
    expect(chans.filter((c) => c.is_announcement)).toHaveLength(1)
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Permission resolver (§4.3)
// ───────────────────────────────────────────────────────────────────────────

describe('chat — canPost', () => {
  it('signed-out users can never post', () => {
    expect(canPost({ kind: 'open', signedIn: false })).toBe(false)
    expect(canPost({ kind: 'tko', signedIn: false })).toBe(false)
    expect(canPost({ kind: 'clan', signedIn: false, clanRole: 'leader' })).toBe(false)
  })

  it('open space: anyone signed-in posts in normal channels', () => {
    expect(canPost({ kind: 'open', signedIn: true })).toBe(true)
  })

  it('open space: announcement channels are owner/staff-only', () => {
    expect(canPost({ kind: 'open', signedIn: true, isAnnouncement: true })).toBe(false)
    expect(canPost({ kind: 'open', signedIn: true, isAnnouncement: true, isOwner: true })).toBe(true)
    expect(canPost({ kind: 'open', signedIn: true, isAnnouncement: true, isStaff: true })).toBe(true)
  })

  it('tko space: community channels open, announcement channels staff-only', () => {
    expect(canPost({ kind: 'tko', signedIn: true })).toBe(true)
    expect(canPost({ kind: 'tko', signedIn: true, isAnnouncement: true })).toBe(false)
    expect(canPost({ kind: 'tko', signedIn: true, isAnnouncement: true, isStaff: true })).toBe(true)
  })

  it('clan space: a plain member can post normally but NOT in announcements', () => {
    expect(canPost({ kind: 'clan', signedIn: true, clanRole: 'member' })).toBe(true)
    expect(
      canPost({ kind: 'clan', signedIn: true, clanRole: 'member', isAnnouncement: true }),
    ).toBe(false)
  })

  it('clan space: an officer can post announcements', () => {
    expect(
      canPost({ kind: 'clan', signedIn: true, clanRole: 'officer', isAnnouncement: true }),
    ).toBe(true)
  })

  it('clan space: a non-member (no rank) cannot post at all', () => {
    expect(canPost({ kind: 'clan', signedIn: true, clanRole: null })).toBe(false)
  })
})

describe('chat — canManageChannels (create/delete channels)', () => {
  it('clan: officers+ can manage channels, plain members cannot', () => {
    expect(canManageChannels({ kind: 'clan', signedIn: true, clanRole: 'officer' })).toBe(true)
    expect(canManageChannels({ kind: 'clan', signedIn: true, clanRole: 'leader' })).toBe(true)
    expect(canManageChannels({ kind: 'clan', signedIn: true, clanRole: 'member' })).toBe(false)
    expect(canManageChannels({ kind: 'clan', signedIn: true, clanRole: 'recruiter' })).toBe(false)
  })

  it('open: only the owner (or staff) manages channels', () => {
    expect(canManageChannels({ kind: 'open', signedIn: true })).toBe(false)
    expect(canManageChannels({ kind: 'open', signedIn: true, isOwner: true })).toBe(true)
    expect(canManageChannels({ kind: 'open', signedIn: true, isStaff: true })).toBe(true)
  })

  it('tko: staff only', () => {
    expect(canManageChannels({ kind: 'tko', signedIn: true })).toBe(false)
    expect(canManageChannels({ kind: 'tko', signedIn: true, isStaff: true })).toBe(true)
  })

  it('canDeleteChannel mirrors canManageChannels', () => {
    expect(canDeleteChannel({ kind: 'clan', signedIn: true, clanRole: 'officer' })).toBe(true)
    expect(canDeleteChannel({ kind: 'clan', signedIn: true, clanRole: 'member' })).toBe(false)
  })
})

describe('chat — canDeleteSpace', () => {
  it('only the clan leader can delete a clan space', () => {
    expect(canDeleteSpace({ kind: 'clan', signedIn: true, clanRole: 'leader' })).toBe(true)
    expect(canDeleteSpace({ kind: 'clan', signedIn: true, clanRole: 'officer' })).toBe(false)
  })

  it('owner/staff delete an open space; staff delete a tko space', () => {
    expect(canDeleteSpace({ kind: 'open', signedIn: true, isOwner: true })).toBe(true)
    expect(canDeleteSpace({ kind: 'open', signedIn: true })).toBe(false)
    expect(canDeleteSpace({ kind: 'tko', signedIn: true, isStaff: true })).toBe(true)
    expect(canDeleteSpace({ kind: 'tko', signedIn: true })).toBe(false)
  })
})

describe('chat poll messages', () => {
  it('round-trips an opaque poll reference without treating normal text as a poll', () => {
    const encoded = encodeChatPoll('123e4567-e89b-12d3-a456-426614174000')
    expect(parseChatPoll(encoded)).toBe('123e4567-e89b-12d3-a456-426614174000')
    expect(parseChatPoll(`Look at ${encoded}`)).toBeNull()
    expect(parseChatPoll('[[tko-poll:v2:123]]')).toBeNull()
  })

  it('normalizes a valid poll draft', () => {
    expect(validateChatPoll('  Best map? ', [' Leaf ', '', 'Cloud'])).toEqual({
      draft: { question: 'Best map?', options: ['Leaf', 'Cloud'] },
      error: null,
    })
  })

  it('rejects too few, duplicate, and oversized options', () => {
    expect(validateChatPoll('Best map?', ['Leaf']).error).toContain('at least two')
    expect(validateChatPoll('Best map?', ['Leaf', ' leaf ']).error).toContain('different')
    expect(validateChatPoll('Best map?', ['x'.repeat(81), 'Cloud']).error).toContain('80')
  })
})
