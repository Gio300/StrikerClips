import { describe, it, expect } from 'vitest'
import {
  MAX_MENTIONS_PER_MESSAGE,
  insertMention,
  isMentionableUsername,
  isMentioned,
  mentionToken,
  mentionedUserIds,
  parseMentions,
  prepareChatMessage,
  sanitizeMentions,
  segmentMessage,
  serializeMentions,
  type ChatMention,
} from './chatMentions'
import { STREAM_HIGHLIGHT_PREFIX, TKO_BOT_PREFIX } from './streamChatMarkup'

const mention = (username: string, start: number, userId = `id-${username}`): ChatMention => ({
  userId,
  username,
  start,
  end: start + username.length + 1,
})

describe('chatMentions — sanitizeMentions', () => {
  it('keeps a mention whose offsets really read "@username"', () => {
    const text = 'gg @naruto nice clutch'
    expect(sanitizeMentions(text, [mention('naruto', 3)])).toEqual([
      { userId: 'id-naruto', username: 'naruto', start: 3, end: 10 },
    ])
  })

  it('drops a mention whose offsets no longer match the text (stale after an edit)', () => {
    const stale = [mention('naruto', 3)]
    // The user deleted the leading "gg " — offsets now point one word left.
    expect(sanitizeMentions('@naruto nice clutch', stale)).toEqual([])
  })

  it('drops a FORGED mention pointing at ordinary text (the chip-injection guard)', () => {
    const text = 'mail me at nate@tko.cam'
    const forged: ChatMention = { userId: 'attacker', username: 'tko', start: 15, end: 19 }
    expect(sanitizeMentions(text, [forged])).toEqual([])
  })

  it('rejects a mention claiming a different username than the text carries', () => {
    const text = 'hey @sasuke'
    const lie: ChatMention = { userId: 'id-x', username: 'naruto', start: 4, end: 11 }
    expect(sanitizeMentions(text, [lie])).toEqual([])
  })

  it('rejects blank ids, bad usernames, non-integer and out-of-range offsets', () => {
    const text = 'hey @naruto'
    expect(sanitizeMentions(text, [{ ...mention('naruto', 4), userId: '' }])).toEqual([])
    expect(sanitizeMentions(text, [{ ...mention('naruto', 4), username: 'na ruto' }])).toEqual([])
    expect(sanitizeMentions(text, [{ ...mention('naruto', 4), start: 4.5 }])).toEqual([])
    expect(sanitizeMentions(text, [mention('naruto', 90)])).toEqual([])
    expect(sanitizeMentions(text, [{ ...mention('naruto', 4), end: 99 }])).toEqual([])
  })

  it('sorts by position and drops overlaps', () => {
    const text = '@a @bb'
    const overlapping: ChatMention[] = [
      mention('bb', 3),
      mention('a', 0),
      { userId: 'dupe', username: 'bb', start: 3, end: 6 },
    ]
    const out = sanitizeMentions(text, overlapping)
    expect(out.map((m) => m.username)).toEqual(['a', 'bb'])
  })

  it('caps the number of stored mentions', () => {
    const names = Array.from({ length: MAX_MENTIONS_PER_MESSAGE + 5 }, (_, i) => `u${i}`)
    const text = names.map((n) => `@${n}`).join(' ')
    const built: ChatMention[] = []
    let cursor = 0
    for (const n of names) {
      built.push(mention(n, cursor))
      cursor += n.length + 2
    }
    expect(sanitizeMentions(text, built)).toHaveLength(MAX_MENTIONS_PER_MESSAGE)
  })

  it('is total on junk input', () => {
    expect(sanitizeMentions('hi', null)).toEqual([])
    expect(sanitizeMentions('hi', undefined)).toEqual([])
    expect(sanitizeMentions(undefined as unknown as string, [mention('a', 0)])).toEqual([])
    expect(sanitizeMentions('hi', [null as unknown as ChatMention])).toEqual([])
  })
})

