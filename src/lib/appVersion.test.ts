import { describe, it, expect } from 'vitest'
import {
  isRealBuildId,
  parseVersionPayload,
  isNewerBuild,
  shouldPromptUpdate,
  normalizeBase,
  swUrl,
  swScope,
  versionUrl,
} from './appVersion'

/**
 * A false positive here reloads every tester's phone in a loop; a false
 * negative strands them on an old build forever. Both directions are pinned.
 */

describe('isRealBuildId', () => {
  it('accepts a stamped id', () => {
    expect(isRealBuildId('m8xk2p')).toBe(true)
    expect(isRealBuildId('2026.07.22-1')).toBe(true)
  })

  it('rejects the empties an unset env var degrades to', () => {
    expect(isRealBuildId('')).toBe(false)
    expect(isRealBuildId('   ')).toBe(false)
    expect(isRealBuildId('undefined')).toBe(false)
    expect(isRealBuildId('null')).toBe(false)
    expect(isRealBuildId('unknown')).toBe(false)
    expect(isRealBuildId(undefined)).toBe(false)
    expect(isRealBuildId(null)).toBe(false)
  })

  it('treats an unstamped dev build as not comparable', () => {
    expect(isRealBuildId('dev')).toBe(false)
    expect(isRealBuildId('DEV')).toBe(false)
  })
})

describe('parseVersionPayload', () => {
  it('reads a minimal payload', () => {
    expect(parseVersionPayload({ buildId: 'abc' })).toEqual({ buildId: 'abc' })
  })

  it('reads builtAt as epoch ms, numeric string, or ISO date', () => {
    expect(parseVersionPayload({ buildId: 'a', builtAt: 1700000000000 })).toEqual({
      buildId: 'a',
      builtAt: 1700000000000,
    })
    expect(parseVersionPayload({ buildId: 'a', builtAt: '1700000000000' })).toEqual({
      buildId: 'a',
      builtAt: 1700000000000,
    })
    expect(parseVersionPayload({ buildId: 'a', builtAt: '2023-11-14T22:13:20.000Z' })).toEqual({
      buildId: 'a',
      builtAt: 1700000000000,
    })
  })

  it('drops an unusable builtAt rather than failing the whole payload', () => {
    expect(parseVersionPayload({ buildId: 'a', builtAt: 'whenever' })).toEqual({ buildId: 'a' })
    expect(parseVersionPayload({ buildId: 'a', builtAt: NaN })).toEqual({ buildId: 'a' })
    expect(parseVersionPayload({ buildId: 'a', builtAt: null })).toEqual({ buildId: 'a' })
  })

  it('returns null for anything that is not a stamped payload', () => {
    // e.g. an HTML error page or the SPA fallback served instead of JSON.
    expect(parseVersionPayload(null)).toBeNull()
    expect(parseVersionPayload(undefined)).toBeNull()
    expect(parseVersionPayload('<!doctype html>')).toBeNull()
    expect(parseVersionPayload([{ buildId: 'a' }])).toBeNull()
    expect(parseVersionPayload({})).toBeNull()
    expect(parseVersionPayload({ buildId: '' })).toBeNull()
    expect(parseVersionPayload({ buildId: 'unknown' })).toBeNull()
    expect(parseVersionPayload({ buildId: 42 })).toBeNull()
  })
})

describe('isNewerBuild', () => {
  it('is true only when both ids are real and differ', () => {
    expect(isNewerBuild('a', 'b')).toBe(true)
  })

  it('is false when the ids match, including around whitespace', () => {
    expect(isNewerBuild('a', 'a')).toBe(false)
    expect(isNewerBuild(' a ', 'a')).toBe(false)
  })

  it('never prompts when either side is missing or unstamped', () => {
    expect(isNewerBuild(null, 'b')).toBe(false)
    expect(isNewerBuild('a', undefined)).toBe(false)
    expect(isNewerBuild('dev', 'b')).toBe(false)
    expect(isNewerBuild('a', 'unknown')).toBe(false)
  })
})

describe('shouldPromptUpdate', () => {
  it('prompts on a different, newer build', () => {
    expect(
      shouldPromptUpdate({ buildId: 'a', builtAt: 100 }, { buildId: 'b', builtAt: 200 }),
    ).toBe(true)
  })

  it('prompts when timestamps are absent and the ids differ', () => {
    expect(shouldPromptUpdate({ buildId: 'a' }, { buildId: 'b' })).toBe(true)
  })

  it('refuses to roll backwards when a stale edge serves the previous build', () => {
    expect(
      shouldPromptUpdate({ buildId: 'b', builtAt: 200 }, { buildId: 'a', builtAt: 100 }),
    ).toBe(false)
    expect(
      shouldPromptUpdate({ buildId: 'b', builtAt: 200 }, { buildId: 'a', builtAt: 200 }),
    ).toBe(false)
  })

  it('is false for the same build or a missing side', () => {
    expect(shouldPromptUpdate({ buildId: 'a' }, { buildId: 'a' })).toBe(false)
    expect(shouldPromptUpdate(null, { buildId: 'b' })).toBe(false)
    expect(shouldPromptUpdate({ buildId: 'a' }, null)).toBe(false)
  })
})

describe('base-relative update paths', () => {
  it('normalises every shape of base to /x/ form', () => {
    expect(normalizeBase('/')).toBe('/')
    expect(normalizeBase('')).toBe('/')
    expect(normalizeBase(undefined)).toBe('/')
    expect(normalizeBase('./')).toBe('/')
    expect(normalizeBase('/app/')).toBe('/app/')
    expect(normalizeBase('/app')).toBe('/app/')
    expect(normalizeBase('app')).toBe('/app/')
  })

  it('keeps the worker inside its own scope for the /app web deploy', () => {
    // A worker at '/sw.js' cannot control '/app/' without a server header;
    // this is exactly the bug that would make updates silently never arrive.
    expect(swUrl('/app/')).toBe('/app/sw.js')
    expect(swScope('/app/')).toBe('/app/')
    expect(versionUrl('/app/')).toBe('/app/version.json')
  })

  it('collapses to the root for the mobile build', () => {
    expect(swUrl('/')).toBe('/sw.js')
    expect(swScope('/')).toBe('/')
    expect(versionUrl('/')).toBe('/version.json')
  })
})
