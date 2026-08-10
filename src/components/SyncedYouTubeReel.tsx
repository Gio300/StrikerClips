import { useEffect, useRef, useState } from 'react'
import { loadYouTubeApi, extractYouTubeId, CLEAN_PLAYER_VARS, type YTPlayer } from '@/lib/youtubeApi'
import { fetchActionCurve, type ActionCurve } from '@/lib/youtubeActionCurve'
import { CroppedFrame, TkoWatermark } from '@/components/CroppedFrame'
import { LeagueWatermark } from '@/components/LeagueWatermark'
import { StageChat } from '@/components/StageChat'
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
import { useStageBreakpoint } from '@/hooks/useStageBreakpoint'
import {
  allowedLayouts,
  allowsCompositeShots,
  coerceLayout,
  nextAngleIndex,
  swipeDirection,
  type StageBreakpoint,
  type StageLayout,
} from '@/lib/stageLayout'
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

/**
 * CenterPlayOverlay — a TKO-branded center play button that sits ABOVE the
 * cropped video and its click-shield.
 *
 * Why it exists: Android's Capacitor WebView blocks muted-autoplay without a
 * user gesture, so YouTube paints its big red CENTER play button. The crop
 * overscan hides YouTube's edge chrome but NOT that center button, and the
 * CroppedFrame shield (pointerEvents:none over the video) swallows taps on it —
 * so the stage looks dead. This overlay gives the viewer a real, TKO-styled
 * tap target that triggers OUR start handler (a genuine user gesture, which
 * satisfies the WebView autoplay policy).
 *
 * Behaviour:
 *   - Renders ONLY while NOT playing (before first play, or when paused).
 *   - Hides the moment playback starts; reappears on pause.
 *   - Rendered at STAGE level with a z-index above the video panes + their
 *     shields but below the chat panel (z-30), so a center tap always hits
 *     OUR handler instead of YouTube's hidden red button.
 */
function CenterPlayOverlay({
  visible,
  onPlay,
  label = 'Play',
}: {
  visible: boolean
  onPlay: () => void
  label?: string
}) {
  if (!visible) return null
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={label}
      className="absolute inset-0 flex items-center justify-center group"
      style={{ zIndex: 25, pointerEvents: 'auto', background: 'rgba(6,4,16,0.32)' }}
    >
      <span
        className="flex items-center justify-center rounded-full transition-transform group-hover:scale-110 group-active:scale-95"
        style={{
          width: 78,
          height: 78,
          // TKO brand: soft dark circle with an accent-orange (chakra) triangle —
          // deliberately NOT YouTube red.
          background: 'rgba(10,8,20,0.82)',
          boxShadow: '0 0 0 2px rgba(245,158,11,0.9), 0 8px 28px rgba(0,0,0,0.55)',
          backdropFilter: 'blur(3px)',
        }}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden style={{ marginLeft: 5 }}>
          <path d="M8 5v14l11-7z" fill="#f59e0b" />
        </svg>
      </span>
    </button>
  )
}

/**
 * AngleStrip — the horizontally-scrollable row of angle thumbnails that sits
 * under the focused feed.
 *
 * This is the answer to "how do we fit 4–8 screens on a phone": we don't tile
 * them, we put ONE readable feed on the stage and every other angle becomes a
 * cheap 96×54 poster in this strip. Tap one to focus it. The thumbnails are
 * static YouTube poster images, not embeds, so a phone decodes exactly one
 * video no matter how many angles the reel has.
 */
