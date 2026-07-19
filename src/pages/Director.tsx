import { useEffect, useRef, useState, useCallback } from 'react'
import { loadYouTubeApi, extractYouTubeId, type YTPlayer } from '@/lib/youtubeApi'
import { useClipTray } from '@/hooks/useClipTray'
import { thumbUrl } from '@/lib/youtubeConnect'
import {
  initProgram,
  applyAction,
  programPosition,
  viewerTarget,
  nextMomentAfter,
  DEFAULT_VIEWER_DELAY_SEC,
  type ProgramState,
  type DirectorAction,
} from '@/lib/watchParty'

/**
 * Director Mode — host a watch party with DVR control.
 *
 * The host loads footage (from the clip tray or a link), then runs the room:
 * pause everyone, run it back, replay in slow-mo, jump to the next K.O. Viewers
 * (when a room backend is connected) follow the same YouTube video a few seconds
 * behind. This page's host controls work fully standalone — that's the part you
 * can test right now; the invite/voice layer lights up with the realtime backend.
 */

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function Director() {
  const { items: tray } = useClipTray()
  const playerRef = useRef<YTPlayer | null>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const [program, setProgram] = useState<ProgramState | null>(null)
  const [manual, setManual] = useState('')
  const [moments, setMoments] = useState<number[]>([])
  const [pos, setPos] = useState(0)
  const [duration, setDuration] = useState(0)
  const [micOn, setMicOn] = useState(false)
  const micStreamRef = useRef<MediaStream | null>(null)

  // Drive a light UI tick so the scrubber + "viewers see" readout move.
  useEffect(() => {
    const id = setInterval(() => {
      const p = playerRef.current
      if (p && program) {
        try {
          setPos(p.getCurrentTime())
          const d = p.getDuration()
          if (d && d !== duration) setDuration(d)
        } catch { /* player not ready */ }
      }
    }, 500)
    return () => clearInterval(id)
  }, [program, duration])

  const loadVideo = useCallback(async (videoId: string) => {
    const next = applyAction(program ?? initProgram(videoId), { type: 'load', videoId }, Date.now())
    setProgram(next)
    setMoments([])
    const YT = await loadYouTubeApi()
    if (!mountRef.current) return
    if (playerRef.current) {
      playerRef.current.loadVideoById({ videoId })
      return
    }
    playerRef.current = new YT.Player(mountRef.current, {
      videoId,
      playerVars: { controls: 0, modestbranding: 1, rel: 0, playsinline: 1 },
      events: {
        onReady: (e) => { try { setDuration(e.target.getDuration()) } catch { /* noop */ } },
      },
    })
  }, [program])

  // Apply a director action to BOTH the engine state and the actual player.
  const dispatch = useCallback((a: DirectorAction) => {
    if (!program && a.type !== 'load') return
    const now = Date.now()
    const next = applyAction(program!, a, now)
    setProgram(next)
    const p = playerRef.current
    if (!p) return
    try {
      const target = programPosition(next, now)
      switch (a.type) {
        case 'play': p.playVideo(); break
        case 'pause': p.pauseVideo(); break
        case 'seek':
        case 'jumpTo':
        case 'runBack':
          p.seekTo(target, true)
          break
        case 'slowmo':
          p.seekTo(target, true)
          p.setPlaybackRate?.(next.rate)
          p.playVideo()
          break
        case 'normalSpeed':
          p.setPlaybackRate?.(1)
          break
      }
    } catch { /* player not ready */ }
  }, [program])

  const markKO = useCallback(() => {
    const t = playerRef.current?.getCurrentTime?.() ?? pos
    setMoments((m) => [...m, t].sort((a, b) => a - b))
  }, [pos])

  const jumpNextKO = useCallback(() => {
    if (!program) return
    const n = nextMomentAfter(moments, program, Date.now())
    if (n != null) dispatch({ type: 'jumpTo', toSec: n })
  }, [program, moments, dispatch])

  async function toggleMic() {
    if (micOn) {
      micStreamRef.current?.getTracks().forEach((t) => t.stop())
      micStreamRef.current = null
      setMicOn(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = stream
      setMicOn(true)
    } catch {
      setMicOn(false)
    }
  }

  useEffect(() => () => { micStreamRef.current?.getTracks().forEach((t) => t.stop()) }, [])

  const playing = !!program?.playing
  const viewer = program ? viewerTarget(program, Date.now(), DEFAULT_VIEWER_DELAY_SEC) : null

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">Director Mode</h1>
      <p className="text-sm text-gray-500 mt-1">
        Host a watch party — pause, run it back, replay in slow-mo. Your audience follows a few seconds behind.
      </p>

      {!program && (
        <div className="mt-5 rounded-xl border border-dark-border bg-dark-card p-4 space-y-3">
          <div className="text-sm font-medium text-white">Pick footage to run</div>
          {tray.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {tray.map((it) => {
                const yid = extractYouTubeId(it.url)
                if (!yid) return null
                return (
                  <button key={it.id} type="button" onClick={() => loadVideo(yid)}
                    className="shrink-0 w-32 rounded-lg overflow-hidden border border-dark-border hover:border-accent/60">
                    <img src={thumbUrl(yid)} alt="" className="w-full aspect-video object-cover" />
                  </button>
                )
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input value={manual} onChange={(e) => setManual(e.target.value)}
              placeholder="…or paste a YouTube link"
              className="flex-1 min-w-[200px] px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent" />
            <button type="button"
              onClick={() => { const id = extractYouTubeId(manual); if (id) loadVideo(id) }}
              className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">Load</button>
          </div>
          <p className="text-xs text-gray-500">Next: load a clip, then use the DVR controls to run the room.</p>
        </div>
      )}

      {program && (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl overflow-hidden border border-dark-border bg-black aspect-video">
            <div ref={mountRef} className="w-full h-full" />
          </div>

          {/* Scrubber */}
          <div>
            <input
              type="range" min={0} max={Math.max(duration, 1)} step={0.5} value={Math.min(pos, duration || pos)}
              onChange={(e) => dispatch({ type: 'seek', toSec: Number(e.target.value) })}
              className="w-full accent-accent"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>{fmt(pos)}</span>
              <span>viewers see ~{fmt(viewer?.positionSec ?? 0)} ({DEFAULT_VIEWER_DELAY_SEC}s behind)</span>
              <span>{fmt(duration)}</span>
            </div>
          </div>

          {/* DVR controls */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <button type="button" onClick={() => dispatch({ type: playing ? 'pause' : 'play' })}
              className="py-3 rounded-lg bg-accent text-dark font-semibold">
              {playing ? '⏸ Pause everyone' : '▶ Play'}
            </button>
            <button type="button" onClick={() => dispatch({ type: 'runBack', seconds: 10 })}
              className="py-3 rounded-lg border border-dark-border text-white hover:border-accent/50">
              ⏪ Run it back 10s
            </button>
            <button type="button" onClick={() => dispatch({ type: 'slowmo', fromSec: Math.max(0, pos - 6) })}
              className="py-3 rounded-lg border border-dark-border text-white hover:border-accent/50">
              🐢 Replay in slow-mo
            </button>
            <button type="button" onClick={() => dispatch({ type: 'normalSpeed' })}
              className="py-3 rounded-lg border border-dark-border text-white hover:border-accent/50">
              1× Normal speed
            </button>
            <button type="button" onClick={markKO}
              className="py-3 rounded-lg border border-dark-border text-white hover:border-accent/50">
              🎯 Mark K.O. ({moments.length})
            </button>
            <button type="button" onClick={jumpNextKO} disabled={moments.length === 0}
              className="py-3 rounded-lg border border-dark-border text-white hover:border-accent/50 disabled:opacity-40">
              ⤵ Jump to next K.O.
            </button>
          </div>

          {/* Commentary + room */}
          <div className="rounded-xl border border-dark-border bg-dark-card p-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-medium text-white">Commentary mic</div>
              <div className="text-xs text-gray-500">
                {micOn ? 'Mic live on this device.' : 'Push to talk over the footage.'} Inviting viewers + broadcasting
                voice turns on with a room.
              </div>
            </div>
            <button type="button" onClick={toggleMic}
              className={`px-4 py-2 rounded-lg font-semibold ${micOn ? 'bg-red-500 text-white' : 'bg-accent text-dark'}`}>
              {micOn ? '● Stop mic' : '🎙 Start mic'}
            </button>
          </div>

          <p className="text-xs text-gray-500">
            Next: run the match at your pace. When you connect a room, your audience joins and follows this exact
            timeline a few seconds behind.
          </p>
        </div>
      )}
    </div>
  )
}
