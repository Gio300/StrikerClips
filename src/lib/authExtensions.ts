import { supabase } from './supabase'

type AuthResult = Promise<{ data: any; error: { message: string } | null }>

interface AuthExtensions {
  requestPasswordReset(email: string, origin?: string): AuthResult
  resetPassword(token: string, password: string): AuthResult
  createTransfer(targetOrigin: string, returnPath?: string): AuthResult
  exchangeTransferCode(code: string, targetOrigin: string): AuthResult
}

function auth(): AuthExtensions {
  return supabase.auth as unknown as AuthExtensions
}

export const requestPasswordReset = (email: string, origin?: string) =>
  auth().requestPasswordReset(email, origin)

export const resetPassword = (token: string, password: string) =>
  auth().resetPassword(token, password)

export const createSessionTransfer = (targetOrigin: string, returnPath = '/') =>
  auth().createTransfer(targetOrigin, returnPath)

export const exchangeSessionTransfer = (code: string, targetOrigin: string) =>
  auth().exchangeTransferCode(code, targetOrigin)

/**
 * The server binds a one-time transfer code to the exact redirect target.
 * Native league builds therefore need their own registered URL scheme rather
 * than the TKO default. Web builds continue to use their current origin.
 */
export function nativeSessionTransferTarget(rawScheme = import.meta.env.VITE_NATIVE_DEEP_LINK_SCHEME || 'tkocam'): string {
  const scheme = rawScheme
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+.-]/g, '')
  return `${scheme || 'tkocam'}://auth`
}

export function sessionTransferTarget(): string {
  if (typeof window === 'undefined') return ''
  if (window.location.origin !== 'https://localhost') return window.location.origin
  return nativeSessionTransferTarget()
}

export function sessionBridgeUrl(returnPath = '/'): string | null {
  if (typeof window === 'undefined') return null
  const native = window.location.origin === 'https://localhost'
  const target = sessionTransferTarget()
  if (!native && /^https:\/\/(www\.)?tko\.cam$/i.test(target)) return null
  const url = new URL('/session-bridge', 'https://tko.cam')
  url.searchParams.set('target', target)
  url.searchParams.set('path', returnPath.startsWith('/') ? returnPath : '/')
  return url.toString()
}
