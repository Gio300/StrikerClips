import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { callFn } from '@/lib/backend'
import { useAuth } from '@/hooks/useAuth'
import { InviteMenu } from '@/components/InviteMenu'
import { TournamentChat } from '@/components/TournamentChat'
import { ShareButton } from '@/components/ShareButton'
import { canonicalShareUrl } from '@/lib/canonicalUrl'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { invalidateInviteContext } from '@/hooks/useInviteContext'
import { notify, notifyMany } from '@/lib/notifications'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useInstallLabel } from '@/hooks/useInstallLabel'
import { predictionQuota, predictionUpgradeNudge } from '@/lib/tiers'
import { oracleBadgeForCorrect, BADGES } from '@/lib/badges'
import { BadgeChip } from '@/components/BadgeChip'
import { Avatar } from '@/components/ui'
import { TournamentPrizePoolPanel } from '@/components/TournamentPrizePoolPanel'
import { IS_MOBILE_STORE_BUILD, WAGERING_UI_ENABLED } from '@/lib/storeBuild'
import { TournamentBracket } from '@/components/TournamentBracket'
import { TournamentMatchBoards } from '@/components/tournament/TournamentMatchBoards'
import { TournamentReplay } from '@/components/tournament/TournamentReplay'
import { TournamentRostersPanel } from '@/components/tournament/TournamentRostersPanel'
import { effectiveDisplayName } from '@/lib/founder'
import { isTkoHost } from '@/lib/tkoKing'
import { DEFAULT_LEAGUE_CONFIG, SEED_LEAGUES } from '@/lib/leagueConfig'
import { splitExtraRowPage } from '@/lib/paging'
import {
  submitPrediction,
  withdrawPrediction,
  gradePrediction,
  loadPredictions,
  getStats,
  getOpenForTournament,
  getPredictionForTournament,
  canPredict,
  type PredictionPick,
} from '@/lib/predictions'
import type {
  Tournament,
  TournamentAdmin,
  TournamentEntrant,
  StatCheckSubmission,
  StatCheckCreatorDecision,
  TournamentStatus,
} from '@/types/database'

// ─────────────────────────────────────────────────────────────────────────
// Types local to this page (existing rows we extend with joined data)
// ─────────────────────────────────────────────────────────────────────────

type TournamentResult = {
  id: string
  tournament_id: string
  winner_profile_id: string
  team_name: string | null
  submitted_by: string | null
  created_at: string
  winner_username?: string
}

type AdminRow = TournamentAdmin & { username?: string }
type EntrantRow = TournamentEntrant & {
  username?: string
  avatar_url?: string | null
  team_server_name?: string
}
type SubmissionRow = StatCheckSubmission & { submitter_username?: string }

const TOURNAMENT_DETAIL_PAGE_SIZE = 50

// ─────────────────────────────────────────────────────────────────────────
// Top-level page
// ─────────────────────────────────────────────────────────────────────────

type Section = 'overview' | 'rosters' | 'perks' | 'entrants' | 'bracket' | 'matches' | 'stat-check' | 'admins' | 'results' | 'replay' | 'chat'