function AngleStrip({
  clips,
  activeIdx,
  onPick,
  scores = [],
  compact = false,
}: {
  clips: Clip[]
  activeIdx: number
  onPick: (idx: number) => void
  scores?: number[]
  compact?: boolean
}) {
  const w = compact ? 96 : 112
  const h = compact ? 54 : 64
  return (
    <div
      className="flex gap-1.5 overflow-x-auto snap-x snap-mandatory"
      // Momentum scrolling on iOS + no scrollbar gutter eating stage height.
      style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'thin' }}
      role="tablist"
      aria-label="Camera angles"
    >
      {clips.map((c, idx) => {
        const ytId = extractYouTubeId(c.url_or_path)
        const thumb = ytId ? `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg` : null
        const isActive = idx === activeIdx
        const score = scores[idx] ?? 0
        const col = slotColor(idx)
        return (
          <button
            key={c.id ?? idx}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onPick(idx)}
            className="relative flex-shrink-0 rounded overflow-hidden transition-transform snap-start"
            style={{
              width: w,
              height: h,
              boxShadow: isActive
                ? `0 0 0 2px ${col.hex}, 0 0 18px rgba(${col.rgb},0.55)`
                : `inset 0 0 0 1px rgba(${col.rgb},0.4)`,
              transform: isActive ? 'scale(1.05)' : 'scale(1)',
            }}
            title={`Switch to ${c.title || `angle ${idx + 1}`}`}
          >
            {thumb ? (
              <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-dark" />
            )}
            {scores.length > 0 && (
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
            )}
            <div className="absolute top-0 left-0 right-0 px-1 py-0.5 bg-black/70 text-white text-[10px] leading-none flex items-center justify-between">
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block rounded-full"
                  style={{ width: 6, height: 6, background: col.hex }}
                />
                P{idx + 1}
              </span>
              {isActive && <span style={{ color: col.hex }}>●</span>}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/**
 * useAngleSwipe — swipe left/right on the stage to change the focused angle.
 *
 * Phone viewers expect to flick between angles the way they flick between
 * stories; making them hunt for a thumbnail every time is a tax. Vertical-
 * dominant drags are deliberately left alone so the page still scrolls.
 */
function useAngleSwipe(enabled: boolean, count: number, current: number, onPick: (idx: number) => void) {
  const startRef = useRef<{ x: number; y: number } | null>(null)

  if (!enabled) {
    return {
      onTouchStart: undefined as ((e: React.TouchEvent) => void) | undefined,
      onTouchEnd: undefined as ((e: React.TouchEvent) => void) | undefined,
    }
  }

  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]
      startRef.current = t ? { x: t.clientX, y: t.clientY } : null
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const start = startRef.current
      startRef.current = null
      const t = e.changedTouches[0]
      if (!start || !t) return
      const dir = swipeDirection(t.clientX - start.x, t.clientY - start.y)
      if (dir !== 0) onPick(nextAngleIndex(current, count, dir))
    },
  }
}

