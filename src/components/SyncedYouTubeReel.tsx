import { useEffect, useRef, useState } from 'react'
import { loadYouTubeApi, extractYouTubeId, type YTPlayer } from '@/lib/youtubeApi'
import { fetchActionCurve, type ActionCurve } from '@/lib/youtubeActionCurve'
import {
  initialState,
  step,
  scoreSnapshot,
  audioIndex,
  type DirectorState,
  type Shot,
  type ShotKind,
} from '@/lib/directorEngine'
import { PlayerChrome, slotColor, type SlotVariant } from '@/components/PlayerChrome'
import {
  applyClutchBoost,
  getActiveProfile,
  subscribeProfile,
  type ClutchRuntime,
  type GameProfile,
} from '@/lib/gameProfile'
import type { ReelLayout, Clip } from '@/types/database'

type Props = {
  layout: ReelLayout
  clips: Clip[]
}

/**
 * Renders multi-angle YouTube clips as synchronized iframes.
 *
 *   layout='concat'        single iframe; auto-advances on each clip's ENDED event
 *   layout='grid'          2x2 grid of 4 iframes, single Play button starts all
 *   layout='side-by-side'  2 iframes side-by-side, single Play button starts both
 *   layout='pip'           main iframe + small overlay iframe in bottom-right
 *   layout='action'        director engine in single-screen mode — switches when
 *                          another angle has more action (heatmap-driven, 12s min hold)
 *   layout='ultra'         full director engine — flows between single, side-by-side,
 *                          PiP, and squad-grid based on per-angle action curves
 */
export function SyncedYouTubeReel({ layout, clips }: Props) {
  if (layout === 'concat') return <ConcatPlayer clips={clips} />
  if (layout === 'grid') return <SyncedGridPlayer clips={clips.slice(0, 4)} layout="grid" />
  if (layout === 'side-by-side') return <SyncedGridPlayer clips={clips.slice(0, 2)} layout="side-by-side" />
  if (layout === 'pip') return <PipPlayer clips={clips.slice(0, 2)} />
  if (layout === 'action') return <DirectorPlayer clips={clips.slice(0, 8)} mode="single-only" />
  if (layout === 'ultra') return <DirectorPlayer clips={clips.slice(0, 8)} mode="full" />
  return null
}

