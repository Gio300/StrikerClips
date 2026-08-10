import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * §8.3 HAS TO DESCRIBE THE CANCELLATION PATH THAT ACTUALLY EXISTS.
 *
 * The published Terms are a representation to consumers and to the FTC. Before
 * this change the honest wording was "email us to cancel", because that was the
 * only route a paid subscriber had. Now the app opens Stripe's Customer Portal
 * from /upgrade and from the profile Billing section, so §8.3 must say so —
 * and, just as importantly, must stop presenting email as the required route.
 *
 * The file header already tells the next editor to change this page in the same
 * commit as the cancellation path. These tests make that instruction enforceable
 * rather than advisory: if the button is renamed or moved, §8.3 stops matching
 * and the suite fails.
 */

const TERMS = readFileSync(join(__dirname, 'Terms.tsx'), 'utf8')

/** Section 8.3 through to the start of section 9. */
function section83(): string {
  const start = TERMS.indexOf('8.3 How to cancel')
  const end = TERMS.indexOf('9. Creator Payouts')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return TERMS.slice(start, end)
}

describe('Terms §8.3 — the in-app cancellation it now promises', () => {
  const s = section83()

  it('leads with cancelling in the app, not with emailing support', () => {
    const inApp = s.indexOf('in the app')
    const email = s.indexOf('mailto:')
    expect(inApp).toBeGreaterThan(-1)
    expect(email).toBeGreaterThan(-1)
    expect(inApp).toBeLessThan(email)
  })

  it('names the control by the exact label the button carries', () => {
    // src/components/ManageSubscriptionPanel.tsx renders this string.
    const panel = readFileSync(join(__dirname, '..', 'components', 'ManageSubscriptionPanel.tsx'), 'utf8')
    expect(panel).toContain('Manage or cancel subscription')
    expect(s).toContain('Manage or cancel subscription')
  })

  it('points at both places the control lives', () => {
    expect(s).toContain('/upgrade')
    expect(s).toContain('/profile')
    expect(s).toContain('Billing')
  })

  it('says which processor page opens, since the user leaves our domain', () => {
    expect(s).toContain('Stripe')
  })

  it('promises no retention hoops — the thing the FTC rule is actually about', () => {
    expect(s).toContain('no more steps than subscribing')
    expect(s.toLowerCase()).toContain('retention offer')
  })

  it('keeps email only as an explicit BACKUP for locked-out accounts', () => {
    expect(s).toContain('backup route, not the required one')
    // The old wording made email THE way to cancel a paid plan. It must be gone.
    expect(s).not.toContain('To cancel a paid subscription</strong>, email')
  })

  it('still states the period-end and 24-hour rules it always did', () => {
    expect(s).toContain('24 hours before')
    expect(s).toContain('you keep the tier you paid for until that period runs out')
  })
})

describe('Terms — the surrounding promises stay true', () => {
  it('still tells subscribers the plan renews until they cancel (§8.2)', () => {
    expect(TERMS).toContain('every month, automatically, until you cancel')
  })

  it('still preserves extra state auto-renewal rights on top of §8.3', () => {
    expect(TERMS).toContain('cancel online in the same way you signed up')
  })

  it('carries a last-updated date', () => {
    expect(TERMS).toMatch(/LAST_UPDATED = '\d{4}-\d{2}-\d{2}'/)
  })
})
