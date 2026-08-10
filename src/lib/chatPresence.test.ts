import { describe, it, expect } from 'vitest'
import {
  PRESENCE_ONLINE_MS,
  PRESENCE_AWAY_MS,
  TYPING_PING_MIN_GAP_MS,
  activeTypers,
  chatRoomKey,
  lastSeenLabel,
  onlineCount,
  onlineCountLabel,
  presenceStatus,
  shouldPingTyping,
  sortMembers,
  typingLabel,
  typingLine,
  type PresenceMember,
} from './chatPresence'

const NOW = 1_800_000_000_000

function member(over: Partial<PresenceMember> & { userId: string }): PresenceMember {
  return {
    username: over.userId,
    avatarUrl: null,
    lastSeen: NOW,
    typingUntil: 0,
    ...over,
  }
}

describe('chat room keys', () => {
  it('accepts the four real chat scopes and rejects anything else', () => {
    expect(chatRoomKey('stream', 'abc')).toBe('stream:abc')
    expect(chatRoomKey('tournament', 'abc')).toBe('tournament:abc')
    expect(chatRoomKey('channel', 'abc')).toBe('channel:abc')
    expect(chatRoomKey('dm', 'abc')).toBe('dm:abc')
    expect(chatRoomKey('reels', 'abc')).toBeNull()
    expect(chatRoomKey('', 'abc')).toBeNull()
  })

  it('refuses ids that are empty, oversized, or not id-shaped', () => {
    expect(chatRoomKey('stream', '')).toBeNull()
    expect(chatRoomKey('stream', '   ')).toBeNull()
    expect(chatRoomKey('stream', 'a'.repeat(129))).toBeNull()
    expect(chatRoomKey('stream', 'drop table;')).toBeNull()
    expect(chatRoomKey('stream', 'a b')).toBeNull()
  })
})

describe('presence status', () => {
  it('ages a member from online through away to offline', () => {
    expect(presenceStatus(member({ userId: 'a', lastSeen: NOW }), NOW)).toBe('online')
    expect(presenceStatus(member({ userId: 'a', lastSeen: NOW - PRESENCE_ONLINE_MS }), NOW)).toBe('online')
    expect(presenceStatus(member({ userId: 'a', lastSeen: NOW - PRESENCE_ONLINE_MS - 1 }), NOW)).toBe('away')
    expect(presenceStatus(member({ userId: 'a', lastSeen: NOW - PRESENCE_AWAY_MS - 1 }), NOW)).toBe('offline')
  })

  it('never punishes a member for client clock skew', () => {
    expect(presenceStatus(member({ userId: 'a', lastSeen: NOW + 60_000 }), NOW)).toBe('online')
  })

  it('counts and labels only the online members', () => {
    const members = [
      member({ userId: 'a' }),
      member({ userId: 'b' }),
      member({ userId: 'c', lastSeen: NOW - PRESENCE_AWAY_MS - 1 }),
    ]
    expect(onlineCount(members, NOW)).toBe(2)
    expect(onlineCountLabel(members, NOW)).toBe('2 online')
  })

  it('has no label when nobody is online, so the strip renders nothing', () => {
    const stale = [member({ userId: 'a', lastSeen: NOW - PRESENCE_AWAY_MS - 1 })]
    expect(onlineCountLabel(stale, NOW)).toBeNull()
    expect(onlineCountLabel([], NOW)).toBeNull()
  })

  it('orders online first, then away, then offline, alphabetically inside each', () => {
    const members = [
      member({ userId: 'z', username: 'zed' }),
      member({ userId: 'o', username: 'old', lastSeen: NOW - PRESENCE_AWAY_MS - 1 }),
      member({ userId: 'a', username: 'ann' }),
      member({ userId: 'w', username: 'wes', lastSeen: NOW - PRESENCE_ONLINE_MS - 1 }),
    ]
    expect(sortMembers(members, NOW).map((m) => m.username)).toEqual(['ann', 'zed', 'wes', 'old'])
  })
})

describe('last seen labels', () => {
  it('reads coarsely — never a precise timestamp for another player', () => {
    expect(lastSeenLabel(member({ userId: 'a' }), NOW)).toBe('Online')
    expect(lastSeenLabel(member({ userId: 'a', lastSeen: NOW - 90_000 }), NOW)).toBe('Active 1m ago')
    expect(lastSeenLabel(member({ userId: 'a', lastSeen: NOW - 3 * 3_600_000 }), NOW)).toBe('Active 3h ago')
    expect(lastSeenLabel(member({ userId: 'a', lastSeen: NOW - 2 * 86_400_000 }), NOW)).toBe('Active 2d ago')
    expect(lastSeenLabel(member({ userId: 'a', lastSeen: NOW - 400 * 86_400_000 }), NOW)).toBe('Active a while ago')
  })
})

describe('typing indicators', () => {
  it('expires a typing flag on its own — a dead client cannot ghost forever', () => {
    const ghost = member({ userId: 'ghost', typingUntil: NOW - 1 })
    expect(activeTypers([ghost], NOW)).toEqual([])
    expect(typingLine([ghost], NOW)).toBeNull()
  })

  it('never tells the viewer that they are typing', () => {
    const me = member({ userId: 'me', typingUntil: NOW + 5_000 })
    const them = member({ userId: 'them', username: 'Ray', typingUntil: NOW + 5_000 })
    expect(activeTypers([me, them], NOW, 'me').map((m) => m.userId)).toEqual(['them'])
    expect(typingLine([me, them], NOW, 'me')).toBe('Ray is typing…')
  })

  it('phrases one, two and many typists', () => {
    expect(typingLabel([])).toBeNull()
    expect(typingLabel(['Gio'])).toBe('Gio is typing…')
    expect(typingLabel(['Gio', 'Ray'])).toBe('Gio and Ray are typing…')
    expect(typingLabel(['Gio', 'Ray', 'Sam'])).toBe('Gio, Ray and 1 other are typing…')
    expect(typingLabel(['Gio', 'Ray', 'Sam', 'Tao', 'Uma'])).toBe('Gio, Ray and 3 others are typing…')
  })

  it('drops blank names rather than rendering "  is typing"', () => {
    expect(typingLabel(['', '   '])).toBeNull()
    expect(typingLabel(['Gio', ''])).toBe('Gio is typing…')
  })

  it('falls back to a neutral name when a profile has no username', () => {
    const anon = member({ userId: 'x', username: null, typingUntil: NOW + 1_000 })
    expect(typingLine([anon], NOW)).toBe('someone is typing…')
  })
})

describe('typing debounce', () => {
  it('always allows the first ping', () => {
    expect(shouldPingTyping(null, NOW)).toBe(true)
  })

  it('holds pings inside the gap and releases after it', () => {
    expect(shouldPingTyping(NOW, NOW + TYPING_PING_MIN_GAP_MS - 1)).toBe(false)
    expect(shouldPingTyping(NOW, NOW + TYPING_PING_MIN_GAP_MS)).toBe(true)
  })
})
