import { describe, expect, it } from 'vitest'
import {
  computePushState,
  endpointChanged,
  serializeSubscription,
  shouldShowPushControl,
  urlBase64ToUint8Array,
} from './webPush'

/**
 * The client-side DECISIONS, tested without a browser.
 *
 * The thing this file protects is the difference between "the toggle is off" and
 * "the toggle cannot work" — get that wrong and you ship a button that asks for
 * a permission the browser has already permanently refused, or a button on a
 * deployment with no VAPID keys that silently does nothing at all.
 */

const base = {
  supported: true,
  configured: true,
  permission: 'default' as const,
  subscribed: false,
}

describe('computePushState', () => {
  it('reads as unsupported before anything else', () => {
    expect(computePushState({ ...base, supported: false })).toBe('unsupported')
    // Even a subscribed, granted, configured state is unsupported if the APIs
    // are not there — that combination means we are reading stale state.
    expect(
      computePushState({ supported: false, configured: true, permission: 'granted', subscribed: true }),
    ).toBe('unsupported')
  })

  it('reads as unconfigured when the server has no VAPID keys', () => {
    expect(computePushState({ ...base, configured: false })).toBe('unconfigured')
    expect(
      computePushState({ ...base, configured: false, permission: 'granted', subscribed: true }),
    ).toBe('unconfigured')
  })

  it('reads as ON whenever a subscription exists', () => {
    expect(computePushState({ ...base, subscribed: true })).toBe('on')
    expect(computePushState({ ...base, subscribed: true, permission: 'granted' })).toBe('on')
  })

  it('reads as BLOCKED, never as off, when the browser has denied us', () => {
    // The difference that matters: an opt-in button here would ask for a
    // permission the browser will refuse without even showing a prompt.
    expect(computePushState({ ...base, permission: 'denied' })).toBe('blocked')
  })

  it('reads as off when it can be turned on', () => {
    expect(computePushState(base)).toBe('off')
    expect(computePushState({ ...base, permission: 'granted' })).toBe('off')
  })
})

describe('shouldShowPushControl', () => {
  it('renders nothing when the feature cannot work at all', () => {
    // A dead toggle teaches members the feature is broken.
    expect(shouldShowPushControl('unsupported')).toBe(false)
    expect(shouldShowPushControl('unconfigured')).toBe(false)
  })

  it('renders for off, on, and blocked', () => {
    expect(shouldShowPushControl('off')).toBe(true)
    expect(shouldShowPushControl('on')).toBe(true)
    // Blocked still renders: the member deserves to know WHY it is not working.
    expect(shouldShowPushControl('blocked')).toBe(true)
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes an unpadded base64url key to raw bytes', () => {
    // 'Hello' -> base64 'SGVsbG8=' -> base64url 'SGVsbG8' (padding dropped).
    const bytes = urlBase64ToUint8Array('SGVsbG8')
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111])
  })

  it('translates the base64url alphabet', () => {
    // 0xFB 0xFF encodes as '+/8' in base64 and '-_8' in base64url.
    const bytes = urlBase64ToUint8Array('-_8')
    expect(Array.from(bytes)).toEqual([251, 255])
  })

  it('decodes a realistic VAPID public key to the expected 65 bytes', () => {
    const key =
      'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
    const bytes = urlBase64ToUint8Array(key)
    // An uncompressed P-256 point: one 0x04 tag plus two 32-byte coordinates.
    expect(bytes.length).toBe(65)
    expect(bytes[0]).toBe(4)
  })

  it('refuses an empty key rather than producing an empty buffer', () => {
    // subscribe() with an empty applicationServerKey throws an opaque
    // DOMException; failing here at least names the cause.
    expect(() => urlBase64ToUint8Array('')).toThrow()
    expect(() => urlBase64ToUint8Array('   ')).toThrow()
  })
})

describe('serializeSubscription', () => {
  it('flattens the browser object through toJSON', () => {
    const subscription = {
      endpoint: 'https://push.example/abc',
      toJSON: () => ({
        endpoint: 'https://push.example/abc',
        keys: { p256dh: 'pub', auth: 'sec' },
      }),
    }
    expect(serializeSubscription(subscription)).toEqual({
      endpoint: 'https://push.example/abc',
      keys: { p256dh: 'pub', auth: 'sec' },
    })
  })

  it('accepts a plain object with the same shape', () => {
    expect(
      serializeSubscription({
        endpoint: 'https://push.example/abc',
        keys: { p256dh: 'pub', auth: 'sec' },
      }),
    ).toEqual({ endpoint: 'https://push.example/abc', keys: { p256dh: 'pub', auth: 'sec' } })
  })

  it('returns null rather than half a subscription', () => {
    expect(serializeSubscription(null)).toBeNull()
    expect(serializeSubscription({ endpoint: 'https://push.example/abc' })).toBeNull()
    expect(
      serializeSubscription({ endpoint: '', keys: { p256dh: 'pub', auth: 'sec' } }),
    ).toBeNull()
    expect(
      serializeSubscription({ endpoint: 'https://push.example/abc', keys: { p256dh: 'pub' } }),
    ).toBeNull()
  })

  it('survives a toJSON that throws', () => {
    const hostile = {
      endpoint: 'https://push.example/abc',
      keys: { p256dh: 'pub', auth: 'sec' },
      toJSON: () => {
        throw new Error('nope')
      },
    }
    expect(serializeSubscription(hostile)).toEqual({
      endpoint: 'https://push.example/abc',
      keys: { p256dh: 'pub', auth: 'sec' },
    })
  })
})

describe('endpointChanged', () => {
  it('spots a rotated endpoint, which is the only signal we get', () => {
    expect(endpointChanged('https://push.example/old', 'https://push.example/new')).toBe(true)
  })

  it('is false for the same endpoint', () => {
    expect(endpointChanged('https://push.example/same', 'https://push.example/same')).toBe(false)
  })

  it('is false when either side is unknown — never unsubscribe on a guess', () => {
    expect(endpointChanged(null, 'https://push.example/new')).toBe(false)
    expect(endpointChanged('https://push.example/old', '')).toBe(false)
    expect(endpointChanged(undefined, undefined)).toBe(false)
  })
})
