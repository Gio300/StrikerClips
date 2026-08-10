/**
 * chatPresence — the pure, DOM-free core of the chat "live feel" layer:
 * presence (online / away / offline + last seen) and typing indicators.
 *
 * WHY THIS SHAPE. Chat in this app has no push transport: `supabase.channel()`
 * resolves to a no-op stub in production (src/lib/realSupabase.ts), so every
 * chat surface is really "fetch once + optimistic append". Presence and typing
 * are therefore carried on a POLL (the `chat-presence` fn), following the
 * discipline already used by Notifications.tsx — a visibility-gated interval.
 * No WebSocket, no new dependency, no second transport to operate.
 *
 * EVERYTHING HERE IS EPHEMERAL BY CONSTRUCTION. A member is "online" only while
 * their heartbeat is fresh, and a typing flag carries its own expiry instant
 * (`typingUntil`) rather than a boolean — so a browser that is closed mid-keystroke
 * stops typing on its own within TYPING_TTL_MS. There is no "stop typing"
 * message to lose, which is the usual source of ghost indicators.
 *
 * Mirrors the pure shape of chat.ts / tiers.ts: no side effects, fully testable.
 */

// ───────────────────────────────────────────────────────────────────────────
//  Rooms
// ───────────────────────────────────────────────────────────────────────────

/**
 * The four persistent chat surfaces, each with its own message table:
 *   - `stream`     → stream_messages     (live / stage / merged panes)
 *   - `tournament` → tournament_messages (a tournament's room)
 *   - `channel`    → chat_messages       (Space → Channel, /chat)
 *   - `dm`         → dm_messages         (/messages)
 * KEEP IN SYNC with CHAT_SCOPES in server/chatPresence.ts.
 */
export type ChatScope = 'stream' | 'tournament' | 'channel' | 'dm'

export const CHAT_SCOPES: ChatScope[] = ['stream', 'tournament', 'channel', 'dm']

/** Room ids are ids, not free text — keeps the server's key space bounded. */
const ROOM_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

/**
 * The presence room key for a surface, or null when the scope/id is unusable.
 * Null is a normal outcome (a chat panel can mount before its id resolves) and
 * simply means "no presence for this render".
 */
export function chatRoomKey(scope: string, roomId: string): string | null {
  if (!CHAT_SCOPES.includes(scope as ChatScope)) return null
  const id = (roomId ?? '').trim()
  if (!ROOM_ID_PATTERN.test(id)) return null
  return `${scope}:${id}`
}

// ───────────────────────────────────────────────────────────────────────────
//  Cadences
// ───────────────────────────────────────────────────────────────────────────

/**
 * How often a mounted chat surface polls presence. 10s matches the middle of
 * the app's existing polling band (Oracle 4s … Notifications 15s) and is the
 * heartbeat too — one request does both directions.
 */
export const PRESENCE_POLL_MS = 10_000

/** A heartbeat newer than this reads as online. Must exceed PRESENCE_POLL_MS. */
export const PRESENCE_ONLINE_MS = 30_000

/** Between online and this, a member reads as "away" rather than gone. */
export const PRESENCE_AWAY_MS = 5 * 60_000

/**
 * How long one typing ping stays live. Deliberately longer than the ping gap
 * below (so continuous typing never flickers) and short enough that a dropped
 * client clears within a couple of seconds of the poll that follows.
 */
export const TYPING_TTL_MS = 6_000

/**
 * The minimum gap between typing pings — the debounce. A user hammering the
 * keyboard sends at most one flag per 2.5s, not one per keystroke.
 */
export const TYPING_PING_MIN_GAP_MS = 2_500

// ───────────────────────────────────────────────────────────────────────────
//  Members
// ───────────────────────────────────────────────────────────────────────────

/** One member of a presence snapshot, as the `chat-presence` fn returns them. */
export interface PresenceMember {
  userId: string
  username: string | null
  avatarUrl: string | null
  /** Epoch ms of this member's last heartbeat. */
  lastSeen: number
  /** Epoch ms until which this member counts as typing (0 = not typing). */
  typingUntil: number
}

export type PresenceStatus = 'online' | 'away' | 'offline'

