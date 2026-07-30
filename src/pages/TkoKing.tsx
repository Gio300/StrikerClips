import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { StepFlow, Step } from '@/components/ui/StepFlow'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { Avatar } from '@/components/ui'
import { useAskTko } from '@/components/AskTkoContext'
import { PitMeetup } from '@/components/PitMeetup'
import { KingLadderPanel } from '@/components/KingLadderPanel'
import { isYouTubeLinked } from '@/lib/youtubeLink'
import { notify } from '@/lib/notifications'
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'
import { startTrialMeta, TRIAL_DAYS } from '@/lib/trial'
import { ensureKing } from '@/lib/kingTournament'
import {
  KING_TAGLINE,
  isTkoHost,
  membershipGrantMeta,
  canRegister,
  registrationProgress,
  registrationChannelSettled,
  REGISTRATION_REQUIRED_COUNT,
  kingPhase,
  kingPhaseState,
  isEnrollmentOpen,
  isScheduledEnrollmentOpen,
  battleStatusLabel,
  battleTimingLabel,
  upcomingBattles,
  buildKingBoard,
  awardBattlePrize,
  prizeNotification,
  isBattleDecided,
  forfeitOutcome,
  type RegistrationChecklist,
  type KingPhase,
} from '@/lib/tkoKing'
import type { Tournament, TournamentRegistration, TournamentBattle, BattleStatus } from '@/types/database'

// ─────────────────────────────────────────────────────────────────────────
//  Types local to this page
// ─────────────────────────────────────────────────────────────────────────

type Registration = TournamentRegistration & { username?: string; avatar_url?: string | null }
type Battle = TournamentBattle & { a_name?: string; b_name?: string }

// NOTE: the Shinobi Trophy Closet upsert used to live here as a client-side
// read-modify-write against `shinobi_defeats`. It now happens inside
// /api/fn/king-prize, together with the artifact grant, so a decided battle
// produces the closet entry and the prize atomically and neither can be forged
// (the table is insert-'elevated' — only a host can write it at all).

// ─────────────────────────────────────────────────────────────────────────
//  Page
// ─────────────────────────────────────────────────────────────────────────

