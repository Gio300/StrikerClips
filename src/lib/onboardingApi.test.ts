import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  confirmSelectedOnboardingActions,
  fetchOnboardingDisputes,
  fetchOnboarding,
  OnboardingApiError,
  resolveOnboardingDispute,
  sendOnboardingTurn,
} from './onboardingApi'

const envelope = {
  state: {
    status: 'active',
    current_step: 'identity',
    revision: 3,
    lane: 'leader',
    roles: ['leader'],
    facts: { gamer_tag: 'KyubiReign' },
  },
  actions: [],
  prompt: 'What is your clan called?',
  suggestions: ['Hidden Blood'],
}

const dispute = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind: 'youtube_channel',
  subject_key: 'UC123',
  status: 'open',
  freeze_state: 'future_writes',
  current_owner: { id: 'owner-1', username: 'CurrentOwner' },
  challenger: { id: 'challenger-1', username: 'ChannelChallenger' },
  evidence: {
    channel_title: 'Current channel',
    channel_url: 'https://www.youtube.com/channel/UC123',
    video_url: 'https://youtu.be/abcdefghijk',
  },
  reviewer_id: null,
  resolution_note: null,
  resolved_at: null,
  created_at: '2026-08-10T01:00:00.000Z',
  updated_at: '2026-08-10T01:00:00.000Z',
  viewer_role: 'current_owner',
  can_resolve: true,
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 409 ? 'Conflict' : 'OK',
    text: async () => JSON.stringify(body),
  } as Response
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => 'signed-token'),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  })
})

describe('onboarding API client', () => {
  it('loads durable setup state with the current auth token', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => response(envelope))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchOnboarding()).resolves.toMatchObject({
      state: { revision: 3, lane: 'leader' },
      prompt: 'What is your clan called?',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/onboarding', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
      headers: expect.objectContaining({ Authorization: 'Bearer signed-token' }),
    }))
  })

  it('normalizes read-only tournament handoff data and drops unsafe links', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => response({
      ...envelope,
      tournaments: {
        clan_invitations: [{
          id: 'invite-1', tournament_id: 'tournament-1', tournament_name: 'Clan Invitational',
          tournament_status: 'open', start_at: null, end_at: null,
          clan_id: 'clan-1', clan_name: 'Hidden Blood', link: '/tournaments/tournament-1?section=rosters',
        }],
        entries: [{
          id: 'bad', tournament_id: 'tournament-2', tournament_name: 'Unsafe',
          tournament_status: 'open', link: 'https://evil.example/',
        }],
        open_tournaments: [{
          id: 'tournament-3', tournament_id: 'tournament-3', tournament_name: 'Open Bracket',
          tournament_status: 'open', start_at: '2026-09-01T00:00:00.000Z', end_at: null,
          entry_scope: 'public', link: '/tournaments/tournament-3',
        }],
        more: { clan_invitations: false, entries: true, open_tournaments: false },
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchOnboarding()).resolves.toMatchObject({
      tournaments: {
        clan_invitations: [expect.objectContaining({ tournament_name: 'Clan Invitational' })],
        entries: [],
        open_tournaments: [expect.objectContaining({ tournament_name: 'Open Bracket', entry_scope: 'public' })],
        more: { entries: true },
      },
    })
  })

  it('sends natural text and the optimistic revision', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => response(envelope))
    vi.stubGlobal('fetch', fetchMock)

    await sendOnboardingTurn('I run Hidden Blood', 3)
    const turnInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(turnInit.body))).toEqual({
      text: 'I run Hidden Blood',
      revision: 3,
    })
  })

  it('sends only the changes the player selected', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => response(envelope))
    vi.stubGlobal('fetch', fetchMock)

    await confirmSelectedOnboardingActions(['profile-1', 'clan-1'], 4)
    const confirmInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(confirmInit.body))).toEqual({
      revision: 4,
      action_ids: ['profile-1', 'clan-1'],
    })
  })

  it('returns the server envelope with a revision conflict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'revision_conflict', ...envelope }, 409)))

    let caught: unknown
    try {
      await sendOnboardingTurn('another answer', 2)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(OnboardingApiError)
    expect(caught).toMatchObject({
      status: 409,
      code: 'revision_conflict',
      envelope: { state: { revision: 3 } },
    })
  })

  it('loads typed ownership disputes with the current auth token', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => response({ disputes: [dispute] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchOnboardingDisputes()).resolves.toEqual([dispute])
    expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/disputes', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
      headers: expect.objectContaining({ Authorization: 'Bearer signed-token' }),
    }))
  })

  it('resolves an ownership dispute with the selected decision and optional note', async () => {
    const resolved = {
      ...dispute,
      status: 'transferred',
      can_resolve: false,
      resolution_note: 'The submitted video confirms the channel.',
      resolved_at: '2026-08-10T02:00:00.000Z',
    }
    const fetchMock = vi.fn(async (..._args: unknown[]) => response({ dispute: resolved }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveOnboardingDispute(
      dispute.id,
      'approve',
      '  The submitted video confirms the channel.  ',
    )).resolves.toEqual(resolved)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/onboarding/disputes/${dispute.id}/resolve`,
      expect.objectContaining({ method: 'POST' }),
    )
    const resolveInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(resolveInit.body))).toEqual({
      decision: 'approve',
      note: 'The submitted video confirms the channel.',
    })
  })

  it('turns dispute conflict codes into actionable client errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'ownership_dispute_already_resolved' }, 409)))

    await expect(resolveOnboardingDispute(dispute.id, 'reject')).rejects.toMatchObject({
      status: 409,
      code: 'ownership_dispute_already_resolved',
      message: 'This ownership claim was already resolved. Reload Settings to see the latest result.',
    })
  })
})