export function TournamentDetail() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()

  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [results, setResults] = useState<TournamentResult[]>([])
  const [admins, setAdmins] = useState<AdminRow[]>([])
  const [entrants, setEntrants] = useState<EntrantRow[]>([])
  const [submissionLimit] = useState(TOURNAMENT_DETAIL_PAGE_SIZE)
  const [resultLimit] = useState(TOURNAMENT_DETAIL_PAGE_SIZE)
  const [adminLimit] = useState(TOURNAMENT_DETAIL_PAGE_SIZE)
  const [entrantLimit] = useState(TOURNAMENT_DETAIL_PAGE_SIZE)
  const [, setHasMoreSubmissions] = useState(false)
  const [, setHasMoreResults] = useState(false)
  const [, setHasMoreAdmins] = useState(false)
  const [, setHasMoreEntrants] = useState(false)
  const [, setAcceptedEntrantCount] = useState(0)
  const [, setPendingSubmissionCount] = useState(0)
  const [, setLoadingMore] = useState<Section | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingTournament, setEditingTournament] = useState(false)
  // Deep-link into a section: shared invite links use `?chat=1`; notification
  // links use `?section=<name>`.
  const initialSection: Section = (() => {
    if (searchParams.get('chat') === '1') return 'chat'
    const s = searchParams.get('section')
    const valid: Section[] = ['overview', 'rosters', 'perks', 'entrants', 'bracket', 'matches', 'stat-check', 'admins', 'results', 'replay', 'chat']
    return valid.includes(s as Section) ? (s as Section) : 'overview'
  })()
  const [section, setSection] = useState<Section>(initialSection)

  // A global TKO host (founder host code) passes every tournament host/admin
  // check everywhere — including owner-only creator decisions.
  const isHost = isTkoHost(user)
  const isOwner = Boolean((user?.id && tournament?.created_by === user.id) || isHost)
  const myAdmin = useMemo(() => admins.find((a) => a.user_id === user?.id), [admins, user])
  const isAdmin = Boolean(isOwner || myAdmin)
  const canApproveStatCheck = isOwner || Boolean(myAdmin?.can_approve_stat_check)
  const myEntrant = useMemo(() => entrants.find((e) => e.user_id === user?.id), [entrants, user])
  const isAcceptedEntrant = myEntrant?.status === 'accepted'
  // Entered + agreed to the rules but the host hasn't approved the entry yet.
  // (A pending row WITHOUT agreed_to_rules_at is a teammate invite instead.)
  const isAwaitingApproval =
    myEntrant?.status === 'pending' && Boolean(myEntrant?.agreed_to_rules_at)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      const { data: t } = await supabase.from('tournaments').select('*').eq('id', id!).single()
      if (cancelled) return
      setTournament((t ?? null) as Tournament | null)
      if (!t) {
        setLoading(false)
        return
      }
      const [
        subRes,
        resRes,
        admRes,
        entRes,
        viewerAdminRes,
        viewerEntrantRes,
        acceptedCountRes,
        pendingCountRes,
      ] = await Promise.all([
        supabase
          .from('stat_check_submissions')
          .select('*')
          .eq('tournament_id', id!)
          .order('created_at', { ascending: false })
          .range(0, submissionLimit),
        supabase
          .from('tournament_results')
          .select('*')
          .eq('tournament_id', id!)
          .order('created_at', { ascending: false })
          .range(0, resultLimit),
        supabase
          .from('tournament_admins')
          .select('*')
          .eq('tournament_id', id!)
          .order('created_at', { ascending: false })
          .range(0, adminLimit),
        supabase
          .from('tournament_entrants')
          .select('*')
          .eq('tournament_id', id!)
          .order('created_at', { ascending: false })
          .range(0, entrantLimit),
        user?.id
          ? supabase
              .from('tournament_admins')
              .select('*')
              .eq('tournament_id', id!)
              .eq('user_id', user.id)
              .limit(1)
          : Promise.resolve({ data: [] as AdminRow[], error: null }),
        user?.id
          ? supabase
              .from('tournament_entrants')
              .select('*')
              .eq('tournament_id', id!)
              .eq('user_id', user.id)
              .limit(1)
          : Promise.resolve({ data: [] as EntrantRow[], error: null }),
        supabase
          .from('tournament_entrants')
          .select('id', { count: 'exact', head: true })
          .eq('tournament_id', id!)
          .eq('status', 'accepted'),
        supabase
          .from('stat_check_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('tournament_id', id!)
          .eq('status', 'pending'),
      ])
      if (cancelled) return

      const subPage = splitExtraRowPage((subRes.data ?? []) as SubmissionRow[], submissionLimit)
      const resultPage = splitExtraRowPage((resRes.data ?? []) as TournamentResult[], resultLimit)
      const adminPage = splitExtraRowPage((admRes.data ?? []) as AdminRow[], adminLimit)
      const entrantPage = splitExtraRowPage((entRes.data ?? []) as EntrantRow[], entrantLimit)
      const subRows = subPage.items
      const resRows = resultPage.items
      const admRows = [...adminPage.items]
      const entRows = [...entrantPage.items]
      const viewerAdmin = (viewerAdminRes.data ?? [])[0] as AdminRow | undefined
      const viewerEntrant = (viewerEntrantRes.data ?? [])[0] as EntrantRow | undefined
      if (viewerAdmin && !admRows.some((row) => row.id === viewerAdmin.id)) admRows.push(viewerAdmin)
      if (viewerEntrant && !entRows.some((row) => row.id === viewerEntrant.id)) entRows.push(viewerEntrant)

      setHasMoreSubmissions(subPage.hasMore)
      setHasMoreResults(resultPage.hasMore)
      setHasMoreAdmins(adminPage.hasMore)
      setHasMoreEntrants(entrantPage.hasMore)
      setAcceptedEntrantCount(acceptedCountRes.count ?? 0)
      setPendingSubmissionCount(pendingCountRes.count ?? 0)

      // Bulk username + team-server enrichment.
      const userIds = new Set<string>()
      const serverIds = new Set<string>()
      for (const r of subRows) userIds.add(r.user_id)
      for (const r of resRows) userIds.add(r.winner_profile_id)
      for (const r of admRows) userIds.add(r.user_id)
      for (const r of entRows) {
        userIds.add(r.user_id)
        if (r.team_server_id) serverIds.add(r.team_server_id)
      }
      const [profiles, servers] = await Promise.all([
        userIds.size > 0
          ? supabase.from('profiles').select('id, username, avatar_url').in('id', Array.from(userIds))
          : Promise.resolve({
              data: [] as { id: string; username: string; avatar_url: string | null }[],
              error: null,
            }),
        serverIds.size > 0
          ? supabase.from('servers').select('id, name').in('id', Array.from(serverIds))
          : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
      ])
      const nameMap = new Map((profiles.data ?? []).map((p) => [p.id, p.username]))
      const avatarMap = new Map(
        (profiles.data ?? []).map((p) => [
          p.id,
          (p as { avatar_url?: string | null }).avatar_url ?? null,
        ]),
      )
      const serverMap = new Map((servers.data ?? []).map((s) => [s.id, s.name]))

      setSubmissions(
        subRows.map((s) => ({ ...s, submitter_username: nameMap.get(s.user_id) })),
      )
      setResults(
        resRows.map((r) => ({
          ...r,
          winner_username: nameMap.get(r.winner_profile_id) ?? 'Unknown',
        })),
      )
      setAdmins(admRows.map((a) => ({ ...a, username: nameMap.get(a.user_id) ?? 'Unknown' })))
      setEntrants(
        entRows.map((e) => ({
          ...e,
          username: nameMap.get(e.user_id) ?? 'Unknown',
          avatar_url: avatarMap.get(e.user_id) ?? null,
          team_server_name: e.team_server_id ? serverMap.get(e.team_server_id) : undefined,
        })),
      )
      setLoadingMore(null)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, user?.id, submissionLimit, resultLimit, adminLimit, entrantLimit])

  if (loading || !tournament) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
        {loading ? (
          <div className="animate-pulse text-gray-400">Loading tournament…</div>
        ) : (
          <div className="text-gray-400">
            Tournament not found.{' '}
            <Link to="/tournaments" className="text-accent hover:underline">
              Back to tournaments
            </Link>
          </div>
        )}
      </div>
    )
  }

  const sections: Section[] = ['overview', 'rosters', 'perks', 'entrants', 'bracket', 'matches', 'stat-check', 'admins', 'results', 'replay', 'chat']

  // Absolute PUBLIC link back to this tournament's chatroom for sharing /
  // inviting. Built through canonicalShareUrl — never window.location.origin,
  // which is `https://localhost` inside the installed app and produced dead
  // invite links (operator report 2026-08-02).
  const chatShareUrl = canonicalShareUrl(`/tournaments/${tournament.id}?chat=1`)

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <Link
        to="/tournaments"
        className="text-accent hover:underline text-sm mb-4 inline-block"
      >
        ← Back to tournaments
      </Link>

      <div className="flex flex-wrap items-center gap-3 mb-1">
        <h1 className="text-2xl font-bold">{tournament.name}</h1>
        <StatusPill status={(tournament.status ?? 'draft') as TournamentStatus} />
        <LeaguePill slug={tournament.league_slug} />
        {isAdmin && (
          <Link
            to={`/live?do=golive&tournament=${tournament.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-dark text-sm font-semibold hover:shadow-glow shrink-0"
          >
            <span aria-hidden className="h-2 w-2 rounded-full bg-red-600 animate-pulse" />
            Go live for this tournament
          </Link>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setEditingTournament((current) => !current)}
            aria-expanded={editingTournament}
            className="inline-flex min-h-10 items-center rounded-lg border border-dark-border px-3 text-sm font-semibold text-gray-200 hover:border-accent/50"
          >
            {editingTournament ? 'Close editor' : 'Edit tournament'}
          </button>
        )}
        <ShareButton
          url={chatShareUrl}
          title={`${tournament.name} — chat & follow along`}
          text={`Jump into the chatroom for "${tournament.name}" on TKO. Watch and read for free — sign in to chat.`}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dark-border text-gray-200 text-sm hover:border-accent/50 shrink-0"
        />
      </div>
      {tournament.description && <TournamentDescription description={tournament.description} />}

      {editingTournament && isAdmin && (
        <EditTournamentPanel
          tournament={tournament}
          onCancel={() => setEditingTournament(false)}
          onSaved={(updated) => {
            setTournament(updated)
            setEditingTournament(false)
          }}
        />
      )}

      <label className="mb-4 block sm:hidden">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Tournament section</span>
        <select
          value={section}
          onChange={(event) => setSection(event.target.value as Section)}
          className="field min-h-11"
          aria-label="Tournament section"
        >
          {sections.map((item) => <option key={item} value={item}>{labelFor(item)}</option>)}
        </select>
      </label>

      <div className="mb-6 hidden flex-wrap gap-1 border-b border-dark-border sm:flex">
        {sections.map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium capitalize transition-colors ${
              section === s
                ? 'bg-accent/10 text-accent border-b-2 border-accent'
                : 'text-gray-400 hover:text-white border-b-2 border-transparent'
            }`}
          >
            {labelFor(s)}
            {s === 'entrants' && entrants.length > 0 && (
              <span className="ml-1 text-[11px] text-gray-500">
                ({entrants.filter((e) => e.status === 'accepted').length})
              </span>
            )}
            {s === 'stat-check' && submissions.filter((sub) => sub.status === 'pending').length > 0 && canApproveStatCheck && (
              <span className="ml-1 text-[11px] bg-chakra/20 text-chakra rounded-full px-1.5">
                {submissions.filter((sub) => sub.status === 'pending').length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Oracle prediction sits above the fold — it's the flagship engagement
          hook, so it leads the overview rather than hiding below the rules. */}
      {section === 'overview' && (
        <div className="mb-6">
          <OraclePredictionCard
            tournament={tournament}
            entrants={entrants}
            winnerResult={results[0] ?? null}
            user={user}
          />
        </div>
      )}

      {section === 'overview' && (
        <div className="mb-6">
          {WAGERING_UI_ENABLED && (
            <TournamentPrizePoolPanel tournamentId={tournament.id} isHost={Boolean(isAdmin || isOwner)} />
          )}
        </div>
      )}

      {section === 'overview' && (
        <OverviewSection
          tournament={tournament}
          entrants={entrants}
          isOwner={isOwner}
          isAcceptedEntrant={isAcceptedEntrant}
          isAwaitingApproval={isAwaitingApproval}
          myEntrant={myEntrant}
          user={user}
          onEntered={(newEntrants, sub) => {
            setEntrants((prev) => [...prev, ...newEntrants])
            if (sub) {
              setSubmissions((prev) => [
                { ...sub, submitter_username: effectiveDisplayName(user?.email?.split('@')[0]) },
                ...prev,
              ])
            }
            setSection('stat-check')
          }}
        />
      )}

      {/* Danger zone — visible ONLY to the creator (or a global TKO host); the
          server enforces the same gate, and refunds every escrowed prize-pool
          entry before anything is deleted. */}
      {section === 'overview' && isOwner && (
        <DeleteTournamentZone tournament={tournament} />
      )}

      {section === 'entrants' && (
        <EntrantsSection
          entrants={entrants}
          setEntrants={setEntrants}
          tournamentId={tournament.id}
          isOwner={isOwner}
          canManage={isAdmin}
          submissions={submissions}
          setSubmissions={setSubmissions}
          user={user}
        />
      )}

      {(section === 'rosters' || section === 'perks') && (
        <TournamentRostersPanel
          tournamentId={tournament.id}
          signedIn={Boolean(user)}
          entrants={entrants}
          initialView={section}
        />
      )}

      {section === 'bracket' && (
        <TournamentBracket
          tournamentId={tournament.id}
          entrants={entrants.filter((entrant) => entrant.status === 'accepted')}
          canManage={Boolean(isAdmin || isOwner)}
        />
      )}

      {section === 'matches' && (
        <TournamentMatchBoards
          tournamentId={tournament.id}
          userId={user?.id ?? null}
          isHost={Boolean(isAdmin || isOwner)}
          isEntrant={isAcceptedEntrant}
        />
      )}

      {section === 'stat-check' && (
        <StatCheckSection
          tournamentId={tournament.id}
          tournamentName={tournament.name}
          tournamentOwnerId={tournament.created_by ?? null}
          submissions={submissions}
          setSubmissions={setSubmissions}
          user={user}
          isOwner={isOwner}
          canApproveStatCheck={canApproveStatCheck}
          isEntrant={isAcceptedEntrant || isAwaitingApproval}
          admins={admins}
          tournamentRules={tournament.rules}
          onStatCheckApproved={async (submitterId) => {
            // ONE approval surface: approving a stat check from this tab also
            // approves the submitter's pending ENTRY through the trusted fn
            // (best-effort — a reviewer without entry-approval rights just
            // leaves the entry pending for the host).
            const ent = entrants.find(
              (e) =>
                e.user_id === submitterId &&
                e.status === 'pending' &&
                Boolean(e.agreed_to_rules_at),
            )
            if (!ent) return
            const { data } = await supabase.functions.invoke('tournament-entrant-review', {
              body: { entrantId: ent.id, decision: 'approve' },
            })
            if (data?.ok) {
              setEntrants((prev) =>
                prev.map((e) => (e.id === ent.id ? { ...e, status: 'accepted' } : e)),
              )
            }
          }}
        />
      )}

      {section === 'admins' && (
        <AdminsSection
          tournamentId={tournament.id}
          tournamentName={tournament.name}
          admins={admins}
          setAdmins={setAdmins}
          user={user}
          isOwner={isOwner}
        />
      )}

      {section === 'results' && (
        <SubmitResultSection
          tournamentId={tournament.id}
          tournamentName={tournament.name}
          results={results}
          setResults={setResults}
          user={user}
          canManage={Boolean(isAdmin || isOwner)}
        />
      )}

      {/* Tournament records: play the tournament back like a stream. */}
      {section === 'replay' && <TournamentReplay tournament={tournament} />}

      {section === 'chat' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-dark-border bg-dark-card p-4 flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold">Tournament chatroom</h2>
              <p className="text-sm text-gray-400">
                Anyone can watch and read along. Sign in to join the conversation.
              </p>
            </div>
            <ShareButton
              url={chatShareUrl}
              title={`${tournament.name} — chat & follow along`}
              text={`Jump into the chatroom for "${tournament.name}" on TKO. Watch and read for free — sign in to chat.`}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-accent/40 text-accent text-sm hover:border-accent shrink-0"
            />
          </div>
          <TournamentChat tournamentId={tournament.id} title={tournament.name} />
        </div>
      )}
    </div>
  )
}

function labelFor(s: Section): string {
  switch (s) {
    case 'overview':
      return 'Overview'
    case 'entrants':
      return 'Entrants'
    case 'rosters':
      return 'Rosters'
    case 'perks':
      return 'Perks'
    case 'bracket':
      return 'Bracket'
    case 'matches':
      return 'Match Board'
    case 'stat-check':
      return 'Stat Check'
    case 'admins':
      return 'Admins'
    case 'results':
      return 'Results'
    case 'replay':
      return 'Replay'
    case 'chat':
      return 'Chat'
  }
}

function StatusPill({ status }: { status: TournamentStatus }) {
  const map: Record<TournamentStatus, { cls: string; label: string }> = {
    draft: { cls: 'border-gray-500/40 bg-gray-500/10 text-gray-400', label: 'Draft' },
    open: { cls: 'border-leaf/40 bg-leaf/10 text-leaf', label: 'Open' },
    live: { cls: 'border-kunai/40 bg-kunai/10 text-kunai animate-pulse', label: 'Live' },
    closed: { cls: 'border-dark-border bg-dark text-gray-500', label: 'Closed' },
  }
  const m = map[status]
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-full border uppercase tracking-wider ${m.cls}`}
    >
      {m.label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// League accent — which league brand the tournament runs under
// (tournaments.league_slug: 'tko' default, or a leagues.slug). Branding only.
// Resolves the seeded launch leagues synchronously and falls back to a
// best-effort `leagues` row fetch for custom slugs; unknown slugs show the
// raw slug in TKO colors rather than hiding the context.
// ─────────────────────────────────────────────────────────────────────────

function LeaguePill({ slug }: { slug?: string | null }) {
  const wanted = (slug || DEFAULT_LEAGUE_CONFIG.slug).toLowerCase()
  const seeded = SEED_LEAGUES.find((league) => league.slug === wanted)
  const [fetched, setFetched] = useState<{ name: string; accent: string } | null>(null)

  useEffect(() => {
    if (seeded) return
    let cancelled = false
    // `leagues` isn't in the generated DB types yet — cast like liveAngles does.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase.from('leagues' as any) as any)
      .select('slug, name, colors')
      .eq('slug', wanted)
      .single()
      .then(({ data }: { data: { name?: string; colors?: { accent?: string } } | null }) => {
        if (cancelled || !data?.name) return
        setFetched({ name: data.name, accent: data.colors?.accent || DEFAULT_LEAGUE_CONFIG.colors.accent })
      })
    return () => { cancelled = true }
  }, [seeded, wanted])

  const name = seeded?.name ?? fetched?.name ?? wanted
  const accent = seeded?.colors.accent ?? fetched?.accent ?? DEFAULT_LEAGUE_CONFIG.colors.accent
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full border uppercase tracking-wider"
      style={{ borderColor: `${accent}66`, color: accent, backgroundColor: `${accent}1a` }}
      title={`Runs under ${name}`}
    >
      {name}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Danger zone — the creator deletes their tournament (two-step confirm).
// The server (POST /api/fn/tournament-delete) refunds every escrowed
// prize-pool entry in the same transaction, then removes the tournament and
// its children. Same visual pattern as the clan danger zone.
// ─────────────────────────────────────────────────────────────────────────

const TOURNAMENT_LEAGUE_OPTIONS = [
  DEFAULT_LEAGUE_CONFIG,
  ...SEED_LEAGUES.filter((league) => league.slug !== DEFAULT_LEAGUE_CONFIG.slug),
]

function dateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function TournamentDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false)
  const normalized = description.trim()
  const shouldCollapse = normalized.length > 180 || normalized.split(/\r?\n/).length > 3

  return (
    <div className="mb-4">
      <p
        className={`whitespace-pre-line text-sm leading-6 text-gray-400 ${
          shouldCollapse && !expanded
            ? 'max-h-24 overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)] sm:max-h-none sm:[mask-image:none]'
            : ''
        }`}
      >
        {normalized}
      </p>
      {shouldCollapse && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="mt-1 min-h-9 text-sm font-semibold text-accent sm:hidden"
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  )
}

function EditTournamentPanel({
  tournament,
  onCancel,
  onSaved,
}: {
  tournament: Tournament
  onCancel: () => void
  onSaved: (tournament: Tournament) => void
}) {
  const [name, setName] = useState(tournament.name)
  const [description, setDescription] = useState(tournament.description ?? '')
  const [rules, setRules] = useState(tournament.rules ?? '')
  const [startAt, setStartAt] = useState(dateTimeLocalValue(tournament.start_at))
  const [endAt, setEndAt] = useState(dateTimeLocalValue(tournament.end_at))
  const [status, setStatus] = useState<TournamentStatus>(tournament.status ?? 'draft')
  const [leagueSlug, setLeagueSlug] = useState(tournament.league_slug || DEFAULT_LEAGUE_CONFIG.slug)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function saveTournament(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    if (!name.trim()) {
      setError('Enter a tournament name.')
      return
    }
    if (!endAt || Number.isNaN(new Date(endAt).getTime())) {
      setError('Set a valid end date and time.')
      return
    }
    if (startAt && new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      setError('The end time must be after the start time.')
      return
    }

    setSaving(true)
    setError('')
    const { data, error: updateError } = await supabase
      .from('tournaments')
      .update({
        name: name.trim(),
        description: description.trim() || null,
        rules: rules.trim() || null,
        start_at: startAt ? new Date(startAt).toISOString() : null,
        end_at: new Date(endAt).toISOString(),
        status,
        league_slug: leagueSlug,
      })
      .eq('id', tournament.id)
      .select('*')
      .single()

    setSaving(false)
    if (updateError || !data) {
      setError(updateError?.message ?? 'Could not update the tournament.')
      return
    }
    onSaved(data as Tournament)
  }

  const currentLeagueIsListed = TOURNAMENT_LEAGUE_OPTIONS.some((league) => league.slug === leagueSlug)

  return (
    <form onSubmit={(event) => void saveTournament(event)} className="mb-6 rounded-xl border border-accent/30 bg-dark-card p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white">Edit tournament</h2>
        <p className="mt-1 text-xs text-gray-500">
          Update the public details and schedule. The host clan and who may enter stay unchanged.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-300">Tournament name</span>
          <input className="field" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
        </label>

        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-300">Description</span>
          <textarea className="field resize-y" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-300">Start date and time</span>
          <input type="datetime-local" className="field" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-300">End date and time</span>
          <input type="datetime-local" className="field" value={endAt} onChange={(event) => setEndAt(event.target.value)} required />
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-300">Status</span>
          <select className="field" value={status} onChange={(event) => setStatus(event.target.value as TournamentStatus)}>
            <option value="draft">Draft</option>
            <option value="open">Open registration</option>
            <option value="live">Live now</option>
            <option value="closed">Closed</option>
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold text-gray-300">Runs under</span>
          <select className="field" value={leagueSlug} onChange={(event) => setLeagueSlug(event.target.value)}>
            {!currentLeagueIsListed && <option value={leagueSlug}>{leagueSlug}</option>}
            {TOURNAMENT_LEAGUE_OPTIONS.map((league) => (
              <option key={league.slug} value={league.slug}>{league.name}</option>
            ))}
          </select>
        </label>

        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-gray-300">Rules</span>
          <textarea className="field resize-y font-mono" rows={7} value={rules} onChange={(event) => setRules(event.target.value)} />
        </label>
      </div>

      {error && <p className="mt-4 text-sm text-kunai">{error}</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? 'Saving...' : 'Save changes'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="btn-ghost">Cancel</button>
      </div>
    </form>
  )
}

function DeleteTournamentZone({ tournament }: { tournament: Tournament }) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    setError('')
    const response = await callFn<{
      ok: boolean
      deleted?: boolean
      refunds?: { user_id: string; amount: number }[]
      reason?: string
      error?: string
    }>('tournament-delete', { tournamentId: tournament.id })
    if (!response?.ok) {
      setDeleting(false)
      setError(
        response?.error ??
          (response?.reason === 'pool-not-deletable'
            ? 'The prize pool is in a state that cannot be safely refunded. Settle or cancel it first.'
            : response
              ? 'Could not delete the tournament.'
              : 'Could not reach the server. Try again.'),
      )
      return
    }
    // Back to the list; it re-fetches on mount, so the deleted row is gone.
    navigate('/tournaments', { replace: true })
  }

  return (
    <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-2">
      <p className="text-xs font-semibold text-red-400">Danger zone</p>
      <p className="text-[11px] text-gray-500">
        Deleting this tournament removes it for everyone — entrants, bracket, results, and chat.
        Any un-settled prize-pool entries are refunded in full. This can't be undone.
      </p>
      {confirming ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-red-300">
            You are about to delete the WHOLE tournament "{tournament.name}" — every entrant is
            removed, the bracket, results and chat are erased for everyone, and all escrowed
            prize-pool entries are refunded. There is no undo.
          </p>
          <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={deleting}
            className="px-3 py-1.5 rounded-lg bg-red-500/90 text-white font-semibold text-xs disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : `Yes, permanently delete ${tournament.name}`}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={deleting}
            className="px-3 py-1.5 rounded-lg border border-dark-border text-gray-400 text-xs"
          >
            Cancel
          </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 text-xs hover:bg-red-500/10"
        >
          Delete tournament
        </button>
      )}
      {error && <p className="text-xs text-kunai">{error}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Overview — rules, schedule, host, entrant count, "Enter tournament" CTA
// ─────────────────────────────────────────────────────────────────────────

function OverviewSection({
  tournament,
  entrants,
  isOwner,
  isAcceptedEntrant,
  isAwaitingApproval,
  myEntrant,
  user,
  onEntered,
}: {
  tournament: Tournament
  entrants: EntrantRow[]
  isOwner: boolean
  isAcceptedEntrant: boolean
  isAwaitingApproval: boolean
  myEntrant: EntrantRow | undefined
  user: { id: string } | null
  onEntered: (newEntrants: EntrantRow[], sub: SubmissionRow | null) => void
}) {
  const [enterOpen, setEnterOpen] = useState(false)
  const [entryEligible, setEntryEligible] = useState(tournament.entry_scope !== 'clan')
  const [eligibilityLoading, setEligibilityLoading] = useState(tournament.entry_scope === 'clan' && Boolean(user))
  const [hostClanName, setHostClanName] = useState('the host clan')
  const acceptedCount = entrants.filter((e) => e.status === 'accepted').length
  // The signed-out CTA names the app THIS address installs, not always TKO.
  const installLabel = useInstallLabel()

  useEffect(() => {
    if (tournament.entry_scope !== 'clan' || !tournament.server_id) {
      setEntryEligible(true)
      setEligibilityLoading(false)
      return
    }
    let cancelled = false
    async function checkClanAccess() {
      const [server, clanMember, serverMember] = await Promise.all([
        supabase.from('servers').select('owner_id, name').eq('id', tournament.server_id!).maybeSingle(),
        user
          ? supabase.from('clan_members').select('id').eq('server_id', tournament.server_id!).eq('user_id', user.id).limit(1)
          : Promise.resolve({ data: [] as { id: string }[] }),
        user
          ? supabase.from('server_members').select('id').eq('server_id', tournament.server_id!).eq('user_id', user.id).limit(1)
          : Promise.resolve({ data: [] as { id: string }[] }),
      ])
      if (cancelled) return
      setHostClanName(server.data?.name || 'the host clan')
      setEntryEligible(Boolean(
        user && (
          server.data?.owner_id === user.id ||
          (clanMember.data ?? []).length > 0 ||
          (serverMember.data ?? []).length > 0
        ),
      ))
      setEligibilityLoading(false)
    }
    void checkClanAccess()
    return () => { cancelled = true }
  }, [tournament.entry_scope, tournament.server_id, user])

  return (
    <div className="space-y-6">
      <div className="grid border-y border-dark-border py-4 sm:grid-cols-3">
        <div className="py-2 sm:border-r sm:border-dark-border sm:px-4">
          <p className="text-xs text-gray-500">Entry</p>
          <p className="mt-1 font-semibold text-white">
            {tournament.entry_scope === 'clan' ? 'Clan members only' : 'Host-set competition'}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {tournament.entry_scope === 'clan'
              ? `Only current members of ${hostClanName} can enter.`
              : 'Free entry or a non-cash Sweeps prize pool.'}
          </p>
        </div>
        <div className="border-t border-dark-border py-2 sm:border-r sm:border-t-0 sm:px-4">
          <p className="text-xs text-gray-500">Verification</p>
          <p className="mt-1 font-semibold text-white">Stat checks</p>
          <p className="mt-1 text-xs text-gray-400">Results are reviewed before ranking.</p>
        </div>
        <div className="border-t border-dark-border py-2 sm:border-t-0 sm:px-4">
          <p className="text-xs text-gray-500">Recognition</p>
          <p className="mt-1 font-semibold text-white">Power and prestige</p>
          <p className="mt-1 text-xs text-gray-400">Wins build rank, artifacts, and clan standing.</p>
        </div>
      </div>

      {/* Secondary detail blocks collapse under one-word sections so the prize
          + Oracle card stay front-and-center. Schedule opens by default; Rules
          tucks away. */}
      <CollapsibleSection id={`tourn-schedule-${tournament.id}`} label="Schedule" defaultOpen>
        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">When</h3>
            <dl className="text-sm space-y-1.5">
              <Row label="Starts">
                {tournament.start_at
                  ? new Date(tournament.start_at).toLocaleString()
                  : <span className="text-gray-500">TBD</span>}
              </Row>
              <Row label="Ends">
                {tournament.end_at
                  ? new Date(tournament.end_at).toLocaleString()
                  : <span className="text-gray-500">Open-ended</span>}
              </Row>
              <Row label="Status">{tournament.status ?? 'draft'}</Row>
            </dl>
          </div>
          <div>
            <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-2">Entrants</h3>
            <p className="text-3xl font-bold text-accent">
              {acceptedCount}
              <span className="text-sm text-gray-500 ml-1">accepted</span>
            </p>
            {entrants.filter((e) => e.status === 'pending').length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {entrants.filter((e) => e.status === 'pending').length} pending invites
              </p>
            )}
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection id={`tourn-rules-${tournament.id}`} label="Rules">
        {tournament.rules ? (
          <pre className="whitespace-pre-wrap text-gray-300 text-sm font-mono">{tournament.rules}</pre>
        ) : (
          <p className="text-gray-500 text-sm">
            {isOwner
              ? "You haven't published rules yet. Edit the tournament to add them."
              : 'No rules specified.'}
          </p>
        )}
      </CollapsibleSection>

      {/* Enter tournament CTA */}
      {user &&
        !isAcceptedEntrant &&
        !isAwaitingApproval &&
        myEntrant?.status !== 'rejected' &&
        entryEligible &&
        !eligibilityLoading &&
        tournament.status !== 'closed' && (
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-6 text-center">
          <h3 className="font-semibold text-lg mb-1">Ready to compete?</h3>
          <p className="text-sm text-gray-400 mb-4">
            Enter solo or with a team. You'll agree to the rules and submit a stat check video —
            the host reviews it and approves your entry.
          </p>
          <button
            type="button"
            onClick={() => setEnterOpen(true)}
            className="px-6 py-2.5 rounded-lg bg-accent text-dark font-semibold hover:bg-accent/90"
          >
            {myEntrant?.status === 'pending' ? 'Accept invite & enter' : 'Enter tournament'}
          </button>
        </div>
      )}

      {user && tournament.entry_scope === 'clan' && !eligibilityLoading && !entryEligible && (
        <div className="rounded-lg border border-kunai/40 bg-kunai/5 p-4 text-sm">
          <strong className="text-kunai">This is a members-only tournament.</strong>{' '}
          <span className="text-gray-400">Join {hostClanName} before entering.</span>
          {tournament.server_id && (
            <Link to={`/boards/${tournament.server_id}`} className="ml-2 font-semibold text-accent hover:underline">
              View clan
            </Link>
          )}
        </div>
      )}

      {user && isAwaitingApproval && (
        <div className="rounded-xl border border-chakra/40 bg-chakra/5 p-4 text-sm">
          <span className="text-chakra font-semibold">Entry submitted — awaiting host approval.</span>{' '}
          <span className="text-gray-400">
            The host reviews your stat check and approves or rejects your entry. You'll get a
            notification either way.
          </span>
        </div>
      )}

      {user && myEntrant?.status === 'rejected' && (
        <div className="rounded-xl border border-kunai/40 bg-kunai/5 p-4 text-sm">
          <span className="text-kunai font-semibold">Your entry was rejected by the host.</span>{' '}
          <span className="text-gray-400">Check your notifications for the reviewer's notes.</span>
        </div>
      )}

      {user && isAcceptedEntrant && (
        <div className="rounded-xl border border-leaf/40 bg-leaf/5 p-4 text-sm">
          <span className="text-leaf font-semibold">You're entered.</span>{' '}
          {myEntrant?.team_name ? (
            <>Team: <strong>{myEntrant.team_name}</strong></>
          ) : (
            <>Solo entry.</>
          )}
          {myEntrant?.agreed_to_rules_at && (
            <span className="text-xs text-gray-500 ml-2">
              — agreed to rules {new Date(myEntrant.agreed_to_rules_at).toLocaleString()}
            </span>
          )}
        </div>
      )}

      {!user && (
        // Signed-out recipients of a share link get the full read-only view;
        // only ENTERING is gated. Clear next steps: join (signup) or install.
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-6 text-center space-y-3">
          <h3 className="font-semibold text-lg">Want in on this tournament?</h3>
          <p className="text-sm text-gray-400">
            You can watch the bracket, stat checks, results, and chat for free.
            {tournament.entry_scope === 'clan'
              ? ` Sign in and join ${hostClanName} to enter.`
              : ' Create a free account to enter and compete.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/signup"
              className="px-5 py-2.5 rounded-lg bg-accent text-dark font-semibold hover:bg-accent/90"
            >
              Join TKO to enter
            </Link>
            <Link
              to="/login"
              className="px-5 py-2.5 rounded-lg border border-dark-border text-gray-200 hover:border-accent/50"
            >
              Log in
            </Link>
            <Link to="/marketing" className="text-accent text-sm hover:underline">
              {installLabel}
            </Link>
          </div>
        </div>
      )}

      {enterOpen && user && (
        <EnterTournamentDialog
          tournament={tournament}
          user={user}
          existingEntrant={myEntrant}
          onClose={() => setEnterOpen(false)}
          onEntered={onEntered}
        />
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-xs uppercase tracking-wider text-gray-500 w-20 shrink-0">{label}</dt>
      <dd className="text-gray-200">{children}</dd>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Enter tournament — agree rules, solo/team, stat check, invite teammates
// ─────────────────────────────────────────────────────────────────────────

function EnterTournamentDialog({
  tournament,
  user,
  existingEntrant,
  onClose,
  onEntered,
}: {
  tournament: Tournament
  user: { id: string }
  existingEntrant: EntrantRow | undefined
  onClose: () => void
  onEntered: (newEntrants: EntrantRow[], sub: SubmissionRow | null) => void
}) {
  const [agreed, setAgreed] = useState(false)
  const [teamMode, setTeamMode] = useState<'solo' | 'team'>(existingEntrant?.team_name ? 'team' : 'solo')
  const [teamName, setTeamName] = useState(existingEntrant?.team_name ?? '')
  const [teamServerId, setTeamServerId] = useState<string>(
    existingEntrant?.team_server_id ?? (tournament.entry_scope === 'clan' ? tournament.server_id ?? '' : ''),
  )
  const [videoUrl, setVideoUrl] = useState('')
  const [characterName, setCharacterName] = useState('')
  const [statDescription, setStatDescription] = useState('')
  const [invitedAdminId, setInvitedAdminId] = useState('')
  const [inviteUsernames, setInviteUsernames] = useState('')

  const [admins, setAdmins] = useState<{ user_id: string; username: string }[]>([])
  const [myServers, setMyServers] = useState<{ id: string; name: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const [admRes, servRes] = await Promise.all([
        supabase
          .from('tournament_admins')
          .select('user_id, can_approve_stat_check')
          .eq('tournament_id', tournament.id),
        supabase
          .from('server_members')
          .select('server_id')
          .eq('user_id', user.id),
      ])
      const adminUserIds = (admRes.data ?? [])
        .filter((a) => a.can_approve_stat_check !== false)
        .map((a) => a.user_id)
      if (adminUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username')
          .in('id', adminUserIds)
        setAdmins(
          (profiles ?? []).map((p) => ({ user_id: p.id, username: p.username })),
        )
      }
      const serverIds = (servRes.data ?? []).map((m) => m.server_id)
      const eligibleServerIds = tournament.entry_scope === 'clan' && tournament.server_id
        ? serverIds.filter((serverId) => serverId === tournament.server_id)
        : serverIds
      if (eligibleServerIds.length > 0) {
        const { data: servers } = await supabase
          .from('servers')
          .select('id, name')
          .in('id', eligibleServerIds)
        setMyServers((servers ?? []) as { id: string; name: string }[])
      }
    }
    load()
  }, [tournament.entry_scope, tournament.id, tournament.server_id, user.id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!agreed) {
      setError('You must agree to the tournament rules.')
      return
    }
    if (!videoUrl.trim()) {
      setError('A stat check video URL is required to enter.')
      return
    }
    setSubmitting(true)
    setError('')

    const now = new Date().toISOString()
    const team_name = teamMode === 'team' ? teamName.trim() || null : null
    const team_server_id = tournament.entry_scope === 'clan'
      ? tournament.server_id
      : teamMode === 'team' ? teamServerId || null : null

    // Step 1 — own entrant row (upsert if invited, otherwise insert).
    // NO self-approval: every entry lands status='pending' and only the host
    // flips it to 'accepted' through /api/fn/tournament-entrant-review (the
    // server enforces this even if a client sends status='accepted').
    let entrantRow: EntrantRow
    if (existingEntrant) {
      const { data, error: err } = await supabase
        .from('tournament_entrants')
        .update({
          agreed_to_rules_at: now,
          team_name,
          team_server_id,
        })
        .eq('id', existingEntrant.id)
        .select()
        .single()
      if (err || !data) {
        setError(err?.message ?? 'Could not accept entry.')
        setSubmitting(false)
        return
      }
      entrantRow = data as EntrantRow
    } else {
      const { data, error: err } = await supabase
        .from('tournament_entrants')
        .insert({
          tournament_id: tournament.id,
          user_id: user.id,
          status: 'pending',
          agreed_to_rules_at: now,
          team_name,
          team_server_id,
        })
        .select()
        .single()
      if (err || !data) {
        setError(err?.message ?? 'Could not enter tournament.')
        setSubmitting(false)
        return
      }
      entrantRow = data as EntrantRow
    }

    // Step 2 — stat check submission
    const { data: sub, error: subErr } = await supabase
      .from('stat_check_submissions')
      .insert({
        user_id: user.id,
        tournament_id: tournament.id,
        video_url: videoUrl.trim(),
        character_name: characterName.trim() || null,
        description: statDescription.trim() || null,
        invited_admin_id: invitedAdminId || null,
      })
      .select()
      .single()

    if (subErr || !sub) {
      setError(`Entered, but stat check failed: ${subErr?.message ?? 'unknown'}`)
      setSubmitting(false)
      onEntered([entrantRow], null)
      return
    }

    // Step 3 — invite teammates (best-effort; failures don't block)
    const inviteList = inviteUsernames
      .split(/[,\s]+/)
      .map((u) => u.trim().replace(/^@/, ''))
      .filter(Boolean)
    const invitedRows: EntrantRow[] = []
    if (inviteList.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username')
        .in('username', inviteList)
      const invitees = (profiles ?? []).filter((p) => p.id !== user.id)
      for (const p of invitees) {
        const { data: ent } = await supabase
          .from('tournament_entrants')
          .insert({
            tournament_id: tournament.id,
            user_id: p.id,
            status: 'pending',
            team_name,
            team_server_id,
            invited_by: user.id,
          })
          .select()
          .single()
        if (ent) {
          invitedRows.push({ ...(ent as EntrantRow), username: p.username })
          notify({
            userId: p.id,
            kind: 'tournament_team_invite',
            title: `${user.id === p.id ? 'You' : 'Someone'} invited you to a tournament`,
            body: `Join "${tournament.name}" as a teammate${team_name ? ` on ${team_name}` : ''}.`,
            link: `/tournaments/${tournament.id}`,
            relatedId: tournament.id,
          })
        }
      }
    }

    // Step 4 — notifications
    if (invitedAdminId) {
      notify({
        userId: invitedAdminId,
        kind: 'stat_check_review_request',
        title: 'New stat check review requested',
        body: `A player asked you to review their stat check for "${tournament.name}".`,
        link: `/tournaments/${tournament.id}?section=stat-check`,
        relatedId: sub.id,
      })
    } else {
      // Fan out to all admins who can approve AND the tournament creator —
      // the creator is the default reviewer and previously got no
      // review-request notification at all when no admins were registered.
      const reviewerIds = new Set(admins.map((a) => a.user_id))
      if (tournament.created_by) reviewerIds.add(tournament.created_by)
      reviewerIds.delete(user.id)
      notifyMany(Array.from(reviewerIds), {
        kind: 'stat_check_review_request',
        title: 'New stat check submitted',
        body: `Someone entered "${tournament.name}" and submitted a stat check for review.`,
        link: `/tournaments/${tournament.id}?section=stat-check`,
        relatedId: sub.id,
      })
    }
    if (tournament.created_by && tournament.created_by !== user.id) {
      notify({
        userId: tournament.created_by,
        kind: 'tournament_started',
        title: 'New entrant awaiting your approval',
        body: `Someone entered "${tournament.name}". Review their stat check, then approve or reject the entry.`,
        link: `/tournaments/${tournament.id}?section=entrants`,
        relatedId: tournament.id,
      })
    }

    invalidateInviteContext()
    setSubmitting(false)
    onEntered([entrantRow, ...invitedRows], sub as SubmissionRow)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-dark-border bg-dark-card shadow-2xl"
      >
        <div className="px-6 py-4 border-b border-dark-border flex items-center justify-between">
          <h2 className="font-semibold text-lg">Enter "{tournament.name}"</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Rules */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-2">
              1. Rules
            </h3>
            <div className="rounded-lg border border-dark-border bg-dark p-4 max-h-44 overflow-y-auto">
              {tournament.rules ? (
                <pre className="whitespace-pre-wrap text-sm text-gray-200 font-mono">
                  {tournament.rules}
                </pre>
              ) : (
                <p className="text-sm text-gray-500">
                  No rules published — by entering you accept fair-play conduct.
                </p>
              )}
            </div>
            <label className="flex items-start gap-2 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm">
                I have read and agree to the tournament rules.
              </span>
            </label>
          </section>

          {/* Solo / team */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-2">
              2. Entry type
            </h3>
            <div className="flex gap-2">
              {(['solo', 'team'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTeamMode(m)}
                  className={`flex-1 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    teamMode === m
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-dark-border text-gray-400 hover:border-accent/40'
                  }`}
                >
                  {m === 'solo' ? 'Solo' : 'Team'}
                </button>
              ))}
            </div>

            {teamMode === 'team' && (
              <div className="mt-3 space-y-3">
                <label className="block">
                  <span className="block text-xs text-gray-400 mb-1">Team name</span>
                  <input
                    type="text"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="e.g. KMH Squad A"
                    className="w-full px-3 py-2 rounded bg-dark border border-dark-border text-white text-sm"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs text-gray-400 mb-1">
                    {tournament.entry_scope === 'clan' ? 'Competing clan' : 'Register under a clan / server (optional)'}
                  </span>
                  <select
                    value={teamServerId}
                    onChange={(e) => setTeamServerId(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-dark border border-dark-border text-white text-sm"
                  >
                    {tournament.entry_scope !== 'clan' && <option value="">No clan</option>}
                    {myServers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {myServers.length === 0 && (
                    <span className="block text-[11px] text-gray-500 mt-1">
                      You're not in any clans.{' '}
                      <Link to="/boards/create" className="text-accent hover:underline">
                        Create one
                      </Link>
                      .
                    </span>
                  )}
                </label>
                <label className="block">
                  <span className="block text-xs text-gray-400 mb-1">
                    Invite teammates (comma- or space-separated usernames)
                  </span>
                  <input
                    type="text"
                    value={inviteUsernames}
                    onChange={(e) => setInviteUsernames(e.target.value)}
                    placeholder="patternaft3r mr_jerry"
                    className="w-full px-3 py-2 rounded bg-dark border border-dark-border text-white text-sm"
                  />
                  <span className="block text-[11px] text-gray-500 mt-1">
                    {tournament.entry_scope === 'clan'
                      ? 'Only current members of the competing clan can accept an invite.'
                      : 'Each teammate gets a notification and can accept their own entry.'}
                  </span>
                </label>
              </div>
            )}
          </section>

          {/* Stat check */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-2">
              3. Stat check video (required)
            </h3>
            <label className="block mb-3">
              <span className="block text-xs text-gray-400 mb-1">Video URL</span>
              <input
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://youtu.be/..."
                className="w-full px-3 py-2 rounded bg-dark border border-dark-border text-white text-sm"
                required
              />
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs text-gray-400 mb-1">Character (optional)</span>
                <input
                  type="text"
                  value={characterName}
                  onChange={(e) => setCharacterName(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-dark border border-dark-border text-white text-sm"
                />
              </label>
              <label className="block">
                <span className="block text-xs text-gray-400 mb-1">
                  Invite an admin to review (optional)
                </span>
                <select
                  value={invitedAdminId}
                  onChange={(e) => setInvitedAdminId(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-dark border border-dark-border text-white text-sm"
                >
                  <option value="">Any tournament admin</option>
                  {admins.map((a) => (
                    <option key={a.user_id} value={a.user_id}>
                      {a.username}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block mt-3">
              <span className="block text-xs text-gray-400 mb-1">Description (optional)</span>
              <textarea
                value={statDescription}
                onChange={(e) => setStatDescription(e.target.value)}
                rows={2}
                placeholder="What you're showing in the video"
                className="w-full px-3 py-2 rounded bg-dark border border-dark-border text-white text-sm resize-none"
              />
            </label>
          </section>

          {error && <p className="text-kunai text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-dark-border flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-dark-border text-gray-400 hover:border-accent/40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !agreed || !videoUrl.trim()}
            className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold disabled:opacity-50"
          >
            {submitting ? 'Entering…' : 'Enter & submit stat check'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Entrants list
// ─────────────────────────────────────────────────────────────────────────

function EntrantsSection({
  entrants,
  setEntrants,
  tournamentId: _tournamentId,
  isOwner,
  canManage,
  submissions,
  setSubmissions,
  user,
}: {
  entrants: EntrantRow[]
  setEntrants: React.Dispatch<React.SetStateAction<EntrantRow[]>>
  tournamentId: string
  isOwner: boolean
  canManage: boolean
  submissions: SubmissionRow[]
  setSubmissions: React.Dispatch<React.SetStateAction<SubmissionRow[]>>
  user: { id: string } | null
}) {
  async function withdraw(entrant: EntrantRow) {
    if (!user || (entrant.user_id !== user.id && !isOwner)) return
    await supabase
      .from('tournament_entrants')
      .update({ status: 'withdrawn' })
      .eq('id', entrant.id)
    setEntrants((prev) =>
      prev.map((e) => (e.id === entrant.id ? { ...e, status: 'withdrawn' } : e)),
    )
  }

  const accepted = entrants.filter((e) => e.status === 'accepted')
  // 'pending' means two different things: entered-and-awaiting-host-approval
  // (agreed_to_rules_at set) vs invited-as-a-teammate (not agreed yet).
  const awaitingApproval = entrants.filter(
    (e) => e.status === 'pending' && Boolean(e.agreed_to_rules_at),
  )
  const pendingInvites = entrants.filter(
    (e) => e.status === 'pending' && !e.agreed_to_rules_at,
  )
  const rejected = entrants.filter((e) => e.status === 'rejected')

  if (entrants.length === 0) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark-card p-12 text-center text-gray-400">
        No one has entered yet. Be the first.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* HOST REVIEW QUEUE — the click-through target of the "new entrant"
          notification. Shows each awaiting entrant WITH their stat check so
          the host can approve or reject in place. */}
      {canManage && awaitingApproval.length > 0 && (
        <EntrantApprovalQueue
          entrants={awaitingApproval}
          submissions={submissions}
          setEntrants={setEntrants}
          setSubmissions={setSubmissions}
        />
      )}
      {!canManage && awaitingApproval.length > 0 && (
        <EntrantsList
          title={`Awaiting host approval (${awaitingApproval.length})`}
          entrants={awaitingApproval}
          onWithdraw={withdraw}
          user={user}
          isOwner={isOwner}
          subdued
        />
      )}
      <EntrantsList title={`Accepted (${accepted.length})`} entrants={accepted} onWithdraw={withdraw} user={user} isOwner={isOwner} />
      {pendingInvites.length > 0 && (
        <EntrantsList
          title={`Pending invites (${pendingInvites.length})`}
          entrants={pendingInvites}
          onWithdraw={withdraw}
          user={user}
          isOwner={isOwner}
          subdued
        />
      )}
      {rejected.length > 0 && (
        <EntrantsList
          title={`Rejected (${rejected.length})`}
          entrants={rejected}
          onWithdraw={withdraw}
          user={user}
          isOwner={isOwner}
          subdued
        />
      )}
    </div>
  )
}

/**
 * EntrantApprovalQueue — owner/admin-only. One card per entrant awaiting
 * approval: who they are, the stat check(s) they submitted, and APPROVE /
 * REJECT actions. The decision goes through the trusted server fn
 * `tournament-entrant-review` (owner/admin-validated server-side), which also
 * stamps the entrant's pending stat checks and notifies the player.
 */
function EntrantApprovalQueue({
  entrants,
  submissions,
  setEntrants,
  setSubmissions,
}: {
  entrants: EntrantRow[]
  submissions: SubmissionRow[]
  setEntrants: React.Dispatch<React.SetStateAction<EntrantRow[]>>
  setSubmissions: React.Dispatch<React.SetStateAction<SubmissionRow[]>>
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notesById, setNotesById] = useState<Record<string, string>>({})

  async function review(entrant: EntrantRow, decision: 'approve' | 'reject') {
    setBusyId(entrant.id)
    setError('')
    const { data, error: err } = await supabase.functions.invoke('tournament-entrant-review', {
      body: {
        entrantId: entrant.id,
        decision,
        notes: (notesById[entrant.id] ?? '').trim() || null,
      },
    })
    setBusyId(null)
    if (err || !data?.ok) {
      setError((err as { message?: string } | null)?.message ?? data?.error ?? 'Review failed.')
      return
    }
    const newStatus = decision === 'approve' ? 'accepted' : 'rejected'
    setEntrants((prev) =>
      prev.map((e) => (e.id === entrant.id ? { ...e, status: newStatus } : e)),
    )
    // The fn also resolves the entrant's pending stat checks — mirror locally.
    setSubmissions((prev) =>
      prev.map((s) =>
        s.user_id === entrant.user_id && s.status === 'pending'
          ? { ...s, status: decision === 'approve' ? 'approved' : 'rejected' }
          : s,
      ),
    )
  }

  return (
    <section className="rounded-xl border border-chakra/40 bg-chakra/5 p-4">
      <h2 className="font-semibold mb-1">
        Awaiting your approval
        <span className="ml-2 text-[11px] bg-chakra/20 text-chakra rounded-full px-2 py-0.5">
          {entrants.length}
        </span>
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        Review each entrant's stat check, then approve or reject their entry. Approving also marks
        their pending stat check approved.
      </p>
      {error && <p className="text-xs text-kunai mb-3">{error}</p>}
      <div className="space-y-3">
        {entrants.map((e) => {
          const subs = submissions.filter((s) => s.user_id === e.user_id)
          return (
            <div key={e.id} className="rounded-lg border border-dark-border bg-dark-card p-3">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Avatar src={e.avatar_url} name={e.username} seed={e.user_id} size={24} />
                <Link to={`/profile/${e.user_id}`} className="text-accent font-medium hover:underline">
                  @{e.username ?? 'Player'}
                </Link>
                {e.team_name && <span className="text-xs text-gray-400">Team: {e.team_name}</span>}
                {e.agreed_to_rules_at && (
                  <span className="text-[11px] text-gray-500">
                    agreed to rules {new Date(e.agreed_to_rules_at).toLocaleString()}
                  </span>
                )}
              </div>
              {subs.length === 0 ? (
                <p className="text-xs text-gray-500 mb-2">
                  No stat check on file for this entrant yet.
                </p>
              ) : (
                <ul className="space-y-1 mb-2">
                  {subs.map((s) => (
                    <li key={s.id} className="text-xs">
                      <a
                        href={s.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline break-all"
                      >
                        {s.video_url}
                      </a>
                      <span className="text-gray-500 ml-2">
                        {s.character_name ? `${s.character_name} · ` : ''}
                        {s.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <textarea
                value={notesById[e.id] ?? ''}
                onChange={(ev) =>
                  setNotesById((prev) => ({ ...prev, [e.id]: ev.target.value }))
                }
                rows={1}
                placeholder="Notes for the player (optional)…"
                className="w-full px-3 py-1.5 mb-2 rounded-lg bg-dark border border-dark-border text-white text-xs resize-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busyId === e.id}
                  onClick={() => review(e, 'approve')}
                  className="flex-1 px-3 py-2 rounded text-sm font-semibold bg-leaf/20 border border-leaf/40 text-leaf hover:bg-leaf/30 disabled:opacity-40"
                >
                  Approve entry
                </button>
                <button
                  type="button"
                  disabled={busyId === e.id}
                  onClick={() => review(e, 'reject')}
                  className="flex-1 px-3 py-2 rounded text-sm font-semibold bg-kunai/20 border border-kunai/40 text-kunai hover:bg-kunai/30 disabled:opacity-40"
                >
                  Reject
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function EntrantsList({
  title,
  entrants,
  onWithdraw,
  user,
  isOwner,
  subdued = false,
}: {
  title: string
  entrants: EntrantRow[]
  onWithdraw: (e: EntrantRow) => void
  user: { id: string } | null
  isOwner: boolean
  subdued?: boolean
}) {
  // Group by team_name (empty team = solo bucket).
  const groups = new Map<string, EntrantRow[]>()
  for (const e of entrants) {
    const key = e.team_name?.trim() || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(e)
  }

  return (
    <section>
      <h2 className={`font-semibold mb-3 ${subdued ? 'text-gray-400' : ''}`}>{title}</h2>
      <div className="space-y-3">
        {Array.from(groups.entries()).map(([teamKey, members]) => (
          <div key={teamKey || 'solo'} className="rounded-lg border border-dark-border bg-dark-card p-3">
            {teamKey ? (
              <div className="flex items-center gap-2 mb-2 text-sm">
                <span className="font-semibold">{teamKey}</span>
                {members[0].team_server_name && (
                  <Link
                    to={`/boards/${members[0].team_server_id}`}
                    className="text-xs text-accent hover:underline"
                  >
                    @{members[0].team_server_name}
                  </Link>
                )}
              </div>
            ) : (
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Solo entries</div>
            )}
            <ul className="divide-y divide-dark-border">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-2 py-2 text-sm"
                >
                  <Avatar src={m.avatar_url} name={m.username} seed={m.user_id} size={24} />
                  <Link
                    to={`/profile/${m.user_id}`}
                    className="text-accent hover:underline"
                  >
                    @{m.username}
                  </Link>
                  {m.invited_by && m.invited_by !== m.user_id && (
                    <span className="text-[11px] text-gray-500">invited</span>
                  )}
                  {m.status === 'withdrawn' && (
                    <span className="text-[11px] text-kunai">withdrawn</span>
                  )}
                  {m.status === 'rejected' && (
                    <span className="text-[11px] text-kunai">rejected</span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {(user?.id === m.user_id || isOwner) && m.status !== 'withdrawn' && (
                      <button
                        type="button"
                        onClick={() => onWithdraw(m)}
                        className="text-[11px] text-gray-400 hover:text-kunai"
                      >
                        {user?.id === m.user_id ? 'Withdraw' : 'Remove'}
                      </button>
                    )}
                    <InviteMenu targetUserId={m.user_id} targetUsername={m.username ?? 'player'} compact />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Stat Check (gated to entrants; admin review needs can_approve_stat_check)
// ─────────────────────────────────────────────────────────────────────────

function StatCheckSection({
  tournamentId,
  tournamentName,
  tournamentOwnerId,
  submissions,
  setSubmissions,
  user,
  isOwner,
  canApproveStatCheck,
  isEntrant,
  admins,
  tournamentRules: _tournamentRules,
  onStatCheckApproved,
}: {
  tournamentId: string
  tournamentName: string
  tournamentOwnerId: string | null
  submissions: SubmissionRow[]
  setSubmissions: React.Dispatch<React.SetStateAction<SubmissionRow[]>>
  user: { id: string } | null
  isOwner: boolean
  canApproveStatCheck: boolean
  isEntrant: boolean
  admins: AdminRow[]
  tournamentRules: string | null
  /** Called after a stat check is APPROVED — cascades entry approval. */
  onStatCheckApproved?: (submitterId: string) => Promise<void>
}) {
  const [videoUrl, setVideoUrl] = useState('')
  const [characterName, setCharacterName] = useState('')
  const [description, setDescription] = useState('')
  const [invitedAdminId, setInvitedAdminId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !videoUrl.trim() || submitting || !isEntrant) return
    setSubmitting(true)
    const { data } = await supabase
      .from('stat_check_submissions')
      .insert({
        user_id: user.id,
        video_url: videoUrl.trim(),
        character_name: characterName.trim() || null,
        description: description.trim() || null,
        tournament_id: tournamentId,
        invited_admin_id: invitedAdminId || null,
      })
      .select()
      .single()
    setSubmitting(false)
    if (data) {
      setSubmissions((prev) => [data as SubmissionRow, ...prev])
      setVideoUrl('')
      setCharacterName('')
      setDescription('')
      setInvitedAdminId('')
      // Notify reviewer(s)
      if (invitedAdminId) {
        notify({
          userId: invitedAdminId,
          kind: 'stat_check_review_request',
          title: 'New stat check review requested',
          body: `A player asked you to review their stat check for "${tournamentName}".`,
          link: `/tournaments/${tournamentId}?section=stat-check`,
          relatedId: data.id,
        })
      } else {
        // Approving admins AND the tournament creator (default reviewer —
        // previously left out entirely, so owner-run tournaments with no
        // registered admins notified nobody).
        const eligible = new Set(
          admins
            .filter((a) => a.can_approve_stat_check !== false)
            .map((a) => a.user_id),
        )
        if (tournamentOwnerId) eligible.add(tournamentOwnerId)
        eligible.delete(user.id)
        notifyMany(Array.from(eligible), {
          kind: 'stat_check_review_request',
          title: 'New stat check submitted',
          body: `A new stat check landed in "${tournamentName}".`,
          link: `/tournaments/${tournamentId}?section=stat-check`,
          relatedId: data.id,
        })
      }
    }
  }

  async function handleReview(s: SubmissionRow, status: 'approved' | 'rejected', notes: string) {
    if (!user || !canApproveStatCheck) return
    await supabase
      .from('stat_check_submissions')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
        review_notes: notes.trim() || null,
      })
      .eq('id', s.id)
    setSubmissions((prev) =>
      prev.map((x) =>
        x.id === s.id
          ? {
              ...x,
              status,
              reviewed_by: user.id,
              reviewed_at: new Date().toISOString(),
              review_notes: notes.trim() || null,
            }
          : x,
      ),
    )
    notify({
      userId: s.user_id,
      kind: 'stat_check_reviewed',
      title: `Your stat check was ${status}`,
      body: notes.trim() ? `Reviewer note: ${notes.trim()}` : null,
      link: `/tournaments/${tournamentId}?section=stat-check`,
      relatedId: s.id,
    })
    if (status === 'approved' && onStatCheckApproved) {
      await onStatCheckApproved(s.user_id)
    }
  }

  async function handleCreatorDecision(
    s: SubmissionRow,
    decision: StatCheckCreatorDecision,
    notes: string,
  ) {
    if (!isOwner) return
    await supabase
      .from('stat_check_submissions')
      .update({
        creator_decision: decision,
        creator_notes: notes.trim() || null,
        creator_decided_at: new Date().toISOString(),
      })
      .eq('id', s.id)
    setSubmissions((prev) =>
      prev.map((x) =>
        x.id === s.id
          ? {
              ...x,
              creator_decision: decision,
              creator_notes: notes.trim() || null,
              creator_decided_at: new Date().toISOString(),
            }
          : x,
      ),
    )
    notify({
      userId: s.user_id,
      kind: 'stat_check_creator_decision',
      title: `Tournament creator decision: ${labelForDecision(decision)}`,
      body: notes.trim() || null,
      link: `/tournaments/${tournamentId}?section=stat-check`,
      relatedId: s.id,
    })
  }

  return (
    <div className="space-y-6">
      {/* The Stat Check Room, scoped to THIS tournament. The room needs a
          tournament to post into — a submission without one reaches no host —
          and this is the surface that hands it over. */}
      <Link
        to={`/stat-check-room?tournament=${tournamentId}`}
        className="flex items-center justify-between gap-3 rounded-xl border border-dark-border bg-dark-card px-4 py-3 hover:border-accent/50 transition-colors"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-white">Stat Check Room</span>
          <span className="block text-xs text-gray-500">
            Watch every stat check posted for {tournamentName} — and post yours.
          </span>
        </span>
        <span className="shrink-0 text-sm text-accent">Open →</span>
      </Link>

      {user && isEntrant && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-dark-border bg-dark-card p-6">
          <h2 className="font-semibold mb-4">Submit additional stat check for {tournamentName}</h2>
          <p className="text-xs text-gray-500 mb-3">
            You already submitted one when you entered. Use this only if you need to re-submit
            (e.g. swapped characters).
          </p>
          <div className="space-y-3">
            <input
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
              required
            />
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={characterName}
                onChange={(e) => setCharacterName(e.target.value)}
                placeholder="Character (optional)"
                className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
              />
              <select
                value={invitedAdminId}
                onChange={(e) => setInvitedAdminId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
              >
                <option value="">Any approving admin</option>
                {admins
                  .filter((a) => a.can_approve_stat_check !== false)
                  .map((a) => (
                    <option key={a.user_id} value={a.user_id}>
                      {a.username}
                    </option>
                  ))}
              </select>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes for the reviewer (optional)"
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm resize-none"
            />
            <button
              type="submit"
              disabled={submitting || !videoUrl.trim()}
              className="px-4 py-2 rounded-lg bg-accent text-dark font-medium disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </form>
      )}

      {user && !isEntrant && (
        <div className="rounded-xl border border-dark-border bg-dark-card p-6 text-center">
          <p className="text-gray-400 mb-3">
            You haven't entered this tournament yet. Stat checks are submitted as part of the
            entry flow.
          </p>
          <Link
            to={`/tournaments/${tournamentId}`}
            className="text-accent hover:underline"
          >
            Go to overview to enter →
          </Link>
        </div>
      )}

      <div>
        <h2 className="font-semibold mb-4">Submissions</h2>
        {submissions.length === 0 ? (
          <div className="rounded-xl border border-dark-border bg-dark-card p-12 text-center text-gray-400">
            No submissions yet.
          </div>
        ) : (
          <div className="space-y-4">
            {submissions.map((s) => (
              <SubmissionCard
                key={s.id}
                s={s}
                canReview={canApproveStatCheck}
                isOwner={isOwner}
                onReview={handleReview}
                onCreatorDecision={handleCreatorDecision}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SubmissionCard({
  s,
  canReview,
  isOwner,
  onReview,
  onCreatorDecision,
}: {
  s: SubmissionRow
  canReview: boolean
  isOwner: boolean
  onReview: (s: SubmissionRow, status: 'approved' | 'rejected', notes: string) => void
  onCreatorDecision: (s: SubmissionRow, decision: StatCheckCreatorDecision, notes: string) => void
}) {
  const [reviewNotes, setReviewNotes] = useState('')
  const [creatorNotes, setCreatorNotes] = useState('')
  const showCreatorPanel =
    isOwner && (s.status === 'approved' || s.status === 'rejected') && !s.creator_decision

  return (
    <div className="rounded-lg border border-dark-border bg-dark-card p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Link
          to={`/profile/${s.user_id}`}
          className="text-accent font-medium hover:underline"
        >
          {s.submitter_username ?? 'Player'}
        </Link>
        <StatusBadge status={s.status} />
        {s.invited_admin_id && (
          <span className="text-[11px] text-gray-500">→ invited reviewer</span>
        )}
        {s.creator_decision && (
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-accent/40 text-accent bg-accent/10">
            creator: {s.creator_decision}
          </span>
        )}
      </div>
      <a
        href={s.video_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent hover:underline block truncate"
      >
        {s.video_url}
      </a>
      {s.character_name && <p className="text-sm text-gray-400 mt-1">Character: {s.character_name}</p>}
      {s.description && (
        <p className="text-sm text-gray-400 mt-1 whitespace-pre-wrap">{s.description}</p>
      )}
      {s.review_notes && (
        <div className="mt-2 rounded border border-dark-border bg-dark p-2 text-xs">
          <span className="text-gray-500">Admin notes</span>
          <p className="text-gray-200 whitespace-pre-wrap mt-0.5">{s.review_notes}</p>
        </div>
      )}
      {s.creator_notes && (
        <div className="mt-2 rounded border border-accent/30 bg-accent/5 p-2 text-xs">
          <span className="text-accent font-semibold uppercase tracking-wider">Creator notes</span>
          <p className="text-gray-200 whitespace-pre-wrap mt-0.5">{s.creator_notes}</p>
        </div>
      )}
      <p className="text-xs text-gray-500 mt-2">{new Date(s.created_at).toLocaleString()}</p>

      {canReview && s.status === 'pending' && (
        <div className="mt-3 space-y-2">
          <textarea
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            rows={2}
            placeholder="Review notes (optional, visible to creator + player)…"
            className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => onReview(s, 'approved', reviewNotes)}
              className="px-3 py-1 rounded text-sm bg-leaf/15 border border-leaf/40 text-leaf hover:bg-leaf/30"
            >
              Approve
            </button>
            <button
              onClick={() => onReview(s, 'rejected', reviewNotes)}
              className="px-3 py-1 rounded text-sm bg-kunai/15 border border-kunai/40 text-kunai hover:bg-kunai/30"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {showCreatorPanel && (
        <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
          <p className="text-xs text-accent font-semibold uppercase tracking-wider">
            Your decision (tournament creator)
          </p>
          <textarea
            value={creatorNotes}
            onChange={(e) => setCreatorNotes(e.target.value)}
            rows={2}
            placeholder="Notes for the player (optional)…"
            className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm resize-none"
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <button
              onClick={() => onCreatorDecision(s, 'allow', creatorNotes)}
              className="px-2 py-1 rounded text-xs font-semibold bg-leaf/15 border border-leaf/40 text-leaf hover:bg-leaf/30"
            >
              Allow
            </button>
            <button
              onClick={() => onCreatorDecision(s, 'disqualify', creatorNotes)}
              className="px-2 py-1 rounded text-xs font-semibold bg-kunai/15 border border-kunai/40 text-kunai hover:bg-kunai/30"
            >
              Disqualify
            </button>
            <button
              onClick={() => onCreatorDecision(s, 'no_action', creatorNotes)}
              className="px-2 py-1 rounded text-xs font-semibold border border-dark-border text-gray-300 hover:border-accent/40"
            >
              No action
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; text: string }> = {
    pending: { cls: 'bg-chakra/15 border-chakra/40 text-chakra', text: 'pending' },
    approved: { cls: 'bg-leaf/15 border-leaf/40 text-leaf', text: 'approved' },
    rejected: { cls: 'bg-kunai/15 border-kunai/40 text-kunai', text: 'rejected' },
  }
  const m = map[status] ?? map.pending
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${m.cls}`}>{m.text}</span>
  )
}

