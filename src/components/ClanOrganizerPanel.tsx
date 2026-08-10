import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Check, Mail, Plus, Trash2, UserPlus, X } from 'lucide-react'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { Avatar } from '@/components/ui'
import {
  addClanRosterMember,
  createClanRoster,
  deleteClanRoster,
  fetchClanOrganizerDashboard,
  inviteClanRosterMember,
  removeClanRosterMember,
  reviewClanApplication,
  type ClanApplication,
  type ClanRoster,
  type RosterMemberRole,
} from '@/lib/organizerApi'
import type { ClanRole } from '@/lib/clans'

type ClanMemberOption = {
  id: string
  user_id: string
  role: string
  username: string
  avatar_url: string | null
}

const ROLE_LABEL: Record<RosterMemberRole, string> = {
  captain: 'Captain',
  starter: 'Starter',
  substitute: 'Substitute',
  coach: 'Coach',
}

function friendlyError(error: string | null): string {
  const known: Record<string, string> = {
    applicant_insufficient_tokens: 'The applicant does not currently have enough Tokens for the agreed join fee.',
    roster_is_full: 'That roster is full.',
    player_must_join_clan_first: 'That player must be accepted into the clan first.',
    player_not_found: 'No account matched that username.',
    valid_email_required: 'Enter a valid email address.',
  }
  return known[error || ''] || (error || 'That action could not be completed.')
}

