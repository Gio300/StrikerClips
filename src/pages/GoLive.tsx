import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import { extractYouTubeId } from '@/lib/youtubeApi'
import { ConnectedBadge } from '@/components/ConnectedBadge'
import { ShareButton } from '@/components/ShareButton'
import { useAskTko } from '@/components/AskTkoContext'
import { loadLibrary, loadHandle, youtubeLiveUrl, loadChannelId, channelLiveUrl, resolveChannelId } from '@/lib/youtubeConnect'
import { isYouTubeLinked } from '@/lib/youtubeLink'
import { acceptProposedStage, autoLinkForStream, type AutoLinkOutcome } from '@/lib/liveLinkService'
import { LiveLinkOptOut } from '@/components/LiveLinkOptOut'
import { StepFlow, Step } from '@/components/ui/StepFlow'
import { ActionCard } from '@/components/ui/ActionCard'
import { ChipInput } from '@/components/ui/ChipInput'
import type { NinjaIconName } from '@/components/ui/NinjaIcon'
import {
  canStreamTo,
  upgradeNudge,
  tierLevel,
  PLACEMENT_LABEL,
  LEVEL_TIER_NAME,
  PLACEMENT_MIN_LEVEL,
  type Placement,
} from '@/lib/tiers'

/**
 * Go Live — pick a stream URL + WHERE it's placed, then broadcast.
 *
 * Rules (owner):
 *  - You must be a PAYING member to live stream at all. Free users see a
 *    members-only state with a link to /redeem.
 *  - Placement is tier-gated: My Profile (Pro) < My Clan Page (Supporter) <
 *    Front Page (Creator). Tournament streams only if you're in one.
 *  - Locked placements stay VISIBLE with a lock + one-line upgrade nudge, so
 *    users naturally see the next tier.
 *
 * Works standalone against the supabase shim (mock backend). On submit we insert
 * a `live_streams` row carrying the chosen `placement`.
 */

const PLACEMENTS: { id: Placement; blurb: string; icon: NinjaIconName }[] = [
  { id: 'profile', blurb: 'Shows on your profile for your followers.', icon: 'user' },
  { id: 'clan', blurb: "Featured on your clan's page for all members.", icon: 'clan' },
  { id: 'front_page', blurb: 'Front and center on the TKO home page.', icon: 'torii' },
  { id: 'tournament', blurb: 'Streams to the tournament you\'re competing in.', icon: 'trophy' },
]

