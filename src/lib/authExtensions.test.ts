import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: { auth: {} } }))

import { nativeSessionTransferTarget } from './authExtensions'

describe('nativeSessionTransferTarget', () => {
  it('uses the league-specific registered URL scheme', () => {
    expect(nativeSessionTransferTarget('shinobistrikerleague')).toBe('shinobistrikerleague://auth')
  })

  it('normalizes unsafe scheme text and retains a safe default', () => {
    expect(nativeSessionTransferTarget(' SSL League! ')).toBe('sslleague://auth')
    expect(nativeSessionTransferTarget(' !!! ')).toBe('tkocam://auth')
  })
})
