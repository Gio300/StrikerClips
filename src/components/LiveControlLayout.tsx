import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ImagePlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useWallet } from '@/hooks/useWallet'
import { StreamChat } from '@/components/StreamChat'
import { CroppedFrame, TkoWatermark } from '@/components/CroppedFrame'
import { LeagueWatermark } from '@/components/LeagueWatermark'
import { Avatar } from '@/components/ui'
import { PlayerMetaLine } from '@/components/PlayerMetaLine'
import { HostAnglePanel } from '@/components/HostAnglePanel'
import { LiveBannerEditor } from '@/components/LiveBannerEditor'
import { extractYouTubeId, CLEAN_EMBED_PARAMS } from '@/lib/youtubeApi'
import {
  loadAngles,
  refreshLiveAngles,
  sendLiveHeartbeat,
  setHostView,
  updateLiveScoreboard,
  type HostView,
  type LiveAngleRow,
  type LiveScoreboard,
} from '@/lib/liveAngles'
import { loadTheme, adoptLeagueKit } from '@/lib/broadcastTheme'
import { fetchMemberLeague, type LeagueConfig } from '@/lib/leagueConfig'
import { callFn } from '@/lib/backend'
import { loadActiveGoals, loadCreatorStats, goalCurrent, goalPercent } from '@/lib/creatorGoals'
import { normalizeLiveBannerUrl } from '@/lib/liveBanner'
import { nextMultiSelection } from '@/lib/liveViewSelection'
import type { ArtifactRarity } from '@/types/database'
import { DIGITAL_CHECKOUT_ENABLED } from '@/lib/storeBuild'

/**
 * A YouTube embed src for the PERSISTENT PLAYER POOL: always muted at the URL
 * level and jsapi-enabled — audio is driven per-player via postMessage, never
 * by URL flags. Changing the URL re-mounts the iframe, and a re-mount is what
 * flashes YouTube's center chrome mid-show; the pool mounts each angle ONCE
 * and every camera switch is pure CSS.
 */
