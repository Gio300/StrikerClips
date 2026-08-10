import { useCallback, useEffect, useRef, useState } from 'react'
import {
  computeInstallState,
  detectIos,
  detectStandalone,
  type InstallState,
} from '@/lib/installPrompt'
import { useInstallBrandName, useInstallLabel } from '@/hooks/useInstallLabel'
import { androidInstallUrl } from '@/lib/nativeUpdate'

/** Chromium-only event; not yet included in lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type InstallPromptOutcome = 'accepted' | 'dismissed' | 'unavailable'

interface InstallPromptBridge {
  prompt: BeforeInstallPromptEvent | null
  installed: boolean
}

declare global {
  interface Window {
    __tkoInstallPromptBridge?: InstallPromptBridge
  }
}

const INSTALL_STATE_EVENT = 'tko:install-state'

/**
 * Capture Chromium's single-use prompt once for the whole page. Marketing has
 * more than one install CTA, so each button must share the same prompt state.
 */
function getInstallPromptBridge(): InstallPromptBridge | null {
  if (typeof window === 'undefined') return null
  if (window.__tkoInstallPromptBridge) return window.__tkoInstallPromptBridge

  const bridge: InstallPromptBridge = { prompt: null, installed: false }
  window.__tkoInstallPromptBridge = bridge

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    bridge.prompt = event as BeforeInstallPromptEvent
    window.dispatchEvent(new Event(INSTALL_STATE_EVENT))
  })
  window.addEventListener('appinstalled', () => {
    bridge.prompt = null
    bridge.installed = true
    window.dispatchEvent(new Event(INSTALL_STATE_EVENT))
  })

  return bridge
}

// Install the capture listener during module evaluation, before React effects.
getInstallPromptBridge()

export interface InstallAvailability {
  state: InstallState
  promptInstall: () => Promise<InstallPromptOutcome>
}

export function useInstallAvailability(): InstallAvailability {
  const deferred = useRef<BeforeInstallPromptEvent | null>(
    typeof window === 'undefined' ? null : getInstallPromptBridge()?.prompt ?? null,
  )
  const [promptAvailable, setPromptAvailable] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [standalone, setStandalone] = useState(false)
  const [ios, setIos] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    setIos(detectIos(navigator.userAgent, navigator.maxTouchPoints))
    const bridge = getInstallPromptBridge()
    const readInstallState = () => {
      deferred.current = bridge?.prompt ?? null
      setPromptAvailable(Boolean(bridge?.prompt))
      setInstalled(Boolean(bridge?.installed))
    }
    readInstallState()

    const mql = window.matchMedia?.('(display-mode: standalone)')
    const readStandalone = () =>
      setStandalone(
        detectStandalone({
          displayModeStandalone: mql?.matches,
          navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
        }),
      )
    readStandalone()
    mql?.addEventListener?.('change', readStandalone)
    window.addEventListener(INSTALL_STATE_EVENT, readInstallState)

    return () => {
      mql?.removeEventListener?.('change', readStandalone)
      window.removeEventListener(INSTALL_STATE_EVENT, readInstallState)
    }
  }, [])

  const promptInstall = useCallback(async (): Promise<InstallPromptOutcome> => {
    const bridge = getInstallPromptBridge()
    const event = bridge?.prompt ?? deferred.current
    if (!event) return 'unavailable'

    try {
      await event.prompt()
      const choice = await event.userChoice
      return choice.outcome
    } catch {
      return 'unavailable'
    } finally {
      // A deferred prompt is single-use. Clear it across every CTA.
      if (bridge) bridge.prompt = null
      deferred.current = null
      setPromptAvailable(false)
      window.dispatchEvent(new Event(INSTALL_STATE_EVENT))
    }
  }, [])

  return {
    state: computeInstallState({ standalone, installed, promptAvailable, ios }),
    promptInstall,
  }
}

export interface InstallAppButtonProps {
  /** 'primary' for the marketing hero/CTA, 'subtle' for in-app surfaces. */
  variant?: 'primary' | 'subtle'
  className?: string
  /**
   * Override the button text. Leave it unset: the default is the ACTIVE
   * LEAGUE's install label (useInstallLabel), so on a league domain the button
   * offers the app the browser is actually about to install — which is the
   * league's, since the manifest is now built per host (src/lib/pwaManifest.ts).
   */
  label?: string
  /** Open when installed; otherwise trigger the install prompt/help first. */
  mode?: 'install' | 'open-or-install'
  appHref?: string
}

export function InstallAppButton({
  variant = 'primary',
  className = '',
  label: labelOverride,
  mode = 'install',
  appHref = '/',
}: InstallAppButtonProps) {
  const { state, promptInstall } = useInstallAvailability()
  const [android, setAndroid] = useState(false)
  // Called unconditionally (rules of hooks); the prop still wins when passed.
  const brandLabel = useInstallLabel()
  const leagueBrandName = useInstallBrandName()
  // The league's label by default — see src/hooks/useInstallLabel.ts.
  const label = labelOverride ?? brandLabel

  useEffect(() => {
    setAndroid(/android/i.test(navigator.userAgent))
  }, [])

  if (state === 'installed') {
    if (mode === 'install') return null
    return (
      <a
        href={appHref}
        className={`${variant === 'primary' ? 'btn-primary' : 'btn-ghost'} ${className}`}
      >
        {label}
      </a>
    )
  }

  const buttonClass =
    variant === 'primary'
      ? 'btn-primary text-base px-7 py-3'
      : 'rounded-lg border border-kunai/50 bg-kunai/10 px-3 py-2.5 text-sm font-semibold text-kunai hover:bg-kunai/20'

  const apkUrl = androidInstallUrl(
    android,
    leagueBrandName,
    import.meta.env.VITE_DOWNLOAD_ANDROID,
  )
  if (apkUrl) {
    return (
      <a
        href={apkUrl}
        className={`${buttonClass} inline-flex items-center justify-center ${className}`}
      >
        {label}
      </a>
    )
  }

  if (state === 'available') {
    return (
      <button
        type="button"
        onClick={() => {
          void (async () => {
            const outcome = await promptInstall()
            if (mode === 'open-or-install' && outcome === 'accepted') {
              window.location.assign(appHref)
            }
          })()
        }}
        className={`${buttonClass} ${className}`}
      >
        {label}
      </button>
    )
  }

  return (
    <a
      href={appHref}
      className={`${buttonClass} inline-flex items-center justify-center ${className}`}
    >
      Continue in browser
    </a>
  )
}
