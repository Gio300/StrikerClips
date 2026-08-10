import { describe, it, expect } from 'vitest'
import {
  REPLY_PREVIEW_LENGTH,
  isPersistedMessageId,
  replyPreview,
  replyToColumn,
  resolveReplyTarget,
} from './chatReplies'
import { encodeChatPoll } from './chat'
import { STREAM_HIGHLIGHT_PREFIX, encodeTkoBot } from './streamChatMarkup'
import { encodeChatImage } from './chatMedia'

const UUID = '11111111-2222-4333-8444-555555555555'

describe('chatReplies — isPersistedMessageId', () => {
  it('accepts a real row uuid', () => {
    expect(isPersistedMessageId(UUID)).toBe(true)
    expect(isPersistedMessageId(UUID.toUpperCase())).toBe(true)
  })

  it('rejects the optimistic local ids the composers mint', () => {
    expect(isPersistedMessageId('local-1712345678901-ab12x')).toBe(false)
    expect(isPersistedMessageId('stage-1712345678901-3')).toBe(false)
  })

  it('rejects junk', () => {
    expect(isPersistedMessageId('')).toBe(false)
    expect(isPersistedMessageId(null)).toBe(false)
    expect(isPersistedMessageId(undefined)).toBe(false)
    expect(isPersistedMessageId(42)).toBe(false)
    expect(isPersistedMessageId('11111111-2222-4333-8444')).toBe(false)
  })
})

describe('chatReplies — replyPreview', () => {
  it('collapses whitespace onto one line', () => {
    expect(replyPreview('hey\n\n  there   you')).toBe('hey there you')
  })

  it('expands shortcodes so the quote reads like the message did', () => {
    expect(replyPreview('that was :fire:')).toBe('that was 🔥')
  })

  it('unwraps the in-band control markers', () => {
    expect(replyPreview(encodeTkoBot('the answer'))).toBe('the answer')
    expect(replyPreview(`${STREAM_HIGHLIGHT_PREFIX}pinned line`)).toBe('pinned line')
  })

  it('names a poll instead of showing its opaque token', () => {
    expect(replyPreview(encodeChatPoll(UUID))).toBe('Poll')
  })

  it('names an uploaded image instead of showing its opaque token', () => {
    expect(replyPreview(encodeChatImage({
      url: `https://tko.cam/api/storage/chat-media/${UUID}/${UUID}.jpg`,
      alt: 'final round',
    }))).toBe('Photo')
  })

  it('elides a long body', () => {
    const out = replyPreview('x'.repeat(400))
    expect(out).toHaveLength(REPLY_PREVIEW_LENGTH)
    expect(out.endsWith('…')).toBe(true)
  })

  it('is total on empty / non-string input', () => {
    expect(replyPreview('')).toBe('')
    expect(replyPreview(null)).toBe('')
    expect(replyPreview(undefined)).toBe('')
  })
})

describe('chatReplies — resolveReplyTarget', () => {
  const messages = [
    { id: UUID, author: 'naruto', body: 'first blood', authorId: 'u1' },
    { id: 'local-1', author: 'sakura', body: 'nice', authorId: 'u2' },
  ]
  const describe_ = (m: (typeof messages)[number]) => ({
    author: m.author,
    body: m.body,
    authorId: m.authorId,
  })

  it('resolves a loaded parent', () => {
    expect(resolveReplyTarget(UUID, messages, describe_)).toEqual({
      id: UUID,
      author: 'naruto',
      preview: 'first blood',
      authorId: 'u1',
    })
  })

  it('returns null when the parent is not loaded or reply_to is empty', () => {
    expect(resolveReplyTarget('missing-id', messages, describe_)).toBeNull()
    expect(resolveReplyTarget(null, messages, describe_)).toBeNull()
    expect(resolveReplyTarget(undefined, messages, describe_)).toBeNull()
    expect(resolveReplyTarget('', messages, describe_)).toBeNull()
  })

  it('falls back to "someone" for an unnamed author', () => {
    const anon = [{ id: UUID, author: '', body: 'hi', authorId: null }]
    expect(resolveReplyTarget(UUID, anon, (m) => ({ author: m.author, body: m.body }))?.author).toBe(
      'someone',
    )
  })
})

describe('chatReplies — replyToColumn', () => {
  it('writes the uuid for a persisted parent', () => {
    expect(replyToColumn({ id: UUID, author: 'a', preview: 'p' })).toBe(UUID)
  })

  it('writes null for a local-only parent, so the insert never fails on a uuid column', () => {
    expect(replyToColumn({ id: 'local-9', author: 'a', preview: 'p' })).toBeNull()
    expect(replyToColumn(null)).toBeNull()
    expect(replyToColumn(undefined)).toBeNull()
  })
})
