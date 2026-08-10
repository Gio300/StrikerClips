import { apiUrl } from './apiBase'
import { currentAuthToken } from './authTokenStorage'

export type OnboardingStatus = 'new' | 'active' | 'deferred' | 'ready' | 'complete'
export type OnboardingLane = 'solo' | 'member' | 'leader' | 'organizer' | null
export type OnboardingActionStatus = 'proposed' | 'confirmed' | 'processing' | 'done' | 'failed'

export interface OnboardingState {
  status: OnboardingStatus
  current_step: string
  revision: number
  lane: OnboardingLane
  roles: string[]
  facts: Record<string, unknown>
  deferred_until?: string | null
  completed_at?: string | null
}

export interface OnboardingAction {
  id: string
  kind: string
  status: OnboardingActionStatus
  label?: string
  payload: Record<string, unknown>
  result?: unknown
  error?: string | null
}

export interface OnboardingTournamentItem {
  id: string
  tournament_id: string
  tournament_name: string
  tournament_status: string
  start_at: string | null
  end_at: string | null
  link: string
  entrant_status?: string
  invited?: boolean
  clan_id?: string
  clan_name?: string
  clan_tag?: string | null
  source_clan_roster_id?: string | null
  source_clan_roster_name?: string | null
  entry_scope?: string
}

export interface OnboardingTournamentHandoff {
  clan_invitations: OnboardingTournamentItem[]
  entries: OnboardingTournamentItem[]
  open_tournaments: OnboardingTournamentItem[]
  more: {
    clan_invitations: boolean
    entries: boolean
    open_tournaments: boolean
  }
}

export interface OnboardingEnvelope {
  state: OnboardingState
  actions: OnboardingAction[]
  tournaments: OnboardingTournamentHandoff
  prompt: string
  suggestions: string[]
}

export type OnboardingDisputeKind = 'youtube_channel' | 'clan'
export type OnboardingDisputeStatus = 'open' | 'confirmed_current' | 'transferred' | 'rejected' | 'cancelled'
export type OnboardingDisputeViewerRole = 'admin' | 'current_owner' | 'challenger'
export type OnboardingDisputeDecision = 'approve' | 'reject'

export interface OnboardingDisputeParty {
  id: string
  username: string | null
}

export interface OnboardingDispute {
  id: string
  kind: OnboardingDisputeKind
  subject_key: string
  status: OnboardingDisputeStatus
  freeze_state: string
  current_owner: OnboardingDisputeParty | null
  challenger: OnboardingDisputeParty
  evidence: Record<string, unknown>
  reviewer_id: string | null
  resolution_note: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  viewer_role: OnboardingDisputeViewerRole
  can_resolve: boolean
}

/** A failed onboarding request, including fresh server state on a 409. */
export class OnboardingApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly envelope: OnboardingEnvelope | null

  constructor(message: string, status: number, code: string | null, envelope: OnboardingEnvelope | null) {
    super(message)
    this.name = 'OnboardingApiError'
    this.status = status
    this.code = code
    this.envelope = envelope
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeStatus(value: unknown): OnboardingStatus {
  return value === 'active' || value === 'deferred' || value === 'ready' || value === 'complete'
    ? value
    : 'new'
}

function normalizeLane(value: unknown): OnboardingLane {
  return value === 'solo' || value === 'member' || value === 'leader' || value === 'organizer'
    ? value
    : null
}

function normalizeActionStatus(value: unknown): OnboardingActionStatus {
  return value === 'confirmed' || value === 'processing' || value === 'done' || value === 'failed'
    ? value
    : 'proposed'
}

function normalizeTournamentItem(value: unknown): OnboardingTournamentItem | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string'
    || typeof value.tournament_id !== 'string'
    || typeof value.tournament_name !== 'string'
    || typeof value.tournament_status !== 'string'
    || typeof value.link !== 'string'
    || !value.link.startsWith('/tournaments/')
  ) return null
  const item: OnboardingTournamentItem = {
    id: value.id,
    tournament_id: value.tournament_id,
    tournament_name: value.tournament_name,
    tournament_status: value.tournament_status,
    start_at: typeof value.start_at === 'string' ? value.start_at : null,
    end_at: typeof value.end_at === 'string' ? value.end_at : null,
    link: value.link,
  }
  if (typeof value.entrant_status === 'string') item.entrant_status = value.entrant_status
  if (typeof value.invited === 'boolean') item.invited = value.invited
  if (typeof value.clan_id === 'string') item.clan_id = value.clan_id
  if (typeof value.clan_name === 'string') item.clan_name = value.clan_name
  if (typeof value.clan_tag === 'string' || value.clan_tag === null) item.clan_tag = value.clan_tag
  if (typeof value.source_clan_roster_id === 'string' || value.source_clan_roster_id === null) {
    item.source_clan_roster_id = value.source_clan_roster_id
  }
  if (typeof value.source_clan_roster_name === 'string' || value.source_clan_roster_name === null) {
    item.source_clan_roster_name = value.source_clan_roster_name
  }
  if (typeof value.entry_scope === 'string') item.entry_scope = value.entry_scope
  return item
}

