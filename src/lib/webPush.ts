/**
 * PHONE PUSH NOTIFICATIONS — the browser side.
 *
 * "I want when someone gets messaged or something for a small note to come up on
 * phone as notification.. like how other apps do it."
 *
 * WEB PUSH (VAPID), not Firebase. It needs no third-party account, it works on
 * Android Chrome and on iOS 16.4+ for a home-screen-installed PWA, and the
 * service worker that receives the pushes is already registered and scope-aware
 * (src/lib/swClient.ts, public/sw.js).
 *
 * THE ONE RULE THAT MATTERS: NEVER ASK FOR PERMISSION ON PAGE LOAD.
 * A `Notification.requestPermission()` fired without a user gesture is denied
 * more or less instantly — and once denied, the browser will not show the prompt
 * again. There is no API to un-deny it; the member has to dig through site
 * settings. So the permission request lives behind a tap on an explicit control
 * and nowhere else. `subscribeToPush` below is the ONLY function here that asks,
 * and it is only ever called from a click handler.
 *
 * Everything that can be pure is pure, so the decision table ("should the
 * control render? what does it say?") is unit-tested without a browser.
 */

/** What the control should render. */
export type PushState =
  /** No push support in this browser, or the app is not served over https. */
  | 'unsupported'
  /** No VAPID keys on the server — the whole feature is off. Render nothing. */
  | 'unconfigured'
  /** Supported and available, not turned on. Offer the opt-in. */
  | 'off'
  /** Subscribed on this device. Offer the way back out. */
  | 'on'
  /** The member (or the browser) refused. We cannot ask again — explain that. */
  | 'blocked'

/** The permission values we care about, plus "this browser has none". */
export type PushPermission = 'default' | 'granted' | 'denied' | 'unsupported'

export interface PushStateInput {
  /** ServiceWorker + PushManager + Notification all present. */
  supported: boolean
  /** The server answered `enabled: true` with a public key. */
  configured: boolean
  /** Notification.permission. */
  permission: PushPermission
  /** A PushSubscription exists for this registration. */
  subscribed: boolean
}

/**
 * The single decision about what the member is shown.
 *
 * Order is deliberate:
 *   unsupported/unconfigured win over everything — never offer a control that
 *     cannot work, and never mention a feature the deployment does not have;
 *   an existing subscription reads as ON even if permission was later revoked
 *     at the OS level, because the honest next action is still "turn it off";
 *   'denied' reads as BLOCKED, never as OFF: an opt-in button that silently
 *     does nothing is the worst possible version of this.
 */
export function computePushState(input: PushStateInput): PushState {
  if (!input.supported) return 'unsupported'
  if (!input.configured) return 'unconfigured'
  if (input.subscribed) return 'on'
  if (input.permission === 'denied') return 'blocked'
  return 'off'
}

/** Whether the opt-in control should render at all. */
export function shouldShowPushControl(state: PushState): boolean {
  return state === 'off' || state === 'on' || state === 'blocked'
}

/**
 * Is web push usable here at all?
 *
 * Mirrors the constraints in swClient.canUseServiceWorker (no worker, no push),
 * plus the two push-specific APIs. Kept separate from the registration check so
 * a browser with a worker but no PushManager (older iOS, some webviews) reads as
 * unsupported rather than as broken.
 */
export function pushSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (!('serviceWorker' in navigator)) return false
  if (!('PushManager' in window)) return false
  if (!('Notification' in window)) return false
  return true
}

/** The browser's current permission, normalized. */
export function currentPermission(): PushPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  const value = (window as any).Notification?.permission
  if (value === 'granted' || value === 'denied' || value === 'default') return value
  return 'unsupported'
}

/**
 * VAPID public keys travel as base64url; `applicationServerKey` wants raw bytes.
 *
 * Pure and exported so the conversion is tested directly — a subtly wrong key
 * fails at `subscribe()` with an opaque DOMException that tells you nothing.
 *
 * The return type is deliberately INFERRED rather than annotated `Uint8Array`:
 * since TypeScript 5.7 the bare name widens to `Uint8Array<ArrayBufferLike>`,
 * which `applicationServerKey` (a `BufferSource`, i.e. ArrayBuffer-backed) will
 * not accept. Inference keeps the narrow, correct type on every TS version.
 */
export function urlBase64ToUint8Array(base64String: string) {
  const input = String(base64String ?? '').trim()
  if (!input) throw new Error('empty application server key')
  const padding = '='.repeat((4 - (input.length % 4)) % 4)
  const base64 = (input + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

/** A subscription flattened into what the server stores. */
export interface SerializedSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/**
 * `PushSubscription.toJSON()` in a form we can actually rely on.
 *
 * Some engines return a plain object, some a class with a toJSON; either way the
 * two keys must be present or the subscription is unusable, and returning null
 * beats POSTing half a subscription the server would have to reject.
 */
export function serializeSubscription(subscription: any): SerializedSubscription | null {
  if (!subscription) return null
  let json: any = subscription
  if (typeof subscription.toJSON === 'function') {
    try {
      json = subscription.toJSON()
    } catch {
      json = subscription
    }
  }
  const endpoint = typeof json?.endpoint === 'string' ? json.endpoint.trim() : ''
  const p256dh = typeof json?.keys?.p256dh === 'string' ? json.keys.p256dh.trim() : ''
  const auth = typeof json?.keys?.auth === 'string' ? json.keys.auth.trim() : ''
  if (!endpoint || !p256dh || !auth) return null
  return { endpoint, keys: { p256dh, auth } }
}

/**
 * True when the browser has handed us a DIFFERENT endpoint than the one the
 * server knows about — the browser rotated it, and the old row is now a corpse
 * the server will otherwise keep trying to reach.
 *
 * Pure so the re-subscribe path is testable; the caller unsubscribes the old
 * endpoint before storing the new one.
 */
export function endpointChanged(
  storedEndpoint: string | null | undefined,
  freshEndpoint: string | null | undefined,
): boolean {
  const stored = String(storedEndpoint ?? '').trim()
  const fresh = String(freshEndpoint ?? '').trim()
  if (!stored || !fresh) return false
  return stored !== fresh
}

/** Where we remember this device's endpoint, so a rotation is detectable. */
export const PUSH_ENDPOINT_KEY = 'tko_push_endpoint'

export function rememberEndpoint(endpoint: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (endpoint) localStorage.setItem(PUSH_ENDPOINT_KEY, endpoint)
    else localStorage.removeItem(PUSH_ENDPOINT_KEY)
  } catch {
    /* private mode / storage disabled — the endpoint is re-derivable anyway */
  }
}

export function rememberedEndpoint(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(PUSH_ENDPOINT_KEY)
  } catch {
    return null
  }
}
