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
export const BUILD_TIME_META_NAME = 'tko-built-at'

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

function resolveBuiltAt(): number | undefined {
  const fromEnv = Number(import.meta.env.VITE_BUILD_AT)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  try {
    const target = typeof document === 'undefined' ? null : document
    const raw = target
      ?.querySelector(`meta[name="${BUILD_TIME_META_NAME}"]`)
      ?.getAttribute('content')
    const fromMeta = Number(raw)
    return Number.isFinite(fromMeta) && fromMeta > 0 ? fromMeta : undefined
  } catch {
    return undefined
  }
}

/** The running build, in the same shape `/version.json` returns. */
const BUILT_AT = resolveBuiltAt()
export const RUNNING_VERSION: VersionPayload =
  BUILT_AT === undefined ? { buildId: BUILD_ID } : { buildId: BUILD_ID, builtAt: BUILT_AT }

/** Vite's resolved deploy base: '/' on mobile, '/app/' on the hosted web app. */
export const APP_BASE = import.meta.env.BASE_URL || '/'
