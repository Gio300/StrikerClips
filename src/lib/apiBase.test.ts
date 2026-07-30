import { describe, it, expect } from 'vitest'
import { resolveApiBase, apiUrl, isAbsoluteApiBase, API_PATH } from './apiBase'

/**
 * The mobile build's whole ability to reach the backend rides on this one
 * function: Capacitor serves the app from https://localhost, so a relative
 * '/api' silently points the APK at a host that does not exist.
 */
describe('resolveApiBase', () => {
  it('defaults to the relative path for the same-origin web build', () => {
    expect(resolveApiBase(undefined)).toBe('/api')
    expect(resolveApiBase(null)).toBe('/api')
    expect(resolveApiBase('')).toBe('/api')
    expect(resolveApiBase('   ')).toBe('/api')
    expect(resolveApiBase(API_PATH)).toBe('/api')
  })

  it('treats the stringified empties an env var can produce as unset', () => {
    // `set VITE_API_BASE=` in a .bat, or a bundler define of undefined.
    expect(resolveApiBase('undefined')).toBe('/api')
    expect(resolveApiBase('null')).toBe('/api')
  })

  it('appends /api to a bare origin', () => {
    expect(resolveApiBase('https://tko.cam')).toBe('https://tko.cam/api')
    expect(resolveApiBase('http://192.168.1.20:8080')).toBe('http://192.168.1.20:8080/api')
  })

  it('trims trailing slashes rather than producing a double slash', () => {
    expect(resolveApiBase('https://tko.cam/')).toBe('https://tko.cam/api')
    expect(resolveApiBase('https://tko.cam///')).toBe('https://tko.cam/api')
    expect(resolveApiBase('  https://tko.cam/  ')).toBe('https://tko.cam/api')
  })

  it('does not double up when /api is already present', () => {
    expect(resolveApiBase('https://tko.cam/api')).toBe('https://tko.cam/api')
    expect(resolveApiBase('https://tko.cam/api/')).toBe('https://tko.cam/api')
    expect(resolveApiBase('https://tko.cam/API')).toBe('https://tko.cam/API')
  })
})

describe('isAbsoluteApiBase', () => {
  it('distinguishes a cross-origin base from the same-origin default', () => {
    expect(isAbsoluteApiBase('/api')).toBe(false)
    expect(isAbsoluteApiBase('https://tko.cam/api')).toBe(true)
    expect(isAbsoluteApiBase('http://localhost:8080/api')).toBe(true)
    expect(isAbsoluteApiBase('capacitor://localhost/api')).toBe(true)
  })
})

describe('apiUrl', () => {
  it('joins paths against either kind of base', () => {
    expect(apiUrl('/auth/me', '/api')).toBe('/api/auth/me')
    expect(apiUrl('/auth/me', 'https://tko.cam/api')).toBe('https://tko.cam/api/auth/me')
  })

  it('tolerates a path without a leading slash', () => {
    expect(apiUrl('db', 'https://tko.cam/api')).toBe('https://tko.cam/api/db')
  })

  it('produces the URL the APK actually needs', () => {
    const base = resolveApiBase('https://tko.cam')
    expect(apiUrl('/auth/login', base)).toBe('https://tko.cam/api/auth/login')
    // The bug this replaces: relative '/api' under Capacitor resolved to
    // https://localhost/api/auth/login, which is nothing at all.
    expect(apiUrl('/auth/login', base)).not.toBe('/api/auth/login')
  })
})
