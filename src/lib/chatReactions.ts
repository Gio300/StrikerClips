/**
 * chatReactions — pure aggregation for tap-to-react, shared by all four chat
 * surfaces (see the `chat_reactions` table in server/ensureSchema.ts).
 *
 * One row per (surface, message, user, emoji); the UI wants the opposite shape —
 * one chip per emoji with a count and whether YOU are in it. That fold is the
 * whole of this module, plus the emoji validation that keeps the column from
 * becoming a free-text field somebody stuffs a paragraph (or markup) into.
 *
 * Pure and DOM-free, mirroring lib/chat.ts. `applyLocalToggle` exists so the UI
 * can flip a chip optimistically and reconcile with the server later without
 * duplicating the fold.
 */

import { CHAT_SCOPES, type ChatScope } from './chatPresence'

/**
 * The four message tables a reaction can attach to. This is deliberately the
 * SAME taxonomy presence and unread already use (lib/chatPresence.ts) rather
 * than a parallel one — the `surface` CHECK constraint in ensureSchema mirrors
 * it, and one list means one place to edit if a fifth surface ever appears.
 */
export type ReactionSurface = ChatScope

export const REACTION_SURFACES: readonly ReactionSurface[] = CHAT_SCOPES

/** One stored reaction row. */
export interface ReactionRow {
  message_id: string
  user_id: string | null
  emoji: string
}

/** One rendered chip: an emoji, how many picked it, and whether you did. */
export interface ReactionTally {
  emoji: string
  count: number
  /** True when the viewer is one of the reactors. */
  mine: boolean
  /** Reactor ids, first-seen order — powers the "Ana, Bo and 3 others" title. */
  userIds: string[]
}

/** The one-tap set offered on every message before the full picker. */
export const QUICK_REACTIONS: readonly string[] = ['👍', '❤️', '😂', '😮', '🔥', '💀']

/** Max UTF-16 length of a stored emoji — comfortably fits a ZWJ family sequence. */
export const MAX_REACTION_LENGTH = 16

/** Max distinct emoji one user may put on one message. */
export const MAX_REACTIONS_PER_USER = 6

/**
 * Accept a reaction only when it is genuinely emoji: at least one pictographic
 * code point, and nothing but emoji, their glue (ZWJ / variation selector /
 * skin-tone modifiers) and keycap digits. Rejects text, whitespace, control
 * characters and anything long enough to be a payload rather than a reaction.
 * Returns the normalized emoji, or null.
 */
export function normalizeReactionEmoji(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > MAX_REACTION_LENGTH) return null
  try {
    if (!/\p{Extended_Pictographic}/u.test(value)) return null
    // Everything left over after removing emoji + glue + keycap parts must be empty.
    const residue = value.replace(
      /[\p{Extended_Pictographic}‍️⃣\u{1F3FB}-\u{1F3FF}0-9#*]/gu,
      '',
    )
    return residue === '' ? value : null
  } catch {
    // Engine without Unicode property escapes: fall back to a length-only guard
    // that still refuses ASCII-only strings.
    return /^[\x00-\x7F]*$/.test(value) ? null : value
  }
}

/**
 * Fold raw rows into per-emoji chips for ONE message. Duplicate (user, emoji)
 * pairs collapse — a double-tap that raced the server must never read as two.
 * Ordered by count desc, then by first appearance so chips don't jump around
 * when two emoji tie.
 */
