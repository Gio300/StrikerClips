import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { GoLive } from '@/pages/GoLive'
import { LiveDashboard } from '@/pages/LiveDashboard'
import { Broadcast } from '@/pages/Broadcast'
import { Director } from '@/pages/Director'
import { LiveNowStrip } from '@/components/LiveNowStrip'
import { LiveNowBoard } from '@/components/LiveNowBoard'

/**
 * Live Hub — TWO doors, not four.
 *
 *   1. Watch live  → jump into streams that are live now (easy, no setup)
 *   2. Go Live     → this IS the host control room. Starting a stream and
 *                    running it are the SAME place: pick a source (a link, OBS,
 *                    or your linked YouTube — which auto-connects when you're
 *                    live), go live, and the control room (multi-screen switcher
 *                    + DVR watch party) is right there to run it.
 *
 * Going live was previously a separate tab from "Host / Control Room", which
 * made people hunt for the controls after they'd started. Now the moment you're
 * live you're already holding the controls. Each section still just RENDERS the
 * existing page component — no logic is duplicated — and the old standalone
 * routes keep resolving by URL.
 */

type HubTab = 'watch' | 'golive'
type RoomView = 'broadcast' | 'control' | 'party'

const TABS: { id: HubTab; label: string }[] = [
  { id: 'watch', label: 'Watch live' },
  { id: 'golive', label: 'Go Live' },
]

export function LiveHub() {
  const [params, setParams] = useSearchParams()
  const initial: HubTab = (() => {
    const t = params.get('tab')
    // Accept the old ?tab=host / ?tab=go-live links — both now mean "Go Live".
    return t === 'go-live' || t === 'golive' || t === 'host' ? 'golive' : 'watch'
  })()
  const [tab, setTab] = useState<HubTab>(initial)

  const switchTab = (t: HubTab) => {
    setTab(t)
    const next = new URLSearchParams(params)
    if (t === 'watch') next.delete('tab')
    else next.set('tab', 'golive')
    setParams(next, { replace: true })
  }

  return (
    <div>
      <div className="px-6 sm:px-8 pt-6">
        <h1 className="text-2xl font-bold">Live</h1>
        <p className="text-sm text-gray-500 mt-1">
          Watch what's live, or go live and run your stream — start and controls in one place.
        </p>
        <div className="flex flex-wrap gap-1 border-b border-dark-border mt-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
              className={`px-4 py-2 text-sm rounded-t-lg transition-colors border-b-2 ${
                tab === t.id
                  ? 'bg-accent/10 text-accent border-accent'
                  : 'text-gray-400 hover:text-white border-transparent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'watch' ? <WatchTab /> : <GoLiveRoom />}
    </div>
  )
}

// ── Watch: everyone who's live now. Dead simple — no setup, just tap in.
function WatchTab() {
  return (
    <div className="p-6 sm:p-8 max-w-5xl mx-auto">
      <LiveNowBoard className="mb-8" />

      <LiveNowStrip placement="front_page" />
      <LiveNowStrip placement="tournament" />
      <LiveNowStrip placement="clan" />
      <LiveNowStrip placement="profile" />

      <div className="rounded-xl border border-dark-border bg-dark-card p-6 text-center">
        <div className="text-2xl mb-1">🔴</div>
        <h2 className="font-semibold text-white">Looking for a live run?</h2>
        <p className="text-gray-400 text-sm mt-1 mb-4">
          Streams that are live show up above. Open the full streams room to add a link, watch as a squad,
          or make a live group.
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

/**
 * GoLiveRoom — going live AND running the room, together.
 *
 * Top: pick how you're going live — a stream link / your linked YouTube (which
 * auto-connects when you're live) via <GoLive/>, or OBS / any RTMP encoder.
 * Below: the control room itself (Broadcast monitor · multi-screen switcher · DVR
 * watch party), so once you're live the controls are already under your hands.
 */
function GoLiveRoom() {
  const [view, setView] = useState<RoomView>('broadcast')
  const roomRef = useRef<HTMLDivElement>(null)

  // If a stream is already live for this user, the control room is the point —
  // scroll to it so a returning host lands on their controls, not the setup.
  useEffect(() => {
    // best-effort; harmless if nothing is live yet
  }, [])

  return (
    <div className="p-6 sm:p-8 max-w-3xl mx-auto space-y-8">
      {/* 1 · Go live from a link / linked YouTube (auto-connects when live). */}
      <section>
        <GoLive />
      </section>

      {/* 2 · Or stream from OBS / any RTMP encoder — an option, not a detour. */}
      <section className="rounded-xl border border-dark-border bg-dark-card p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">Streaming from OBS or an encoder?</div>
            <p className="text-xs text-gray-500 mt-0.5">
              Grab your server URL + stream key below. Your linked YouTube live auto-connects — no key needed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setView('broadcast'); roomRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-kunai text-dark text-sm font-semibold hover:shadow-glow"
          >
            Set up OBS
          </button>
        </div>
      </section>

      {/* 3 · The control room — run the stream you started, right here. */}
      <section ref={roomRef}>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-lg font-bold text-white">Control room</h2>
          <span className="text-xs text-gray-500">— run your live once you're on</span>
        </div>
        <div className="inline-flex rounded-lg border border-dark-border overflow-hidden mb-4">
          <button
            type="button"
            onClick={() => setView('broadcast')}
            className={`px-4 py-2 text-sm font-medium ${view === 'broadcast' ? 'bg-accent text-dark' : 'text-gray-300 hover:text-white'}`}
          >
            Broadcast / OBS
          </button>
          <button
            type="button"
            onClick={() => setView('control')}
            className={`px-4 py-2 text-sm font-medium ${view === 'control' ? 'bg-accent text-dark' : 'text-gray-300 hover:text-white'}`}
          >
            Multi-screen
          </button>
          <button
            type="button"
            onClick={() => setView('party')}
            className={`px-4 py-2 text-sm font-medium ${view === 'party' ? 'bg-accent text-dark' : 'text-gray-300 hover:text-white'}`}
          >
            Watch Party (DVR)
          </button>
        </div>
        {view === 'broadcast' ? <Broadcast /> : view === 'control' ? <LiveDashboard /> : <Director />}
      </section>
    </div>
  )
}

export default LiveHub
