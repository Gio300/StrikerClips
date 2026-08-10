import { describe, expect, it } from 'vitest'
import { messageOverlayDecision } from './MessageNotificationOverlay'

describe('message notification overlay polling', () => {
  it('shows the first message that arrives after an empty initial poll', () => {
    const initial = messageOverlayDecision(false, null, null)
    expect(initial).toEqual({ initialized: true, baselineId: null, show: false })

    expect(messageOverlayDecision(initial.initialized, initial.baselineId, 'message-1')).toEqual({
      initialized: true,
      baselineId: 'message-1',
      show: true,
    })
  })

  it('does not replay an unread message that existed when the app opened', () => {
    const initial = messageOverlayDecision(false, null, 'message-1')
    expect(initial.show).toBe(false)
    expect(messageOverlayDecision(true, initial.baselineId, 'message-1').show).toBe(false)
  })

  it('shows a later message exactly once', () => {
    const next = messageOverlayDecision(true, 'message-1', 'message-2')
    expect(next.show).toBe(true)
    expect(messageOverlayDecision(true, next.baselineId, 'message-2').show).toBe(false)
  })
})