export function aggregateReactions(
  rows: readonly ReactionRow[] | null | undefined,
  viewerId: string | null | undefined,
): ReactionTally[] {
  if (!Array.isArray(rows) || rows.length === 0) return []
  const byEmoji = new Map<string, { tally: ReactionTally; seen: Set<string>; order: number }>()
  let order = 0

  for (const row of rows) {
    if (!row) continue
    const emoji = normalizeReactionEmoji(row.emoji)
    if (!emoji) continue
    const userId = typeof row.user_id === 'string' && row.user_id ? row.user_id : null
    if (!userId) continue

    let bucket = byEmoji.get(emoji)
    if (!bucket) {
      bucket = { tally: { emoji, count: 0, mine: false, userIds: [] }, seen: new Set(), order: order++ }
      byEmoji.set(emoji, bucket)
    }
    if (bucket.seen.has(userId)) continue
    bucket.seen.add(userId)
    bucket.tally.userIds.push(userId)
    bucket.tally.count += 1
    if (viewerId && userId === viewerId) bucket.tally.mine = true
  }

  return [...byEmoji.values()]
    .sort((a, b) => b.tally.count - a.tally.count || a.order - b.order)
    .map((bucket) => bucket.tally)
}

/** Group rows by message id, each already aggregated for the viewer. */
export function aggregateByMessage(
  rows: readonly ReactionRow[] | null | undefined,
  viewerId: string | null | undefined,
): Map<string, ReactionTally[]> {
  const buckets = new Map<string, ReactionRow[]>()
  for (const row of rows ?? []) {
    if (!row || typeof row.message_id !== 'string' || !row.message_id) continue
    const list = buckets.get(row.message_id)
    if (list) list.push(row)
    else buckets.set(row.message_id, [row])
  }
  const out = new Map<string, ReactionTally[]>()
  for (const [messageId, list] of buckets) out.set(messageId, aggregateReactions(list, viewerId))
  return out
}

/** True when the viewer already reacted to this message with this emoji. */
export function hasReacted(
  rows: readonly ReactionRow[] | null | undefined,
  messageId: string,
  emoji: string,
  viewerId: string | null | undefined,
): boolean {
  if (!viewerId) return false
  const normalized = normalizeReactionEmoji(emoji)
  if (!normalized) return false
  return (rows ?? []).some(
    (row) => row?.message_id === messageId && row?.user_id === viewerId && row?.emoji === normalized,
  )
}

/** How many distinct emoji the viewer has already put on this message. */
export function reactionCountForUser(
  rows: readonly ReactionRow[] | null | undefined,
  messageId: string,
  viewerId: string | null | undefined,
): number {
  if (!viewerId) return 0
  const seen = new Set<string>()
  for (const row of rows ?? []) {
    if (row?.message_id === messageId && row?.user_id === viewerId) seen.add(row.emoji)
  }
  return seen.size
}

/**
 * Optimistic add/remove of the viewer's own reaction. Returns the next row list
 * and which way it went, so the caller knows whether to INSERT or DELETE.
 * `changed:false` means the toggle was refused (bad emoji, signed out, or the
 * per-user cap) and nothing should be written.
 */
export function applyLocalToggle(
  rows: readonly ReactionRow[] | null | undefined,
  messageId: string,
  emoji: string,
  viewerId: string | null | undefined,
): { rows: ReactionRow[]; added: boolean; changed: boolean } {
  const current = [...(rows ?? [])]
  const normalized = normalizeReactionEmoji(emoji)
  if (!normalized || !viewerId || !messageId) return { rows: current, added: false, changed: false }

  if (hasReacted(current, messageId, normalized, viewerId)) {
    return {
      rows: current.filter(
        (row) =>
          !(row.message_id === messageId && row.user_id === viewerId && row.emoji === normalized),
      ),
      added: false,
      changed: true,
    }
  }

  if (reactionCountForUser(current, messageId, viewerId) >= MAX_REACTIONS_PER_USER) {
    return { rows: current, added: false, changed: false }
  }
  current.push({ message_id: messageId, user_id: viewerId, emoji: normalized })
  return { rows: current, added: true, changed: true }
}

/** Accessible label for a chip, e.g. "3 reacted with 🔥 (including you)". */
export function reactionLabel(tally: ReactionTally): string {
  const who = tally.count === 1 ? '1 reaction' : `${tally.count} reactions`
  return tally.mine ? `${who} ${tally.emoji}, including you` : `${who} ${tally.emoji}`
}
