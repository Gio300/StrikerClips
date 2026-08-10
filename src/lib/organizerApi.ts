import { apiUrl } from './apiBase'
import { backend } from './backend'

export type OrganizerResult<T> = {
  ok: boolean
  data: T | null
  error: string | null
  status: number
}

export type RosterMemberRole = 'captain' | 'starter' | 'substitute' | 'coach'

export type ClanApplication = {
  id: string
  server_id: string
  applicant_id: string
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  message: string
  fee_tokens_snapshot: number
  username?: string
  avatar_url?: string | null
  created_at: string
  updated_at: string
}

export type RosterMember = {
  id: string
  user_id: string
  member_role: RosterMemberRole
  username: string
  avatar_url: string | null
}

export type ClanRosterInvite = {
  id: string
  email: string
  invitee_id: string | null
  member_role: RosterMemberRole
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'
  expires_at: string
}

export type ClanRoster = {
  id: string
  server_id: string
  name: string
  game: string
  max_members: number
  status: 'active' | 'archived'
  members: RosterMember[]
  invites: ClanRosterInvite[]
}

export type ManagedClanRoster = Omit<ClanRoster, 'invites'> & {
  clan_name: string
  clan_tag: string | null
  invites?: ClanRosterInvite[]
}

export type ManagedClan = {
  id: string
  name: string
  clan_tag: string | null
  owner_id: string
  total_points: number
  treasury_tokens: number
  village_id: string | null
  role: string | null
}

export type TournamentClanInvitation = {
  id: string
  tournament_id: string
  clan_id: string
  clan_name: string
  clan_tag: string | null
  source_clan_roster_id: string | null
  source_clan_roster_name: string | null
  status: 'invited' | 'accepted' | 'declined'
  invited_by: string
  responded_by: string | null
  responded_at: string | null
  created_at: string
  updated_at: string
}

export type TournamentClanOption = {
  id: string
  name: string
  clan_tag: string | null
  rosters: Array<{
    id: string
    name: string
    member_count: number
  }>
}

export type VillageClan = {
  id: string
  name: string
  clan_tag: string | null
  owner_id: string
  total_points: number
  treasury_tokens: number
  member_count: number
  joined_at: string
  under_strength: boolean
}

export type Village = {
  id: string
  name: string
  chief_profile_id: string | null
  home_territory_id: string | null
  home_territory_name: string | null
  clans: VillageClan[]
  territories: Array<{
    id: string
    name: string
    owner_clan_id: string | null
    owner_village_id: string | null
    captured_at: string | null
  }>
  tournaments: Array<{
    id: string
    name: string
    status: string
    start_at: string | null
    end_at: string | null
    entry_scope: string
  }>
}

export type ClanAllianceRequest = {
  id: string
  from_clan_id: string
  to_clan_id: string
  from_clan_name: string
  to_clan_name: string
  proposed_village_name: string
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
  updated_at: string
}

export type ClanAllianceDashboard = {
  clan: ManagedClan & { resolved_village_id?: string | null }
  can_manage: boolean
  village: Village | null
  incoming: ClanAllianceRequest[]
  outgoing: ClanAllianceRequest[]
  eligible_clans: Array<ManagedClan & { member_count: number }>
}

export type TournamentRosterArtifact = {
  id: string
  asset_id: string
  name: string
  image_url: string | null
  kind: string
  attached_by: string
  attached_by_name: string
  entitlement_source: 'purchase' | 'artifact' | 'grant' | 'host_override'
  reason: string | null
  attached_at: string
}

export type OwnedTournamentArtifact = {
  id: string
  name: string
  image_url: string | null
  kind: string
}

export type TournamentRosterStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'changes_requested'
  | 'rejected'
  | 'withdrawn'