function normalizeTournamentHandoff(value: unknown): OnboardingTournamentHandoff {
  const raw = isRecord(value) ? value : {}
  const more = isRecord(raw.more) ? raw.more : {}
  const items = (key: string) => (Array.isArray(raw[key]) ? raw[key] : [])
    .map(normalizeTournamentItem)
    .filter((item): item is OnboardingTournamentItem => item !== null)
  return {
    clan_invitations: items('clan_invitations'),
    entries: items('entries'),
    open_tournaments: items('open_tournaments'),
    more: {
      clan_invitations: more.clan_invitations === true,
      entries: more.entries === true,
      open_tournaments: more.open_tournaments === true,
    },
  }
}

function normalizeDisputeParty(value: unknown): OnboardingDisputeParty | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null
  return {
    id: value.id,
    username: typeof value.username === 'string' ? value.username : null,
  }
}

function normalizeDispute(value: unknown): OnboardingDispute | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.subject_key !== 'string') return null
  if (value.kind !== 'youtube_channel' && value.kind !== 'clan') return null
  if (!['open', 'confirmed_current', 'transferred', 'rejected', 'cancelled'].includes(String(value.status))) return null
  if (value.viewer_role !== 'admin' && value.viewer_role !== 'current_owner' && value.viewer_role !== 'challenger') return null
  const challenger = normalizeDisputeParty(value.challenger)
  if (!challenger) return null
  const currentOwner = value.current_owner == null ? null : normalizeDisputeParty(value.current_owner)
  if (value.current_owner != null && !currentOwner) return null
  return {
    id: value.id,
    kind: value.kind,
    subject_key: value.subject_key,
    status: value.status as OnboardingDisputeStatus,
    freeze_state: asString(value.freeze_state),
    current_owner: currentOwner,
    challenger,
    evidence: isRecord(value.evidence) ? value.evidence : {},
    reviewer_id: typeof value.reviewer_id === 'string' ? value.reviewer_id : null,
    resolution_note: typeof value.resolution_note === 'string' ? value.resolution_note : null,
    resolved_at: typeof value.resolved_at === 'string' ? value.resolved_at : null,
    created_at: asString(value.created_at),
    updated_at: asString(value.updated_at),
    viewer_role: value.viewer_role,
    can_resolve: value.can_resolve === true,
  }
}

/**
 * Keep the UI resilient to a newly-created state returning sparse optional
 * fields, while still rejecting a response that is not an onboarding envelope.
 */
export function normalizeOnboardingEnvelope(value: unknown): OnboardingEnvelope | null {
  if (!isRecord(value) || !isRecord(value.state)) return null
  const rawState = value.state
  const actions = Array.isArray(value.actions) ? value.actions : []
  const suggestions = Array.isArray(value.suggestions) ? value.suggestions : []

  return {
    state: {
      status: normalizeStatus(rawState.status),
      current_step: asString(rawState.current_step, 'intro'),
      revision: Number.isFinite(Number(rawState.revision)) ? Number(rawState.revision) : 0,
      lane: normalizeLane(rawState.lane),
      roles: Array.isArray(rawState.roles)
        ? rawState.roles.filter((role): role is string => typeof role === 'string')
        : [],
      facts: isRecord(rawState.facts) ? rawState.facts : {},
      deferred_until: typeof rawState.deferred_until === 'string' ? rawState.deferred_until : null,
      completed_at: typeof rawState.completed_at === 'string' ? rawState.completed_at : null,
    },
    actions: actions.flatMap((raw): OnboardingAction[] => {
      if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.kind !== 'string') return []
      return [{
        id: raw.id,
        kind: raw.kind,
        status: normalizeActionStatus(raw.status),
        label: typeof raw.label === 'string' ? raw.label : undefined,
        payload: isRecord(raw.payload) ? raw.payload : {},
        result: raw.result,
        error: typeof raw.error === 'string' ? raw.error : null,
      }]
    }),
    tournaments: normalizeTournamentHandoff(value.tournaments),
    prompt: asString(value.prompt),
    suggestions: suggestions.filter((item): item is string => typeof item === 'string'),
  }
}

function errorText(body: unknown, fallback: string): { message: string; code: string | null } {
  if (!isRecord(body)) return { message: fallback, code: null }
  const rawError = body.error
  if (typeof rawError === 'string') {
    const detail = typeof body.detail === 'string' ? body.detail : rawError
    return { message: detail, code: rawError }
  }
  if (isRecord(rawError) && typeof rawError.message === 'string') {
    return { message: rawError.message, code: typeof rawError.code === 'string' ? rawError.code : null }
  }
  if (typeof body.message === 'string') return { message: body.message, code: null }
  return { message: fallback, code: null }
}

