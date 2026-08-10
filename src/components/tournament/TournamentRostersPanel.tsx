import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  CreditCard,
  Gem,
  Loader2,
  LockKeyhole,
  PackagePlus,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  UserRoundPlus,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { CREATOR_PRICE_CENTS, formatUsd } from '@/lib/creatorCommerce'
import { startCreatorCashCheckout } from '@/lib/creatorCommerceApi'
import { DIGITAL_CHECKOUT_ENABLED } from '@/lib/storeBuild'
import {
  addTournamentRosterMember,
  attachTournamentRosterArtifact,
  createTournamentPack,
  createTournamentRoster,
  fetchMyManagedClanRosters,
  fetchTournamentRosterBoard,
  grantTournamentPack,
  inviteTournamentClan,
  removeTournamentRosterMember,
  removeTournamentRosterArtifact,
  removeTournamentClanInvitation,
  reviewTournamentRoster,
  setTournamentClanEntryMode,
  submitTournamentRoster,
  syncTournamentRoster,
  withdrawTournamentRoster,
  type ManagedClanRoster,
  type OwnedTournamentArtifact,
  type RosterMemberRole,
  type TournamentPerkPack,
  type TournamentRoster,
  type TournamentClanInvitation,
  type TournamentClanOption,
} from '@/lib/organizerApi'

type Entrant = {
  user_id: string
  username?: string
  avatar_url?: string | null
  status?: string
}

type Board = {
  tournament: Record<string, unknown>
  is_host: boolean
  clan_entry_mode: 'open' | 'invited_only'
  clan_invitations: TournamentClanInvitation[]
  clan_options: TournamentClanOption[]
  rosters: TournamentRoster[]
  packs: TournamentPerkPack[]
  owned_artifacts: OwnedTournamentArtifact[]
}

const ROLE_LABEL: Record<RosterMemberRole, string> = {
  captain: 'Captain',
  starter: 'Starter',
  substitute: 'Substitute',
  coach: 'Coach',
}

function parseBenefits(pack: TournamentPerkPack): { roster_changes: number; unlimited_roster_changes: boolean; artifact_slots: number } {
  const raw = typeof pack.benefits === 'string'
    ? (() => { try { return JSON.parse(pack.benefits) } catch { return {} } })()
    : pack.benefits
  return {
    roster_changes: Math.max(0, Number(raw?.roster_changes) || 0),
    unlimited_roster_changes: raw?.unlimited_roster_changes === true,
    artifact_slots: Math.max(0, Number(raw?.artifact_slots) || 0),
  }
}

function friendlyError(error: string | null): string {
  const messages: Record<string, string> = {
    roster_locked_perk_required: 'This lineup is locked. Use a tournament roster-change perk or ask the organizer.',
    host_override_reason_required: 'Enter an audit reason before overriding a locked roster.',
    change_request_reason_required: 'Explain the changes this team needs to make.',
    tournament_host_required: 'Only a tournament organizer can do that.',
    tournament_host_or_clan_manager_required: 'Only the organizer or a clan leader can enter this lineup.',
    tournament_clan_invitation_required: 'This tournament only accepts rosters from clans the organizer invited.',
    valid_clan_entry_mode_required: 'Choose whether every clan or invited clans may enter rosters.',
    clan_invitation_not_found: 'That clan invitation is no longer available.',
    roster_manager_required: 'You do not manage this roster.',
    roster_needs_players: 'Add at least one player before submitting this roster.',
    no_source_clan_roster: 'This lineup is not linked to a reusable clan roster.',
    seller_membership_required: 'Selling tournament packs starts with a Pro seller membership.',
    invalid_price_tier: 'Choose one of the supported pack prices.',
    closed_tournament_rosters_cannot_change: 'Rosters cannot change after the tournament closes.',
    tournament_artifact_perk_required: 'This roster needs an available tournament-artifact perk before attaching an artifact.',
    tournament_artifact_must_be_owned: 'You can only attach an artifact that you own.',
    tournament_artifact_already_attached: 'That artifact is already attached to this roster.',
    locked_tournament_artifact_removal_requires_host: 'Only the organizer can remove an artifact after the roster locks.',
    locked_roster_withdrawal_requires_host: 'This lineup has already locked. Ask the tournament organizer to remove it.',
    roster_already_withdrawn: 'This lineup has already been withdrawn.',
  }
  return messages[error || ''] || (error || 'That action could not be completed.')
}

