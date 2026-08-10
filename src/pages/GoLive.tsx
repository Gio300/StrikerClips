import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import { extractYouTubeId } from '@/lib/youtubeApi'
import { ConnectedBadge } from '@/components/ConnectedBadge'
import { ShareButton } from '@/components/ShareButton'
import { canonicalShareUrl } from '@/lib/canonicalUrl'
import { useAskTko } from '@/components/AskTkoContext'
import { loadLibrary, loadHandle, youtubeLiveUrl, loadChannelId, channelLiveUrl, resolveChannelId } from '@/lib/youtubeConnect'
import { isYouTubeLinked } from '@/lib/youtubeLink'
import { acceptProposedStage, autoLinkForStream, type AutoLinkOutcome } from '@/lib/liveLinkService'
import { LiveLinkOptOut } from '@/components/LiveLinkOptOut'
import { HostAnglePanel } from '@/components/HostAnglePanel'
import { LiveBannerEditor } from '@/components/LiveBannerEditor'
import { normalizeLiveBannerUrl } from '@/lib/liveBanner'
import {
  sendLiveHeartbeat,
  searchPeople,
  addAngle,
  listMyLiveSessions,
  controlLiveSession,
  attachTournamentToLive,
  type LiveSessionRow,
  type PersonHit,
} from '@/lib/liveAngles'
import { Avatar } from '@/components/ui'
import { ActionCard } from '@/components/ui/ActionCard'
import { ChipInput } from '@/components/ui/ChipInput'
import { NinjaIcon, type NinjaIconName } from '@/components/ui/NinjaIcon'
import {
  canStreamTo,
  upgradeNudge,
  tierLevel,
  PLACEMENT_LABEL,
  LEVEL_TIER_NAME,
  PLACEMENT_MIN_LEVEL,
  type Placement,
} from '@/lib/tiers'
import { CODE_REDEMPTION_ENABLED } from '@/lib/storeBuild'

/**
 * Go Live — the MERGED host/solo setup.
 *
 * Old app had two doors ("go live — my gameplay" and "host a multi-stream").
 * They're the same thing: you go live, you just pick which STREAM(S) go on the
 * show — your own (optional), other players' (optional), or both. So this is one
 * screen. To keep it "easy, not cluttered" the config lives in COLLAPSIBLE
 * DROPDOWNS, all collapsed by default with sensible defaults, so a host can just
 * hit "Go Live" without touching anything:
 *
 *   • Streams   — search players by name and add their streams as angles; add
 *                 "my stream" (linked YouTube auto, or paste). The merged input.
 *   • Where     — placement (profile / clan / front page / tournament), tier-gated.
 *   • Hosts     — per host: share video+mic / video only / mic only.
 *   • Chat      — on / off.
 *   • Access    — Free or Paid (price stored; NO payment collection here — Phase 2).
 *   • Tournament— connect this live to one of your tournaments, or none.
 *   • Look      — background image + team names (feed the broadcast banner) + title.
 *   • Layout    — preset for where host/chat sit.
 *
 * On submit we insert a `live_streams` row carrying the chosen placement AND the
 * new config columns, then attach any staged other-player streams as angles. The
 * auto-angle + tap/tap-hold VIEWER system is unchanged — this is just the setup.
 */

const PLACEMENTS: { id: Placement; blurb: string; icon: NinjaIconName }[] = [
  { id: 'profile', blurb: 'Shows on your profile for your followers.', icon: 'user' },
  { id: 'clan', blurb: "Featured on your clan's page for all members.", icon: 'clan' },
  { id: 'front_page', blurb: 'Front and center on the TKO home page.', icon: 'torii' },
  { id: 'tournament', blurb: 'Streams to the tournament you\'re competing in.', icon: 'trophy' },
]

// How a host shares their feed. Stored on the row as `host_share`.
type HostShare = 'both' | 'video' | 'mic'
const HOST_SHARE_LABEL: Record<HostShare, string> = {
  both: 'Video + mic',
  video: 'Video only',
  mic: 'Mic only',
}

// Where things sit on screen. Stored on the row as `layout`.
type LayoutPreset = 'auto' | 'host_top_chat_right' | 'host_side_chat_bottom' | 'theater'
const LAYOUTS: { id: LayoutPreset; label: string; blurb: string }[] = [
  { id: 'auto', label: 'Auto', blurb: 'Let TKO place the host + chat.' },
  { id: 'host_top_chat_right', label: 'Host top · chat right', blurb: 'Host centred up top, chat down the side.' },
  { id: 'host_side_chat_bottom', label: 'Host side · chat bottom', blurb: 'Host to the side, chat along the bottom.' },
  { id: 'theater', label: 'Theater', blurb: 'Big stream, chat tucked away.' },
]

type StagedLink = { url: string; label: string }
type TournamentOpt = { id: string; name: string }

