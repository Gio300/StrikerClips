/**
 * The "Install app" availability state machine.
 *
 * Installing a PWA is one of the least uniform things on the web:
 *   • Chromium fires `beforeinstallprompt`, which we stash and replay on tap.
 *   • iOS Safari fires nothing — the user must use Share → Add to Home Screen,
 *     so the only honest UI is a short instruction, not a button.
 *   • Already-installed / already-standalone users must see nothing at all.
 *   • Everything else (Firefox desktop, in-app webviews) can't install, and a
 *     button that does nothing is worse than no button.
 *
 * Getting that wrong ships a dead CTA, so the decision lives here as pure
 * functions with tests rather than inline in a component.
 */

export type InstallState =
  /** Running as an installed app already — offer nothing. */
  | 'installed'
  /** We hold a deferred `beforeinstallprompt` — a real one-tap install. */
  | 'available'
  /** iOS: no programmatic install, show Add-to-Home-Screen instructions. */
  | 'ios-instructions'
  /** No install path on this browser — render nothing rather than a dead button. */
  | 'unavailable'

export interface InstallInputs {
  /** Display-mode is standalone / iOS `navigator.standalone`. */
  standalone: boolean
  /** An `appinstalled` event has fired this session. */
  installed: boolean
  /** A `beforeinstallprompt` event is stashed and still usable. */
  promptAvailable: boolean
  /** The platform is iOS (or iPadOS in desktop-UA mode). */
  ios: boolean
}

/**
 * Order matters and is deliberate:
 *   installed/standalone wins over everything (never nag an installed user),
 *   then a real prompt, then the iOS instructions, then nothing.
 *
 * Note Chromium can fire `beforeinstallprompt` on a page that is *also* already
 * installed in some edge cases; the standalone check first keeps that quiet.
 */
export function computeInstallState(input: InstallInputs): InstallState {
  if (input.standalone || input.installed) return 'installed'
  if (input.promptAvailable) return 'available'
  if (input.ios) return 'ios-instructions'
  return 'unavailable'
}

/** Whether the CTA should render at all. */
export function shouldShowInstallCta(state: InstallState): boolean {
  return state === 'available' || state === 'ios-instructions'
}

/**
 * iOS detection, including iPadOS 13+ which reports a Macintosh user-agent and
 * is only distinguishable by having a touch screen. Android must never match
 * (it has a real install prompt and would otherwise get useless instructions).
 */
export function detectIos(userAgent: string | null | undefined, maxTouchPoints = 0): boolean {
  const ua = (userAgent ?? '').trim()
  if (!ua) return false
  if (/android/i.test(ua)) return false
  if (/\b(iphone|ipod|ipad)\b/i.test(ua)) return true
  // iPadOS 13+ "Request Desktop Website" default.
  return /Macintosh/i.test(ua) && maxTouchPoints > 1
}

/**
 * Already running as an installed app. Chromium exposes this through the
 * `display-mode` media query; iOS only through the legacy
 * `navigator.standalone` boolean, so we accept either.
 */
export function detectStandalone(input: {
  displayModeStandalone?: boolean
  navigatorStandalone?: boolean
}): boolean {
  return Boolean(input.displayModeStandalone) || Boolean(input.navigatorStandalone)
}