export function TournamentRostersPanel({
  tournamentId,
  signedIn,
  entrants,
  initialView = 'rosters',
}: {
  tournamentId: string
  signedIn: boolean
  entrants: Entrant[]
  initialView?: 'rosters' | 'perks'
}) {
  const { user } = useAuth()
  const [view, setView] = useState<'rosters' | 'perks'>(
    () => DIGITAL_CHECKOUT_ENABLED ? initialView : 'rosters',
  )
  const [board, setBoard] = useState<Board | null>(null)
  const [clanRosters, setClanRosters] = useState<ManagedClanRoster[]>([])
  const [loading, setLoading] = useState(signedIn)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sourceRosterId, setSourceRosterId] = useState('')
  const [inviteClanId, setInviteClanId] = useState('')
  const [inviteRosterId, setInviteRosterId] = useState('')
  const [customName, setCustomName] = useState('')
  const [selectedEntrants, setSelectedEntrants] = useState<string[]>([])
  const [reason, setReason] = useState<Record<string, string>>({})
  const [addPlayer, setAddPlayer] = useState<Record<string, string>>({})
  const [addRole, setAddRole] = useState<Record<string, RosterMemberRole>>({})
  const [grantPack, setGrantPack] = useState<Record<string, string>>({})
  const [artifactChoice, setArtifactChoice] = useState<Record<string, string>>({})
  const [packName, setPackName] = useState('')
  const [packDescription, setPackDescription] = useState('')
  const [packPrice, setPackPrice] = useState<number>(CREATOR_PRICE_CENTS[2])
  const [packChanges, setPackChanges] = useState(1)
  const [packUnlimitedChanges, setPackUnlimitedChanges] = useState(false)
  const [packArtifactSlots, setPackArtifactSlots] = useState(0)
  const [qualifyingAssetId, setQualifyingAssetId] = useState('')

  const load = useCallback(async () => {
    if (!signedIn) return
    setLoading(true)
    const [boardResult, clanResult] = await Promise.all([
      fetchTournamentRosterBoard(tournamentId),
      fetchMyManagedClanRosters(),
    ])
    if (!boardResult.ok || !boardResult.data) {
      setNotice(friendlyError(boardResult.error))
      setLoading(false)
      return
    }
    setBoard(boardResult.data)
    setClanRosters(clanResult.ok && clanResult.data ? clanResult.data.rosters : [])
    setLoading(false)
  }, [signedIn, tournamentId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    setView(DIGITAL_CHECKOUT_ENABLED ? initialView : 'rosters')
  }, [initialView])

  const entrantOptions = useMemo(
    () => entrants.filter((entrant) => entrant.status !== 'withdrawn' && entrant.status !== 'rejected'),
    [entrants],
  )
  const selectedInviteClan = useMemo(
    () => board?.clan_options.find((clan) => clan.id === inviteClanId) ?? null,
    [board?.clan_options, inviteClanId],
  )
  const tournamentClanRosters = useMemo(() => {
    if (!board || board.is_host || board.clan_entry_mode === 'open') return clanRosters
    const invitedClanIds = new Set(
      board.clan_invitations
        .filter((invitation) => invitation.status === 'invited' || invitation.status === 'accepted')
        .map((invitation) => invitation.clan_id),
    )
    return clanRosters.filter((roster) => invitedClanIds.has(roster.server_id))
  }, [board, clanRosters])

  async function run(key: string, action: () => Promise<{ ok: boolean; error: string | null }>, success: string) {
    setBusy(key)
    setNotice(null)
    const result = await action()
    setBusy(null)
    if (!result.ok) {
      setNotice(friendlyError(result.error))
      return
    }
    setNotice(success)
    await load()
  }

  async function enterClanRoster() {
    const source = tournamentClanRosters.find((roster) => roster.id === sourceRosterId)
    if (!source) return
    await run(
      'enter-clan',
      () => createTournamentRoster(tournamentId, { source_clan_roster_id: source.id }),
      `${source.name} was added as a tournament roster.`,
    )
    setSourceRosterId('')
  }

  async function changeClanEntryMode(mode: 'open' | 'invited_only') {
    await run(
      'clan-entry-mode',
      () => setTournamentClanEntryMode(tournamentId, mode),
      mode === 'open'
        ? 'Every clan may now enter a saved roster.'
        : 'Only clans invited by the organizer may enter a roster.',
    )
  }

  async function inviteClan(addSelectedRoster: boolean) {
    const clan = selectedInviteClan
    const roster = clan?.rosters.find((option) => option.id === inviteRosterId) ?? null
    if (!clan || (addSelectedRoster && !roster)) return
    setBusy(addSelectedRoster ? 'invite-add-clan' : 'invite-clan')
    setNotice(null)
    const invited = await inviteTournamentClan(tournamentId, clan.id, roster?.id)
    if (!invited.ok) {
      setBusy(null)
      setNotice(friendlyError(invited.error))
      return
    }
    if (addSelectedRoster && roster) {
      const added = await createTournamentRoster(tournamentId, {
        source_clan_roster_id: roster.id,
        name: `${clan.name} — ${roster.name}`,
      })
      if (!added.ok) {
        setBusy(null)
        setNotice(`${clan.name} was invited, but the roster could not be added: ${friendlyError(added.error)}`)
        await load()
        return
      }
    }
    setBusy(null)
    setNotice(addSelectedRoster && roster
      ? `${clan.name} was invited and ${roster.name} was added to the tournament.`
      : `${clan.name} was invited to choose a tournament roster.`)
    setInviteClanId('')
    setInviteRosterId('')
    await load()
  }

  async function removeClanInvitation(invitation: TournamentClanInvitation) {
    await run(
      `remove-clan-invite:${invitation.id}`,
      () => removeTournamentClanInvitation(tournamentId, invitation.id),
      `${invitation.clan_name} is no longer on the invited-clan list. Existing tournament lineups were kept.`,
    )
  }

  async function createHostRoster() {
    if (!customName.trim()) return
    await run(
      'host-roster',
      () => createTournamentRoster(tournamentId, {
        name: customName.trim(),
        members: selectedEntrants.map((userId, index) => ({
          user_id: userId,
          member_role: index === 0 ? 'captain' : 'starter',
        })),
      }),
      'Tournament roster created.',
    )
    setCustomName('')
    setSelectedEntrants([])
  }

  async function review(roster: TournamentRoster, decision: 'approve' | 'request_changes' | 'reject') {
    await run(
      `review:${roster.id}`,
      () => reviewTournamentRoster(roster.id, decision, reason[roster.id] || ''),
      decision === 'approve' ? `${roster.name} was approved.` : `${roster.name} was returned to its manager.`,
    )
  }

  async function buyPack(pack: TournamentPerkPack) {
    if (!DIGITAL_CHECKOUT_ENABLED) return
    if (!pack.offer_id) return
    setBusy(`buy:${pack.id}`)
    setNotice(null)
    const result = await startCreatorCashCheckout({
      offer_id: pack.offer_id,
      idempotency_key: crypto.randomUUID(),
    })
    if (result.ok && result.data?.url) {
      window.location.href = result.data.url
      return
    }
    setBusy(null)
    setNotice(friendlyError(result.error))
  }

  async function createPack() {
    if (!DIGITAL_CHECKOUT_ENABLED) return
    if (!packName.trim()) return
    await run(
      'create-pack',
      () => createTournamentPack(tournamentId, {
        name: packName.trim(),
        description: packDescription.trim(),
        price_cents: packPrice,
        qualifying_asset_id: qualifyingAssetId.trim() || undefined,
        benefits: {
          roster_changes: packUnlimitedChanges ? 0 : packChanges,
          unlimited_roster_changes: packUnlimitedChanges,
          artifact_slots: packArtifactSlots,
        },
      }),
      'Tournament perk pack published.',
    )
    setPackName('')
    setPackDescription('')
    setPackUnlimitedChanges(false)
    setQualifyingAssetId('')
  }

  if (!signedIn) {
    return (
      <div className="border-y border-dark-border py-8 text-center">
        <LockKeyhole size={24} className="mx-auto text-accent" aria-hidden />
        <h2 className="mt-3 font-semibold text-white">Tournament rosters are member-only</h2>
        <p className="mt-1 text-sm text-gray-400">Sign in to see official lineups, roster status, and tournament perks.</p>
        <Link to="/login" className="mt-4 inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-semibold text-dark">
          Sign in
        </Link>
      </div>
    )
  }

  if (loading && !board) {
    return <p className="flex min-h-40 items-center justify-center text-sm text-gray-400"><Loader2 size={18} className="mr-2 animate-spin" /> Loading rosters</p>
  }

  if (!board) return <p className="text-sm text-red-300">{notice || 'Tournament rosters are unavailable.'}</p>

  return (
    <div className="space-y-5">
      <div className="flex border-b border-dark-border" role="tablist" aria-label="Roster management">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'rosters'}
          onClick={() => setView('rosters')}
          className={`min-h-11 px-4 text-sm font-semibold ${view === 'rosters' ? 'border-b-2 border-accent text-accent' : 'text-gray-400'}`}
        >
          Rosters ({board.rosters.length})
        </button>
        {DIGITAL_CHECKOUT_ENABLED && <button
          type="button"
          role="tab"
          aria-selected={view === 'perks'}
          onClick={() => setView('perks')}
          className={`min-h-11 px-4 text-sm font-semibold ${view === 'perks' ? 'border-b-2 border-accent text-accent' : 'text-gray-400'}`}
        >
          Perks ({board.packs.length})
        </button>}
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-gray-200">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-gray-400 hover:text-white"><X size={16} /></button>
        </div>
      )}

      {view === 'rosters' && (
        <>
          {board.is_host && (
            <section className="border-b border-dark-border pb-5">
              <h2 className="font-semibold text-white">Clan participation</h2>
              <p className="mt-1 text-xs text-gray-400">
                Allow every clan to enter a saved roster, or limit roster entry to clans you invite.
              </p>

              <label className="mt-3 block text-xs font-semibold text-gray-300">
                Who may enter a clan roster
                <select
                  value={board.clan_entry_mode}
                  disabled={busy === 'clan-entry-mode'}
                  onChange={(event) => void changeClanEntryMode(event.target.value as 'open' | 'invited_only')}
                  className="mt-1 min-h-11 w-full rounded-md border border-dark-border bg-dark px-3 text-sm text-white disabled:opacity-50"
                >
                  <option value="open">Every clan</option>
                  <option value="invited_only">Invited clans only</option>
                </select>
              </label>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <select
                  value={inviteClanId}
                  aria-label="Clan to invite"
                  onChange={(event) => {
                    setInviteClanId(event.target.value)
                    setInviteRosterId('')
                  }}
                  className="min-h-11 min-w-0 rounded-md border border-dark-border bg-dark px-3 text-sm text-white"
                >
                  <option value="">Choose a clan to invite</option>
                  {board.clan_options.map((clan) => (
                    <option key={clan.id} value={clan.id}>
                      {clan.clan_tag ? `[${clan.clan_tag}] ` : ''}{clan.name}
                    </option>
                  ))}
                </select>
                <select
                  value={inviteRosterId}
                  aria-label="Saved roster to invite"
                  disabled={!selectedInviteClan || selectedInviteClan.rosters.length === 0}
                  onChange={(event) => setInviteRosterId(event.target.value)}
                  className="min-h-11 min-w-0 rounded-md border border-dark-border bg-dark px-3 text-sm text-white disabled:opacity-50"
                >
                  <option value="">
                    {!selectedInviteClan
                      ? 'Choose a clan first'
                      : selectedInviteClan.rosters.length
                        ? 'Let the clan choose its roster'
                        : 'This clan has no saved rosters'}
                  </option>
                  {selectedInviteClan?.rosters.map((roster) => (
                    <option key={roster.id} value={roster.id}>
                      {roster.name} ({roster.member_count})
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!selectedInviteClan || busy === 'invite-clan' || busy === 'invite-add-clan'}
                  onClick={() => void inviteClan(false)}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md border border-accent/50 px-3 text-sm font-semibold text-accent disabled:opacity-50"
                >
                  <Send size={16} /> Invite clan
                </button>
                <button
                  type="button"
                  disabled={!selectedInviteClan || !inviteRosterId || busy === 'invite-clan' || busy === 'invite-add-clan'}
                  onClick={() => void inviteClan(true)}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md bg-accent px-3 text-sm font-semibold text-dark disabled:opacity-50"
                >
                  <Plus size={16} /> Invite and add roster
                </button>
              </div>

              {board.clan_invitations.length > 0 && (
                <div className="mt-4 divide-y divide-dark-border border-y border-dark-border">
                  {board.clan_invitations.map((invitation) => (
                    <div key={invitation.id} className="flex min-h-14 items-center gap-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-white">
                          {invitation.clan_tag ? `[${invitation.clan_tag}] ` : ''}{invitation.clan_name}
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          {invitation.source_clan_roster_name || 'Clan chooses its saved roster'} · {invitation.status}
                        </p>
                      </div>
                      <button
                        type="button"
                        title="Remove clan invitation"
                        aria-label={`Remove ${invitation.clan_name} invitation`}
                        disabled={busy === `remove-clan-invite:${invitation.id}`}
                        onClick={() => void removeClanInvitation(invitation)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-red-500/30 text-red-300 disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {!board.is_host && board.clan_entry_mode === 'invited_only' && board.clan_invitations.length > 0 && (
            <section className="border-b border-accent/30 bg-accent/5 px-3 py-4">
              <h2 className="font-semibold text-white">Your clan was invited</h2>
              <p className="mt-1 text-xs text-gray-400">Choose one of the clan's saved rosters below to enter it in this tournament.</p>
            </section>
          )}

          {tournamentClanRosters.length > 0 && (
            <section className="border-b border-dark-border pb-5">
              <h2 className="font-semibold text-white">Enter a clan lineup</h2>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <select
                  value={sourceRosterId}
                  aria-label="Reusable clan roster"
                  onChange={(event) => setSourceRosterId(event.target.value)}
                  className="min-h-11 min-w-0 flex-1 rounded-md border border-dark-border bg-dark px-3 text-sm text-white"
                >
                  <option value="">Choose a reusable clan roster</option>
                  {tournamentClanRosters.map((roster) => (
                    <option key={roster.id} value={roster.id}>{roster.clan_name} | {roster.name} ({roster.members.length})</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!sourceRosterId || busy === 'enter-clan'}
                  onClick={() => void enterClanRoster()}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-dark disabled:opacity-50"
                >
                  <Send size={17} /> Enter roster
                </button>
              </div>
            </section>
          )}

          {!board.is_host && board.clan_entry_mode === 'invited_only' && tournamentClanRosters.length === 0 && (
            <p className="border-b border-dark-border pb-5 text-sm text-gray-500">
              This tournament accepts clan rosters by invitation. Ask the organizer to invite a clan you manage.
            </p>
          )}

          {board.is_host && (
            <section className="border-b border-dark-border pb-5">
              <h2 className="font-semibold text-white">Organizer lineup</h2>
              <input
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                placeholder="Team or roster name"
                className="mt-3 min-h-11 w-full rounded-md border border-dark-border bg-dark px-3 text-sm text-white"
              />
              {entrantOptions.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {entrantOptions.map((entrant) => (
                    <label key={entrant.user_id} className="flex min-h-10 items-center gap-2 border-b border-dark-border/60 px-1 text-sm text-gray-200">
                      <input
                        type="checkbox"
                        checked={selectedEntrants.includes(entrant.user_id)}
                        onChange={(event) => setSelectedEntrants((current) => event.target.checked
                          ? [...current, entrant.user_id]
                          : current.filter((id) => id !== entrant.user_id))}
                        className="h-4 w-4 accent-accent"
                      />
                      {entrant.username || 'Player'}
                    </label>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => void createHostRoster()}
                disabled={!customName.trim() || busy === 'host-roster'}
                className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-accent/50 px-3 text-sm font-semibold text-accent disabled:opacity-50"
              >
                <Plus size={17} /> Create lineup
              </button>
            </section>
          )}

          {board.rosters.length === 0 && <p className="py-8 text-center text-sm text-gray-500">No tournament rosters have been entered.</p>}
          <div className="space-y-4">
            {board.rosters.map((roster) => (
              <RosterPanel
                key={roster.id}
                roster={roster}
                viewerId={user?.id || ''}
                isHost={board.is_host}
                packs={board.packs}
                clanRosters={clanRosters}
                entrants={entrantOptions}
                busy={busy}
                reason={reason[roster.id] || ''}
                addPlayer={addPlayer[roster.id] || ''}
                addRole={addRole[roster.id] || 'starter'}
                grantPack={grantPack[roster.id] || ''}
                artifactChoice={artifactChoice[roster.id] || ''}
                ownedArtifacts={board.owned_artifacts}
                onReason={(value) => setReason((current) => ({ ...current, [roster.id]: value }))}
                onAddPlayer={(value) => setAddPlayer((current) => ({ ...current, [roster.id]: value }))}
                onAddRole={(value) => setAddRole((current) => ({ ...current, [roster.id]: value }))}
                onGrantPack={(value) => setGrantPack((current) => ({ ...current, [roster.id]: value }))}
                onArtifactChoice={(value) => setArtifactChoice((current) => ({ ...current, [roster.id]: value }))}
                onRun={run}
                onReview={review}
              />
            ))}
          </div>
        </>
      )}

      {DIGITAL_CHECKOUT_ENABLED && view === 'perks' && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {board.packs.map((pack) => {
              const benefits = parseBenefits(pack)
              return (
                <article key={pack.id} className="rounded-md border border-dark-border bg-dark-card p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-chakra/10 text-chakra"><PackagePlus size={19} /></span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-white">{pack.name}</h3>
                      <p className="mt-1 text-xs leading-5 text-gray-400">{pack.description || 'Tournament organizer perk.'}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-300">
                    {benefits.unlimited_roster_changes
                      ? <span>Unlimited roster changes in this tournament</span>
                      : benefits.roster_changes > 0 && <span>{benefits.roster_changes} roster change{benefits.roster_changes === 1 ? '' : 's'}</span>}
                    {benefits.artifact_slots > 0 && <span>{benefits.artifact_slots} tournament artifact placement{benefits.artifact_slots === 1 ? '' : 's'}</span>}
                  </div>
                  {pack.price_cents > 0 && pack.offer_id ? (
                    <button
                      type="button"
                      disabled={busy === `buy:${pack.id}`}
                      onClick={() => void buyPack(pack)}
                      className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-accent px-3 text-sm font-semibold text-dark disabled:opacity-50"
                    >
                      <CreditCard size={17} /> {busy === `buy:${pack.id}` ? 'Opening checkout...' : `Buy ${formatUsd(pack.price_cents)}`}
                    </button>
                  ) : (
                    <p className="mt-4 text-xs text-gray-500">Granted by the tournament organizer.</p>
                  )}
                </article>
              )
            })}
          </div>

          {board.packs.length === 0 && !board.is_host && <p className="py-8 text-center text-sm text-gray-500">No tournament perks are available.</p>}

          {board.is_host && (
            <section className="border-t border-dark-border pt-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-white">Publish a perk pack</h2>
                  <p className="mt-1 text-xs text-gray-400">Packs can unlock roster changes or tournament artifact placements. Paid packs use your Stripe payout account.</p>
                </div>
                <Link to="/settings#payouts" className="shrink-0 text-xs text-accent hover:underline">Payout settings</Link>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <input value={packName} onChange={(event) => setPackName(event.target.value)} placeholder="Pack name" className="min-h-11 rounded-md border border-dark-border bg-dark px-3 text-sm text-white" />
                <select value={packPrice} onChange={(event) => setPackPrice(Number(event.target.value))} className="min-h-11 rounded-md border border-dark-border bg-dark px-3 text-sm text-white">
                  <option value={0}>Organizer grant only</option>
                  {CREATOR_PRICE_CENTS.map((price) => <option key={price} value={price}>{formatUsd(price)}</option>)}
                </select>
                <textarea value={packDescription} onChange={(event) => setPackDescription(event.target.value)} placeholder="What this pack changes" rows={3} className="rounded-md border border-dark-border bg-dark px-3 py-2 text-sm text-white sm:col-span-2" />
                <div className="text-xs text-gray-400">
                  <label>Roster changes
                    <input
                      type="number"
                      min={0}
                      max={25}
                      value={packUnlimitedChanges ? 0 : packChanges}
                      disabled={packUnlimitedChanges}
                      onChange={(event) => setPackChanges(Math.max(0, Math.min(25, Number(event.target.value) || 0)))}
                      className="mt-1 min-h-10 w-full rounded-md border border-dark-border bg-dark px-3 text-sm text-white disabled:opacity-50"
                    />
                  </label>
                  <label className="mt-2 flex min-h-9 items-center gap-2 text-xs font-semibold text-gray-200">
                    <input
                      type="checkbox"
                      checked={packUnlimitedChanges}
                      onChange={(event) => setPackUnlimitedChanges(event.target.checked)}
                      className="h-4 w-4 accent-accent"
                    />
                    Unlimited for this tournament
                  </label>
                </div>
                <label className="text-xs text-gray-400">Tournament artifact placements
                  <input type="number" min={0} max={12} value={packArtifactSlots} onChange={(event) => setPackArtifactSlots(Math.max(0, Math.min(12, Number(event.target.value) || 0)))} className="mt-1 min-h-10 w-full rounded-md border border-dark-border bg-dark px-3 text-sm text-white" />
                </label>
                <input value={qualifyingAssetId} onChange={(event) => setQualifyingAssetId(event.target.value)} placeholder="Qualifying artifact ID (optional)" className="min-h-11 rounded-md border border-dark-border bg-dark px-3 text-sm text-white sm:col-span-2" />
              </div>
              {packUnlimitedChanges && (
                <p className="mt-3 text-xs text-accent">
                  Unlimited changes apply only to rosters in this tournament. The perk never carries into another tournament.
                </p>
              )}
              <button
                type="button"
                disabled={!packName.trim() || (!packUnlimitedChanges && packChanges === 0 && packArtifactSlots === 0) || busy === 'create-pack'}
                onClick={() => void createPack()}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-dark disabled:opacity-50"
              >
                <PackagePlus size={18} /> {busy === 'create-pack' ? 'Publishing...' : 'Publish pack'}
              </button>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function RosterPanel({
  roster,
  viewerId,
  isHost,
  packs,
  clanRosters,
  entrants,
  busy,
  reason,
  addPlayer,
  addRole,
  grantPack,
  artifactChoice,
  ownedArtifacts,
  onReason,
  onAddPlayer,
  onAddRole,
  onGrantPack,
  onArtifactChoice,
  onRun,
  onReview,
}: {
  roster: TournamentRoster
  viewerId: string
  isHost: boolean
  packs: TournamentPerkPack[]
  clanRosters: ManagedClanRoster[]
  entrants: Entrant[]
  busy: string | null
  reason: string
  addPlayer: string
  addRole: RosterMemberRole
  grantPack: string
  artifactChoice: string
  ownedArtifacts: OwnedTournamentArtifact[]
  onReason: (value: string) => void
  onAddPlayer: (value: string) => void
  onAddRole: (value: RosterMemberRole) => void
  onGrantPack: (value: string) => void
  onArtifactChoice: (value: string) => void
  onRun: (key: string, action: () => Promise<{ ok: boolean; error: string | null }>, success: string) => Promise<void>
  onReview: (roster: TournamentRoster, decision: 'approve' | 'request_changes' | 'reject') => Promise<void>
}) {
  const source = clanRosters.find((item) => item.id === roster.source_clan_roster_id)
  const candidates = (source?.members || entrants.map((entrant) => ({
    id: entrant.user_id,
    user_id: entrant.user_id,
    username: entrant.username || 'Player',
    avatar_url: entrant.avatar_url || null,
    member_role: 'starter' as const,
  }))).filter((candidate) => !roster.members.some((member) => member.user_id === candidate.user_id))
  const locked = roster.status === 'submitted' || roster.status === 'approved'
  const lockedForWithdrawal = Boolean(roster.locked_at) || ['submitted', 'approved', 'changes_requested', 'rejected'].includes(roster.status)
  const canWithdrawRoster = roster.can_withdraw && (isHost || (!lockedForWithdrawal && roster.status === 'draft'))
  const hostOverrideBlocked = locked && isHost && !reason.trim()
  const artifactHostReasonBlocked = isHost && !reason.trim()
  const hostWithdrawalBlocked = isHost && !reason.trim()
  const attachedArtifacts = roster.artifacts || []
  const availableArtifacts = ownedArtifacts.filter(
    (artifact) => !attachedArtifacts.some((attached) => attached.asset_id === artifact.id),
  )

  return (
    <article className="rounded-md border border-dark-border bg-dark-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-white">{roster.name}</h2>
          <p className="mt-1 text-xs text-gray-500">
            {roster.clan_name || 'Organizer lineup'} | Version {roster.version} | {roster.status.replace('_', ' ')}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] ${roster.status === 'approved' ? 'border-leaf/40 text-leaf' : roster.status === 'changes_requested' ? 'border-chakra/40 text-chakra' : 'border-dark-border text-gray-400'}`}>
          {locked ? <LockKeyhole size={12} /> : <ShieldCheck size={12} />}
          {locked ? 'Locked' : 'Editable'}
        </span>
      </div>

      {roster.change_request && <p className="mt-3 border-l-2 border-chakra pl-3 text-xs text-gray-300">{roster.change_request}</p>}

      <div className="mt-3 divide-y divide-dark-border/70">
        {roster.members.map((member) => (
          <div key={member.id} className="flex min-h-11 items-center gap-2">
            <Avatar src={member.avatar_url} name={member.username} seed={member.user_id} size={28} />
            <span className="min-w-0 flex-1 truncate text-sm text-white">{member.username}</span>
            <span className="text-[11px] text-gray-500">{ROLE_LABEL[member.member_role]}</span>
            {(roster.can_manage || member.user_id === viewerId) && (
              <button
                type="button"
                title={member.user_id === viewerId ? 'Leave roster' : 'Remove player'}
                aria-label={member.user_id === viewerId ? `Leave ${roster.name}` : `Remove ${member.username}`}
                disabled={busy === `remove:${roster.id}:${member.user_id}` || (member.user_id !== viewerId && hostOverrideBlocked)}
                onClick={() => void onRun(
                  `remove:${roster.id}:${member.user_id}`,
                  () => removeTournamentRosterMember(roster.id, member.user_id, reason),
                  member.user_id === viewerId
                    ? `You left ${roster.name}.`
                    : `${member.username} was removed from ${roster.name}.`,
                )}
                className="flex h-9 w-9 items-center justify-center text-gray-500 hover:text-red-400 disabled:opacity-50"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
      </div>

      {(attachedArtifacts.length > 0 || (roster.can_manage && availableArtifacts.length > 0)) && (
        <div className="mt-4 border-t border-dark-border pt-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase text-gray-400"><Gem size={15} className="text-chakra" /> Tournament artifacts</h3>
            {roster.can_manage && !isHost && (
              <span className="text-[11px] text-gray-500">{roster.artifact_slots_remaining || 0} placement{roster.artifact_slots_remaining === 1 ? '' : 's'} available</span>
            )}
          </div>
          {attachedArtifacts.map((artifact) => (
            <div key={artifact.id} className="mt-2 flex min-h-10 items-center gap-2 border-b border-dark-border/60 last:border-0">
              {artifact.image_url ? <img src={artifact.image_url} alt="" className="h-8 w-8 rounded-sm object-cover" /> : <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-chakra/10 text-chakra"><Gem size={16} /></span>}
              <span className="min-w-0 flex-1 truncate text-sm text-white">{artifact.name}</span>
              <span className="text-[11px] text-gray-500">{artifact.kind.replace('_', ' ')}</span>
              {roster.can_manage && (
                <button
                  type="button"
                  title="Remove tournament artifact"
                  aria-label={`Remove ${artifact.name}`}
                  disabled={busy === `remove-artifact:${artifact.id}` || artifactHostReasonBlocked}
                  onClick={() => void onRun(
                    `remove-artifact:${artifact.id}`,
                    () => removeTournamentRosterArtifact(roster.id, artifact.id, reason),
                    `${artifact.name} was removed from ${roster.name}.`,
                  )}
                  className="flex h-9 w-9 items-center justify-center text-gray-500 hover:text-red-400 disabled:opacity-50"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          {roster.can_manage && availableArtifacts.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_40px]">
              <select value={artifactChoice} onChange={(event) => onArtifactChoice(event.target.value)} className="min-h-10 min-w-0 rounded-md border border-dark-border bg-dark px-2 text-sm text-white">
                <option value="">Attach an owned artifact</option>
                {availableArtifacts.map((artifact) => <option key={artifact.id} value={artifact.id}>{artifact.name}</option>)}
              </select>
              <button
                type="button"
                title="Attach tournament artifact"
                aria-label="Attach tournament artifact"
                disabled={!artifactChoice || busy === `attach-artifact:${roster.id}` || artifactHostReasonBlocked}
                onClick={() => {
                  const assetId = artifactChoice
                  onArtifactChoice('')
                  void onRun(
                    `attach-artifact:${roster.id}`,
                    () => attachTournamentRosterArtifact(roster.id, assetId, reason),
                    'Tournament artifact attached.',
                  )
                }}
                className="flex h-10 w-10 items-center justify-center rounded-md border border-chakra/50 text-chakra disabled:opacity-50"
              >
                <Plus size={18} />
              </button>
            </div>
          )}
        </div>
      )}

      {roster.can_manage && candidates.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_116px_40px]">
          <select value={addPlayer} onChange={(event) => onAddPlayer(event.target.value)} className="min-h-10 min-w-0 rounded-md border border-dark-border bg-dark px-2 text-sm text-white">
            <option value="">Add player</option>
            {candidates.map((candidate) => <option key={candidate.user_id} value={candidate.user_id}>{candidate.username}</option>)}
          </select>
          <select value={addRole} onChange={(event) => onAddRole(event.target.value as RosterMemberRole)} className="min-h-10 rounded-md border border-dark-border bg-dark px-2 text-sm text-white">
            {Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button
            type="button"
            title="Add player"
            aria-label="Add player"
            disabled={!addPlayer || busy === `add:${roster.id}` || hostOverrideBlocked}
            onClick={() => void onRun(
              `add:${roster.id}`,
              () => addTournamentRosterMember(roster.id, addPlayer, addRole, reason),
              'Player added to the roster.',
            )}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-accent/50 text-accent disabled:opacity-50"
          >
            <UserRoundPlus size={18} />
          </button>
        </div>
      )}

      {roster.can_manage && (
        <div className="mt-3">
          <label className="text-xs text-gray-500">
            {isHost
              ? locked
                ? 'Audit reason required for an organizer override'
                : 'Change note (required to remove the full roster)'
              : locked
                ? 'Reason recorded with perk use'
                : 'Change note (optional)'}
            <input value={reason} onChange={(event) => onReason(event.target.value)} placeholder="Why this lineup is changing" className="mt-1 min-h-10 w-full rounded-md border border-dark-border bg-dark px-3 text-sm text-white" />
          </label>
          {locked && !isHost && (
            <p className="mt-2 text-xs text-gray-400">
              {roster.roster_changes_unlimited
                ? 'Unlimited roster changes are available for this tournament.'
                : roster.roster_changes_remaining > 0
                ? `${roster.roster_changes_remaining} roster change${roster.roster_changes_remaining === 1 ? '' : 's'} available.`
                : 'No roster-change perks are available.'}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-dark-border pt-3">
        {roster.can_manage && roster.source_clan_roster_id && (
          <button type="button" onClick={() => void onRun(`sync:${roster.id}`, () => syncTournamentRoster(roster.id, reason), 'Lineup synced from the clan roster.')} disabled={busy === `sync:${roster.id}` || hostOverrideBlocked} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-dark-border px-3 text-xs font-semibold text-gray-200 disabled:opacity-50">
            <RefreshCw size={15} /> Sync
          </button>
        )}
        {roster.can_manage && (roster.status === 'draft' || roster.status === 'changes_requested') && (
          <button type="button" onClick={() => void onRun(`submit:${roster.id}`, () => submitTournamentRoster(roster.id), 'Roster submitted and locked for organizer review.')} disabled={busy === `submit:${roster.id}`} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-accent px-3 text-xs font-semibold text-dark disabled:opacity-50">
            <Send size={15} /> Submit and lock
          </button>
        )}
        {isHost && roster.status === 'submitted' && (
          <>
            <button type="button" onClick={() => void onReview(roster, 'approve')} disabled={busy === `review:${roster.id}`} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-md bg-leaf px-3 text-xs font-semibold text-dark disabled:opacity-50" title="Approve roster" aria-label="Approve roster"><Check size={17} /> Approve</button>
            <button type="button" onClick={() => void onReview(roster, 'request_changes')} disabled={!reason.trim() || busy === `review:${roster.id}`} className="inline-flex min-h-10 items-center rounded-md border border-chakra/50 px-3 text-xs font-semibold text-chakra disabled:opacity-50">Request changes</button>
            <button type="button" onClick={() => void onReview(roster, 'reject')} disabled={busy === `review:${roster.id}`} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-md border border-red-500/40 px-3 text-xs font-semibold text-red-400 disabled:opacity-50" title="Reject roster" aria-label="Reject roster"><X size={17} /> Reject</button>
          </>
        )}
        {canWithdrawRoster && (
          <button
            type="button"
            disabled={busy === `withdraw:${roster.id}` || hostWithdrawalBlocked}
            title={hostWithdrawalBlocked ? 'Enter an audit reason before removing this roster' : undefined}
            onClick={() => {
              const action = isHost ? 'remove' : 'withdraw'
              if (!window.confirm(`${action === 'remove' ? 'Remove' : 'Withdraw'} ${roster.name} from this tournament? The roster and its history will be kept for audit.`)) return
              void onRun(
                `withdraw:${roster.id}`,
                () => withdrawTournamentRoster(roster.id, reason),
                `${roster.name} was ${isHost ? 'removed' : 'withdrawn'} from the tournament.`,
              )
            }}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-red-500/40 px-3 text-xs font-semibold text-red-400 disabled:opacity-50"
          >
            <Trash2 size={15} /> {isHost ? 'Remove roster' : 'Withdraw roster'}
          </button>
        )}
      </div>

      {isHost && packs.length > 0 && (
        <div className="mt-4 grid gap-2 border-t border-dark-border pt-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <select value={grantPack} onChange={(event) => onGrantPack(event.target.value)} className="min-h-10 min-w-0 rounded-md border border-dark-border bg-dark px-2 text-sm text-white">
            <option value="">Choose a perk pack</option>
            {packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
          </select>
          <button
            type="button"
            disabled={!grantPack || busy === `grant:${roster.id}`}
            onClick={() => void onRun(
              `grant:${roster.id}`,
              () => grantTournamentPack(grantPack, { tournament_roster_id: roster.id, note: reason }),
              `Perk granted to ${roster.name}.`,
            )}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-accent/50 px-3 text-xs font-semibold text-accent disabled:opacity-50"
          >
            <PackagePlus size={16} /> Grant perk
          </button>
        </div>
      )}
    </article>
  )
}

export default TournamentRostersPanel
