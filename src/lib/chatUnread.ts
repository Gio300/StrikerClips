/**
 * chatUnread — unread counts and the "new messages" divider, as pure functions
 * over a message list plus a per-room read watermark.
 *
 * WHY A WATERMARK AND NOT A TABLE. None of the four message tables has a
 * read-receipt column and there is no chat DDL on the server's idempotent boot
 * path (server/ensureSchema.ts is the render pipeline only). A local, monotonic
 * "last read" timestamp per room needs no migration, cannot desync two devices
 * into a wrong-looking DB, and degrades to "everything read" when storage is
 * unavailable — which is the safe failure for an unread badge.
 *
 * Messages the viewer wrote never count as unread, so sending never leaves you
 * with a badge on your own room.
 *
 * Storage is injected (KeyValueStore) so this module is testable with no DOM,
 * matching the DI style of entitlements.ts.
 */

/** The subset of a message row these helpers read — all four schemas satisfy it. */
export interface UnreadMessageLike {
  id: string
  created_at: string
  user_id?: string | null
}

/** Epoch ms for an ISO timestamp, or null when unparseable. */
function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/**
 * Messages newer than the watermark that the viewer did not write. An absent or
 * unparseable watermark means "no read history" → nothing is marked unread, so
 * a first visit never opens with a full-room badge.
 */
export function unreadMessages<T extends UnreadMessageLike>(
  messages: readonly T[],
  lastReadIso: string | null | undefined,
  selfId?: string | null,
): T[] {
  const mark = timeOf(lastReadIso)
  if (mark === null) return []
  return messages.filter((m) => {
    if (selfId && m.user_id === selfId) return false
    const t = timeOf(m.created_at)
    return t !== null && t > mark
  })
}

/** How many messages are unread for this viewer. */
export function unreadCount(
  messages: readonly UnreadMessageLike[],
  lastReadIso: string | null | undefined,
  selfId?: string | null,
): number {
  return unreadMessages(messages, lastReadIso, selfId).length
}

/**
 * The id of the message the "new messages" divider renders ABOVE, or null when
 * there is nothing new. This is the FIRST unread message in list order — the
 * divider is drawn once, not per message.
 */
export function firstUnreadId(
  messages: readonly UnreadMessageLike[],
  lastReadIso: string | null | undefined,
  selfId?: string | null,
): string | null {
  const mark = timeOf(lastReadIso)
  if (mark === null) return null
  for (const m of messages) {
    if (selfId && m.user_id === selfId) continue
    const t = timeOf(m.created_at)
    if (t !== null && t > mark) return m.id
  }
  return null
}

/** The newest created_at in a list (the watermark to store), or null. */
export function latestTimestamp(messages: readonly UnreadMessageLike[]): string | null {
  let bestIso: string | null = null
  let bestMs = -Infinity
  for (const m of messages) {
    const t = timeOf(m.created_at)
    if (t !== null && t > bestMs) {
      bestMs = t
      bestIso = m.created_at
    }
  }
  return bestIso
}

/** Badge text for an unread count — capped so a long backlog can't stretch a tab. */
export function unreadBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null
  return count > 99 ? '99+' : String(count)
}

// ───────────────────────────────────────────────────────────────────────────
//  Watermark storage
// ───────────────────────────────────────────────────────────────────────────

export const CHAT_READ_KEY_PREFIX = 'tko.chat.read.'

/** The storage key for a room's read watermark. */
export function readKey(roomKey: string): string {
  return `${CHAT_READ_KEY_PREFIX}${roomKey}`
}

/** The tiny slice of Storage these helpers need (localStorage satisfies it). */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** The stored watermark for a room, or null when absent/unusable. */
export function loadLastRead(store: KeyValueStore | null, roomKey: string): string | null {
  if (!store) return null
  try {
    const raw = store.getItem(readKey(roomKey))
    return timeOf(raw) === null ? null : raw
  } catch {
    return null
  }
}

/**
 * Persist a room's watermark. MONOTONIC: an older timestamp is ignored, so a
 * stale render or an out-of-order poll can never resurrect messages the user
 * has already read. Returns the watermark now in effect.
 */
export function saveLastRead(
  store: KeyValueStore | null,
  roomKey: string,
  iso: string | null | undefined,
): string | null {
  const next = timeOf(iso)
  if (next === null) return loadLastRead(store, roomKey)
  const current = loadLastRead(store, roomKey)
  const currentMs = timeOf(current)
  if (currentMs !== null && currentMs >= next) return current
  if (!store) return current
  try {
    store.setItem(readKey(roomKey), iso as string)
    return iso as string
  } catch {
    // Private mode / quota — unread simply stops persisting. Never throw into a
    // chat render.
    return current
  }
}

/**
 * localStorage when it is usable, else null. Wrapped because Safari private
 * mode throws on access and an unread badge must never break a chat panel.
 */
export function browserStore(): KeyValueStore | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}