export type TournamentRoster = {
  id: string
  tournament_id: string
  clan_id: string | null
  clan_name?: string | null
  clan_tag?: string | null
  source_clan_roster_id: string | null
  name: string
  captain_id: string | null
  captain_name?: string | null
  status: TournamentRosterStatus
  version: number
  locked_at: string | null
  change_request: string | null
  members: RosterMember[]
  artifacts: TournamentRosterArtifact[]
  can_manage: boolean
  can_withdraw: boolean
  host_control: boolean
  roster_changes_unlimited: boolean
  roster_changes_remaining: number
  artifact_slots_remaining: number
  revisions: Array<{
    id: string
    version: number
    action: string
    actor_id: string
    reason: string | null
    entitlement_source: string | null
    created_at: string
  }>
}

export type TournamentPerkPack = {
  id: string
  tournament_id: string
  offer_id: string | null
  qualifying_asset_id: string | null
  name: string
  description: string
  image_url: string | null
  price_cents: number
  benefits: { roster_changes?: number; unlimited_roster_changes?: boolean; artifact_slots?: number } | string
  active: boolean
}

async function token(): Promise<string | null> {
  const client = await backend()
  const result = await client?.auth?.getSession?.()
  return result?.data?.session?.access_token ?? null
}

async function organizerApi<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; auth?: boolean } = {},
): Promise<OrganizerResult<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.auth !== false) {
    const accessToken = await token()
    if (!accessToken) return { ok: false, data: null, error: 'Sign in to continue.', status: 401 }
    headers.Authorization = `Bearer ${accessToken}`
  }
  try {
    const response = await fetch(apiUrl(path), {
      method: options.method || 'GET',
      headers,
      body: options.body == null ? undefined : JSON.stringify(options.body),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      return {
        ok: false,
        data: payload as T,
        error: String(payload?.error || response.statusText || 'Request failed'),
        status: response.status,
      }
    }
    return { ok: true, data: payload as T, error: null, status: response.status }
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : 'Network error',
      status: 0,
    }
  }
}

export function applyToClan(serverId: string, message: string) {
  return organizerApi<{ application: ClanApplication }>(`/organizer/clans/${serverId}/applications`, {
    method: 'POST',
    body: { message },
  })
}

export function fetchMyClanApplications() {
  return organizerApi<{ applications: Array<ClanApplication & { clan_name: string; clan_tag: string | null }> }>(
    '/organizer/clan-applications/mine',
  )
}

export function fetchMyManagedClans() {
  return organizerApi<{ clans: ManagedClan[] }>('/organizer/clans/mine')
}

export function fetchClanAllianceDashboard(serverId: string) {
  return organizerApi<ClanAllianceDashboard>(`/organizer/clans/${serverId}/alliance-dashboard`)
}

export function proposeClanAlliance(serverId: string, targetClanId: string, villageName: string) {
  return organizerApi<{ request: ClanAllianceRequest }>(`/organizer/clans/${serverId}/alliance-requests`, {
    method: 'POST',
    body: { to_clan_id: targetClanId, village_name: villageName },
  })
}

export function reviewClanAlliance(requestId: string, decision: 'accept' | 'reject') {
  return organizerApi<{ request: ClanAllianceRequest; village: Village | null }>(
    `/organizer/alliance-requests/${requestId}/review`,
    { method: 'POST', body: { decision } },
  )
}

export function fetchVillage(villageId: string) {
  return organizerApi<{ village: Village; can_manage: boolean }>(`/organizer/villages/${villageId}`)
}

export function claimVillageHome(villageId: string, territoryId: string) {
  return organizerApi<{ village: Village }>(`/organizer/villages/${villageId}/home-territory`, {
    method: 'POST',
    body: { territory_id: territoryId },
  })
}

export function fetchClanOrganizerDashboard(serverId: string) {
  return organizerApi<{
    applications: ClanApplication[]
    members: Array<{ id: string; user_id: string; role: string; username: string; avatar_url: string | null }>
    rosters: ClanRoster[]
  }>(
    `/organizer/clans/${serverId}/dashboard`,
  )
}

export function fetchMyManagedClanRosters() {
  return organizerApi<{ rosters: ManagedClanRoster[] }>('/organizer/clan-rosters/mine')
}

