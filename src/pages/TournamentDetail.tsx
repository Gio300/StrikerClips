import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { InviteMenu } from '@/components/InviteMenu'
import { invalidateInviteContext } from '@/hooks/useInviteContext'
import { notify, notifyMany } from '@/lib/notifications'
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
type EntrantRow = TournamentEntrant & { username?: string; team_server_name?: string }
type SubmissionRow = StatCheckSubmission & { submitter_username?: string }

// ─────────────────────────────────────────────────────────────────────────
// Top-level page
// ─────────────────────────────────────────────────────────────────────────

type Section = 'overview' | 'entrants' | 'stat-check' | 'admins' | 'results'

export function TournamentDetail() {
  const { id } = useParams()
  const { user } = useAuth()

  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [results, setResults] = useState<TournamentResult[]>([])
  const [admins, setAdmins] = useState<AdminRow[]>([])
  const [entrants, setEntrants] = useState<EntrantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState<Section>('overview')

  const isOwner = Boolean(user?.id && tournament?.created_by === user.id)
  const myAdmin = useMemo(() => admins.find((a) => a.user_id === user?.id), [admins, user])
  const isAdmin = Boolean(isOwner || myAdmin)
  const canApproveStatCheck = isOwner || Boolean(myAdmin?.can_approve_stat_check)
  const myEntrant = useMemo(() => entrants.find((e) => e.user_id === user?.id), [entrants, user])
  const isAcceptedEntrant = myEntrant?.status === 'accepted'

  useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      const { data: t } = await supabase.from('tournaments').select('*').eq('id', id).single()
      if (cancelled) return
      setTournament((t ?? null) as Tournament | null)
      if (!t) {
        setLoading(false)
        return
      }
      const [subRes, resRes, admRes, entRes] = await Promise.all([
        supabase
          .from('stat_check_submissions')
          .select('*')
          .eq('tournament_id', id)
          .order('created_at', { ascending: false }),
        supabase
          .from('tournament_results')
          .select('*')
          .eq('tournament_id', id)
          .order('created_at', { ascending: false }),
        supabase.from('tournament_admins').select('*').eq('tournament_id', id),
        supabase
          .from('tournament_entrants')
          .select('*')
          .eq('tournament_id', id)
          .order('created_at', { ascending: true }),
      ])
      if (cancelled) return

      const subRows = (subRes.data ?? []) as SubmissionRow[]
      const resRows = (resRes.data ?? []) as TournamentResult[]
      const admRows = (admRes.data ?? []) as AdminRow[]
      const entRows = (entRes.data ?? []) as EntrantRow[]

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
          ? supabase.from('profiles').select('id, username').in('id', Array.from(userIds))
          : Promise.resolve({ data: [] as { id: string; username: string }[], error: null }),
        serverIds.size > 0
          ? supabase.from('servers').select('id, name').in('id', Array.from(serverIds))
          : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
      ])
      const nameMap = new Map((profiles.data ?? []).map((p) => [p.id, p.username]))
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
          team_server_name: e.team_server_id ? serverMap.get(e.team_server_id) : undefined,
        })),
      )
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading || !tournament) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
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

  const sections: Section[] = ['overview', 'entrants', 'stat-check', 'admins', 'results']

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link
        to="/tournaments"
        className="text-accent hover:underline text-sm mb-4 inline-block"
      >
        ← Back to tournaments
      </Link>

      <div className="flex flex-wrap items-center gap-3 mb-1">
        <h1 className="text-2xl font-bold">{tournament.name}</h1>
        <StatusPill status={(tournament.status ?? 'draft') as TournamentStatus} />
      </div>
      {tournament.description && (
        <p className="text-gray-400 mb-4">{tournament.description}</p>
      )}

      <div className="flex flex-wrap gap-1 border-b border-dark-border mb-6">
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

      {section === 'overview' && (
        <OverviewSection
          tournament={tournament}
          entrants={entrants}
          isOwner={isOwner}
          isAcceptedEntrant={isAcceptedEntrant}
          myEntrant={myEntrant}
          user={user}
          onEntered={(newEntrants, sub) => {
            setEntrants((prev) => [...prev, ...newEntrants])
            if (sub) {
              setSubmissions((prev) => [
                { ...sub, submitter_username: user?.email?.split('@')[0] },
                ...prev,
              ])
            }
            setSection('stat-check')
          }}
        />
      )}

      {section === 'entrants' && (
        <EntrantsSection
          entrants={entrants}
          setEntrants={setEntrants}
          tournamentId={tournament.id}
          isOwner={isOwner}
          user={user}
        />
      )}

      {section === 'stat-check' && (
        <StatCheckSection
          tournamentId={tournament.id}
          tournamentName={tournament.name}
          submissions={submissions}
          setSubmissions={setSubmissions}
          user={user}
          isOwner={isOwner}
          canApproveStatCheck={canApproveStatCheck}
          isAcceptedEntrant={isAcceptedEntrant}
          admins={admins}
          tournamentRules={tournament.rules}
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
    </div>
  )
}

