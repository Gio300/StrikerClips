import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { callFn } from '@/lib/backend'
import {
  PRESENCE_POLL_MS,
  chatRoomKey,
  onlineCount,
  shouldPingTyping,
  typingLine,
  type ChatScope,
  type PresenceMember,
} from '@/lib/chatPresence'

/**
 * useChatPresence — the ONE presence/typing client every chat surface consumes.
 *
 * Four surfaces share this chat (live, stage/merged, tournament, channel/DM); a
 * shared hook is the difference between one cadence to reason about and four
 * that drift. Surfaces get `members`, a ready-made typing line, and a
 * `notifyTyping()` to call from their composer's onChange — nothing else.
 *
 * TRANSPORT: polling, deliberately. Production chat has no push transport
 * (`supabase.channel()` is a no-op stub), so this follows the most disciplined
 * polling idiom already in the repo — Notifications.tsx: a visibility-gated
 * interval that also refreshes the moment the tab comes back, and cleans up on
 * unmount. One request per tick carries the heartbeat UP and the roster DOWN.
 *
 * DEGRADES TO NOTHING. If the backend is unreachable, the fn is missing, or the
 * viewer is signed out, `supported` goes false and every consumer renders no
 * presence UI at all. Chat itself is untouched in every one of those cases.
 */

interface PresenceResponse {
  ok?: boolean
  now?: number
  members?: PresenceMember[]
  rateLimited?: boolean
}

export interface ChatPresence {
  /** Live roster (empty until the first successful poll). */
  members: PresenceMember[]
  /** "Gio is typing…" — already excludes the viewer. Null when nobody is. */
  typingLine: string | null
  /** How many members are online right now. */
  onlineCount: number
  /** True once presence has answered at least once. Gate your UI on this. */
  supported: boolean
  /** Call from the composer's onChange. Debounced internally — spam it freely. */
  notifyTyping: () => void
}

/**
 * How many mounted panes are watching each room, keyed by room + viewer.
 *
 * Live.tsx renders StreamChat in more than one place and MergedStreamChat
 * stacks panes, so the same room can be mounted twice. Without this, unmounting
 * ONE pane would send `leaving` and evict the viewer from presence while the
 * other pane is still open — they would blink out of the roster until the next
 * poll. The explicit leave is only sent when the LAST pane goes away; the
 * server's TTL is the backstop either way.
 */
const watchers = new Map<string, number>()

const INERT: ChatPresence = {
  members: [],
  typingLine: null,
  onlineCount: 0,
  supported: false,
  notifyTyping: () => {},
}

export function useChatPresence(options: {
  scope: ChatScope
  roomId: string | null | undefined
  /** The viewer — presence needs an authenticated caller. */
  userId: string | null | undefined
  /** Set false to keep the room mounted but silent (e.g. a hidden pane). */
  enabled?: boolean
}): ChatPresence {
  const { scope, roomId, userId, enabled = true } = options
  const roomKey = roomId ? chatRoomKey(scope, roomId) : null
  const active = Boolean(enabled && userId && roomKey)

  const [members, setMembers] = useState<PresenceMember[]>([])
  const [supported, setSupported] = useState(false)
  // Ticks once a second so typing decays visibly between polls rather than
  // snapping at the next 10s boundary.
  const [tick, setTick] = useState(() => Date.now())

  // Latest typing intent, read by the poll. A ref (not state) so keystrokes
  // never re-render the whole chat panel.
  const typingRef = useRef(false)
  const lastTypingPingRef = useRef<number | null>(null)

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      if (!roomKey || !roomId || !userId) return null
      return callFn<PresenceResponse>('chat-presence', { scope, roomId, ...body })
    },
    [roomKey, roomId, userId, scope],
  )

  useEffect(() => {
    if (!active) {
      setMembers([])
      setSupported(false)
      return
    }
    let cancelled = false
    const watchKey = `${roomKey}|${userId}`
    watchers.set(watchKey, (watchers.get(watchKey) ?? 0) + 1)

    const beat = async () => {
      if (cancelled) return
      const typing = typingRef.current
      typingRef.current = false
      const res = await post({ typing })
      if (cancelled) return
      if (!res || res.ok !== true) {
        // A rate-limited or unavailable presence call is NOT an error state —
        // hold the last roster and try again next tick.
        if (!res) setSupported(false)
        return
      }
      setSupported(true)
      setMembers(Array.isArray(res.members) ? res.members : [])
    }

    void beat()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void beat()
    }, PRESENCE_POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void beat()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      const left = (watchers.get(watchKey) ?? 1) - 1
      if (left > 0) {
        watchers.set(watchKey, left)
        return // another pane still has this room open
      }
      watchers.delete(watchKey)
      // Best-effort clean exit. If it never lands, the server's TTL removes us
      // anyway — that is the whole point of expiring presence.
      void post({ leaving: true })
    }
  }, [active, post])

  // Local clock for typing decay. Only runs while there is a roster to decay.
  useEffect(() => {
    if (!active || members.length === 0) return
    const timer = window.setInterval(() => setTick(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [active, members.length])

  const notifyTyping = useCallback(() => {
    if (!active) return
    const now = Date.now()
    typingRef.current = true
    // Debounced: at most one ping per TYPING_PING_MIN_GAP_MS regardless of how
    // fast the user types. Between pings the flag simply rides the next poll.
    if (!shouldPingTyping(lastTypingPingRef.current, now)) return
    lastTypingPingRef.current = now
    typingRef.current = false
    void post({ typing: true }).then((res) => {
      if (res && res.ok === true && Array.isArray(res.members)) setMembers(res.members)
    })
  }, [active, post])

  return useMemo(() => {
    if (!active) return INERT
    return {
      members,
      typingLine: typingLine(members, tick, userId ?? null),
      onlineCount: onlineCount(members, tick),
      supported,
      notifyTyping,
    }
  }, [active, members, tick, userId, supported, notifyTyping])
}
