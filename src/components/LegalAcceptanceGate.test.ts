import { describe, expect, it } from 'vitest'
import { hasCurrentLegalAcceptance } from './LegalAcceptanceGate'
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legalVersions'

describe('legacy legal acceptance gate', () => {
  it('opens for legacy metadata and closes only for the current agreement', () => {
    expect(hasCurrentLegalAcceptance({})).toBe(false)
    expect(hasCurrentLegalAcceptance({
      terms_accepted: true,
      terms_version: TERMS_VERSION,
      terms_accepted_at: '2026-08-08T20:00:00.000Z',
      privacy_accepted: true,
      privacy_version: PRIVACY_VERSION,
    })).toBe(true)
  })

  it('rejects acceptance metadata with no valid server timestamp', () => {
    expect(hasCurrentLegalAcceptance({
      terms_accepted: true,
      terms_version: TERMS_VERSION,
      privacy_accepted: true,
      privacy_version: PRIVACY_VERSION,
    })).toBe(false)
  })
})
