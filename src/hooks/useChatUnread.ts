import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chatRoomKey, type ChatScope } from '@/lib/chatPresence'
import {
  browserStore,
  firstUnreadId,
  latestTimestamp,
  loadLastRead,
  saveLastRead,
  unreadCount,
  type UnreadMessageLike,
} from '@/lib/chatUnread'

/**
 * useChatUnread — the shared unread watermark for every chat surface.
 *
 * TWO WATERMARKS, ON PURPOSE:
 *   • the STORED one advances as you read, and is what a later visit compares
 *     against;
 *   • the OPENING one is frozen the moment the room mounts, and is what the
 *     "New messages" divider and the count are computed from — so the divider
 *     stays put while you read instead of sliding away under the cursor.
 *
 * Your own messages never count as unread, and a room with no read history
 * starts fully read: a first visit should never open with a badge over the
 * entire backlog.
 *
 * Storage-free fallback: with no usable localStorage this degrades to "always
 * read" (no divider, no count) and nothing else changes.
 */
export interface ChatUnread {
  /** Draw the divider ABOVE this message id. Null when there is nothing new. */
  dividerBeforeId: string | null
  /** How many messages arrived since the room was last read. */
  count: number
  /** Advance the stored watermark to the newest message. Idempotent. */
  markRead: () => void
}

const EMPTY: ChatUnread = { dividerBeforeId: null, count: 0, markRead: () => {} }

export function useChatUnread(options: {
  scope: ChatScope
  roomId: string | null | undefined
  userId: string | null | undefined
  messages: readonly UnreadMessageLike[]
  /** False while the panel is hidden — stops it silently marking things read. */
  active?: boolean
}): ChatUnread {
  const { scope, roomId, userId, messages, active = true } = options
  const roomKey = roomId ? chatRoomKey(scope, roomId) : null

  const store = useMemo(() => browserStore(), [])
  // The watermark as it stood when this room opened. Frozen for the lifetime of
  // the room so the divider is a stable landmark.
  const [openingMark, setOpeningMark] = useState<string | null>(null)
  const openedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!roomKey) {
      openedFor.current = null
      setOpeningMark(null)
      return
    }
    if (openedFor.current === roomKey) return
    openedFor.current = roomKey
    setOpeningMark(loadLastRead(store, roomKey))
  }, [roomKey, store])

  const markRead = useCallback(() => {
    if (!roomKey) return
    const newest = latestTimestamp(messages)
    if (newest) saveLastRead(store, roomKey, newest)
  }, [roomKey, store, messages])

  // Reading is "the panel is mounted, active, and the tab is in front". Chat
  // panels pin themselves to the bottom on new messages, so a visible panel is
  // a read panel — matching how the app already treats notifications.
  useEffect(() => {
    if (!active || !roomKey || messages.length === 0) return
    const flush = () => {
      if (document.visibilityState === 'visible') markRead()
    }
    // Small delay so a message that lands the instant you navigate away is not
    // counted as read.
    const timer = window.setTimeout(flush, 1_200)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', flush)
    }
  }, [active, roomKey, messages, markRead])

  return useMemo(() => {
    if (!roomKey) return EMPTY
    return {
      dividerBeforeId: firstUnreadId(messages, openingMark, userId ?? null),
      count: unreadCount(messages, openingMark, userId ?? null),
      markRead,
    }
  }, [roomKey, messages, openingMark, userId, markRead])
}