export type MyClanRosterMembership = {
  id: string
  server_id: string
  name: string
  game: string
  max_members: number
  status: string
  clan_name: string
  clan_tag: string | null
  member_role: RosterMemberRole
  added_at: string
}

export function fetchMyClanRosterMemberships() {
  return organizerApi<{ rosters: MyClanRosterMembership[] }>('/organizer/clan-roster-memberships/mine')
}

export function reviewClanApplication(applicationId: string, decision: 'approve' | 'reject') {
  return organizerApi<{ application: ClanApplication }>(`/organizer/clan-applications/${applicationId}/review`, {
    method: 'POST',
    body: { decision },
  })
}

export function createClanRoster(
  serverId: string,
  input: { name: string; game?: string; max_members: number; member_ids?: string[] },
) {
  return organizerApi<{ roster: ClanRoster }>(`/organizer/clans/${serverId}/rosters`, {
    method: 'POST',
    body: input,
  })
}

export function updateClanRoster(rosterId: string, input: { name?: string; max_members?: number }) {
  return organizerApi<{ roster: ClanRoster }>(`/organizer/clan-rosters/${rosterId}`, {
    method: 'PATCH',
    body: input,
  })
}

export function deleteClanRoster(rosterId: string) {
  return organizerApi<{ deleted_roster_id: string }>(`/organizer/clan-rosters/${rosterId}`, {
    method: 'DELETE',
  })
}

export function addClanRosterMember(rosterId: string, userId: string, role: RosterMemberRole) {
  return organizerApi<{ members: RosterMember[] }>(`/organizer/clan-rosters/${rosterId}/members`, {
    method: 'POST',
    body: { user_id: userId, member_role: role },
  })
}

export function removeClanRosterMember(rosterId: string, userId: string) {
  return organizerApi<{ members: RosterMember[] }>(`/organizer/clan-rosters/${rosterId}/members/${userId}`, {
    method: 'DELETE',
  })
}

export function inviteClanRosterMember(rosterId: string, target: string, role: RosterMemberRole) {
  return organizerApi<{ invite: ClanRosterInvite; email_sent: boolean }>(`/organizer/clan-rosters/${rosterId}/invites`, {
    method: 'POST',
    body: { target, member_role: role },
  })
}

export function previewRosterInvite(tokenValue: string) {
  return organizerApi<{
    invitation: {
      id: string
      status: string
      member_role: RosterMemberRole
      fee_tokens_snapshot: number
      expires_at: string
      expired: boolean
      roster_id: string
      roster_name: string
      game: string
      clan_id: string
      clan_name: string
      inviter_name: string
    }
  }>(`/organizer/roster-invites/preview?token=${encodeURIComponent(tokenValue)}`, { auth: false })
}

export function acceptRosterInvite(tokenValue: string) {
  return organizerApi<{ roster_id: string; clan_id: string }>('/organizer/roster-invites/accept', {
    method: 'POST',
    body: { token: tokenValue },
  })
}

export function fetchTournamentRosterBoard(tournamentId: string) {
  return organizerApi<{
    tournament: Record<string, unknown>
    is_host: boolean
    clan_entry_mode: 'open' | 'invited_only'
    clan_invitations: TournamentClanInvitation[]
    clan_options: TournamentClanOption[]
    rosters: TournamentRoster[]
    packs: TournamentPerkPack[]
    owned_artifacts: OwnedTournamentArtifact[]
  }>(`/organizer/tournaments/${tournamentId}/rosters`)
}

export function setTournamentClanEntryMode(tournamentId: string, mode: 'open' | 'invited_only') {
  return organizerApi<{ clan_entry_mode: 'open' | 'invited_only' }>(`/organizer/tournaments/${tournamentId}/clan-entry-mode`, {
    method: 'PATCH',
    body: { mode },
  })
}

export function inviteTournamentClan(tournamentId: string, clanId: string, sourceClanRosterId?: string) {
  return organizerApi<{ invitation: TournamentClanInvitation }>(`/organizer/tournaments/${tournamentId}/clan-invitations`, {
    method: 'POST',
    body: { clan_id: clanId, source_clan_roster_id: sourceClanRosterId || null },
  })
}