function embedSrc(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&enablejsapi=1&${CLEAN_EMBED_PARAMS}`
}

/** Off-stage pool slot: invisible but still mounted and playing. */
const HIDDEN_SLOT: React.CSSProperties = {
  left: 0, top: 0, width: '100%', height: '100%', opacity: 0, pointerEvents: 'none', zIndex: 0,
}

/** Geometry for the feed at position `at` of `count` on-stage feeds. */
function slotStyle(at: number, count: number, pip: boolean): React.CSSProperties {
  if (count <= 1) return { left: 0, top: 0, width: '100%', height: '100%', zIndex: 1 }
  if (pip) {
    if (at === 0) return { left: 0, top: 0, width: '100%', height: '100%', zIndex: 1 }
    return {
      right: `calc(0.5rem + ${(at - 1) * 28}%)`,
      bottom: '0.5rem',
      width: '26%',
      aspectRatio: '16 / 9',
      zIndex: 3,
    }
  }
  if (count === 2) return { left: `${at * 50}%`, top: 0, width: '50%', height: '100%', zIndex: 1 }
  return { left: `${(at % 2) * 50}%`, top: `${Math.floor(at / 2) * 50}%`, width: '50%', height: '50%', zIndex: 1 }
}

/** How long a press must be held before it becomes an "add to multi-view". */
const HOLD_MS = 650
const HOLD_MOVE_TOLERANCE = 12

/** One playable angle of the show — the host's own stream plus any added ones. */
type Angle = {
  id: string
  label: string
  url: string
  videoId: string
  userId: string | null
  profile: CompactPlayerProfile | null
  /** 'live' | 'stopped' | 'reconnecting' — a non-live slot is reserved, not gone. */
  status: 'live' | 'stopped' | 'reconnecting'
}

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
  backgroundUrl?: string | null
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

function LiveSection({
  title,
  description,
  defaultOpen = true,
  storageKey,
  children,
}: {
  title: string
  description?: string
  defaultOpen?: boolean
  storageKey: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      return saved == null ? defaultOpen : saved === '1'
    } catch {
      return defaultOpen
    }
  })

  function toggle() {
    setOpen((current) => {
      const next = !current
      try { sessionStorage.setItem(storageKey, next ? '1' : '0') } catch { /* best-effort */ }
      return next
    })
  }

  return (
    <section className="overflow-hidden rounded-xl border border-dark-border bg-dark-card">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.03]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-white">{title}</span>
          {description && <span className="block truncate text-xs text-gray-500">{description}</span>}
        </span>
        <span className="text-[11px] font-semibold text-gray-500">{open ? 'Hide' : 'Show'}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden />
      </button>
      <div hidden={!open} className="border-t border-dark-border p-3">
        {children}
      </div>
    </section>
  )
}

/** Whether a preset docks chat to the SIDE (resizable) or BELOW the stage. */
function chatDock(layout: LayoutPreset): 'side' | 'bottom' {
  return layout === 'host_side_chat_bottom' || layout === 'theater' ? 'bottom' : 'side'
}

// The host-editable, not-yet-backed scoreboard. TODO(backend): promote these to
// real columns/table so every viewer sees the same score + goal in realtime.
// Until then they live per-stream in localStorage and only the host's device
// reflects edits — a clean visual placeholder, never fake "live" numbers.
type GoalBoard = {
  donoCurrent: number
  donoTarget: number
}

const BOARD_KEY = (streamId: string) => `kc_live_board:${streamId}`

const DEFAULT_BOARD: GoalBoard = { donoCurrent: 0, donoTarget: 200 }

function loadBoard(streamId: string): GoalBoard {
  try {
    const raw = localStorage.getItem(BOARD_KEY(streamId))
    if (!raw) return { ...DEFAULT_BOARD }
    const p = JSON.parse(raw) as Partial<GoalBoard>
    return {
      donoCurrent: Number.isFinite(p.donoCurrent) ? Number(p.donoCurrent) : 0,
      donoTarget: Number.isFinite(p.donoTarget) && Number(p.donoTarget) > 0 ? Number(p.donoTarget) : 200,
    }
  } catch {
    return { ...DEFAULT_BOARD }
  }
}

function saveBoard(streamId: string, board: GoalBoard): void {
  try { localStorage.setItem(BOARD_KEY(streamId), JSON.stringify(board)) } catch { /* quota */ }
}

type CompactPlayerProfile = {
  username: string | null
  avatarUrl: string | null
  powerLevel: number | null
  title: string | null
  titleRarity: ArtifactRarity | null
}

function compactProfile(row: {
  username?: string | null
  avatar_url?: string | null
  power_level?: number | null
  equipped_tag_text?: string | null
  equipped_tag_rarity?: ArtifactRarity | null
}): CompactPlayerProfile {
  return {
    username: row.username ?? null,
    avatarUrl: row.avatar_url ?? null,
    powerLevel: typeof row.power_level === 'number' ? row.power_level : null,
    title: row.equipped_tag_text ?? null,
    titleRarity: row.equipped_tag_rarity ?? null,
  }
}

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

export function LiveControlLayout({ streamId, youtubeUrl, title, backgroundUrl, hostId, enableChat = true, layout = 'auto', headerRight, underStage }: Props) {
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

  // The route supplies the initial host URL, but auto-live discovery can replace
  // it after this screen is already open. Keep angle 1 synchronized with the
  // stored show instead of binding it permanently to the first render.
  const [currentHostUrl, setCurrentHostUrl] = useState(youtubeUrl)
  const [hostPlayerVersion, setHostPlayerVersion] = useState(0)
  const [stageAudioOn, setStageAudioOn] = useState(false)
  useEffect(() => { setCurrentHostUrl(youtubeUrl) }, [streamId, youtubeUrl])
  const videoId = extractYouTubeId(currentHostUrl)

  // Team names come straight from the host's saved broadcast theme — the SAME
  // names they type on /broadcast. Real, reused data (no new backend).
  // League kit adoption: when the HOST belongs to a white-label league, the
  // overlay defaults its accent + banner logo from the league config (explicit
  // host theme edits still win — see adoptLeagueKit). Fail-soft: null league
  // keeps the stock look, and teams/scores are untouched.
  const [hostLeague, setHostLeague] = useState<LeagueConfig | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!hostId) { setHostLeague(null); return }
    fetchMemberLeague(hostId)
      .then((league) => { if (!cancelled) setHostLeague(league) })
      .catch(() => { /* fail-soft — keep the stock look */ })
    return () => { cancelled = true }
  }, [hostId])
  const theme = useMemo(
    () => adoptLeagueKit(loadTheme(hostId || 'default'), hostLeague),
    [hostId, hostLeague],
  )
  const initialTeamA = theme.teamA || 'Team A'
  const initialTeamB = theme.teamB || 'Team B'
  const accent = theme.accent

  // Host facecam + name from the host's profile row (real data).
  const [host, setHost] = useState<CompactPlayerProfile | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!hostId) { setHost(null); return }
    supabase
      .from('profiles')
      .select('username, avatar_url, power_level, equipped_tag_text, equipped_tag_rarity')
      .eq('id', hostId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setHost(data ? compactProfile(data) : null)
      })
    return () => { cancelled = true }
  }, [hostId])

  // PLACEHOLDER scoreboard — host-editable, per-stream localStorage. See notes above.
  const [scoreboard, setScoreboard] = useState<LiveScoreboard>({
    team_a: initialTeamA,
    team_b: initialTeamB,
    score_a: 0,
    score_b: 0,
    score_revision: 0,
  })
  const [teamEditorOpen, setTeamEditorOpen] = useState(false)
  const [teamADraft, setTeamADraft] = useState(initialTeamA)
  const [teamBDraft, setTeamBDraft] = useState(initialTeamB)
  const [scoreboardBusy, setScoreboardBusy] = useState(false)
  const [scoreboardError, setScoreboardError] = useState('')
  const [liveBackgroundUrl, setLiveBackgroundUrl] = useState(() => normalizeLiveBannerUrl(backgroundUrl) ?? '')
  const [bannerSaveError, setBannerSaveError] = useState('')
  useEffect(() => {
    setLiveBackgroundUrl(normalizeLiveBannerUrl(backgroundUrl) ?? '')
    setBannerSaveError('')
  }, [streamId, backgroundUrl])

  async function saveLiveBanner(nextValue: string) {
    if (!isHost || streamId === 'direct') throw new Error('Only the live host can change this banner.')
    const clean = nextValue.trim()
    const normalized = clean ? normalizeLiveBannerUrl(clean) : null
    if (clean && !normalized) throw new Error('Choose a secure image or a smaller banner.')
    setBannerSaveError('')
    const { error } = await supabase
      .from('live_streams')
      .update({ background_url: normalized })
      .eq('id', streamId)
    if (error) {
      setBannerSaveError(error.message)
      throw new Error(error.message)
    }
    setLiveBackgroundUrl(normalized ?? '')
  }
  const [board, setBoard] = useState<GoalBoard>(() => loadBoard(streamId))
  useEffect(() => { setBoard(loadBoard(streamId)) }, [streamId])
  const patchBoard = (patch: Partial<GoalBoard>) => {
    setBoard((prev) => {
      const next = { ...prev, ...patch }
      next.donoCurrent = Math.max(0, next.donoCurrent)
      next.donoTarget = Math.max(1, next.donoTarget)
      saveBoard(streamId, next)
      return next
    })
  }

  function openTeamEditor() {
    if (!isHost || streamId === 'direct') return
    setTeamADraft(scoreboard.team_a)
    setTeamBDraft(scoreboard.team_b)
    setScoreboardError('')
    setTeamEditorOpen(true)
  }

  // "+" quick editor on the scorebug (host only): banner upload + teams data.
  const [quickEditOpen, setQuickEditOpen] = useState(false)

  // Scorebug collapse (viewer-local): expanded = the small banner strip on the
  // video; collapsed = a one-line micro bar so the score stays glanceable.
  const BUG_KEY = `tko_live_bug:${streamId}`
  const [bugOpen, setBugOpen] = useState(() => {
    try { return sessionStorage.getItem(BUG_KEY) !== '0' } catch { return true }
  })
  function toggleBug() {
    setBugOpen((open) => {
      const next = !open
      try { sessionStorage.setItem(BUG_KEY, next ? '1' : '0') } catch { /* best-effort */ }
      return next
    })
  }

  // HOST-ONLY score control: optimistic bump, server write, poll self-heals.
  // Viewers never get the steppers — their scorebug is read-only.
  async function bumpScore(side: 'a' | 'b', delta: number) {
    if (!isHost || streamId === 'direct') return
    const key = side === 'a' ? 'score_a' : 'score_b'
    const next = Math.max(0, Math.min(999, scoreboard[key] + delta))
    setScoreboard((prev) => ({ ...prev, [key]: next }))
    const result = await updateLiveScoreboard({
      liveStreamId: streamId,
      ...(side === 'a' ? { scoreA: next } : { scoreB: next }),
    })
    if (result.ok && result.scoreboard) setScoreboard(result.scoreboard)
  }

  async function saveTeamNames() {
    if (scoreboardBusy) return
    const teamA = teamADraft.trim().slice(0, 40)
    const teamB = teamBDraft.trim().slice(0, 40)
    if (!teamA || !teamB) {
      setScoreboardError('Both teams need a name.')
      return
    }
    setScoreboardBusy(true)
    setScoreboardError('')
    const result = await updateLiveScoreboard({
      liveStreamId: streamId,
      teamA,
      teamB,
    })
    setScoreboardBusy(false)
    if (!result.ok || !result.scoreboard) {
      setScoreboardError(result.error || 'TKO could not save the team names. Try again.')
      return
    }
    setScoreboard(result.scoreboard)
    setTeamEditorOpen(false)
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
  const [angleProfiles, setAngleProfiles] = useState<Map<string, CompactPlayerProfile>>(new Map())
  const angleProfileKey = useMemo(
    () => [...new Set(angleRows.map((row) => row.user_id).filter((id): id is string => Boolean(id)))].sort().join('|'),
    [angleRows],
  )
  useEffect(() => {
    let cancelled = false
    const ids = angleProfileKey ? angleProfileKey.split('|') : []
    if (ids.length === 0) { setAngleProfiles(new Map()); return }
    supabase
      .from('profiles')
      .select('id, username, avatar_url, power_level, equipped_tag_text, equipped_tag_rarity')
      .in('id', ids)
      .then(({ data }) => {
        if (cancelled) return
        setAngleProfiles(new Map((data ?? []).map((row) => [row.id, compactProfile(row)])))
      })
    return () => { cancelled = true }
  }, [angleProfileKey])
  const [hostFeedStatus, setHostFeedStatus] = useState<'live' | 'stopped'>('live')
  // Host feed's action score from the PC watcher (see ACTION SIGNAL below).
  const [hostAction, setHostAction] = useState<{ level: number; at: string | null }>({ level: -1, at: null })
  // The shot the HOST has on air — viewers on "Host's view" mirror it.
  const [hostView, setHostViewState] = useState<HostView | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [refreshingFeeds, setRefreshingFeeds] = useState(false)
  const lastAngleRepairAt = useRef(0)
  useEffect(() => {
    let cancelled = false
    if (streamId === 'direct') { setAngleRows([]); return }
    async function refreshSources() {
      const [loadedRows, streamResult] = await Promise.all([
        loadAngles(streamId),
        supabase
          .from('live_streams')
          .select('host_feed_status,youtube_url,background_url,team_a,team_b,score_a,score_b,score_revision,host_action_level,host_action_at,host_view')
          .eq('id', streamId)
          .maybeSingle(),
      ])
      if (cancelled) return
      let rows = loadedRows
      const needsRepair = rows.some((row) =>
        row.status !== 'stopped'
        && (!extractYouTubeId(row.youtube_url ?? '') || row.status === 'reconnecting'),
      )
      const now = Date.now()
      if (isHost && needsRepair && now - lastAngleRepairAt.current >= 15_000) {
        lastAngleRepairAt.current = now
        const repaired = await refreshLiveAngles(streamId)
        if (cancelled) return
        if (repaired.ok) rows = repaired.angles
      }
      setAngleRows(rows)
      const live = streamResult.data as ({
        host_feed_status?: string
        youtube_url?: string | null
        background_url?: string | null
        host_action_level?: number | null
        host_action_at?: string | null
        host_view?: HostView | string | null
      } & Partial<LiveScoreboard>) | null
      setHostFeedStatus(live?.host_feed_status === 'stopped' ? 'stopped' : 'live')
      setHostAction({ level: Number(live?.host_action_level ?? -1), at: live?.host_action_at ?? null })
      try {
        const hv = typeof live?.host_view === 'string'
          ? JSON.parse(live.host_view) as HostView
          : (live?.host_view ?? null)
        setHostViewState(hv && Array.isArray(hv.feeds) && hv.feeds.length ? hv : null)
      } catch {
        setHostViewState(null)
      }
      if (live) {
        setLiveBackgroundUrl(normalizeLiveBannerUrl(live.background_url) ?? '')
        setScoreboard({
          team_a: String(live.team_a || initialTeamA),
          team_b: String(live.team_b || initialTeamB),
          score_a: Math.max(0, Number(live.score_a || 0)),
          score_b: Math.max(0, Number(live.score_b || 0)),
          score_revision: Math.max(0, Number(live.score_revision || 0)),
        })
      }
      const nextUrl = String(live?.youtube_url || '').trim()
      if (nextUrl) {
        setCurrentHostUrl((previous) => {
          if (previous === nextUrl) return previous
          setHostPlayerVersion((version) => version + 1)
          return nextUrl
        })
      }
    }
    void refreshSources()
    const timer = window.setInterval(() => { void refreshSources() }, 3_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [streamId, reloadKey, isHost, initialTeamA, initialTeamB])

  async function reconnectFeedsNow() {
    if (refreshingFeeds || streamId === 'direct') return
    setRefreshingFeeds(true)
    lastAngleRepairAt.current = Date.now()
    const repaired = await refreshLiveAngles(streamId)
    if (repaired.ok) setAngleRows(repaired.angles)
    setRefreshingFeeds(false)
    setReloadKey((key) => key + 1)
  }

  // A YouTube event may move from its waiting room to live without changing its
  // video id. Reload the host once after mount so it cannot remain frozen on the
  // waiting-room frame while the other muted cameras advance.
  useEffect(() => {
    if (streamId === 'direct' || !videoId || hostFeedStatus !== 'live') return
    const timer = window.setTimeout(() => setHostPlayerVersion((version) => version + 1), 8_000)
    return () => window.clearTimeout(timer)
  }, [streamId, videoId, hostFeedStatus])

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
    { id: 'host', label: hostName, url: currentHostUrl, videoId: videoId ?? '', userId: hostId ?? null, profile: host, status: hostFeedStatus },
    ...angleRows.map((r) => ({
      id: r.id,
      label: r.label || 'Angle',
      url: r.youtube_url ?? '',
      videoId: extractYouTubeId(r.youtube_url ?? '') ?? '',
      userId: r.user_id,
      profile: r.user_id ? angleProfiles.get(r.user_id) ?? null : null,
      status: (r.status ?? 'live') as Angle['status'],
    })),
  ]
  const multiAngle = angles.length > 1

  // The VIEWER's choice (operator 2026-08-02): follow the HOST's shot, let
  // AUTO direct, or lock a camera themselves — all per-viewer, never shared.
  const [viewMode, setViewMode] = useState<'auto' | 'single' | 'multi' | 'host'>('auto')
  const [singleIndex, setSingleIndex] = useState(0)
  const [multiIndexes, setMultiIndexes] = useState<number[]>([])
  const [autoShotIdx, setAutoShotIdx] = useState(0)
  const holdTimer = useRef<number | null>(null)
  const holdFired = useRef(false)
  const holdGesture = useRef<{
    pointerId: number
    index: number
    startX: number
    startY: number
    moved: boolean
  } | null>(null)

  const playableIndexes = angles
    .map((angle, index) => (angle.status === 'live' && angle.videoId ? index : -1))
    .filter((index) => index >= 0)
  const playableKey = playableIndexes.join(',')

  // ── AUTO DIRECTOR ──────────────────────────────────────────────────────────
  // Honest state of the art: AUTO has NO game-state signal yet — the embeds are
  // sealed YouTube iframes, so nothing client-side can see where the action is.
  // Instead of the old blind one-camera carousel it now runs a broadcast-style
  // SHOT PROGRAM: host-anchored solos, 2-ups, the full grid, and main+PiP, on
  // varied durations. When the PC pipeline starts posting per-angle action
  // levels (HUD reader — see Loras HANDOFF "live director signal"), the program
  // will follow the action instead of the clock; the layouts are ready for it.
  type AutoShot = { feeds: number[]; layout: 'solo' | 'duo' | 'grid' | 'pip'; dur: number }
  const autoProgram: AutoShot[] = useMemo(() => {
    const p = playableIndexes
    if (p.length <= 1) return [{ feeds: [p[0] ?? 0], layout: 'solo' as const, dur: 8 }]
    const hostFeed = p[0]
    const shots: AutoShot[] = []
    for (let i = 0; i < p.length; i++) {
      shots.push({ feeds: [p[i]], layout: 'solo', dur: 7 })
      const partner = p[(i + 1) % p.length]
      if (i % 2 === 0 && partner !== p[i]) {
        shots.push({ feeds: [p[i], partner], layout: 'duo', dur: 8 })
      }
      if (i === Math.floor(p.length / 2)) {
        if (p.length >= 3) shots.push({ feeds: p.slice(0, 4), layout: 'grid', dur: 10 })
        const pips = p.filter((f) => f !== hostFeed).slice(0, 2)
        if (pips.length) shots.push({ feeds: [hostFeed, ...pips], layout: 'pip', dur: 9 })
      }
    }
    return shots
    // playableKey is the stable dependency for this derived list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playableKey])
  // ── ACTION SIGNAL: when the PC's HUD watcher (tko_live_director) is posting
  // fresh per-angle scores, AUTO follows the ACTION instead of the clock — the
  // hottest feed solo (or the top two as a 2-up), 8s min-hold and +10
  // hysteresis so the cut never flaps between equally hot cameras. Stale or
  // absent signal (watcher off / endpoint not deployed) = the choreographed
  // program below, exactly as before.
  const [hotShot, setHotShot] = useState<AutoShot | null>(null)
  const hotHold = useRef<{ anchor: number; until: number; score: number }>({ anchor: -1, until: 0, score: 0 })
  useEffect(() => {
    if (viewMode !== 'auto') {
      if (hotShot) setHotShot(null)
      return
    }
    const now = Date.now()
    const fresh = (at?: string | null) => !!at && now - Date.parse(at) < 30_000
    const scoreOf = (index: number): number => {
      const angle = angles[index]
      if (!angle || angle.status !== 'live' || !angle.videoId) return -1
      if (angle.id === 'host') return fresh(hostAction.at) ? hostAction.level : -1
      const row = angleRows.find((r) => r.id === angle.id)
      return row && fresh(row.action_at) ? Number(row.action_level ?? -1) : -1
    }
    const ranked = playableIndexes
      .map((index) => ({ index, score: scoreOf(index) }))
      .filter((entry) => entry.score >= 0)
      .sort((x, y) => y.score - x.score)
    const top = ranked[0]
    const hold = hotHold.current
    if (!top || top.score < 70) {
      if (hotShot && now >= hold.until) setHotShot(null)
      return
    }
    const second = ranked[1] && ranked[1].score >= 70 ? ranked[1] : null
    const anchorHeld = hold.anchor === top.index && now < hold.until
    if (!anchorHeld && hold.anchor >= 0 && hold.anchor !== top.index
        && now < hold.until && top.score < hold.score + 10) return
    if (anchorHeld && hotShot && (second ? 2 : 1) === hotShot.feeds.length) return
    hotHold.current = { anchor: top.index, until: now + 8_000, score: top.score }
    setHotShot({
      feeds: second ? [top.index, second.index] : [top.index],
      layout: second ? 'duo' : 'solo',
      dur: 8,
    })
    // angle identity is covered by playableKey; rows/host action drive updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, angleRows, hostAction, playableKey])

  const autoShot = (viewMode === 'auto' && hotShot)
    ? hotShot
    : (autoProgram[autoShotIdx % autoProgram.length] ?? autoProgram[0])
  useEffect(() => {
    if (viewMode !== 'auto' || autoProgram.length <= 1 || hotShot) return
    const timer = window.setTimeout(
      () => setAutoShotIdx((i) => (i + 1) % autoProgram.length),
      (autoProgram[autoShotIdx % autoProgram.length]?.dur ?? 7) * 1000,
    )
    return () => window.clearTimeout(timer)
  }, [viewMode, autoShotIdx, autoProgram, hotShot])

  const clampedSingle = Math.max(0, Math.min(singleIndex, angles.length - 1))
  const autoFeeds = autoShot.feeds.filter((i) => i < angles.length)
  // "Host's view": map the host's published angle ids onto this viewer's list.
  const angleIndexById = new Map(angles.map((a, i) => [a.id, i] as const))
  const hostViewFeeds = (hostView?.feeds ?? [])
    .map((id) => angleIndexById.get(id))
    .filter((i): i is number => i != null)
  const activeFeeds: number[] =
    viewMode === 'single'
      ? [clampedSingle]
      : viewMode === 'multi'
        ? (multiIndexes.filter((i) => i < angles.length).length ? multiIndexes.filter((i) => i < angles.length) : [0])
        : viewMode === 'host'
          ? (hostViewFeeds.length ? hostViewFeeds : [0])
          : (autoFeeds.length ? autoFeeds : [playableIndexes[0] ?? 0])
  const autoPip = ((viewMode === 'auto' && autoShot.layout === 'pip')
    || (viewMode === 'host' && hostView?.layout === 'pip')) && activeFeeds.length > 1

  // HOST side of "Host's view": publish the shot the host has on air (debounced;
  // the 3s poll delivers it to every follower).
  const lastPushedView = useRef('')
  useEffect(() => {
    if (!isHost || streamId === 'direct') return
    const layout: HostView['layout'] =
      viewMode === 'single' ? 'solo'
        : viewMode === 'multi' ? (activeFeeds.length === 2 ? 'duo' : 'grid')
          : autoShot.layout
    const feeds = activeFeeds.map((i) => angles[i]?.id).filter(Boolean) as string[]
    if (!feeds.length) return
    const sig = `${layout}|${feeds.join(',')}`
    if (sig === lastPushedView.current) return
    const timer = window.setTimeout(() => {
      lastPushedView.current = sig
      void setHostView(streamId, { layout, feeds })
    }, 1_500)
    return () => window.clearTimeout(timer)
  })

  function clearHoldTimer() {
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }

  function beginPress(index: number, event: React.PointerEvent<HTMLButtonElement>) {
    holdFired.current = false
    clearHoldTimer()
    holdGesture.current = {
      pointerId: event.pointerId,
      index,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
    holdTimer.current = window.setTimeout(() => {
      const gesture = holdGesture.current
      if (!gesture || gesture.moved || gesture.index !== index) return
      holdFired.current = true
      holdTimer.current = null
      toggleMulti(index)
    }, HOLD_MS)
  }

  /**
   * Add or remove ONE camera from multi-view.
   *
   * Extracted from the hold timer so a real, visible control can do exactly the
   * same thing. Long-press was the ONLY way to reach multi-view, and it is a
   * touch idiom: on desktop nothing on screen suggests holding does anything,
   * and holding a mouse still for 650ms is not a gesture anyone tries. Operator,
   * during a live demo: "on desktop they can't click and hold a video to make
   * two screens on the live."
   *
   * One implementation, two entry points -- so the button and the gesture can
   * never drift apart.
   */
  function toggleMulti(index: number) {
    const anchor = viewMode === 'single'
      ? clampedSingle
      : viewMode === 'auto'
        ? (autoFeeds[0] ?? playableIndexes[0] ?? 0)
        : (multiIndexes[0] ?? 0)
    const next = nextMultiSelection(viewMode === 'multi' ? multiIndexes : [], index, anchor)
    setMultiIndexes(next)
    if (next.length > 1) {
      setViewMode('multi')
    } else {
      setViewMode('single')
      setSingleIndex(next[0] ?? index)
    }
  }

  function movePress(index: number, event: React.PointerEvent<HTMLButtonElement>) {
    const gesture = holdGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.index !== index || gesture.moved) return
    if (
      Math.abs(event.clientX - gesture.startX) > HOLD_MOVE_TOLERANCE
      || Math.abs(event.clientY - gesture.startY) > HOLD_MOVE_TOLERANCE
    ) {
      gesture.moved = true
      clearHoldTimer()
    }
  }

  function endPress(index: number, event: React.PointerEvent<HTMLButtonElement>) {
    const gesture = holdGesture.current
    clearHoldTimer()
    holdGesture.current = null
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.index !== index || gesture.moved) return
    if (holdFired.current) {
      holdFired.current = false
      return
    }
    setViewMode('single')
    setSingleIndex(index)
  }

  function cancelPress() {
    clearHoldTimer()
    holdGesture.current = null
    holdFired.current = false
  }

  useEffect(() => () => clearHoldTimer(), [])
  function backToAuto() {
    setViewMode('auto')
    setMultiIndexes([])
  }

  // Placeholder card for a slot that can't play (stopped / reconnecting / not a
  // YouTube link). Playable angles are rendered by the persistent pool below.
  function renderFeed(angle: Angle | undefined) {
    if (!angle) return null
    if (angle.status && angle.status !== 'live') {
      const reconnecting = angle.status === 'reconnecting'
      return (
        <div className="w-full h-full flex items-center justify-center text-center p-4 bg-black">
          <div>
            <div className={`mx-auto mb-2 w-2.5 h-2.5 rounded-full ${reconnecting ? 'bg-yellow-400 animate-pulse' : 'bg-gray-600'}`} />
            <p className="text-gray-300 text-sm font-semibold">
              {reconnecting ? `${angle.label} — reconnecting…` : `${angle.label} — feed stopped`}
            </p>
            <p className="text-gray-500 text-xs mt-1">
              {reconnecting ? "Their slot is held — it'll return automatically." : 'The host paused this feed.'}
            </p>
          </div>
        </div>
      )
    }
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
    return null
  }

  // ── AUDIO for the pool: exactly one player is ever unmuted (the on-stage
  // primary, and only after the viewer taps sound on). postMessage commands —
  // never URL flags, which would re-mount and flash the YouTube chrome.
  const playerRefs = useRef(new Map<string, HTMLIFrameElement>())
  const primaryAngleId = angles[activeFeeds[0]]?.id
  useEffect(() => {
    const send = (frame: HTMLIFrameElement, func: string, args: unknown[] = []) => {
      try {
        frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*')
      } catch { /* frame not ready — next shot change retries */ }
    }
    for (const [id, frame] of playerRefs.current) {
      if (id === primaryAngleId && stageAudioOn) {
        send(frame, 'unMute')
        send(frame, 'setVolume', [100])
      } else {
        send(frame, 'mute')
      }
    }
  }, [primaryAngleId, stageAudioOn, playableKey, autoShotIdx, viewMode])

  const primaryFeed = angles[activeFeeds[0]] ?? angles[0]

  return (
    <div className="w-full">
      {/* ── SCOREBOARD CONTROLS (HOST ONLY) — the viewer-facing scoreboard is
          the compact scorebug glued above the video stage below. Host edits
          here write the global live_streams row; every viewer's scorebug
          follows. Viewers never see this card. ── */}
      {isHost && streamId !== 'direct' && (
      <LiveSection
        title="Scoreboard controls"
        description={`${scoreboard.team_a} vs ${scoreboard.team_b}`}
        defaultOpen={false}
        storageKey={`tko_live_scoreboard_section:${streamId}`}
      >
      <div className="relative rounded-2xl overflow-hidden border border-dark-border">
        {liveBackgroundUrl && (
          <img
            src={liveBackgroundUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            aria-hidden
          />
        )}
        {/* fire (left) → ice (right) split. Inline gradient — not a Tailwind color. */}
        <div
          className="absolute inset-0"
          style={{ background: liveBackgroundUrl ? 'linear-gradient(90deg, rgba(7,24,29,.78), rgba(9,10,16,.48) 50%, rgba(42,13,8,.78))' : 'linear-gradient(90deg, #7a1500 0%, #c2410c 30%, #171326 50%, #0e7490 70%, #052e45 100%)' }}
          aria-hidden
        />
        <div className={`absolute inset-0 ${liveBackgroundUrl ? 'bg-black/25' : 'bg-black/35'}`} aria-hidden />

        <div className="relative px-3 sm:px-6 py-4 sm:py-5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/50 text-[11px] font-bold text-white uppercase tracking-wider">
              <span className="inline-block w-2 h-2 rounded-full bg-kunai animate-pulse" /> Live
            </span>
          </div>

          {/* Team A ── score ── (facecam) ── score ── Team B */}
          <div className="flex items-center justify-center gap-2 sm:gap-5">
            {/* Team A */}
            <div className="flex-1 min-w-0 text-right">
              <p className="w-full truncate text-right text-sm font-black uppercase text-white drop-shadow sm:text-2xl">
                {scoreboard.team_a}
              </p>
              <div className="mt-1 flex items-center justify-end gap-1.5">
                <ScoreValue value={scoreboard.score_a} />
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
              {hostId ? (
                <Link
                  to={`/profile/${hostId}`}
                  title={`View ${hostName}'s full stats`}
                  className="flex max-w-[9rem] flex-col items-center gap-0.5 hover:text-accent"
                >
                  <span className="max-w-[7rem] truncate rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white sm:text-xs">
                    {hostName}
                  </span>
                  <PlayerMetaLine
                    title={host?.title}
                    titleRarity={host?.titleRarity}
                    powerLevel={host?.powerLevel}
                    className="max-w-full justify-center"
                  />
                </Link>
              ) : (
                <span className="max-w-[7rem] truncate rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white sm:text-xs">
                  {hostName}
                </span>
              )}
            </div>

            {/* Team B */}
            <div className="flex-1 min-w-0 text-left">
              <p className="w-full truncate text-left text-sm font-black uppercase text-white drop-shadow sm:text-2xl">
                {scoreboard.team_b}
              </p>
              <div className="mt-1 flex items-center justify-start gap-1.5">
                <ScoreValue value={scoreboard.score_b} />
              </div>
            </div>
          </div>

          {isHost && streamId !== 'direct' && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={openTeamEditor}
                className="min-h-9 rounded-md border border-white/35 bg-black/45 px-3 text-xs font-bold text-white hover:border-accent hover:text-accent"
              >
                Edit team names
              </button>
            </div>
          )}

          {teamEditorOpen && (
            <div className="mt-3 rounded-lg border border-white/20 bg-black/75 p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white">Teams on this live</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs font-semibold text-gray-300">
                  Team A
                  <input
                    autoFocus
                    value={teamADraft}
                    maxLength={40}
                    disabled={scoreboardBusy}
                    onChange={(event) => setTeamADraft(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-md border border-white/20 bg-black/60 px-3 text-sm text-white outline-none focus:border-accent"
                  />
                </label>
                <label className="text-xs font-semibold text-gray-300">
                  Team B
                  <input
                    value={teamBDraft}
                    maxLength={40}
                    disabled={scoreboardBusy}
                    onChange={(event) => setTeamBDraft(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-md border border-white/20 bg-black/60 px-3 text-sm text-white outline-none focus:border-accent"
                  />
                </label>
              </div>
              {scoreboardError && <p className="mt-2 text-xs text-kunai">{scoreboardError}</p>}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTeamEditorOpen(false)}
                  disabled={scoreboardBusy}
                  className="min-h-10 rounded-md border border-white/20 px-3 text-sm font-semibold text-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { void saveTeamNames() }}
                  disabled={scoreboardBusy}
                  className="min-h-10 rounded-md bg-accent px-4 text-sm font-bold text-dark disabled:opacity-50"
                >
                  {scoreboardBusy ? 'Saving...' : 'Save teams'}
                </button>
              </div>
            </div>
          )}

          {title && (
            <p className="mt-3 text-center text-xs sm:text-sm text-white/85 truncate">{title}</p>
          )}
        </div>
      </div>
      </LiveSection>
      )}

      {isHost && streamId !== 'direct' && (
        <div className="mt-2">
          <LiveSection
            title="Stream banner"
            description="Upload, make or replace the show banner"
            defaultOpen={false}
            storageKey={`tko_live_banner_section:${streamId}`}
          >
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-accent">
              <ImagePlus className="h-4 w-4" aria-hidden /> Banner controls
            </div>
            <LiveBannerEditor
              compact
              value={liveBackgroundUrl}
              onChange={saveLiveBanner}
              title={title}
              teamA={scoreboard.team_a}
              teamB={scoreboard.team_b}
            />
            {bannerSaveError && <p className="mt-2 text-xs text-kunai">{bannerSaveError}</p>}
          </LiveSection>
        </div>
      )}

      {/* ── GOAL bar ──────────────────────────────────────────────────────────
          When the host has a REAL creator goal (from the Creator Dashboard) we
          show it with live current/target. Otherwise we fall back to the
          host-only localStorage placeholder. */}
      <div className="mt-3">
        <LiveSection
          title="Stream goal"
          description={liveGoal ? `${liveGoal.label}: ${liveGoal.current ?? 0}/${liveGoal.target}` : `Dono goal: ${board.donoCurrent}/${board.donoTarget}`}
          defaultOpen={false}
          storageKey={`tko_live_goal_section:${streamId}`}
        >
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
        </LiveSection>
      </div>

      {/* ── MAIN STAGE + CHAT RAIL ───────────────────────────────────────────
          Placement follows the stored layout preset: 'auto'/'host_top_chat_right'
          dock chat to the SIDE (viewer-resizable divider); 'host_side_chat_bottom'
          and 'theater' stack chat BELOW a full-width stage. */}
      <div className={`mt-3 flex gap-3 items-start ${dock === 'side' ? 'flex-col lg:flex-row' : 'flex-col'}`}>
        <div className="min-w-0 w-full lg:flex-1">
          {/* Big stage — a single angle fills the column; a multi-view splits it
              into a grid. When there's only the host's stream this is exactly the
              original single-stage layout. */}
          <LiveSection
            title="Live video"
            description={viewMode === 'multi' ? `${activeFeeds.length} cameras on screen` : `Showing ${primaryFeed?.label || 'current camera'}`}
            storageKey={`tko_live_video_section:${streamId}`}
          >
          {/* The broadcast scorebug rides ON the video: host-global scoreboard
              (teams + scores from the live_streams row), viewer-local nothing —
              switching cameras below never changes this strip for anyone else. */}
          <ScoreBug
            scoreboard={scoreboard}
            hostName={hostName}
            profileId={hostId ?? null}
            avatarUrl={host?.avatarUrl ?? null}
            powerLevel={host?.powerLevel}
            playerTitle={host?.title}
            titleRarity={host?.titleRarity}
            seed={hostId || streamId}
            accent={accent}
            backgroundUrl={liveBackgroundUrl}
            right={headerRight}
            onBump={isHost && streamId !== 'direct' ? bumpScore : undefined}
            onPlus={isHost && streamId !== 'direct' ? () => {
              setTeamADraft(scoreboard.team_a)
              setTeamBDraft(scoreboard.team_b)
              setScoreboardError('')
              setQuickEditOpen((open) => !open)
            } : undefined}
            open={bugOpen}
            onToggle={toggleBug}
          />

          {/* "+" quick editor (HOST only): upload/replace the banner and edit
              the teams data right from the scorebug (operator 2026-08-02). */}
          {quickEditOpen && isHost && streamId !== 'direct' && (
            <div className="space-y-3 border border-t-0 border-dark-border bg-dark-card p-3">
              <LiveBannerEditor
                compact
                value={liveBackgroundUrl}
                onChange={saveLiveBanner}
                title={title}
                teamA={scoreboard.team_a}
                teamB={scoreboard.team_b}
              />
              {bannerSaveError && <p className="text-xs text-kunai">{bannerSaveError}</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs font-semibold text-gray-300">
                  Team A
                  <input
                    value={teamADraft}
                    maxLength={40}
                    disabled={scoreboardBusy}
                    onChange={(event) => setTeamADraft(event.target.value)}
                    className="mt-1 min-h-10 w-full rounded-md border border-dark-border bg-dark px-3 text-sm text-white outline-none focus:border-accent"
                  />
                </label>
                <label className="text-xs font-semibold text-gray-300">
                  Team B
                  <input
                    value={teamBDraft}
                    maxLength={40}
                    disabled={scoreboardBusy}
                    onChange={(event) => setTeamBDraft(event.target.value)}
                    className="mt-1 min-h-10 w-full rounded-md border border-dark-border bg-dark px-3 text-sm text-white outline-none focus:border-accent"
                  />
                </label>
              </div>
              {scoreboardError && <p className="text-xs text-kunai">{scoreboardError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setQuickEditOpen(false)}
                  className="min-h-9 rounded-md border border-dark-border px-3 text-sm font-semibold text-gray-300"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => { void saveTeamNames() }}
                  disabled={scoreboardBusy}
                  className="min-h-9 rounded-md bg-accent px-4 text-sm font-bold text-dark disabled:opacity-50"
                >
                  {scoreboardBusy ? 'Saving...' : 'Save teams'}
                </button>
              </div>
            </div>
          )}
          <div className="relative overflow-hidden rounded-b-lg bg-black">
            {/* PERSISTENT PLAYER POOL — every playable angle's iframe mounts
                once and keeps playing muted; camera switches only move CSS
                slots. No re-mounts = no YouTube center-chrome flash. */}
            <div className="relative aspect-video">
              {angles.map((angle, index) => {
                const at = activeFeeds.indexOf(index)
                const playable = angle.status === 'live' && !!angle.videoId
                if (!playable) {
                  if (at < 0) return null
                  return (
                    <div key={angle.id} className="absolute z-10 bg-black" style={slotStyle(at, activeFeeds.length, autoPip)}>
                      {renderFeed(angle)}
                    </div>
                  )
                }
                const hidden = at < 0
                const pip = autoPip && at > 0
                return (
                  <div
                    key={`${angle.id}-${angle.videoId}-${angle.id === 'host' ? hostPlayerVersion : 0}`}
                    className={`absolute overflow-hidden bg-black transition-all duration-300 ${
                      pip ? 'rounded-md border border-white/25 shadow-lg' : hidden || activeFeeds.length <= 1 ? '' : 'border border-black/60'
                    }`}
                    style={hidden ? HIDDEN_SLOT : slotStyle(at, activeFeeds.length, autoPip)}
                  >
                    <CroppedFrame overscan={1}>
                      <iframe
                        ref={(el) => {
                          if (el) playerRefs.current.set(angle.id, el)
                          else playerRefs.current.delete(angle.id)
                        }}
                        src={embedSrc(angle.videoId)}
                        title={angle.label}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full"
                      />
                    </CroppedFrame>
                    {!hidden && activeFeeds.length > 1 && (
                      <span className={`absolute left-1.5 top-1.5 z-20 rounded bg-black/75 px-1.5 py-0.5 text-white ${pip ? 'text-[9px]' : 'text-[10px]'}`}>
                        {angle.label}
                      </span>
                    )}
                  </div>
                )
              })}
              <LeagueWatermark />
            </div>

          {/* The viewer's view choice, spelled out (operator): follow the host,
              let AUTO direct, or lock any camera. Per-viewer only — changing it
              never changes the stream for anyone else. */}
          {multiAngle && (
            <div className="mt-2 flex items-center gap-2">
              <label htmlFor={`tko-view-${streamId}`} className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                View
              </label>
              <select
                id={`tko-view-${streamId}`}
                value={viewMode === 'single' ? `cam:${clampedSingle}` : viewMode}
                onChange={(event) => {
                  const choice = event.target.value
                  if (choice === 'auto') backToAuto()
                  else if (choice === 'host') { setViewMode('host'); setMultiIndexes([]) }
                  else if (choice.startsWith('cam:')) {
                    setViewMode('single')
                    setSingleIndex(Number(choice.slice(4)) || 0)
                  }
                }}
                className="min-h-9 w-full max-w-xs rounded-md border border-dark-border bg-dark px-2 text-sm text-white outline-none focus:border-accent"
              >
                <option value="auto">Auto — TKO directs the cameras</option>
                {!isHost && <option value="host">Host's view — watch what {hostName} puts on</option>}
                {angles.map((angle, index) => (
                  <option key={angle.id} value={`cam:${index}`}>
                    Camera — {angle.label}
                  </option>
                ))}
                {viewMode === 'multi' && <option value="multi">Multi-view (your selection)</option>}
              </select>
            </div>
          )}
            {activeFeeds.length <= 1 && primaryFeed?.videoId && <TkoWatermark />}
            {viewMode === 'auto' && multiAngle && (
              <span className="absolute left-2 top-2 z-20 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" /> Auto
                {hotShot && <span className="text-white/85">ACTION</span>}
                {autoShot.layout !== 'solo' && (
                  <span className="text-white/85">
                    {autoShot.layout === 'duo' ? '2-UP' : autoShot.layout === 'grid' ? 'GRID' : 'PIP'}
                  </span>
                )}
              </span>
            )}
            {viewMode === 'host' && (
              <span className="absolute left-2 top-2 z-20 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                <span className="w-1.5 h-1.5 rounded-full bg-kunai animate-pulse" /> Host's view
              </span>
            )}
            {primaryFeed?.videoId && (
              <button
                type="button"
                onClick={() => setStageAudioOn((enabled) => !enabled)}
                className="absolute right-2 top-2 z-30 rounded-full border border-white/20 bg-black/75 px-2.5 py-1 text-[11px] font-semibold text-white hover:border-accent"
              >
                {stageAudioOn ? 'Mute' : 'Turn on sound'}
              </button>
            )}
          </div>
          </LiveSection>

          {/* Oracle (or any under-stage slot) sits directly beneath the gameplay
              action screen — not at the bottom of the page. */}
          {underStage && <div className="mt-3">{underStage}</div>}

          {/* Live chat rides DIRECTLY under the Oracle call (operator layout,
              2026-08-02) — in the main column, collapsible like every section. */}
          <div className="mt-3">
            {enableChat ? (
              <LiveSection
                title="Live chat"
                description="Messages and reactions from this show"
                storageKey={`tko_live_chat_section:${streamId}`}
              >
                <StreamChat streamId={streamId} title={title} />
              </LiveSection>
            ) : (
              <div className="rounded-xl border border-dark-border bg-dark-card p-4 text-center text-xs text-gray-500">
                Open this stream from its TKO page to join the chat.
              </div>
            )}
          </div>

          {/* ── ANGLE SWITCHER (only when there's more than the host's stream) ── */}
          {multiAngle && (
            <div className="mt-3">
              <LiveSection
                title="Camera angles"
                description="Auto switching, one camera or a deliberate multi-view"
                defaultOpen={false}
                storageKey={`tko_live_camera_section:${streamId}`}
              >
              <div className="flex items-center justify-between gap-2 rounded-lg border border-dark-border bg-dark px-3 py-2">
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
                      ? (autoShot.layout === 'solo'
                          ? `Auto — camera: ${primaryFeed?.label || angles[0].label}`
                          : autoShot.layout === 'duo'
                            ? `Auto — 2-up: ${activeFeeds.map((i) => angles[i]?.label).join(' + ')}`
                            : autoShot.layout === 'grid'
                              ? `Auto — ${activeFeeds.length}-up grid`
                              : `Auto — ${primaryFeed?.label} + ${activeFeeds.length - 1} PiP`)
                      : viewMode === 'multi'
                        ? `${activeFeeds.length} angles side by side`
                        : viewMode === 'host'
                          ? `Host's view — following ${hostName}`
                          : `Watching ${angles[clampedSingle].label}`}
                  </span>
                </div>
                {viewMode !== 'auto' && (
                  <button type="button" onClick={backToAuto} className="shrink-0 text-xs text-gray-400 hover:text-accent">
                    Reset
                  </button>
                )}
                {isHost && (
                  <button
                    type="button"
                    onClick={() => { void reconnectFeedsNow() }}
                    disabled={refreshingFeeds}
                    className="shrink-0 rounded-md border border-dark-border px-2.5 py-1.5 text-xs text-gray-300 hover:border-accent/60 hover:text-accent disabled:opacity-50"
                  >
                    {refreshingFeeds ? 'Finding feeds...' : 'Reconnect feeds'}
                  </button>
                )}
              </div>
              {viewMode === 'auto' && playableIndexes.length > 1 && (
                <div className="mt-1.5 flex justify-center gap-1" aria-label="Automatic camera rotation">
                  {playableIndexes.map((feedIndex) => (
                    <span
                      key={angles[feedIndex]?.id || feedIndex}
                      className={`h-1.5 rounded-full transition-all duration-300 ${activeFeeds.includes(feedIndex) ? 'w-6 bg-accent' : 'w-1.5 bg-gray-700'}`}
                    />
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-gray-500">
                Click an angle to watch it full-size. Double-click it, or use the + button on the tile, to add or remove that camera from multi-view. On a phone, press and hold instead.
              </p>
              <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2" aria-label="Live angles">
                {angles.map((angle, index) => {
                  const onAir = activeFeeds.includes(index)
                  const inMulti = viewMode === 'multi' && multiIndexes.includes(index)
                  return (
                    // Relative WRAPPER so the multi-view toggle can sit on top of
                    // the tile as a SIBLING. It cannot be nested inside the tile
                    // button -- a button inside a button is invalid HTML and
                    // React/browsers handle the nested click inconsistently.
                    // `group` lives HERE, not on the tile button: the toggle is a
                    // SIBLING of that button, and group-hover only reaches
                    // descendants of the element carrying `group`.
                    <div
                      key={angle.id}
                      className={`group relative overflow-hidden rounded-lg border transition ${
                        onAir ? 'border-accent ring-1 ring-accent' : 'border-dark-border hover:border-accent/55'
                      }`}
                    >
                    <button
                       type="button"
                       onPointerDown={(e) => { if (e.button === 0) beginPress(index, e) }}
                       onPointerMove={(e) => movePress(index, e)}
                       onPointerUp={(e) => { if (e.button === 0) endPress(index, e) }}
                       onPointerLeave={cancelPress}
                       onPointerCancel={cancelPress}
                       onContextMenu={(e) => e.preventDefault()}
                       // DOUBLE-CLICK = the desktop way into multi-view.
                       // Long-press is a touch idiom; on a mouse nobody thinks to
                       // hold, and holding still for 650ms is awkward. The two
                       // single-clicks that precede a dblclick each select this
                       // camera full-size, then this promotes it to multi-view --
                       // so the resting state is correct either way.
                       onDoubleClick={(e) => {
                         e.preventDefault()
                         cancelPress()
                         toggleMulti(index)
                       }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewMode('single'); setSingleIndex(index) }
                      }}
                      title={`${angle.label} — tap to watch, hold to combine`}
                       className="block w-full touch-pan-y select-none text-left"
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
                          <div className="h-full w-full grid place-items-center px-2 text-center text-[10px] text-gray-500">Finding live feed...</div>
                        )}
                        <span className="absolute left-1 top-1 rounded bg-black/75 px-1 py-0.5 text-[10px] leading-none text-white">
                          {index === 0 ? 'HOST' : onAir ? 'ON AIR' : `CAM ${index + 1}`}
                        </span>
                        {/* The old ✓ badge lived here. It is gone because the
                            toggle button below occupies the same corner AND
                            shows the same state -- two marks in one place read
                            as a bug, and only one of them was clickable. */}
                      </div>
                    </button>
                    {angle.userId ? (
                      <Link
                        to={`/profile/${angle.userId}`}
                        title={`View ${angle.profile?.username || angle.label}'s full stats`}
                        className="block min-w-0 bg-dark-card px-1.5 py-1 hover:bg-dark-border/60"
                      >
                        <span className="block truncate text-[11px] text-gray-200">
                          {angle.profile?.username || angle.label}
                        </span>
                        <PlayerMetaLine
                          title={angle.profile?.title}
                          titleRarity={angle.profile?.titleRarity}
                          powerLevel={angle.profile?.powerLevel}
                          className="mt-0.5 max-w-full"
                        />
                      </Link>
                    ) : (
                      <div className="bg-dark-card px-1.5 py-1">
                        <span className="block truncate text-[11px] text-gray-300">{angle.label}</span>
                      </div>
                    )}
                    {/* THE DESKTOP PATH INTO MULTI-VIEW.
                        Always visible once a camera is in multi-view (so you can
                        remove it), and on hover/focus otherwise. Touch keeps the
                        long-press it already had; this is the mouse and keyboard
                        equivalent, and it is discoverable rather than secret. */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleMulti(index) }}
                      aria-pressed={inMulti}
                      title={inMulti ? `Remove ${angle.label} from multi-view` : `Add ${angle.label} to multi-view`}
                      className={`absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full border text-[12px] font-bold leading-none transition
                        focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-accent
                        ${inMulti
                          ? 'border-accent bg-accent text-dark opacity-100'
                          : 'border-white/40 bg-black/70 text-white opacity-0 group-hover:opacity-100 md:opacity-0'}`}
                    >
                      {inMulti ? '✓' : '+'}
                    </button>
                    </div>
                  )
                })}
              </div>
              </LiveSection>
            </div>
          )}

          {/* Action CTAs — real routing into the existing shop. */}
          {DIGITAL_CHECKOUT_ENABLED && <div className="mt-3">
            <LiveSection
              title="Support this stream"
              description="Gift a subscription or add bits"
              defaultOpen={false}
              storageKey={`tko_live_support_actions:${streamId}`}
            >
          <div className="flex flex-wrap items-center gap-2">
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
            </LiveSection>
          </div>}
        </div>

        {/* Viewer-drag divider (side dock, desktop only) — rebalances stage/rail. */}
        {dock === 'side' && (
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
            <LiveSection
              title="Manage camera feeds"
              description="Add, reconnect, pause or remove participant feeds"
              defaultOpen={false}
              storageKey={`tko_live_manage_feeds:${streamId}`}
            >
              <HostAnglePanel liveStreamId={streamId} onChanged={() => setReloadKey((k) => k + 1)} />
            </LiveSection>
          )}
          {DIGITAL_CHECKOUT_ENABLED && (
            <LiveSection
              title="Support and rewards"
              description="Gift activity, highlighted comments and stream purchases"
              defaultOpen={false}
              storageKey={`tko_live_support_panel:${streamId}`}
            >
              <div className="space-y-3">
                <GiftSubLeaderboard accent={accent} />
                {enableChat && streamId !== 'direct' && user && (
                  <InStreamPurchasePanel streamId={streamId} tokens={wallet.tokens} onSpent={() => void wallet.refresh()} />
                )}
              </div>
            </LiveSection>
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

/**
 * ScoreBug — the compact broadcast strip glued to the top of the video stage.
 * VIEWER-FACING and read-only: it reflects the HOST-GLOBAL scoreboard (the
 * live_streams row every viewer polls) and carries no controls — editing lives
 * in the host-only "Scoreboard controls" card. Backdrop is the host's banner
 * image when set, else the fire/ice split, so the show branding rides with the
 * video instead of spending a whole card on it.
 */
function ScoreBug({ scoreboard, hostName, profileId, avatarUrl, powerLevel, playerTitle, titleRarity, seed, accent, backgroundUrl, right, onBump, onPlus, open = true, onToggle }: {
  scoreboard: LiveScoreboard
  hostName: string
  profileId: string | null
  avatarUrl: string | null
  powerLevel?: number | null
  playerTitle?: string | null
  titleRarity?: ArtifactRarity | null
  seed: string
  accent: string
  backgroundUrl: string
  right?: ReactNode
  /** Present only for the HOST — renders −/+ steppers around each score. */
  onBump?: (side: 'a' | 'b', delta: number) => void
  /** Present only for the HOST — the "+" opens the banner/teams quick editor. */
  onPlus?: () => void
  open?: boolean
  onToggle?: () => void
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        className="flex w-full items-center justify-center gap-2 rounded-t-lg border border-b-0 border-dark-border bg-dark-card px-2 py-1 text-[11px] font-bold text-gray-300 transition-colors hover:text-accent"
      >
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-kunai" />
        <span className="truncate">
          {scoreboard.team_a} {scoreboard.score_a} — {scoreboard.score_b} {scoreboard.team_b}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
      </button>
    )
  }
  function stepper(side: 'a' | 'b', delta: number, label: string) {
    if (!onBump) return null
    return (
      <button
        type="button"
        onClick={() => onBump(side, delta)}
        aria-label={label}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/25 bg-black/45 text-sm font-bold leading-none text-white transition-colors hover:border-accent hover:text-accent"
      >
        {delta > 0 ? '+' : '−'}
      </button>
    )
  }
  return (
    <div className="relative overflow-hidden rounded-t-lg border border-b-0 border-dark-border">
      {backgroundUrl && (
        <img src={backgroundUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div
        className="absolute inset-0"
        style={{ background: backgroundUrl ? 'linear-gradient(90deg, rgba(7,24,29,.82), rgba(9,10,16,.55) 50%, rgba(42,13,8,.82))' : 'linear-gradient(90deg, #7a1500 0%, #c2410c 30%, #171326 50%, #0e7490 70%, #052e45 100%)' }}
        aria-hidden
      />
      <div className="absolute inset-0 bg-black/30" aria-hidden />
      <div className="relative flex min-h-11 items-center gap-2 px-2 py-1.5 sm:gap-3 sm:px-3">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-kunai" /> Live
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-xs font-black uppercase text-white drop-shadow sm:text-sm">
          {scoreboard.team_a}
        </span>
        {stepper('a', -1, `${scoreboard.team_a} score down`)}
        <span className="shrink-0 tabular-nums text-sm font-black text-white sm:text-lg">{scoreboard.score_a}</span>
        {stepper('a', +1, `${scoreboard.team_a} score up`)}
        <span
          className="h-7 w-7 shrink-0 overflow-hidden rounded-full ring-1 ring-white/70 sm:h-8 sm:w-8"
          style={{ boxShadow: `0 0 0 1.5px ${accent}` }}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={hostName} className="h-full w-full object-cover" />
          ) : (
            <Avatar src={null} name={hostName} seed={seed} size={32} />
          )}
        </span>
        {stepper('b', -1, `${scoreboard.team_b} score down`)}
        <span className="shrink-0 tabular-nums text-sm font-black text-white sm:text-lg">{scoreboard.score_b}</span>
        {stepper('b', +1, `${scoreboard.team_b} score up`)}
        <span className="min-w-0 flex-1 truncate text-left text-xs font-black uppercase text-white drop-shadow sm:text-sm">
          {scoreboard.team_b}
        </span>
        {right && <span className="shrink-0">{right}</span>}
        {onPlus && (
          <button
            type="button"
            onClick={onPlus}
            aria-label="Banner and teams editor"
            title="Add your banner / edit teams"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/45 text-base font-bold leading-none text-white transition-colors hover:text-accent"
          >
            +
          </button>
        )}
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse scoreboard"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/45 text-white transition-colors hover:text-accent"
          >
            <ChevronDown className="h-4 w-4 rotate-180" aria-hidden />
          </button>
        )}
      </div>
      {profileId && (
        <Link
          to={`/profile/${profileId}`}
          title={`View ${hostName}'s full stats`}
          className="relative flex min-h-5 min-w-0 items-center justify-center gap-1 border-t border-white/10 bg-black/35 px-2 py-0.5 hover:bg-black/50"
        >
          <span className="max-w-[8rem] truncate text-[10px] font-semibold text-white">{hostName}</span>
          <PlayerMetaLine
            title={playerTitle}
            titleRarity={titleRarity}
            powerLevel={powerLevel}
            className="min-w-0 max-w-[12rem]"
          />
        </Link>
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
