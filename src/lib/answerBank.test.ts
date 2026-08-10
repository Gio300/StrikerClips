/* eslint-disable @typescript-eslint/no-explicit-any */
// =============================================================================
// THE $0 ANSWERS — src/lib/answerBank.ts, and the chat surfaces that use it.
//
// Two promises, and the second one is the one that matters:
//
//   1. THE BANK IS RIGHT AND IT IS GENERATED. Walkthrough answers come from
//      src/lib/guides.ts and tier answers from src/lib/tiers.ts, so they cannot
//      drift from the product. No answer quotes a subscription PRICE, because a
//      price is catalogue data that moves and a stale one quoted to a throttled
//      user is invisible damage.
//
//   2. THE BANK NEVER TAKES AN ANSWER AWAY. `bankAnswer` returns null unless it
//      is confident, so every caller falls through to the model exactly as
//      before. Cheaper has to come from speed and grounding, never from a
//      smaller answer surface.
//
// And the behaviour this unlocks: a throttled "@tko …" in a live room used to
// post NOTHING, which is the one thing the house convention forbids.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { bankAnswer, bankEntryId, bankEntryIds } from './answerBank'
import { GUIDES } from './guides'
import { LEVEL_TIER_NAME } from './tiers'

// The `ask` fn, stubbed. Each test sets what the server "returns".
let askResponse: any = null
let askThrows = false
let askCalls = 0
vi.mock('./backend', () => ({
  backend: async () => ({}),
  callFn: async () => {
    askCalls += 1
    if (askThrows) throw new Error('offline')
    return askResponse
  },
}))

import { askAssistant } from './chatAssistant'

beforeEach(() => {
  askResponse = null
  askThrows = false
  askCalls = 0
})

describe('the local answer bank', () => {
  it('answers the device-clock question, which used to exist ONLY inside the paid model', () => {
    // This is the documented cause of "my clips aren't in the squad's video".
    // It is completely static, so paying a model to say it was never right —
    // and a throttled or offline player got nothing at all.
    for (const question of [
      "my clips aren't showing up in videos with my squad",
      'why did my clip not group with theirs',
      'we were in the same match but the video is missing me',
    ]) {
      const answer = bankAnswer(question)
      expect(answer, question).toBeTruthy()
      expect(answer!).toMatch(/time zone/i)
      expect(answer!).toMatch(/clock/i)
    }
  })

  it('builds the walkthroughs from guides.ts rather than transcribing them', () => {
    const goLive = GUIDES.find((g) => g.id === 'go-live')!
    const answer = bankAnswer('how do i go live')!
    // Every step of the real guide has to be in the spoken answer, so editing
    // the guide edits this.
    for (const step of goLive.steps) expect(answer).toContain(step.title)
    expect(bankEntryId('how do i go live')).toBe('go-live')

    const clan = GUIDES.find((g) => g.id === 'join-clan')!
    const clanAnswer = bankAnswer('how do i join a clan')!
    for (const step of clan.steps) expect(clanAnswer).toContain(step.title)
  })

  it('describes what a paid tier DOES from the feature table, and never quotes a price', () => {
    const answer = bankAnswer('what does legend include')!
    expect(answer).toContain(LEVEL_TIER_NAME[3])
    expect(answer).toContain(LEVEL_TIER_NAME[1])
    expect(answer).toMatch(/upgrade/i)
    // THE INVARIANT: a price in here is a price that goes stale in silence.
    // The $1.99 rung was retired mid-flight; this is why nothing here says $.
    for (const id of bankEntryIds()) {
      const text = bankAnswer(seedFor(id)) ?? ''
      expect(text, `${id} quotes a price`).not.toMatch(/\$\s?\d/)
      expect(text, `${id} quotes a price`).not.toMatch(/\d+\s?(usd|dollars)/i)
    }
  })

  it('ranks the specific pattern above the broad one', () => {
    // The panel's older table has the opposite bug — a bare "help" in its first
    // entry swallows "help me enter a tournament" and returns the generic
    // capabilities blurb. Entries here lead with what people actually type.
    expect(bankEntryId('how do i enter a tournament')).toBe('enter-tournament')
    expect(bankEntryId('what is a stat check')).toBe('stat-check')
    expect(bankEntryId('how do i start streaming')).toBe('go-live')
    expect(bankEntryId('how do i add a player to a clan roster')).toBe('manage-clan-roster')
    expect(bankEntryId('how do i host a tournament')).toBe('run-tournament')
  })

  it('does not teach users that screenshots or stat-check approval mint power', () => {
    const answer = bankAnswer('why did my power level change')!
    expect(answer).toMatch(/screenshots.*do not add power/i)
    expect(answer).toMatch(/stat check.*do not add power/i)
    expect(answer).toMatch(/losses.*lower/i)
  })

  it('returns null rather than a bad guess, so nothing it does not know goes unanswered', () => {
    for (const question of [
      'who won the leaf village cup',
      "what is toolrival's record",
      'is my entry accepted yet',
      'how many people are on tko right now',
      '',
      '  ',
      'ok',
    ]) {
      expect(bankAnswer(question), question).toBeNull()
    }
  })

  it('interpolates the asker\'s own power level when the caller knows it, and omits it when not', () => {
    expect(bankAnswer('what is my power level', { power: 42 })!).toContain('42')
    expect(bankAnswer('what is my power level')!).not.toMatch(/your power level is/i)
  })
})

