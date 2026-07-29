import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Cast,
  Check,
  PanelRightClose,
  PanelRightOpen,
  Radio,
  Search,
  Shield,
  UserRound,
  X,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useCameraStream } from '@/hooks/useCameraStream'
import { CroppedFrame, TkoWatermark } from '@/components/CroppedFrame'
import { StageChat } from '@/components/StageChat'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { extractYouTubeId, CLEAN_EMBED_PARAMS } from '@/lib/youtubeApi'
import { prettyClip } from '@/lib/clipLabel'
import { supabase } from '@/lib/supabase'
import {
  loadTheme,
  saveTheme,
  normalizeAccent,
  type BroadcastTheme,
} from '@/lib/broadcastTheme'
import {
  cameraGrid,
  directorPlan,
  eventAwareShot,
  shotAt,
  shotFeeds,
  toggleCastSelection,
  SHOT_MS,
  type LiveDirectorEvent,
  type LiveDirectorEventKind,
  type Shot,
} from '@/lib/liveDirector'

/**
 * Broadcast — the "what others see" LIVE composition: the screen a host runs and
 * an audience watches. One clean dark theme, a symmetrical grid of tiles, chat
 * as a layout SIBLING (never an overlay), a compact "Team A vs Team B" strip and
 * a centered tournament name + LIVE badge.
 *
 * Responsive rule that keeps it non-overlapping and symmetrical:
 *   • The tiles live in a CSS GRID (not absolute positioning) so they can never
 *     overlap. On a phone the grid is a single column (everything stacks); from
 *     `sm` up it's a balanced 2-column grid → 2 tiles side-by-side, 4 tiles in a
 *     clean 2×2. Every tile is `aspect-video`, so rows stay even.
 *   • Chat sits BESIDE the stage on wide screens (`lg` two-column) and BELOW it
 *     on phones — the same sibling pattern the reel player uses.
 *
 * Tiles:
 *   • HOST tile — the host's webcam (getUserMedia) OR, if they don't want to be
 *     on camera, a clean voice-only avatar with a speaking pulse.
 *   • PLAYER tiles — cropped YouTube panes (reuse CroppedFrame), added by URL.
 *
 * Light theming (accent color + optional logo, team + tournament names) persists
 * locally per host/tournament via src/lib/broadcastTheme.ts.
 */

const MAX_PLAYERS = 7 // + the host tile = up to eight connected feeds
const HOLD_TO_SELECT_MS = 420
const LIVE_EVENT_KINDS = new Set<LiveDirectorEventKind>([
  'knockout',
  'flag_pickup',
  'flag_capture',
  'base_capture',
  'objective',
  'ultimate',
])

type PlayerScreen = { id: string; url: string; videoId: string }
type BroadcastFeed =
  | { id: 'host'; kind: 'host'; label: string }
  | { id: string; kind: 'player'; label: string; player: PlayerScreen }
type MatchupPick = {
  id: string
  kind: 'clan' | 'player'
  name: string
  image: string | null
  detail: string
}

let _seq = 0
const nextId = () => `p_${Date.now()}_${_seq++}`

