import { describe, it, expect } from 'vitest'
import {
  computeInstallState,
  shouldShowInstallCta,
  detectIos,
  detectStandalone,
  type InstallInputs,
} from './installPrompt'

const base: InstallInputs = {
  standalone: false,
  installed: false,
  promptAvailable: false,
  ios: false,
}

describe('computeInstallState', () => {
  it('offers a one-tap install when a deferred prompt is held', () => {
    expect(computeInstallState({ ...base, promptAvailable: true })).toBe('available')
  })

  it('falls back to Add-to-Home-Screen instructions on iOS', () => {
    // iOS Safari never fires beforeinstallprompt, so a button would be dead.
    expect(computeInstallState({ ...base, ios: true })).toBe('ios-instructions')
  })

  it('renders nothing where no install path exists', () => {
    expect(computeInstallState(base)).toBe('unavailable')
  })

  it('never nags a user who is already installed', () => {
    expect(computeInstallState({ ...base, standalone: true, promptAvailable: true })).toBe('installed')
    expect(computeInstallState({ ...base, installed: true, promptAvailable: true })).toBe('installed')
    expect(computeInstallState({ ...base, standalone: true, ios: true })).toBe('installed')
  })

  it('prefers the real prompt over instructions if both somehow apply', () => {
    expect(computeInstallState({ ...base, ios: true, promptAvailable: true })).toBe('available')
  })
})

describe('shouldShowInstallCta', () => {
  it('shows only for the two actionable states', () => {
    expect(shouldShowInstallCta('available')).toBe(true)
    expect(shouldShowInstallCta('ios-instructions')).toBe(true)
    expect(shouldShowInstallCta('installed')).toBe(false)
    expect(shouldShowInstallCta('unavailable')).toBe(false)
  })
})

describe('detectIos', () => {
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  const IPAD =
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  const IPAD_DESKTOP_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
  const ANDROID =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
  const MAC_DESKTOP =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

  it('matches iPhone and iPad', () => {
    expect(detectIos(IPHONE)).toBe(true)
    expect(detectIos(IPAD)).toBe(true)
  })

  it('matches iPadOS in desktop-UA mode, which is only visible via touch points', () => {
    expect(detectIos(IPAD_DESKTOP_UA, 5)).toBe(true)
    expect(detectIos(IPAD_DESKTOP_UA, 0)).toBe(false)
  })

  it('never matches Android, which has a real install prompt', () => {
    expect(detectIos(ANDROID)).toBe(false)
    expect(detectIos(ANDROID, 5)).toBe(false)
  })

  it('does not match a desktop Mac', () => {
    expect(detectIos(MAC_DESKTOP)).toBe(false)
  })

  it('is safe with no user-agent at all', () => {
    expect(detectIos(undefined)).toBe(false)
    expect(detectIos('')).toBe(false)
    expect(detectIos(null)).toBe(false)
  })
})

describe('detectStandalone', () => {
  it('accepts either the Chromium media query or the iOS legacy flag', () => {
    expect(detectStandalone({ displayModeStandalone: true })).toBe(true)
    expect(detectStandalone({ navigatorStandalone: true })).toBe(true)
    expect(detectStandalone({})).toBe(false)
    expect(detectStandalone({ displayModeStandalone: false, navigatorStandalone: false })).toBe(false)
  })
})
