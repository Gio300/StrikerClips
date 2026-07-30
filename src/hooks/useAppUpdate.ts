import { useCallback, useEffect, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Browser as CapacitorBrowser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { parseVersionPayload, shouldPromptUpdate, versionUrl } from '@/lib/appVersion'
import { APP_BASE, RUNNING_VERSION } from '@/lib/buildInfo'
import {
  parseNativeBuild,
  parseNativeVersionManifest,
  resolveMobileVersionUrl,
  shouldPromptNativeUpdate,
  shouldUseAndroidSideloadUpdates,
  type NativeVersionManifest,
} from '@/lib/nativeUpdate'
import { activateUpdateAndReload, canUseServiceWorker, hardResetAndReload, registerServiceWorker } from '@/lib/swClient'

/**
 * "A newer build is live" detection, from two independent sources.
 *
 *   1. SERVICE WORKER — a new worker reaching `installed` while one is already
 *      controlling the page means a new shell is sitting in `waiting`.
 *   2. /version.json POLL — every few minutes and whenever the tab regains
 *      focus. This is the belt-and-braces path: it works even if the worker
 *      failed to register, got unregistered, or is otherwise misbehaving, which
 *      is precisely the situation that strands a tester on an old build.
 *
 * Either source flips `updateReady`. `applyUpdate()` then activates the waiting
 * worker (if any) and reloads. No storage is cleared anywhere in this flow, so
 * the localStorage JWT (`kc_token`) survives and the user stays signed in.
 *
 * AUTO-UPDATE
 *   A tester ("Hollywood") kept ignoring the banner and staying on a stale
 *   build, so the /version.json poll now does more than raise the banner: the
 *   moment it sees a genuinely newer build it activates the new worker and
 *   RELOADS the page automatically (`maybeAutoReload`). The banner is kept only
 *   as a fallback for the pathological case where the loop guard suppresses the
 *   auto-reload (see below).
 *
 *   LOOP GUARD: each distinct served buildId triggers at most one auto-reload
 *   per tab session. We remember the ids we have already reloaded onto in
 *   sessionStorage; if we come back around still seeing a build we already
 *   reloaded for (a stale CDN edge, a cache that did not take), we stop
 *   reloading and just show the banner instead of bouncing the page forever.
 *   On the normal path this never fires: after a successful reload the running
 *   build equals the served one, so nothing is flagged as new in the first place.
 */

/** Poll for a new build at most every few minutes — enough to pick up a deploy
 *  without the page feeling like it is "constantly updating". */
const POLL_INTERVAL_MS = 5 * 60 * 1000
/** Don't hammer the origin when a user flicks between tabs / regains focus. */
const MIN_POLL_GAP_MS = 60 * 1000
const DISMISS_KEY = 'tko_update_dismissed_build'
/** Build ids we have already auto-reloaded onto this session — the loop guard. */
const RELOADED_KEY = 'tko_update_reloaded_builds'
/** Build ids we have already HARD-RESET for — so the nuclear heal runs at most
 *  once per stale build and can never loop. Persisted across reloads. */
const HARDRESET_KEY = 'tko_update_hardreset_builds'

/**
 * IN-MEMORY loop guard. Every build id this tab has already auto-reloaded onto,
 * kept in module memory so it works even when sessionStorage is unavailable
 * (private mode). Combined with the sessionStorage record below, this guarantees
 * the SAME build is never auto-reloaded twice — so a stale edge that keeps
 * serving an id we already jumped to can never turn into a reload loop.
 */
const reloadedInMemory = new Set<string>()

function reloadedBuilds(): Set<string> {
  const seen = new Set(reloadedInMemory)
  try {
    const raw = sessionStorage.getItem(RELOADED_KEY)
    for (const id of raw ? raw.split(',').filter(Boolean) : []) seen.add(id)
  } catch {
    /* private mode — fall back to the in-memory set alone. */
  }
  return seen
}

function rememberReloaded(id: string): void {
  reloadedInMemory.add(id)
  try {
    const seen = reloadedBuilds()
    sessionStorage.setItem(RELOADED_KEY, Array.from(seen).join(','))
  } catch {
    /* private mode — the in-memory set still prevents a double reload this life. */
  }
}

export interface AppUpdateState {
  /** A different build is being served — show the banner. */
  updateReady: boolean
  /** Native APKs download an installer; PWAs activate a service worker. */
  nativeUpdate: boolean
  /** Activate the waiting worker (if any) and reload onto the new build. */
  applyUpdate: () => void
  /** Hide the banner for this build only; a later build shows it again. */
  dismiss: () => void
}

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

export function useAppUpdate(): AppUpdateState {
  const platform = Capacitor.getPlatform()
  const nativeUpdate = shouldUseAndroidSideloadUpdates(
    platform,
    import.meta.env.VITE_ANDROID_SIDELOAD_UPDATES,
  )
  const webUpdate = platform === 'web'
  const [available, setAvailable] = useState(false)
  const [servedBuildId, setServedBuildId] = useState<string | null>(null)
  const [nativeManifest, setNativeManifest] = useState<NativeVersionManifest | null>(null)
  const [dismissedBuildId, setDismissedBuildId] = useState<string | null>(() => readDismissed())
  const lastPollRef = useRef(0)
  /** True once we have kicked off a reload this page life — never do it twice. */
  const reloadingRef = useRef(false)

  // Push the user onto the newer build automatically. Guarded twice: once per
  // page life (reloadingRef) and once per build id across reloads (sessionStorage)
  // so a stale edge can never turn this into an infinite reload loop.
  const maybeAutoReload = useCallback((servedBuildId: string) => {
    if (reloadingRef.current) return
    if (reloadedBuilds().has(servedBuildId)) {
      // We ALREADY reloaded for this build yet are STILL seeing it as "newer"
      // than what's running — the signature of a poisoned/wedged worker serving
      // a stale shell. Escalate to the nuclear self-heal exactly once per build.
      let hardDone = new Set<string>()
      try { hardDone = new Set((sessionStorage.getItem(HARDRESET_KEY) || '').split(',').filter(Boolean)) } catch { /* private mode */ }
      if (!hardDone.has(servedBuildId)) {
        hardDone.add(servedBuildId)
        try { sessionStorage.setItem(HARDRESET_KEY, Array.from(hardDone).join(',')) } catch { /* private mode */ }
        reloadingRef.current = true
        void hardResetAndReload()
      }
      return // otherwise: already healed once → leave the banner as the last resort
    }
    reloadingRef.current = true
    rememberReloaded(servedBuildId)
    void activateUpdateAndReload()
  }, [])

  const poll = useCallback(
    async (force = false) => {
      const now = Date.now()
      if (!force && now - lastPollRef.current < MIN_POLL_GAP_MS) return
      lastPollRef.current = now
      try {
        const targetUrl = nativeUpdate
          ? import.meta.env.VITE_MOBILE_VERSION_URL ||
            resolveMobileVersionUrl(import.meta.env.VITE_API_BASE)
          : versionUrl(APP_BASE)
        const res = await fetch(targetUrl, { cache: 'no-store', credentials: 'omit' })
        if (!res.ok) return
        if (nativeUpdate) {
          const release = parseNativeVersionManifest(await res.json())
          if (!release) return
          const appInfo = await CapacitorApp.getInfo()
          const runningVersionCode = parseNativeBuild(appInfo.build)
          if (shouldPromptNativeUpdate(runningVersionCode, release)) {
            setNativeManifest(release)
            setServedBuildId(release.buildId)
            setAvailable(true)
          } else {
            setNativeManifest(null)
            setAvailable(false)
          }
          return
        }
        const served = parseVersionPayload(await res.json())
        if (!served) return
        if (shouldPromptUpdate(RUNNING_VERSION, served)) {
          setServedBuildId(served.buildId)
          setAvailable(true)
          // Force the update rather than waiting for a tap on the banner.
          maybeAutoReload(served.buildId)
        }
      } catch {
        /* offline / SPA fallback returned HTML — nothing to do. */
      }
    },
    [maybeAutoReload, nativeUpdate],
  )

  // --- source 1: the service worker -------------------------------------
  useEffect(() => {
    if (!webUpdate) return
    if (!canUseServiceWorker()) return
    let cancelled = false
    let interval: number | undefined

    void registerServiceWorker(APP_BASE).then((reg) => {
      if (!reg || cancelled) return

      const markIfWaiting = () => {
        if (reg.waiting && navigator.serviceWorker.controller) setAvailable(true)
      }
      markIfWaiting()

      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          // `controller` present means this is a REPLACEMENT, not a first
          // install — only then is there anything for the user to update to.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setAvailable(true)
          }
        })
      })

      // Ask the browser to re-check the worker script periodically. Cheap, and
      // it is what turns a background deploy into a visible prompt.
      interval = window.setInterval(() => {
        void reg.update().catch(() => {})
      }, POLL_INTERVAL_MS)
    })

    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
    }
  }, [webUpdate])

  // --- source 2: the /version.json poll ---------------------------------
  useEffect(() => {
    if (!import.meta.env.PROD) return
    if (!webUpdate && !nativeUpdate) return
    void poll(true)
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS)
    const onFocus = () => void poll()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [nativeUpdate, poll, webUpdate])

  // What the banner is currently offering. Starts as the opaque 'sw' marker
  // when the service worker spotted it first, and sharpens to the real build id
  // once the poll resolves — so dismissing a worker hint does not also suppress
  // the prompt for a genuinely different build later on.
  const targetId = servedBuildId ?? 'sw'

  const dismiss = useCallback(() => {
    setDismissedBuildId(targetId)
    try {
      sessionStorage.setItem(DISMISS_KEY, targetId)
    } catch {
      /* private mode — the banner simply returns on the next detection. */
    }
  }, [targetId])

  const applyUpdate = useCallback(() => {
    if (nativeUpdate && nativeManifest) {
      void CapacitorBrowser.open({ url: nativeManifest.apkUrl }).catch(() => {
        window.location.assign(nativeManifest.apkUrl)
      })
      return
    }
    void activateUpdateAndReload()
  }, [nativeManifest, nativeUpdate])

  return {
    updateReady: available && dismissedBuildId !== targetId,
    nativeUpdate,
    applyUpdate,
    dismiss,
  }
}
