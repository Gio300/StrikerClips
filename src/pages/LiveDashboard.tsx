import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadYouTubeApi, extractYouTubeId, CLEAN_PLAYER_VARS, type YTPlayer } from '@/lib/youtubeApi'
import { CroppedFrame, TkoWatermark } from '@/components/CroppedFrame'
import { StageChat } from '@/components/StageChat'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { prettyClip } from '@/lib/clipLabel'
import { useVoiceCommands } from '@/hooks/useVoiceCommands'
import { parseCommand } from '@/lib/voiceCommands'
import { dispatchDirector } from '@/components/VoiceButton'
import { cameraGrid, MAX_DIRECTOR_FEEDS } from '@/lib/liveDirector'

/**
 * Live dashboard — our OWN (non-OBS) live control room.
 *
 * The host pastes each player's live YouTube URL to add them as a screen (up to
 * 8), then runs the room from big obvious buttons: show all angles, focus one,
 * run it back / slow-mo across every screen. A voice toggle lets the host just
 * TALK ("all screens", "focus screen 2", "run it back") and we switch — routed
 * through the same `kc:director` CustomEvent the global VoiceButton uses.
 *
 * Everything here works standalone, client-side. Multi-user sync (viewers
 * following the host) lands later with the realtime backend; this is the host's
 * control surface.
 */

const MAX_SCREENS = MAX_DIRECTOR_FEEDS

type Screen = { id: string; url: string; videoId: string }
type View = 'all' | number // 'all' or a focused screen index

let _seq = 0
const nextId = () => `scr_${Date.now()}_${_seq++}`

/** Absolute placement for each screen inside the relative stage. */
function stageStyle(index: number, count: number, view: View): React.CSSProperties {
  const base: React.CSSProperties = { position: 'absolute', transition: 'all 300ms ease' }
  if (view !== 'all') {
    return index === view
      ? { ...base, inset: 0, opacity: 1, zIndex: 1 }
      : { ...base, inset: 0, opacity: 0, zIndex: 0, pointerEvents: 'none' }
  }
  if (count <= 1) return { ...base, inset: 0 }
  const { columns, rows } = cameraGrid(count)
  // 3 or 4 → 2×2 grid
  const row = Math.floor(index / columns)
  const col = index % columns
  return {
    ...base,
    top: `${(row * 100) / rows}%`,
    left: `${(col * 100) / columns}%`,
    width: `${100 / columns}%`,
    height: `${100 / rows}%`,
  }
}

