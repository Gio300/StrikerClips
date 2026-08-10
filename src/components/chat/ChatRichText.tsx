import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { expandShortcodes } from '@/lib/chatEmoji'
import { segmentMessage, type ChatMention } from '@/lib/chatMentions'

/**
 * ChatRichText — THE renderer for a chat message body. Every surface
 * (StreamChat, TournamentChat, StageChat, ChatSpace channels, DMs) goes through
 * this so a mention looks and behaves the same everywhere.
 *
 * Two safety properties, both structural rather than "remember to escape":
 *   1. It renders REACT NODES, never HTML. There is no dangerouslySetInnerHTML
 *      here and there must never be one — a message body is user input, and the
 *      only reason markup in a message is harmless today is that it can never
 *      reach a parser.
 *   2. Mention chips come exclusively from the validated `mentions` array
 *      (src/lib/chatMentions.ts). The text is never scanned for "@name", so an
 *      email address can't sprout a chip and nobody can paint a mention onto
 *      someone else's words. A legacy row with no mentions renders as plain
 *      text — which is correct, not broken.
 *
 * Emoji shortcodes ARE expanded, but only inside a literal text run, so they can
 * never shift the offsets the mentions are anchored to.
 */

export function ChatRichText({
  text,
  mentions,
  viewerId,
  className = '',
}: {
  text: string
  mentions?: readonly ChatMention[] | null
  /** When set, a mention OF this user renders in the "you were mentioned" style. */
  viewerId?: string | null
  className?: string
}) {
  const segments = segmentMessage(text, mentions)
  if (segments.length === 0) return null

  return (
    <span data-user-content className={className}>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          // Plain text node — expanded shortcodes and nothing else.
          return <Fragment key={index}>{expandShortcodes(segment.text)}</Fragment>
        }
        const isMe = Boolean(viewerId) && segment.userId === viewerId
        return (
          <Link
            key={index}
            to={`/profile/${segment.userId}`}
            title={`@${segment.username}`}
            className={`rounded px-1 font-medium ${
              isMe
                ? 'bg-accent/25 text-accent ring-1 ring-accent/40'
                : 'bg-accent/10 text-accent hover:bg-accent/20'
            }`}
          >
            {segment.text}
          </Link>
        )
      })}
    </span>
  )
}

export default ChatRichText
