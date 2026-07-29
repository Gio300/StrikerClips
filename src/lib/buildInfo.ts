import type { VersionPayload } from './appVersion'
import { isRealBuildId } from './appVersion'

/**
 * The build id of the bundle that is *currently running in this tab*.
 *
 * Stamped two independent ways by `vite.buildId.ts` so a single plumbing
 * mistake cannot silently disable the update prompt:
 *   1. `import.meta.env.VITE_BUILD_ID` — compiled into the JS chunk.
 *   2. `<meta name="tko-build" content="…">` — injected into the HTML shell.
 *
 * Falls back to 'dev', which `isRealBuildId` treats as "not comparable", so an
 * unstamped local dev build never shows an update banner.
 */

export const BUILD_META_NAME = 'tko-build'

export function readMetaBuildId(doc?: Document | null): string {
  try {
    const target = doc ?? (typeof document === 'undefined' ? null : document)
    if (!target) return ''
    const el = target.querySelector(`meta[name="${BUILD_META_NAME}"]`)
    return (el?.getAttribute('content') ?? '').trim()
  } catch {
    return ''
  }
}

function resolveBuildId(): string {
  const fromEnv = (import.meta.env.VITE_BUILD_ID ?? '').trim()
  if (isRealBuildId(fromEnv)) return fromEnv
  const fromMeta = readMetaBuildId()
  if (isRealBuildId(fromMeta)) return fromMeta
  return 'dev'
}

export const BUILD_ID = resolveBuildId()

/** The running build, in the same shape `/version.json` returns. */
export const RUNNING_VERSION: VersionPayload = { buildId: BUILD_ID }

/** Vite's resolved deploy base: '/' on mobile, '/app/' on the hosted web app. */
export const APP_BASE = import.meta.env.BASE_URL || '/'
