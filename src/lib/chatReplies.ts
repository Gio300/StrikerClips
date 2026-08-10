/**
 * chatReplies — the pure half of reply-to-message, shared by all chat surfaces.
 *
 * A reply is just a `reply_to` uuid on the message row (added idempotently by
 * server/ensureSchema.ts). Everything the quoted preview needs is derived here:
 * a single-line snippet of the parent, the id validation that keeps a client
 * from pointing `reply_to` at a non-id, and the "is this row actually persisted"
 * guard the optimistic local rows need.
 */

import { expandShortcodes } from './chatEmoji'
import { parseChatPoll } from './chat'
import { parseHighlight, parseTkoBot } from './streamChatMarkup'
import { parseChatImage } from './chatMedia'

/** Everything the quoted-preview strip renders. */
export interface ReplyTarget {
  /** The parent message id written to `reply_to`. */
  id: string
  /** Display name of the parent's author ('someone' when unknown). */
  author: string
  /** One-line snippet of the parent body. */
  preview: string
  /** Parent author's profile id, for the avatar/link. */
  authorId?: string | null
}

/** Longest snippet shown in a quoted preview before it is elided. */
export const REPLY_PREVIEW_LENGTH = 120

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * True when an id is a real persisted row id rather than one of the optimistic
 * `local-…` ids the composers mint before (or instead of) a server round-trip.
 * Reactions and `reply_to` are only written for these — a uuid column will
 * reject 'local-1712…' and the whole insert would fail, so the UI keeps those
 * interactions in local state instead. Nothing crashes either way.
 */
export function isPersistedMessageId(id: unknown): id is string {
  return typeof id === 'string' && UUID_PATTERN.test(id)
}

/**
 * Collapse a message body into a one-line preview: control markers stripped, a
 * poll reference named rather than shown as its opaque token, shortcodes
 * expanded, whitespace collapsed, and elided at REPLY_PREVIEW_LENGTH. Returns a
 * plain string — the caller renders it as a text node, never as markup.
 */
export function replyPreview(body: string | null | undefined): string {
  const raw = typeof body === 'string' ? body : ''
  if (!raw) return ''
  if (parseChatPoll(raw)) return 'Poll'
  if (parseChatImage(raw)) return 'Photo'

  const unwrapped = parseTkoBot(raw) ?? parseHighlight(raw) ?? raw
  const flat = expandShortcodes(unwrapped).replace(/\s+/g, ' ').trim()
  if (flat.length <= REPLY_PREVIEW_LENGTH) return flat
  return `${flat.slice(0, REPLY_PREVIEW_LENGTH - 1).trimEnd()}…`
}

/**
 * Resolve the parent of a reply from the messages already on screen. Returns
 * null when `replyTo` is empty or the parent isn't loaded (scrolled out of the
 * 100-row backfill, or deleted) — the row then renders as an ordinary message
 * rather than an error.
 */
export function resolveReplyTarget<T extends { id: string }>(
  replyTo: string | null | undefined,
  messages: readonly T[],
  describe: (message: T) => { author: string; body: string; authorId?: string | null },
): ReplyTarget | null {
  if (!replyTo || typeof replyTo !== 'string') return null
  const parent = messages.find((m) => m?.id === replyTo)
  if (!parent) return null
  const described = describe(parent)
  return {
    id: parent.id,
    author: described.author || 'someone',
    preview: replyPreview(described.body),
    authorId: described.authorId ?? null,
  }
}

/** The `reply_to` value to write for a draft — null unless the parent is real. */
export function replyToColumn(target: ReplyTarget | null | undefined): string | null {
  return target && isPersistedMessageId(target.id) ? target.id : null
}
