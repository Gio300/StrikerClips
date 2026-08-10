import { describe, expect, it } from 'vitest'
import { answerFor } from './CommandBar'

describe('Ask TKO authentication guidance', () => {
  it('explains why the tournament Create button is missing when logged out', () => {
    const answer = answerFor(
      'Why can I not make a tournament? The Create button is missing.',
      0,
      false,
    )

    expect(answer).toContain('need to sign in')
    expect(answer).toContain('Create button')
    expect(answer).toContain('return to Tournaments')
  })

  it('directs a signed-in player to the tournament Create control', () => {
    const answer = answerFor('How do I make a tournament?', 200, true)

    expect(answer).toContain('open Tournaments and tap Create')
    expect(answer).not.toContain('need to sign in')
  })

  it('does not advertise entitlement-code redemption in a store build', () => {
    const answer = answerFor('How do I share a starter pass code?', 200, true, 'SSL', false)

    expect(answer).toContain('not available in this version')
    expect(answer).not.toContain('redeem')
    expect(answer).not.toContain('starter pass')
  })
})
