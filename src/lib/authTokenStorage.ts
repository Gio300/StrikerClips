import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

export const AUTH_TOKEN_KEY = 'kc_token'

function readLocalToken(): string | null {
  try { return localStorage.getItem(AUTH_TOKEN_KEY) } catch { return null }
}

function writeLocalToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token)
    else localStorage.removeItem(AUTH_TOKEN_KEY)
  } catch { /* WebView storage may be unavailable during startup. */ }
}

/** Synchronous copy used by request code after initial hydration. */
export function currentAuthToken(): string | null {
  return readLocalToken()
}

/**
 * Restore the durable native token and migrate existing localStorage sessions.
 * Browser builds continue to use localStorage only.
 */
export async function readAuthToken(): Promise<string | null> {
  const localToken = readLocalToken()
  if (!Capacitor.isNativePlatform()) return localToken

  try {
    const { value } = await Preferences.get({ key: AUTH_TOKEN_KEY })
    if (value) {
      writeLocalToken(value)
      return value
    }
    if (localToken) {
      await Preferences.set({ key: AUTH_TOKEN_KEY, value: localToken })
    }
  } catch { /* Keep the WebView copy as a fallback. */ }
  return localToken
}

/** Persist before returning from login so an immediate Android kill is safe. */
export async function writeAuthToken(token: string | null): Promise<void> {
  writeLocalToken(token)
  if (!Capacitor.isNativePlatform()) return

  try {
    if (token) await Preferences.set({ key: AUTH_TOKEN_KEY, value: token })
    else await Preferences.remove({ key: AUTH_TOKEN_KEY })
  } catch { /* The local copy still keeps browser behavior intact. */ }
}
