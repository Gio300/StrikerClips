import { useEffect, useRef, useState } from 'react'
import { BrandLogo } from '@/components/BrandLogo'
import { setFounder } from '@/lib/founder'

/**
 * tko.cam launch splash.
 *
 * Shows a full-screen logo splash for ~5s on app load, then auto-dismisses.
 * Only shows once per browser session (sessionStorage) so route changes don't
 * re-trigger it.
 *
 * FOUNDER / REVIEWER BYPASS: tapping the logo reveals a passphrase field. If it
 * matches the founder passphrase, founder mode is unlocked and
 * every paid gate opens (see useEntitlements). For app-store review + dev only.
 *
 * SECURITY: the plaintext passphrase is NOT stored in the bundle — only the
 * SHA-256 hash of it is. We hash the entered value and compare hashes, so the
 * password can't be read out of the built JS. (This is still a client-side
 * bypass; move verification server-side once the backend is live for real
 * hardening.)
 */
const FOUNDER_PASS_HASH = 'a18f2c00b0756aca3a0d983f095ec936cb228b6d79c8d12c5ae335f2cb23d4bc'
const SPLASH_MS = 5000
const SEEN_KEY = 'tko_splash_seen'
const LEGACY_SEEN_KEY = 'kc_splash_seen'

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function Splash() {
  const [visible, setVisible] = useState(() => {
    try {
      const seen = sessionStorage.getItem(SEEN_KEY) === '1'
      const legacySeen = sessionStorage.getItem(LEGACY_SEEN_KEY) === '1'
      if (legacySeen && !seen) sessionStorage.setItem(SEEN_KEY, '1')
      sessionStorage.removeItem(LEGACY_SEEN_KEY)
      return !seen && !legacySeen
    } catch {
      return true
    }
  })
  const [showInput, setShowInput] = useState(false)
  const [pass, setPass] = useState('')
  const [error, setError] = useState(false)
  const [holding, setHolding] = useState(false)

  // Press-and-hold timer on the logo: hold for 3s to reveal the founder
  // passphrase field. We use pointer capture so a tiny finger drift can't fire
  // pointerleave and cancel the hold, and we pause the auto-dismiss while the
  // user is holding so the splash can't disappear mid-press.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearHoldTimer = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }
  const clearHold = () => {
    clearHoldTimer()
    setHolding(false)
  }
  const startHold = (e: React.PointerEvent) => {
    // Prevent the WebView from starting a text/image selection or copy callout.
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // pointer capture unsupported — the timer still works.
    }
    clearHoldTimer()
    setHolding(true)
    holdTimer.current = setTimeout(() => {
      setHolding(false)
      setShowInput(true)
    }, 3000)
  }

  // Clean up the timer if the splash unmounts mid-press.
  useEffect(() => clearHoldTimer, [])

  useEffect(() => {
    if (!visible) return
    try {
      sessionStorage.setItem(SEEN_KEY, '1')
    } catch {
      // ignore storage errors
    }
    // Don't auto-dismiss while typing a passphrase OR while holding the logo.
    if (showInput || holding) return
    const t = setTimeout(() => setVisible(false), SPLASH_MS)
    return () => clearTimeout(t)
  }, [visible, showInput, holding])

  if (!visible) return null

  async function submitPass(e: React.FormEvent) {
    e.preventDefault()
    try {
      const hash = await sha256Hex(pass.trim())
      if (hash === FOUNDER_PASS_HASH) {
        setFounder(true)
        setVisible(false)
        return
      }
    } catch {
      // Web Crypto unavailable — fall through to the error state.
    }
    setError(true)
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black">
      {/* Press-and-hold the logo for 3s to reveal the hidden founder passphrase
          field. A normal tap does nothing. We disable text/image selection and
          the long-press callout so holding the logo can't trigger a copy/select
          popup in the mobile WebView. */}
      <button
        type="button"
        onPointerDown={startHold}
        onPointerUp={clearHold}
        onPointerCancel={clearHold}
        onContextMenu={(e) => e.preventDefault()}
        draggable={false}
        style={{
          WebkitUserSelect: 'none',
          userSelect: 'none',
          WebkitTouchCallout: 'none',
          touchAction: 'none',
        }}
        className="flex flex-col items-center gap-3 p-8 focus:outline-none select-none"
        aria-label="TKO.cam"
      >
        {/* The approved square logo already contains the wordmark + tagline,
            so we render it alone here (no separate text line). */}
        <BrandLogo as="span" variant="mark" className="text-5xl sm:text-6xl select-none pointer-events-none" />
      </button>

      {!showInput ? (
        // Plain loading dots — no hint of the hidden hold-to-unlock gesture.
        <div className="mt-10 flex gap-1.5" aria-hidden>
          <span className="w-2 h-2 rounded-full bg-accent/70 animate-pulse" />
          <span className="w-2 h-2 rounded-full bg-accent/40 animate-pulse [animation-delay:150ms]" />
          <span className="w-2 h-2 rounded-full bg-accent/20 animate-pulse [animation-delay:300ms]" />
        </div>
      ) : (
        <form onSubmit={submitPass} className="mt-10 w-full max-w-xs px-6">
          <label className="block text-xs text-gray-500 mb-2 text-center">
            Enter access passphrase
          </label>
          <input
            autoFocus
            type="password"
            value={pass}
            onChange={(e) => {
              setPass(e.target.value)
              setError(false)
            }}
            className={`w-full rounded-lg bg-dark-card border px-3 py-2 text-sm text-white outline-none focus:border-accent ${
              error ? 'border-kunai' : 'border-dark-border'
            }`}
            placeholder="passphrase"
          />
          {error && <p className="mt-2 text-xs text-kunai text-center">Incorrect passphrase.</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setVisible(false)}
              className="flex-1 py-2 rounded-lg border border-dark-border text-sm text-gray-300 hover:text-white"
            >
              Skip
            </button>
            <button
              type="submit"
              className="flex-1 py-2 rounded-lg bg-accent text-dark text-sm font-semibold hover:shadow-glow"
            >
              Unlock
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
