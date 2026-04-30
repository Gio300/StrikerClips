import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { loadYouTubeApi, type YTPlayer } from '@/lib/youtubeApi'
import type { FrameLabel, FrameLabelEvent } from '@/types/database'

/**
 * AI Label tool — `/ai/label`.
 *
 * Plays a YouTube video (Shinobi Striker by default) and lets a labeler
 * tag in-game events at the current timestamp:
 *
 *   1 — Ultimate used     2 — Jutsu impact
 *   3 — Flag taken        4 — Player killed
 *   5 — Teabag            6 — Scroll grabbed
 *
 * Each click writes a `frame_labels` row keyed on `(source_url, event_kind, t_seconds)`.
 * This is the manual-data step of the CV roadmap: we collect ~500 examples
 * per event before training a YOLO classifier (see docs/cv-roadmap.md).
 */

const EVENTS: { key: FrameLabelEvent; hotkey: string; label: string; color: string }[] = [
  { key: 'ultimate_used',  hotkey: '1', label: 'Ultimate used', color: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40' },
  { key: 'jutsu_impact',   hotkey: '2', label: 'Jutsu impact',  color: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  { key: 'flag_taken',     hotkey: '3', label: 'Flag taken',    color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  { key: 'player_killed',  hotkey: '4', label: 'Player killed', color: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
  { key: 'teabag',         hotkey: '5', label: 'Teabag',        color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40' },
  { key: 'scroll_grabbed', hotkey: '6', label: 'Scroll grabbed', color: 'bg-yellow-500/15 text-yellow-200 border-yellow-500/40' },
]

const FRAME_STEPS_SEC = [0.5, 1, 5, 10] as const

export function AILabel() {
  const { user } = useAuth()
  const [sourceUrl, setSourceUrl] = useState('https://www.youtube.com/watch?v=1YFPxpWKTiI')
  const [committedUrl, setCommittedUrl] = useState<string | null>(null)
  const [labels, setLabels] = useState<FrameLabel[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<FrameLabelEvent | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const playerRef = useRef<YTPlayer | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const tickRef = useRef<number | null>(null)

  const videoId = useMemo(() => extractId(committedUrl ?? sourceUrl), [sourceUrl, committedUrl])

  // Load existing labels for this source URL.
  useEffect(() => {
    if (!user || !committedUrl) return
    let cancelled = false
    supabase
      .from('frame_labels')
      .select('*')
      .eq('user_id', user.id)
      .eq('source_url', committedUrl)
      .order('t_seconds', { ascending: true })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) setError(err.message)
        else setLabels((data ?? []) as FrameLabel[])
      })
    return () => {
      cancelled = true
    }
  }, [user, committedUrl])

  // Mount the YT player when we have a videoId.
  useEffect(() => {
    if (!videoId || !containerRef.current) return
    let cancelled = false
    loadYouTubeApi().then((YT) => {
      if (cancelled || !containerRef.current) return
      playerRef.current?.destroy?.()
      playerRef.current = new YT.Player(containerRef.current, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: (e) => {
            try {
              setDuration(e.target.getDuration())
            } catch { /* ignore */ }
          },
        },
      })
    })
    return () => {
      cancelled = true
      playerRef.current?.destroy?.()
      playerRef.current = null
    }
  }, [videoId])

  // 250ms time ticker.
  useEffect(() => {
    if (tickRef.current) window.clearInterval(tickRef.current)
    tickRef.current = window.setInterval(() => {
      const p = playerRef.current
      if (!p) return
      try {
        setCurrentTime(p.getCurrentTime())
      } catch { /* not ready */ }
    }, 250)
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
    }
  }, [videoId])

  // Hotkeys 1..6 — write a label at the current time.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const ev = EVENTS.find((x) => x.hotkey === e.key)
      if (ev) {
        e.preventDefault()
        addLabel(ev.key)
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedUrl, currentTime, busyKey])

  function togglePlay() {
    const p = playerRef.current
    if (!p) return
    try {
      const state = p.getPlayerState()
      // 1 = playing per YT API
      if (state === 1) p.pauseVideo()
      else p.playVideo()
    } catch { /* ignore */ }
  }

  function step(deltaSec: number) {
    const p = playerRef.current
    if (!p) return
    try {
      const t = Math.max(0, p.getCurrentTime() + deltaSec)
      p.seekTo(t, true)
    } catch { /* ignore */ }
  }

  async function addLabel(kind: FrameLabelEvent) {
    if (!user || !committedUrl || busyKey) return
    setBusyKey(kind)
    setError(null)
    const t = Number(currentTime.toFixed(2))
    const { data, error: err } = await supabase
      .from('frame_labels')
      .insert({
        user_id: user.id,
        source_url: committedUrl,
        game: 'shinobi_striker',
        event_kind: kind,
        t_seconds: t,
      })
      .select()
      .single()
    setBusyKey(null)
    if (err) {
      setError(err.message)
      return
    }
    setLabels((prev) => [...prev, data as FrameLabel].sort((a, b) => a.t_seconds - b.t_seconds))
  }

  async function removeLabel(id: string) {
    const prev = labels
    setLabels((p) => p.filter((l) => l.id !== id))
    const { error: err } = await supabase.from('frame_labels').delete().eq('id', id)
    if (err) {
      setError(err.message)
      setLabels(prev)
    }
  }

  function jumpTo(t: number) {
    playerRef.current?.seekTo(t, true)
  }

  // Per-event totals for the running stats card.
  const totals = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of labels) map.set(l.event_kind, (map.get(l.event_kind) ?? 0) + 1)
    return map
  }, [labels])

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-4 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">AI label tool</h1>
          <p className="text-gray-400 text-sm">
            Tag in-game events to build the Shinobi Striker training set. See{' '}
            <Link to="/docs/cv-roadmap" className="text-accent hover:underline">
              docs/cv-roadmap.md
            </Link>{' '}
            for what we do with these.
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          setLabels([])
          setCommittedUrl(sourceUrl.trim())
        }}
        className="mb-4 flex flex-wrap gap-2"
      >
        <input
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://youtu.be/…"
          className="flex-1 min-w-[280px] px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-accent text-dark text-sm font-semibold"
        >
          Load
        </button>
      </form>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
        <div>
          <div className="rounded-xl border border-dark-border bg-black overflow-hidden">
            <div className="aspect-video">
              {videoId ? (
                <div ref={containerRef} className="w-full h-full" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
                  Paste a YouTube URL above to begin.
                </div>
              )}
            </div>
            <div className="px-3 py-2 border-t border-dark-border flex flex-wrap gap-2 items-center text-xs">
              <span className="font-mono text-gray-400">
                {fmt(currentTime)} / {fmt(duration)}
              </span>
              <button
                type="button"
                onClick={togglePlay}
                className="px-2 py-1 rounded border border-dark-border text-gray-200 hover:border-accent/40"
              >
                Play / pause (space)
              </button>
              {FRAME_STEPS_SEC.flatMap((s) => [-s, s]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => step(s)}
                  className="px-2 py-1 rounded border border-dark-border text-gray-200 hover:border-accent/40 font-mono"
                >
                  {s > 0 ? `+${s}s` : `${s}s`}
                </button>
              ))}
            </div>
          </div>

          {/* Event hotkey grid */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {EVENTS.map((ev) => (
              <button
                key={ev.key}
                type="button"
                disabled={!committedUrl || busyKey === ev.key}
                onClick={() => addLabel(ev.key)}
                className={`px-3 py-3 rounded-lg border text-left ${ev.color} disabled:opacity-50`}
              >
                <div className="text-xs uppercase tracking-wider opacity-80">
                  Hotkey {ev.hotkey}
                </div>
                <div className="font-semibold mt-1">{ev.label}</div>
                <div className="text-xs opacity-80 mt-1">
                  {totals.get(ev.key) ?? 0} labeled
                </div>
              </button>
            ))}
          </div>

          {error && <p className="mt-3 text-xs text-kunai">{error}</p>}
          <p className="mt-3 text-xs text-gray-500">
            Tip: hit the hotkey at the moment of impact. We tolerate ±0.5 s when training.
          </p>
        </div>

        {/* Right column — running list */}
        <div className="rounded-xl border border-dark-border bg-dark-card p-4 max-h-[600px] overflow-y-auto">
          <h2 className="font-semibold mb-2">Labels</h2>
          {!committedUrl ? (
            <p className="text-xs text-gray-500">Load a video to begin.</p>
          ) : labels.length === 0 ? (
            <p className="text-xs text-gray-500">No labels yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {labels.map((l) => {
                const meta = EVENTS.find((e) => e.key === l.event_kind)
                return (
                  <li key={l.id} className="flex items-center gap-2 group">
                    <button
                      type="button"
                      onClick={() => jumpTo(l.t_seconds)}
                      className="font-mono text-accent hover:underline"
                    >
                      {fmt(l.t_seconds)}
                    </button>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border ${meta?.color ?? ''}`}>
                      {meta?.label ?? l.event_kind}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeLabel(l.id)}
                      className="ml-auto text-gray-500 opacity-0 group-hover:opacity-100 hover:text-kunai text-xs"
                    >
                      remove
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function extractId(url: string): string | null {
  if (!url) return null
  const m = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url
  return null
}

function fmt(t: number): string {
  if (!Number.isFinite(t)) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
