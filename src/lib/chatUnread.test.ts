import { describe, it, expect } from 'vitest'
import {
  firstUnreadId,
  latestTimestamp,
  loadLastRead,
  readKey,
  saveLastRead,
  unreadBadge,
  unreadCount,
  unreadMessages,
  type KeyValueStore,
} from './chatUnread'

const T = (minute: number) => new Date(Date.UTC(2026, 7, 4, 12, minute, 0)).toISOString()

const messages = [
  { id: 'm1', created_at: T(0), user_id: 'them' },
  { id: 'm2', created_at: T(1), user_id: 'me' },
  { id: 'm3', created_at: T(2), user_id: 'them' },
  { id: 'm4', created_at: T(3), user_id: 'them' },
]

function memoryStore(seed: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...seed }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v },
  }
}

describe('unread counting', () => {
  it('counts only messages after the watermark', () => {
    expect(unreadCount(messages, T(1))).toBe(2)
    expect(unreadMessages(messages, T(1)).map((m) => m.id)).toEqual(['m3', 'm4'])
  })

  it('never counts the viewer’s own messages', () => {
    // From T(0): m2 (mine), m3, m4 are newer. As 'me' only m3+m4 count…
    expect(unreadCount(messages, T(0), 'me')).toBe(2)
    // …and as 'them' only m2 does.
    expect(unreadCount(messages, T(0), 'them')).toBe(1)
    // With no viewer id, authorship is not considered at all.
    expect(unreadCount(messages, T(0))).toBe(3)
  })

  it('treats a room with no read history as fully read', () => {
    // A first visit must not open with a badge over the whole backlog.
    expect(unreadCount(messages, null)).toBe(0)
    expect(unreadCount(messages, undefined)).toBe(0)
    expect(unreadCount(messages, 'not-a-date')).toBe(0)
    expect(firstUnreadId(messages, null)).toBeNull()
  })

  it('is zero when the watermark is current', () => {
    expect(unreadCount(messages, T(3))).toBe(0)
    expect(firstUnreadId(messages, T(3))).toBeNull()
  })

  it('ignores rows with an unparseable timestamp instead of throwing', () => {
    const dirty = [...messages, { id: 'bad', created_at: 'nope', user_id: 'them' }]
    expect(unreadCount(dirty, T(1))).toBe(2)
  })
})

describe('the new-messages divider', () => {
  it('anchors to the FIRST unread message, not the last', () => {
    expect(firstUnreadId(messages, T(1))).toBe('m3')
  })

  it('skips the viewer’s own message when choosing the anchor', () => {
    // As 'me', m2 is mine and is skipped — the divider lands on m3.
    expect(firstUnreadId(messages, T(0), 'me')).toBe('m3')
    // As 'them', m3/m4 are theirs and skipped — the divider lands on m2.
    expect(firstUnreadId(messages, T(0), 'them')).toBe('m2')
  })
})

describe('watermarks', () => {
  it('finds the newest timestamp regardless of list order', () => {
    expect(latestTimestamp(messages)).toBe(T(3))
    expect(latestTimestamp([...messages].reverse())).toBe(T(3))
    expect(latestTimestamp([])).toBeNull()
  })

  it('round-trips through storage under a namespaced key', () => {
    const store = memoryStore()
    saveLastRead(store, 'stream:s1', T(2))
    expect(store.data[readKey('stream:s1')]).toBe(T(2))
    expect(loadLastRead(store, 'stream:s1')).toBe(T(2))
  })

  it('is MONOTONIC — a stale write can never resurrect read messages', () => {
    const store = memoryStore()
    saveLastRead(store, 'dm:d1', T(3))
    expect(saveLastRead(store, 'dm:d1', T(1))).toBe(T(3))
    expect(loadLastRead(store, 'dm:d1')).toBe(T(3))
  })

  it('keeps rooms independent', () => {
    const store = memoryStore()
    saveLastRead(store, 'dm:d1', T(3))
    expect(loadLastRead(store, 'dm:d2')).toBeNull()
  })

  it('degrades to "everything read" with no usable storage', () => {
    expect(loadLastRead(null, 'stream:s1')).toBeNull()
    expect(saveLastRead(null, 'stream:s1', T(1))).toBeNull()
  })

  it('survives a storage that throws (Safari private mode) without breaking chat', () => {
    const hostile: KeyValueStore = {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('quota') },
    }
    expect(loadLastRead(hostile, 'stream:s1')).toBeNull()
    expect(() => saveLastRead(hostile, 'stream:s1', T(1))).not.toThrow()
  })

  it('ignores a garbage stored value rather than trusting it', () => {
    const store = memoryStore({ [readKey('stream:s1')]: 'garbage' })
    expect(loadLastRead(store, 'stream:s1')).toBeNull()
  })
})

describe('badges', () => {
  it('caps at 99+ and hides at zero', () => {
    expect(unreadBadge(0)).toBeNull()
    expect(unreadBadge(-3)).toBeNull()
    expect(unreadBadge(7)).toBe('7')
    expect(unreadBadge(99)).toBe('99')
    expect(unreadBadge(1_000)).toBe('99+')
  })
})
