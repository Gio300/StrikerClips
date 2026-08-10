/**
 * chatMentions — STRUCTURAL @mentions shared by every TKO chat surface
 * (StreamChat, TournamentChat, StageChat, ChatSpace channels, DMs).
 *
 * The hard rule this module exists to enforce: a rendered mention chip is NEVER
 * produced by re-scanning the message text at render time. Regex-over-text turns
 * "mail me at nate@tko.cam" into a chip, lets a user paint someone else's name
 * onto their line, and is the classic road to injecting markup into a message
 * body. Instead the composer records WHO was picked and WHERE, and that array
 * travels with the message (the `mentions` jsonb column added by
 * server/ensureSchema.ts). The renderer only slices the raw text at those
 * offsets — it never interprets the text itself.
 *
 * Every offset is re-validated against the text before use (`sanitizeMentions`),
 * so a stale offset (the user edited the draft), a forged row, or a legacy row
 * with no mentions at all degrades to plain text rather than a wrong chip. Pure
 * and DOM-free, mirroring lib/chat.ts and lib/streamChatMarkup.ts.
 */

import { stripLeadingMarkers } from './streamChatMarkup'

/** One resolved mention: a real user, and exactly where their token sits. */
export interface ChatMention {
  /** profiles.id of the mentioned user. */
  userId: string
  /** Username WITHOUT the leading '@', exactly as written in the text. */
  username: string
  /** Index of the '@' in the message text (inclusive). */
  start: number
  /** Index one past the last character of the username (exclusive). */
  end: number
}

/** A composer draft: the raw text plus the mentions anchored into it. */
export interface MentionDraft {
  text: string
  mentions: ChatMention[]
}

/** The person shape the composer picker hands back (matches PersonHit). */
export interface MentionCandidate {
  id: string
  username?: string | null
}

/** One piece of a message: literal text, or a resolved mention chip. */
export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; userId: string; username: string }

/** Usernames are the same shape the post composer + activeMentionAt() accept. */
const USERNAME_PATTERN = /^\w{1,30}$/

/**
 * Hard cap on stored mentions. A message that "mentions" 500 people is a
 * notification-spam vector, not a conversation.
 */
export const MAX_MENTIONS_PER_MESSAGE = 20

/** The literal token written into the text for a username. */
export function mentionToken(username: string): string {
  return `@${username}`
}