/** Resolve a member's status from heartbeat freshness alone. */
export function presenceStatus(member: PresenceMember, now: number): PresenceStatus {
  const age = now - (member.lastSeen || 0)
  if (age < 0) return 'online' // clock skew — never punish the member for it
  if (age <= PRESENCE_ONLINE_MS) return 'online'
  if (age <= PRESENCE_AWAY_MS) return 'away'
  return 'offline'
}

/** Members currently online, in the order given. */
export function onlineMembers(members: readonly PresenceMember[], now: number): PresenceMember[] {
  return members.filter((m) => presenceStatus(m, now) === 'online')
}

/** How many members are online right now. */
export function onlineCount(members: readonly PresenceMember[], now: number): number {
  return onlineMembers(members, now).length
}

/**
 * Members actively typing, excluding the viewer (nobody needs to be told they
 * are typing). Expiry is evaluated here, so a stale snapshot degrades to "not
 * typing" rather than to a ghost.
 */
export function activeTypers(
  members: readonly PresenceMember[],
  now: number,
  selfId?: string | null,
): PresenceMember[] {
  return members.filter((m) => m.userId !== selfId && (m.typingUntil || 0) > now)
}

/** Display name for a member — username, else a short, stable fallback. */
export function memberName(member: PresenceMember): string {
  const name = (member.username ?? '').trim()
  return name || 'someone'
}

/**
 * "Gio is typing…" / "Gio and Ray are typing…" / "Gio, Ray and 3 others are
 * typing…". Returns null when nobody is typing, so the caller renders nothing.
 */
export function typingLabel(names: readonly string[]): string | null {
  const list = names.map((n) => (n ?? '').trim()).filter(Boolean)
  if (list.length === 0) return null
  if (list.length === 1) return `${list[0]} is typing…`
  if (list.length === 2) return `${list[0]} and ${list[1]} are typing…`
  const others = list.length - 2
  return `${list[0]}, ${list[1]} and ${others} ${others === 1 ? 'other' : 'others'} are typing…`
}

/** Convenience: the typing line for a raw member snapshot. */
export function typingLine(
  members: readonly PresenceMember[],
  now: number,
  selfId?: string | null,
): string | null {
  return typingLabel(activeTypers(members, now, selfId).map(memberName))
}

/**
 * "Online" / "Active 5m ago" / "Active 2d ago". Coarse on purpose — chat
 * presence is a social signal, not a surveillance feed, so we never render a
 * precise timestamp for another player.
 */
export function lastSeenLabel(member: PresenceMember, now: number): string {
  const status = presenceStatus(member, now)
  if (status === 'online') return 'Online'
  const age = Math.max(0, now - (member.lastSeen || 0))
  const minutes = Math.floor(age / 60_000)
  if (minutes < 1) return 'Active just now'
  if (minutes < 60) return `Active ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Active ${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days <= 30) return `Active ${days}d ago`
  return 'Active a while ago'
}

/** Online first, then away, then offline; each block alphabetical by name. */
export function sortMembers(members: readonly PresenceMember[], now: number): PresenceMember[] {
  const rank: Record<PresenceStatus, number> = { online: 0, away: 1, offline: 2 }
  return [...members].sort((a, b) => {
    const ra = rank[presenceStatus(a, now)]
    const rb = rank[presenceStatus(b, now)]
    if (ra !== rb) return ra - rb
    return memberName(a).localeCompare(memberName(b))
  })
}

// ───────────────────────────────────────────────────────────────────────────
//  Typing debounce
// ───────────────────────────────────────────────────────────────────────────

/**
 * Should we spend a request on a typing ping? True when we have never pinged,
 * or the last ping is older than the debounce gap. Pure so the hook stays a
 * thin wrapper and the cadence is unit-testable.
 */
export function shouldPingTyping(lastPingAt: number | null, now: number): boolean {
  if (lastPingAt === null || !Number.isFinite(lastPingAt)) return true
  return now - lastPingAt >= TYPING_PING_MIN_GAP_MS
}

/** "N online" for a room header; null when we have no snapshot yet. */
export function onlineCountLabel(members: readonly PresenceMember[], now: number): string | null {
  if (members.length === 0) return null
  const n = onlineCount(members, now)
  if (n <= 0) return null
  return `${n} online`
}
