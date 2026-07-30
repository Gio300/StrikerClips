export const DEFAULT_ANDROID_APK_URL =
  'https://storage.googleapis.com/reelone-498406-downloads/TKO-latest.apk'

export const DEFAULT_MOBILE_VERSION_URL = 'https://tko.cam/mobile-version.json'

export interface NativeVersionManifest {
  versionCode: number
  versionName: string
  buildId: string
  builtAt?: number
  apkUrl: string
}

export function supportsNativeAndroidUpdate(platform: string): boolean {
  return platform === 'android'
}

export function shouldUseAndroidSideloadUpdates(
  platform: string,
  sideloadFlag: string | undefined,
): boolean {
  return supportsNativeAndroidUpdate(platform) && sideloadFlag === '1'
}

function asPositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function parseNativeBuild(value: unknown): number | null {
  return asPositiveInteger(value)
}

export function parseNativeVersionManifest(raw: unknown): NativeVersionManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const versionCode = asPositiveInteger(obj.versionCode)
  if (versionCode === null) return null

  const versionName =
    typeof obj.versionName === 'string' && obj.versionName.trim()
      ? obj.versionName.trim()
      : versionCode.toString()
  const buildId =
    typeof obj.buildId === 'string' && obj.buildId.trim()
      ? obj.buildId.trim()
      : `android-${versionCode}`

  let apkUrl = DEFAULT_ANDROID_APK_URL
  if (typeof obj.apkUrl === 'string' && obj.apkUrl.trim()) {
    try {
      const parsed = new URL(obj.apkUrl.trim())
      if (parsed.protocol !== 'https:') return null
      apkUrl = parsed.toString()
    } catch {
      return null
    }
  }

  const builtAt = asPositiveInteger(obj.builtAt) ?? undefined
  return { versionCode, versionName, buildId, builtAt, apkUrl }
}

export function shouldPromptNativeUpdate(
  runningVersionCode: number | null | undefined,
  available: NativeVersionManifest | null | undefined,
): boolean {
  return (
    typeof runningVersionCode === 'number' &&
    Number.isSafeInteger(runningVersionCode) &&
    runningVersionCode > 0 &&
    Boolean(available && available.versionCode > runningVersionCode)
  )
}

export function resolveMobileVersionUrl(apiBase?: string | null): string {
  const raw = (apiBase ?? '').trim()
  if (!raw) return DEFAULT_MOBILE_VERSION_URL
  try {
    const parsed = new URL(raw)
    return new URL('/mobile-version.json', `${parsed.origin}/`).toString()
  } catch {
    return DEFAULT_MOBILE_VERSION_URL
  }
}
