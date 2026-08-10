import { describe, expect, it } from 'vitest'
import { creatorCommerceError } from './creatorCommerceApi'

describe('creatorCommerceError', () => {
  it('turns Stripe setup and network failures into useful player messages', () => {
    expect(creatorCommerceError('stripe_not_configured')).toMatch(/payouts are not available yet/i)
    expect(creatorCommerceError('Failed to fetch')).toMatch(/check your connection/i)
  })

  it('does not expose unknown internal error codes', () => {
    expect(creatorCommerceError('database_timeout', 'Please try again.')).toBe('Please try again.')
  })

  it('preserves already-readable server guidance', () => {
    expect(creatorCommerceError('Complete your Stripe identity check first.')).toBe(
      'Complete your Stripe identity check first.',
    )
  })
})