export function LiveDashboard() {
  const [screens, setScreens] = useState<Screen[]>([])
  const [urlInput, setUrlInput] = useState('')
  const [urlError, setUrlError] = useState('')
  const [view, setView] = useState<View>('all')
  const [voiceOn, setVoiceOn] = useState(false)
  const [obsVoiceOn, setObsVoiceOn] = useState(false)
  const [note, setNote] = useState('')

  const playersRef = useRef<(YTPlayer | null)[]>([])
  const containerRefs = useRef<(HTMLDivElement | null)[]>([])

  const flash = useCallback((msg: string) => {
    setNote(msg)
    window.setTimeout(() => setNote((n) => (n === msg ? '' : n)), 2500)
  }, [])

  // ── Add / remove screens ────────────────────────────────────────────────
  function addScreen(e?: React.FormEvent) {
    e?.preventDefault()
    setUrlError('')
    if (screens.length >= MAX_SCREENS) { setUrlError(`Up to ${MAX_SCREENS} screens.`); return }
    const videoId = extractYouTubeId(urlInput.trim())
    if (!videoId) { setUrlError('Paste a valid YouTube link.'); return }
    if (screens.some((s) => s.videoId === videoId)) { setUrlError('That screen is already added.'); return }
    setScreens((prev) => [...prev, { id: nextId(), url: urlInput.trim(), videoId }])
    setUrlInput('')
  }

  function removeScreen(id: string) {
    setScreens((prev) => prev.filter((s) => s.id !== id))
    setView('all')
  }

  // ── (Re)build the YouTube players whenever the screen set changes ────────
  const key = screens.map((s) => s.videoId).join(',')
  useEffect(() => {
    let cancelled = false
    const created: YTPlayer[] = []
    playersRef.current = []

    if (screens.length === 0) return
    loadYouTubeApi().then((YT) => {
      if (cancelled) return
      screens.forEach((screen, idx) => {
        const el = containerRefs.current[idx]
        if (!el) return
        const p = new YT.Player(el, {
          videoId: screen.videoId,
          width: '100%',
          height: '100%',
          playerVars: { ...CLEAN_PLAYER_VARS, mute: idx === 0 ? 0 : 1 },
          events: {
            onReady: (ev) => {
              playersRef.current[idx] = ev.target
              if (idx !== 0) { try { ev.target.mute() } catch { /* noop */ } }
            },
          },
        })
        created.push(p)
      })
    })

    return () => {
      cancelled = true
      created.forEach((p) => { try { p.destroy() } catch { /* ignore */ } })
      playersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // ── DVR-style controls, applied across every screen ─────────────────────
  const forEachPlayer = (fn: (p: YTPlayer) => void) =>
    playersRef.current.forEach((p) => { if (p) { try { fn(p) } catch { /* ignore */ } } })

  const playAll = () => forEachPlayer((p) => p.playVideo())
  const pauseAll = () => forEachPlayer((p) => p.pauseVideo())
  const runBackAll = (seconds = 10) =>
    forEachPlayer((p) => p.seekTo(Math.max(0, p.getCurrentTime() - seconds), true))
  const slowmoAll = () => forEachPlayer((p) => { p.setPlaybackRate?.(0.5); p.playVideo() })
  const normalSpeedAll = () => forEachPlayer((p) => p.setPlaybackRate?.(1))

  // ── Screen switcher: single source of truth, driven by buttons AND voice ─
  // Both the on-screen buttons and the voice layer route through `kc:director`,
  // so the switch logic lives in one place.
  useEffect(() => {
    function onDirector(e: Event) {
      const d = (e as CustomEvent).detail as { action?: string; screen?: number } | undefined
      if (!d?.action) return
      const count = playersRef.current.length || screens.length
      switch (d.action) {
        case 'all': setView('all'); flash('All screens'); break
        case 'single': setView((v) => (typeof v === 'number' ? v : 0)); flash('Single screen'); break
        case 'focus': {
          const idx = Math.max(0, Math.min((d.screen ?? 1) - 1, Math.max(0, count - 1)))
          setView(idx); flash(`Focus screen ${idx + 1}`)
          break
        }
        case 'replay': runBackAll(10); flash('Run it back 10s'); break
        case 'slowmo': slowmoAll(); flash('Slow-mo replay'); break
        default: break
      }
    }
    window.addEventListener('kc:director', onDirector as EventListener)
    return () => window.removeEventListener('kc:director', onDirector as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screens.length])

  // ── Voice: listen only while the toggle is ON, then route director intents ─
  const handleTranscript = useCallback((transcript: string) => {
    const intent = parseCommand(transcript)
    if (intent.kind === 'director') {
      // Fire the same event the switcher (above) listens for.
      dispatchDirector(intent.action, intent.screen)
    } else {
      flash(`Heard: "${transcript}" — try "all screens" or "focus screen 2"`)
    }
  }, [flash])

  const { supported, listening, interim, start, stop } = useVoiceCommands(handleTranscript)

  // Keep the mic alive while the toggle is ON (recognition auto-stops per phrase).
  useEffect(() => {
    if (voiceOn && supported && !listening) {
      const t = window.setTimeout(() => start(), 300)
      return () => window.clearTimeout(t)
    }
    if (!voiceOn && listening) stop()
  }, [voiceOn, listening, supported, start, stop])

  const count = screens.length

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Live dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            Your own control room — add each player's stream, switch angles, and run it back. No OBS required.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/broadcast"
            className="px-4 py-2 rounded-lg border border-accent text-accent font-semibold hover:bg-accent/10"
          >
            📺 Broadcast view
          </Link>
          <Link
            to="/go-live"
            className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow"
          >
            🔴 Go Live
          </Link>
        </div>
      </div>

      {/* 1. Add player streams */}
      <form onSubmit={addScreen} className="mt-5 rounded-xl border border-dark-border bg-dark-card p-4">
        <div className="text-sm font-medium text-white mb-2">Add a player's stream</div>
        <div className="flex flex-wrap gap-2">
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste a player's live YouTube link…"
            className="flex-1 min-w-[220px] px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={count >= MAX_SCREENS}
            className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold disabled:opacity-40"
          >
            Add screen
          </button>
        </div>
        {urlError && <p className="text-kunai text-xs mt-2">{urlError}</p>}
        <p className="text-xs text-gray-500 mt-2">{count}/{MAX_SCREENS} screens added.</p>

        {count > 0 && (
          <ul className="mt-3 space-y-1.5">
            {screens.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2 rounded-lg bg-dark border border-dark-border px-3 py-2">
                <span className="text-xs font-semibold text-accent shrink-0">Screen {i + 1}</span>
                <span className="text-xs text-leaf shrink-0">✓ connected</span>
                <span className="text-xs text-gray-400 truncate flex-1">{prettyClip(s.url)}</span>
                <button
                  type="button"
                  onClick={() => removeScreen(s.id)}
                  className="text-xs text-gray-500 hover:text-kunai shrink-0"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {/* 2. Multi-screen view + switching */}
      {count === 0 ? (
        <div className="mt-5 rounded-xl border border-dark-border bg-dark-card p-8 text-center text-gray-500">
          Add a stream above to start running the room.
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-3">
            <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-dark-border bg-black">
              {screens.map((s, idx) => (
                <div key={s.id} style={stageStyle(idx, count, view)}>
                  <div className="relative w-full h-full border border-black">
                    {/* Crop out the YouTube chrome so each screen reads as a clean feed. */}
                    <CroppedFrame overscan={1}>
                      <div ref={(el) => { containerRefs.current[idx] = el }} className="w-full h-full" />
                    </CroppedFrame>
                    <span className="absolute top-1 left-1 z-10 px-1.5 py-0.5 rounded bg-black/70 text-[11px] font-medium text-white pointer-events-none">
                      Screen {idx + 1}
                    </span>
                  </div>
                </div>
              ))}
              {/* Stage-level TKO watermark in place of the YouTube logo. */}
              <TkoWatermark />
            </div>
            {/* Live chat beside the stage on wide screens; stacks below on mobile. */}
            <StageChat title="Control room" heightClass="h-[280px] lg:h-auto lg:min-h-[240px]" />
          </div>

          {/* Switching buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setView('all')}
              className={`px-4 py-2 rounded-lg font-semibold text-sm ${
                view === 'all' ? 'bg-accent text-dark' : 'border border-dark-border text-white hover:border-accent/50'
              }`}
            >
              Show all
            </button>
            {screens.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setView(i)}
                className={`px-4 py-2 rounded-lg font-semibold text-sm ${
                  view === i ? 'bg-accent text-dark' : 'border border-dark-border text-white hover:border-accent/50'
                }`}
              >
                Focus {i + 1}
              </button>
            ))}
          </div>

          {/* DVR controls (applied to every screen) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button type="button" onClick={playAll} className="py-2.5 rounded-lg bg-accent text-dark font-semibold text-sm">
              ▶ Play all
            </button>
            <button type="button" onClick={pauseAll} className="py-2.5 rounded-lg border border-dark-border text-white hover:border-accent/50 text-sm">
              ⏸ Pause all
            </button>
            <button type="button" onClick={() => runBackAll(10)} className="py-2.5 rounded-lg border border-dark-border text-white hover:border-accent/50 text-sm">
              ⏪ Run it back 10s
            </button>
            <button type="button" onClick={slowmoAll} className="py-2.5 rounded-lg border border-dark-border text-white hover:border-accent/50 text-sm">
              🐢 Slow-mo
            </button>
          </div>
          <button
            type="button"
            onClick={normalSpeedAll}
            className="text-xs text-gray-400 hover:text-accent"
          >
            Reset to 1× speed
          </button>
        </div>
      )}

      {note && (
        <div className="mt-4 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm text-accent">🎙 {note}</div>
      )}

      {/* Secondary panels collapse under one-word sections so the stage + chat
          stay front-and-center. */}
      <div className="mt-5 space-y-3">
        {/* 3. Voice reference toggle */}
        <CollapsibleSection id="live-voice" label="Voice" hint={voiceOn ? 'ON' : undefined}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-medium text-white">Voice control: host talks, we switch screens</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {!supported
                  ? 'Mic isn\'t available in this browser — use the buttons above.'
                  : voiceOn
                    ? (listening ? 'Listening… say "all screens", "focus screen 2", "run it back", "slow-mo".' : 'On — reconnecting mic…')
                    : 'Off — speech is ignored. Turn on to run the room hands-free.'}
              </div>
              {voiceOn && interim && <div className="text-xs text-gray-300 mt-1">{interim}</div>}
            </div>
            <button
              type="button"
              disabled={!supported}
              onClick={() => setVoiceOn((v) => !v)}
              className={`px-4 py-2 rounded-lg font-semibold disabled:opacity-40 ${
                voiceOn ? 'bg-red-500 text-white' : 'bg-accent text-dark'
              }`}
            >
              {voiceOn ? '● Voice ON' : 'Voice OFF'}
            </button>
          </div>
        </CollapsibleSection>

        {/* 4. OBS section (simple) */}
        <CollapsibleSection id="live-source" label="Source">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-medium text-white">Streaming with OBS?</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Connecting OBS drives your scenes instead of these screens — same "host talks, we switch" idea,
                but it cuts your OBS scenes live. Full OBS control lives in the Broadcast tab.
              </div>
            </div>
            <button
              type="button"
              disabled={!supported}
              onClick={() => setObsVoiceOn((v) => !v)}
              className={`px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-40 ${
                obsVoiceOn ? 'bg-red-500 text-white' : 'border border-dark-border text-white hover:border-accent/50'
              }`}
            >
              {obsVoiceOn ? '● Voice ON (OBS)' : 'Voice OFF (OBS)'}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              to="/live-streams?tab=broadcast"
              className="px-4 py-2 rounded-lg border border-dark-border text-gray-300 text-sm hover:border-accent/50 hover:text-accent"
            >
              Connect OBS
            </Link>
            <Link to="/live-streams?tab=broadcast" className="text-xs text-accent hover:underline">
              Open the full OBS panel →
            </Link>
          </div>
        </CollapsibleSection>

        {/* 5. Go live / share */}
        <CollapsibleSection id="live-share" label="Share">
          <div className="text-sm font-medium text-white mb-2">Go live — share your stream</div>
          <p className="text-xs text-gray-500 mb-3">
            Publish your run so people can watch and share it.
          </p>
          <Link
            to="/go-live"
            className="inline-block px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow"
          >
            🔴 Go live
          </Link>
        </CollapsibleSection>
      </div>
    </div>
  )
}
