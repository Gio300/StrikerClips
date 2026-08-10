import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tierLabel, TIER_LABELS } from '../lib/payments'

/**
 * THE CANCEL BUTTON HAS TO BE THERE, AND HAVE TO SAY "CANCEL".
 *
 * The compliance gap (2026-08-04): paid subscribers had no way to cancel in the
 * app at all — the only in-app control ended a free trial. The FTC
 * negative-option rule and the state auto-renewal statutes require cancellation
 * to be at least as easy as signup, and signup is two clicks on /upgrade.
 *
 * So what is worth pinning is not the component's internals but the two facts a
 * regulator (or an angry subscriber about to file a chargeback) checks: the
 * control is rendered on every surface a person would look at, and its LABEL
 * contains the word "cancel" — a button that only says "manage" is the exact
 * dark-pattern the rules call out.
 */

const SRC = join(__dirname, '..')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')
const PANEL = read('components/ManageSubscriptionPanel.tsx')

describe('ManageSubscriptionPanel — the label a subscriber searches for', () => {
  it('says "cancel" on the button itself, not just in the small print', () => {
    const button = PANEL.match(/<button[\s\S]*?<\/button>/)?.[0] ?? ''
    expect(button.toLowerCase()).toContain('cancel')
  })

  it('opens the Stripe portal rather than a home-grown cancel flow', () => {
    expect(PANEL).toContain('requestBillingPortal')
    expect(PANEL).toContain('window.location.href')
  })

  it('states plainly that no email or phone call is required', () => {
    expect(PANEL.toLowerCase()).toContain('no email and no phone call')
  })

  it('shows the plan and its renewal / end date above the button', () => {
    expect(PANEL).toContain('describeRenewal')
    expect(PANEL).toContain('tierLabel')
  })

  it('answers the never-paid case with a sentence, not an error', () => {
    expect(PANEL).toContain('nothing to cancel')
  })

  it('keeps the exit visible for a lapsed subscriber (gated on the CUSTOMER, not the tier)', () => {
    // Gating on an active tier would hide the button from exactly the person
    // with a failed card who still needs to stop the billing.
    expect(PANEL).toContain('billing.hasBillingAccount')
  })
})

describe('ManageSubscriptionPanel — rendered where people look', () => {
  const SURFACES = ['pages/Upgrade.tsx', 'pages/Profile.tsx']

  for (const surface of SURFACES) {
    it(`${surface} renders it`, () => {
      const source = read(surface)
      expect(source).toContain("from '@/components/ManageSubscriptionPanel'")
      expect(source).toMatch(/<ManageSubscriptionPanel\b/)
    })
  }

  it('sits above the tier grid on the membership page', () => {
    const upgrade = read('pages/Upgrade.tsx')
    const panel = upgrade.indexOf('<ManageSubscriptionPanel')
    // The FIRST rendered slice of the ladder, whatever it is currently sliced
    // at — matching the exact index made this test a hostage of the pricing
    // page's layout (it broke when the $1.99 rung was retired and the Free card
    // stopped sharing a row with it).
    const grid = upgrade.search(/TIERS\.slice\(/)
    expect(panel).toBeGreaterThan(-1)
    expect(grid).toBeGreaterThan(-1)
    // Nobody should have to scroll past the upsells to find the exit — and a
    // retired subscriber looking to cancel has no card of their own to click.
    expect(panel).toBeLessThan(grid)
  })

  it('refreshes the account after a return from the portal', () => {
    const upgrade = read('pages/Upgrade.tsx')
    expect(upgrade).toContain("billing")
    expect(upgrade).toContain('refreshUser')
  })
})

describe('tierLabel', () => {
  it('names each paid tier the way the rest of the app does', () => {
    expect(tierLabel('ad_free')).toBe('Ad-Free')
    expect(tierLabel('pro')).toBe('Pro')
    expect(tierLabel('supporter')).toBe('Elite')
    expect(tierLabel('creator')).toBe('Legend')
    expect(Object.keys(TIER_LABELS).sort()).toEqual(['ad_free', 'creator', 'pro', 'supporter'])
  })

  it('reads free for the empty tier and anything unknown', () => {
    expect(tierLabel('')).toBe('Free')
    expect(tierLabel(null)).toBe('Free')
    expect(tierLabel(undefined)).toBe('Free')
    expect(tierLabel('god_mode')).toBe('Free')
  })
})
