import { type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { GoLive } from '@/pages/GoLive'
import { Director } from '@/pages/Director'
import { Videos } from '@/pages/Videos'
import { OBSPanel } from '@/components/OBSPanel'
import { LiveNowBoard } from '@/components/LiveNowBoard'
import { ActionCard } from '@/components/ui/ActionCard'
import type { NinjaIconName } from '@/components/ui/NinjaIcon'

/**
 * Live — a GUIDED, one-choice-at-a-time entry, now GROUPED into two clear
 * sections so the big difference (broadcast vs. watch) is obvious at a glance:
 *
 *   ── Go live ──────────────────────────────────────────────
 *     1. Go Live                   → <GoLive/> — add stream(s): yours and/or
 *                                    other players'. This is the MERGED
 *                                    "go live — my gameplay" + "host a
 *                                    multi-stream" — it's the same thing, you
 *                                    just pick which stream(s) go on the show.
 *     2. Broadcast with OBS/encoder → the OBS panel, on its own.
 *   ── Watch ────────────────────────────────────────────────
 *     3. Watch live now            → the live list (who's live)
 *     4. Watch made videos         → the produced-videos feed
 *     5. Watch Party (DVR)         → the DVR/replay room, on its own
 *
 * One screen = one decision. The underlying capabilities are unchanged — they're
 * just gated behind clear single choices instead of shown all at once. Every
 * choice is deep-linkable via `?do=`; the old `?do=multi`/`?tab=` links still
 * resolve (multi now aliases the merged Go Live).
 */

type Screen = 'menu' | 'golive' | 'watch' | 'videos' | 'obs' | 'party'

const SCREENS: Screen[] = ['menu', 'golive', 'watch', 'videos', 'obs', 'party']

// Accept the old ?tab=… / ?do=multi deep links so existing buttons/bookmarks
// keep working. `multi` (host-a-multi-stream) is now folded into Go Live.
function screenFromParams(params: URLSearchParams): Screen {
  const doParam = params.get('do')
  if (doParam === 'multi' || doParam === 'host') return 'golive'
  if (doParam && (SCREENS as string[]).includes(doParam)) return doParam as Screen
  const tab = params.get('tab')
  if (tab === 'watch') return 'watch'
  if (tab === 'go-live' || tab === 'golive' || tab === 'host') return 'golive'
  return 'menu'
}

type MenuItem = { id: Screen; icon: NinjaIconName; label: string; sub: string }

const GO_LIVE_MENU: MenuItem[] = [
  { id: 'golive', icon: 'live', label: 'Go Live', sub: 'Add stream(s) — yours and/or other players — and broadcast one show.' },
  { id: 'obs', icon: 'bolt', label: 'Broadcast with OBS / encoder', sub: 'Grab your server URL + stream key for OBS or any RTMP encoder.' },
]

const WATCH_MENU: MenuItem[] = [
  { id: 'watch', icon: 'watch', label: 'Watch live now', sub: "See who's live and jump in." },
  { id: 'videos', icon: 'play', label: 'Watch made videos', sub: 'Recently produced multi-angle videos.' },
  { id: 'party', icon: 'sparkle', label: 'Watch Party (DVR)', sub: 'Run several angles back with replay + slow-mo.' },
]

const MENU: MenuItem[] = [...GO_LIVE_MENU, ...WATCH_MENU]

export function LiveHub() {
  const [params, setParams] = useSearchParams()

  /**
   * THE URL IS THE SCREEN — derived every render, never copied into state.
   *
   * This used to be `useState(() => screenFromParams(params))`, and a lazy
   * initializer runs ONCE PER MOUNT. `/live` and `/live?do=golive` are the same
   * <Route>, so arriving at the second while already on the first re-rendered
   * this component instead of remounting it — and the initializer never ran
   * again. The screen stayed on whatever it was when the page first opened.
   *
   * This matters for every link to the go-live door (`/live?do=golive`). Links
   * followed while LiveHub was mounted changed the address bar but not the
   * screen; links followed elsewhere mounted LiveHub fresh and appeared to work.
   *
   * Deriving instead of storing also makes browser Back/Forward move between
   * these screens, which the copy could never do.
   */
  const screen = screenFromParams(params)

  const go = (next: Screen) => {
    const p = new URLSearchParams(params)
    p.delete('tab')
    if (next === 'menu') p.delete('do')
    else p.set('do', next)
    setParams(p, { replace: true })
  }

  if (screen === 'menu') {
    return (
      <div className="p-6 sm:p-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold">Live</h1>
        <p className="text-sm text-gray-500 mt-1">
          One tap, one thing. Two ways in — broadcast, or watch.
        </p>

        {/* ── Section: Go live ──────────────────────────────────────────── */}
        <SectionLabel>Go live</SectionLabel>
        <div className="space-y-3">
          {GO_LIVE_MENU.map((m) => (
            <ActionCard key={m.id} icon={m.icon} label={m.label} sublabel={m.sub} onClick={() => go(m.id)} />
          ))}
        </div>

        {/* Divider between the two clearly-different intents. */}
        <div className="my-6 border-t border-dark-border" aria-hidden />

        {/* ── Section: Watch ────────────────────────────────────────────── */}
        <SectionLabel>Watch</SectionLabel>
        <div className="space-y-3">
          {WATCH_MENU.map((m) => (
            <ActionCard key={m.id} icon={m.icon} label={m.label} sublabel={m.sub} onClick={() => go(m.id)} />
          ))}
        </div>
      </div>
    )
  }

  const title = MENU.find((m) => m.id === screen)?.label ?? 'Live'

  return (
    <div>
      <div className="px-6 sm:px-8 pt-6">
        <button
          type="button"
          onClick={() => go('menu')}
          className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-accent"
        >
          <span aria-hidden>←</span> Live menu
        </button>
        <span className="ml-3 text-sm text-gray-600">·&nbsp; {title}</span>
      </div>

      {screen === 'golive' && <GoLive />}
      {screen === 'watch' && <WatchScreen />}
      {screen === 'videos' && <Videos />}
      {screen === 'obs' && <ObsScreen />}
      {screen === 'party' && <Director />}
    </div>
  )
}

// A small, styled section header that divides the menu into "Go live" / "Watch".
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-6 mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
      {children}
    </h2>
  )
}

// ── Watch: everyone who's live now. Dead simple — no setup, just tap in. ──────
function WatchScreen() {
  return (
    <div className="p-6 sm:p-8 max-w-5xl mx-auto">
      <LiveNowBoard className="mb-8" />

      <div className="rounded-xl border border-dark-border bg-dark-card p-6 text-center">
        <div className="text-2xl mb-1">🔴</div>
        <h2 className="font-semibold text-white">Looking for a live run?</h2>
        <p className="text-gray-400 text-sm mt-1 mb-4">
          Streams that are live show up above. Open the full streams room to watch as a squad or link angles.
        </p>
        <Link
          to="/live-streams"
          className="inline-block px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow"
        >
          Open streams room
        </Link>
      </div>
    </div>
  )
}

// ── OBS / encoder setup — on its own, not crammed onto every screen. ─────────
function ObsScreen() {
  return (
    <div className="p-6 sm:p-8 max-w-3xl mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">OBS / encoder setup</h1>
        <p className="text-sm text-gray-500 mt-1">
          Grab your server URL + stream key for OBS or any RTMP encoder. Your linked YouTube live
          auto-connects — no key needed there.
        </p>
      </div>
      <OBSPanel />
    </div>
  )
}

export default LiveHub
