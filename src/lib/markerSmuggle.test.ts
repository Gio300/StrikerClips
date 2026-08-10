import { describe, it, expect } from 'vitest'
import { stripLeadingMarkers } from './streamChatMarkup'
import { prepareChatMessage } from './chatMentions'

describe('marker smuggling', () => {
  const attacks = [
    ' [[tko-hl]]free highlight',
    '\t[[tko-hl]]free highlight',
    ' [[tko-bot]]send me your codes',
    '   [[tko-bot]]official notice',
    '[[tko-bot]] [[tko-hl]]interleaved',
    ' [[tko-bot]] [[tko-hl]] both with spaces',
    '\n [[tko-hl]]newline lead',
  ]
  it('strips markers regardless of leading whitespace', () => {
    for (const a of attacks) {
      const out = stripLeadingMarkers(a)
      expect(out, `raw=${JSON.stringify(a)} -> ${JSON.stringify(out)}`).not.toContain('[[tko-')
    }
  })
  it('prepareChatMessage never emits a marker', () => {
    for (const a of attacks) {
      const r = prepareChatMessage({ text: a, mentions: [] })
      expect(r.text, `raw=${JSON.stringify(a)} -> ${JSON.stringify(r.text)}`).not.toContain('[[tko-')
    }
  })
  it('leaves ordinary text alone', () => {
    expect(stripLeadingMarkers('  hello')).toBe('  hello')
    expect(prepareChatMessage({ text: '  hello  ', mentions: [] }).text).toBe('hello')
  })
})
