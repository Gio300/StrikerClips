import { beforeEach, describe, expect, it, vi } from 'vitest'

const nativeState = vi.hoisted(() => ({ enabled: true, values: new Map<string, string>() }))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => nativeState.enabled },
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: nativeState.values.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { nativeState.values.set(key, value) },
    remove: async ({ key }: { key: string }) => { nativeState.values.delete(key) },
  },
}))

import { AUTH_TOKEN_KEY, currentAuthToken, readAuthToken, writeAuthToken } from './authTokenStorage'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
}

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  nativeState.enabled = true
  nativeState.values.clear()
})

describe('native auth token storage', () => {
  it('restores a session after WebView localStorage is lost', async () => {
    await writeAuthToken('signed-jwt')
    storage.clear()

    expect(await readAuthToken()).toBe('signed-jwt')
    expect(currentAuthToken()).toBe('signed-jwt')
  })

  it('migrates an existing localStorage session into native preferences', async () => {
    storage.setItem(AUTH_TOKEN_KEY, 'legacy-jwt')

    expect(await readAuthToken()).toBe('legacy-jwt')
    expect(nativeState.values.get(AUTH_TOKEN_KEY)).toBe('legacy-jwt')
  })

  it('removes both copies on sign out', async () => {
    await writeAuthToken('signed-jwt')
    await writeAuthToken(null)

    expect(currentAuthToken()).toBeNull()
    expect(nativeState.values.has(AUTH_TOKEN_KEY)).toBe(false)
  })

  it('leaves browser builds on localStorage', async () => {
    nativeState.enabled = false
    await writeAuthToken('browser-jwt')

    expect(await readAuthToken()).toBe('browser-jwt')
    expect(nativeState.values.has(AUTH_TOKEN_KEY)).toBe(false)
  })
})
