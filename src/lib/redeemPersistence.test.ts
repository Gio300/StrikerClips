import { describe, it, expect, beforeEach, vi } from 'vitest'
import { entitlementsFromUser } from './entitlements'

/**
 * Proves a redeemed tier STICKS across a reload on the mock backend:
 *   sign in -> redeem -> entitlement reads premium -> (simulate reload) -> still premium.
 *
 * The mock persists its session to localStorage, so a "reload" is modeled by
 * dropping the module cache (vi.resetModules) and re-importing mockSupabase with
 * the SAME localStorage still in place — exactly what a browser refresh does.
 */

// Minimal localStorage polyfill (the vitest node env has no DOM).
class MemStorage {
  private store = new Map<string, string>()
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null }
  setItem(k: string, v: string): void { this.store.set(k, String(v)) }
  removeItem(k: string): void { this.store.delete(k) }
  clear(): void { this.store.clear() }
}

async function loadMock() {
  const mod = await import('./mockSupabase')
  return mod.mockSupabase
}

beforeEach(() => {
  vi.resetModules()
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemStorage()
})

describe('redeem code persistence (mock backend)', () => {
  it('redeeming grants premium and it survives a reload', async () => {
    let supabase = await loadMock()

    await supabase.auth.signInWithPassword({ email: 'fan@test.dev', password: 'x' })

    // Before redeeming: free.
    const before = await supabase.auth.getUser()
    expect(entitlementsFromUser(before.data.user).isPremium).toBe(false)

    // Redeem a code -> grants pro with a future expiry.
    const { data, error } = await supabase.functions.invoke('redeem-code', { body: { code: 'KILLCAM-TEST' } })
    expect(error).toBeNull()
    expect(data.tier).toBe('pro')

    // In-session: entitlement now reads premium.
    const after = await supabase.auth.getUser()
    const ent = entitlementsFromUser(after.data.user)
    expect(ent.isPremium).toBe(true)
    expect(ent.tier).toBe('pro')
    expect(new Date(ent.tierExpiresAt as string).getTime()).toBeGreaterThan(Date.now())

    // The grant was written to persistent storage.
    expect(globalThis.localStorage.getItem('mock_session')).toContain('reelone_tier')

    // Simulate a reload: drop the module, re-import against the SAME storage.
    vi.resetModules()
    supabase = await loadMock()
    const reloaded = await supabase.auth.getSession()
    expect(entitlementsFromUser(reloaded.data.session?.user).isPremium).toBe(true)
  })

  it('emits USER_UPDATED so the auth listener refreshes after redeem', async () => {
    const supabase = await loadMock()
    await supabase.auth.signInWithPassword({ email: 'fan2@test.dev', password: 'x' })

    const events: string[] = []
    supabase.auth.onAuthStateChange((e: string) => events.push(e))

    await supabase.functions.invoke('redeem-code', { body: { code: 'KILLCAM-TEST' } })
    expect(events).toContain('USER_UPDATED')
  })

  it('updateUser persists metadata and notifies too', async () => {
    const supabase = await loadMock()
    await supabase.auth.signInWithPassword({ email: 'fan3@test.dev', password: 'x' })

    const events: string[] = []
    supabase.auth.onAuthStateChange((e: string) => events.push(e))

    await supabase.auth.updateUser({ data: { reelone_tier: 'creator', reelone_tier_expires: new Date(Date.now() + 1e9).toISOString() } })
    expect(events).toContain('USER_UPDATED')

    const { data } = await supabase.auth.getUser()
    expect(entitlementsFromUser(data.user).tier).toBe('creator')
    expect(globalThis.localStorage.getItem('mock_session')).toContain('creator')
  })
})