export function GoLive() {
  const { user } = useAuth()
  const { isPremium, tier } = useEntitlements()
  const { open: openAskTko } = useAskTko()

  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [placement, setPlacement] = useState<Placement>('profile')
  const [inTournament, setInTournament] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<Placement | null>(null)
  // Where to send them to watch what they just started — a real stream page if
  // we got the row id back, else the direct-URL watch fallback.
  const [watchTo, setWatchTo] = useState<string>('/live')
  const [shareUrl, setShareUrl] = useState<string>('')
  // Set when the link engine connected this stream to someone already live
  // (a scheduled opponent, a clanmate, a fellow entrant) — see liveLink.ts.
  const [linked, setLinked] = useState<AutoLinkOutcome | null>(null)

  // "Remember me" state: did we pre-fill from a saved stream link, and does the
  // user already have a linked YouTube (a connected clip library or a link they
  // saved before)? Keyed per user so it feels personal, not global.
  const LAST_KEY = user ? `kc_last_live_${user.id}` : ''
  const [restored, setRestored] = useState(false)
  const [hasLibrary, setHasLibrary] = useState(false)
  // Their saved YouTube @handle — so we go live from their channel automatically
  // and never make them paste a link. Only revealed for editing on request.
  const [savedHandle, setSavedHandle] = useState<string | null>(null)
  const [editingLink, setEditingLink] = useState(false)
  // Cross-device truth: connected even if this device has no local cache.
  const [backendLinked, setBackendLinked] = useState(false)
  // The link we'll auto-broadcast from their channel (handle live tab, or a
  // resolved channel-id live URL) — so a linked user never pastes anything.
  const [autoUrl, setAutoUrl] = useState<string>('')

  // Pre-fill the last stream URL + placement the user submitted, so a returning
  // user just taps Go Live again.
  useEffect(() => {
    if (!user) return
    const lib = loadLibrary(user.id)
    setHasLibrary(lib.length > 0)
    const h = loadHandle(user.id)
    setSavedHandle(h)
    void isYouTubeLinked(user.id).then(setBackendLinked)
    // Work out the "go live from my YouTube" link, no paste needed:
    //  1) a saved @handle → its /live tab
    //  2) a cached channel id → channel /live
    //  3) resolve the channel id from their library once, then use that.
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

  // Their YouTube counts as "linked" if we have a cached library, a saved
  // channel handle, or they've saved a stream link before.
  const youTubeLinked = hasLibrary || restored || !!savedHandle || backendLinked
  // The link we'll actually broadcast: whatever they typed, else their saved
  // channel's live URL, else the last stream link they used.
  const effectiveUrl = (): string => {
    const typed = url.trim()
    if (typed) return typed
    if (savedHandle) return youtubeLiveUrl(savedHandle)
    if (autoUrl) return autoUrl
    return ''
  }
  // If their YouTube is linked at all, we already know the source — show it as
  // done and keep the paste box tucked away behind a dropdown.
  const sourceKnown = youTubeLinked || restored || url.trim().length > 0

  // Am I in a tournament right now? (Being a tournament admin counts.) In the
  // mock backend this is empty, so the Tournament card stays honestly locked.
  useEffect(() => {
    if (!user) return
    supabase
      .from('tournament_admins')
      .select('id')
      .eq('user_id', user.id)
      .then(({ data }) => setInTournament((data?.length ?? 0) > 0))
  }, [user])

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
            Going live — on your profile, your clan page, or the front page — is a paid perk.
            Redeem a pass or upgrade to unlock it.
          </p>
          <Link
            to="/redeem"
            className="inline-block mt-5 px-5 py-2.5 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow"
          >
            Redeem a pass / upgrade
          </Link>
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

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setDone(null)

    if (!isUnlocked(placement)) {
      setError('That destination is locked for your tier — pick another or upgrade.')
      return
    }
    const trimmed = effectiveUrl()
    // Accept a YouTube link (validated), a channel live URL, OR any https stream.
    const isYouTube = !!extractYouTubeId(trimmed) || /youtube\.com\/@[^/]+\/live/i.test(trimmed)
    const isHttps = /^https:\/\/\S+$/i.test(trimmed)
    if (!trimmed) {
      setError('Connect your YouTube once and we\'ll go live from it — or add a link below.')
      setEditingLink(true)
      return
    }
    if (!isYouTube && !isHttps) {
      setError('Paste a valid YouTube link or an https:// stream URL.')
      return
    }

    setBusy(true)
    const { data: inserted, error: err } = await supabase.from('live_streams').insert({
      user_id: user!.id,
      youtube_url: trimmed,
      title: title.trim() || null,
      placement,
      is_live: true,
    }).select().single()
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    // Point them at the playing stream: a real /watch/:id page if we got the row
    // id back, else /watch?u=<url> so it still plays and is shareable.
    // Carry the stream url in the link so a shared link plays for anyone who
    // opens it — even where the stream row doesn't exist (no backend/profile).
    const qs = new URLSearchParams({ u: trimmed })
    if (title.trim()) qs.set('t', title.trim())
    const q = `?${qs.toString()}`
    const newId = (inserted as { id?: string } | null)?.id
    if (newId) {
      setWatchTo(`/watch/${newId}${q}`)
      setShareUrl(`https://tko.cam/watch/${newId}${q}`)
    } else {
      setWatchTo(`/watch${q}`)
      setShareUrl(`https://tko.cam/watch${q}`)
    }
    // Remember this stream link + placement for next time.
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ url: trimmed, placement }))
    } catch { /* ignore */ }
    setRestored(false)
    setDone(placement)
    setUrl('')
    setTitle('')

    // CONNECT IT FOR THEM. If someone they're actually matched with is already
    // live — their scheduled opponent, a clanmate, a fellow entrant — link the
    // streams into one multi-angle stage and notify both sides + their
    // followers. Best-effort: never blocks or fails going live.
    //
    // Unless somebody said otherwise: if either side's autoLinkMode is 'ask' the
    // result comes back `pending` (a proposal, nothing joined) and if either is
    // 'off', or there's a block between them, nothing comes back at all.
    if (newId && user) {
      autoLinkForStream(newId, user.id)
        .then((res) => {
          if (res) setLinked(res)
        })
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
              onClick={() => { setDone(null); setLinked(null) }}
              className="px-4 py-2 rounded-lg border border-dark-border text-white hover:border-accent/50"
            >
              Start another
            </button>
          </div>
        </div>

        {/* WE CONNECTED IT FOR THEM. Someone they're actually matched with was
            already live, so their streams are now one multi-angle view — and
            both sides + their followers have been told. */}
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
            {/* The way out, right where the link is announced. */}
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

        {/* PROPOSED, not linked — one of you asked to be consulted first. */}
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
        Paste your live stream link, choose where it goes, and broadcast.
      </p>

      {/* "Your channel" memory — remembered so you don't reconnect every time. */}
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

      <form onSubmit={submit} className="mt-6">
        <StepFlow>
          {/* 1 · Source — we already know their YouTube, so there's nothing to
              paste. The link box only appears if they choose to use a different
              one (a dropdown), so lengthy copy-paste is never in the way. */}
          <Step title="Stream source" complete={sourceKnown}>
            {sourceKnown && !editingLink ? (
              <div className="flex items-center gap-3 flex-wrap">
                <ConnectedBadge
                  label={
                    savedHandle
                      ? `Your YouTube — @${savedHandle}`
                      : youTubeLinked
                        ? 'Your YouTube'
                        : 'Your stream link — saved'
                  }
                />
                {(savedHandle || (youTubeLinked && !restored)) && (
                  <span className="text-xs text-leaf">auto-connects when you go live</span>
                )}
                <button
                  type="button"
                  onClick={() => setEditingLink(true)}
                  className="text-xs text-accent hover:underline"
                >
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
                  className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
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
          </Step>

          {/* 2 · Placement (required) — button-first ActionCards, tier-gated */}
          <Step
            title="Where should it go?"
            complete={isUnlocked(placement)}
            hint={<>Tier: <span className="text-accent font-medium">{LEVEL_TIER_NAME[Math.max(1, tierLevel(tier))] ?? 'Pro'}</span></>}
          >
            <div className="grid sm:grid-cols-2 gap-3">
              {PLACEMENTS.map(({ id, blurb, icon }) => {
                const unlocked = isUnlocked(id)
                const selected = placement === id
                const lockTag = id === 'tournament' ? 'Locked' : LEVEL_TIER_NAME[PLACEMENT_MIN_LEVEL[id]]
                return (
                  <ActionCard
                    key={id}
                    icon={icon}
                    label={PLACEMENT_LABEL[id]}
                    sublabel={unlocked ? blurb : lockReason(id)}
                    selected={selected}
                    locked={!unlocked}
                    lockTag={lockTag}
                    onClick={() => setPlacement(id)}
                  />
                )
              })}
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Higher placements need a higher tier.{' '}
              <Link to="/redeem" className="text-accent hover:underline">Upgrade →</Link>
            </p>
          </Step>

          {/* 3 · Title (optional) — collapsed behind "+ Add a title" */}
          <Step title="Title" optional addLabel="Add a title">
            <ChipInput
              fieldKey="live_title"
              value={title}
              onChange={setTitle}
              placeholder="Ranked grind — road to A-rank"
            />
          </Step>
        </StepFlow>

        {error && <p className="text-kunai text-sm mb-3">{error}</p>}

        <button
          type="submit"
          disabled={busy || !isUnlocked(placement)}
          className="w-full py-3 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
        >
          {busy ? 'Going live…' : `Go live on ${PLACEMENT_LABEL[placement]}`}
        </button>
      </form>
    </div>
  )
}