function ytEmbedSrc(videoId: string, unmuted: boolean): string {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=${unmuted ? 0 : 1}&${CLEAN_EMBED_PARAMS}`
}

/** Symmetrical grid columns: phone always 1 col (stacks); ≥sm balances to 2. */
function manualShot(feeds: number[], focused: number): Shot {
  if (feeds.length >= 3) return { layout: 'grid', featured: feeds[0], feeds }
  if (feeds.length === 2) return { layout: 'split', featured: feeds[0], secondary: feeds[1] }
  return { layout: 'single', featured: feeds[0] ?? focused }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'H'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function Broadcast() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const holdTimerRef = useRef<number | null>(null)
  const holdTriggeredRef = useRef(false)
  const chatDragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  // Persist per tournament (?t=) if present, else per signed-in host, else a
  // shared local "default" so an anonymous demo still remembers its look.
  const themeKey = params.get('t') || user?.id || 'default'
  const [theme, setTheme] = useState<BroadcastTheme>(() => loadTheme(themeKey))
  useEffect(() => { setTheme(loadTheme(themeKey)) }, [themeKey])

  const patchTheme = (patch: Partial<BroadcastTheme>) =>
    setTheme((prev) => saveTheme(themeKey, { ...prev, ...patch }))

  const accent = normalizeAccent(theme.accent)

  // Player video tiles (cropped YouTube panes).
  const [players, setPlayers] = useState<PlayerScreen[]>([])
  const [urlInput, setUrlInput] = useState('')
  const [urlError, setUrlError] = useState('')

  function addPlayer(e?: React.FormEvent) {
    e?.preventDefault()
    setUrlError('')
    if (players.length >= MAX_PLAYERS) { setUrlError(`Up to ${MAX_PLAYERS} player angles.`); return }
    const videoId = extractYouTubeId(urlInput.trim())
    if (!videoId) { setUrlError('Paste a valid YouTube link.'); return }
    if (players.some((p) => p.videoId === videoId)) { setUrlError('That angle is already added.'); return }
    setPlayers((prev) => [...prev, { id: nextId(), url: urlInput.trim(), videoId }])
    setUrlInput('')
  }

  const removePlayer = (id: string) => setPlayers((prev) => prev.filter((p) => p.id !== id))

  // The host's own camera / mic.
  const cam = useCameraStream()
  const [showControls, setShowControls] = useState(true)
  const [pickerSide, setPickerSide] = useState<'A' | 'B' | null>(null)
  const [hostPlacement, setHostPlacement] = useState<'auto' | 'stage' | 'pip' | 'hidden'>('auto')
  const [auto, setAuto] = useState(true)
  const [beat, setBeat] = useState(0)
  const [focused, setFocused] = useState(0)
  const [selectedFeeds, setSelectedFeeds] = useState<number[]>([])
  const [castFeeds, setCastFeeds] = useState<number[] | null>(null)
  const [directorEvents, setDirectorEvents] = useState<LiveDirectorEvent[]>([])
  const [chatOpen, setChatOpen] = useState(true)
  const [chatWidth, setChatWidth] = useState(320)

  // Accent applied as a scoped CSS var so the ONE base theme stays dark while
  // the host's color trims the branded bits (badges, borders, buttons).
  const rootStyle = useMemo(
    () => ({ ['--bx' as string]: accent }) as React.CSSProperties,
    [accent],
  )

  const hostOnStage =
    hostPlacement === 'stage' ||
    (hostPlacement === 'auto' && (cam.camOn || players.length === 0))
  const hostInPip = hostPlacement === 'pip'
  const feeds = useMemo<BroadcastFeed[]>(() => {
    const next: BroadcastFeed[] = players.map((player, index) => ({
      id: player.id,
      kind: 'player',
      label: `Player ${index + 1}`,
      player,
    }))
    if (hostOnStage) {
      next.unshift({ id: 'host', kind: 'host', label: theme.hostName || 'Host' })
    }
    return next.slice(0, 8)
  }, [hostOnStage, players, theme.hostName])
  const feedKey = feeds.map((feed) => feed.id).join(',')

  useEffect(() => {
    if (!auto) return
    const timer = window.setInterval(() => setBeat((current) => current + 1), SHOT_MS)
    return () => window.clearInterval(timer)
  }, [auto])

  useEffect(() => {
    return () => {
      if (holdTimerRef.current != null) window.clearTimeout(holdTimerRef.current)
    }
  }, [])

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const drag = chatDragRef.current
      if (!drag) return
      setChatWidth(Math.max(260, Math.min(520, drag.startWidth + drag.startX - event.clientX)))
    }
    function onUp() {
      chatDragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  useEffect(() => {
    setFocused((current) => Math.max(0, Math.min(current, feeds.length - 1)))
    setSelectedFeeds([])
    setCastFeeds(null)
  }, [feedKey, feeds.length])

  const plan = directorPlan(feeds.length)
  const timedShot = shotAt(plan, beat)
  const automaticShot = eventAwareShot(timedShot, directorEvents, Date.now(), feeds.length)
  const shot = auto
    ? automaticShot
    : manualShot(castFeeds ?? [], Math.min(focused, feeds.length - 1))
  const activeFeeds = shotFeeds(shot, feeds.length)
  const grid = cameraGrid(activeFeeds.length)

  useEffect(() => {
    function onLiveEvent(event: Event) {
      const detail = (event as CustomEvent<{
        streamId?: string
        angle?: number
        kind?: LiveDirectorEventKind
        atMs?: number
        confidence?: number
      }>).detail
      if (!detail?.kind || !LIVE_EVENT_KINDS.has(detail.kind)) return

      const angle = Number.isInteger(detail.angle)
        ? Number(detail.angle)
        : feeds.findIndex((feed) => (
          feed.id === detail.streamId ||
          (feed.kind === 'player' && feed.player.videoId === detail.streamId)
        ))
      if (angle < 0 || angle >= feeds.length) return

      setDirectorEvents((current) => [
        ...current.slice(-31),
        {
          angle,
          kind: detail.kind!,
          atMs: detail.atMs ?? Date.now(),
          confidence: detail.confidence,
        },
      ])
    }

    window.addEventListener('tko:live-event', onLiveEvent)
    return () => window.removeEventListener('tko:live-event', onLiveEvent)
  }, [feedKey, feeds])

  function pickFeed(index: number) {
    setAuto(false)
    setFocused(index)
    setCastFeeds([index])
    setSelectedFeeds([])
  }

  function beginFeedPress(index: number) {
    holdTriggeredRef.current = false
    if (holdTimerRef.current != null) window.clearTimeout(holdTimerRef.current)
    holdTimerRef.current = window.setTimeout(() => {
      holdTriggeredRef.current = true
      setAuto(false)
      setCastFeeds(null)
      setSelectedFeeds((current) => toggleCastSelection(current, index, feeds.length))
    }, HOLD_TO_SELECT_MS)
  }

  function endFeedPress(index: number) {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (holdTriggeredRef.current) {
      holdTriggeredRef.current = false
      return
    }
    if (selectedFeeds.length) {
      setSelectedFeeds((current) => toggleCastSelection(current, index, feeds.length))
      return
    }
    pickFeed(index)
  }

  function cancelFeedPress() {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  function castSelection() {
    if (!selectedFeeds.length) return
    const next = [...selectedFeeds].sort((leftIndex, rightIndex) => leftIndex - rightIndex)
    setAuto(false)
    setCastFeeds(next)
    setFocused(next[0])
  }

  function enableAuto() {
    setAuto(true)
    setCastFeeds(null)
    setSelectedFeeds([])
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto" style={rootStyle}>
      {/* ── 1. Header: logo (optional) + tournament name + LIVE badge ──────── */}
      <header className="text-center">
        {theme.logoUrl && (
          <img
            src={theme.logoUrl}
            alt=""
            className="mx-auto mb-3 max-h-16 w-auto object-contain"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-bold text-white truncate max-w-full">
            {theme.tournamentName || 'TKO Live'}
          </h1>
          <LiveBadge />
        </div>
      </header>

      {/* ── Stage + Chat: chat is a sibling (beside on lg, below on phone) ──── */}
      <div className="mt-5">
        <TeamsStrip theme={theme} accent={accent} onPick={setPickerSide} />

        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-dark-border bg-dark-card px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={enableAuto}
              className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold ${
                auto
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-dark-border text-gray-300 hover:border-accent/60'
              }`}
            >
              <Radio size={16} />
              Auto
            </button>
            <span className="truncate text-xs text-gray-400">
              {activeFeeds.length} of {feeds.length} feeds on air
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {selectedFeeds.length > 0 && (
              <button
                type="button"
                onClick={castSelection}
                className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-bold text-dark"
                style={{ background: accent }}
              >
                <Cast size={16} />
                Cast {selectedFeeds.length}
              </button>
            )}
            <button
              type="button"
              onClick={() => setChatOpen((open) => !open)}
              title={chatOpen ? 'Hide chat' : 'Show chat'}
              className="grid h-9 w-9 place-items-center rounded-md border border-dark-border text-gray-300 hover:border-accent/60"
            >
              {chatOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </button>
          </div>
        </div>

        <div
          className={`mt-3 ${chatOpen ? 'lg:grid' : ''} items-stretch`}
          style={
            chatOpen
              ? { gridTemplateColumns: `minmax(0, 1fr) 8px ${chatWidth}px` }
              : undefined
          }
        >
          <div className="relative min-w-0 overflow-hidden rounded-xl border border-dark-border bg-black">
            <div
              className="grid aspect-video"
              style={{
                gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
              }}
            >
              {activeFeeds.map((feedIndex) => {
                const feed = feeds[feedIndex]
                if (!feed) return null
                return (
                  <div key={feed.id} className="relative min-h-0 min-w-0 overflow-hidden border border-black/60">
                    {feed.kind === 'host' ? (
                      <HostTile
                        stream={cam.stream}
                        camOn={cam.camOn}
                        micOn={cam.micOn}
                        hostName={theme.hostName}
                        accent={accent}
                        fill
                      />
                    ) : (
                      <TileShell label={feed.label} accent={accent} fill>
                        <CroppedFrame>
                          <iframe
                            src={ytEmbedSrc(feed.player.videoId, feedIndex === activeFeeds[0])}
                            title={feed.label}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            className="h-full w-full"
                          />
                        </CroppedFrame>
                      </TileShell>
                    )}
                  </div>
                )
              })}
              {feeds.length === 0 && (
                <div className="grid h-full w-full place-items-center text-sm text-gray-500">
                  Add a live camera to start the stage.
                </div>
              )}
            </div>
            {hostInPip && (
              <div className="absolute bottom-3 left-3 z-20 w-32 overflow-hidden rounded-lg shadow-xl sm:w-44">
                <HostTile
                  stream={cam.stream}
                  camOn={cam.camOn}
                  micOn={cam.micOn}
                  hostName={theme.hostName}
                  accent={accent}
                />
              </div>
            )}
            <TkoWatermark />
          </div>

          {chatOpen && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat"
              onPointerDown={(event) => {
                chatDragRef.current = { startX: event.clientX, startWidth: chatWidth }
                document.body.style.cursor = 'col-resize'
                document.body.style.userSelect = 'none'
              }}
              className="group hidden cursor-col-resize items-stretch justify-center lg:flex"
            >
              <span className="w-px bg-dark-border transition-colors group-hover:bg-accent" />
            </div>
          )}

          {chatOpen && (
            <div className="mt-3 lg:mt-0">
              <StageChat
                title={theme.tournamentName}
                heightClass="h-[320px] lg:h-full lg:min-h-[420px]"
              />
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {feeds.map((feed, index) => {
            const onAir = activeFeeds.includes(index)
            const selected = selectedFeeds.includes(index)
            return (
              <button
                key={`source-${feed.id}`}
                type="button"
                title={selectedFeeds.length ? `Add or remove ${feed.label}` : `Feature ${feed.label}. Hold to combine.`}
                onPointerDown={(event) => {
                  if (event.button === 0) beginFeedPress(index)
                }}
                onPointerUp={(event) => {
                  if (event.button === 0) endFeedPress(index)
                }}
                onPointerCancel={cancelFeedPress}
                onPointerLeave={cancelFeedPress}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    selectedFeeds.length
                      ? setSelectedFeeds((current) => toggleCastSelection(current, index, feeds.length))
                      : pickFeed(index)
                  }
                }}
                className={`select-none overflow-hidden rounded-lg border text-left ${
                  selected
                    ? 'border-accent ring-2 ring-accent'
                    : onAir
                      ? 'border-white/55'
                      : 'border-dark-border hover:border-accent/55'
                }`}
              >
                <div className="relative aspect-video bg-dark">
                  {feed.kind === 'player' ? (
                    <img
                      src={`https://i.ytimg.com/vi/${feed.player.videoId}/mqdefault.jpg`}
                      alt=""
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-xl font-bold text-white">
                      {initialsOf(theme.hostName || 'Host')}
                    </div>
                  )}
                  <span className="absolute left-1 top-1 rounded bg-black/75 px-1 py-0.5 text-[10px] text-white">
                    {onAir ? 'ON AIR' : `CAM ${index + 1}`}
                  </span>
                  {selected && (
                    <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-accent text-dark">
                      <Check size={13} strokeWidth={3} />
                    </span>
                  )}
                </div>
                <span className="block truncate bg-dark-card p-1.5 text-[11px] text-white">{feed.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Host controls (collapsible so the audience-facing screen stays clean) */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-gray-400">Host controls</h2>
        <button
          type="button"
          onClick={() => setShowControls((v) => !v)}
          className="text-xs text-gray-400 hover:text-white"
        >
          {showControls ? 'Hide ▲' : 'Show ▼'}
        </button>
      </div>

      {showControls && (
        <div className="mt-3 space-y-3">
          {/* Go on camera */}
          <CollapsibleSection id="broadcast-camera" label="Camera" defaultOpen>
            <p className="text-xs text-gray-500 mt-0.5">
              Add your own camera as the host tile. Turn the camera off to go
              voice-only — your avatar shows with a speaking pulse.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {!cam.active ? (
                <button
                  type="button"
                  onClick={cam.start}
                  disabled={cam.starting}
                  className="px-4 py-2 rounded-lg font-semibold text-dark disabled:opacity-50"
                  style={{ background: accent }}
                >
                  {cam.starting ? 'Starting…' : '🎥 Go on camera'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={cam.toggleCam}
                    className="px-3 py-2 rounded-lg border border-dark-border text-white text-sm hover:border-accent/50"
                  >
                    {cam.camOn ? '📷 Camera on' : '🚫 Camera off (voice only)'}
                  </button>
                  <button
                    type="button"
                    onClick={cam.toggleMic}
                    className="px-3 py-2 rounded-lg border border-dark-border text-white text-sm hover:border-accent/50"
                  >
                    {cam.micOn ? '🎙 Mic on' : '🔇 Mic muted'}
                  </button>
                  <button
                    type="button"
                    onClick={cam.stop}
                    className="px-3 py-2 rounded-lg border border-dark-border text-gray-400 text-sm hover:border-kunai/50 hover:text-kunai"
                  >
                    End camera
                  </button>
                </>
              )}
            </div>
            {cam.error && <p className="text-kunai text-xs mt-2">{cam.error}</p>}
            <div className="mt-3 inline-flex max-w-full overflow-x-auto rounded-lg border border-dark-border bg-black/25 p-1">
              {(['auto', 'stage', 'pip', 'hidden'] as const).map((placement) => (
                <button
                  key={placement}
                  type="button"
                  onClick={() => setHostPlacement(placement)}
                  className={`h-8 whitespace-nowrap rounded-md px-3 text-xs font-semibold capitalize ${
                    hostPlacement === placement
                      ? 'bg-white/10 text-white'
                      : 'text-gray-500 hover:text-gray-200'
                  }`}
                >
                  {placement}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Streaming a game feed instead?{' '}
              <Link to="/live-streams?tab=broadcast" className="text-accent hover:underline">
                Use OBS →
              </Link>
            </p>
          </CollapsibleSection>

          {/* Add player angles */}
          <CollapsibleSection id="broadcast-angles" label="Angles" count={players.length}>
            <p className="text-xs text-gray-500 mt-0.5">
              Paste each player's live YouTube link to add their angle as a tile.
            </p>
            <form onSubmit={addPlayer} className="mt-3 flex flex-wrap gap-2">
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Paste a player's live YouTube link…"
                className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={players.length >= MAX_PLAYERS}
                className="px-4 py-2 rounded-lg font-semibold text-dark text-sm disabled:opacity-40"
                style={{ background: accent }}
              >
                Add angle
              </button>
            </form>
            {urlError && <p className="text-kunai text-xs mt-2">{urlError}</p>}
            <p className="text-xs text-gray-500 mt-2">{players.length}/{MAX_PLAYERS} angles.</p>
            {players.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {players.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-2 rounded-lg bg-dark border border-dark-border px-3 py-1.5">
                    <span className="text-xs font-semibold shrink-0" style={{ color: accent }}>Player {i + 1}</span>
                    <span className="text-xs text-gray-400 truncate flex-1">{prettyClip(p.url)}</span>
                    <button
                      type="button"
                      onClick={() => removePlayer(p.id)}
                      className="text-xs text-gray-500 hover:text-kunai shrink-0"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleSection>

          {/* Light theming */}
          <CollapsibleSection id="broadcast-settings" label="Settings">
            <p className="text-xs text-gray-500 mt-0.5">
              One clean base theme — set an accent color, optional logo, and the
              names below. Saved to this device for this event.
            </p>
            <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Tournament name">
                <input
                  value={theme.tournamentName}
                  onChange={(e) => patchTheme({ tournamentName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
                />
              </Field>
              <Field label="Host name">
                <input
                  value={theme.hostName}
                  onChange={(e) => patchTheme({ hostName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
                />
              </Field>
              <Field label="Accent color">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={accent}
                    onChange={(e) => patchTheme({ accent: e.target.value })}
                    className="h-9 w-12 rounded bg-dark border border-dark-border p-0.5"
                    aria-label="Accent color"
                  />
                  <input
                    value={theme.accent}
                    onChange={(e) => patchTheme({ accent: e.target.value })}
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm font-mono"
                  />
                </div>
              </Field>
              <Field label="Team A">
                <input
                  value={theme.teamA}
                  onChange={(e) => patchTheme({ teamA: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
                />
              </Field>
              <Field label="Team B">
                <input
                  value={theme.teamB}
                  onChange={(e) => patchTheme({ teamB: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
                />
              </Field>
              <Field label="Logo / banner URL (optional)">
                <input
                  value={theme.logoUrl}
                  onChange={(e) => patchTheme({ logoUrl: e.target.value })}
                  placeholder="https://…"
                  className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
                />
              </Field>
              <Field label="Team A logo URL (optional)">
                <input
                  value={theme.teamALogo}
                  onChange={(e) => patchTheme({ teamALogo: e.target.value })}
                  placeholder="https://…"
                  className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
                />
              </Field>
              <Field label="Team B logo URL (optional)">
                <input
                  value={theme.teamBLogo}
                  onChange={(e) => patchTheme({ teamBLogo: e.target.value })}
                  placeholder="https://…"
                  className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
                />
              </Field>
            </div>
          </CollapsibleSection>
        </div>
      )}
      {pickerSide && (
        <MatchupPicker
          side={pickerSide}
          onClose={() => setPickerSide(null)}
          onSelect={(pick) => {
            patchTheme(
              pickerSide === 'A'
                ? {
                    teamA: pick.name,
                    teamALogo: pick.image ?? '',
                    teamAEntityId: pick.id,
                    teamAEntityType: pick.kind,
                  }
                : {
                    teamB: pick.name,
                    teamBLogo: pick.image ?? '',
                    teamBEntityId: pick.id,
                    teamBEntityType: pick.kind,
                  },
            )
            setPickerSide(null)
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  Pieces
// ─────────────────────────────────────────────────────────────────────────

function LiveBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold text-white"
      style={{ background: 'var(--bx)' }}
    >
      <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
      LIVE
    </span>
  )
}

/** Uniform tile: aspect-video, accent border, corner label. */
function TileShell({
  label,
  accent,
  children,
  fill = false,
}: {
  label: string
  accent: string
  children: React.ReactNode
  fill?: boolean
}) {
  return (
    <div
      className={`relative w-full ${fill ? 'h-full' : 'aspect-video rounded-xl'} overflow-hidden bg-[#0A0A0C]`}
      style={{ border: `1px solid ${accent}` }}
    >
      {children}
      <span className="absolute top-1.5 left-1.5 z-20 px-1.5 py-0.5 rounded bg-black/70 text-[11px] font-medium text-white pointer-events-none">
        {label}
      </span>
    </div>
  )
}

/** Host tile: live webcam when camera is on, else a voice-only avatar. */
function HostTile({
  stream,
  camOn,
  micOn,
  hostName,
  accent,
  fill = false,
}: {
  stream: MediaStream | null
  camOn: boolean
  micOn: boolean
  hostName: string
  accent: string
  fill?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const showVideo = !!stream && camOn

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = showVideo ? stream : null
  }, [showVideo, stream])

  const speaking = !!stream && micOn // voice-only "speaking" pulse when the mic is hot

  return (
    <TileShell label={hostName || 'Host'} accent={accent} fill={fill}>
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          muted /* local playback muted to avoid feedback; mic still broadcasts */
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#0A0A0C]">
          <div className="relative flex items-center justify-center">
            {speaking && (
              <span
                className="absolute inset-0 rounded-full animate-ping"
                style={{ boxShadow: `0 0 0 3px ${accent}`, opacity: 0.5 }}
              />
            )}
            <div
              className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center text-2xl font-bold text-white"
              style={{ background: '#1a1726', border: `2px solid ${accent}` }}
            >
              {initialsOf(hostName || 'Host')}
            </div>
          </div>
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
            style={{ color: accent, border: `1px solid ${accent}` }}
          >
            <span className="text-sm leading-none">🎙</span>
            {stream ? 'Audio only' : 'Not on camera'}
          </span>
        </div>
      )}
      {/* Mic-muted indicator overlay */}
      {stream && !micOn && (
        <span className="absolute bottom-1.5 right-1.5 z-20 px-1.5 py-0.5 rounded bg-black/70 text-[11px] text-kunai">
          🔇 muted
        </span>
      )}
    </TileShell>
  )
}

/** Compact "Team A  vs  Team B" strip with optional crests. */
function TeamsStrip({
  theme,
  accent,
  onPick,
}: {
  theme: BroadcastTheme
  accent: string
  onPick: (side: 'A' | 'B') => void
}) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card px-3 py-2 flex items-center justify-center gap-3 sm:gap-5">
      <TeamSide name={theme.teamA} logo={theme.teamALogo} align="right" onClick={() => onPick('A')} />
      <span
        className="shrink-0 text-xs font-black px-2 py-1 rounded-full"
        style={{ color: accent, border: `1px solid ${accent}` }}
      >
        VS
      </span>
      <TeamSide name={theme.teamB} logo={theme.teamBLogo} align="left" onClick={() => onPick('B')} />
    </div>
  )
}

function TeamSide({
  name,
  logo,
  align,
  onClick,
}: {
  name: string
  logo: string
  align: 'left' | 'right'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Choose a clan or player"
      className={`flex items-center gap-2 min-w-0 flex-1 rounded-lg px-2 py-1.5 transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-accent/60 ${align === 'right' ? 'justify-end' : 'justify-start'}`}
    >
      {align === 'right' && <span className="font-semibold text-white truncate">{name || 'Team A'}</span>}
      {logo ? (
        <img
          src={logo}
          alt=""
          className="w-7 h-7 rounded-full object-cover shrink-0 bg-dark"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      ) : (
        <span className="w-7 h-7 rounded-full bg-dark-elevated shrink-0" aria-hidden />
      )}
      {align === 'left' && <span className="font-semibold text-white truncate">{name || 'Team B'}</span>}
    </button>
  )
}

function MatchupPicker({
  side,
  onClose,
  onSelect,
}: {
  side: 'A' | 'B'
  onClose: () => void
  onSelect: (pick: MatchupPick) => void
}) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<MatchupPick[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      const needle = query.trim().toLocaleLowerCase()
      setLoading(true)
      setLoadError('')

      const clanQuery = supabase
        .from('servers')
        .select('id, name, icon_url, clan_tag')
        .order('name')
        .limit(100)
      const playerQuery = supabase
        .from('profiles')
        .select('id, username, avatar_url, game_tag')
        .order('username')
        .limit(100)

      void Promise.all([clanQuery, playerQuery]).then(([clans, players]) => {
        if (cancelled) return
        const errors = [clans.error, players.error].filter(Boolean)
        setItems([
          ...((clans.data ?? []) as {
            id: string
            name: string
            icon_url: string | null
            clan_tag: string | null
          }[]).map(
            (clan): MatchupPick => ({
              id: clan.id,
              kind: 'clan',
              name: clan.name,
              image: clan.icon_url,
              detail: clan.clan_tag ? `Clan · ${clan.clan_tag}` : 'Clan',
            }),
          ).filter((clan) => !needle || `${clan.name} ${clan.detail}`.toLocaleLowerCase().includes(needle)),
          ...((players.data ?? []) as {
            id: string
            username: string
            avatar_url: string | null
            game_tag: string | null
          }[]).map(
            (player): MatchupPick => ({
              id: player.id,
              kind: 'player',
              name: player.username,
              image: player.avatar_url,
              detail: player.game_tag ? `Player · ${player.game_tag}` : 'Player',
            }),
          ).filter((player) => !needle || `${player.name} ${player.detail}`.toLocaleLowerCase().includes(needle)),
        ].slice(0, 40))
        setLoadError(errors.length ? 'Some results could not be loaded. Try again.' : '')
        setLoading(false)
      })
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`Choose Team ${side}`}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <div className="max-h-[78vh] w-full max-w-lg overflow-hidden rounded-t-xl border border-dark-border bg-[#111017] shadow-2xl sm:rounded-xl">
        <div className="flex items-center justify-between border-b border-dark-border px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">Team {side}</p>
            <h2 className="text-lg font-bold text-white">Choose a clan or player</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full text-gray-300 hover:bg-white/10 hover:text-white"
            aria-label="Close picker"
          >
            <X size={20} />
          </button>
        </div>
        <label className="m-4 flex items-center gap-2 rounded-lg border border-dark-border bg-black/35 px-3">
          <Search size={18} className="text-gray-400" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search clans or profiles"
            className="h-11 min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-gray-500"
          />
        </label>
        <div className="max-h-[52vh] overflow-y-auto px-3 pb-4">
          {loadError && (
            <p className="mx-2 mb-2 rounded-lg border border-kunai/35 bg-kunai/10 px-3 py-2 text-sm text-kunai">
              {loadError}
            </p>
          )}
          {loading ? (
            <p className="px-2 py-8 text-center text-sm text-gray-400">Loading teams...</p>
          ) : items.length ? (
            <div className="space-y-1">
              {items.map((item) => (
                <button
                  key={`${item.kind}-${item.id}`}
                  type="button"
                  onClick={() => onSelect(item)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-white/5"
                >
                  {item.image ? (
                    <img src={item.image} alt="" className="h-11 w-11 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-dark-elevated text-gray-300">
                      {item.kind === 'clan' ? <Shield size={20} /> : <UserRound size={20} />}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-white">{item.name}</span>
                    <span className="block truncate text-xs text-gray-500">{item.detail}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="px-2 py-8 text-center text-sm text-gray-400">No matching clan or profile.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  )
}

export default Broadcast