/** True when a username can be mentioned at all (matches the picker's search). */
export function isMentionableUsername(username: unknown): username is string {
  return typeof username === 'string' && USERNAME_PATTERN.test(username)
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * The token must sit on a word boundary — start of line or after whitespace,
 * and not run straight into another word character.
 *
 * This is what stops "mail me at nate@tko.cam" from being chip-able: the string
 * equality check alone happily matches "@tko" there, because it IS "@tko". Only
 * the boundary rule distinguishes a mention from the middle of an email address.
 * Mirrors the `(?:^|\s)@` anchor activeMentionAt() uses in the composer, so the
 * two ends agree on what a mention even is.
 */
function onWordBoundary(text: string, start: number, end: number): boolean {
  if (start > 0 && !/\s/.test(text[start - 1])) return false
  if (end < text.length && /\w/.test(text[end])) return false
  return true
}

/**
 * Drop every mention that no longer describes the text it points at.
 *
 * A mention survives only when ALL of these hold:
 *   • it carries a non-empty user id and a well-formed username,
 *   • its offsets are integers inside the text and end === start + 1 + len,
 *   • the text at those offsets is LITERALLY "@username",
 *   • the token sits on a word boundary (see onWordBoundary),
 *   • it does not overlap a mention that was already accepted.
 *
 * Those last two are the whole security story: no matter what a client (or a
 * hand-rolled row) claims, a chip is only ever drawn over text that really reads
 * "@thatname" AND stands alone — so the "@tko" inside "nate@tko.cam" can never
 * be dressed up as a mention. Result is sorted by `start` and capped.
 */
export function sanitizeMentions(
  text: string,
  mentions: readonly ChatMention[] | null | undefined,
): ChatMention[] {
  if (typeof text !== 'string' || !Array.isArray(mentions)) return []
  const sorted = [...mentions]
    .filter((m): m is ChatMention => {
      if (!m || typeof m !== 'object') return false
      if (typeof m.userId !== 'string' || m.userId.trim() === '') return false
      if (!isMentionableUsername(m.username)) return false
      if (!isIndex(m.start) || !isIndex(m.end)) return false
      if (m.end !== m.start + m.username.length + 1) return false
      if (m.end > text.length) return false
      if (text.slice(m.start, m.end) !== mentionToken(m.username)) return false
      return onWordBoundary(text, m.start, m.end)
    })
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const kept: ChatMention[] = []
  let cursor = 0
  for (const m of sorted) {
    if (m.start < cursor) continue // overlaps one we already kept
    kept.push({ userId: m.userId, username: m.username, start: m.start, end: m.end })
    cursor = m.end
    if (kept.length >= MAX_MENTIONS_PER_MESSAGE) break
  }
  return kept
}

/**
 * Read a `mentions` value straight off a DB row (jsonb, a JSON string on some
 * drivers, or absent on legacy rows) and return only the mentions that still
 * validate against `text`. Never throws — an unreadable value is simply "no
 * mentions", which renders as plain text.
 */
export function parseMentions(raw: unknown, text: string): ChatMention[] {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  const coerced: ChatMention[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    // Accept both the snake_case storage shape and the camelCase runtime shape.
    const userId = row.userId ?? row.user_id
    coerced.push({
      userId: typeof userId === 'string' ? userId : '',
      username: typeof row.username === 'string' ? row.username : '',
      start: typeof row.start === 'number' ? row.start : -1,
      end: typeof row.end === 'number' ? row.end : -1,
    })
  }
  return sanitizeMentions(text, coerced)
}

/** The snake_case array written to the `mentions` jsonb column. */
export function serializeMentions(
  text: string,
  mentions: readonly ChatMention[] | null | undefined,
): Array<{ user_id: string; username: string; start: number; end: number }> {
  return sanitizeMentions(text, mentions).map((m) => ({
    user_id: m.userId,
    username: m.username,
    start: m.start,
    end: m.end,
  }))
}

/** Unique user ids mentioned in a message (order preserved). */
export function mentionedUserIds(mentions: readonly ChatMention[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of mentions) {
    if (seen.has(m.userId)) continue
    seen.add(m.userId)
    out.push(m.userId)
  }
  return out
}

/** True when `userId` is mentioned — used to highlight your own mentions. */
export function isMentioned(mentions: readonly ChatMention[], userId: string | null | undefined): boolean {
  if (!userId) return false
  return mentions.some((m) => m.userId === userId)
}

/**
 * Replace the "@que" fragment under the caret with a real "@username " token and
 * re-anchor the surrounding mentions.
 *
 * `replaceStart`/`replaceEnd` bound the fragment being replaced (from
 * activeMentionAt() in streamChatMarkup.ts plus the caret). Existing mentions
 * are shifted by the length delta and then re-validated, so any mention the edit
 * mangled falls away instead of pointing at the wrong words.
 */
export function insertMention(
  draft: MentionDraft,
  replaceStart: number,
  replaceEnd: number,
  person: MentionCandidate,
): MentionDraft & { caret: number } {
  const text = typeof draft.text === 'string' ? draft.text : ''
  const username = person?.username ?? ''
  const start = Math.max(0, Math.min(replaceStart, text.length))
  const end = Math.max(start, Math.min(replaceEnd, text.length))
  if (!isMentionableUsername(username) || !person?.id) {
    return { text, mentions: sanitizeMentions(text, draft.mentions), caret: end }
  }

  const token = `${mentionToken(username)} `
  const nextText = text.slice(0, start) + token + text.slice(end)
  const delta = token.length - (end - start)

  const shifted = (draft.mentions ?? []).map((m) =>
    m.start >= end ? { ...m, start: m.start + delta, end: m.end + delta } : m,
  )
  shifted.push({ userId: person.id, username, start, end: start + username.length + 1 })

  return {
    text: nextText,
    mentions: sanitizeMentions(nextText, shifted),
    caret: start + token.length,
  }
}

/** Default hard cap on a chat line, matching the existing composers' .slice(0, 500). */
export const MAX_CHAT_MESSAGE_LENGTH = 500

/**
 * Turn a composer draft into exactly what gets written to the database.
 *
 * THIS EXISTS BECAUSE THE SEND PATH MOVES THE TEXT. Every composer already did
 * `stripLeadingMarkers(draft.trim()).slice(0, 500)` — three edits that shift
 * character offsets, which would silently leave every mention pointing a few
 * characters to the right of where it belongs. Doing it here, once, keeps the
 * text and its mentions in step:
 *   1. strip any control markers the user typed verbatim (the anti-spoof from
 *      streamChatMarkup.ts — nobody self-highlights or fakes a TKO bot line),
 *   2. trim, tracking exactly how much came off the FRONT,
 *   3. shift the mentions by that amount and cap the line — a mention the cap
 *      cut in half fails re-validation and is dropped rather than truncated.
 */
export function prepareChatMessage(
  draft: MentionDraft,
  maxLength: number = MAX_CHAT_MESSAGE_LENGTH,
): MentionDraft {
  const raw = typeof draft?.text === 'string' ? draft.text : ''
  // Markers are only ever a PREFIX, so what they remove is a pure left shift.
  const stripped = stripLeadingMarkers(raw)
  const leading = stripped.length - stripped.replace(/^\s+/, '').length
  const offset = raw.length - stripped.length + leading

  const text = stripped.slice(leading).replace(/\s+$/, '').slice(0, Math.max(0, maxLength))
  const shifted = (draft?.mentions ?? []).map((m) => ({
    ...m,
    start: m.start - offset,
    end: m.end - offset,
  }))
  return { text, mentions: sanitizeMentions(text, shifted) }
}

/**
 * Split a message into ordered render segments. The ONLY thing that produces a
 * mention segment is a validated entry in `mentions` — the text is never
 * scanned. Callers render each segment as a React node, so nothing here ever
 * needs (or permits) raw HTML.
 */
export function segmentMessage(
  text: string,
  mentions: readonly ChatMention[] | null | undefined,
): MessageSegment[] {
  const body = typeof text === 'string' ? text : ''
  const clean = sanitizeMentions(body, mentions)
  if (clean.length === 0) return body ? [{ kind: 'text', text: body }] : []

  const out: MessageSegment[] = []
  let cursor = 0
  for (const m of clean) {
    if (m.start > cursor) out.push({ kind: 'text', text: body.slice(cursor, m.start) })
    out.push({
      kind: 'mention',
      text: body.slice(m.start, m.end),
      userId: m.userId,
      username: m.username,
    })
    cursor = m.end
  }
  if (cursor < body.length) out.push({ kind: 'text', text: body.slice(cursor) })
  return out
}
