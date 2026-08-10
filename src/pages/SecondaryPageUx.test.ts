import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasPublishedMatchMedia } from './MatchDetail'
import { kingMatchStatusLabel } from '@/components/KingLadderPanel'

const readPage = (name: string) => readFileSync(join(__dirname, `${name}.tsx`), 'utf8')

describe('secondary-page recovery and plain-language UX', () => {
  it('keeps the permanent King ladder separate from the dated crown event', () => {
    const king = readPage('TkoKing')
    const board = readPage('TkoKingBoard')
    expect(king).toContain('Permanent ladder · open now')
    expect(king).toContain('Seasonal crown event ·')
    expect(board).toContain('separate from the always-open ladder')
    expect(board).toContain('Back to King ladder')
  })

  it('explains pending and disputed King reports without exposing raw states', () => {
    const ladder = readFileSync(join(__dirname, '../components/KingLadderPanel.tsx'), 'utf8')
    expect(kingMatchStatusLabel('awaiting_confirmation')).toBe('Waiting for confirmation')
    expect(kingMatchStatusLabel('disputed')).toBe('Reports do not match')
    expect(ladder).toContain('No rating changed')
    expect(ladder).toContain('I lost')
    expect(ladder).not.toContain('Opponent won')
  })

  it('gives the match directory search, bounded loading, retry, and useful empty actions', () => {
    const matches = readPage('Matches')
    expect(matches).toContain(".ilike('name'")
    expect(matches).toContain('.limit(50)')
    expect(matches).toContain('Try again')
    expect(matches).toContain('Browse tournaments')
  })

  it('shows a waiting state only when a published match has no attached media', () => {
    expect(hasPublishedMatchMedia({ clipCount: 0, reelCount: 0, hasHostVersion: false })).toBe(false)
    expect(hasPublishedMatchMedia({ clipCount: 1, reelCount: 0, hasHostVersion: false })).toBe(true)
    expect(hasPublishedMatchMedia({ clipCount: 0, reelCount: 1, hasHostVersion: false })).toBe(true)
    expect(hasPublishedMatchMedia({ clipCount: 0, reelCount: 0, hasHostVersion: true })).toBe(true)
    expect(readPage('MatchDetail')).toContain('Video is not ready yet')
  })

  it('shows the balance changed by the daily Oracle-ticket claim', () => {
    const store = readPage('Store')
    expect(store).toContain('oracle_tickets: oracleTickets')
    expect(store).toContain('Oracle tickets</div>')
    expect(store).not.toContain('Bet them')
  })

  it('keeps secondary-page CTAs on real routes and hides deployment internals', () => {
    expect(readPage('Rewards')).toContain('to="/upgrade"')
    expect(readPage('Rewards')).not.toContain('to="/pricing"')
    expect(readPage('Store')).not.toContain('Payments are not enabled on this deploy')
    expect(readPage('Upgrade')).not.toContain('Payments are not available on this deploy')
    expect(readPage('PhysicalMerch')).not.toContain('Checkout client secret is missing')
  })

  it('keeps password-reset failures visible and recoverable', () => {
    const forgot = readPage('ForgotPassword')
    const reset = readPage('ResetPassword')
    expect(forgot).toContain('The reset email could not be sent')
    expect(forgot).toContain('role="alert"')
    expect(reset).toContain('Request another link')
    expect(reset).toContain('role="alert"')
  })

  it('does not silently put malformed text into the clip tray', () => {
    const browser = readPage('Browser')
    expect(browser).toContain('isStashable(url)')
    expect(browser).toContain('Paste a full https:// clip link first')
    expect(browser).toContain('role="status"')
  })
})