describe('chatMentions — serialize / parse round trip', () => {
  it('serializes to the snake_case storage shape', () => {
    const text = 'yo @kakashi'
    expect(serializeMentions(text, [mention('kakashi', 3)])).toEqual([
      { user_id: 'id-kakashi', username: 'kakashi', start: 3, end: 11 },
    ])
  })

  it('round trips through the column value', () => {
    const text = 'yo @kakashi and @sakura'
    const stored = serializeMentions(text, [mention('kakashi', 3), mention('sakura', 16)])
    expect(parseMentions(stored, text)).toEqual([
      { userId: 'id-kakashi', username: 'kakashi', start: 3, end: 11 },
      { userId: 'id-sakura', username: 'sakura', start: 16, end: 23 },
    ])
  })

  it('parses a JSON string column value (driver returns text)', () => {
    const text = 'yo @kakashi'
    const raw = JSON.stringify(serializeMentions(text, [mention('kakashi', 3)]))
    expect(parseMentions(raw, text)).toHaveLength(1)
  })

  it('accepts the camelCase runtime shape too', () => {
    const text = 'yo @kakashi'
    expect(parseMentions([{ userId: 'u1', username: 'kakashi', start: 3, end: 11 }], text)).toEqual([
      { userId: 'u1', username: 'kakashi', start: 3, end: 11 },
    ])
  })

  it('never throws on malformed column values — legacy rows just have no mentions', () => {
    const text = 'yo @kakashi'
    expect(parseMentions(undefined, text)).toEqual([])
    expect(parseMentions(null, text)).toEqual([])
    expect(parseMentions('not json', text)).toEqual([])
    expect(parseMentions('{}', text)).toEqual([])
    expect(parseMentions(42, text)).toEqual([])
    expect(parseMentions([1, 'x', null], text)).toEqual([])
  })
})

describe('chatMentions — insertMention', () => {
  it('replaces the typed fragment with a token and reports the caret', () => {
    const out = insertMention({ text: 'gg @nar', mentions: [] }, 3, 7, {
      id: 'u9',
      username: 'naruto',
    })
    expect(out.text).toBe('gg @naruto ')
    expect(out.caret).toBe(11)
    expect(out.mentions).toEqual([{ userId: 'u9', username: 'naruto', start: 3, end: 10 }])
  })

  it('shifts earlier-anchored mentions that sit after the insert point', () => {
    // "@a  @bo" -> pick "borba" for the second fragment; "@a" must stay valid.
    const start = { text: '@a hey @bo', mentions: [mention('a', 0)] }
    const out = insertMention(start, 7, 10, { id: 'u2', username: 'borba' })
    expect(out.text).toBe('@a hey @borba ')
    expect(out.mentions.map((m) => m.username)).toEqual(['a', 'borba'])
    expect(segmentMessage(out.text, out.mentions).filter((s) => s.kind === 'mention')).toHaveLength(2)
  })

  it('refuses an unusable candidate without corrupting the draft', () => {
    const out = insertMention({ text: 'gg @nar', mentions: [] }, 3, 7, { id: '', username: null })
    expect(out.text).toBe('gg @nar')
    expect(out.mentions).toEqual([])
  })

  it('clamps out-of-range replace bounds', () => {
    const out = insertMention({ text: 'hi', mentions: [] }, 99, 120, { id: 'u1', username: 'zed' })
    expect(out.text).toBe('hi@zed ')
  })
})