function labelForDecision(d: StatCheckCreatorDecision): string {
  return d === 'allow' ? 'Allow' : d === 'disqualify' ? 'Disqualify' : 'No action'
}

// ─────────────────────────────────────────────────────────────────────────
// Submit results (winners) — minor cleanup, unchanged behavior
// ─────────────────────────────────────────────────────────────────────────

function SubmitResultSection({
  tournamentId,
  tournamentName,
  results,
  setResults,
  user,
  canManage,
}: {
  tournamentId: string
  tournamentName: string
  results: TournamentResult[]
  setResults: React.Dispatch<React.SetStateAction<TournamentResult[]>>
  user: { id: string } | null
  canManage: boolean
}) {
  const [winnerSearch, setWinnerSearch] = useState('')
  const [teamName, setTeamName] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; username: string }[]>([])
  const [selectedWinner, setSelectedWinner] = useState<{ id: string; username: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!winnerSearch.trim() || winnerSearch.length < 2) {
      setSearchResults([])
      return
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, username')
        .ilike('username', `%${winnerSearch}%`)
        .limit(10)
      setSearchResults(data ?? [])
    }, 200)
    return () => clearTimeout(t)
  }, [winnerSearch])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !canManage || !selectedWinner || submitting) return
    setSubmitting(true)
    const { data: res } = await supabase
      .from('tournament_results')
      .insert({
        tournament_id: tournamentId,
        winner_profile_id: selectedWinner.id,
        team_name: teamName.trim() || null,
        submitted_by: user.id,
      })
      .select()
      .single()
    if (res) {
      await supabase.from('trophies').insert({
        profile_id: selectedWinner.id,
        trophy_type: 'tournament_win',
        metadata: { tournament_id: tournamentId, tournament_name: tournamentName },
      })
      setResults((prev) => [{ ...res, winner_username: selectedWinner.username }, ...prev])
      setSelectedWinner(null)
      setWinnerSearch('')
      setTeamName('')
    }
    setSubmitting(false)
  }

  if (!canManage) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark-card p-6">
        <h2 className="font-semibold mb-4">Winners</h2>
        {results.length === 0 ? (
          <p className="text-gray-400">No results submitted yet.</p>
        ) : (
          <div className="space-y-2">
            {results.map((r) => (
              <div key={r.id} className="flex items-center justify-between">
                <Link to={`/profile/${r.winner_profile_id}`} className="text-accent hover:underline">
                  {r.winner_username ?? 'Unknown'}
                </Link>
                {r.team_name && <span className="text-gray-400 text-sm">({r.team_name})</span>}
                <span className="text-xs text-gray-500">{new Date(r.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="rounded-xl border border-dark-border bg-dark-card p-6">
        <h2 className="font-semibold mb-4">Submit Result (Winner)</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Search winner by username</label>
            <input
              type="text"
              value={winnerSearch}
              onChange={(e) => {
                setWinnerSearch(e.target.value)
                setSelectedWinner(null)
              }}
              placeholder="Type username..."
              className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
            />
            {searchResults.length > 0 && !selectedWinner && (
              <ul className="mt-1 border border-dark-border rounded-lg overflow-hidden">
                {searchResults.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWinner(p)
                        setWinnerSearch(p.username)
                        setSearchResults([])
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-accent/10 text-accent"
                    >
                      {p.username}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selectedWinner && (
              <p className="text-sm text-accent mt-1">Selected: {selectedWinner.username}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Team name (optional)</label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. KMH"
              className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
            />
          </div>
          <button
            type="submit"
            disabled={!selectedWinner || submitting}
            className="px-4 py-2 rounded-lg bg-accent text-dark font-medium disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Result'}
          </button>
        </div>
      </form>

      <div>
        <h2 className="font-semibold mb-4">Winners</h2>
        {results.length === 0 ? (
          <p className="text-gray-400">No results yet.</p>
        ) : (
          <div className="space-y-2">
            {results.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-dark-border bg-dark-card p-3"
              >
                <Link to={`/profile/${r.winner_profile_id}`} className="text-accent hover:underline">
                  {r.winner_username ?? 'Unknown'}
                </Link>
                {r.team_name && <span className="text-gray-400 text-sm">({r.team_name})</span>}
                <span className="text-xs text-gray-500">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Admins — list + per-admin permission toggle (creator only)
// ─────────────────────────────────────────────────────────────────────────

function AdminsSection({
  tournamentId,
  tournamentName,
  admins,
  setAdmins,
  user,
  isOwner,
}: {
  tournamentId: string
  tournamentName: string
  admins: AdminRow[]
  setAdmins: React.Dispatch<React.SetStateAction<AdminRow[]>>
  user: { id: string } | null
  isOwner: boolean
}) {
  const [adminSearch, setAdminSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; username: string }[]>([])

  useEffect(() => {
    if (!adminSearch.trim() || adminSearch.length < 2) {
      setSearchResults([])
      return
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, username')
        .ilike('username', `%${adminSearch}%`)
        .limit(10)
      setSearchResults(data ?? [])
    }, 200)
    return () => clearTimeout(t)
  }, [adminSearch])

  async function addAdmin(profileId: string, username: string) {
    if (!isOwner) return
    const { data } = await supabase
      .from('tournament_admins')
      .insert({ tournament_id: tournamentId, user_id: profileId })
      .select()
      .single()
    if (data) {
      setAdmins((prev) => [...prev, { ...(data as AdminRow), username }])
      notify({
        userId: profileId,
        kind: 'tournament_admin_invite',
        title: 'You were added as a tournament admin',
        body: `You can review stat checks for "${tournamentName}".`,
        link: `/tournaments/${tournamentId}?section=admins`,
        relatedId: tournamentId,
      })
    }
    setAdminSearch('')
    setSearchResults([])
    invalidateInviteContext()
  }

  async function removeAdmin(adminId: string) {
    if (!isOwner) return
    await supabase.from('tournament_admins').delete().eq('id', adminId)
    setAdmins((prev) => prev.filter((a) => a.id !== adminId))
  }

  async function togglePerm(adminId: string, key: 'can_approve_stat_check' | 'can_submit_results', value: boolean) {
    if (!isOwner) return
    await supabase.from('tournament_admins').update({ [key]: value }).eq('id', adminId)
    setAdmins((prev) => prev.map((a) => (a.id === adminId ? { ...a, [key]: value } : a)))
  }

  if (!isOwner) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark-card p-6">
        <h2 className="font-semibold mb-4">Admins</h2>
        {admins.length === 0 ? (
          <p className="text-gray-400">No admins.</p>
        ) : (
          <ul className="space-y-2">
            {admins.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <Link to={`/profile/${a.user_id}`} className="text-accent hover:underline">
                  {a.username ?? 'Unknown'}
                </Link>
                <span className="text-[11px] text-gray-500">
                  {a.can_approve_stat_check === false ? 'view only' : 'approves stat checks'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-6">
      <h2 className="font-semibold mb-2">Manage admins</h2>
      <p className="text-sm text-gray-400 mb-4">
        Add tournament admins and choose which ones can approve stat checks. Admins without that
        permission can still see submissions but only the ones with the toggle on can mark them
        approved or rejected.
      </p>

      <div className="mb-5">
        <label className="block text-sm text-gray-400 mb-1">Find a user by username</label>
        <input
          type="text"
          value={adminSearch}
          onChange={(e) => setAdminSearch(e.target.value)}
          placeholder="Type username…"
          className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
        />
        {searchResults.length > 0 && (
          <ul className="mt-1 border border-dark-border rounded-lg overflow-hidden divide-y divide-dark-border">
            {searchResults
              .filter((p) => !admins.some((a) => a.user_id === p.id))
              .map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between px-4 py-2 bg-dark-card hover:bg-accent/5"
                >
                  <Link to={`/profile/${p.id}`} className="text-accent hover:underline">
                    {p.username}
                  </Link>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => addAdmin(p.id, p.username)}
                      className="px-2 py-1 rounded text-xs font-semibold bg-accent text-dark"
                    >
                      Add as admin
                    </button>
                    <InviteMenu
                      targetUserId={p.id}
                      targetUsername={p.username}
                      context={{ tournamentId }}
                      label="More"
                    />
                  </div>
                </li>
              ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-2">Current admins</h3>
        {admins.length === 0 ? (
          <p className="text-gray-400 text-sm">No admins yet.</p>
        ) : (
          <ul className="space-y-2">
            {admins.map((a) => (
              <li
                key={a.id}
                className="rounded-lg border border-dark-border bg-dark p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <Link to={`/profile/${a.user_id}`} className="text-accent hover:underline">
                    {a.username ?? 'Unknown'}
                  </Link>
                  <div className="flex items-center gap-2">
                    <InviteMenu
                      targetUserId={a.user_id}
                      targetUsername={a.username ?? 'admin'}
                      context={{ tournamentId }}
                      compact
                    />
                    <button
                      onClick={() => removeAdmin(a.id)}
                      className="text-kunai hover:text-kunai/80 text-sm"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-xs">
                  <PermToggle
                    label="Can approve stat checks"
                    value={a.can_approve_stat_check !== false}
                    onChange={(v) => togglePerm(a.id, 'can_approve_stat_check', v)}
                    disabled={user?.id === a.user_id /* don't let owner toggle themselves */}
                  />
                  <PermToggle
                    label="Can submit results"
                    value={a.can_submit_results !== false}
                    onChange={(v) => togglePerm(a.id, 'can_submit_results', v)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function PermToggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      className={`inline-flex items-center gap-2 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className="text-gray-300">{label}</span>
    </label>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Oracle Prediction — cash-free "guess the winner" card.
//
// Before a result is recorded the signed-in user picks who they think will win
// (from the accepted entrants when known, else a free-text fallback). Their TIER
// caps how many tournaments they can have an OPEN prediction on at once. Once a
// winner is on record the card locks and grades their guess; a correct call
// grants a cosmetic asset into their locker + Oracle-badge progress. No cash.
// (Scaffold: predictions live in localStorage — see src/lib/predictions.ts.)
// ─────────────────────────────────────────────────────────────────────────

function OraclePredictionCard({
  tournament,
  entrants,
  winnerResult,
  user,
}: {
  tournament: Tournament
  entrants: EntrantRow[]
  winnerResult: TournamentResult | null
  user: { id: string } | null
}) {
  const { tier } = useEntitlements()
  const userId = user?.id ?? ''
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [freeText, setFreeText] = useState('')
  const [error, setError] = useState('')
  const bump = () => setRefreshKey((k) => k + 1)

  // Accepted entrants become the pick list; keyed by user_id so a correct guess
  // matches tournament_results.winner_profile_id at resolution time.
  const options = useMemo(
    () =>
      entrants
        .filter((e) => e.status === 'accepted')
        .map((e) => ({
          id: e.user_id,
          label: e.team_name?.trim()
            ? `${e.username ?? 'Player'} · ${e.team_name}`
            : e.username ?? 'Player',
        })),
    [entrants],
  )

  const myPrediction = useMemo(
    () => (userId ? getPredictionForTournament(userId, tournament.id) : null),
    [userId, tournament.id, refreshKey],
  )
  const stats = useMemo(
    () => (userId ? getStats(userId) : null),
    [userId, refreshKey],
  )

  // Hydrate this user's predictions from the server on mount / user change.
  useEffect(() => {
    if (!userId) return
    void loadPredictions(userId).then(bump)
  }, [userId])

  // Once a winner is recorded, ask the server to grade any still-open
  // prediction. Note that we do NOT pass the winner: the server reads it off
  // `tournament_results`, so every user is graded against the same result.
  useEffect(() => {
    if (!userId || !winnerResult) return
    if (getOpenForTournament(userId, tournament.id)) {
      void gradePrediction(userId, tournament.id).then(bump)
    }
  }, [userId, winnerResult, tournament.id])

  async function submit() {
    setError('')
    let pick: PredictionPick | null = null
    if (options.length > 0 && selectedId) {
      const opt = options.find((o) => o.id === selectedId)
      pick = opt ? { winnerId: opt.id, label: opt.label } : null
    } else if (freeText.trim()) {
      const v = freeText.trim()
      pick = { winnerId: v, label: v }
    }
    if (!pick) {
      setError('Pick who you think will win first.')
      return
    }
    // The server re-checks the quota against the account's real tier; `tier`
    // here only drives the upgrade nudge copy below.
    const res = await submitPrediction({ userId, tournamentId: tournament.id, pick })
    if (res.ok) {
      setSelectedId('')
      setFreeText('')
      bump()
    } else if (res.reason === 'quota') {
      setError(predictionUpgradeNudge(tier))
    } else if (res.reason === 'exists') {
      setError('You already have an open prediction on this tournament.')
    } else {
      setError('Sign in to make a prediction.')
    }
  }

  async function handleCancel() {
    if (await withdrawPrediction(userId, tournament.id)) bump()
  }

  const header = (
    <div className="flex items-center gap-2 mb-1">
      <span aria-hidden>🔮</span>
      <h2 className="font-semibold">Oracle Prediction</h2>
      <span className="rounded-full border border-purple-400/40 bg-purple-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-purple-200">
        Cosmetic reward · no cash
      </span>
    </div>
  )

  if (!user) {
    return (
      <div className="rounded-xl border border-purple-400/30 bg-purple-500/5 p-6">
        {header}
        <p className="text-sm text-gray-400 mt-2">
          <Link to="/login" className="text-accent hover:underline">Log in</Link> to call the winner.
          Correct calls earn cosmetic gear and Oracle badges — never cash.
        </p>
      </div>
    )
  }

  const decided = Boolean(winnerResult)
  const quota = predictionQuota(tier)
  const open = stats?.openCount ?? 0
  const atCap = !canPredict(open, tier)
  const badgeId = stats ? oracleBadgeForCorrect(stats.correctCount) : null
  const badge = badgeId ? BADGES[badgeId] : null

  return (
    <div className="rounded-xl border border-purple-400/30 bg-purple-500/5 p-6">
      {header}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400 mb-4">
        <span>
          Predictions used:{' '}
          <span className="text-gray-200 font-semibold">
            {open}/{quota === Infinity ? '∞' : quota}
          </span>
        </span>
        {stats && (
          <>
            <span>Streak: <span className="text-gray-200 font-semibold">{stats.streak}</span></span>
            <span>
              Accuracy:{' '}
              <span className="text-gray-200 font-semibold">
                {Math.round(stats.accuracy * 100)}%
              </span>
            </span>
          </>
        )}
        {badge && <BadgeChip badge={badge} />}
        <Link to="/oracle" className="text-accent hover:underline ml-auto">Oracle hub →</Link>
      </div>

      {/* Locked outcome once the tournament has a recorded winner. */}
      {decided ? (
        myPrediction && myPrediction.status !== 'open' ? (
          <div
            className={`rounded-lg border p-4 ${
              myPrediction.status === 'correct'
                ? 'border-leaf/40 bg-leaf/5'
                : 'border-kunai/40 bg-kunai/5'
            }`}
          >
            <p className="text-sm">
              You called <strong>{myPrediction.pick.label}</strong> —{' '}
              {myPrediction.status === 'correct' ? (
                <span className="text-leaf font-semibold">correct! 🎉 A reward landed in your locker.</span>
              ) : (
                <span className="text-kunai font-semibold">not this time.</span>
              )}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Winner on record: {winnerResult?.winner_username ?? 'recorded'}.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-dark-border bg-dark p-4 text-sm text-gray-400">
            This tournament is decided — predictions are closed.
            {!myPrediction && ' You didn’t make a call on this one.'}
          </div>
        )
      ) : myPrediction && myPrediction.status === 'open' ? (
        // Existing open prediction — show it with a cancel option.
        <div className="rounded-lg border border-purple-400/40 bg-purple-500/10 p-4">
          <p className="text-sm">
            Your call: <strong>{myPrediction.pick.label}</strong>
            <span className="text-xs text-gray-400 ml-2">(locks when a winner is recorded)</span>
          </p>
          <button
            type="button"
            onClick={handleCancel}
            className="mt-3 text-xs text-gray-400 hover:text-kunai"
          >
            Cancel prediction
          </button>
        </div>
      ) : atCap ? (
        // At their tier cap and no prediction here yet — nudge to upgrade.
        <div className="rounded-lg border border-chakra/40 bg-chakra/10 p-4">
          <p className="text-sm text-chakra">{predictionUpgradeNudge(tier)}</p>
          {!IS_MOBILE_STORE_BUILD && (
            <Link to="/upgrade" className="mt-2 inline-block text-xs text-accent hover:underline">
              See tiers →
            </Link>
          )}
        </div>
      ) : (
        // Make a new prediction.
        <div className="space-y-3">
          <p className="text-sm text-gray-400">Who takes it? Correct calls earn cosmetic rewards + Oracle badges.</p>
          {options.length > 0 ? (
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
            >
              <option value="">Select an entrant…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="Name the team / player you think wins"
              className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
            />
          )}
          {error && <p className="text-kunai text-sm">{error}</p>}
          <button
            type="button"
            onClick={submit}
            className="px-4 py-2 rounded-lg bg-purple-500 text-white text-sm font-semibold hover:bg-purple-500/90"
          >
            Lock in prediction
          </button>
        </div>
      )}
    </div>
  )
}