/** Single-iframe sequential playback. Auto-advances on YT.PlayerState.ENDED. */
function ConcatPlayer({ clips }: { clips: Clip[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)

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
          ...CLEAN_PLAYER_VARS,
          start: first.start_sec ?? 0,
          end: first.end_sec ?? undefined,
          // Start instantly. Browsers only allow autoplay when muted, so we
          // start muted; the user taps the video to unmute. No manual "play".
          autoplay: 1,
          mute: 1,
        },
        events: {
          onReady: (e) => { setReady(true); try { e.target.mute(); e.target.playVideo() } catch { /* noop */ } },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) setPlaying(true)
            else if (e.data === YT.PlayerState.PAUSED) setPlaying(false)
            if (e.data === YT.PlayerState.ENDED) {
              setPlaying(false)
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

  // The center-overlay tap is a real user gesture, so we can both unmute and
  // start (single audio source, so unmuting here is safe).
  function startPlayback() {
    const p = playerRef.current
    if (!p) return
    try { p.unMute(); p.playVideo() } catch { /* ignore */ }
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div className="relative w-full flex-1 bg-black">
        {/* Crop with the shield OFF: this single player relies on tap-to-unmute. */}
        <CroppedFrame shield={false}>
          <div ref={containerRef} className="w-full h-full" />
        </CroppedFrame>
        <TkoWatermark />
        <LeagueWatermark />
        <CenterPlayOverlay visible={!playing} onPlay={startPlayback} />
      </div>
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

  // A 2×2 grid is unreadable on a phone (four ~190 px tiles) and asks the
  // weakest hardware we ship to for four simultaneous decodes. So on phones the
  // quad layout degrades to ONE focused feed plus the angle strip. Two-up
  // (side-by-side) is legible enough to survive, so it is left alone.
  const bp = useStageBreakpoint()
  const focusedFallback = bp === 'phone' && layout === 'grid'
  const [focused, setFocused] = useState(0)
  const focusedIdx = Math.min(focused, Math.max(0, slotCount - 1))

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
            ...CLEAN_PLAYER_VARS,
            start: clip.start_sec ?? 0,
            end: clip.end_sec ?? undefined,
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

  /** Focus an angle and move the audio with it — one tap, not two. */
  function focusAngle(idx: number) {
    setFocused(idx)
    pickAudio(idx)
  }

  const swipe = useAngleSwipe(focusedFallback, slotCount, focusedIdx, focusAngle)

  const allReady = readyCount === slotCount && slotCount > 0
  const gridClass = layout === 'grid' ? 'grid grid-cols-2 grid-rows-2' : 'grid grid-cols-2 grid-rows-1'
  const cellVariant: SlotVariant = layout === 'grid' ? 'cell' : 'sxs'

  return (
    <div className="w-full h-full flex flex-col">
      <div
        className={`relative flex-1 ${focusedFallback ? '' : `${gridClass} gap-2 p-2`} bg-gradient-to-br from-dark-elevated to-dark ${focusedFallback ? 'overflow-hidden' : ''}`}
        onTouchStart={swipe.onTouchStart}
        onTouchEnd={swipe.onTouchEnd}
      >
        <TkoWatermark />
        <LeagueWatermark />
        {clips.map((c, idx) => {
          // In the phone fallback every player stays mounted (destroying and
          // rebuilding YT iframes on every tap would be slow and lose position);
          // the non-focused ones are simply parked invisible behind the stage.
          const hidden = focusedFallback && idx !== focusedIdx
          return (
            <PlayerChrome
              key={c.id ?? idx}
              slotIndex={idx}
              variant={focusedFallback ? 'main' : cellVariant}
              isPrimary={focusedFallback && !hidden}
              isAudio={muted === idx}
              hideLabel={hidden}
              label={c.title || undefined}
              className="bg-black"
              style={
                focusedFallback
                  ? {
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      opacity: hidden ? 0 : 1,
                      zIndex: hidden ? 0 : 1,
                      pointerEvents: hidden ? 'none' : undefined,
                    }
                  : { width: '100%', height: '100%' }
              }
            >
              <CroppedFrame>
                <div ref={(el) => { containerRefs.current[idx] = el }} className="w-full h-full" />
              </CroppedFrame>
              {muted !== idx && !hidden && !focusedFallback && (
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
          )
        })}
        {/* TKO center-play fallback for WebViews that block muted-autoplay. */}
        <CenterPlayOverlay visible={!playing} onPlay={playAll} label="Play all angles" />
      </div>

      {/* Phone: the other angles live here as posters, not as live tiles. */}
      {focusedFallback && slotCount > 1 && (
        <div className="px-2 py-2 border-t border-dark-border bg-dark-elevated/60">
          <AngleStrip clips={clips} activeIdx={focusedIdx} onPick={focusAngle} compact />
        </div>
      )}

      <div className="px-3 py-2 border-t border-dark-border bg-dark-card flex items-center gap-2 flex-wrap">
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
          {focusedFallback
            ? `Angle ${focusedIdx + 1} of ${slotCount} · swipe to switch`
            : layout === 'grid'
              ? '2×2 squad view · synced playback'
              : 'Side-by-side · synced playback'}
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
          ...CLEAN_PLAYER_VARS,
          start: main.start_sec ?? 0,
          end: main.end_sec ?? undefined,
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
          ...CLEAN_PLAYER_VARS,
          start: pip.start_sec ?? 0,
          end: pip.end_sec ?? undefined,
          mute: 1,
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
        {/* Bottom-left so the TKO mark never sits under the bottom-right PiP inset. */}
        <TkoWatermark corner="bl" />
        <PlayerChrome
          slotIndex={0}
          variant="main"
          isAudio
          isPrimary
          label={clips[0]?.title || undefined}
          className="w-full h-full"
        >
          <CroppedFrame>
            <div ref={mainContainerRef} className="w-full h-full" />
          </CroppedFrame>
        </PlayerChrome>
        <PlayerChrome
          slotIndex={1}
          variant="pip-overlay"
          label={clips[1]?.title || undefined}
          className="absolute bottom-3 right-3 w-1/4 aspect-video bg-black"
        >
          <CroppedFrame>
            <div ref={pipContainerRef} className="w-full h-full" />
          </CroppedFrame>
        </PlayerChrome>
        {/* TKO center-play fallback for WebViews that block muted-autoplay. */}
        <CenterPlayOverlay visible={!playing} onPlay={playAll} label="Play both angles" />
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

// Manual layout the viewer can force from the on-stage buttons. 'auto' hands
// control back to the director engine (the "Ultra (auto)" mode). Shared with
// the pure breakpoint rules in @/lib/stageLayout so the controls, the director
// and the tests all agree on what's legible at a given width.
type LayoutMode = StageLayout

// Build a fixed Shot from a manual layout + the viewer's chosen angle order.
// `order[0]` is the primary; subsequent entries fill the split/quad slots.
function buildManualShot(mode: 'single' | 'sxs' | 'quad', order: number[], now: number): Shot {
  const o = order.length ? order : [0]
  if (mode === 'sxs') {
    return { kind: 'sxs', primary: o[0], secondary: o[1] ?? o[0], reason: 'manual · split', startedAt: now }
  }
  if (mode === 'quad') {
    return { kind: 'grid', primary: o[0], cells: o.slice(0, 4), reason: 'manual · quad', startedAt: now }
  }
  return { kind: 'single', primary: o[0], reason: 'manual', startedAt: now }
}

// KO / finisher / high-energy hint from a clip's title. The director biases
// toward these angles so the auto-cut snaps to the knockout moment.
const KO_TITLE_RE = /\bk\.?\s?o\.?\b|knock\s?out|finish(?:er)?|clutch|ougi|ult(?:imate)?|comeback|game\s?winner|buzzer/i

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

  // Manual layout control (Single / Split / Quad) + the angle order the viewer
  // can rearrange with "Swap". 'auto' means the director engine is driving.
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(mode === 'single-only' ? 'single' : 'auto')
  const [order, setOrder] = useState<number[]>(() => Array.from({ length: slotCount }, (_, i) => i))
  const orderRef = useRef<number[]>(Array.from({ length: slotCount }, (_, i) => i))
  const [showChat, setShowChat] = useState(false)

  // ── Small-screen behaviour ────────────────────────────────────────────────
  // On a phone the stage is ALWAYS one focused feed. The director keeps running
  // and keeps picking the hottest angle — it just presents that pick as a single
  // full-width feed instead of a split or a quad, because 4 tiles on a 390 px
  // screen are unreadable. This is the real answer to small screens: the AI
  // picks the angle, the viewer watches one good feed.
  const bp: StageBreakpoint = useStageBreakpoint()
  const isPhone = bp === 'phone'
  // The engine may only composite when the player supports it AND the viewport
  // can actually show it.
  const compositesAllowed = mode === 'full' && allowsCompositeShots(bp)
  const compositesRef = useRef(compositesAllowed)
  compositesRef.current = compositesAllowed
  // Secondary controls tuck away so the stage + chat dominate. Collapsed by
  // default: Restart/Swap/Meter live under "More"; the angle thumbnail strip
  // lives under "Angles". Hiding the strip hands its height back to the stage.
  const [showMore, setShowMore] = useState(false)
  const [showAngles, setShowAngles] = useState(false)

  // KO / finisher hint per clip, recomputed cheaply each render. Read at call
  // time by the boost fn so the director can bias toward the knockout angle.
  const koRef = useRef<boolean[]>([])
  koRef.current = clips.map((c) => KO_TITLE_RE.test(c.title ?? ''))

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
  // Base clutch boost (game-profile rules) PLUS an auto-ultra bias toward
  // KO/finisher-tagged angles and peak-action moments, so the director cuts
  // TO the knockout instead of treating every angle equally.
  const boostFn = (rawScores: number[]) => {
    const boosted = applyClutchBoost(rawScores, runtimeRef.current, profileRef.current)
    return boosted.map((s, i) => {
      let extra = 0
      if (koRef.current[i]) extra += 0.15 // KO/finisher-tagged angle
      const raw = rawScores[i] ?? 0
      if (raw >= 0.8) extra += 0.12 // snap to peak "most replayed" spikes
      else if (raw >= 0.65) extra += 0.05
      return Math.min(1, s + extra)
    })
  }

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
            ...CLEAN_PLAYER_VARS,
            start: clip.start_sec ?? 0,
            end: clip.end_sec ?? undefined,
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
    // Single-only mode — and every phone — opens on a single, not a grid.
    if (!compositesRef.current) {
      initial.shot = { kind: 'single', primary: 0, reason: 'cold open', startedAt: now }
    }
    stateRef.current = initial
    setShot(initial.shot)
    const fresh = Array.from({ length: slotCount }, (_, i) => i)
    orderRef.current = fresh
    setOrder(fresh)
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

  // Crossing the phone boundary (rotation, an unfolding Fold, a resized
  // window, or just opening a desktop share link on a phone) must never leave
  // the stage in an illegible state. Two corrections:
  //   1. an illegal selection (Quad on a phone) snaps back to the auto-director
  //   2. a composite shot already on screen collapses to its primary angle
  useEffect(() => {
    const legal = coerceLayout(layoutMode, bp, slotCount, mode === 'full')
    if (legal !== layoutMode) {
      setLayoutMode(legal)
      if (legal === 'auto') setAutoDirector(true)
    }
    if (!compositesAllowed && shot && shot.kind !== 'single') {
      const collapsed: Shot = {
        kind: 'single',
        primary: shot.primary,
        reason: shot.reason,
        startedAt: shot.startedAt,
      }
      if (stateRef.current) stateRef.current = { ...stateRef.current, shot: collapsed }
      setShot(collapsed)
    }
  }, [bp, compositesAllowed, layoutMode, slotCount, mode, shot])

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

      // The engine always picks composites; we squash them down to a single
      // shot whenever compositing isn't allowed — single-only mode, or ANY
      // phone-width viewport. The director's *choice of angle* is preserved,
      // which is the part that matters on a small screen.
      const result = step({
        state,
        now: performance.now() / 1000,
        playTimes,
        curves: curvesRef.current,
        boost: boostFn,
      })
      if (!compositesRef.current && result.switched) {
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
    if (!compositesRef.current) {
      fresh.shot = { kind: 'single', primary: 0, reason: 'cold open', startedAt: now }
    }
    // If the viewer has forced a manual layout, restart keeps that layout.
    if (layoutMode !== 'auto') {
      fresh.shot = buildManualShot(manualShotMode(layoutMode), orderRef.current, now)
    }
    stateRef.current = fresh
    setShot(fresh.shot)
  }

  /**
   * Resolve a requested layout to a composition we're actually willing to
   * render here. The action cam never composites; neither does a phone. Both
   * collapse to 'single', which keeps the viewer's chosen angle at full width.
   */
  function manualShotMode(requested: LayoutMode): 'single' | 'sxs' | 'quad' {
    if (!compositesAllowed) return 'single'
    const legal = coerceLayout(requested, bp, slotCount, mode === 'full')
    return legal === 'auto' || legal === 'single' ? 'single' : legal
  }

  // Force a manual layout (or hand control back to the engine with 'auto').
  // Manual overrides the director until the viewer re-enables 'auto'.
  function applyLayout(next: LayoutMode) {
    // Never let a control put the stage into an illegible state.
    const legal = coerceLayout(next, bp, slotCount, mode === 'full')
    setLayoutMode(legal)
    const now = performance.now() / 1000
    if (legal === 'auto') {
      setAutoDirector(true)
      if (stateRef.current) {
        stateRef.current = { ...stateRef.current, shot: { ...stateRef.current.shot, startedAt: now } }
      }
      return
    }
    setAutoDirector(false)
    const s = buildManualShot(manualShotMode(legal), orderRef.current, now)
    if (stateRef.current) stateRef.current = { ...stateRef.current, shot: s }
    setShot(s)
  }

  // Rotate the angle order so a different angle lands in each slot. In auto
  // mode we just remember the new order for when the viewer goes manual.
  function swapAngles() {
    const cur = orderRef.current
    const next = cur.length > 1 ? [...cur.slice(1), cur[0]] : cur
    orderRef.current = next
    setOrder(next)
    if (layoutMode !== 'auto') {
      const now = performance.now() / 1000
      const s = buildManualShot(manualShotMode(layoutMode), next, now)
      if (stateRef.current) stateRef.current = { ...stateRef.current, shot: s }
      setShot(s)
    }
  }

  function jumpToAngle(idx: number) {
    setAutoDirector(false)
    setLayoutMode('single')
    const next = [idx, ...orderRef.current.filter((i) => i !== idx)]
    orderRef.current = next
    setOrder(next)
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

  // Swipe left/right across the stage to change angles (phones only — on a
  // desktop the strip and the layout buttons are already right there).
  const stageSwipe = useAngleSwipe(isPhone && slotCount > 1, slotCount, shot?.primary ?? 0, jumpToAngle)

  // On a phone the angle strip IS the navigation, so it's always on screen
  // rather than hidden behind a disclosure. On bigger screens it stays
  // collapsible, because the stage can show several angles at once anyway.
  const anglesVisible = isPhone ? slotCount > 1 : showAngles

  // Layout buttons are built from the breakpoint rules, so the controls only
  // ever offer what's legible at the current width: no "Quad" button on a
  // 390 px screen, and no "Split" when there's only one angle to split.
  const LAYOUT_LABELS: Record<LayoutMode, string> = {
    auto: mode === 'single-only' ? 'Auto action' : 'Ultra (auto)',
    single: 'Single',
    sxs: 'Split',
    quad: 'Quad',
  }
  const layoutOptions: { m: LayoutMode; label: string }[] = allowedLayouts(
    bp,
    slotCount,
    mode === 'full',
  ).map((m) => ({ m, label: LAYOUT_LABELS[m] }))

  const shotKindLabel = (k: ShotKind) =>
    k === 'single' ? 'Single' : k === 'sxs' ? 'Side-by-side' : k === 'pip' ? 'PiP overlay' : '2×2 squad'

  return (
    <div className="w-full h-full flex flex-col">
      {/* Stage + chat: a RESPONSIVE layout, never an overlay on the video.
          • sm and up (incl. the unfolded Fold): chat is a fixed-width column to
            the RIGHT of the video (flex-row → video 1fr + chat 320px), both the
            same height, zero overlap.
          • narrow phones: chat drops to a toggleable panel BELOW the video
            (flex-col), so gameplay is never covered. */}
      <div className="flex-1 min-h-0 flex flex-col sm:flex-row gap-2">
        {/* Video stage — every iframe stays mounted; styles animate per shot.
            On phones a horizontal swipe here changes the focused angle. */}
        <div
          className="relative flex-1 min-h-0 min-w-0 bg-gradient-to-br from-dark-elevated to-dark overflow-hidden"
          onTouchStart={stageSwipe.onTouchStart}
          onTouchEnd={stageSwipe.onTouchEnd}
        >
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
                <CroppedFrame>
                  <div ref={(el) => { containerRefs.current[idx] = el }} className="w-full h-full" />
                </CroppedFrame>
              </PlayerChrome>
            </div>
          )
        })}

        {/* TKO watermark stands in for the YouTube logo (stage-level, not per-pane) */}
        <TkoWatermark />
        <LeagueWatermark />

        {/* HUD */}
        {shot && (
          <>
            <div className="absolute top-2 left-2 z-10 max-w-[46%] truncate px-2 py-0.5 rounded bg-black/70 text-white text-xs font-medium pointer-events-none">
              {mode === 'single-only' ? 'ACTION CAM' : 'ULTRA · DIRECTOR'} · {shotKindLabel(shot.kind)}
              {autoDirector
                ? (playing && <span className="ml-1 text-accent">·LIVE</span>)
                : <span className="ml-1 text-yellow-400">·MANUAL</span>}
            </div>
            <div className="absolute top-2 right-2 z-10 max-w-[46%] truncate px-2 py-0.5 rounded bg-black/70 text-accent text-xs font-medium pointer-events-none">
              {shot.reason}
            </div>
          </>
        )}

        {/* Action meter HUD: a tiny stack of bars showing each angle's live score */}
        {showMeter && shot && scores.length > 0 && (
          <div className="absolute bottom-2 left-2 z-20 flex items-end gap-1 p-1 rounded bg-black/80 pointer-events-none">
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

        {/* TKO center-play fallback: satisfies the WebView autoplay gesture.
            Sits above the panes/shields (z-25) and only while paused/unstarted
            so it never covers the live director. */}
        <CenterPlayOverlay
          visible={!playing}
          onPlay={playAll}
          label={mode === 'single-only' ? 'Play action' : 'Play ultra'}
        />
        </div>

        {/* Chat — a real layout sibling of the video, NOT an overlay. On sm+ it
            is a fixed 320px column at the video's right and stretches to the same
            height; on phones it becomes a panel below the video (h-56). */}
        {showChat && (
          <div className="shrink-0 min-h-0 h-56 sm:h-auto sm:w-[320px]">
            <StageChat
              title={mode === 'single-only' ? 'Action cam' : 'Ultra reel'}
              heightClass="h-full"
            />
          </div>
        )}
      </div>

      {/* Controls strip — ESSENTIALS only: Play/Pause, the layout toggle, Chat.
          Everything secondary tucks under the "More"/"Angles" disclosures so the
          stage + chat dominate. */}
      <div className="px-3 py-2 border-t border-dark-border bg-dark-card flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={playing ? pauseAll : playAll}
          disabled={!allReady}
          className="px-4 py-1.5 rounded bg-accent text-dark text-sm font-semibold disabled:opacity-40"
        >
          {!allReady ? `Loading (${readyCount}/${slotCount})…` : playing ? 'Pause' : (mode === 'single-only' ? 'Play action' : 'Play ultra')}
        </button>
        {/* Layout controls — Ultra (auto) hands control to the director; the
            rest force a fixed layout. Manual overrides auto until re-enabled. */}
        <div className="inline-flex rounded border border-dark-border overflow-hidden">
          {layoutOptions.map(({ m, label }) => {
            const active = layoutMode === m
            const disabled = !allReady || (m === 'sxs' && slotCount < 2) || (m === 'quad' && slotCount < 3)
            return (
              <button
                key={m}
                type="button"
                onClick={() => applyLayout(m)}
                disabled={disabled}
                className={`px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${
                  active ? 'bg-accent text-dark font-semibold' : 'text-gray-300 hover:text-accent'
                }`}
                title={m === 'auto' ? 'Auto-director: switches to the highest-action angle (KO-biased)' : `Force ${label} layout`}
              >
                {label}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => setShowChat((v) => !v)}
          className={`px-3 py-1.5 rounded border text-sm transition-colors ${
            showChat ? 'border-accent text-accent' : 'border-dark-border text-gray-300 hover:border-accent/50 hover:text-accent'
          }`}
          title="Toggle the chat panel"
        >
          {showChat ? 'Chat ON' : 'Chat'}
        </button>
        <DisclosureToggle label="More" open={showMore} onClick={() => setShowMore((v) => !v)} title="Restart, Swap, Meter" />
        {/* On a phone the strip is permanently visible, so the toggle would be
            a control that does nothing — don't render it. */}
        {!isPhone && (
          <DisclosureToggle
            label="Angles"
            open={showAngles}
            onClick={() => setShowAngles((v) => !v)}
            disabled={slotCount < 1}
            title="Jump to a specific angle"
          />
        )}
        <span className="ml-auto text-xs text-gray-500">
          {isPhone && shot ? (
            <>Angle {shot.primary + 1} of {slotCount} · swipe to switch</>
          ) : (
            <>
              {slotCount} angles ·
              {' '}{hasCurves ? `${heatmapHits}/${slotCount} heatmap` : 'loading curves…'} ·
              {' '}12s min hold
            </>
          )}
        </span>
      </div>

      {/* More — secondary controls, collapsed by default. */}
      {showMore && (
        <div className="px-3 py-2 border-t border-dark-border bg-dark-card flex items-center gap-2 flex-wrap">
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
            onClick={swapAngles}
            disabled={!allReady || slotCount < 2}
            className="px-3 py-1.5 rounded border border-dark-border text-gray-300 text-sm hover:border-accent/50 hover:text-accent disabled:opacity-40"
            title={`Rearrange angles (order: ${order.map((i) => `P${i + 1}`).join(' ')})`}
          >
            ⇄ Swap
          </button>
          <button
            type="button"
            onClick={() => setShowMeter((v) => !v)}
            className="px-3 py-1.5 rounded border border-dark-border text-gray-300 text-sm hover:border-accent/50 hover:text-accent"
            title="Toggle the live action meter"
          >
            {showMeter ? 'Meter ON' : 'Meter OFF'}
          </button>
        </div>
      )}

      {/* Angles — manual lock onto a specific angle (turns auto-director off).
          Collapsed by default; hiding it hands the height back to the stage. */}
      {anglesVisible && (
        <div className="px-3 py-2 border-t border-dark-border bg-dark-elevated/60">
          {/* On a phone this strip is how you change angle: tap a thumbnail (or
              swipe the stage). Tapping locks the director off so your pick
              sticks — "Ultra (auto)" hands control back. */}
          <AngleStrip
            clips={clips}
            activeIdx={shot?.primary ?? 0}
            onPick={jumpToAngle}
            scores={scores}
            compact={isPhone}
          />
          {isPhone && !autoDirector && (
            <button
              type="button"
              onClick={() => applyLayout('auto')}
              className="mt-2 text-[11px] text-gray-400 hover:text-accent"
            >
              ↺ Let the director pick the angle
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * DisclosureToggle — a compact control-strip button that opens/closes an
 * inline panel. Matches the CollapsibleSection look (one-word label + a
 * rotating chakra chevron) but stays inside the fixed-height player stage
 * instead of pushing a grid-animated panel that would overflow it.
 */
function DisclosureToggle({
  label,
  open,
  onClick,
  disabled = false,
  title,
}: {
  label: string
  open: boolean
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={open}
      title={title}
      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded border text-sm transition-colors disabled:opacity-40 ${
        open ? 'border-accent text-accent' : 'border-dark-border text-gray-300 hover:border-accent/50 hover:text-accent'
      }`}
    >
      {label}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className={`transition-transform duration-300 ${open ? 'rotate-0' : '-rotate-90'}`}
        style={{ color: '#f59e0b' }}
      >
        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

// Re-export so callers (and tests) can import the player component types
// even though we don't expose them publicly.
export type { ShotKind } from '@/lib/directorEngine'
