import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useWallet } from '@/hooks/useWallet'
import { StreamChat } from '@/components/StreamChat'
import { CroppedFrame, TkoWatermark } from '@/components/CroppedFrame'
import { Avatar } from '@/components/ui'
import { HostAnglePanel } from '@/components/HostAnglePanel'
import { extractYouTubeId, CLEAN_EMBED_PARAMS } from '@/lib/youtubeApi'
import { loadAngles, sendLiveHeartbeat, type LiveAngleRow } from '@/lib/liveAngles'
import { loadTheme } from '@/lib/broadcastTheme'
import { callFn } from '@/lib/backend'
import { loadActiveGoals, loadCreatorStats, goalCurrent, goalPercent } from '@/lib/creatorGoals'
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'

/** A YouTube embed src. Non-primary angles in a grid are muted to avoid echo. */
function embedSrc(videoId: string, muted: boolean): string {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1${muted ? '&mute=1' : ''}&${CLEAN_EMBED_PARAMS}`
}

/** How long a press must be held before it becomes an "add to multi-view". */
const HOLD_MS = 420

/** One playable angle of the show — the host's own stream plus any added ones. */
type Angle = { id: string; label: string; url: string; videoId: string; userId: string | null }

/**
 * LiveControlLayout — a Twitch-style, screen-maximizing shell for a single live
 * stream. Reference: a control-room banner (host facecam oval over a fire/ice
 * split, two team names + scores, a dono-goal bar), a big main stage, a gift-sub
 * leaderboard + colored chat docked on the right, and Gift-A-Sub / Get-Bits CTAs.
 *
 * WHAT'S REAL vs PLACEHOLDER (there is NO new backend here):
 *   • Main stage video ........... REAL — the stream's youtube_url.
 *   • Host facecam oval + name ... REAL — the host's `profiles` row (avatar/username).
 *   • Team names ................. REAL — the host's saved broadcast theme
 *                                  (src/lib/broadcastTheme.ts, keyed by host id),
 *                                  the same names they set on the Broadcast page.
 *   • Chat (role/badge colored) .. REAL — reuses <StreamChat> (badges via badges.ts).
 *   • Get Bits / Gift-A-Sub ...... REAL routing — links to the existing /shop.
 *   • Wallet balance chip ........ REAL — useWallet (tokens).
 *   • Team SCORES ................ PLACEHOLDER — host-editable client state,
 *                                  cached per-stream in localStorage. See TODO:
 *                                  needs a `live_streams.score_a/score_b` (or a
 *                                  `live_scoreboard` table) so viewers see it live.
 *   • Dono goal bar .............. PLACEHOLDER — host-editable client state. TODO:
 *                                  drive `current` from an aggregate of this
 *                                  stream's tips/donations once that's queryable.
 *   • Gift-sub leaderboard ....... PLACEHOLDER — empty-state today. TODO: read a
 *                                  per-stream gifted_subs aggregate when it exists.
 */

/** Placement preset saved on the live_streams row at go-live time. */
export type LayoutPreset = 'auto' | 'host_top_chat_right' | 'host_side_chat_bottom' | 'theater'

type Props = {
  streamId: string
  youtubeUrl: string
  title: string | null
  /** The host's user id — used to load their profile (facecam) + team theme. */
  hostId?: string
  /** Off for direct-URL playback where there's no stored row (no chat/host). */
  enableChat?: boolean
  /** Where the host feed + chat sit. Applied to the watch arrangement. */
  layout?: LayoutPreset
  /** Optional slot rendered top-right of the banner (e.g. a ShareButton). */
  headerRight?: ReactNode
  /** Rendered directly UNDER the gameplay stage (e.g. the Oracle call), not at
   *  the bottom of the page. */
  underStage?: ReactNode
}

/** Whether a preset docks chat to the SIDE (resizable) or BELOW the stage. */
function chatDock(layout: LayoutPreset): 'side' | 'bottom' {
  return layout === 'host_side_chat_bottom' || layout === 'theater' ? 'bottom' : 'side'
}

// The host-editable, not-yet-backed scoreboard. TODO(backend): promote these to
// real columns/table so every viewer sees the same score + goal in realtime.
// Until then they live per-stream in localStorage and only the host's device
// reflects edits — a clean visual placeholder, never fake "live" numbers.
type Scoreboard = {
  scoreA: number
  scoreB: number
  donoCurrent: number
  donoTarget: number
}

const BOARD_KEY = (streamId: string) => `kc_live_board:${streamId}`

const DEFAULT_BOARD: Scoreboard = { scoreA: 0, scoreB: 0, donoCurrent: 0, donoTarget: 200 }

function loadBoard(streamId: string): Scoreboard {
  try {
    const raw = localStorage.getItem(BOARD_KEY(streamId))
    if (!raw) return { ...DEFAULT_BOARD }
    const p = JSON.parse(raw) as Partial<Scoreboard>
    return {
      scoreA: Number.isFinite(p.scoreA) ? Number(p.scoreA) : 0,
      scoreB: Number.isFinite(p.scoreB) ? Number(p.scoreB) : 0,
      donoCurrent: Number.isFinite(p.donoCurrent) ? Number(p.donoCurrent) : 0,
      donoTarget: Number.isFinite(p.donoTarget) && Number(p.donoTarget) > 0 ? Number(p.donoTarget) : 200,
    }
  } catch {
    return { ...DEFAULT_BOARD }
  }
}

function saveBoard(streamId: string, board: Scoreboard): void {
  try { localStorage.setItem(BOARD_KEY(streamId), JSON.stringify(board)) } catch { /* quota */ }
}

type HostProfile = { username: string | null; avatarUrl: string | null }

// ─── inline SVG icons (lucide isn't installed) ─────────────────────────────
function GiftIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
      <path d="M12 8S10.5 4 8 4a2 2 0 1 0 0 4h4zM12 8s1.5-4 4-4a2 2 0 1 1 0 4h-4z" />
    </svg>
  )
}
function GemIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M6 3h12l4 6-10 12L2 9z" />
      <path d="M2 9h20M12 21 8 9l4-6 4 6-4 12" />
    </svg>
  )
}
function CrownIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M2 18h20l-1.5-9-5 4-3.5-7-3.5 7-5-4z" />
    </svg>
  )
}

export function LiveControlLayout({ streamId, youtubeUrl, title, hostId, enableChat = true, layout = 'auto', headerRight, underStage }: Props) {
  const { user } = useAuth()
  const wallet = useWallet()
  const isHost = !!user && !!hostId && user.id === hostId
  const dock = chatDock(layout)

  // ── Viewer-resizable chat rail (side dock only) ────────────────────────────
  // The viewer drags a divider to rebalance the stage vs. chat; the width is
  // remembered per stream for the session. Desktop-only (the rail stacks under
  // the stage on phones), so we gate the inline width on a matchMedia flag.
  const CHATW_KEY = `tko_live_chatw:${streamId}`
  const [chatW, setChatW] = useState<number>(() => {
    try {
      const raw = Number(sessionStorage.getItem(CHATW_KEY))
      return Number.isFinite(raw) && raw >= 260 && raw <= 560 ? raw : 340
    } catch { return 340 }
  })
  const [isWide, setIsWide] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => setIsWide(mq.matches)
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [])
  useEffect(() => {
    try { sessionStorage.setItem(CHATW_KEY, String(chatW)) } catch { /* best-effort */ }
  }, [chatW, CHATW_KEY])

  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const startW = chatW
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      // Chat sits on the RIGHT — dragging left (smaller clientX) widens it.
      const next = Math.min(560, Math.max(260, startW + (startX - ev.clientX)))
      setChatW(next)
    }
    const up = () => {
      try { el.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const videoId = extractYouTubeId(youtubeUrl)

  // Team names come straight from the host's saved broadcast theme — the SAME
  // names they type on /broadcast. Real, reused data (no new backend).
  const theme = useMemo(() => loadTheme(hostId || 'default'), [hostId])
  const teamA = theme.teamA || 'Team A'
  const teamB = theme.teamB || 'Team B'
  const accent = theme.accent

  // Host facecam + name from the host's profile row (real data).
  const [host, setHost] = useState<HostProfile | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!hostId) { setHost(null); return }
    supabase
      .from('profiles')
      .select('username, avatar_url')
      .eq('id', hostId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setHost(data ? { username: data.username ?? null, avatarUrl: data.avatar_url ?? null } : null)
      })
    return () => { cancelled = true }
  }, [hostId])

  // PLACEHOLDER scoreboard — host-editable, per-stream localStorage. See notes above.
  const [board, setBoard] = useState<Scoreboard>(() => loadBoard(streamId))
  useEffect(() => { setBoard(loadBoard(streamId)) }, [streamId])
  const patchBoard = (patch: Partial<Scoreboard>) => {
    setBoard((prev) => {
      const next = { ...prev, ...patch }
      next.scoreA = Math.max(0, next.scoreA)
      next.scoreB = Math.max(0, next.scoreB)
      next.donoCurrent = Math.max(0, next.donoCurrent)
      next.donoTarget = Math.max(1, next.donoTarget)
      saveBoard(streamId, next)
      return next
    })
  }

  const donoPct = Math.min(100, Math.round((board.donoCurrent / board.donoTarget) * 100))
  const hostName = host?.username || theme.hostName || 'Host'

  // ── REAL creator GOAL for the live banner ──────────────────────────────────
  // When the HOST views their OWN stream, surface their active goal (created in
  // the Creator Dashboard) with REAL current/target, replacing the localStorage
  // placeholder. Prefers a donations goal, then followers, then sub points — the
  // ones a live audience can move right now. Falls back to the placeholder when
  // no goal is set. Only the host (viewing their own stream) can read their own
  // paid-gated creator-stats, so this stays quiet for viewers.
  const [liveGoal, setLiveGoal] = useState<{ label: string; current: number | null; target: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!isHost || !hostId) { setLiveGoal(null); return }
    async function load() {
      const [goals, stats] = await Promise.all([loadActiveGoals(hostId as string), loadCreatorStats()])
      if (cancelled) return
      const pick = goals.find((g) => g.kind === 'donations')
        ?? goals.find((g) => g.kind === 'followers')
        ?? goals.find((g) => g.kind === 'sub_points')
        ?? goals[0]
      setLiveGoal(pick ? { label: pick.label, current: goalCurrent(pick.kind, stats), target: pick.target } : null)
    }
    void load()
    return () => { cancelled = true }
  }, [isHost, hostId])
  const liveGoalPct = liveGoal ? goalPercent(liveGoal.current, liveGoal.target) : 0

  // ── HOST-CURATED ANGLES ────────────────────────────────────────────────────
  // The host's own stream is angle 1; any players the host added are further
  // angles. Viewers switch between them (AUTO / tap / tap-hold). Direct-URL
  // playback (no stored row) has no angles.
  const [angleRows, setAngleRows] = useState<LiveAngleRow[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    if (streamId === 'direct') { setAngleRows([]); return }
    loadAngles(streamId).then((rows) => { if (!cancelled) setAngleRows(rows) })
    return () => { cancelled = true }
  }, [streamId, reloadKey])

  // Heartbeat while the host watches their own live, so the stale-live TTL never
  // expires a genuinely-active broadcast (which would block them going live).
  // The server treats a stream with no heartbeat in ~60s as dead, so we ping well
  // inside that window (every 20s) — a couple of dropped beats never kills a real
  // broadcast, but LEAVING this page stops the pings and the session drops in ~1m.
  useEffect(() => {
    if (!isHost || streamId === 'direct') return
    void sendLiveHeartbeat(streamId)
    const timer = window.setInterval(() => { void sendLiveHeartbeat(streamId) }, 20_000)
    return () => window.clearInterval(timer)
  }, [isHost, streamId])

  const angles: Angle[] = [
    { id: 'host', label: hostName, url: youtubeUrl, videoId: videoId ?? '', userId: hostId ?? null },
    ...angleRows.map((r) => ({
      id: r.id,
      label: r.label || 'Angle',
      url: r.youtube_url ?? '',
      videoId: extractYouTubeId(r.youtube_url ?? '') ?? '',
      userId: r.user_id,
    })),
  ]
  const multiAngle = angles.length > 1

  // AUTO (default) shows the primary/host angle with an "AUTO" indicator; a tap
  // switches to that single angle; a tap-and-hold adds it to a simultaneous grid.
  const [viewMode, setViewMode] = useState<'auto' | 'single' | 'multi'>('auto')
  const [singleIndex, setSingleIndex] = useState(0)
  const [multiIndexes, setMultiIndexes] = useState<number[]>([])
  const holdTimer = useRef<number | null>(null)
  const holdFired = useRef(false)

  const clampedSingle = Math.max(0, Math.min(singleIndex, angles.length - 1))
  const activeFeeds: number[] =
    viewMode === 'single'
      ? [clampedSingle]
      : viewMode === 'multi'
        ? (multiIndexes.filter((i) => i < angles.length).length ? multiIndexes.filter((i) => i < angles.length) : [0])
        : [0]

  function beginPress(index: number) {
    holdFired.current = false
    if (holdTimer.current != null) window.clearTimeout(holdTimer.current)
    holdTimer.current = window.setTimeout(() => {
      holdFired.current = true
      setViewMode('multi')
      setMultiIndexes((current) => {
        const base = current.length ? current : [0]
        return base.includes(index) ? base : [...base, index].sort((a, b) => a - b)
      })
    }, HOLD_MS)
  }
  function endPress(index: number) {
    if (holdTimer.current != null) { window.clearTimeout(holdTimer.current); holdTimer.current = null }
    if (holdFired.current) { holdFired.current = false; return }
    setViewMode('single')
    setSingleIndex(index)
  }
  function cancelPress() {
    if (holdTimer.current != null) { window.clearTimeout(holdTimer.current); holdTimer.current = null }
  }
  function backToAuto() {
    setViewMode('auto')
    setMultiIndexes([])
  }

  function renderFeed(angle: Angle | undefined, muted: boolean) {
    if (!angle) return null
    if (!angle.videoId) {
      return (
        <div className="w-full h-full flex items-center justify-center text-center p-4">
          <div>
            <p className="text-gray-300 mb-2 text-sm">This angle isn't a YouTube link, so it can't play inside TKO.</p>
            <a href={angle.url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg bg-accent text-dark text-sm font-semibold">Open stream ↗</a>
          </div>
        </div>
      )
    }
    return (
      <CroppedFrame>
        <iframe
          key={`${angle.id}-${muted ? 'm' : 'u'}`}
          src={embedSrc(angle.videoId, muted)}
          title={angle.label}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full h-full"
        />
      </CroppedFrame>
    )
  }

  const gridCols = activeFeeds.length >= 3 ? Math.ceil(Math.sqrt(activeFeeds.length)) : activeFeeds.length
  const primaryFeed = angles[activeFeeds[0]] ?? angles[0]

  return (
    <div className="w-full">
      {/* ── TOP BANNER: fire/ice split, host facecam oval, team-vs-team scores ── */}
      <div className="relative rounded-2xl overflow-hidden border border-dark-border">
        {/* fire (left) → ice (right) split. Inline gradient — not a Tailwind color. */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(90deg, #7a1500 0%, #c2410c 30%, #171326 50%, #0e7490 70%, #052e45 100%)' }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-black/35" aria-hidden />

        <div className="relative px-3 sm:px-6 py-4 sm:py-5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/50 text-[11px] font-bold text-white uppercase tracking-wider">
              <span className="inline-block w-2 h-2 rounded-full bg-kunai animate-pulse" /> Live
            </span>
            {headerRight}
          </div>

          {/* Team A ── score ── (facecam) ── score ── Team B */}
          <div className="flex items-center justify-center gap-2 sm:gap-5">
            {/* Team A */}
            <div className="flex-1 min-w-0 text-right">
              <p className="font-black text-white text-sm sm:text-2xl uppercase tracking-wide truncate drop-shadow">{teamA}</p>
              <div className="mt-1 flex items-center justify-end gap-1.5">
                <ScoreValue value={board.scoreA} />
                {isHost && <Stepper onDec={() => patchBoard({ scoreA: board.scoreA - 1 })} onInc={() => patchBoard({ scoreA: board.scoreA + 1 })} />}
              </div>
            </div>

            {/* Host facecam oval (centered over the split) */}
            <div className="shrink-0 flex flex-col items-center gap-1">
              <div
                className="w-16 h-20 sm:w-24 sm:h-28 rounded-full overflow-hidden ring-2 ring-white/80 shadow-lg flex items-center justify-center bg-dark"
                style={{ boxShadow: `0 0 0 2px ${accent}` }}
              >
                {host?.avatarUrl ? (
                  <img src={host.avatarUrl} alt={hostName} className="w-full h-full object-cover" />
                ) : (
                  <Avatar src={host?.avatarUrl ?? null} name={hostName} seed={hostId || streamId} size={72} />
                )}
              </div>
              <span className="px-2 py-0.5 rounded-full bg-black/55 text-[10px] sm:text-xs font-semibold text-white max-w-[7rem] truncate">
                {hostName}
              </span>
            </div>

            {/* Team B */}
            <div className="flex-1 min-w-0 text-left">
              <p className="font-black text-white text-sm sm:text-2xl uppercase tracking-wide truncate drop-shadow">{teamB}</p>
              <div className="mt-1 flex items-center justify-start gap-1.5">
                {isHost && <Stepper onDec={() => patchBoard({ scoreB: board.scoreB - 1 })} onInc={() => patchBoard({ scoreB: board.scoreB + 1 })} />}
                <ScoreValue value={board.scoreB} />
              </div>
            </div>
          </div>

          {title && (
            <p className="mt-3 text-center text-xs sm:text-sm text-white/85 truncate">{title}</p>
          )}
        </div>
      </div>

      {/* ── GOAL bar ──────────────────────────────────────────────────────────
          When the host has a REAL creator goal (from the Creator Dashboard) we
          show it with live current/target. Otherwise we fall back to the
          host-only localStorage placeholder. */}
      {liveGoal ? (
        <div className="mt-3 rounded-xl border border-dark-border bg-dark-card px-3 sm:px-4 py-2.5">
          <div className="flex items-center justify-between text-xs sm:text-sm mb-1.5">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <GiftIcon className="w-4 h-4 text-accent" /> {liveGoal.label}
            </span>
            <span className="tabular-nums text-gray-300">
              {liveGoal.current != null ? liveGoal.current.toLocaleString() : '—'}
              <span className="text-gray-500">/{liveGoal.target.toLocaleString()}</span>
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-dark overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${liveGoalPct}%`, background: accent }} />
          </div>
          {isHost && (
            <div className="mt-2 text-xs text-gray-600">
              Live from your <Link to="/creator" className="text-accent hover:underline">Creator Dashboard</Link> goals
              {liveGoal.current != null && liveGoal.current >= liveGoal.target ? ' · reached! 🎉' : ''}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-dark-border bg-dark-card px-3 sm:px-4 py-2.5">
          <div className="flex items-center justify-between text-xs sm:text-sm mb-1.5">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <GiftIcon className="w-4 h-4 text-accent" /> Dono Goal
            </span>
            <span className="tabular-nums text-gray-300">
              {board.donoCurrent}
              <span className="text-gray-500">/{board.donoTarget}</span>
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-dark overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${donoPct}%`, background: accent }} />
          </div>
          {isHost && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <button type="button" onClick={() => patchBoard({ donoCurrent: board.donoCurrent + 5 })} className="px-2 py-1 rounded border border-dark-border text-gray-300 hover:text-accent hover:border-accent/50">+5 raised</button>
              <label className="flex items-center gap-1 text-gray-400">
                Goal
                <input
                  type="number"
                  min={1}
                  value={board.donoTarget}
                  onChange={(e) => patchBoard({ donoTarget: Number(e.target.value) })}
                  className="w-20 px-2 py-1 rounded bg-dark border border-dark-border text-white"
                />
              </label>
              <Link to="/creator" className="text-gray-500 hover:text-accent">Set a real goal →</Link>
            </div>
          )}
        </div>
      )}

      {/* ── MAIN STAGE + CHAT RAIL ───────────────────────────────────────────
          Placement follows the stored layout preset: 'auto'/'host_top_chat_right'
          dock chat to the SIDE (viewer-resizable divider); 'host_side_chat_bottom'
          and 'theater' stack chat BELOW a full-width stage. */}
      <div className={`mt-3 flex gap-3 items-start ${dock === 'side' ? 'flex-col lg:flex-row' : 'flex-col'}`}>
        <div className="min-w-0 w-full lg:flex-1">
          {/* Big stage — a single angle fills the column; a multi-view splits it
              into a grid. When there's only the host's stream this is exactly the
              original single-stage layout. */}
          <div className="relative rounded-xl border border-dark-border overflow-hidden bg-black">
            {activeFeeds.length <= 1 ? (
              <div className="aspect-video">
                {renderFeed(primaryFeed, false)}
              </div>
            ) : (
              <div
                className="grid aspect-video"
                style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
              >
                {activeFeeds.map((feedIndex, k) => (
                  <div key={angles[feedIndex]?.id ?? feedIndex} className="relative min-h-0 min-w-0 border border-black/60 bg-black">
                    {renderFeed(angles[feedIndex], k !== 0)}
                    <span className="absolute left-1.5 top-1.5 z-20 rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white">
                      {angles[feedIndex]?.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {activeFeeds.length <= 1 && primaryFeed?.videoId && <TkoWatermark />}
            {viewMode === 'auto' && multiAngle && (
              <span className="absolute left-2 top-2 z-20 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" /> Auto
              </span>
            )}
          </div>

          {/* Oracle (or any under-stage slot) sits directly beneath the gameplay
              action screen — not at the bottom of the page. */}
          {underStage && <div className="mt-3">{underStage}</div>}

          {/* ── ANGLE SWITCHER (only when there's more than the host's stream) ── */}
          {multiAngle && (
            <>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-dark-border bg-dark-card px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={backToAuto}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold ${
                      viewMode === 'auto'
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-dark-border text-gray-300 hover:border-accent/60 hover:text-white'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current" /> Auto
                  </button>
                  <span className="text-xs text-gray-400 truncate">
                    {viewMode === 'auto'
                      ? `Auto — following ${angles[0].label}`
                      : viewMode === 'multi'
                        ? `${activeFeeds.length} angles side by side`
                        : `Watching ${angles[clampedSingle].label}`}
                  </span>
                </div>
                {viewMode !== 'auto' && (
                  <button type="button" onClick={backToAuto} className="shrink-0 text-xs text-gray-400 hover:text-accent">
                    Reset
                  </button>
                )}
              </div>
              <p className="mt-2 text-[11px] text-gray-500">
                Tap an angle to watch it full-size. Press and hold to add it into a multi-view grid.
              </p>
              <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2" aria-label="Live angles">
                {angles.map((angle, index) => {
                  const onAir = activeFeeds.includes(index)
                  const inMulti = viewMode === 'multi' && multiIndexes.includes(index)
                  return (
                    <button
                      key={angle.id}
                      type="button"
                      onPointerDown={(e) => { if (e.button === 0) beginPress(index) }}
                      onPointerUp={(e) => { if (e.button === 0) endPress(index) }}
                      onPointerLeave={cancelPress}
                      onPointerCancel={cancelPress}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewMode('single'); setSingleIndex(index) }
                      }}
                      title={`${angle.label} — tap to watch, hold to combine`}
                      className={`group select-none overflow-hidden rounded-lg border text-left transition ${
                        onAir ? 'border-accent ring-1 ring-accent' : 'border-dark-border hover:border-accent/55'
                      }`}
                    >
                      <div className="aspect-video relative bg-dark">
                        {angle.videoId ? (
                          <img
                            src={`https://i.ytimg.com/vi/${angle.videoId}/mqdefault.jpg`}
                            alt=""
                            loading="lazy"
                            draggable={false}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full grid place-items-center text-[10px] text-gray-500">external</div>
                        )}
                        <span className="absolute left-1 top-1 rounded bg-black/75 px-1 py-0.5 text-[10px] leading-none text-white">
                          {index === 0 ? 'HOST' : onAir ? 'ON AIR' : `CAM ${index + 1}`}
                        </span>
                        {inMulti && (
                          <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-accent text-dark text-[10px] font-bold">✓</span>
                        )}
                      </div>
                      <div className="bg-dark-card p-1">
                        <span className="block truncate text-[11px] text-gray-300">{angle.label}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {/* Action CTAs — real routing into the existing shop. Store builds
              must not expose digital purchases, balances, or shop links. */}
          {!IS_MOBILE_STORE_BUILD && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                to="/shop"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow"
              >
                <GiftIcon className="w-4 h-4" /> Gift A Sub
              </Link>
              <Link
                to="/shop"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-accent text-accent font-semibold hover:bg-accent/10"
              >
                <GemIcon className="w-4 h-4" /> Get Bits
              </Link>
              {user && (
                <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-card border border-dark-border text-sm text-gray-300">
                  <GemIcon className="w-4 h-4 text-accent" />
                  <span className="tabular-nums font-semibold text-white">{wallet.tokens}</span>
                  <span className="text-gray-500">bits</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Viewer-drag divider (side dock, desktop only) — rebalances stage/chat. */}
        {dock === 'side' && enableChat && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat"
            onPointerDown={startResize}
            className="hidden lg:block self-stretch w-1.5 shrink-0 cursor-col-resize rounded bg-dark-border hover:bg-accent/60 active:bg-accent transition-colors"
            title="Drag to resize chat"
          />
        )}

        {/* Chat rail: the host's angle controls (host only), gift-sub leaderboard,
            the in-stream purchase panel, then live chat. On mobile it stacks under
            the stage; on desktop (side dock) its width is viewer-adjustable. */}
        <div
          className={`w-full space-y-3 ${dock === 'side' ? 'lg:shrink-0' : ''}`}
          style={dock === 'side' && isWide ? { width: chatW } : undefined}
        >
          {isHost && enableChat && streamId !== 'direct' && (
            <HostAnglePanel liveStreamId={streamId} onChanged={() => setReloadKey((k) => k + 1)} />
          )}
          {!IS_MOBILE_STORE_BUILD && <GiftSubLeaderboard accent={accent} />}
          {!IS_MOBILE_STORE_BUILD && enableChat && streamId !== 'direct' && user && (
            <InStreamPurchasePanel streamId={streamId} tokens={wallet.tokens} onSpent={() => void wallet.refresh()} />
          )}
          {enableChat ? (
            <StreamChat streamId={streamId} title={title} />
          ) : (
            <div className="rounded-xl border border-dark-border bg-dark-card p-4 text-center text-xs text-gray-500">
              Open this stream from its TKO page to join the chat.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * InStreamPurchasePanel — spend without leaving the stream.
 *
 *  • "Highlight my comment" spends utility Tokens (bits) through the trusted,
 *    server-side `highlight-message` fn (callFn). The debit + the pinned row are
 *    both written server-side (atomic spendTokens); the client NEVER changes a
 *    balance — it just reflects the returned wallet and refreshes.
 *  • "Get sweeps" opens the top-up IN PLACE (a modal), not a navigation. Real
 *    sweeps purchase depends on Stripe (not configured yet) — see the TODO.
 */
function InStreamPurchasePanel({
  streamId,
  tokens,
  onSpent,
}: {
  streamId: string
  tokens: number
  onSpent: () => void
}) {
  const HIGHLIGHT_COST = 50
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [storeOpen, setStoreOpen] = useState(false)

  async function highlight(e: React.FormEvent) {
    e.preventDefault()
    const body = text.trim().slice(0, 300)
    if (!body || busy) return
    setBusy(true)
    setNote(null)
    try {
      const res = await callFn<{ ok: boolean; reason?: string }>('highlight-message', {
        streamId,
        content: body,
      })
      if (res?.ok) {
        setText('')
        setNote('Highlighted! Your line is pinned in chat.')
        onSpent()
      } else if (res?.reason === 'insufficient') {
        setNote(`Not enough bits — you need ${HIGHLIGHT_COST}.`)
      } else {
        setNote('Could not highlight right now.')
      }
    } catch {
      setNote('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
      <div className="px-3 py-2 border-b border-dark-border flex items-center gap-1.5 text-xs uppercase tracking-wider text-gray-400">
        <GemIcon className="w-4 h-4 text-accent" />
        <span>Support the stream</span>
        <span className="ml-auto inline-flex items-center gap-1 tabular-nums text-gray-300">
          <span className="font-semibold text-white">{tokens}</span> bits
        </span>
      </div>
      <form onSubmit={highlight} className="p-3 space-y-2">
        <label className="block text-[11px] text-gray-400">Highlight my comment</label>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="Say it loud…"
          className="w-full px-3 py-1.5 rounded-lg bg-dark border border-dark-border text-white text-sm"
        />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={!text.trim() || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-dark text-sm font-semibold disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden><path d="m12 2 3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" /></svg>
            Highlight · {HIGHLIGHT_COST}
          </button>
          <button
            type="button"
            onClick={() => setStoreOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent text-accent text-sm font-semibold hover:bg-accent/10"
          >
            <GemIcon className="w-4 h-4" /> Get sweeps
          </button>
        </div>
        {note && <p className="text-[11px] text-gray-400">{note}</p>}
      </form>

      {/* Get-sweeps top-up, opened IN PLACE (modal) so the viewer never leaves the
          stream. TODO(stripe): wire real-money sweeps checkout here once Stripe is
          configured; for now this surfaces the store route + the daily free path. */}
      {storeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70" onClick={() => setStoreOpen(false)} aria-hidden />
          <div className="relative w-full max-w-sm rounded-2xl border border-dark-border bg-dark-card p-5 shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <GemIcon className="w-5 h-5 text-accent" />
              <h3 className="font-bold text-white">Get sweeps</h3>
              <button type="button" onClick={() => setStoreOpen(false)} className="ml-auto text-gray-400 hover:text-white" aria-label="Close">✕</button>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              Top up without leaving the stream. Real-money sweeps checkout is coming
              soon — for now, grab your free daily sweeps or browse the store.
            </p>
            <div className="flex flex-col gap-2">
              <Link
                to="/store"
                onClick={() => setStoreOpen(false)}
                className="w-full text-center px-4 py-2 rounded-lg bg-accent text-dark font-semibold"
              >
                Open the store
              </Link>
              <button
                type="button"
                onClick={() => setStoreOpen(false)}
                className="w-full px-4 py-2 rounded-lg border border-dark-border text-gray-300 hover:text-white text-sm"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Big score number in the banner. */
function ScoreValue({ value }: { value: number }) {
  return (
    <span className="inline-block min-w-[1.5ch] text-center tabular-nums font-black text-white text-xl sm:text-4xl leading-none drop-shadow">
      {value}
    </span>
  )
}

/** Host-only score stepper (− / +). */
function Stepper({ onDec, onInc }: { onDec: () => void; onInc: () => void }) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <button type="button" onClick={onInc} className="w-5 h-5 flex items-center justify-center rounded bg-black/50 text-white text-xs leading-none hover:bg-black/70" aria-label="Increase score">+</button>
      <button type="button" onClick={onDec} className="w-5 h-5 flex items-center justify-center rounded bg-black/50 text-white text-xs leading-none hover:bg-black/70" aria-label="Decrease score">−</button>
    </span>
  )
}

/**
 * GiftSubLeaderboard — top-3 gift-sub givers.
 *
 * PLACEHOLDER: there is no per-stream gifted-subs aggregate the client can read
 * today, so this shows a clean empty state. TODO(backend): populate from a
 * `gifted_subs` (or artifacts) aggregate grouped by giver for this stream.
 */
function GiftSubLeaderboard({ accent }: { accent: string }) {
  const rows: { name: string; count: number }[] = [] // TODO: real top-3 gifters
  const podium = ['text-yellow-300', 'text-slate-200', 'text-amber-500']
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
      <div className="px-3 py-2 border-b border-dark-border flex items-center gap-1.5 text-xs uppercase tracking-wider text-gray-400">
        <CrownIcon className="w-4 h-4 text-yellow-300" />
        <span>Top Gifters</span>
      </div>
      <div className="p-3 space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-3">
            No gifted subs yet — be the first.{' '}
            <Link to="/shop" className="text-accent hover:underline">Gift a sub</Link>
          </p>
        ) : (
          rows.slice(0, 3).map((r, i) => (
            <div key={r.name} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <CrownIcon className={`w-4 h-4 ${podium[i] ?? 'text-gray-500'}`} />
                <span className="truncate text-sm text-white">{r.name}</span>
              </span>
              <span className="tabular-nums text-sm font-semibold" style={{ color: accent }}>{r.count}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default LiveControlLayout