export function TkoKing() {
  const { user, refreshUser } = useAuth()
  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [battles, setBattles] = useState<Battle[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  const host = isTkoHost(user) || Boolean(user?.id && tournament?.created_by === user.id)
  // The season phase comes from KING_SCHEDULE alone — no organizer, no row
  // needed. The row phase (kingPhase) agrees with it because the seeded row's
  // windows ARE the schedule constants.
  const season = useMemo(() => kingPhaseState(now), [now])
  const phase: KingPhase = useMemo(() => (tournament ? kingPhase(tournament, now) : 'enroll'), [tournament, now])
  const myReg = useMemo(() => registrations.find((r) => r.user_id === user?.id) ?? null, [registrations, user])

  // Tick so the countdown to the next phase stays live.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  async function reload() {
    setLoading(true)
    // The King ALWAYS exists: find-or-create it from the schedule constants,
    // the same way ensureTkoSpace seeds the official chat space.
    const featured = await ensureKing(user?.id ?? null)
    setTournament(featured)
    if (featured) {
      const [regRes, batRes] = await Promise.all([
        supabase.from('tournament_registrations').select('*').eq('tournament_id', featured.id),
        supabase
          .from('tournament_battles')
          .select('*')
          .eq('tournament_id', featured.id)
          .order('scheduled_at', { ascending: true, nullsFirst: false }),
      ])
      const regs = (regRes.data ?? []) as Registration[]
      const bats = (batRes.data ?? []) as Battle[]
      // Enrich usernames.
      const ids = new Set<string>()
      regs.forEach((r) => ids.add(r.user_id))
      bats.forEach((b) => { ids.add(b.player_a); if (b.player_b) ids.add(b.player_b) })
      const nameMap = new Map<string, { username: string; avatar_url: string | null }>()
      if (ids.size > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .in('id', Array.from(ids))
        for (const p of profs ?? []) nameMap.set(p.id, { username: p.username, avatar_url: p.avatar_url })
      }
      setRegistrations(regs.map((r) => ({ ...r, username: nameMap.get(r.user_id)?.username, avatar_url: nameMap.get(r.user_id)?.avatar_url ?? null })))
      setBattles(bats.map((b) => ({ ...b, a_name: nameMap.get(b.player_a)?.username, b_name: b.player_b ? nameMap.get(b.player_b)?.username : undefined })))
    } else {
      setRegistrations([])
      setBattles([])
    }
    setLoading(false)
  }

  useEffect(() => { reload() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id])

  if (loading) {
    return <div className="p-6 max-w-4xl mx-auto animate-pulse text-gray-400">Loading TKO King…</div>
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <KingHeader />

      {/* THE way in: the never-ending, auto-matched ladder. Register anytime,
          climb the ranks, take the crown. This leads the page so it's never in
          tension with the scheduled-season flavor below. */}
      <div className="mt-4">
        <KingLadderPanel />
      </div>

      {/* ── ADVERTISE: live + upcoming battles ─────────────────────────── */}
      <NextBattles battles={battles} now={now} />

      {!user && (
        <div className="mt-6 rounded-xl border border-dark-border bg-dark-card p-6 text-center">
          <Link to="/login" className="text-accent hover:underline">Sign in</Link>
          <span className="text-gray-400"> to enter the ladder and climb toward King.</span>
        </div>
      )}

      {/* Season & crowned EVENTS run ON TOP of the continual ladder — they're
          flavor and special prizes, never a gate to play. Kept secondary in a
          collapsible so the ladder is unambiguously the way to compete. */}
      <div className="mt-6">
        <CollapsibleSection id="king-season-events" label={`Season events · ${season.label}`}>
          <div className="rounded-xl border border-kunai/40 bg-kunai/5 p-4 text-sm">
            <p className="text-gray-200">{season.action}</p>
            {season.nextLabel && (
              <p className="mt-2 text-gray-400">
                {season.nextLabel} in <strong className="text-white tabular-nums">{season.countdown}</strong>
                {season.nextAt && <span className="text-gray-500"> · {new Date(season.nextAt).toLocaleDateString()}</span>}
              </p>
            )}
            <Link to="/king/board" className="inline-block mt-3 text-kunai hover:underline font-semibold">
              View the crowned board →
            </Link>
            {phase === 'enroll' && isScheduledEnrollmentOpen(now) &&
              (!tournament || isEnrollmentOpen(tournament, now)) && !myReg && user && tournament && (
              <div className="mt-4">
                <RegisterFlow tournament={tournament} onRegistered={reload} refreshUser={refreshUser} />
              </div>
            )}
            {myReg && (
              <p className="mt-3 text-leaf">
                You're registered for this season's crowned event
                {myReg.membership_granted && <> — free month of membership active.</>}
              </p>
            )}
          </div>
        </CollapsibleSection>
      </div>

      {/* Host tools — MANUAL scheduled battles, secondary to the auto-matched
          ladder above. Tucked into a collapsible so it never competes with the
          ladder as "the way to fight". Hosts (or anyone with battles running)
          can open it; everyone else just uses the ladder. */}
      {tournament && (phase !== 'enroll' || host || battles.length > 0) && (
        <div className="mt-6">
          <CollapsibleSection
            id={`king-hosttools-${tournament?.id ?? 'season'}`}
            label="Host tools · scheduled battles"
            count={battles.length}
          >
            <BattlesSection
              tournament={tournament}
              registrations={registrations}
              battles={battles}
              setBattles={setBattles}
              user={user}
              host={host}
              phase={phase}
              now={now}
              onChanged={reload}
            />
          </CollapsibleSection>
        </div>
      )}

      {/* Registered Shinobi roster */}
      <CollapsibleSection id={`king-roster-${tournament?.id ?? 'season'}`} label="Registered Shinobi" count={registrations.length}>
        {registrations.length === 0 ? (
          <p className="text-sm text-gray-500">No one has registered yet. Be the first into the pit.</p>
        ) : (
          <ul className="divide-y divide-dark-border">
            {registrations.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                <Link to={`/profile/${r.user_id}`} className="text-accent hover:underline">@{r.username ?? 'shinobi'}</Link>
                {r.streamed && <span className="text-[10px] text-gray-500">· will stream</span>}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      {host && (
        <p className="mt-6 text-[11px] text-gray-600">
          You have host powers on the TKO King (founder host code or creator). You can run battles at any time.
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  ADVERTISING — the "next battles" strip on /king itself.
// ─────────────────────────────────────────────────────────────────────────

function NextBattles({ battles, now }: { battles: Battle[]; now: number }) {
  const next = upcomingBattles(battles, now, 6)
  if (next.length === 0) return null
  return (
    <section className="mt-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">⚔️</span>
        <h2 className="text-sm font-semibold tracking-wide uppercase text-gray-300">Next battles</h2>
        <Link to="/king/board" className="ml-auto text-xs text-accent hover:underline">Full board →</Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {next.map((b) => (
          <div
            key={b.id}
            className={`shrink-0 w-56 snap-start rounded-xl border p-3 ${
              b.status === 'live' ? 'border-kunai/60 bg-kunai/10' : 'border-dark-border bg-dark-card'
            }`}
          >
            <div className="flex items-center gap-2">
              {b.status === 'live' ? (
                <span className="pill-kunai"><span className="live-dot" />LIVE</span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent uppercase tracking-wider">
                  Upcoming
                </span>
              )}
              <span className="ml-auto text-[11px] text-gray-400 tabular-nums">{battleTimingLabel(b, now)}</span>
            </div>
            <p className="mt-2 font-bold text-white text-sm truncate">@{b.a_name ?? 'shinobi'}</p>
            <p className="text-[11px] text-gray-500 my-0.5">vs</p>
            <p className="font-bold text-white text-sm truncate">@{b.b_name ?? 'TBD'}</p>
            {b.scheduled_at && (
              <p className="mt-2 text-[11px] text-gray-500 truncate">
                {new Date(b.scheduled_at).toLocaleString()}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function KingHeader() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-2xl">👑</span>
        <h1 className="text-2xl font-bold">TKO King</h1>
      </div>
      <p className="text-gray-400 mt-1">{KING_TAGLINE}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  Registration gate — the StepFlow entry gate + trial push + 30-day grant
// ─────────────────────────────────────────────────────────────────────────

function RegisterFlow({
  tournament,
  onRegistered,
  refreshUser,
}: {
  tournament: Tournament
  onRegistered: () => void
  refreshUser: () => Promise<void> | void
}) {
  const { user } = useAuth()
  const { open: openAskTko } = useAskTko()
  const [hasYoutube, setHasYoutube] = useState(false)
  const [hasStatCheck, setHasStatCheck] = useState(false)
  const [agreedToStream, setAgreedToStream] = useState(false)
  const [noModAck, setNoModAck] = useState(false)
  // "I'll add my stream link before my first battle" — recorded, never gating.
  const [streamPlanAck, setStreamPlanAck] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [trialBusy, setTrialBusy] = useState(false)
  const [trialStarted, setTrialStarted] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    async function load() {
      // Unified check: connected if EITHER a backend link OR a local channel
      // cache exists — so a user who connected in Create isn't told "not
      // connected" here for the same account.
      const [linked, scRes] = await Promise.all([
        isYouTubeLinked(user!.id),
        supabase.from('stat_check_submissions').select('id').eq('user_id', user!.id).eq('tournament_id', tournament.id).limit(1),
      ])
      setHasYoutube(linked)
      setHasStatCheck((scRes.data?.length ?? 0) > 0)
    }
    load()
  }, [user?.id, tournament.id])

  const checklist: RegistrationChecklist = {
    signedIn: !!user,
    youtubeConnected: hasYoutube,
    agreedToStream,
    noModAck,
    statCheckDone: hasStatCheck,
    streamPlanAck,
  }
  const ready = canRegister(checklist)
  const progress = registrationProgress(checklist)
  const channelSettled = registrationChannelSettled(checklist)

  async function startTrial() {
    if (!user || trialBusy) return
    setTrialBusy(true)
    // Push the 7-day free week HARD: grant a Pro trial via the shared trial path.
    await supabase.auth.updateUser({ data: startTrialMeta('pro') })
    await refreshUser()
    setTrialStarted(true)
    setTrialBusy(false)
  }

  async function register() {
    if (!user || !ready || submitting) return
    setSubmitting(true)
    setError('')
    // 1) registration row (idempotent-ish via unique(tournament,user))
    const { error: regErr } = await supabase.from('tournament_registrations').insert({
      tournament_id: tournament.id,
      user_id: user.id,
      streamed: true,
      no_mod_ack: true,
      membership_granted: true,
    })
    if (regErr) {
      setError(regErr.message)
      setSubmitting(false)
      return
    }
    // 2) grant the +30-day membership (everyone who competes gets a month).
    const grant = membershipGrantMeta(user)
    if (grant) {
      await supabase.auth.updateUser({ data: grant })
      await refreshUser()
    }
    // 3) welcome + reminder-scaffold notification.
    notify({
      userId: user.id,
      kind: 'tournament_started',
      title: 'You entered the TKO King pit 👑',
      body: 'Your free month of membership is active. Schedule your battles anytime — we\'ll remind you before each one.',
      link: '/king',
      relatedId: tournament.id,
    })
    setSubmitting(false)
    onRegistered()
  }

  return (
    <div className="mt-6 rounded-xl border border-accent/40 bg-accent/5 p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="font-semibold text-lg">Register for the pit</h2>
        <span className="text-xs text-gray-500">{progress}/{REGISTRATION_REQUIRED_COUNT} done</span>
      </div>
      {/* Confused by the gates? The guided assistant walks each one. */}
      <button
        type="button"
        onClick={() => openAskTko('tko-king')}
        className="mb-3 text-xs text-accent hover:underline"
      >
        Need help? Ask TKO to walk you through it →
      </button>

      {/* Push the free week HARD */}
      <div className="mb-4 rounded-lg border border-leaf/40 bg-leaf/10 p-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-leaf">Start your free week</p>
          <p className="text-xs text-gray-300">
            Try every Pro perk free for {TRIAL_DAYS} days — no card needed. Competing already earns you a month;
            the trial stacks the full Pro experience on top.
          </p>
        </div>
        <button
          type="button"
          onClick={startTrial}
          disabled={trialBusy || trialStarted}
          className="ml-auto shrink-0 px-4 py-2 rounded-lg bg-leaf text-dark font-semibold disabled:opacity-60"
        >
          {trialStarted ? 'Trial started ✓' : trialBusy ? 'Starting…' : 'Start free week'}
        </button>
      </div>

      <StepFlow>
        <Step title="Sign in" complete={checklist.signedIn}>
          <p className="text-sm text-gray-400">
            {checklist.signedIn ? "You're signed in with a free account — good to go." : (
              <><Link to="/login" className="text-accent hover:underline">Sign in</Link> with at least a free account.</>
            )}
          </p>
        </Step>

        {/* RECOMMENDED, NOT REQUIRED.
            Rendered as an `optional` StepFlow step so it takes no number and
            never counts toward the required tally — but `defaultOpen` keeps it
            visible and explained rather than buried behind a reveal. */}
        <Step
          title="Connect YouTube"
          optional
          defaultOpen
          addLabel="Connect YouTube (recommended)"
        >
          {checklist.youtubeConnected ? (
            <p className="text-sm text-leaf">YouTube connected ✓ — you're all set to stream.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-400">
                Your battles stream from your channel, so linking it now is the smoother path — and it
                <strong className="text-gray-300"> will be required before your first battle</strong>. But it
                <strong className="text-gray-300"> won't block you from registering today</strong>.
              </p>
              <p className="text-sm text-gray-400">
                <Link to="/connect" className="text-accent hover:underline">Connect YouTube →</Link>
                <span className="text-gray-600"> · or </span>
                <Link to="/connect" className="text-accent hover:underline">paste a channel / clip link →</Link>
              </p>
              <p className="text-[11px] text-gray-500">
                One-tap connect is still rolling out to all Google accounts while our app verification
                clears. If the popup won't let you through, paste a link instead — it counts the same.
              </p>
              <label className="flex items-start gap-2 cursor-pointer text-sm pt-1">
                <input
                  type="checkbox"
                  checked={streamPlanAck}
                  onChange={(e) => setStreamPlanAck(e.target.checked)}
                  className="mt-0.5"
                />
                <span>I'll add my stream link <strong>before my first battle</strong>.</span>
              </label>
              {channelSettled && (
                <p className="text-xs text-leaf">Noted — we'll remind you before you're matched up.</p>
              )}
            </div>
          )}
        </Step>

        <Step title="Agree to live-stream" complete={checklist.agreedToStream}>
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input type="checkbox" checked={agreedToStream} onChange={(e) => setAgreedToStream(e.target.checked)} className="mt-0.5" />
            <span>I agree to <strong>live-stream my battles</strong> on TKO (to our YouTube + front page).</span>
          </label>
        </Step>

        <Step title="No-modding attestation" complete={checklist.noModAck}>
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input type="checkbox" checked={noModAck} onChange={(e) => setNoModAck(e.target.checked)} className="mt-0.5" />
            <span>I attest I will <strong>not mod, cheat, or alter the game</strong>. No in-game rules — just no modding.</span>
          </label>
        </Step>

        <Step title="Stat check" complete={checklist.statCheckDone}>
          {checklist.statCheckDone ? (
            <p className="text-sm text-leaf">Stat check submitted ✓</p>
          ) : (
            <p className="text-sm text-gray-400">
              Prove your setup.{' '}
              <Link to="/stat-check" className="text-accent hover:underline">Do your stat check →</Link>{' '}
              then come back and refresh.
            </p>
          )}
        </Step>
      </StepFlow>

      {error && <p className="text-kunai text-sm mb-2">{error}</p>}

      <button
        type="button"
        onClick={register}
        disabled={!ready || submitting}
        className="w-full py-3 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
      >
        {submitting
          ? 'Registering…'
          : ready
            ? 'Register — claim your free month'
            : `Complete all ${REGISTRATION_REQUIRED_COUNT} steps (${progress}/${REGISTRATION_REQUIRED_COUNT})`}
      </button>
      {ready && !checklist.youtubeConnected && (
        <p className="mt-2 text-[11px] text-gray-400 text-center">
          You can register now without a linked channel — just add your stream link before your first battle.
        </p>
      )}
      <p className="mt-2 text-[11px] text-gray-500 text-center">
        Everyone who competes gets a month of membership (ad-free) on registration.
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  Battles — self-scheduling, status lifecycle, forfeit, host controls
// ─────────────────────────────────────────────────────────────────────────

function BattlesSection({
  tournament,
  registrations,
  battles,
  setBattles,
  user,
  host,
  phase,
  now,
  onChanged,
}: {
  tournament: Tournament
  registrations: Registration[]
  battles: Battle[]
  setBattles: React.Dispatch<React.SetStateAction<Battle[]>>
  user: { id: string } | null
  host: boolean
  phase: KingPhase
  now: number
  onChanged: () => void
}) {
  const [pa, setPa] = useState('')
  const [pb, setPb] = useState('')
  const [creating, setCreating] = useState(false)

  const nameOf = (id: string | null | undefined) =>
    registrations.find((r) => r.user_id === id)?.username ?? 'shinobi'
  const avatarOf = (id: string | null | undefined) =>
    registrations.find((r) => r.user_id === id)?.avatar_url ?? null

  // The board tells us which ROUND each battle sits in, which is what the
  // artifact prize table keys off.
  const board = useMemo(
    () => buildKingBoard(
      registrations.map((r) => ({ user_id: r.user_id, username: r.username, avatar_url: r.avatar_url })),
      battles,
    ),
    [registrations, battles],
  )
  const roundOf = (id: string) => board.rounds.flatMap((r) => r.battles).find((x) => x.battle.id === id)?.round ?? 1

  async function createBattle() {
    if (!host || !pa || !pb || pa === pb || creating) return
    setCreating(true)
    const { data } = await supabase
      .from('tournament_battles')
      .insert({ tournament_id: tournament.id, player_a: pa, player_b: pb, status: 'scheduled' })
      .select()
      .single()
    setCreating(false)
    setPa(''); setPb('')
    if (data) {
      // Reminder scaffolding: tell both Shinobi a battle awaits.
      notify({ userId: pa, kind: 'tournament_started', title: 'New TKO King battle', body: `You're matched vs @${nameOf(pb)}. Pick your time.`, link: '/king', relatedId: tournament.id })
      notify({ userId: pb, kind: 'tournament_started', title: 'New TKO King battle', body: `You're matched vs @${nameOf(pa)}. Pick your time.`, link: '/king', relatedId: tournament.id })
      onChanged()
    }
  }

  async function schedule(b: Battle, whenIso: string) {
    await supabase.from('tournament_battles').update({ scheduled_at: whenIso }).eq('id', b.id)
    setBattles((prev) => prev.map((x) => (x.id === b.id ? { ...x, scheduled_at: whenIso } : x)))
    // Notify BOTH players of the upcoming scheduled fight (reminder system).
    const when = new Date(whenIso).toLocaleString()
    for (const uid of [b.player_a, b.player_b].filter(Boolean) as string[]) {
      notify({
        userId: uid,
        kind: 'tournament_started',
        title: 'Your TKO King battle is scheduled ⏰',
        body: `${nameOf(b.player_a)} vs ${nameOf(b.player_b)} — ${when}. Be present at the stat check or forfeit.`,
        link: '/king',
        relatedId: tournament.id,
      })
    }
  }

  async function setStatus(b: Battle, status: BattleStatus, winner?: string | null) {
    await supabase.from('tournament_battles').update({ status, winner: winner ?? null }).eq('id', b.id)
    setBattles((prev) => prev.map((x) => (x.id === b.id ? { ...x, status, winner: winner ?? null } : x)))
    // On a decided battle, award the prize SERVER-SIDE.
    //
    // One call does the whole thing: /api/fn/king-prize re-checks that we are
    // the host, reads the winner off the battle row, records the Shinobi Trophy
    // Closet defeat, derives the bracket depth from the registration count, and
    // writes the advancement artifact into `asset_ownership` (source='prize').
    // It is idempotent, so a host re-confirming a result can't duplicate a prize
    // — and unlike the old localStorage grant, the crown survives a cache clear.
    if (isBattleDecided(status) && winner) {
      const loser = winner === b.player_a ? b.player_b : b.player_a
      const grant = await awardBattlePrize(b.id, {
        round: roundOf(b.id),
        totalRounds: board.totalRounds,
      })
      if (loser) {
        notify({ userId: winner, kind: 'generic', title: 'Victory — Shinobi added to your closet 🏆', body: `You beat @${nameOf(loser)}. See your Trophy Closet on your profile.`, link: '/profile', relatedId: tournament.id })
      }
      if (grant && !grant.alreadyOwned) {
        const copy = prizeNotification(grant.asset)
        notify({
          userId: winner,
          kind: 'generic',
          title: copy.title,
          body: copy.body,
          link: IS_MOBILE_STORE_BUILD ? '/profile' : '/shop',
          relatedId: tournament.id,
        })
      }
    }
  }

  const decided = phase === 'complete'

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg">Battles</h2>
        {phase === 'scheduling' && <span className="text-xs text-gray-500">Self-schedule your matchup — play anytime.</span>}
      </div>

      {/* Host: create a matchup */}
      {host && !decided && (
        <div className="rounded-xl border border-dark-border bg-dark-card p-4">
          <p className="text-sm font-medium mb-2">Create a battle (host)</p>
          <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
            <select value={pa} onChange={(e) => setPa(e.target.value)} className="px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm">
              <option value="">Player A…</option>
              {registrations.map((r) => <option key={r.user_id} value={r.user_id}>@{r.username ?? 'shinobi'}</option>)}
            </select>
            <select value={pb} onChange={(e) => setPb(e.target.value)} className="px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm">
              <option value="">Player B…</option>
              {registrations.filter((r) => r.user_id !== pa).map((r) => <option key={r.user_id} value={r.user_id}>@{r.username ?? 'shinobi'}</option>)}
            </select>
            <button onClick={createBattle} disabled={!pa || !pb || creating} className="px-4 py-2 rounded-lg bg-accent text-dark font-medium text-sm disabled:opacity-50">
              {creating ? 'Adding…' : 'Add battle'}
            </button>
          </div>
        </div>
      )}

      {battles.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center text-gray-400 text-sm">
          No battles yet. {host ? 'Create one above.' : 'A host will pair up the Shinobi soon.'}
        </div>
      ) : (
        <div className="space-y-3">
          {battles.map((b) => (
            <BattleCard
              key={b.id}
              b={b}
              user={user}
              host={host}
              now={now}
              nameOf={nameOf}
              avatarOf={avatarOf}
              onSchedule={schedule}
              onSetStatus={setStatus}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BattleCard({
  b,
  user,
  host,
  now,
  nameOf,
  avatarOf,
  onSchedule,
  onSetStatus,
}: {
  b: Battle
  user: { id: string } | null
  host: boolean
  now: number
  nameOf: (id: string | null | undefined) => string
  avatarOf: (id: string | null | undefined) => string | null
  onSchedule: (b: Battle, whenIso: string) => void
  onSetStatus: (b: Battle, status: BattleStatus, winner?: string | null) => void
}) {
  const [when, setWhen] = useState('')
  const iAmIn = !!user && (user.id === b.player_a || user.id === b.player_b)
  const decided = isBattleDecided(b.status)

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Avatar
          src={avatarOf(b.player_a)}
          name={b.a_name ?? nameOf(b.player_a)}
          seed={b.player_a}
          size={26}
        />
        <span className="font-semibold">@{b.a_name ?? nameOf(b.player_a)}</span>
        <span className="text-gray-500 text-sm">vs</span>
        <Avatar
          src={avatarOf(b.player_b)}
          name={b.b_name ?? nameOf(b.player_b)}
          seed={b.player_b}
          size={26}
        />
        <span className="font-semibold">@{b.b_name ?? nameOf(b.player_b)}</span>
        <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full border uppercase tracking-wider ${
          b.status === 'live' ? 'border-kunai/40 bg-kunai/10 text-kunai animate-pulse'
          : b.status === 'complete' ? 'border-leaf/40 bg-leaf/10 text-leaf'
          : b.status === 'forfeit' ? 'border-gray-500/40 bg-gray-500/10 text-gray-400'
          : 'border-accent/40 bg-accent/10 text-accent'
        }`}>
          {battleStatusLabel(b.status)}
        </span>
      </div>

      <p className="text-xs text-gray-500 mt-1">
        {b.scheduled_at ? `Scheduled ${new Date(b.scheduled_at).toLocaleString()}` : 'Not scheduled yet'}
        {!decided && <> · <span className="text-gray-400 tabular-nums">{battleTimingLabel(b, now)}</span></>}
        {b.winner && <> · winner <strong className="text-leaf">@{nameOf(b.winner)}</strong></>}
      </p>

      {/* Self-schedule (either player, before it's decided) */}
      {iAmIn && !decided && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-dark border border-dark-border text-white text-sm"
          />
          <button
            onClick={() => when && onSchedule(b, new Date(when).toISOString())}
            disabled={!when}
            className="px-3 py-1.5 rounded-lg bg-accent text-dark text-sm font-medium disabled:opacity-50"
          >
            Set my time
          </button>
        </div>
      )}

      {/* PIT MEET-UP — private exchange, only the 2 fighters + hosts see it. */}
      {!decided && (
        <PitMeetup
          battleId={b.id}
          playerA={b.player_a}
          playerB={b.player_b}
          viewerId={user?.id ?? null}
          isHost={host}
          nameOf={nameOf}
        />
      )}

      {/* Host controls: live / winner / forfeit */}
      {host && !decided && (
        <div className="mt-3 flex flex-wrap gap-2">
          {b.status !== 'live' && (
            <button onClick={() => onSetStatus(b, 'live')} className="px-3 py-1 rounded text-xs bg-kunai/15 border border-kunai/40 text-kunai">Go live</button>
          )}
          <button onClick={() => onSetStatus(b, 'complete', b.player_a)} className="px-3 py-1 rounded text-xs bg-leaf/15 border border-leaf/40 text-leaf">@{nameOf(b.player_a)} won</button>
          {b.player_b && (
            <button onClick={() => onSetStatus(b, 'complete', b.player_b)} className="px-3 py-1 rounded text-xs bg-leaf/15 border border-leaf/40 text-leaf">@{nameOf(b.player_b)} won</button>
          )}
          {/* Forfeit: pick the no-show; the present player takes the win */}
          <button
            onClick={() => {
              const o = forfeitOutcome(b.player_a, b.player_b, b.player_a)
              if (o) onSetStatus(b, 'forfeit', o.winner)
            }}
            className="px-3 py-1 rounded text-xs border border-dark-border text-gray-300"
          >
            @{nameOf(b.player_a)} no-show
          </button>
          {b.player_b && (
            <button
              onClick={() => {
                const o = forfeitOutcome(b.player_a, b.player_b, b.player_b!)
                if (o) onSetStatus(b, 'forfeit', o.winner)
              }}
              className="px-3 py-1 rounded text-xs border border-dark-border text-gray-300"
            >
              @{nameOf(b.player_b)} no-show
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default TkoKing
