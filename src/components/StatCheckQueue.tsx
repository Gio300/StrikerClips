import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { invalidateInviteContext } from '@/hooks/useInviteContext'
import type { StatCheckSubmission, StatCheckCreatorDecision } from '@/types/database'

/**
 * StatCheckQueue — central role-based queue for tournament stat checks.
 *
 * Three views under one roof:
 *   1. "My submissions"     — what the current user has submitted (any role).
 *   2. "Reviews on me"      — pending submissions where I'm the invited admin
 *                             OR a registered admin of the tournament.
 *   3. "Reports to act on"  — submissions in tournaments I created that
 *                             have been reviewed by an admin and need my
 *                             follow-up decision (allow / disqualify / no_action).
 *
 * Admins can leave `review_notes`. Tournament creators can leave
 * `creator_notes` + a `creator_decision`. The DB row carries the entire
 * audit trail.
 */

type EnrichedSubmission = StatCheckSubmission & {
  submitter_name?: string
  reviewer_name?: string
  invited_admin_name?: string
  tournament_name?: string
  tournament_owner_id?: string
}

type Tab = 'mine' | 'review' | 'reports'

export function StatCheckQueue() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('mine')
  const [rows, setRows] = useState<EnrichedSubmission[]>([])
  const [adminTourneyIds, setAdminTourneyIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const isPendingForMe = (r: EnrichedSubmission, uid: string): boolean => {
    if (r.status !== 'pending' || r.user_id === uid) return false
    if (r.invited_admin_id === uid) return true
    if (r.tournament_id && adminTourneyIds.has(r.tournament_id)) return true
    if (r.tournament_owner_id === uid) return true
    return false
  }

  // Counts per tab so the user can see at a glance where the work is.
  const counts = useMemo(() => {
    if (!user) return { mine: 0, review: 0, reports: 0 }
    return {
      mine: rows.filter((r) => r.user_id === user.id).length,
      review: rows.filter((r) => isPendingForMe(r, user.id)).length,
      reports: rows.filter(
        (r) =>
          r.tournament_owner_id === user.id &&
          (r.status === 'approved' || r.status === 'rejected') &&
          !r.creator_decision,
      ).length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, user, adminTourneyIds])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        // Pull a generous window: my submissions, anything assigned to me,
        // and submissions in tournaments I created. The RLS policies allow
        // each of these reads.
        const [mine, asAdmin, asOwnerSubs] = await Promise.all([
          supabase
            .from('stat_check_submissions')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('stat_check_submissions')
            .select('*')
            .eq('invited_admin_id', user.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('tournaments')
            .select('id, name, created_by')
            .eq('created_by', user.id),
        ])

        const myAdminTourneyIds = await fetchMyAdminTournaments(user.id)
        if (!cancelled) setAdminTourneyIds(new Set(myAdminTourneyIds))
        const adminTourneySubs = myAdminTourneyIds.length > 0
          ? await supabase
              .from('stat_check_submissions')
              .select('*')
              .in('tournament_id', myAdminTourneyIds)
              .order('created_at', { ascending: false })
          : { data: [] as StatCheckSubmission[], error: null }

        const ownerTourneyIds = (asOwnerSubs.data ?? []).map((t) => t.id)
        const ownerTourneySubs = ownerTourneyIds.length > 0
          ? await supabase
              .from('stat_check_submissions')
              .select('*')
              .in('tournament_id', ownerTourneyIds)
              .order('created_at', { ascending: false })
          : { data: [] as StatCheckSubmission[], error: null }

        // Merge & dedupe by id.
        const all = new Map<string, StatCheckSubmission>()
        for (const r of (mine.data ?? []) as StatCheckSubmission[]) all.set(r.id, r)
        for (const r of (asAdmin.data ?? []) as StatCheckSubmission[]) all.set(r.id, r)
        for (const r of (adminTourneySubs.data ?? []) as StatCheckSubmission[]) all.set(r.id, r)
        for (const r of (ownerTourneySubs.data ?? []) as StatCheckSubmission[]) all.set(r.id, r)

        const flat = Array.from(all.values())

        // Enrich with usernames + tournament owner ids in one shot.
        const userIds = new Set<string>()
        const tournamentIds = new Set<string>()
        for (const r of flat) {
          if (r.user_id) userIds.add(r.user_id)
          if (r.invited_admin_id) userIds.add(r.invited_admin_id)
          if (r.reviewed_by) userIds.add(r.reviewed_by)
          if (r.tournament_id) tournamentIds.add(r.tournament_id)
        }
        const [profiles, tournaments] = await Promise.all([
          userIds.size > 0
            ? supabase.from('profiles').select('id, username').in('id', Array.from(userIds))
            : Promise.resolve({ data: [] as { id: string; username: string }[], error: null }),
          tournamentIds.size > 0
            ? supabase
                .from('tournaments')
                .select('id, name, created_by')
                .in('id', Array.from(tournamentIds))
            : Promise.resolve({
                data: [] as { id: string; name: string; created_by: string | null }[],
                error: null,
              }),
        ])
        const nameMap = new Map((profiles.data ?? []).map((p) => [p.id, p.username]))
        const tourneyMap = new Map((tournaments.data ?? []).map((t) => [t.id, t]))

        const enriched: EnrichedSubmission[] = flat.map((r) => ({
          ...r,
          submitter_name: nameMap.get(r.user_id),
          reviewer_name: r.reviewed_by ? nameMap.get(r.reviewed_by) : undefined,
          invited_admin_name: r.invited_admin_id ? nameMap.get(r.invited_admin_id) : undefined,
          tournament_name: r.tournament_id ? tourneyMap.get(r.tournament_id)?.name : undefined,
          tournament_owner_id: r.tournament_id
            ? tourneyMap.get(r.tournament_id)?.created_by ?? undefined
            : undefined,
        }))

        if (cancelled) return
        setRows(enriched)
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [user])

  if (!user) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark-card p-6 text-center">
        <p className="text-gray-400 mb-3">Log in to access the stat check queue.</p>
        <Link to="/login" className="text-accent hover:underline">Log in →</Link>
      </div>
    )
  }

  if (loading) {
    return <div className="text-gray-400">Loading queue…</div>
  }

  if (error) {
    return (
      <div className="rounded-lg border border-kunai/40 bg-kunai/5 p-4 text-sm text-kunai">
        {error}
      </div>
    )
  }

  const visibleRows = rows.filter((r) => {
    if (tab === 'mine') return r.user_id === user.id
    if (tab === 'review') return isPendingForMe(r, user.id)
    return r.tournament_owner_id === user.id
  })

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-1 border-b border-dark-border">
        <TabButton active={tab === 'mine'} onClick={() => setTab('mine')} count={counts.mine}>
          My submissions
        </TabButton>
        <TabButton active={tab === 'review'} onClick={() => setTab('review')} count={counts.review}>
          Pending my review
        </TabButton>
        <TabButton
          active={tab === 'reports'}
          onClick={() => setTab('reports')}
          count={counts.reports}
        >
          Creator reports
        </TabButton>
      </div>

      {visibleRows.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="space-y-3">
          {visibleRows.map((r) => (
            <SubmissionRow
              key={r.id}
              row={r}
              currentUserId={user.id}
              tab={tab}
              onChange={(updated) =>
                setRows((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
//  Helpers + sub-components
// ─────────────────────────────────────────────────────────────────────

async function fetchMyAdminTournaments(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('tournament_admins')
    .select('tournament_id')
    .eq('user_id', userId)
  return (data ?? []).map((r) => r.tournament_id)
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-sm rounded-t-lg inline-flex items-center gap-2 transition-colors ${
        active
          ? 'bg-accent/10 text-accent border-b-2 border-accent'
          : 'text-gray-400 hover:text-white border-b-2 border-transparent'
      }`}
    >
      {children}
      {count > 0 && (
        <span
          className={`text-[11px] rounded-full px-1.5 py-0.5 ${
            active ? 'bg-accent/20' : 'bg-dark-elevated text-gray-300'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function EmptyState({ tab }: { tab: Tab }) {
  const copy =
    tab === 'mine'
      ? 'No submissions yet. Submit a video for review on a tournament page or via the button above.'
      : tab === 'review'
        ? 'No reviews waiting on you right now. When a player invites you (or a tournament you admin gets a submission), it lands here.'
        : "No reports waiting for a creator decision. Once an admin approves or rejects a stat check on a tournament you created, it shows up here."
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center text-gray-400">
      {copy}
    </div>
  )
}

function SubmissionRow({
  row,
  currentUserId,
  tab,
  onChange,
}: {
  row: EnrichedSubmission
  currentUserId: string
  tab: Tab
  onChange: (patch: Partial<EnrichedSubmission> & { id: string }) => void
}) {
  const [reviewNotes, setReviewNotes] = useState(row.review_notes ?? '')
  const [creatorNotes, setCreatorNotes] = useState(row.creator_notes ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const ytId = extractYouTubeId(row.video_url)

  async function review(status: 'approved' | 'rejected') {
    setBusy(true)
    setErr('')
    const { error } = await supabase
      .from('stat_check_submissions')
      .update({
        status,
        reviewed_by: currentUserId,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes.trim() || null,
      })
      .eq('id', row.id)
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    onChange({
      id: row.id,
      status,
      reviewed_by: currentUserId,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes.trim() || null,
    })
  }

  async function decide(decision: StatCheckCreatorDecision) {
    setBusy(true)
    setErr('')
    const { error } = await supabase
      .from('stat_check_submissions')
      .update({
        creator_decision: decision,
        creator_notes: creatorNotes.trim() || null,
        creator_decided_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    onChange({
      id: row.id,
      creator_decision: decision,
      creator_notes: creatorNotes.trim() || null,
      creator_decided_at: new Date().toISOString(),
    })
    invalidateInviteContext()
  }

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-dark-border bg-dark-elevated/40">
        <Link
          to={`/profile/${row.user_id}`}
          className="font-medium text-accent hover:underline"
        >
          {row.submitter_name ?? 'Player'}
        </Link>
        {row.tournament_name && row.tournament_id && (
          <Link
            to={`/tournaments/${row.tournament_id}`}
            className="text-xs text-gray-400 hover:text-accent"
          >
            · {row.tournament_name}
          </Link>
        )}
        <StatusBadge row={row} />
        {row.invited_admin_name && (
          <span className="text-[11px] text-gray-500">
            → invited {row.invited_admin_name}
          </span>
        )}
        <span className="ml-auto text-[11px] text-gray-500">
          {new Date(row.created_at).toLocaleString()}
        </span>
      </div>

      {/* Body */}
      <div className="p-4 grid md:grid-cols-2 gap-4">
        {/* Left: video + meta */}
        <div className="space-y-2">
          {ytId ? (
            <div className="aspect-video rounded overflow-hidden bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${ytId}?modestbranding=1&rel=0`}
                title="Submission"
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <a
              href={row.video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-accent hover:underline truncate"
            >
              {row.video_url}
            </a>
          )}
          {row.character_name && (
            <p className="text-xs text-gray-400">Character: {row.character_name}</p>
          )}
          {row.description && (
            <p className="text-xs text-gray-300 whitespace-pre-wrap">{row.description}</p>
          )}
          {row.review_notes && (
            <div className="rounded border border-dark-border bg-dark p-2 text-xs">
              <span className="text-gray-500">Admin notes</span>
              {row.reviewer_name && (
                <span className="text-gray-500"> — {row.reviewer_name}</span>
              )}
              <p className="text-gray-200 whitespace-pre-wrap mt-0.5">{row.review_notes}</p>
            </div>
          )}
          {row.creator_decision && (
            <div className="rounded border border-accent/30 bg-accent/5 p-2 text-xs">
              <span className="text-accent font-semibold uppercase tracking-wider">
                Creator decision: {labelFor(row.creator_decision)}
              </span>
              {row.creator_notes && (
                <p className="text-gray-200 whitespace-pre-wrap mt-1">{row.creator_notes}</p>
              )}
            </div>
          )}
        </div>

        {/* Right: actions per role */}
        <div className="space-y-3">
          {tab === 'review' && row.status === 'pending' && (
            <>
              <label className="block">
                <span className="text-xs text-gray-400">Review notes (optional)</span>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={3}
                  placeholder="What did you observe? Any flags? These notes go to the tournament creator."
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm resize-none"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => review('approved')}
                  className="flex-1 px-3 py-2 rounded text-sm font-semibold bg-leaf/20 border border-leaf/40 text-leaf hover:bg-leaf/30 disabled:opacity-40"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => review('rejected')}
                  className="flex-1 px-3 py-2 rounded text-sm font-semibold bg-kunai/20 border border-kunai/40 text-kunai hover:bg-kunai/30 disabled:opacity-40"
                >
                  Reject
                </button>
              </div>
            </>
          )}

          {tab === 'reports' && (row.status === 'approved' || row.status === 'rejected') && !row.creator_decision && (
            <>
              <p className="text-xs text-gray-400">
                {row.reviewer_name ?? 'An admin'} {row.status} this submission
                {row.reviewed_at ? ` on ${new Date(row.reviewed_at).toLocaleString()}` : ''}.
                Record your decision so the player and admins can see it.
              </p>
              <label className="block">
                <span className="text-xs text-gray-400">Creator notes (optional)</span>
                <textarea
                  value={creatorNotes}
                  onChange={(e) => setCreatorNotes(e.target.value)}
                  rows={3}
                  placeholder="Why this decision? Anything the player or admin should know."
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm resize-none"
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide('allow')}
                  className="px-2 py-2 rounded text-xs font-semibold bg-leaf/20 border border-leaf/40 text-leaf hover:bg-leaf/30 disabled:opacity-40"
                >
                  Allow
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide('disqualify')}
                  className="px-2 py-2 rounded text-xs font-semibold bg-kunai/20 border border-kunai/40 text-kunai hover:bg-kunai/30 disabled:opacity-40"
                >
                  Disqualify
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide('no_action')}
                  className="px-2 py-2 rounded text-xs font-semibold border border-dark-border text-gray-300 hover:border-accent/40 disabled:opacity-40"
                >
                  No action
                </button>
              </div>
            </>
          )}

          {tab === 'mine' && (
            <div className="text-xs text-gray-400 space-y-1">
              <p>Status: <span className="text-gray-200">{row.status}</span></p>
              {row.invited_admin_name && (
                <p>Reviewer invited: <span className="text-gray-200">{row.invited_admin_name}</span></p>
              )}
              {row.reviewer_name && (
                <p>Reviewed by: <span className="text-gray-200">{row.reviewer_name}</span></p>
              )}
              {row.creator_decision && (
                <p>
                  Tournament creator decision:{' '}
                  <span className="text-gray-200">{labelFor(row.creator_decision)}</span>
                </p>
              )}
            </div>
          )}

          {err && <p className="text-xs text-kunai">{err}</p>}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ row }: { row: EnrichedSubmission }) {
  const s = row.status
  const map = {
    pending: { cls: 'bg-chakra/15 border-chakra/40 text-chakra', text: 'pending' },
    approved: { cls: 'bg-leaf/15 border-leaf/40 text-leaf', text: 'approved' },
    rejected: { cls: 'bg-kunai/15 border-kunai/40 text-kunai', text: 'rejected' },
  } as const
  const m = map[s] ?? map.pending
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${m.cls}`}>{m.text}</span>
  )
}

function labelFor(d: StatCheckCreatorDecision): string {
  return d === 'allow' ? 'Allow' : d === 'disqualify' ? 'Disqualify' : 'No action'
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)
  return m ? m[1] : null
}