function labelFor(s: Section): string {
  switch (s) {
    case 'overview':
      return 'Overview'
    case 'entrants':
      return 'Entrants'
    case 'stat-check':
      return 'Stat Check'
    case 'admins':
      return 'Admins'
    case 'results':
      return 'Results'
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
// Overview — rules, schedule, host, entrant count, "Enter tournament" CTA
// ─────────────────────────────────────────────────────────────────────────

function OverviewSection({
  tournament,
  entrants,
  isOwner,
  isAcceptedEntrant,
  myEntrant,
  user,
  onEntered,
}: {
  tournament: Tournament
  entrants: EntrantRow[]
  isOwner: boolean
  isAcceptedEntrant: boolean
  myEntrant: EntrantRow | undefined
  user: { id: string } | null
  onEntered: (newEntrants: EntrantRow[], sub: SubmissionRow | null) => void
}) {
  const [enterOpen, setEnterOpen] = useState(false)
  const acceptedCount = entrants.filter((e) => e.status === 'accepted').length

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-dark-border bg-dark-card p-6 grid sm:grid-cols-2 gap-6">
        <div>
          <h2 className="font-semibold mb-2">Schedule</h2>
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
            {tournament.prize_pool && <Row label="Prize">{tournament.prize_pool}</Row>}
          </dl>
        </div>
        <div>
          <h2 className="font-semibold mb-2">Entrants</h2>
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

      <div className="rounded-xl border border-dark-border bg-dark-card p-6">
        <h2 className="font-semibold mb-2">Rules</h2>
        {tournament.rules ? (
          <pre className="whitespace-pre-wrap text-gray-300 text-sm font-mono">{tournament.rules}</pre>
        ) : (
          <p className="text-gray-500 text-sm">
            {isOwner
              ? "You haven't published rules yet. Edit the tournament to add them."
              : 'No rules specified.'}
          </p>
        )}
      </div>

      {/* Enter tournament CTA */}
      {user && !isAcceptedEntrant && tournament.status !== 'closed' && (
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-6 text-center">
          <h3 className="font-semibold text-lg mb-1">Ready to compete?</h3>
          <p className="text-sm text-gray-400 mb-4">
            Enter solo or with a team. You'll agree to the rules and submit a stat check video for
            an admin to verify.
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
        <div className="rounded-xl border border-dark-border bg-dark-card p-6 text-center">
          <Link to="/login" className="text-accent hover:underline">Log in</Link>
          <span className="text-gray-400"> to enter this tournament.</span>
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
  const [teamServerId, setTeamServerId] = useState<string>(existingEntrant?.team_server_id ?? '')
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
      if (serverIds.length > 0) {
        const { data: servers } = await supabase
          .from('servers')
          .select('id, name')
          .in('id', serverIds)
        setMyServers((servers ?? []) as { id: string; name: string }[])
      }
    }
    load()
  }, [tournament.id, user.id])

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
    const team_server_id = teamMode === 'team' ? teamServerId || null : null

    // Step 1 — own entrant row (upsert if invited, otherwise insert)
    let entrantRow: EntrantRow
    if (existingEntrant) {
      const { data, error: err } = await supabase
        .from('tournament_entrants')
        .update({
          status: 'accepted',
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
          status: 'accepted',
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
      // Fan out to all admins who can approve.
      const eligibleAdmins = admins.map((a) => a.user_id).filter((uid) => uid !== user.id)
      notifyMany(eligibleAdmins, {
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
        title: 'New entrant in your tournament',
        body: `Someone entered "${tournament.name}".`,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
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
                    Register under a clan / server (optional)
                  </span>
                  <select
                    value={teamServerId}
                    onChange={(e) => setTeamServerId(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-dark border border-dark-border text-white text-sm"
                  >
                    <option value="">No clan</option>
                    {myServers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {myServers.length === 0 && (
                    <span className="block text-[11px] text-gray-500 mt-1">
                      You're not in any clans.{' '}
                      <Link to="/servers/new" className="text-accent hover:underline">
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
                    Each teammate gets a notification + can accept their own entry.
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
  user,
}: {
  entrants: EntrantRow[]
  setEntrants: React.Dispatch<React.SetStateAction<EntrantRow[]>>
  tournamentId: string
  isOwner: boolean
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
  const pending = entrants.filter((e) => e.status === 'pending')

  if (entrants.length === 0) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark-card p-12 text-center text-gray-400">
        No one has entered yet. Be the first.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <EntrantsList title={`Accepted (${accepted.length})`} entrants={accepted} onWithdraw={withdraw} user={user} isOwner={isOwner} />
      {pending.length > 0 && (
        <EntrantsList
          title={`Pending invites (${pending.length})`}
          entrants={pending}
          onWithdraw={withdraw}
          user={user}
          isOwner={isOwner}
          subdued
        />
      )}
    </div>
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
                    to={`/servers/${members[0].team_server_id}`}
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
  submissions,
  setSubmissions,
  user,
  isOwner,
  canApproveStatCheck,
  isAcceptedEntrant,
  admins,
  tournamentRules: _tournamentRules,
}: {
  tournamentId: string
  tournamentName: string
  submissions: SubmissionRow[]
  setSubmissions: React.Dispatch<React.SetStateAction<SubmissionRow[]>>
  user: { id: string } | null
  isOwner: boolean
  canApproveStatCheck: boolean
  isAcceptedEntrant: boolean
  admins: AdminRow[]
  tournamentRules: string | null
}) {
  const [videoUrl, setVideoUrl] = useState('')
  const [characterName, setCharacterName] = useState('')
  const [description, setDescription] = useState('')
  const [invitedAdminId, setInvitedAdminId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !videoUrl.trim() || submitting || !isAcceptedEntrant) return
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
        const eligible = admins
          .filter((a) => a.can_approve_stat_check !== false)
          .map((a) => a.user_id)
          .filter((uid) => uid !== user.id)
        notifyMany(eligible, {
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
      {user && isAcceptedEntrant && (
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

      {user && !isAcceptedEntrant && (
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
          <div className="grid grid-cols-3 gap-2">
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
