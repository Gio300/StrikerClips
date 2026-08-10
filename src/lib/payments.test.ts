import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  parsePortalResponse,
  describeRenewal,
  requestBillingPortal,
  fetchBillingSubscription,
  PORTAL_MESSAGES,
  BILLING_UNKNOWN,
} from './payments'

/**
 * SELF-SERVE CANCELLATION — the client half.
 *
 * The bug this suite exists to prevent is a cancel button that LOOKS broken to
 * the one group of users who legally must be able to cancel. Two failure modes
 * matter and both are asserted below:
 *
 *   1. "You have no subscription" rendered as a red error. A free user pressing
 *      Manage must get a sentence, not a failure — and a paid user must never
 *      see "nothing to cancel" because a fetch hiccuped.
 *   2. A cancelled plan still described as "Renews on …". That exact wording is
 *      what an auto-renewal regulator reads, so a cancelled subscription has to
 *      say ENDS, not renews.
 */

// The node test env has no DOM; the helpers read a bearer token from storage.
class MemStorage {
  store = new Map<string, string>()
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null }
  setItem(k: string, v: string): void { this.store.set(k, String(v)) }
  removeItem(k: string): void { this.store.delete(k) }
  clear(): void { this.store.clear() }
}

let realFetch: typeof globalThis.fetch
beforeEach(() => {
  realFetch = globalThis.fetch
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemStorage()
})
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Stub `fetch` with one canned reply, recording what was sent. */
function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init: any }[] = []
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as any
  }) as typeof globalThis.fetch
  return calls
}

