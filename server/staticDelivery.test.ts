import { describe, expect, it } from 'vitest'
import { shouldServeSpaShell } from './staticDelivery'

describe('static delivery fallthrough', () => {
  it('serves the SPA shell for real client-side routes', () => {
    expect(shouldServeSpaShell('/')).toBe(true)
    expect(shouldServeSpaShell('/tournaments/abc')).toBe(true)
    expect(shouldServeSpaShell('/profile/player-one?tab=clips')).toBe(true)
    expect(shouldServeSpaShell('/reset-password?token=one-time-code')).toBe(true)
  })

  it('never disguises a missing build asset as index.html', () => {
    expect(shouldServeSpaShell('/assets/index-missing.js')).toBe(false)
    expect(shouldServeSpaShell('/assets/styles-missing.css')).toBe(false)
    expect(shouldServeSpaShell('/icons/missing.png')).toBe(false)
    expect(shouldServeSpaShell('/sw.js')).toBe(false)
  })

  it('keeps unknown API routes out of the SPA', () => {
    expect(shouldServeSpaShell('/api')).toBe(false)
    expect(shouldServeSpaShell('/api/not-real')).toBe(false)
  })
})
