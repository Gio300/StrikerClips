import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getServiceWorkerRegistration } from '@/lib/swClient'
import { apiUrl } from '@/lib/apiBase'
import {
  computePushState,
  currentPermission,
  endpointChanged,
  pushSupported,
  rememberEndpoint,
  rememberedEndpoint,
  serializeSubscription,
  urlBase64ToUint8Array,
  type PushPermission,
  type PushState,
} from '@/lib/webPush'

/**
 * usePushNotifications — "let my phone buzz when someone messages me".
 *
 * WHAT THIS HOOK WILL NOT DO: ask for notification permission on mount. Not
 * once, not conditionally, not "only for signed-in users". A permission prompt
 * fired without a user gesture is denied almost immediately and CANNOT BE ASKED
 * AGAIN — the member would have to find it in browser site settings. Permission
 * is requested in `enable()` and only there, and `enable()` is only ever wired
 * to a click.
 *
 * WHAT IT DOES ON MOUNT: read-only state. Is push supported here, does the
 * server have VAPID keys, what does `Notification.permission` already say, and
 * is there already a subscription on this registration. All four are needed
 * before anything can be rendered, and none of them prompts.
 *
 * ENDPOINT ROTATION. A push service can hand the same browser a NEW endpoint
 * without telling anyone. The old row on the server then belongs to nobody: it
 * cannot be delivered to, and it is only cleaned up when a send finally earns a
 * 410. So when we find an existing subscription whose endpoint differs from the
 * one we last stored, we unsubscribe the old endpoint server-side and re-POST
 * the new one. This is a silent write, never a prompt.
 *
 * INERT WITHOUT KEYS. `push-config` answering `enabled: false` collapses the
 * state to 'unconfigured', the control renders nothing, and no subscribe call is
 * ever made.
 */

const APP_BASE = typeof import.meta !== 'undefined' ? import.meta.env?.BASE_URL || '/' : '/'

export interface PushNotifications {
  /** What the control should render. */
  state: PushState
  /** Raw browser permission, for copy that needs to be specific. */
  permission: PushPermission
  /** True while enable()/disable() is in flight — disable the button. */
  busy: boolean
  /** Human-readable failure from the last action, or null. */
  error: string | null
  /** True until the initial read-only probe has finished. */
  loading: boolean
  /** Ask for permission and subscribe. MUST be called from a user gesture. */
  enable: () => Promise<void>
  /** Unsubscribe this device. Leaves permission alone — it is not ours to revoke. */
  disable: () => Promise<void>
}

interface ServerConfig {
  enabled: boolean
  publicKey: string | null
}

async function readServerConfig(): Promise<ServerConfig> {
  try {
    const response = await fetch(apiUrl('/push/config'), { cache: 'no-store' })
    if (!response.ok) return { enabled: false, publicKey: null }
    const data = await response.json() as { enabled?: boolean; publicKey?: string }
    const publicKey = typeof data?.publicKey === 'string' ? data.publicKey.trim() : ''
    // A truthy `enabled` with no key is not configured — it is broken, and the
    // honest reading of broken is "off".
    return { enabled: Boolean(data?.enabled) && publicKey.length > 0, publicKey: publicKey || null }
  } catch {
    return { enabled: false, publicKey: null }
  }
}