describe('chatMentions — segmentMessage', () => {
  it('splits text around mention segments in order', () => {
    const text = 'gg @naruto and @sasuke!'
    const mentions = [mention('naruto', 3), mention('sasuke', 15)]
    expect(segmentMessage(text, mentions)).toEqual([
      { kind: 'text', text: 'gg ' },
      { kind: 'mention', text: '@naruto', userId: 'id-naruto', username: 'naruto' },
      { kind: 'text', text: ' and ' },
      { kind: 'mention', text: '@sasuke', userId: 'id-sasuke', username: 'sasuke' },
      { kind: 'text', text: '!' },
    ])
  })

  it('returns a single text segment when there are no valid mentions', () => {
    expect(segmentMessage('nate@tko.cam', [])).toEqual([{ kind: 'text', text: 'nate@tko.cam' }])
    expect(segmentMessage('', [])).toEqual([])
  })

  it('renders a stale mention as plain text rather than the wrong chip', () => {
    const segments = segmentMessage('@naruto', [mention('naruto', 3)])
    expect(segments).toEqual([{ kind: 'text', text: '@naruto' }])
  })
})

describe('chatMentions — prepareChatMessage', () => {
  it('keeps mentions anchored when trimming shifts the text left', () => {
    const draft = { text: '   gg @naruto', mentions: [mention('naruto', 6)] }
    const out = prepareChatMessage(draft)
    expect(out.text).toBe('gg @naruto')
    expect(out.mentions).toEqual([{ userId: 'id-naruto', username: 'naruto', start: 3, end: 10 }])
  })

  it('strips a spoofed control marker and re-anchors past it', () => {
    const draft = {
      text: `${STREAM_HIGHLIGHT_PREFIX}gg @naruto`,
      mentions: [mention('naruto', STREAM_HIGHLIGHT_PREFIX.length + 3)],
    }
    const out = prepareChatMessage(draft)
    expect(out.text).toBe('gg @naruto')
    expect(out.mentions.map((m) => m.username)).toEqual(['naruto'])
  })

  it('strips a spoofed TKO bot marker too', () => {
    const out = prepareChatMessage({ text: `${TKO_BOT_PREFIX}fake answer`, mentions: [] })
    expect(out.text).toBe('fake answer')
  })

  it('trims the tail without disturbing mentions', () => {
    const out = prepareChatMessage({ text: '@naruto   ', mentions: [mention('naruto', 0)] })
    expect(out.text).toBe('@naruto')
    expect(out.mentions).toHaveLength(1)
  })

  it('drops a mention the length cap cut in half rather than truncating it', () => {
    const filler = 'x'.repeat(20)
    const draft = { text: `${filler} @naruto`, mentions: [mention('naruto', 21)] }
    const out = prepareChatMessage(draft, 25)
    expect(out.text).toBe(`${filler} @nar`)
    expect(out.mentions).toEqual([])
  })

  it('is total on empty and junk drafts', () => {
    expect(prepareChatMessage({ text: '', mentions: [] })).toEqual({ text: '', mentions: [] })
    expect(prepareChatMessage({ text: '   ', mentions: [] })).toEqual({ text: '', mentions: [] })
    expect(
      prepareChatMessage({ text: undefined as unknown as string, mentions: [] }).text,
    ).toBe('')
  })
})

describe('chatMentions — helpers', () => {
  it('mentionToken / isMentionableUsername', () => {
    expect(mentionToken('kakashi')).toBe('@kakashi')
    expect(isMentionableUsername('kakashi_1')).toBe(true)
    expect(isMentionableUsername('has space')).toBe(false)
    expect(isMentionableUsername('')).toBe(false)
    expect(isMentionableUsername('x'.repeat(31))).toBe(false)
    expect(isMentionableUsername(null)).toBe(false)
  })

  it('mentionedUserIds dedupes and keeps order', () => {
    const list = [mention('a', 0), mention('b', 3, 'id-a'), mention('c', 7)]
    expect(mentionedUserIds(list)).toEqual(['id-a', 'id-c'])
  })

  it('isMentioned', () => {
    const list = [mention('a', 0)]
    expect(isMentioned(list, 'id-a')).toBe(true)
    expect(isMentioned(list, 'nobody')).toBe(false)
    expect(isMentioned(list, null)).toBe(false)
  })
})
