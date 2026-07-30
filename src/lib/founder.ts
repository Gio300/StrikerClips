/**
 * Founder / reviewer bypass.
 *
 * A passphrase entered on the splash screen sets a localStorage flag that puts
 * the app into "founder mode": every paid gate is unlocked (see
 * useEntitlements). This exists so an app-store reviewer — or the dev — can see
 * the full product without a live billing system, and for local testing.
 *
 * SECURITY NOTE: the passphrase lives in the client bundle (see Splash.tsx) and
 * this flag is just localStorage. This is a reviewer/dev bypass, NOT real
 * security — never gate anything sensitive on it server-side.
 */

const FOUNDER_KEY = 'tko_founder'
const LEGACY_FOUNDER_KEY = 'kc_founder'

/**
 * Display name / author label used whenever the founder posts content or
 * creates/uploads videos. When founder mode is active, posts and videos are
 * attributed to this handle instead of the real account name.
 */
export const FOUNDER_NAME = 'PatternAft3r'

/**
 * Resolve the display name to stamp on a NEW post/video. In founder mode this
 * is always the founder handle; otherwise the caller's real name (or '' if
 * none is available). Keep this the single source of truth so authoring points
 * don't scatter isFounder() checks.
 */
export function effectiveDisplayName(realName: string | null | undefined): string {
  return isFounder() ? FOUNDER_NAME : (realName ?? '')
}

/** True if founder mode has been unlocked on this device. */
export function isFounder(): boolean {
  try {
    const unlocked = localStorage.getItem(FOUNDER_KEY) === '1'
    if (unlocked) return true

    // Preserve access for devices unlocked before the TKO rebrand, then remove
    // the retired key so all future reads use the current product namespace.
    if (localStorage.getItem(LEGACY_FOUNDER_KEY) === '1') {
      localStorage.setItem(FOUNDER_KEY, '1')
      localStorage.removeItem(LEGACY_FOUNDER_KEY)
      return true
    }
    return false
  } catch {
    // SSR / private-mode / disabled storage — treat as not a founder.
    return false
  }
}

/** Turn founder mode on (called after a correct passphrase). */
export function setFounder(on: boolean): void {
  try {
    if (on) localStorage.setItem(FOUNDER_KEY, '1')
    else localStorage.removeItem(FOUNDER_KEY)
    localStorage.removeItem(LEGACY_FOUNDER_KEY)
  } catch {
    // no-op if storage is unavailable
  }
}
