import { describe, it, expect } from 'vitest'
import {
  ASSISTANT_COOLDOWN_MS,
  ASSISTANT_QUESTION_MAX,
  cooldownRemainingMs,
  extractAssistantQuestion,
  mentionsAssistant,
  throttleLine,
} from './chatAssistant'
import { TKO_BOT_PREFIX, STREAM_HIGHLIGHT_PREFIX } from './streamChatMarkup'

describe('addressing the assistant from a chat composer', () => {
  it('answers to @tko, and to the @oracle / @ai aliases', () => {
    expect(extractAssistantQuestion('@tko who is winning?')).toBe('who is winning?')
    expect(extractAssistantQuestion('@oracle who is winning?')).toBe('who is winning?')
    expect(extractAssistantQuestion('@ai who is winning?')).toBe('who is winning?')
  })

  it('answers to the slash commands too', () => {
    expect(extractAssistantQuestion('/tko how do brackets seed?')).toBe('how do brackets seed?')
    expect(extractAssistantQuestion('/ask how do brackets seed?')).toBe('how do brackets seed?')
    expect(extractAssistantQuestion('/oracle how do brackets seed?')).toBe('how do brackets seed?')
  })

  it('is case-insensitive and tolerates a colon or comma after the handle', () => {
    expect(extractAssistantQuestion('@TKO: what is a sweep?')).toBe('what is a sweep?')
    expect(extractAssistantQuestion('@Tko, what is a sweep?')).toBe('what is a sweep?')
  })

  it('picks up a handle mid-sentence, the way people actually type', () => {
    expect(extractAssistantQuestion('hey @tko what map is this')).toBe('what map is this')
  })

  it('NEVER fires without a real question — a bare mention costs no model call', () => {
    expect(extractAssistantQuestion('@tko')).toBeNull()
    expect(extractAssistantQuestion('@tko ')).toBeNull()
    expect(extractAssistantQuestion('@oracle')).toBeNull()
    expect(extractAssistantQuestion('')).toBeNull()
  })

  it('does not fire on lookalike words', () => {
    // The room talks ABOUT the Oracle betting feature constantly — that must not
    // bill a Gemini call.
    expect(extractAssistantQuestion('the oracle round just closed')).toBeNull()
    expect(extractAssistantQuestion('tko is the best')).toBeNull()
    expect(extractAssistantQuestion('email me at me@tkocam.example')).toBeNull()
    expect(extractAssistantQuestion('@tkobot what is this')).toBeNull()
  })

  it('refuses our own in-band markers, which is what stops an echo loop', () => {
    expect(extractAssistantQuestion(`${TKO_BOT_PREFIX}@tko what now?`)).toBeNull()
    expect(extractAssistantQuestion(`${STREAM_HIGHLIGHT_PREFIX}@tko what now?`)).toBeNull()
  })

  it('caps the question at the same length the fn enforces', () => {
    const long = `@tko ${'x'.repeat(ASSISTANT_QUESTION_MAX + 200)}`
    expect(extractAssistantQuestion(long)?.length).toBe(ASSISTANT_QUESTION_MAX)
  })

  it('survives non-string input from a loose caller', () => {
    expect(extractAssistantQuestion(undefined as unknown as string)).toBeNull()
    expect(extractAssistantQuestion(null as unknown as string)).toBeNull()
  })

  it('mentionsAssistant agrees with the extractor', () => {
    expect(mentionsAssistant('@tko hi there')).toBe(true)
    expect(mentionsAssistant('just chatting')).toBe(false)
  })
})

describe('client cooldown (the first half of the AI cost gate)', () => {
  const NOW = 1_800_000_000_000

  it('lets the first ask straight through', () => {
    expect(cooldownRemainingMs(null, NOW)).toBe(0)
  })

  it('holds a second ask for the remainder of the window', () => {
    expect(cooldownRemainingMs(NOW, NOW + 1_000)).toBe(ASSISTANT_COOLDOWN_MS - 1_000)
    expect(cooldownRemainingMs(NOW, NOW + ASSISTANT_COOLDOWN_MS)).toBe(0)
    expect(cooldownRemainingMs(NOW, NOW + ASSISTANT_COOLDOWN_MS + 5_000)).toBe(0)
  })

  it('fails CLOSED on a backwards clock rather than opening the gate', () => {
    expect(cooldownRemainingMs(NOW, NOW - 60_000)).toBe(ASSISTANT_COOLDOWN_MS)
  })
})

describe('throttle copy', () => {
  it('rounds up to whole seconds and never shows 0s', () => {
    expect(throttleLine(4_200)).toBe('TKO is catching up — try again in 5s.')
    expect(throttleLine(0)).toBe('TKO is catching up — try again in 1s.')
  })
})
