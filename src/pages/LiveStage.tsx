import { useEffect, useRef, useState, type CSSProperties, type TouchEvent as ReactTouchEvent } from 'react'
import {
  Cast,
  Check,
  PanelRightClose,
  PanelRightOpen,
  Radio,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { CroppedFrame, TkoWatermark } from '@/components/CroppedFrame'
import { MergedStreamChat } from '@/components/MergedStreamChat'
import { ShareButton } from '@/components/ShareButton'
import { LiveLinkOptOut } from '@/components/LiveLinkOptOut'
import { CLEAN_EMBED_PARAMS } from '@/lib/youtubeApi'
import { handleOf, reasonLabel, type LiveLinkReason } from '@/lib/liveLink'
import { endStageGroup, loadCards, loadStageGroup, type LiveCard } from '@/lib/liveLinkService'
import { useStageBreakpoint } from '@/hooks/useStageBreakpoint'
import { nextAngleIndex, swipeDirection } from '@/lib/stageLayout'
import {
  cameraGrid,
  directorPlan,
  eventAwareShot,
  shotAt,
  shotFeeds,
  shotLabel,
  toggleCastSelection,
  SHOT_MS,
  type LiveDirectorEvent,
  type LiveDirectorEventKind,
  type Shot,
} from '@/lib/liveDirector'

function ytEmbedSrc(videoId: string, unmuted: boolean): string {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=${unmuted ? 0 : 1}&${CLEAN_EMBED_PARAMS}`
}

interface StageState {
  groupId: string | null
  name: string
  reason: LiveLinkReason | null
  creatorId: string | null
  endedAt: string | null
  cards: LiveCard[]
}

const LIVE_EVENT_KINDS = new Set<LiveDirectorEventKind>([
  'knockout',
  'flag_pickup',
  'flag_capture',
  'base_capture',
  'objective',
  'ultimate',
])

const HOLD_TO_SELECT_MS = 420

function manualShot(feeds: number[], focused: number): Shot {
  if (feeds.length >= 3) return { layout: 'grid', featured: feeds[0], feeds }
  if (feeds.length === 2) return { layout: 'split', featured: feeds[0], secondary: feeds[1] }
  return { layout: 'single', featured: feeds[0] ?? focused }
}

export function LiveStage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { user } = useAuth()
  const bp = useStageBreakpoint()
  const isPhone = bp === 'phone'
  const isDesktop = bp === 'desktop'
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const holdTriggeredRef = useRef(false)
  const chatDragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const [state, setState] = useState<StageState | null>(null)
  const [loading, setLoading] = useState(true)
  const [focused, setFocused] = useState(0)
  const [audioStreamId, setAudioStreamId] = useState<string | null | undefined>(undefined)
  const [auto, setAuto] = useState(true)
  const [beat, setBeat] = useState(0)
  const [selectedFeeds, setSelectedFeeds] = useState<number[]>([])
  const [castFeeds, setCastFeeds] = useState<number[] | null>(null)
  const [directorEvents, setDirectorEvents] = useState<LiveDirectorEvent[]>([])
  const [chatOpen, setChatOpen] = useState(true)
  const [chatWidth, setChatWidth] = useState(320)
  const [ending, setEnding] = useState(false)
  const [ended, setEnded] = useState(false)
  const [left, setLeft] = useState<{ collapsed: boolean; remainingStreamIds: string[] } | null>(null)

  const adhocIds = (params.get('s') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      if (!id || id === 'new') {
        const cards = await loadCards(adhocIds)
        if (!cancelled) {
          setState({
            groupId: null,
            name: cards.length ? `${cards.length} angles` : 'Multi-angle stage',
            reason: null,
            creatorId: null,
            endedAt: null,
            cards,
          })
          setLoading(false)
        }
        return
      }

      const saved = await loadStageGroup(id)
      if (cancelled) return
      setState(
        saved && {
          groupId: saved.groupId,
          name: saved.name,
          reason: (saved.reason as LiveLinkReason | null) ?? null,
          creatorId: saved.creatorId,
          endedAt: saved.endedAt,
          cards: saved.cards,
        },
      )
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
    // The URL string is the stable dependency for ad-hoc stream lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, params.get('s')])

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
    function onLiveEvent(event: Event) {
      const detail = (event as CustomEvent<{
        streamId?: string
        angle?: number
        kind?: LiveDirectorEventKind
        atMs?: number
        confidence?: number
      }>).detail
      if (!detail?.kind || !LIVE_EVENT_KINDS.has(detail.kind)) return

      const cards = state?.cards.slice(0, 8) ?? []
      const angle = Number.isInteger(detail.angle)
        ? Number(detail.angle)
        : cards.findIndex((card) => card.streamId === detail.streamId)
      if (angle < 0 || angle >= cards.length) return

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
  }, [state?.cards])

  useEffect(() => {
    const count = Math.min(8, state?.cards.length ?? 0)
    setFocused((current) => Math.max(0, Math.min(current, count - 1)))
    setSelectedFeeds((current) => current.filter((index) => index < count))
    setCastFeeds((current) => current?.filter((index) => index < count) ?? null)
  }, [state?.cards.length])

  if (loading) {
    return <div className="p-8 text-center text-accent animate-pulse">Loading the stage...</div>
  }

  if (!state || state.cards.length === 0) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center">
        <h1 className="text-2xl font-bold mb-2">Stage not found</h1>
        <p className="text-gray-400 mb-4">This link may have ended, or the streams are no longer live.</p>
        <Link to="/live" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">
          See who is live
        </Link>
      </div>
    )
  }

  const cards = state.cards.slice(0, 8)
  const plan = directorPlan(cards.length)
  const timedShot = shotAt(plan, beat)
  const autoShot = eventAwareShot(timedShot, directorEvents, Date.now(), cards.length)
  const shot = auto
    ? autoShot
    : manualShot(castFeeds ?? [], Math.min(focused, cards.length - 1))
  const activeFeeds = shotFeeds(shot, cards.length)
  const grid = cameraGrid(activeFeeds.length)
  const activeIndex = Math.min(shot.featured, cards.length - 1)
  const focusCard = cards[activeIndex]
  const defaultAudioId = cards[activeFeeds[0]]?.streamId ?? null
  const requestedAudioIsOnAir = activeFeeds.some((index) => cards[index]?.streamId === audioStreamId)
  const activeAudioId = audioStreamId === null
    ? null
    : audioStreamId === undefined || !requestedAudioIsOnAir
      ? defaultAudioId
      : audioStreamId
  const isBattle = state.reason === 'scheduled_battle'
  const canDirect = cards.length >= 2
  const canEnd = !!user && !!state.groupId && !state.endedAt && !ended
  const shareUrl = state.groupId
    ? `https://tko.cam/live-stage/${state.groupId}`
    : `https://tko.cam/live-stage/new?s=${encodeURIComponent(cards.map((card) => card.streamId).join(','))}`

  function pickAngle(index: number) {
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
      setSelectedFeeds((current) => toggleCastSelection(current, index, cards.length))
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
      setSelectedFeeds((current) => toggleCastSelection(current, index, cards.length))
      return
    }
    pickAngle(index)
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

  async function endStage() {
    if (!user || !state?.groupId) return
    setEnding(true)
    try {
      const ok = await endStageGroup(state.groupId, user.id)
      if (ok) setEnded(true)
    } finally {
      setEnding(false)
    }
  }

  function onStageTouchStart(event: ReactTouchEvent) {
    if (!isPhone) return
    const touch = event.touches[0]
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null
  }

  function onStageTouchEnd(event: ReactTouchEvent) {
    const start = touchStartRef.current
    touchStartRef.current = null
    if (!isPhone || !start) return
    const touch = event.changedTouches[0]
    if (!touch) return
    const direction = swipeDirection(touch.clientX - start.x, touch.clientY - start.y)
    if (direction !== 0) pickAngle(nextAngleIndex(activeIndex, cards.length, direction))
  }

  const stageGridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1500px] mx-auto">
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-bold min-w-0">
          <span className="live-dot mr-2" />
          {state.name}
        </h1>
        <ShareButton url={shareUrl} title={state.name} text="Watch every angle on TKO" />
      </div>
      <p className="text-sm text-gray-400 mb-4">
        {isBattle
          ? 'Both teams are live from every connected camera.'
          : state.reason
            ? `Linked because: ${reasonLabel(state.reason)}.`
            : 'Every connected camera on one stage.'}
      </p>

      <div className="flex items-center justify-between gap-3 mb-3 rounded-lg border border-dark-border bg-dark-card px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          {canDirect && (
            <button
              type="button"
              onClick={enableAuto}
              title="Let TKO switch cameras automatically"
              className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-semibold ${
                auto
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-dark-border text-gray-300 hover:border-accent/60 hover:text-white'
              }`}
            >
              <Radio size={16} />
              Auto
            </button>
          )}
          <span className="text-xs text-gray-400 truncate">
            {shotLabel(shot, cards.map(handleOf))}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {selectedFeeds.length > 0 && (
            <button
              type="button"
              onClick={castSelection}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 text-xs font-bold text-dark hover:shadow-glow"
            >
              <Cast size={16} />
              Cast {selectedFeeds.length}
            </button>
          )}
          <button
            type="button"
            onClick={() => setChatOpen((open) => !open)}
            title={chatOpen ? 'Hide chat' : 'Show chat'}
            className="grid h-9 w-9 place-items-center rounded-md border border-dark-border text-gray-300 hover:border-accent/60 hover:text-white"
          >
            {chatOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
        </div>
      </div>

      <div
        className={isDesktop && chatOpen ? 'grid items-stretch' : 'space-y-3'}
        style={
          isDesktop && chatOpen
            ? { gridTemplateColumns: `minmax(0, 1fr) 8px ${chatWidth}px` }
            : undefined
        }
      >
        <div className="min-w-0 rounded-xl border border-accent/80 overflow-hidden bg-black">
          <div
            className="relative grid aspect-video bg-black"
            style={stageGridStyle}
            onTouchStart={onStageTouchStart}
            onTouchEnd={onStageTouchEnd}
          >
            {activeFeeds.map((feedIndex) => {
              const card = cards[feedIndex]
              if (!card) return null
              const unmuted = activeAudioId === card.streamId
              return (
                <div
                  key={`air-${card.streamId}`}
                  className="relative min-h-0 min-w-0 overflow-hidden border border-black/60 bg-black"
                >
                  {card.videoId ? (
                    <CroppedFrame>
                      <iframe
                        key={`air-frame-${card.streamId}-${unmuted ? 'on' : 'off'}`}
                        src={ytEmbedSrc(card.videoId, unmuted)}
                        title={card.title ?? 'Live angle'}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="h-full w-full"
                      />
                    </CroppedFrame>
                  ) : (
                    <div className="grid h-full w-full place-items-center p-3 text-center text-xs text-gray-500">
                      This angle cannot play inside TKO.
                    </div>
                  )}
                  <span className="absolute left-1.5 top-1.5 z-20 rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white">
                    {handleOf(card)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAudioStreamId(unmuted ? null : card.streamId)}
                    title={unmuted ? 'Mute stage audio' : `Hear ${handleOf(card)}`}
                    className={`absolute bottom-1.5 right-1.5 z-20 grid h-8 w-8 place-items-center rounded-full border bg-black/75 ${
                      unmuted ? 'border-accent text-accent' : 'border-white/20 text-white'
                    }`}
                  >
                    {unmuted ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  </button>
                </div>
              )
            })}
            <TkoWatermark />
          </div>
          <div className="p-2 bg-dark-card flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-medium truncate text-sm">{state.name}</h2>
              <p className="text-xs text-gray-500 truncate">
                {activeFeeds.length} of {cards.length} cameras on air
              </p>
            </div>
          </div>
        </div>

        {isDesktop && chatOpen && (
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

        {chatOpen && focusCard && (
          <MergedStreamChat
            cards={cards.map((card) => ({ streamId: card.streamId, handle: handleOf(card) }))}
            featuredStreamId={focusCard.streamId}
          />
        )}
      </div>

      <div
        className={
          isPhone
            ? 'flex gap-2 mt-4 overflow-x-auto snap-x snap-mandatory pb-1'
            : 'grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2 mt-4'
        }
        style={isPhone ? { WebkitOverflowScrolling: 'touch' } : undefined}
        aria-label="Live cameras"
      >
        {cards.map((card, index) => {
          const onAir = activeFeeds.includes(index)
          const selected = selectedFeeds.includes(index)
          return (
            <button
              key={card.streamId}
              type="button"
              title={
                selectedFeeds.length
                  ? `Add or remove ${handleOf(card)}`
                  : `Feature ${handleOf(card)}. Hold to combine cameras.`
              }
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
                    ? setSelectedFeeds((current) => toggleCastSelection(current, index, cards.length))
                    : pickAngle(index)
                }
              }}
              className={`group shrink-0 ${isPhone ? 'w-32 snap-start' : 'w-full'} select-none overflow-hidden rounded-lg border text-left transition ${
                selected
                  ? 'border-accent ring-2 ring-accent'
                  : onAir
                    ? 'border-white/55'
                    : 'border-dark-border hover:border-accent/55'
              }`}
            >
              <div className="aspect-video relative bg-dark">
                {card.videoId ? (
                  <img
                    src={`https://i.ytimg.com/vi/${card.videoId}/mqdefault.jpg`}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full bg-dark" />
                )}
                <span className="absolute left-1 top-1 rounded bg-black/75 px-1 py-0.5 text-[10px] leading-none text-white">
                  {onAir ? 'ON AIR' : `CAM ${index + 1}`}
                </span>
                {selected && (
                  <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-accent text-dark">
                    <Check size={13} strokeWidth={3} />
                  </span>
                )}
              </div>
              <div className="bg-dark-card p-1.5">
                <span className="block truncate text-[11px]">{handleOf(card)}</span>
              </div>
            </button>
          )
        })}
      </div>

      {user && state.groupId && (
        <div className="mt-6 rounded-xl border border-dark-border bg-dark-card p-4">
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">On this stage</p>
          <ul className="space-y-2">
            {cards.map((card) => (
              <li key={`member-${card.streamId}`} className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm text-gray-300">{handleOf(card)}</span>
                {card.userId === user.id ? (
                  <LiveLinkOptOut
                    groupId={state.groupId!}
                    userId={user.id}
                    onLeft={(result) => setLeft(result)}
                  />
                ) : (
                  <Link
                    to={`/profile/${card.userId}`}
                    className="text-xs text-gray-500 hover:text-accent"
                  >
                    Unfollow or block
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {left && (
            <p className="text-xs text-gray-400 mt-3">
              {left.collapsed ? (
                <>
                  Not enough angles remain for a shared stage, so it has been closed.{' '}
                  {left.remainingStreamIds.length === 1 && (
                    <Link
                      to={`/live-stage/new?s=${encodeURIComponent(left.remainingStreamIds[0])}`}
                      className="text-accent hover:underline"
                    >
                      Watch the remaining stream
                    </Link>
                  )}
                </>
              ) : (
                'Your angle is out. The rest of the stage is still running for viewers.'
              )}
            </p>
          )}
        </div>
      )}

      {canEnd && (
        <div className="mt-6 rounded-xl border border-dark-border bg-dark-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Done with this stage?</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Ending saves every angle and the shared live window for a combined highlight.
            </p>
          </div>
          <button
            type="button"
            onClick={endStage}
            disabled={ending}
            className="shrink-0 px-4 py-2 rounded-lg border border-dark-border text-gray-300 hover:text-accent hover:border-accent/50 text-sm disabled:opacity-50"
          >
            {ending ? 'Saving...' : 'End and save session'}
          </button>
        </div>
      )}

      {(ended || state.endedAt) && (
        <p className="mt-6 text-sm text-leaf">
          Session saved. The cameras and shared live window are ready for a combined highlight.
        </p>
      )}

      <div className="mt-6">
        <Link to="/live" className="text-accent hover:underline text-sm">
          Back to all live
        </Link>
      </div>
    </div>
  )
}

export default LiveStage
