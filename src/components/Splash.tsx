import { useEffect, useMemo, useRef, useState } from 'react'
import { BrandLogo } from '@/components/BrandLogo'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'
import { leagueSplashVideoFor } from '@/components/LeagueWatermark'
import { domainLeagueSlug } from '@/lib/leagueDomain'
import { leagueCan } from '@/lib/leaguePlans'
import { BRAND } from '@/lib/brand'
import { setFounder } from '@/lib/founder'
import { shouldShowInlineTkoAttribution } from '@/lib/displayBrand'

/**
 * App-load splash.
 *
 * Shows a full-screen splash for ~5s on app load, then auto-dismisses. Only
 * shows once per browser session (sessionStorage) so route changes don't
 * re-trigger it.
 *
 * LEAGUE MOTION SPLASH (operator 2026-08-03): on a DOMAIN takeover (e.g.
 * shinobistrikerleague.com) a league with a bundled splash video
 * (LEAGUE_SPLASH_VIDEOS in LeagueWatermark.tsx) gets that VIDEO as the
 * splash — full-screen contain on black, autoplay muted, no controls; it
 * dismisses when the video ends or at the usual max duration, whichever
 * comes first. The video already carries the league's branding, so only the
 * small "Powered by TKO.cam" line overlays it (SSL always retains this exact
 * attribution; other white-label leagues may hide it). The static lockup remains for tko.cam, for leagues
 * without a video, for prefers-reduced-motion users, and as the fail-soft
 * path when the video errors.
 *
 * FOUNDER / REVIEWER BYPASS: press-and-hold the splash (logo or video) for 3s
 * to reveal a passphrase field. If it matches the founder passphrase, founder
 * mode is unlocked and every paid gate opens (see useEntitlements). For
 * app-store review + dev only.
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

/**
 * THE splash selection rule, pure and testable: the league's bundled motion
 * splash plays only when the page is served AS that league (domain takeover /
 * ?league= preview) AND the user hasn't asked for reduced motion. Everything
 * else — tko.cam, unknown leagues, reduced motion — is the static lockup
 * (null). Fail-soft: a runtime video error also drops back to static.
 */
export function splashVideoFor(
  domainSlug: string | null,
  reducedMotion: boolean,
): string | null {
  if (reducedMotion) return null
  return leagueSplashVideoFor(domainSlug)
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function Splash({ onComplete }: { onComplete?: () => void } = {}) {
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
  const [videoFailed, setVideoFailed] = useState(false)

  // League motion splash (domain takeover only — tko.cam always gets the
  // static lockup because domainLeagueSlug() is null there). Resolved once:
  // the splash mounts before any navigation could change the answer.
  const videoSrc = useMemo(
    () => splashVideoFor(domainLeagueSlug(), prefersReducedMotion()),
    [],
  )
  const video = videoFailed ? null : videoSrc

  // White-label is a PURCHASED capability (see src/lib/leaguePlans.ts), not a
  // tier string a league owner can type on themselves. Everyone else wears the
  // powered-by line over the video.
  const { league, display } = useLeagueTheme()
  const poweredBy = shouldShowInlineTkoAttribution(
    display,
    leagueCan('clean_brand', league?.tier, league?.plan_status),
  )

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

  // Full-bleed flows such as /setup can use the splash as a real gate instead
  // of merely painting it over content that has already started onboarding.
  useEffect(() => {
    if (!visible) onComplete?.()
  }, [visible, onComplete])

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

  // Shared founder passphrase form (static splash + video splash overlay).
  const passForm = (
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
  )

  // Suppress selection/callout so press-and-hold can't trigger a copy popup
  // in the mobile WebView (same trick on both splash modes).
  const holdStyle: React.CSSProperties = {
    WebkitUserSelect: 'none',
    userSelect: 'none',
    WebkitTouchCallout: 'none',
    touchAction: 'none',
  }

  if (video) {
    // LEAGUE MOTION SPLASH — the video IS the branding (full-screen contain on
    // black, muted, no controls). Ends on video end or the SPLASH_MS cap
    // (whichever first, via the shared timer above); the founder press-and-hold
    // works on the whole surface, and a video error fails soft to the static
    // lockup render below.
    return (
      <div className="fixed inset-0 z-[100] bg-black">
        <video
          src={video}
          autoPlay
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          // React quirk: the `muted` prop isn't always reflected as an
          // attribute before playback starts — set it imperatively so mobile
          // autoplay policies never block the splash.
          ref={(el) => { if (el) el.muted = true }}
          onEnded={() => {
            // Don't yank the splash away mid-passphrase or mid-hold; the
            // video just freezes on its last frame behind the form.
            if (!showInput && !holding) setVisible(false)
          }}
          onError={() => setVideoFailed(true)}
          className="h-full w-full object-contain"
          aria-hidden
        />
        {/* Invisible full-surface hold target — the same hidden 3s
            press-and-hold founder gesture as the static splash. */}
        {!showInput && (
          <button
            type="button"
            onPointerDown={startHold}
            onPointerUp={clearHold}
            onPointerCancel={clearHold}
            onContextMenu={(e) => e.preventDefault()}
            draggable={false}
            style={holdStyle}
            className="absolute inset-0 h-full w-full focus:outline-none select-none"
            aria-label={league?.name || 'TKO.cam'}
          />
        )}
        {/* The video already carries the league's branding, so TKO stays a
            small powered-by line at the bottom (always for SSL). */}
        {poweredBy && !showInput && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] flex justify-center">
            <span data-tko-attribution className="inline-flex items-baseline gap-1 text-[10px] font-normal leading-tight text-gray-500">
              Powered by
              <span className="font-brand font-bold">
                <span className="text-white">{BRAND.nameParts[0]}</span>
                <span className="text-cam">{BRAND.nameParts[1]}</span>
              </span>
            </span>
          </div>
        )}
        {showInput && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
            {passForm}
          </div>
        )}
      </div>
    )
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
        style={holdStyle}
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
        passForm
      )}
    </div>
  )
}