describe('billing portal — reading the server\'s answer', () => {
  it('takes the portal URL on success', () => {
    const r = parsePortalResponse(200, { ok: true, url: 'https://billing.stripe.com/p/session/x' })
    expect(r).toEqual({ ok: true, url: 'https://billing.stripe.com/p/session/x' })
  })

  it('treats "you never paid" as an ANSWER, not an error', () => {
    const r = parsePortalResponse(200, { ok: false, error: 'no_customer', detail: 'no billing account' })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toBe('no_customer')
    // The copy must not read like a failure the user caused.
    expect(r.message).toBe(PORTAL_MESSAGES.no_customer)
    expect(r.message.toLowerCase()).not.toContain('error')
    expect(r.message.toLowerCase()).not.toContain('failed')
  })

  it('reports billing being switched off separately from a real failure', () => {
    for (const probe of [
      parsePortalResponse(503, { error: 'stripe_not_configured' }),
      parsePortalResponse(200, { ok: false, error: 'stripe_not_configured' }),
    ]) {
      expect(probe.ok).toBe(false)
      if (probe.ok) throw new Error('unreachable')
      expect(probe.reason).toBe('not_configured')
    }
  })

  it('passes the server\'s detail through on a genuine failure', () => {
    const r = parsePortalResponse(502, {
      ok: false, error: 'portal_not_configured',
      detail: 'your test mode default configuration has not been created',
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toBe('error')
    expect(r.message).toContain('default configuration')
  })

  it('never reports success on a malformed reply', () => {
    for (const bad of [null, {}, { ok: true }, { url: 'https://x' }]) {
      expect(parsePortalResponse(200, bad as any).ok).toBe(false)
    }
  })
})

describe('billing portal — the request itself', () => {
  it('POSTs to /billing/portal with the bearer token and the return path', async () => {
    localStorage.setItem('kc_token', 'jwt-abc')
    const calls = stubFetch(200, { ok: true, url: 'https://billing.stripe.com/p/session/x' })

    const r = await requestBillingPortal({ returnTo: '/profile' })
    expect(r).toEqual({ ok: true, url: 'https://billing.stripe.com/p/session/x' })
    expect(calls[0].url).toContain('/billing/portal')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers.Authorization).toBe('Bearer jwt-abc')
    expect(JSON.parse(calls[0].init.body).returnTo).toBe('/profile')
  })

  it('defaults the return path rather than sending nothing', async () => {
    const calls = stubFetch(200, { ok: true, url: 'https://billing.stripe.com/p/session/x' })
    await requestBillingPortal()
    expect(JSON.parse(calls[0].init.body).returnTo).toBe('/upgrade')
  })

  it('never throws when the network is down', async () => {
    globalThis.fetch = (async () => { throw new Error('offline') }) as typeof globalThis.fetch
    const r = await requestBillingPortal()
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toBe('error')
  })
})

describe('billing status — what the panel shows', () => {
  it('reads the server\'s subscription record', async () => {
    stubFetch(200, {
      configured: true, hasBillingAccount: true, tier: 'pro',
      tierExpiresAt: '2026-09-01T00:00:00.000Z',
      subscription: {
        id: 'sub_1', status: 'active', tier: 'pro',
        cancelAtPeriodEnd: false, currentPeriodEnd: '2026-09-01T00:00:00.000Z',
      },
    })
    const b = await fetchBillingSubscription()
    expect(b.hasBillingAccount).toBe(true)
    expect(b.tier).toBe('pro')
    expect(b.subscription?.status).toBe('active')
  })

  it('falls back to "no billing account" on any failure, so no dead button appears', async () => {
    stubFetch(500, { error: 'boom' })
    expect(await fetchBillingSubscription()).toEqual(BILLING_UNKNOWN)

    globalThis.fetch = (async () => { throw new Error('offline') }) as typeof globalThis.fetch
    expect(await fetchBillingSubscription()).toEqual(BILLING_UNKNOWN)
  })

  it('rejects a reply that is not the expected shape', async () => {
    stubFetch(200, { something: 'else' })
    expect(await fetchBillingSubscription()).toEqual(BILLING_UNKNOWN)
  })
})

describe('describeRenewal — a cancelled plan must never say "renews"', () => {
  const fmt = (iso: string) => iso.slice(0, 10)
  const sub = (over: Record<string, unknown> = {}) => ({
    subscription: {
      id: 'sub_1', status: 'active', tier: 'pro',
      cancelAtPeriodEnd: false, currentPeriodEnd: '2026-09-01T00:00:00.000Z',
      ...over,
    },
    tierExpiresAt: null,
  })

  it('says RENEWS while the plan is live', () => {
    expect(describeRenewal(sub(), fmt)).toBe('Renews 2026-09-01.')
  })

  it('says ENDS once it has been cancelled — the wording regulators read', () => {
    const line = describeRenewal(sub({ cancelAtPeriodEnd: true }), fmt)
    expect(line).toContain('Cancelled')
    expect(line).toContain('ends 2026-09-01')
    expect(line.toLowerCase()).not.toContain('renew')
  })

  it('calls a trial a trial and names the first charge date', () => {
    const line = describeRenewal(sub({ status: 'trialing' }), fmt)
    expect(line).toContain('Free trial')
    expect(line).toContain('first charge 2026-09-01')
    expect(line.toLowerCase()).not.toContain('renews')
  })

  it('tells a past-due subscriber what to actually do', () => {
    expect(describeRenewal(sub({ status: 'past_due' }), fmt)).toContain('update your card')
    expect(describeRenewal(sub({ status: 'unpaid' }), fmt)).toContain('update your card')
  })

  it('describes an already-ended subscription in the past tense', () => {
    const line = describeRenewal(sub({ status: 'canceled' }), fmt)
    expect(line).toContain('access ended')
    expect(line.toLowerCase()).not.toContain('renew')
  })

  it('falls back to the local expiry when Stripe told us nothing', () => {
    expect(describeRenewal({ subscription: null, tierExpiresAt: '2026-09-01T00:00:00.000Z' }, fmt))
      .toBe('Access runs to 2026-09-01.')
    expect(describeRenewal({ subscription: null, tierExpiresAt: null }, fmt)).toBe('')
  })

  it('still says something useful with no date at all', () => {
    expect(describeRenewal(sub({ currentPeriodEnd: null }), fmt)).toBe('Renews monthly.')
    expect(describeRenewal(sub({ currentPeriodEnd: null, cancelAtPeriodEnd: true }), fmt))
      .toContain('Cancelled')
  })
})
