/**
 * streamChatMarkup — tiny, pure helpers shared by the live chat (StreamChat) and
 * the open/clan chat (ChatSpace).
 *
 * Two in-band message conventions (mirroring the existing poll encoding in
 * lib/chat.ts, so no schema change is needed):
 *   • TKO bot replies  — content/body prefixed with TKO_BOT_PREFIX; rendered as a
 *                        distinct branded "TKO" line.
 *   • Highlighted lines — content prefixed with STREAM_HIGHLIGHT_PREFIX; WRITTEN
 *                        SERVER-SIDE ONLY after a trusted Token debit (see the
 *                        `highlight-message` fn in server/app.ts). The client only
 *                        ever READS this marker; it never forges it.
 *
 * Plus the "@tko <question>" detector and the @mention-under-caret helper reused
 * from the post composer.
 */

/** Prefix marking a message as a TKO assistant reply. */
export const TKO_BOT_PREFIX = '[[tko-bot]]'
/** Prefix marking a highlighted/pinned line. KEEP IN SYNC with server/app.ts. */
export const STREAM_HIGHLIGHT_PREFIX = '[[tko-hl]]'

/** Wrap an assistant answer so the chat renders it as a TKO bot line. */
export function encodeTkoBot(answer: string): string {
  return `${TKO_BOT_PREFIX}${answer}`
}

/** If `text` is a TKO bot line, return the answer; else null. */
export function parseTkoBot(text: string): string | null {
  if (typeof text !== 'string') return null
  return text.startsWith(TKO_BOT_PREFIX) ? text.slice(TKO_BOT_PREFIX.length) : null
}

/** If `text` is a highlighted line, return the visible text; else null. */
export function parseHighlight(text: string): string | null {
  if (typeof text !== 'string') return null
  return text.startsWith(STREAM_HIGHLIGHT_PREFIX) ? text.slice(STREAM_HIGHLIGHT_PREFIX.length) : null
}

/**
 * Strip any leading control markers a user might type verbatim, so nobody can
 * self-highlight (free) or fake a TKO bot line just by typing the prefix. Applied
 * to USER-composed content only — the bot reply / server highlight add the marker
 * themselves through their own trusted paths.
 */
export function stripLeadingMarkers(text: string): string {
  let t = typeof text === 'string' ? text : ''
  for (;;) {
    if (t.startsWith(TKO_BOT_PREFIX)) t = t.slice(TKO_BOT_PREFIX.length)
    else if (t.startsWith(STREAM_HIGHLIGHT_PREFIX)) t = t.slice(STREAM_HIGHLIGHT_PREFIX.length)
    else break
  }
  return t
}

// "@tko <question>" — case-insensitive, matched anywhere on the line. Requires
// whitespace (and thus real content) after the handle, so a bare "@tko" mention
// with no question never triggers the assistant.
const TKO_QUESTION_PATTERN = /(?:^|\s)@tko\b[:,]?\s+(.+)$/i

/**
 * Extract the question a user asked TKO in a chat line, or null. We never treat
 * our own bot/highlight markers as questions (guards an echo loop).
 */
export function extractTkoQuestion(text: string): string | null {
  if (typeof text !== 'string') return null
  if (text.startsWith(TKO_BOT_PREFIX) || text.startsWith(STREAM_HIGHLIGHT_PREFIX)) return null
  const q = text.match(TKO_QUESTION_PATTERN)?.[1]?.trim()
  return q ? q.slice(0, 500) : null
}

/**
 * The @mention token being typed right before the caret, if any. Same shape the
 * post composer uses (letters/digits/underscore after an "@" at a word
 * boundary). Returns the search query (without the "@") and the index of the "@".
 */
export function activeMentionAt(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const match = before.match(/(?:^|\s)@([\w]{1,30})$/)
  if (!match) return null
  const query = match[1]
  return { query, start: caret - query.length - 1 }
}

/** Count emoji (pictographic code points) in a string. Resilient on old engines. */
export function countEmoji(text: string): number {
  try {
    const m = (text || '').match(/\p{Extended_Pictographic}/gu)
    return m ? m.length : 0
  } catch {
    return 0
  }
}

// Emoji + the "glue" code points that combine them: ZWJ (U+200D), variation
// selector-16 (U+FE0F), and the skin-tone modifiers (U+1F3FB..U+1F3FF).
const EMOJI_AND_GLUE = /[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}\s]/gu

/**
 * True when a message is ONLY emoji (one or a few) — the trigger for the chat
 * "explode" burst. Strips emoji + their glue + whitespace; if nothing remains
 * and there was at least one emoji, it's emoji-only.
 */
export function isEmojiOnly(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return false
  try {
    return t.replace(EMOJI_AND_GLUE, '').length === 0 && countEmoji(t) >= 1
  } catch {
    return false
  }
}