export function GoLive() {
  const { user } = useAuth()
  const { isPremium, tier } = useEntitlements()
  const { open: openAskTko } = useAskTko()
  // "Go live for this tournament" deep link (/live?do=golive&tournament=<id>).
  const [searchParams] = useSearchParams()
  const requestedTournamentId = searchParams.get('tournament') || ''

  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [placement, setPlacement] = useState<Placement>('profile')
  const [inTournament, setInTournament] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<Placement | null>(null)

  // ── New, persisted config (all with sensible defaults) ────────────────────
  const [chatEnabled, setChatEnabled] = useState(true)
  const [isPaid, setIsPaid] = useState(false)
  const [priceDollars, setPriceDollars] = useState('') // shown in $, stored in cents
  const [hostShare, setHostShare] = useState<HostShare>('both')
  const [tournamentId, setTournamentId] = useState('') // '' = none
  const [showBracket, setShowBracket] = useState(true)
  const [tournaments, setTournaments] = useState<TournamentOpt[]>([])
  // Tournament connection of the RUNNING show (attachable mid-show — see
  // applyTournamentAttach + the server's live-tournament-attach fn).
  const [attachedTournamentId, setAttachedTournamentId] = useState('')
  const [attachSel, setAttachSel] = useState('')
  const [attachBusy, setAttachBusy] = useState(false)
  const [attachError, setAttachError] = useState('')
  const [backgroundUrl, setBackgroundUrl] = useState('')
  const [teamA, setTeamA] = useState('')
  const [teamB, setTeamB] = useState('')
  const [layout, setLayout] = useState<LayoutPreset>('auto')

  // ── Streams: staged other-player angles to attach right after we go live ──
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PersonHit[]>([])
  const [searching, setSearching] = useState(false)
  const [stagedPlayers, setStagedPlayers] = useState<PersonHit[]>([])
  const [stagedLinks, setStagedLinks] = useState<StagedLink[]>([])
  const [angleUrl, setAngleUrl] = useState('')
  const [angleLabel, setAngleLabel] = useState('')

  const [watchTo, setWatchTo] = useState<string>('/live')
  const [shareUrl, setShareUrl] = useState<string>('')
  const [linked, setLinked] = useState<AutoLinkOutcome | null>(null)
  const [createdStreamId, setCreatedStreamId] = useState<string | null>(null)
  const [recentSessions, setRecentSessions] = useState<LiveSessionRow[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionBusy, setSessionBusy] = useState(false)
  const [replacementUrl, setReplacementUrl] = useState('')

  const LAST_KEY = user ? `kc_last_live_${user.id}` : ''
  const [restored, setRestored] = useState(false)
  const [hasLibrary, setHasLibrary] = useState(false)
  const [savedHandle, setSavedHandle] = useState<string | null>(null)
  const [editingLink, setEditingLink] = useState(false)
  const [backendLinked, setBackendLinked] = useState(false)
  const [autoUrl, setAutoUrl] = useState<string>('')

  // Pre-fill the last stream URL + placement, and work out the "go live from my
  // YouTube" link so a linked user never pastes anything.
  useEffect(() => {
    if (!user) return
    const lib = loadLibrary(user.id)
    setHasLibrary(lib.length > 0)
    const h = loadHandle(user.id)
    setSavedHandle(h)
    void isYouTubeLinked(user.id).then(setBackendLinked)
    if (h) {
      setAutoUrl(youtubeLiveUrl(h))
    } else {
      const cid = loadChannelId(user.id)
      if (cid) setAutoUrl(channelLiveUrl(cid))
      else if (lib.length > 0) {
        resolveChannelId(user.id).then((id) => { if (id) setAutoUrl(channelLiveUrl(id)) })
      }
    }
    try {
      const raw = localStorage.getItem(`kc_last_live_${user.id}`)
      if (!raw) return
      const saved = JSON.parse(raw) as { url?: string; placement?: Placement }
      if (saved?.url) {
        setUrl(saved.url)
        setRestored(true)
      }
      if (saved?.placement) setPlacement(saved.placement)
    } catch { /* ignore malformed cache */ }
  }, [user])

  // Recover the server-owned show after a reload, app restart, or device switch.
  // The browser is only a control surface; losing its local state must not make
  // the host lose the live session or its participant camera slots.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    setSessionsLoading(true)
    void listMyLiveSessions().then((rows) => {
      if (cancelled) return
      setRecentSessions(rows)
      setSessionsLoading(false)
      const active = rows.find((row) => row.is_live)
      if (active) restoreSession(active)
    })
    return () => { cancelled = true }
  // The active id intentionally is not a dependency: this is a login/reload recovery pass.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const youTubeLinked = hasLibrary || restored || !!savedHandle || backendLinked
  // The link we actually broadcast: typed → saved handle → resolved channel →
  // (if the host has no own stream) the first pasted angle link.
  const effectiveUrl = (): string => {
    const typed = url.trim()
    if (typed) return typed
    if (savedHandle) return youtubeLiveUrl(savedHandle)
    if (autoUrl) return autoUrl
    if (stagedLinks[0]?.url) return stagedLinks[0].url
    return ''
  }
  const sourceKnown = youTubeLinked || restored || url.trim().length > 0

  // Which tournaments can this host connect? Their OWN open/active ones
  // (created_by = them, not completed) PLUS any they're a listed admin of.
  // The old lookup read ONLY tournament_admins — and creating a tournament
  // never writes an admin row — so a creator actively running a tournament was
  // told "you're not running a tournament right now". created_by leads now.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    async function loadMyTournaments(userId: string) {
      const found = new Map<string, TournamentOpt>()
      type TRow = { id: string; name: string; status?: string | null }
      try {
        const { data: mine } = await supabase
          .from('tournaments')
          .select('id, name, status')
          .eq('created_by', userId)
        for (const t of (mine ?? []) as TRow[]) {
          if ((t.status ?? 'open') !== 'closed') found.set(t.id, { id: t.id, name: t.name })
        }
      } catch { /* fail-soft — the admin lookup below still runs */ }
      try {
        const { data } = await supabase
          .from('tournament_admins')
          .select('tournament_id')
          .eq('user_id', userId)
        const ids = Array.from(new Set((data ?? []).map((r: { tournament_id?: string }) => r.tournament_id).filter(Boolean))) as string[]
        const missing = ids.filter((id) => !found.has(id))
        if (missing.length) {
          const { data: ts } = await supabase.from('tournaments').select('id, name, status').in('id', missing)
          for (const t of (ts ?? []) as TRow[]) {
            if ((t.status ?? 'open') !== 'closed') found.set(t.id, { id: t.id, name: t.name })
          }
        }
      } catch { /* fail-soft */ }
      if (cancelled) return
      setTournaments(Array.from(found.values()))
      setInTournament(found.size > 0)
    }
    void loadMyTournaments(user.id)
    return () => { cancelled = true }
  }, [user])

  // Pre-connect the deep-linked tournament ("Go live for this tournament" on
  // the tournament page) so the created show carries its id from the start.
  useEffect(() => {
    if (!user || !requestedTournamentId) return
    setTournamentId(requestedTournamentId)
    supabase
      .from('tournaments')
      .select('id, name')
      .eq('id', requestedTournamentId)
      .single()
      .then(({ data }) => {
        const row = data as TournamentOpt | null
        if (!row?.id) return
        setTournaments((cur) => (cur.some((t) => t.id === row.id) ? cur : [...cur, row]))
      })
  }, [user, requestedTournamentId])

  // Debounced people search for the Streams section (reuses Discover's ilike).
  useEffect(() => {
    const q = query.trim()
    if (!q) { setHits([]); return }
    let cancelled = false
    setSearching(true)
    const t = window.setTimeout(async () => {
      const rows = await searchPeople(q, user?.id)
      if (!cancelled) { setHits(rows); setSearching(false) }
    }, 250)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [query, user])

  // Heartbeat while the host sits on the "you're live" screen.
  useEffect(() => {
    if (!createdStreamId) return
    void sendLiveHeartbeat(createdStreamId)
    const t = window.setInterval(() => { void sendLiveHeartbeat(createdStreamId) }, 20_000)
    return () => window.clearInterval(t)
  }, [createdStreamId])

  // ── Not signed in ─────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-md mx-auto text-center">
        <h1 className="text-2xl font-bold mb-2">Go Live</h1>
        <p className="text-gray-400 mb-4">Sign in to start a live stream.</p>
        <Link to="/login" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">Sign in</Link>
      </div>
    )
  }

  // ── Free (not paid) → members-only state ──────────────────────────────────
  if (!isPremium) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold">Go Live</h1>
        <div className="mt-6 rounded-xl border border-accent/40 bg-accent/10 p-6 text-center">
          <div className="text-3xl mb-2">🔴</div>
          <h2 className="text-lg font-semibold text-white">Live streaming is for members</h2>
          <p className="text-gray-300 mt-2">
            {CODE_REDEMPTION_ENABLED
              ? 'Going live — on your profile, your clan page, or the front page — is a paid perk. Redeem a pass or upgrade to unlock it.'
              : 'Going live — on your profile, your clan page, or the front page — is available to eligible members. Existing membership access works automatically in this version.'}
          </p>
          {CODE_REDEMPTION_ENABLED && (
            <Link
              to="/redeem"
              className="inline-block mt-5 px-5 py-2.5 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow"
            >
              Redeem a pass / upgrade
            </Link>
          )}
        </div>
      </div>
    )
  }

  const isUnlocked = (p: Placement): boolean => {
    if (p === 'tournament') return canStreamTo('tournament', tier) && inTournament
    return canStreamTo(p, tier)
  }

  const lockReason = (p: Placement): string => {
    if (p === 'tournament' && !inTournament) return "You're not in a tournament right now."
    return upgradeNudge(p)
  }

  function stagePlayer(person: PersonHit) {
    setStagedPlayers((cur) => (cur.some((p) => p.id === person.id) ? cur : [...cur, person]))
    setQuery('')
    setHits([])
  }
  function unstagePlayer(id: string) {
    setStagedPlayers((cur) => cur.filter((p) => p.id !== id))
  }
  function stageLink() {
    const u = angleUrl.trim()
    if (!u) return
    setStagedLinks((cur) => [...cur, { url: u, label: angleLabel.trim() || 'Added angle' }])
    setAngleUrl('')
    setAngleLabel('')
  }
  function unstageLink(i: number) {
    setStagedLinks((cur) => cur.filter((_, idx) => idx !== i))
  }

  function restoreSession(session: LiveSessionRow) {
    const restoredPlacement = PLACEMENTS.some((item) => item.id === session.placement)
      ? session.placement as Placement
      : 'profile'
    const qs = new URLSearchParams({ u: session.youtube_url })
    if (session.title) qs.set('t', session.title)
    const path = `/watch/${session.id}?${qs.toString()}`
    setCreatedStreamId(session.id)
    setDone(restoredPlacement)
    setWatchTo(path)
    setShareUrl(canonicalShareUrl(path))
    setReplacementUrl(session.youtube_url || '')
    setAttachedTournamentId(session.tournament_id || '')
    setAttachSel(session.tournament_id || '')
  }

  /** Connect (or, with an empty pick, disconnect) a tournament on the running show. */
  async function applyTournamentAttach() {
    if (!createdStreamId || attachBusy) return
    setAttachBusy(true)
    setAttachError('')
    const result = await attachTournamentToLive(createdStreamId, attachSel || null)
    setAttachBusy(false)
    if (!result.ok) {
      setAttachError(result.error || 'Could not connect the tournament.')
      return
    }
    setAttachedTournamentId(attachSel)
  }

  async function refreshSessions() {
    const rows = await listMyLiveSessions()
    setRecentSessions(rows)
    return rows
  }

  async function resumeSession(session: LiveSessionRow) {
    setError('')
    setSessionBusy(true)
    const result = await controlLiveSession(session.id, 'resume', session.youtube_url)
    setSessionBusy(false)
    if (!result.ok) {
      setError(result.error || 'Could not resume that show.')
      return
    }
    restoreSession(result.stream || { ...session, is_live: true })
    await refreshSessions()
  }

  async function changeHostFeed() {
    if (!createdStreamId || !replacementUrl.trim()) return
    setSessionBusy(true)
    const result = await controlLiveSession(createdStreamId, 'resume', replacementUrl)
    setSessionBusy(false)
    if (!result.ok) {
      setError(result.error || 'Could not change the host feed.')
      return
    }
    if (result.stream) restoreSession(result.stream)
    await refreshSessions()
  }

  async function endCurrentSession() {
    if (!createdStreamId) return
    setSessionBusy(true)
    const result = await controlLiveSession(createdStreamId, 'end')
    setSessionBusy(false)
    if (!result.ok) {
      setError(result.error || 'Could not end the show.')
      return
    }
    setDone(null)
    setLinked(null)
    setCreatedStreamId(null)
    setReplacementUrl('')
    await refreshSessions()
  }

  const stagedCount = stagedPlayers.length + stagedLinks.length

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setDone(null)

    if (!isUnlocked(placement)) {
      setError('That destination is locked for your tier — pick another or upgrade.')
      return
    }
    const trimmed = effectiveUrl()
    const isYouTube = !!extractYouTubeId(trimmed) || /youtube\.com\/@[^/]+\/live/i.test(trimmed)
    const isHttps = /^https:\/\/\S+$/i.test(trimmed)
    if (!trimmed) {
      setError(
        stagedCount > 0
          ? 'Add your own stream or paste a link — one stream anchors the show.'
          : 'Connect your YouTube once and we\'ll go live from it — or add a stream below.',
      )
      setEditingLink(true)
      return
    }
    if (!isYouTube && !isHttps) {
      setError('Paste a valid YouTube link or an https:// stream URL.')
      return
    }

    // Money-safety: only store a price when the stream is actually paid, and
    // clamp to a non-negative integer number of cents. NO charge happens here.
    const priceCents = isPaid
      ? Math.max(0, Math.round(Number(priceDollars || '0') * 100)) || 0
      : null

    setBusy(true)
    const { data: inserted, error: err } = await supabase.from('live_streams').insert({
      user_id: user!.id,
      youtube_url: trimmed,
      title: title.trim() || null,
      placement,
      is_live: true,
      chat_enabled: chatEnabled,
      is_paid: isPaid,
      price_cents: priceCents,
      tournament_id: tournamentId || null,
      show_bracket: Boolean(tournamentId && showBracket),
      host_share: hostShare,
      background_url: normalizeLiveBannerUrl(backgroundUrl),
      team_a: teamA.trim() || null,
      team_b: teamB.trim() || null,
      layout,
    }).select().single()
    if (err) {
      setBusy(false)
      setError(err.message)
      return
    }
    const qs = new URLSearchParams({ u: trimmed })
    if (title.trim()) qs.set('t', title.trim())
    const q = `?${qs.toString()}`
    const newId = (inserted as { id?: string } | null)?.id
    if (newId) {
      setWatchTo(`/watch/${newId}${q}`)
      setShareUrl(canonicalShareUrl(`/watch/${newId}${q}`))
      // Attach any staged other-player streams as angles (best-effort — going
      // live already succeeded even if a particular angle can't be resolved).
      for (const p of stagedPlayers) {
        await addAngle({ liveStreamId: newId, userId: p.id, label: p.username ?? undefined })
      }
      for (const l of stagedLinks) {
        // The first pasted link may have BEEN the row source (host with no own
        // stream); don't also add it as a duplicate angle.
        if (l.url === trimmed) continue
        await addAngle({ liveStreamId: newId, youtubeUrl: l.url, label: l.label })
      }
      setCreatedStreamId(newId)
      setAttachedTournamentId(tournamentId || '')
      setAttachSel(tournamentId || '')
    } else {
      setWatchTo(`/watch${q}`)
      setShareUrl(canonicalShareUrl(`/watch${q}`))
    }
    setBusy(false)
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ url: trimmed, placement }))
    } catch { /* ignore */ }
    setRestored(false)
    setDone(placement)
    setUrl('')
    setTitle('')
    setStagedPlayers([])
    setStagedLinks([])

    if (newId && user) {
      autoLinkForStream(newId, user.id)
        .then((res) => { if (res) setLinked(res) })
        .catch(() => { /* going live already succeeded */ })
    }
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold">You're live 🔴</h1>
        <div className="mt-6 rounded-xl border border-leaf/40 bg-leaf/10 p-6">
          <p className="text-white font-semibold">Your stream is now live on {PLACEMENT_LABEL[done]}.</p>
          <p className="text-gray-300 text-sm mt-1">Watch it play right here, or share the link so others can jump in.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to={watchTo} className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">
              ▶ Watch my stream
            </Link>
            {shareUrl && (
              <ShareButton url={shareUrl} title="I'm live on TKO" text="Watch my live stream on TKO" />
            )}
            <button
              type="button"
              onClick={endCurrentSession}
              disabled={sessionBusy}
              className="px-4 py-2 rounded-lg border border-kunai/60 text-kunai hover:bg-kunai/10 disabled:opacity-50"
            >
              {sessionBusy ? 'Ending...' : 'End show'}
            </button>
          </div>
          {createdStreamId && (
            <div className="mt-4 border-t border-leaf/20 pt-4">
              <label className="block text-xs uppercase tracking-wider text-gray-400 mb-1.5" htmlFor="replacement-live-url">
                Change my live feed
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="replacement-live-url"
                  type="url"
                  value={replacementUrl}
                  onChange={(event) => setReplacementUrl(event.target.value)}
                  placeholder="Paste the replacement live link"
                  className="min-w-0 flex-1 px-3 py-2 rounded-lg bg-dark border border-dark-border text-sm text-white focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={changeHostFeed}
                  disabled={sessionBusy || !replacementUrl.trim()}
                  className="px-4 py-2 rounded-lg border border-accent/50 text-accent font-semibold hover:bg-accent/10 disabled:opacity-40"
                >
                  Change feed
                </button>
              </div>
              {error && <p className="mt-2 text-xs text-kunai">{error}</p>}
            </div>
          )}
        </div>

        {/* Connect the show to one of the host's tournaments — attachable
            MID-SHOW too, so going live before picking one never strands the
            bracket. Server-validated: host-only, own tournament, not closed. */}
        {createdStreamId && (
          <div className="mt-4 rounded-xl border border-dark-border bg-dark-card p-5">
            <h2 className="text-lg font-bold text-white">Tournament</h2>
            {attachedTournamentId ? (
              <p className="text-sm text-gray-300 mt-1">
                This show is connected to{' '}
                <span className="text-accent font-semibold">
                  {tournaments.find((t) => t.id === attachedTournamentId)?.name ?? 'your tournament'}
                </span>
                .
              </p>
            ) : (
              <p className="text-sm text-gray-400 mt-1">
                Running a tournament? Connect it and this show carries the bracket.
              </p>
            )}
            {tournaments.length > 0 ? (
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <select
                  value={attachSel}
                  onChange={(e) => setAttachSel(e.target.value)}
                  aria-label="Tournament to connect"
                  className="min-w-0 flex-1 px-3 py-2 rounded-lg bg-dark border border-dark-border text-sm text-white focus:outline-none focus:border-accent"
                >
                  <option value="">None</option>
                  {tournaments.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void applyTournamentAttach()}
                  disabled={attachBusy || attachSel === attachedTournamentId}
                  className="px-4 py-2 rounded-lg border border-accent/50 text-accent font-semibold hover:bg-accent/10 disabled:opacity-40"
                >
                  {attachBusy ? 'Connecting…' : attachSel ? 'Connect' : 'Disconnect'}
                </button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-500">
                You're not running a tournament right now.{' '}
                <Link to="/tournaments?create=1" className="text-accent hover:underline">
                  Create a tournament →
                </Link>
              </p>
            )}
            {attachError && <p className="mt-2 text-xs text-kunai">{attachError}</p>}
          </div>
        )}

        {/* Add / manage more camera angles live. Available to every host now —
            the merged Go Live means any stream can become a multi-angle show. */}
        {createdStreamId && (
          <div className="mt-4">
            <div className="mb-2">
              <h2 className="text-lg font-bold text-white">Add more players to your show</h2>
              <p className="text-sm text-gray-400">
                Search a player by name and add their live as another angle. You're the host —
                viewers switch between every camera on one screen.
              </p>
            </div>
            <HostAnglePanel liveStreamId={createdStreamId} />
          </div>
        )}

        {linked && !linked.pending && linked.groupId && (
          <div className="mt-4 rounded-xl border border-accent bg-accent/10 p-5">
            <p className="text-white font-semibold">
              {linked.stage.reason === 'scheduled_battle'
                ? '⚔ Your opponent is live too'
                : "You've been linked with who's live"}
            </p>
            <p className="text-gray-300 text-sm mt-1">
              {linked.stage.reason === 'scheduled_battle'
                ? 'Both fighters are live — your battle now plays from both angles, and your followers have been notified.'
                : `${linked.stage.title} — every angle is on one screen now.`}
            </p>
            <Link
              to={`/live-stage/${linked.groupId}`}
              className="inline-block mt-4 px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow"
            >
              {linked.stage.reason === 'scheduled_battle' ? 'Watch both angles' : 'Open the combined view'}
            </Link>
            {user && (
              <div className="mt-3">
                <LiveLinkOptOut
                  groupId={linked.groupId}
                  userId={user.id}
                  onLeft={() => setLinked(null)}
                />
              </div>
            )}
          </div>
        )}

        {linked && linked.pending && (
          <div className="mt-4 rounded-xl border border-dark-border bg-dark-card p-5">
            <p className="text-white font-semibold">Link your streams?</p>
            <p className="text-gray-300 text-sm mt-1">
              {linked.stage.title} — nothing has been connected. Say the word and your viewers get
              every angle on one screen.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (!user) return
                  const res = await acceptProposedStage(linked.stage, user.id)
                  if (res) setLinked({ ...linked, groupId: res.groupId, pending: false })
                }}
                className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow"
              >
                Yes, link us
              </button>
              <button
                type="button"
                onClick={() => setLinked(null)}
                className="px-4 py-2 rounded-lg border border-dark-border text-gray-300 hover:border-accent/50"
              >
                Not this time
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Summaries shown on each collapsed dropdown header, so a host sees the current
  // choice without expanding — "clean, not cluttered".
  const streamsSummary =
    stagedCount > 0
      ? `${sourceKnown ? 'Your stream' : 'Host'} + ${stagedCount} added`
      : sourceKnown ? 'Your stream — ready' : 'Add a stream'

  // ── The form ──────────────────────────────────────────────────────────────
  return (
    <div className="p-6 sm:p-8 max-w-2xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold">Go Live</h1>
        <button
          type="button"
          onClick={() => openAskTko('go-live')}
          className="shrink-0 mt-1 text-xs text-accent hover:underline"
        >
          Need help? Ask TKO →
        </button>
      </div>
      <p className="text-sm text-gray-500 mt-1">
        Add stream(s) — yours, other players', or both — and hit Go Live. Everything below is
        optional: sensible defaults are already set, so you can just go.
      </p>

      {sessionsLoading && <p className="mt-4 text-sm text-gray-500">Checking for your live shows...</p>}
      {!sessionsLoading && recentSessions.some((session) => !session.is_live) && (
        <div className="mt-5 rounded-xl border border-dark-border bg-dark-card p-4">
          <h2 className="text-sm font-bold text-white">Recover a previous show</h2>
          <p className="mt-1 text-xs text-gray-400">Resume it with its camera slots, or start a fresh show below.</p>
          <div className="mt-3 space-y-2">
            {recentSessions.filter((session) => !session.is_live).slice(0, 3).map((session) => (
              <div key={session.id} className="flex items-center justify-between gap-3 rounded-lg border border-dark-border bg-dark px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{session.title || 'Untitled live show'}</p>
                  <p className="text-xs text-gray-500">{session.angle_count || 0} added camera slot{session.angle_count === 1 ? '' : 's'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => resumeSession(session)}
                  disabled={sessionBusy}
                  className="shrink-0 rounded-lg border border-accent/50 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-40"
                >
                  Resume
                </button>
              </div>
            ))}
          </div>
          {error && <p className="mt-2 text-xs text-kunai">{error}</p>}
        </div>
      )}

      {youTubeLinked ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-leaf">
          <span className="text-base leading-none">✓</span>
          <span>Your YouTube is linked — you're set to go live.</span>
        </div>
      ) : (
        <div className="mt-4 text-sm text-gray-400">
          <Link to="/highlight/create" className="text-accent hover:underline">Link your YouTube in Create</Link>{' '}
          to go live faster.
        </div>
      )}

      <form onSubmit={submit} className="mt-6 space-y-3">
        {/* ── Streams (open by default — it's the one thing you usually touch) ── */}
        <Section icon="clan" title="Streams" summary={streamsSummary} defaultOpen>
          {/* Your own stream (optional — auto-connects from your linked YouTube). */}
          <div className="rounded-lg border border-dark-border bg-dark p-3">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">My stream (optional)</p>
            {sourceKnown && !editingLink ? (
              <div className="flex items-center gap-3 flex-wrap">
                <ConnectedBadge
                  label={
                    savedHandle
                      ? `Your YouTube — @${savedHandle}`
                      : youTubeLinked ? 'Your YouTube' : 'Your stream link — saved'
                  }
                />
                {(savedHandle || (youTubeLinked && !restored)) && (
                  <span className="text-xs text-leaf">auto-connects when you go live</span>
                )}
                <button type="button" onClick={() => setEditingLink(true)} className="text-xs text-accent hover:underline">
                  Use a different link ▾
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setRestored(false) }}
                  placeholder="https://youtube.com/watch?v=…  or any https:// stream"
                  className="w-full px-3 py-2 rounded-lg bg-dark-card border border-dark-border text-white text-sm focus:outline-none focus:border-accent"
                />
                {youTubeLinked && (
                  <button
                    type="button"
                    onClick={() => { setUrl(''); setEditingLink(false) }}
                    className="text-xs text-accent hover:underline"
                  >
                    ← Use my YouTube instead
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Other players' streams — search by name (reuses Discover's ilike). */}
          <div className="mt-3">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Add other players (optional)</p>
            <div className="relative">
              <NinjaIcon name="search" size={16} className="text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a player by name…"
                className="w-full pl-8 pr-3 py-2 rounded-lg bg-dark border border-dark-border text-sm text-white focus:outline-none focus:border-accent"
              />
            </div>
            {searching && <p className="mt-1 text-xs text-gray-500">Searching…</p>}
            {hits.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {hits.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <Avatar src={p.avatar_url} name={p.username ?? 'player'} seed={p.id} size={24} />
                      <span className="truncate text-sm text-white">@{p.username ?? 'player'}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => stagePlayer(p)}
                      className="shrink-0 inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-dark hover:shadow-glow"
                    >
                      <NinjaIcon name="plus" size={14} /> Add
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Paste-a-link fallback for a stream with no linked player. */}
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
              <input
                value={angleUrl}
                onChange={(e) => setAngleUrl(e.target.value)}
                placeholder="…or paste a stream link"
                className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-sm text-white focus:outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={stageLink}
                disabled={!angleUrl.trim()}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-accent/50 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                <NinjaIcon name="plus" size={14} /> Add link
              </button>
            </div>

            {(stagedPlayers.length > 0 || stagedLinks.length > 0) && (
              <ul className="mt-3 space-y-1.5">
                {stagedPlayers.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm text-gray-300">
                    <span className="min-w-0 truncate">@{p.username ?? 'player'}</span>
                    <button type="button" onClick={() => unstagePlayer(p.id)} className="text-gray-500 hover:text-kunai" aria-label="Remove">
                      <NinjaIcon name="plus" size={15} className="rotate-45" />
                    </button>
                  </li>
                ))}
                {stagedLinks.map((l, i) => (
                  <li key={`${l.url}-${i}`} className="flex items-center justify-between gap-2 text-sm text-gray-300">
                    <span className="min-w-0 truncate">{l.label}</span>
                    <button type="button" onClick={() => unstageLink(i)} className="text-gray-500 hover:text-kunai" aria-label="Remove">
                      <NinjaIcon name="plus" size={15} className="rotate-45" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        {/* ── Where it shows (placement) — tier-gated ─────────────────────── */}
        <Section icon="torii" title="Where it shows" summary={PLACEMENT_LABEL[placement]}>
          <div className="grid sm:grid-cols-2 gap-3">
            {PLACEMENTS.map(({ id, blurb, icon }) => {
              const unlocked = isUnlocked(id)
              const lockTag = id === 'tournament' ? 'Locked' : LEVEL_TIER_NAME[PLACEMENT_MIN_LEVEL[id]]
              return (
                <ActionCard
                  key={id}
                  icon={icon}
                  label={PLACEMENT_LABEL[id]}
                  sublabel={unlocked ? blurb : lockReason(id)}
                  selected={placement === id}
                  locked={!unlocked}
                  lockTag={lockTag}
                  onClick={() => setPlacement(id)}
                />
              )
            })}
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Tier: <span className="text-accent font-medium">{LEVEL_TIER_NAME[Math.max(1, tierLevel(tier))] ?? 'Pro'}</span>.
            Higher placements need a higher tier.
            {CODE_REDEMPTION_ENABLED && <>{' '}<Link to="/redeem" className="text-accent hover:underline">Upgrade →</Link></>}
          </p>
        </Section>

        {/* ── Hosts: how each host shares their feed ──────────────────────── */}
        <Section icon="user" title="Hosts" summary={HOST_SHARE_LABEL[hostShare]}>
          <label className="block text-sm text-gray-400 mb-2">For each host / angle, share:</label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(HOST_SHARE_LABEL) as HostShare[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setHostShare(k)}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                  hostShare === k
                    ? 'border-accent bg-accent/15 text-white'
                    : 'border-dark-border bg-dark text-gray-300 hover:border-accent/50'
                }`}
              >
                {HOST_SHARE_LABEL[k]}
              </button>
            ))}
          </div>
        </Section>

        {/* ── Chat: on / off ──────────────────────────────────────────────── */}
        <Section icon="chat" title="Chat" summary={chatEnabled ? 'On' : 'Off'}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-300">Let viewers chat during your stream.</span>
            <Toggle checked={chatEnabled} onChange={setChatEnabled} label="Chat" />
          </div>
        </Section>

        {/* ── Access: free / paid (price stored only; NO collection — Phase 2) ── */}
        <Section icon="ticket" title="Access" summary={isPaid ? `Paid${priceDollars ? ` · $${priceDollars}` : ''}` : 'Free'}>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setIsPaid(false)}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                !isPaid ? 'border-accent bg-accent/15 text-white' : 'border-dark-border bg-dark text-gray-300 hover:border-accent/50'
              }`}
            >
              Free
            </button>
            <button
              type="button"
              onClick={() => setIsPaid(true)}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                isPaid ? 'border-accent bg-accent/15 text-white' : 'border-dark-border bg-dark text-gray-300 hover:border-accent/50'
              }`}
            >
              Paid
            </button>
          </div>
          {isPaid && (
            <div className="mt-3">
              <label className="block text-sm text-gray-400 mb-1">Price</label>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={priceDollars}
                  onChange={(e) => setPriceDollars(e.target.value)}
                  placeholder="4.99"
                  className="w-32 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-accent"
                />
              </div>
              <p className="mt-1 text-xs text-gray-600">
                We save the price now. Paid access checkout is coming in a later update.
              </p>
            </div>
          )}
        </Section>

        {/* ── Tournament: connect this live to one of yours, or none ──────── */}
        <Section
          icon="trophy"
          title="Tournament"
          summary={tournamentId ? (tournaments.find((t) => t.id === tournamentId)?.name ?? 'Connected') : 'None'}
        >
          {tournaments.length > 0 ? (
            <select
              value={tournamentId}
              onChange={(e) => {
                setTournamentId(e.target.value)
                if (!e.target.value) setShowBracket(false)
              }}
              className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-accent"
            >
              <option value="">None</option>
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          ) : (
            <div className="text-sm text-gray-500">
              <p>You're not running a tournament right now — nothing to connect.</p>
              <Link to="/tournaments?create=1" className="mt-1 inline-block text-accent hover:underline">
                Create a tournament →
              </Link>
            </div>
          )}
        </Section>

        {/* ── Look: background + team names (feed the broadcast banner) + title ── */}
        {tournamentId && (
          <div className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-dark-border bg-dark-card px-4 py-3">
            <div>
              <p className="text-sm font-medium text-white">Show live bracket</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Keep advancing player art visible beneath the match.
              </p>
            </div>
            <Toggle checked={showBracket} onChange={setShowBracket} label="Show live bracket" />
          </div>
        )}

        <Section
          icon="sparkle"
          title="Look"
          summary={teamA || teamB ? `${teamA || 'Team A'} vs ${teamB || 'Team B'}` : 'Default'}
        >
          <p className="mb-2 text-sm font-semibold text-white">Stream banner</p>
          <LiveBannerEditor
            value={backgroundUrl}
            onChange={setBackgroundUrl}
            title={title}
            teamA={teamA}
            teamB={teamB}
          />
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-gray-500">Legacy image URL</summary>
            <label className="mt-2 block text-sm text-gray-400 mb-1">Background image</label>
          <input
            type="url"
            value={backgroundUrl}
            onChange={(e) => setBackgroundUrl(e.target.value)}
            placeholder="https://…/background.png (url or upload link)"
            className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-accent"
            />
          </details>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ChipInput fieldKey="live_team_a" value={teamA} onChange={setTeamA} label="Team A" placeholder="Leaf" />
            <ChipInput fieldKey="live_team_b" value={teamB} onChange={setTeamB} label="Team B" placeholder="Sand" />
          </div>
          <div className="mt-3">
            <ChipInput fieldKey="live_title" value={title} onChange={setTitle} label="Show title" placeholder="Ranked grind — road to A-rank" />
          </div>
        </Section>

        {/* ── Layout: quick presets for where host + chat sit ─────────────── */}
        <Section icon="scroll" title="Layout" summary={LAYOUTS.find((l) => l.id === layout)?.label ?? 'Auto'}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLayout(l.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  layout === l.id ? 'border-accent bg-accent/15' : 'border-dark-border bg-dark hover:border-accent/50'
                }`}
              >
                <span className="block text-sm font-semibold text-white">{l.label}</span>
                <span className="block text-xs text-gray-500">{l.blurb}</span>
              </button>
            ))}
          </div>
        </Section>

        {error && <p className="text-kunai text-sm">{error}</p>}

        <button
          type="submit"
          disabled={busy || !isUnlocked(placement)}
          className="w-full py-3 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
        >
          {busy ? 'Going live…' : `Go Live on ${PLACEMENT_LABEL[placement]}`}
        </button>
      </form>
    </div>
  )
}

// ── A clean, collapsible dropdown section — collapsed by default, shows the
// current value in its header so nothing needs opening to be understood. ──────
function Section({
  icon,
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  icon: NinjaIconName
  title: string
  summary?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-dark-elevated transition-colors"
      >
        <span className="shrink-0 text-accent"><NinjaIcon name={icon} size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-white">{title}</span>
          {summary != null && <span className="block text-xs text-gray-500 truncate">{summary}</span>}
        </span>
        <span className={`shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}>
          <NinjaIcon name="chevron-down" size={18} />
        </span>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="px-4 pb-4 pt-1">{children}</div>
        </div>
      </div>
    </div>
  )
}

// A small on/off switch (Tailwind core, inline — no deps).
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-dark-elevated border border-dark-border'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
