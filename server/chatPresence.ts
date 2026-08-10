/**
 * chatPresence (server) — the in-memory presence + typing registry behind the
 * `chat-presence` fn.
 *
 * WHY IN MEMORY AND NOT A TABLE. Presence is worthless the moment it is stale,
 * so persisting it buys nothing and costs a migration this codebase cannot ride:
 * server/ensureSchema.ts is the render pipeline only and carries no chat DDL, so
 * a presence table would need an operator-run `psql -f`. This registry follows
 * the shape already used for the League Studio chat limiter in server/app.ts —
 * a per-instance Map, matching this API's single-instance Cloud Run deployment.
 *
 * GHOST-PROOF BY CONSTRUCTION. Nothing here is cleared by a client message:
 *   • a member exists only while their last heartbeat is inside PRESENCE_TTL_MS;
 *   • typing is stored as an EXPIRY INSTANT (`typingUntil`), not a boolean.
 * A browser killed mid-keystroke therefore stops typing within TYPING_TTL_MS and
 * disappears within PRESENCE_TTL_MS, with no "stop" message to lose. Expiry is
 * evaluated lazily on read/write — no timers, so nothing keeps the process warm
 * and nothing leaks if a room is never visited again.
 *
 * BOUNDED. Rooms and members are both capped, and the caps evict rather than
 * grow, so a hostile client cannot turn presence into unbounded memory.
 *
 * Pure logic, no Express and no pool: unit-testable on its own.
 */

/** KEEP IN SYNC with ChatScope in src/lib/chatPresence.ts. */
export const CHAT_SCOPES = ['stream', 'tournament', 'channel', 'dm'] as const
export type ChatScope = (typeof CHAT_SCOPES)[number]

/** A heartbeat older than this drops the member from the room entirely. */
export const PRESENCE_TTL_MS = 45_000

/** How long one typing ping stays live. */
export const TYPING_TTL_MS = 6_000

/** Members tracked per room. Beyond this, late arrivals are simply not tracked. */
export const MAX_MEMBERS_PER_ROOM = 200

/** Rooms tracked per instance. At the cap the coldest room is evicted. */
export const MAX_ROOMS = 2_000

/** Per-user call budget for the presence fn (poll is 10s → ~6/min per room). */
export const PRESENCE_WINDOW_MS = 60_000
export const PRESENCE_MAX_CALLS_PER_WINDOW = 60

const ROOM_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

/**
 * The room key for a scope + id, or null when either is unusable. Validating
 * here is what keeps the key space bounded — a client cannot invent room names.
 */
export function chatRoomKey(scope: string, roomId: string): string | null {
  if (!(CHAT_SCOPES as readonly string[]).includes(scope)) return null
  const id = (roomId ?? '').trim()
  if (!ROOM_ID_PATTERN.test(id)) return null
  return `${scope}:${id}`
}

/** One tracked member. `typingUntil` is an epoch-ms instant, 0 = not typing. */
export interface PresenceEntry {
  userId: string
  lastSeen: number
  typingUntil: number
}

export class ChatPresenceRegistry {
  private rooms = new Map<string, Map<string, PresenceEntry>>()

  /**
   * Record a heartbeat, optionally flagging the member as typing. A typing ping
   * EXTENDS the flag; an ordinary heartbeat leaves whatever expiry is already
   * set, so a member who stops typing decays instead of needing a "stop".
   */
  touch(roomKey: string, userId: string, options: { typing?: boolean } = {}, now: number): void {
    if (!roomKey || !userId) return
    let room = this.rooms.get(roomKey)
    if (!room) {
      if (this.rooms.size >= MAX_ROOMS) {
        this.sweep(now)
        if (this.rooms.size >= MAX_ROOMS) this.evictColdestRoom()
      }
      room = new Map()
      this.rooms.set(roomKey, room)
    }

    const existing = room.get(userId)
    if (!existing && room.size >= MAX_MEMBERS_PER_ROOM) {
      this.sweepRoom(roomKey, room, now)
      // Still full — track nothing rather than grow. Presence degrades; chat
      // is untouched.
      if (room.size >= MAX_MEMBERS_PER_ROOM) return
    }

    const typingUntil = options.typing
      ? now + TYPING_TTL_MS
      : existing?.typingUntil ?? 0
    room.set(userId, { userId, lastSeen: now, typingUntil })
    // Re-attach unconditionally: sweepRoom() DETACHES a room it empties, so a
    // newcomer arriving after the whole crowd went stale would otherwise be
    // written into an orphaned Map and vanish. Cheap, and it makes the order of
    // sweep-then-write impossible to get wrong later.
    this.rooms.set(roomKey, room)
  }

  /** Explicit departure (tab closed cleanly). Best-effort — TTL covers the rest. */
  leave(roomKey: string, userId: string): void {
    const room = this.rooms.get(roomKey)
    if (!room) return
    room.delete(userId)
    if (room.size === 0) this.rooms.delete(roomKey)
  }

  /**
   * The room's live members, expired entries dropped. Typing expiry is NOT
   * applied here — the instant is returned as-is so the client can render the
   * decay smoothly between polls.
   */
  members(roomKey: string, now: number): PresenceEntry[] {
    const room = this.rooms.get(roomKey)
    if (!room) return []
    this.sweepRoom(roomKey, room, now)
    return [...room.values()].sort((a, b) => b.lastSeen - a.lastSeen)
  }

  /** How many rooms are currently tracked (diagnostics + tests). */
  roomCount(): number {
    return this.rooms.size
  }

  /** Drop every expired member across every room, and every emptied room. */
  sweep(now: number): void {
    for (const [key, room] of [...this.rooms.entries()]) {
      this.sweepRoom(key, room, now)
    }
  }

  private sweepRoom(roomKey: string, room: Map<string, PresenceEntry>, now: number): void {
    const cutoff = now - PRESENCE_TTL_MS
    for (const [userId, entry] of [...room.entries()]) {
      if (entry.lastSeen < cutoff) room.delete(userId)
    }
    if (room.size === 0) this.rooms.delete(roomKey)
  }

  /** Evict the room whose most recent heartbeat is oldest. */
  private evictColdestRoom(): void {
    let coldestKey: string | null = null
    let coldestSeen = Infinity
    for (const [key, room] of this.rooms.entries()) {
      let newest = 0
      for (const entry of room.values()) if (entry.lastSeen > newest) newest = entry.lastSeen
      if (newest < coldestSeen) {
        coldestSeen = newest
        coldestKey = key
      }
    }
    if (coldestKey !== null) this.rooms.delete(coldestKey)
  }
}

/**
 * Sliding-window limiter shared by the presence and `ask` fns. Returns the
 * decision plus how long to wait, and MUTATES `hits` in place on allow — the
 * same pattern the League Studio chat limiter uses inline, lifted here so both
 * call sites and the tests agree.
 */
export function slidingWindowAllow(
  hits: number[],
  now: number,
  windowMs: number,
  maxPerWindow: number,
): { allowed: boolean; retryAfterMs: number; hits: number[] } {
  const live = hits.filter((t) => now - t < windowMs)
  if (live.length >= maxPerWindow) {
    const oldest = live[0] ?? now
    return { allowed: false, retryAfterMs: Math.max(0, windowMs - (now - oldest)), hits: live }
  }
  live.push(now)
  return { allowed: true, retryAfterMs: 0, hits: live }
}