export function removeTournamentClanInvitation(tournamentId: string, invitationId: string) {
  return organizerApi<{ deleted_invitation_id: string }>(`/organizer/tournaments/${tournamentId}/clan-invitations/${invitationId}`, {
    method: 'DELETE',
  })
}

export function createTournamentRoster(
  tournamentId: string,
  input: { source_clan_roster_id?: string; clan_id?: string; name?: string; members?: Array<{ user_id: string; member_role: RosterMemberRole }> },
) {
  return organizerApi<{ roster: TournamentRoster }>(`/organizer/tournaments/${tournamentId}/rosters`, {
    method: 'POST',
    body: input,
  })
}

export function submitTournamentRoster(rosterId: string) {
  return organizerApi<{ roster: TournamentRoster }>(`/organizer/tournament-rosters/${rosterId}/submit`, {
    method: 'POST',
  })
}

export function withdrawTournamentRoster(rosterId: string, reason = '') {
  return organizerApi<{ roster: TournamentRoster }>(`/organizer/tournament-rosters/${rosterId}/withdraw`, {
    method: 'POST',
    body: { reason, mutation_id: crypto.randomUUID() },
  })
}

export function syncTournamentRoster(rosterId: string, reason = '') {
  return organizerApi<{ roster: TournamentRoster }>(`/organizer/tournament-rosters/${rosterId}/sync`, {
    method: 'POST',
    body: { mutation_id: crypto.randomUUID(), reason },
  })
}

export function addTournamentRosterMember(
  rosterId: string,
  userId: string,
  role: RosterMemberRole,
  reason = '',
) {
  return organizerApi<{ roster: TournamentRoster }>(`/organizer/tournament-rosters/${rosterId}/members`, {
    method: 'POST',
    body: { user_id: userId, member_role: role, reason, mutation_id: crypto.randomUUID() },
  })
}

export function removeTournamentRosterMember(rosterId: string, userId: string, reason = '') {
  return organizerApi<{ roster: TournamentRoster }>(`/organizer/tournament-rosters/${rosterId}/members/${userId}`, {
    method: 'DELETE',
    body: { reason, mutation_id: crypto.randomUUID() },
  })
}

export function attachTournamentRosterArtifact(rosterId: string, assetId: string, reason = '') {
  return organizerApi<{ roster: TournamentRoster }>(`/organizer/tournament-rosters/${rosterId}/artifacts`, {
    method: 'POST',
    body: { asset_id: assetId, reason, mutation_id: crypto.randomUUID() },
  })
}

export function removeTournamentRosterArtifact(rosterId: string, artifactId: string, reason = '') {
  return organizerApi<{ roster: TournamentRoster }>(`/organizer/tournament-rosters/${rosterId}/artifacts/${artifactId}`, {
    method: 'DELETE',
    body: { reason, mutation_id: crypto.randomUUID() },
  })
}

export function reviewTournamentRoster(
  rosterId: string,
  decision: 'approve' | 'request_changes' | 'reject',
  reason = '',
) {
  return organizerApi<{ roster: TournamentRoster }>(`/organizer/tournament-rosters/${rosterId}/review`, {
    method: 'POST',
    body: { decision, reason },
  })
}

export function createTournamentPack(
  tournamentId: string,
  input: {
    name: string
    description: string
    image_url?: string
    price_cents: number
    qualifying_asset_id?: string
    benefits: { roster_changes: number; unlimited_roster_changes: boolean; artifact_slots: number }
  },
) {
  return organizerApi<{ pack: TournamentPerkPack }>(`/organizer/tournaments/${tournamentId}/packs`, {
    method: 'POST',
    body: input,
  })
}

export function grantTournamentPack(
  packId: string,
  input: { user_id?: string; tournament_roster_id?: string; note?: string },
) {
  return organizerApi<{ grant: Record<string, unknown> }>(`/organizer/tournament-packs/${packId}/grants`, {
    method: 'POST',
    body: input,
  })
}