export function usePushNotifications(): PushNotifications {
  const [supported] = useState<boolean>(() => pushSupported())
  const [config, setConfig] = useState<ServerConfig>({ enabled: false, publicKey: null })
  const [permission, setPermission] = useState<PushPermission>(() => currentPermission())
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Guards every setState in the async paths below: this control lives on a page
  // the member can leave mid-request.
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const currentSubscription = useCallback(async (): Promise<any | null> => {
    if (!supported) return null
    try {
      const registration = await getServiceWorkerRegistration(APP_BASE)
      if (!registration?.pushManager) return null
      return await registration.pushManager.getSubscription()
    } catch {
      return null
    }
  }, [supported])

  // READ-ONLY PROBE. Nothing here prompts, and nothing here subscribes.
  useEffect(() => {
    let cancelled = false
    const probe = async () => {
      if (!supported) {
        if (!cancelled && alive.current) setLoading(false)
        return
      }
      const serverConfig = await readServerConfig()
      if (cancelled || !alive.current) return
      setConfig(serverConfig)
      setPermission(currentPermission())
      if (!serverConfig.enabled) {
        setLoading(false)
        return
      }

      const existing = await currentSubscription()
      if (cancelled || !alive.current) return
      const serialized = serializeSubscription(existing)
      setSubscribed(Boolean(serialized))
      setLoading(false)

      // RE-BIND A ROTATED ENDPOINT. Silent, gesture-free, and the only way the
      // server ever learns the browser moved us.
      if (serialized) {
        const previous = rememberedEndpoint()
        if (endpointChanged(previous, serialized.endpoint)) {
          try {
            await supabase.functions.invoke('push-unsubscribe', { body: { endpoint: previous } })
          } catch {
            /* the old row will be reaped by the first 410 anyway */
          }
        }
        try {
          await supabase.functions.invoke('push-subscribe', { body: { subscription: serialized } })
          rememberEndpoint(serialized.endpoint)
        } catch {
          /* a failed re-bind is not worth an error banner on a page load */
        }
      }
    }
    void probe()
    return () => {
      cancelled = true
    }
  }, [supported, currentSubscription])

  const enable = useCallback(async () => {
    if (busy) return
    setError(null)
    if (!supported || !config.enabled || !config.publicKey) return
    setBusy(true)
    try {
      // THE ONE PLACE PERMISSION IS EVER REQUESTED, and it is inside a click.
      const granted = await window.Notification.requestPermission()
      if (!alive.current) return
      setPermission(granted === 'granted' || granted === 'denied' || granted === 'default' ? granted : 'unsupported')
      if (granted !== 'granted') {
        setError(
          granted === 'denied'
            ? 'Your browser blocked notifications for this site. Turn them back on in site settings.'
            : 'Notifications were not enabled.',
        )
        return
      }

      const registration = await getServiceWorkerRegistration(APP_BASE)
      if (!registration?.pushManager) {
        setError('This browser cannot receive notifications yet.')
        return
      }
      // Reuse an existing subscription rather than creating a second one — a
      // browser will hand back the same object anyway, and asking twice with a
      // different key throws.
      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          // Required by Chromium: every push MUST result in a visible
          // notification. That is exactly what public/sw.js does.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.publicKey),
        }))

      const serialized = serializeSubscription(subscription)
      if (!serialized) {
        setError('The browser returned an unusable subscription.')
        return
      }
      const { error: sendError } = await supabase.functions.invoke('push-subscribe', {
        body: { subscription: serialized },
      })
      if (!alive.current) return
      if (sendError) {
        setError('Could not turn notifications on. Try again in a moment.')
        return
      }
      rememberEndpoint(serialized.endpoint)
      setSubscribed(true)
    } catch (enableError: any) {
      if (!alive.current) return
      setError(enableError?.message ? String(enableError.message) : 'Could not turn notifications on.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [busy, config.enabled, config.publicKey, supported])

  const disable = useCallback(async () => {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      const subscription = await currentSubscription()
      const serialized = serializeSubscription(subscription)
      // Tell the server FIRST: if the browser-side unsubscribe succeeds and the
      // server call does not, the row lives on as a corpse we can no longer name.
      if (serialized) {
        try {
          await supabase.functions.invoke('push-unsubscribe', {
            body: { endpoint: serialized.endpoint },
          })
        } catch {
          /* the row is reaped by the first 410 after the browser drops it */
        }
      }
      if (subscription && typeof subscription.unsubscribe === 'function') {
        try {
          await subscription.unsubscribe()
        } catch {
          /* already gone */
        }
      }
      rememberEndpoint(null)
      if (!alive.current) return
      setSubscribed(false)
    } catch (disableError: any) {
      if (!alive.current) return
      setError(disableError?.message ? String(disableError.message) : 'Could not turn notifications off.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [busy, currentSubscription])

  const state = computePushState({
    supported,
    configured: config.enabled,
    permission,
    subscribed,
  })

  return { state, permission, busy, error, loading, enable, disable }
}