/** Single-iframe sequential playback. Auto-advances on YT.PlayerState.ENDED. */
function ConcatPlayer({ clips }: { clips: Clip[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let player: YTPlayer | null = null

    if (clips.length === 0) return

    loadYouTubeApi().then((YT) => {
      if (cancelled || !containerRef.current) return
      const first = clips[0]
      const firstId = extractYouTubeId(first.url_or_path)
      if (!firstId) return

      player = new YT.Player(containerRef.current, {
        videoId: firstId,
        width: '100%',
        height: '100%',
        playerVars: {
          start: first.start_sec ?? 0,
          end: first.end_sec ?? undefined,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: () => { setReady(true) },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) {
              setCurrentIdx((i) => Math.min(i + 1, clips.length - 1))
            }
          },
        },
      })
      playerRef.current = player
    })

    return () => {
      cancelled = true
      try { player?.destroy() } catch { /* ignore */ }
      playerRef.current = null
    }
  }, [clips])

  useEffect(() => {
    if (!ready || !playerRef.current) return
    if (currentIdx === 0) return
    const c = clips[currentIdx]
    const id = extractYouTubeId(c.url_or_path)
    if (!id) return
    playerRef.current.loadVideoById({
      videoId: id,
      startSeconds: c.start_sec ?? 0,
      endSeconds: c.end_sec ?? undefined,
    })
  }, [currentIdx, ready, clips])

  return (
    <div className="w-full h-full flex flex-col">
      <div ref={containerRef} className="w-full flex-1 bg-black" />
      <div className="px-3 py-2 border-t border-dark-border bg-dark-card flex items-center gap-2">
        <span className="text-xs text-gray-400">
          Clip {currentIdx + 1} / {clips.length}
        </span>
        <div className="flex-1 flex gap-1">
          {clips.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setCurrentIdx(i)}
              className={`flex-1 h-1.5 rounded ${i === currentIdx ? 'bg-accent' : i < currentIdx ? 'bg-accent/50' : 'bg-dark-border'}`}
              title={`Jump to clip ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Multi-angle layouts that share a single Play button. */
function SyncedGridPlayer({ clips, layout }: { clips: Clip[]; layout: 'grid' | 'side-by-side' }) {
  const playersRef = useRef<(YTPlayer | null)[]>([])
  const [readyCount, setReadyCount] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState<number>(0)

  const containerRefs = useRef<(HTMLDivElement | null)[]>([])
  const slotCount = clips.length

  useEffect(() => {
    let cancelled = false
    const created: YTPlayer[] = []
    setReadyCount(0)

    loadYouTubeApi().then((YT) => {
      if (cancelled) return
      clips.forEach((clip, idx) => {
        const el = containerRefs.current[idx]
        if (!el) return
        const videoId = extractYouTubeId(clip.url_or_path)
        if (!videoId) return
        const p = new YT.Player(el, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            start: clip.start_sec ?? 0,
            end: clip.end_sec ?? undefined,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            controls: 1,
            mute: idx === 0 ? 0 : 1,
          },
          events: {
            onReady: (e) => {
              playersRef.current[idx] = e.target
              if (idx !== 0) e.target.mute()
              setReadyCount((c) => c + 1)
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
  }, [clips])

  function playAll() {
    playersRef.current.forEach((p) => { try { p?.playVideo() } catch { /* ignore */ } })
    setPlaying(true)
  }

  function pauseAll() {
    playersRef.current.forEach((p) => { try { p?.pauseVideo() } catch { /* ignore */ } })
    setPlaying(false)
  }

  function restart() {
    playersRef.current.forEach((p, idx) => {
      const c = clips[idx]
      const start = c?.start_sec ?? 0
      try {
        p?.seekTo(start, true)
      } catch { /* ignore */ }
    })
  }

  function pickAudio(idx: number) {
    setMuted(idx)
    playersRef.current.forEach((p, i) => {
      try {
        if (i === idx) p?.unMute()
        else p?.mute()
      } catch { /* ignore */ }
    })
  }

  const allReady = readyCount === slotCount && slotCount > 0
  const gridClass = layout === 'grid' ? 'grid grid-cols-2 grid-rows-2' : 'grid grid-cols-2 grid-rows-1'
  const cellVariant: SlotVariant = layout === 'grid' ? 'cell' : 'sxs'

  return (
    <div className="w-full h-full flex flex-col">
      <div className={`flex-1 ${gridClass} gap-2 p-2 bg-gradient-to-br from-dark-elevated to-dark`}>
        {clips.map((c, idx) => (
          <PlayerChrome
            key={c.id ?? idx}
            slotIndex={idx}
            variant={cellVariant}
            isAudio={muted === idx}
            label={c.title || undefined}
            className="bg-black"
            style={{ width: '100%', height: '100%' }}
          >
            <div ref={(el) => { containerRefs.current[idx] = el }} className="w-full h-full" />
            {muted !== idx && (
              <button
                type="button"
                onClick={() => pickAudio(idx)}
                className="absolute top-1.5 right-1.5 z-10 px-2 py-0.5 rounded bg-black/70 text-white text-[11px] font-medium hover:bg-accent/80 hover:text-dark transition-colors"
                title="Use this angle's audio"
                style={{ backdropFilter: 'blur(2px)' }}
              >
                Use audio
              </button>
            )}
          </PlayerChrome>
        ))}
      </div>
      <div className="px-3 py-2 border-t border-dark-border bg-dark-card flex items-center gap-2">
        <button
          type="button"
          onClick={playing ? pauseAll : playAll}
          disabled={!allReady}
          className="px-4 py-1.5 rounded bg-accent text-dark text-sm font-semibold disabled:opacity-40"
        >
          {!allReady ? `Loading (${readyCount}/${slotCount})…` : playing ? 'Pause all' : 'Play all'}
        </button>
        <button
          type="button"
          onClick={restart}
          disabled={!allReady}
          className="px-3 py-1.5 rounded border border-dark-border text-gray-300 text-sm hover:border-accent/50 hover:text-accent disabled:opacity-40"
        >
          Restart
        </button>
        <span className="ml-auto text-xs text-gray-500">
          {layout === 'grid' ? '2×2 squad view' : 'Side-by-side'} · synced playback
        </span>
      </div>
    </div>
  )
}

/** Picture-in-picture: main fullscreen iframe + small overlay iframe. */
function PipPlayer({ clips }: { clips: Clip[] }) {
  const mainContainerRef = useRef<HTMLDivElement>(null)
  const pipContainerRef = useRef<HTMLDivElement>(null)
  const playersRef = useRef<(YTPlayer | null)[]>([])
  const [readyCount, setReadyCount] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    let cancelled = false
    const created: YTPlayer[] = []
    setReadyCount(0)

    loadYouTubeApi().then((YT) => {
      if (cancelled || !mainContainerRef.current || !pipContainerRef.current) return
      const main = clips[0], pip = clips[1]
      if (!main || !pip) return
      const mainId = extractYouTubeId(main.url_or_path)
      const pipId = extractYouTubeId(pip.url_or_path)
      if (!mainId || !pipId) return

      const mainPlayer = new YT.Player(mainContainerRef.current, {
        videoId: mainId,
        width: '100%',
        height: '100%',
        playerVars: {
          start: main.start_sec ?? 0,
          end: main.end_sec ?? undefined,
          modestbranding: 1, rel: 0, playsinline: 1,
        },
        events: {
          onReady: (e) => { playersRef.current[0] = e.target; setReadyCount((c) => c + 1) },
        },
      })
      const pipPlayer = new YT.Player(pipContainerRef.current, {
        videoId: pipId,
        width: '100%',
        height: '100%',
        playerVars: {
          start: pip.start_sec ?? 0,
          end: pip.end_sec ?? undefined,
          modestbranding: 1, rel: 0, playsinline: 1, mute: 1,
        },
        events: {
          onReady: (e) => { playersRef.current[1] = e.target; e.target.mute(); setReadyCount((c) => c + 1) },
        },
      })
      created.push(mainPlayer, pipPlayer)
    })

    return () => {
      cancelled = true
      created.forEach((p) => { try { p.destroy() } catch { /* ignore */ } })
      playersRef.current = []
    }
  }, [clips])

  function playAll() {
    playersRef.current.forEach((p) => { try { p?.playVideo() } catch { /* ignore */ } })
    setPlaying(true)
  }
  function pauseAll() {
    playersRef.current.forEach((p) => { try { p?.pauseVideo() } catch { /* ignore */ } })
    setPlaying(false)
  }

  const allReady = readyCount === 2

  return (
    <div className="w-full h-full flex flex-col">
      <div className="relative flex-1 bg-black">
        <PlayerChrome
          slotIndex={0}
          variant="main"
          isAudio
          isPrimary
          label={clips[0]?.title || undefined}
          className="w-full h-full"
        >
          <div ref={mainContainerRef} className="w-full h-full" />
        </PlayerChrome>
        <PlayerChrome
          slotIndex={1}
          variant="pip-overlay"
          label={clips[1]?.title || undefined}
          className="absolute bottom-3 right-3 w-1/4 aspect-video bg-black"
        >
          <div ref={pipContainerRef} className="w-full h-full" />
        </PlayerChrome>
      </div>
      <div className="px-3 py-2 border-t border-dark-border bg-dark-card flex items-center gap-2">
        <button
          type="button"
          onClick={playing ? pauseAll : playAll}
          disabled={!allReady}
          className="px-4 py-1.5 rounded bg-accent text-dark text-sm font-semibold disabled:opacity-40"
        >
          {!allReady ? `Loading (${readyCount}/2)…` : playing ? 'Pause both' : 'Play both'}
        </button>
        <span className="ml-auto text-xs text-gray-500">
          Picture-in-picture · synced
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  Director-driven players
// ─────────────────────────────────────────────────────────────────────────
//
// Both 'action' and 'ultra' layouts run the same engine. They differ in
// which compositions the engine is allowed to pick:
//   mode='single-only' (Action cam) → director can ONLY emit single shots,
//     so it picks the angle with the most action and switches when another
//     angle gets hotter.
//   mode='full' (Ultra) → director picks single / sxs / pip / 2x2 grid
//     based on how many angles are popping at once.
//
// Switching rules (per user spec):
//   * Min hold per shot: 12 seconds — never flickers.
//   * If the leader's action goes flat, jump to whichever angle is hottest.
//   * Even a consistently-hot leader gets pulled after ~28 s so every
//     contributor gets airtime (fairness rotation).
//   * For 'full' mode: if a 2nd angle is also popping, we go side-by-side
//     or PiP so we don't lose the secondary action.
//
// Each clip's per-second action curve comes from YouTube's "most replayed"
// heatmap, fetched via a free CORS relay and cached aggressively.

type DirectorMode = 'full' | 'single-only'

type SlotPlacement =
  | { kind: 'main' }
  | { kind: 'left' }
  | { kind: 'right' }
  | { kind: 'overlay' }
  | { kind: 'cell'; row: 0 | 1; col: 0 | 1 }
  | { kind: 'hidden' }

function placementForShot(shot: Shot, idx: number): SlotPlacement {
  if (shot.kind === 'single') {
    return idx === shot.primary ? { kind: 'main' } : { kind: 'hidden' }
  }
  if (shot.kind === 'sxs') {
    if (idx === shot.primary) return { kind: 'left' }
    if (idx === shot.secondary) return { kind: 'right' }
    return { kind: 'hidden' }
  }
  if (shot.kind === 'pip') {
    if (idx === shot.primary) return { kind: 'main' }
    if (idx === shot.overlay) return { kind: 'overlay' }
    return { kind: 'hidden' }
  }
  // grid
  const cells = shot.cells ?? []
  const cellIdx = cells.indexOf(idx)
  if (cellIdx === -1 || cellIdx > 3) return { kind: 'hidden' }
  return { kind: 'cell', row: (cellIdx < 2 ? 0 : 1) as 0 | 1, col: ((cellIdx % 2) as 0 | 1) }
}

function placementToVariant(p: SlotPlacement): SlotVariant | null {
  switch (p.kind) {
    case 'main': return 'main'
    case 'left':
    case 'right': return 'sxs'
    case 'overlay': return 'pip-overlay'
    case 'cell': return 'cell'
    case 'hidden':
    default: return null
  }
}

/**
 * Layout/positioning only — no frame/shadow styling. PlayerChrome owns the
 * frame look so it can be per-slot colored consistently across players.
 */
function placementToStyle(p: SlotPlacement): React.CSSProperties {
  switch (p.kind) {
    case 'main':
      return {
        top: 0, left: 0, right: 'auto', bottom: 'auto',
        width: '100%', height: '100%',
        opacity: 1, zIndex: 1,
      }
    case 'left':
      // Slight inset so the slot frames don't paint over each other at the seam.
      return {
        top: '4px', left: '4px', right: 'auto', bottom: '4px',
        width: 'calc(50% - 6px)', height: 'calc(100% - 8px)',
        opacity: 1, zIndex: 1,
      }
    case 'right':
      return {
        top: '4px', left: 'calc(50% + 2px)', right: 'auto', bottom: '4px',
        width: 'calc(50% - 6px)', height: 'calc(100% - 8px)',
        opacity: 1, zIndex: 1,
      }
    case 'overlay':
      return {
        top: 'auto', left: 'auto', right: '3%', bottom: '5%',
        width: '28%', aspectRatio: '16 / 9', height: 'auto',
        opacity: 1, zIndex: 3,
      }
    case 'cell':
      return {
        top: p.row === 0 ? '4px' : 'calc(50% + 2px)',
        left: p.col === 0 ? '4px' : 'calc(50% + 2px)',
        right: 'auto', bottom: 'auto',
        width: 'calc(50% - 6px)', height: 'calc(50% - 6px)',
        opacity: 1, zIndex: 1,
      }
    case 'hidden':
    default:
      return {
        top: 0, left: 0, right: 'auto', bottom: 'auto',
        width: '100%', height: '100%',
        opacity: 0, zIndex: 0, pointerEvents: 'none',
      }
  }
}

function DirectorPlayer({ clips, mode }: { clips: Clip[]; mode: DirectorMode }) {
  const containerRefs = useRef<(HTMLDivElement | null)[]>([])
  const playersRef = useRef<(YTPlayer | null)[]>([])
  const [readyCount, setReadyCount] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [shot, setShot] = useState<Shot | null>(null)
  const [autoDirector, setAutoDirector] = useState(true)
  const [scores, setScores] = useState<number[]>([])
  const [curvesLoaded, setCurvesLoaded] = useState(0)
  const [showMeter, setShowMeter] = useState(true)
  const slotCount = clips.length

  // Stable identity for the curves array so the director loop doesn't churn.
  const curvesRef = useRef<(ActionCurve | null)[]>([])
  const stateRef = useRef<DirectorState | null>(null)
  const modeRef = useRef<DirectorMode>(mode)
  modeRef.current = mode

  // Active game profile drives the clutch-boost layer. Mirrored in a ref
  // so the director loop reads the freshest profile without re-subscribing.
  const profileRef = useRef<GameProfile>(getActiveProfile())
  const [, forceProfileTick] = useState(0)
  useEffect(() => {
    return subscribeProfile((p) => {
      profileRef.current = p
      forceProfileTick((n) => n + 1)
    })
  }, [])

  // Per-clip runtime signals for clutch rules. Today we don't yet feed
  // most signals (no telemetry pipeline), so this is mostly empty per
  // slot. The contract is in place for when local-AI / vision tagging
  // ships and starts populating these.
  const runtimeRef = useRef<ClutchRuntime[]>(
    new Array(slotCount).fill(null).map(() => ({ flags: new Set<string>() })),
  )
  if (runtimeRef.current.length !== slotCount) {
    runtimeRef.current = new Array(slotCount).fill(null).map(() => ({ flags: new Set<string>() }))
  }
  const boostFn = (scores: number[]) =>
    applyClutchBoost(scores, runtimeRef.current, profileRef.current)

  // Boot the iframes.
  useEffect(() => {
    let cancelled = false
    const created: YTPlayer[] = []
    setReadyCount(0)

    loadYouTubeApi().then((YT) => {
      if (cancelled) return
      clips.forEach((clip, idx) => {
        const el = containerRefs.current[idx]
        if (!el) return
        const videoId = extractYouTubeId(clip.url_or_path)
        if (!videoId) return
        const p = new YT.Player(el, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            start: clip.start_sec ?? 0,
            end: clip.end_sec ?? undefined,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            controls: 0,
            mute: idx === 0 ? 0 : 1,
          },
          events: {
            onReady: (e) => {
              playersRef.current[idx] = e.target
              if (idx !== 0) e.target.mute()
              setReadyCount((c) => c + 1)
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
  }, [clips])

  // Pre-fetch action curves for every clip (cached after first load).
  useEffect(() => {
    let cancelled = false
    curvesRef.current = clips.map(() => null)
    setCurvesLoaded(0)
    clips.forEach((clip, idx) => {
      const id = extractYouTubeId(clip.url_or_path)
      if (!id) return
      fetchActionCurve(id).then((curve) => {
        if (cancelled) return
        curvesRef.current[idx] = curve
        setCurvesLoaded((n) => n + 1)
      })
    })
    return () => { cancelled = true }
  }, [clips])

  // Initialize director state once we know the angle count.
  useEffect(() => {
    const now = performance.now() / 1000
    const initial = initialState(slotCount, now)
    // For single-only mode the opener should be a single, not a grid.
    if (modeRef.current === 'single-only') {
      initial.shot = { kind: 'single', primary: 0, reason: 'cold open', startedAt: now }
    }
    stateRef.current = initial
    setShot(initial.shot)
  }, [slotCount])

  // Audio routing: only the shot's primary is unmuted.
  useEffect(() => {
    if (!shot) return
    const audio = audioIndex(shot)
    playersRef.current.forEach((p, i) => {
      try {
        if (i === audio) p?.unMute()
        else p?.mute()
      } catch { /* ignore */ }
    })
  }, [shot])

  // The director loop: every 250 ms, sample per-clip currentTime, run the
  // engine, and update the shot if the engine signals a switch.
  useEffect(() => {
    if (!autoDirector || !playing) return
    const id = window.setInterval(() => {
      const state = stateRef.current
      if (!state) return
      const playTimes = playersRef.current.map((p) => {
        try { return p?.getCurrentTime?.() ?? 0 } catch { return 0 }
      })
      setScores(scoreSnapshot(curvesRef.current, playTimes, boostFn))

      // In single-only mode the engine still picks composites — we squash
      // them down to single before exposing.
      const result = step({
        state,
        now: performance.now() / 1000,
        playTimes,
        curves: curvesRef.current,
        boost: boostFn,
      })
      if (modeRef.current === 'single-only' && result.switched) {
        result.state = {
          ...result.state,
          shot: {
            kind: 'single',
            primary: result.state.shot.primary,
            reason: result.state.shot.reason,
            startedAt: result.state.shot.startedAt,
          },
        }
      }
      stateRef.current = result.state
      if (result.switched) setShot(result.state.shot)
    }, 250)
    return () => window.clearInterval(id)
  }, [autoDirector, playing])

  function playAll() {
    playersRef.current.forEach((p) => { try { p?.playVideo() } catch { /* ignore */ } })
    setPlaying(true)
    if (stateRef.current) {
      // Reset hold timer so the cold-open shot gets its full 12-s screen
      // time starting from "play pressed".
      const now = performance.now() / 1000
      stateRef.current = {
        ...stateRef.current,
        shot: { ...stateRef.current.shot, startedAt: now },
      }
    }
  }
  function pauseAll() {
    playersRef.current.forEach((p) => { try { p?.pauseVideo() } catch { /* ignore */ } })
    setPlaying(false)
  }
  function restart() {
    playersRef.current.forEach((p, idx) => {
      const c = clips[idx]
      const start = c?.start_sec ?? 0
      try { p?.seekTo(start, true) } catch { /* ignore */ }
    })
    const now = performance.now() / 1000
    const fresh = initialState(slotCount, now)
    if (modeRef.current === 'single-only') {
      fresh.shot = { kind: 'single', primary: 0, reason: 'cold open', startedAt: now }
    }
    stateRef.current = fresh
    setShot(fresh.shot)
  }

  function jumpToAngle(idx: number) {
    setAutoDirector(false)
    const now = performance.now() / 1000
    const newShot: Shot = { kind: 'single', primary: idx, reason: 'manual', startedAt: now }
    if (stateRef.current) {
      stateRef.current = { ...stateRef.current, shot: newShot }
    }
    setShot(newShot)
  }

  const allReady = readyCount === slotCount && slotCount > 0
  const hasCurves = curvesLoaded > 0
  const heatmapHits = curvesRef.current.filter((c) => c?.source === 'heatmap').length

  const shotKindLabel = (k: ShotKind) =>
    k === 'single' ? 'Single' : k === 'sxs' ? 'Side-by-side' : k === 'pip' ? 'PiP overlay' : '2×2 squad'

  return (
    <div className="w-full h-full flex flex-col">
      {/* Surface — every iframe stays mounted; styles animate per current shot */}
      <div className="relative flex-1 bg-gradient-to-br from-dark-elevated to-dark overflow-hidden">
        {clips.map((c, idx) => {
          const placement: SlotPlacement = shot
            ? placementForShot(shot, idx)
            : { kind: 'hidden' }
          const variant = placementToVariant(placement)
          const isHidden = placement.kind === 'hidden'
          const isPrimary = shot?.primary === idx
          const isAudio = shot ? audioIndex(shot) === idx : false
          return (
            <div
              key={c.id ?? idx}
              className="absolute"
              style={{
                transition: 'all 600ms cubic-bezier(0.22, 1, 0.36, 1)',
                ...placementToStyle(placement),
              }}
            >
              <PlayerChrome
                slotIndex={idx}
                variant={variant ?? 'main'}
                isPrimary={isPrimary && !isHidden}
                isAudio={isAudio && !isHidden}
                hideLabel={isHidden}
                label={c.title || undefined}
                className="w-full h-full bg-black"
              >
                <div ref={(el) => { containerRefs.current[idx] = el }} className="w-full h-full" />
              </PlayerChrome>
            </div>
          )
        })}

        {/* HUD */}
        {shot && (
          <>
            <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded bg-black/70 text-white text-xs font-medium pointer-events-none">
              {mode === 'single-only' ? 'ACTION CAM' : 'ULTRA · DIRECTOR'} · {shotKindLabel(shot.kind)}
              {autoDirector && playing && <span className="ml-1 text-accent">·LIVE</span>}
            </div>
            <div className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded bg-black/70 text-accent text-xs font-medium pointer-events-none">
              {shot.reason}
            </div>
          </>
        )}

        {/* Action meter HUD: a tiny stack of bars showing each angle's live score */}
        {showMeter && shot && scores.length > 0 && (
          <div className="absolute bottom-2 left-2 z-10 flex items-end gap-1 p-1 rounded bg-black/55 pointer-events-none">
            {scores.map((s, i) => {
              const isPrimary = i === shot.primary
              const isComposed =
                (shot.kind === 'sxs' && i === shot.secondary) ||
                (shot.kind === 'pip' && i === shot.overlay) ||
                (shot.kind === 'grid' && (shot.cells ?? []).includes(i))
              const onScreen = isPrimary || isComposed
              const c = slotColor(i)
              const heightPct = Math.max(4, Math.round(s * 100))
              return (
                <div key={i} className="flex flex-col items-center" style={{ width: 14 }}>
                  <div className="w-full bg-dark-border/60 rounded overflow-hidden" style={{ height: 32 }}>
                    <div
                      className="w-full"
                      style={{
                        height: `${heightPct}%`,
                        marginTop: `${100 - heightPct}%`,
                        background: onScreen ? c.hex : `rgba(${c.rgb},0.45)`,
                        transition: 'height 220ms ease-out, margin-top 220ms ease-out',
                      }}
                    />
                  </div>
                  <span
                    className="text-[9px] leading-none mt-0.5"
                    style={{ color: isPrimary ? c.hex : 'rgba(156,163,175,1)' }}
                  >
                    P{i + 1}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Controls strip */}
      <div className="px-3 py-2 border-t border-dark-border bg-dark-card flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={playing ? pauseAll : playAll}
          disabled={!allReady}
          className="px-4 py-1.5 rounded bg-accent text-dark text-sm font-semibold disabled:opacity-40"
        >
          {!allReady ? `Loading (${readyCount}/${slotCount})…` : playing ? 'Pause' : (mode === 'single-only' ? 'Play action' : 'Play ultra')}
        </button>
        <button
          type="button"
          onClick={restart}
          disabled={!allReady}
          className="px-3 py-1.5 rounded border border-dark-border text-gray-300 text-sm hover:border-accent/50 hover:text-accent disabled:opacity-40"
        >
          Restart
        </button>
        <button
          type="button"
          onClick={() => setAutoDirector((v) => !v)}
          disabled={!allReady}
          className={`px-3 py-1.5 rounded border text-sm transition-colors disabled:opacity-40 ${
            autoDirector ? 'border-accent text-accent' : 'border-dark-border text-gray-300 hover:border-accent/50'
          }`}
          title="Toggle auto-director (action-driven switching)"
        >
          {autoDirector ? 'Director ON' : 'Director OFF'}
        </button>
        <button
          type="button"
          onClick={() => setShowMeter((v) => !v)}
          className="px-3 py-1.5 rounded border border-dark-border text-gray-300 text-sm hover:border-accent/50 hover:text-accent"
          title="Toggle the live action meter"
        >
          {showMeter ? 'Meter ON' : 'Meter OFF'}
        </button>
        <span className="ml-auto text-xs text-gray-500">
          {slotCount} angles ·
          {' '}{hasCurves ? `${heatmapHits}/${slotCount} heatmap` : 'loading curves…'} ·
          {' '}12s min hold
        </span>
      </div>

      {/* Angle picker — manual lock onto a specific angle (turns auto-director off). */}
      <div className="px-3 py-2 border-t border-dark-border bg-dark-elevated/60">
        <div className="flex gap-1.5 overflow-x-auto">
          {clips.map((c, idx) => {
            const ytId = extractYouTubeId(c.url_or_path)
            const thumb = ytId ? `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg` : null
            const isPrimary = shot?.primary === idx
            const score = scores[idx] ?? 0
            const col = slotColor(idx)
            return (
              <button
                key={c.id ?? idx}
                type="button"
                onClick={() => jumpToAngle(idx)}
                className="relative flex-shrink-0 rounded overflow-hidden transition-transform"
                style={{
                  width: 112,
                  height: 64,
                  boxShadow: isPrimary
                    ? `0 0 0 2px ${col.hex}, 0 0 18px rgba(${col.rgb},0.55)`
                    : `inset 0 0 0 1px rgba(${col.rgb},0.4)`,
                  transform: isPrimary ? 'scale(1.05)' : 'scale(1)',
                }}
                title={`Switch to ${c.title || `angle ${idx + 1}`} (action ${(score * 100).toFixed(0)}%)`}
              >
                {thumb ? (
                  <img src={thumb} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-dark" />
                )}
                {/* Tiny action bar bottom of thumb */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60">
                  <div
                    className="h-full"
                    style={{
                      width: `${Math.round(score * 100)}%`,
                      background: col.hex,
                      transition: 'width 220ms ease-out',
                    }}
                  />
                </div>
                <div className="absolute top-0 left-0 right-0 px-1 py-0.5 bg-black/70 text-white text-[10px] leading-none flex items-center justify-between">
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="inline-block rounded-full"
                      style={{ width: 6, height: 6, background: col.hex }}
                    />
                    P{idx + 1}
                  </span>
                  {isPrimary && <span style={{ color: col.hex }}>●</span>}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Re-export so callers (and tests) can import the player component types
// even though we don't expose them publicly.
export type { ShotKind } from '@/lib/directorEngine'