const DISPUTE_ERROR_MESSAGES: Record<string, string> = {
  ownership_dispute_not_found: 'This ownership claim no longer exists.',
  ownership_dispute_already_resolved: 'This ownership claim was already resolved. Reload Settings to see the latest result.',
  ownership_dispute_reviewer_required: 'You no longer have permission to resolve this ownership claim.',
  channel_ownership_changed: 'The channel ownership changed while you were reviewing it. Reload Settings and review the latest claim.',
  clan_ownership_changed: 'The clan ownership changed while you were reviewing it. Reload Settings and review the latest claim.',
  invalid_dispute_subject: 'This ownership claim cannot be resolved automatically.',
  unsupported_dispute_kind: 'This ownership claim cannot be resolved automatically.',
}

async function request(path: string, method = 'GET', body?: Record<string, unknown>): Promise<OnboardingEnvelope> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = currentAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    throw new OnboardingApiError(
      error instanceof Error ? error.message : 'Could not reach Ask TKO.',
      0,
      'network_error',
      null,
    )
  }

  let payload: unknown = null
  try {
    const text = await response.text()
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }

  // Accept a Supabase-style `{data: envelope}` wrapper as well as the Express
  // route's canonical raw envelope. This keeps previews on either backend.
  const candidate = isRecord(payload) && isRecord(payload.data) ? payload.data : payload
  const envelope = normalizeOnboardingEnvelope(candidate)
  if (!response.ok) {
    const details = errorText(payload, response.statusText || 'Ask TKO could not save that.')
    throw new OnboardingApiError(details.message, response.status, details.code, envelope)
  }
  if (!envelope) {
    throw new OnboardingApiError('Ask TKO returned an incomplete response.', response.status, 'invalid_response', null)
  }
  return envelope
}

async function disputeRequest(path: string, method = 'GET', body?: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = currentAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    throw new OnboardingApiError(
      error instanceof Error ? error.message : 'Could not reach ownership review.',
      0,
      'network_error',
      null,
    )
  }

  let payload: unknown = null
  try {
    const text = await response.text()
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  if (!response.ok) {
    const details = errorText(payload, response.statusText || 'Ownership review could not save that.')
    const message = details.code ? DISPUTE_ERROR_MESSAGES[details.code] || details.message : details.message
    throw new OnboardingApiError(message, response.status, details.code, null)
  }
  return payload
}

export function fetchOnboarding(): Promise<OnboardingEnvelope> {
  return request('/onboarding')
}

export function sendOnboardingTurn(text: string, revision: number): Promise<OnboardingEnvelope> {
  return request('/onboarding/turn', 'POST', { text, revision })
}

export function submitOnboardingVideo(url: string, revision: number): Promise<OnboardingEnvelope> {
  return request('/onboarding/video', 'POST', { url, revision })
}

export function confirmOnboardingAction(id: string, revision: number): Promise<OnboardingEnvelope> {
  return request(`/onboarding/actions/${encodeURIComponent(id)}/confirm`, 'POST', { revision })
}

export function confirmSelectedOnboardingActions(
  actionIds: string[],
  revision: number,
): Promise<OnboardingEnvelope> {
  return request('/onboarding/actions/confirm-selected', 'POST', { revision, action_ids: actionIds })
}

export function deferOnboarding(revision: number): Promise<OnboardingEnvelope> {
  return request('/onboarding/defer', 'POST', { revision })
}

export async function fetchOnboardingDisputes(): Promise<OnboardingDispute[]> {
  const payload = await disputeRequest('/onboarding/disputes')
  if (!isRecord(payload) || !Array.isArray(payload.disputes)) {
    throw new OnboardingApiError('Ownership review returned an incomplete response.', 200, 'invalid_response', null)
  }
  const disputes = payload.disputes.map(normalizeDispute)
  if (disputes.some((dispute) => dispute === null)) {
    throw new OnboardingApiError('Ownership review returned an incomplete response.', 200, 'invalid_response', null)
  }
  return disputes as OnboardingDispute[]
}

export async function resolveOnboardingDispute(
  id: string,
  decision: OnboardingDisputeDecision,
  note?: string,
): Promise<OnboardingDispute> {
  const trimmedNote = note?.trim()
  const body: Record<string, unknown> = { decision }
  if (trimmedNote) body.note = trimmedNote
  const payload = await disputeRequest(
    `/onboarding/disputes/${encodeURIComponent(id)}/resolve`,
    'POST',
    body,
  )
  const dispute = isRecord(payload) ? normalizeDispute(payload.dispute) : null
  if (!dispute) {
    throw new OnboardingApiError('Ownership review returned an incomplete response.', 200, 'invalid_response', null)
  }
  return dispute
}
