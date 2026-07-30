import { swScope, swUrl } from './appVersion'

/**
 * Service-worker registration plumbing (browser side).
 *
 * Kept out of React so both entrypoints can use it: the app (`src/main.tsx`)
 * registers under BASE_URL, and the marketing site (`src/site-main.tsx`)
 * registers at the root — the marketing page has to be controlled by a worker
 * for Chromium to consider it installable and fire `beforeinstallprompt`.
 */

/**
 * Registration is production-only, and never inside the Capacitor APK.
 *
 * The APK serves the bundle from `https://localhost` (capacitor.config.ts,
 * androidScheme: 'https'). A worker there would cache the *packaged* bundle and
 * fight the store update mechanism, so we leave native builds alone — they get
 * new versions through Play, not through this.
 */
export function canUseServiceWorker(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (!('serviceWorker' in navigator)) return false
  if (!import.meta.env.PROD) return false
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false
  if (window.location.protocol !== 'https:') return false
  return true
}

let registration: ServiceWorkerRegistration | null = null

/** Register (idempotently) and hand back the registration, or null if skipped. */
export async function registerServiceWorker(
  base: string,
): Promise<ServiceWorkerRegistration | null> {
  if (!canUseServiceWorker()) return null
  if (registration) return registration
  try {
    registration = await navigator.serviceWorker.register(swUrl(base), { scope: swScope(base) })
    return registration
  } catch {
    // A failed registration must never break the app — the /version.json poll
    // is an independent path to the same "new build available" prompt.
    return null
  }
}

/**
 * Activate the waiting worker and reload onto the new build.
 *
 * IMPORTANT: this touches no storage of any kind. `kc_token` stays in
 * localStorage, so the reload rehydrates the same session — the tester is on
 * the new build and still signed in.
 */
export async function activateUpdateAndReload(): Promise<void> {
  const reload = () => window.location.reload()

  if (!('serviceWorker' in navigator)) return reload()

  let reg: ServiceWorkerRegistration | null | undefined = registration
  try {
    if (!reg) reg = await navigator.serviceWorker.getRegistration()
  } catch {
    reg = null
  }

  const waiting = reg?.waiting
  if (!waiting) {
    // No waiting worker: either the SW never registered, or the /version.json
    // poll spotted the new build first. A plain reload is enough, because the
    // shell is fetched network-first.
    return reload()
  }

  let reloaded = false
  const once = () => {
    if (reloaded) return
    reloaded = true
    reload()
  }
  navigator.serviceWorker.addEventListener('controllerchange', once, { once: true })
  // Safety net: if the controller never changes (worker wedged, browser quirk)
  // reload anyway rather than leaving the user staring at a dead button.
  window.setTimeout(once, 3000)
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

/**
 * NUCLEAR self-heal for a POISONED worker — the classic PWA trap where an old
 * service worker keeps serving a stale shell and ignores skip-waiting, pinning a
 * device to an ancient build. Called only when we detect we already reloaded for
 * a build yet are STILL running something older (see useAppUpdate loop guard).
 *
 * It unregisters EVERY worker on this origin and deletes EVERY cache, then hard
 * reloads onto the network — after which the fresh, network-first worker
 * registers clean. It deliberately does NOT touch localStorage, so `kc_token`
 * survives and the user stays signed in.
 */
export async function hardResetAndReload(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)))
    }
  } catch {
    /* ignore — proceed to cache purge + reload regardless */
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)))
    }
  } catch {
    /* ignore */
  }
  // Bust any lingering HTTP cache for the shell on the way out.
  try {
    const u = new URL(window.location.href)
    u.searchParams.set('_fresh', Date.now().toString(36))
    window.location.replace(u.toString())
  } catch {
    window.location.reload()
  }
}
