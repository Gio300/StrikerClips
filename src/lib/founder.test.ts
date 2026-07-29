import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { effectiveDisplayName, FOUNDER_NAME, setFounder } from './founder'

// isFounder()/setFounder() read+write localStorage, which doesn't exist in the
// default (node) vitest environment. Provide a tiny in-memory stub so we can
// toggle founder mode on/off inside the test.
describe('effectiveDisplayName', () => {
  const store: Record<string, string> = {}
  const fakeStorage = {
    getItem: (k: string): string | null => (k in store ? store[k] : null),
    setItem: (k: string, v: string): void => {
      store[k] = v
    },
    removeItem: (k: string): void => {
      delete store[k]
    },
  }

  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
    ;(globalThis as unknown as { localStorage: typeof fakeStorage }).localStorage = fakeStorage
  })

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('returns the real name when not in founder mode', () => {
    setFounder(false)
    expect(effectiveDisplayName('bob')).toBe('bob')
    expect(effectiveDisplayName(null)).toBe('')
    expect(effectiveDisplayName(undefined)).toBe('')
  })

  it('returns the founder name when founder mode is active', () => {
    setFounder(true)
    expect(FOUNDER_NAME).toBe('PatternAft3r')
    expect(effectiveDisplayName('bob')).toBe(FOUNDER_NAME)
    expect(effectiveDisplayName(null)).toBe(FOUNDER_NAME)
    expect(effectiveDisplayName(undefined)).toBe(FOUNDER_NAME)
  })
})