describe('a throttled room still gets an answer', () => {
  it('answers from the bank when the server rate-limits, instead of posting nothing', async () => {
    askResponse = { ok: false, rateLimited: true, retryAfterMs: 8000 }
    const result = await askAssistant('how do i go live')
    // Previously this returned {kind:'throttled'} and every chat surface did an
    // early `return` — the room saw silence and the asker saw a local notice.
    expect(result.kind).toBe('answer')
    if (result.kind !== 'answer') throw new Error('unreachable')
    expect(result.source).toBe('offline')
    expect(result.answer).toMatch(/live/i)
  })

  it('still shows the throttle notice when the bank genuinely does not know', async () => {
    askResponse = { ok: false, rateLimited: true, retryAfterMs: 8000 }
    const result = await askAssistant('who is leading the leaf village cup bracket')
    expect(result.kind).toBe('throttled')
    if (result.kind !== 'throttled') throw new Error('unreachable')
    expect(result.retryAfterMs).toBe(8000)
    expect(result.message).toMatch(/8s/)
  })

  it('falls back to the bank when the model errors or the backend is unreachable', async () => {
    askThrows = true
    const thrown = await askAssistant('why are my clips not grouping with my squad')
    expect(thrown.kind).toBe('answer')

    askThrows = false
    askResponse = { ok: false, error: 'vertex 503' }
    const errored = await askAssistant('how do i connect my youtube')
    expect(errored.kind).toBe('answer')
    if (errored.kind !== 'answer') throw new Error('unreachable')
    expect(errored.source).toBe('offline')
  })

  it('NEVER pre-empts the model — a live answer always wins and the call is always made', async () => {
    // The bank is a fallback, not a router. If it ever short-circuited the call
    // it would be a cap on the answer surface dressed up as a saving.
    askResponse = { ok: true, answer: 'The live grounded answer.' }
    const result = await askAssistant('how do i go live')
    expect(askCalls).toBe(1)
    expect(result.kind).toBe('answer')
    if (result.kind !== 'answer') throw new Error('unreachable')
    expect(result.source).toBe('model')
    expect(result.answer).toBe('The live grounded answer.')
  })
})

/** A question that lands on a given bank entry, for the price sweep above. */
function seedFor(id: string): string {
  const seeds: Record<string, string> = {
    'clip-grouping-clock': 'my clips are not showing up with my squad',
    'go-live': 'how do i go live',
    'connect-youtube': 'how do i connect my youtube',
    'make-clip': 'how do i make a clip',
    'manage-clan-roster': 'how do i add a player to a clan roster',
    'run-tournament': 'how do i host a tournament',
    'join-clan': 'how do i join a clan',
    'tko-king': 'what is tko king',
    'tier-features': 'what does legend include',
    'stat-check': 'what is a stat check',
    'enter-tournament': 'how do i enter a tournament',
    'sweeps-vs-tokens': 'what are give points',
    ads: 'how do i remove ads',
    conquest: 'what is conquest',
    'power-level': 'what is my power level',
    'video-status': 'why is my clip stuck processing',
    'multi-angle': 'how do i add my angle',
    'sign-in': 'the create button is missing',
  }
  const seed = seeds[id]
  if (!seed) throw new Error(`answerBank entry "${id}" has no seed question in this test`)
  return seed
}
