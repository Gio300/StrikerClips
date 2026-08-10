import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ANDROID_APK_URL,
  androidInstallUrl,
  parseNativeBuild,
  parseNativeVersionManifest,
  resolveMobileVersionUrl,
  shouldPromptNativeUpdate,
  shouldUseAndroidSideloadUpdates,
  supportsNativeAndroidUpdate,
} from './nativeUpdate'

describe('native Android updates', () => {
  it('never gives a white-label league the shared TKO APK', () => {
    expect(androidInstallUrl(true, 'Shinobi Striker League')).toBeNull()
    expect(androidInstallUrl(true, null)).toBe(DEFAULT_ANDROID_APK_URL)
    expect(androidInstallUrl(false, null)).toBeNull()
  })

  it('allows a league deploy to name its own Android binary explicitly', () => {
    const sslApk = 'https://downloads.example/ssl.apk'
    expect(androidInstallUrl(true, 'Shinobi Striker League', sslApk)).toBe(sslApk)
  })

  it('parses the release manifest and supplies the default APK', () => {
    expect(
      parseNativeVersionManifest({
        versionCode: '42',
        versionName: '2026.07.29.1',
        buildId: 'android-42',
        builtAt: '1785360000000',
      }),
    ).toEqual({
      versionCode: 42,
      versionName: '2026.07.29.1',
      buildId: 'android-42',
      builtAt: 1785360000000,
      apkUrl: DEFAULT_ANDROID_APK_URL,
    })
  })

  it('rejects malformed, non-positive, or insecure releases', () => {
    expect(parseNativeVersionManifest(null)).toBeNull()
    expect(parseNativeVersionManifest({ versionCode: 0 })).toBeNull()
    expect(parseNativeVersionManifest({ versionCode: 'new' })).toBeNull()
    expect(
      parseNativeVersionManifest({
        versionCode: 2,
        apkUrl: 'http://example.test/TKO.apk',
      }),
    ).toBeNull()
  })

  it('prompts only when the published Android version code is higher', () => {
    const release = parseNativeVersionManifest({ versionCode: 12 })
    expect(shouldPromptNativeUpdate(11, release)).toBe(true)
    expect(shouldPromptNativeUpdate(12, release)).toBe(false)
    expect(shouldPromptNativeUpdate(13, release)).toBe(false)
    expect(shouldPromptNativeUpdate(null, release)).toBe(false)
  })

  it('reads Capacitor build numbers safely', () => {
    expect(parseNativeBuild('101')).toBe(101)
    expect(parseNativeBuild(101)).toBe(101)
    expect(parseNativeBuild('1.2')).toBeNull()
    expect(parseNativeBuild('')).toBeNull()
  })

  it('derives the manifest from the absolute mobile API origin', () => {
    expect(resolveMobileVersionUrl('https://tko.cam')).toBe(
      'https://tko.cam/mobile-version.json',
    )
    expect(resolveMobileVersionUrl('https://tko.cam/api')).toBe(
      'https://tko.cam/mobile-version.json',
    )
    expect(resolveMobileVersionUrl('/api')).toBe('https://tko.cam/mobile-version.json')
  })

  it('only enables direct native updates on Android', () => {
    expect(supportsNativeAndroidUpdate('android')).toBe(true)
    expect(supportsNativeAndroidUpdate('ios')).toBe(false)
    expect(supportsNativeAndroidUpdate('web')).toBe(false)
    expect(shouldUseAndroidSideloadUpdates('android', '1')).toBe(true)
    expect(shouldUseAndroidSideloadUpdates('android', undefined)).toBe(false)
    expect(shouldUseAndroidSideloadUpdates('ios', '1')).toBe(false)
  })
})