export function ClanOrganizerPanel({
  serverId,
  viewerId,
  viewerRole,
}: {
  serverId: string
  viewerId: string
  viewerRole: ClanRole
}) {
  const [applications, setApplications] = useState<ClanApplication[]>([])
  const [members, setMembers] = useState<ClanMemberOption[]>([])
  const [rosters, setRosters] = useState<ClanRoster[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [newRosterName, setNewRosterName] = useState('')
  const [newRosterSize, setNewRosterSize] = useState(4)
  const [memberChoice, setMemberChoice] = useState<Record<string, string>>({})
  const [memberRole, setMemberRole] = useState<Record<string, RosterMemberRole>>({})
  const [inviteTarget, setInviteTarget] = useState<Record<string, string>>({})

  const canManageRosters = viewerRole === 'leader' || viewerRole === 'officer'

  const load = useCallback(async () => {
    const result = await fetchClanOrganizerDashboard(serverId)
    if (!result.ok || !result.data) {
      setMessage(friendlyError(result.error))
      setLoading(false)
      return
    }
    setApplications(result.data.applications)
    setMembers(result.data.members)
    setRosters(result.data.rosters)
    setLoading(false)
  }, [serverId])

  useEffect(() => {
    void load()
  }, [load])

  const pendingApplications = useMemo(
    () => applications.filter((application) => application.status === 'pending'),
    [applications],
  )

  async function review(application: ClanApplication, decision: 'approve' | 'reject') {
    setBusy(`application:${application.id}`)
    const result = await reviewClanApplication(application.id, decision)
    setBusy(null)
    if (!result.ok) {
      setMessage(friendlyError(result.error))
      return
    }
    setMessage(decision === 'approve' ? `${application.username} is now a clan member.` : 'Application rejected.')
    await load()
  }

  async function createRoster() {
    if (!newRosterName.trim()) return
    setBusy('create-roster')
    const result = await createClanRoster(serverId, {
      name: newRosterName.trim(),
      max_members: newRosterSize,
    })
    setBusy(null)
    if (!result.ok) {
      setMessage(friendlyError(result.error))
      return
    }
    setNewRosterName('')
    setMessage('Competition roster created.')
    await load()
  }

  async function addMember(roster: ClanRoster) {
    const userId = memberChoice[roster.id]
    if (!userId) return
    setBusy(`member:${roster.id}`)
    const result = await addClanRosterMember(
      roster.id,
      userId,
      memberRole[roster.id] || 'starter',
    )
    setBusy(null)
    if (!result.ok) {
      setMessage(friendlyError(result.error))
      return
    }
    setMemberChoice((current) => ({ ...current, [roster.id]: '' }))
    await load()
  }

  async function deleteRoster(roster: ClanRoster) {
    if (!window.confirm(`Delete the ${roster.name} roster? Tournament entries already made from it will be kept.`)) return
    setBusy(`delete-roster:${roster.id}`)
    const result = await deleteClanRoster(roster.id)
    setBusy(null)
    if (!result.ok) {
      setMessage(friendlyError(result.error))
      return
    }
    setMessage(`${roster.name} roster deleted.`)
    await load()
  }

  async function removeMember(roster: ClanRoster, userId: string) {
    setBusy(`remove:${roster.id}:${userId}`)
    const result = await removeClanRosterMember(roster.id, userId)
    setBusy(null)
    if (!result.ok) setMessage(friendlyError(result.error))
    else await load()
  }

  async function sendInvite(roster: ClanRoster) {
    const target = (inviteTarget[roster.id] || '').trim()
    if (!target) return
    setBusy(`invite:${roster.id}`)
    const result = await inviteClanRosterMember(
      roster.id,
      target,
      memberRole[roster.id] || 'starter',
    )
    setBusy(null)
    if (!result.ok || !result.data) {
      setMessage(friendlyError(result.error))
      return
    }
    setInviteTarget((current) => ({ ...current, [roster.id]: '' }))
    setMessage(result.data.email_sent ? 'Roster invitation sent by email.' : 'Invitation created, but email delivery needs attention.')
    await load()
  }

  if (loading) return <p className="text-sm text-gray-500">Loading clan management...</p>

  return (
    <div className="space-y-3">
      {message && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-gray-200">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss" className="text-gray-400 hover:text-white">
            <X size={15} />
          </button>
        </div>
      )}

      <CollapsibleSection
        id={`clan-applications-${serverId}`}
        label="Applications"
        count={pendingApplications.length}
        hint="Approval required"
      >
        <div className="space-y-2">
          {pendingApplications.length === 0 && (
            <p className="text-xs text-gray-500">No applications are waiting.</p>
          )}
          {pendingApplications.map((application) => (
            <div key={application.id} className="flex items-center gap-3 border-b border-dark-border py-3 last:border-0">
              <Avatar src={application.avatar_url} name={application.username || 'Player'} seed={application.applicant_id} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{application.username || 'Player'}</p>
                <p className="text-xs text-gray-500">
                  {application.fee_tokens_snapshot > 0
                    ? `${application.fee_tokens_snapshot.toLocaleString()} TKN fee agreed`
                    : 'No join fee'}
                </p>
                {application.message && <p className="mt-1 text-xs text-gray-300">{application.message}</p>}
              </div>
              <button
                type="button"
                title="Approve application"
                aria-label={`Approve ${application.username}`}
                disabled={busy === `application:${application.id}`}
                onClick={() => void review(application, 'approve')}
                className="inline-flex min-h-10 items-center justify-center gap-1 rounded-md bg-leaf px-2 text-xs font-semibold text-dark disabled:opacity-50"
              >
                <Check size={17} /> Approve
              </button>
              <button
                type="button"
                title="Reject application"
                aria-label={`Reject ${application.username}`}
                disabled={busy === `application:${application.id}`}
                onClick={() => void review(application, 'reject')}
                className="inline-flex min-h-10 items-center justify-center gap-1 rounded-md border border-red-500/40 px-2 text-xs font-semibold text-red-400 disabled:opacity-50"
              >
                <X size={17} /> Reject
              </button>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {canManageRosters && (
        <CollapsibleSection
          id={`clan-competition-rosters-${serverId}`}
          label="Competition rosters"
          count={rosters.length}
          hint="Reusable lineups"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2 sm:grid-cols-[minmax(0,1fr)_88px_auto]">
              <input
                value={newRosterName}
                onChange={(event) => setNewRosterName(event.target.value)}
                placeholder="Roster name"
                maxLength={100}
                className="min-w-0 rounded-md border border-dark-border bg-dark px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
              <input
                type="number"
                min={1}
                max={100}
                value={newRosterSize}
                onChange={(event) => setNewRosterSize(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}
                aria-label="Maximum roster size"
                className="rounded-md border border-dark-border bg-dark px-2 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                title="Create roster"
                aria-label="Create roster"
                onClick={() => void createRoster()}
                disabled={!newRosterName.trim() || busy === 'create-roster'}
                className="col-span-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-accent px-3 text-sm font-semibold text-dark disabled:opacity-50 sm:col-span-1 sm:w-auto"
              >
                <Plus size={19} /> Create roster
              </button>
            </div>

            {rosters.length === 0 && <p className="text-xs text-gray-500">Create a reusable lineup for tournament entry.</p>}
            {rosters.map((roster) => {
              const rosterUserIds = new Set(roster.members.map((member) => member.user_id))
              const available = members.filter((member) => !rosterUserIds.has(member.user_id))
              const pendingInvites = roster.invites.filter((invite) => invite.status === 'pending')
              return (
                <div key={roster.id} className="rounded-lg border border-dark-border bg-dark-card p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{roster.name}</p>
                      <p className="text-xs text-gray-500">{roster.game} | {roster.members.length} / {roster.max_members}</p>
                    </div>
                    <button
                      type="button"
                      title="Delete roster"
                      aria-label={`Delete ${roster.name} roster`}
                      disabled={busy === `delete-roster:${roster.id}`}
                      onClick={() => void deleteRoster(roster)}
                      className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1 rounded-md border border-red-500/30 px-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      <Trash2 size={16} /> Delete
                    </button>
                  </div>

                  <div className="mt-3 space-y-1">
                    {roster.members.map((member) => (
                      <div key={member.id} className="flex h-10 items-center gap-2 border-b border-dark-border/70 last:border-0">
                        <Avatar src={member.avatar_url} name={member.username} seed={member.user_id} size={26} />
                        <span className="min-w-0 flex-1 truncate text-sm text-white">{member.username}</span>
                        <span className="text-[11px] text-gray-500">{ROLE_LABEL[member.member_role]}</span>
                        <button
                          type="button"
                          title={member.user_id === viewerId ? 'Leave roster' : 'Remove from roster'}
                          aria-label={member.user_id === viewerId
                            ? `Leave ${roster.name}`
                            : `Remove ${member.username} from ${roster.name}`}
                          disabled={busy === `remove:${roster.id}:${member.user_id}`}
                          onClick={() => void removeMember(roster, member.user_id)}
                          className="flex h-8 w-8 items-center justify-center text-gray-500 hover:text-red-400 disabled:opacity-50"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>

                  {roster.members.length < roster.max_members && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_116px_40px]">
                      <select
                        value={memberChoice[roster.id] || ''}
                        onChange={(event) => setMemberChoice((current) => ({ ...current, [roster.id]: event.target.value }))}
                        aria-label={`Clan member for ${roster.name}`}
                        className="min-w-0 rounded-md border border-dark-border bg-dark px-2 py-2 text-sm text-white focus:border-accent focus:outline-none"
                      >
                        <option value="">Add clan member</option>
                        {available.map((member) => <option key={member.user_id} value={member.user_id}>{member.username}</option>)}
                      </select>
                      <RoleSelect rosterId={roster.id} values={memberRole} onChange={setMemberRole} ariaLabel={`Role for member added to ${roster.name}`} />
                      <button
                        type="button"
                        title="Add member"
                        aria-label="Add member to roster"
                        disabled={!memberChoice[roster.id] || busy === `member:${roster.id}`}
                        onClick={() => void addMember(roster)}
                        className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-accent/40 px-3 text-sm font-semibold text-accent disabled:opacity-50 sm:h-10 sm:w-10 sm:px-0"
                      >
                        <UserPlus size={18} /> <span className="sm:sr-only">Add member</span>
                      </button>
                    </div>
                  )}

                  {roster.members.length < roster.max_members && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_116px_40px]">
                      <input
                        value={inviteTarget[roster.id] || ''}
                        onChange={(event) => setInviteTarget((current) => ({ ...current, [roster.id]: event.target.value }))}
                        placeholder="Email or username"
                        className="min-w-0 rounded-md border border-dark-border bg-dark px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                      />
                      <RoleSelect rosterId={roster.id} values={memberRole} onChange={setMemberRole} ariaLabel={`Role for player invited to ${roster.name}`} />
                      <button
                        type="button"
                        title="Send roster invitation"
                        aria-label="Send roster invitation"
                        disabled={!inviteTarget[roster.id]?.trim() || busy === `invite:${roster.id}`}
                        onClick={() => void sendInvite(roster)}
                        className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-accent px-3 text-sm font-semibold text-dark disabled:opacity-50 sm:h-10 sm:w-10 sm:px-0"
                      >
                        <Mail size={18} /> <span className="sm:sr-only">Invite player</span>
                      </button>
                    </div>
                  )}

                  {pendingInvites.length > 0 && (
                    <div className="mt-3 border-t border-dark-border pt-2">
                      <p className="mb-1 text-[11px] uppercase text-gray-500">Pending invitations</p>
                      {pendingInvites.map((invite) => (
                        <p key={invite.id} className="truncate text-xs text-gray-400">
                          {invite.email} | {ROLE_LABEL[invite.member_role]}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CollapsibleSection>
      )}
    </div>
  )
}

function RoleSelect({
  rosterId,
  values,
  onChange,
  ariaLabel,
}: {
  rosterId: string
  values: Record<string, RosterMemberRole>
  onChange: Dispatch<SetStateAction<Record<string, RosterMemberRole>>>
  ariaLabel: string
}) {
  return (
    <select
      value={values[rosterId] || 'starter'}
      onChange={(event) => onChange((current) => ({ ...current, [rosterId]: event.target.value as RosterMemberRole }))}
      aria-label={ariaLabel}
      className="rounded-md border border-dark-border bg-dark px-2 py-2 text-sm text-white focus:border-accent focus:outline-none"
    >
      {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  )
}

export default ClanOrganizerPanel
