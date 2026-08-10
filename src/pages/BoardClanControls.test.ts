import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { boardRailStartsOpen } from './BoardDetail'

const board = readFileSync(join(__dirname, 'BoardDetail.tsx'), 'utf8')

describe('clan board membership controls', () => {
  it('uses an exact owner-scoped delete for leaving and removes board membership too', () => {
    expect(board).toContain(".from('clan_members')")
    expect(board).toContain(".eq('id', viewerMembership.id)")
    expect(board).toContain(".eq('user_id', user.id)")
    expect(board).toContain(".from('server_members')")
    expect(board).toContain("Leaving clan...")
  })

  it('only renders management affordances when the loaded clan role permits them', () => {
    expect(board).toContain('isClanManagerRole(viewerRole)')
    expect(board).toContain("can(viewerRole, 'manage_channels')")
    expect(board).toContain('canLeaveClan(viewerRole)')
  })

  it('keeps failed channel creation visible to the player', () => {
    expect(board).toContain("setClanNotice(error.message || 'That channel could not be created.')")
    expect(board).toContain('<p role="alert"')
  })

  it('opens the channel rail on desktop but gives the conversation the phone width', () => {
    expect(boardRailStartsOpen(390)).toBe(false)
    expect(boardRailStartsOpen(639)).toBe(false)
    expect(boardRailStartsOpen(640)).toBe(true)
  })

  it('keeps a failed message in the composer and shows a visible error', () => {
    expect(board).toContain("setClanNotice(error.message || 'Your message could not be sent. Try again.')")
    expect(board.indexOf("setNewMessage('')")).toBeGreaterThan(board.indexOf('if (error)'))
  })
})
