import { MemoryRouter, Route, Routes } from 'react-router-dom'
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Setup } from './Setup'
import { OnboardingApiError, type OnboardingEnvelope } from '@/lib/onboardingApi'

const fetchSetup = vi.fn()
const sendTurn = vi.fn()
const submitVideo = vi.fn()
const defer = vi.fn()
const refreshUser = vi.fn()
let voiceFinal: ((text: string) => void) | null = null
let display = { isSsl: false, productName: 'TKO', assistantName: 'Ask TKO' }

vi.mock('@/lib/onboardingApi', () => {
  class TestOnboardingApiError extends Error {
    status: number
    code: string | null
    envelope: unknown

    constructor(message: string, status: number, code: string | null, envelope: unknown) {
      super(message)
      this.status = status
      this.code = code
      this.envelope = envelope
    }
  }
  return {
    fetchOnboarding: (...args: unknown[]) => fetchSetup(...args),
    sendOnboardingTurn: (...args: unknown[]) => sendTurn(...args),
    submitOnboardingVideo: (...args: unknown[]) => submitVideo(...args),
    deferOnboarding: (...args: unknown[]) => defer(...args),
    OnboardingApiError: TestOnboardingApiError,
  }
})

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'player-1' }, refreshUser, loading: false }),
}))

vi.mock('@/components/LeagueThemeProvider', () => ({
  useLeagueTheme: () => ({ display }),
}))

vi.mock('@/hooks/useVoiceCommands', () => ({
  useVoiceCommands: (onFinal: (text: string) => void) => {
    voiceFinal = onFinal
    return { supported: true, listening: false, interim: '', start: vi.fn(), stop: vi.fn() }
  },
}))

vi.mock('@/components/BrandLogo', () => ({ BrandLogo: () => <div>Powered by TKO.cam</div> }))

const noTournaments = {
  clan_invitations: [],
  entries: [],
  open_tournaments: [],
  more: { clan_invitations: false, entries: false, open_tournaments: false },
}

const intro: OnboardingEnvelope = {
  state: {
    status: 'new',
    current_step: 'intro',
    revision: 0,
    lane: null,
    roles: [],
    facts: {},
  },
  actions: [],
  tournaments: noTournaments,
  prompt: 'Tell me your gamer tag and whether you play solo or with a clan.',
  suggestions: ['Play solo', 'I run a clan'],
}

const clanComplete: OnboardingEnvelope = {
  state: {
    status: 'complete',
    current_step: 'complete',
    revision: 1,
    lane: 'leader',
    roles: ['leader'],
    facts: {
      gamer_tag: 'KyubiReign',
      clan_name: 'Hidden Blood',
      clan_id: 'clan-1',
      clan_claim_status: 'owned',
    },
  },
  actions: [
    {
      id: 'identity-1',
      kind: 'update_identity',
      status: 'done',
      label: 'Save gamer tag',
      payload: {},
      result: { game_tag: 'KyubiReign' },
    },
    {
      id: 'clan-1',
      kind: 'create_clan',
      status: 'done',
      label: 'Create Hidden Blood [HB]',
      payload: {},
      result: { status: 'owned', server_id: 'clan-1', name: 'Hidden Blood' },
    },
    {
      id: 'roster-1',
      kind: 'create_roster',
      status: 'done',
      label: 'Create [HB] Main roster',
      payload: {},
      result: { roster_id: 'roster-1', server_id: 'clan-1', name: '[HB] Main' },
    },
  ],
  tournaments: noTournaments,
  prompt: 'Hidden Blood and its main roster are ready.',
  suggestions: [],
}

const pendingApplication: OnboardingEnvelope = {
  state: {
    status: 'complete',
    current_step: 'complete',
    revision: 2,
    lane: 'member',
    roles: ['member'],
    facts: {
      gamer_tag: 'Sage',
      clan_name: 'Hidden Blood',
      clan_id: 'clan-1',
      clan_application_status: 'pending',
    },
  },
  actions: [{
    id: 'application-1',
    kind: 'apply_clan',
    status: 'done',
    label: 'Apply to Hidden Blood',
    payload: { server_id: 'clan-1' },
    result: { status: 'pending', server_id: 'clan-1', application_id: 'application-1' },
  }],
  tournaments: noTournaments,
  prompt: 'I sent your application to Hidden Blood.',
  suggestions: [],
}

const disputedClaim: OnboardingEnvelope = {
  state: {
    status: 'complete',
    current_step: 'complete',
    revision: 3,
    lane: 'leader',
    roles: ['leader'],
    facts: {
      gamer_tag: 'Claimant',
      clan_name: 'Hidden Blood',
      clan_id: 'clan-1',
      clan_claim_status: 'disputed',
    },
  },
  actions: [{
    id: 'claim-1',
    kind: 'claim_clan',
    status: 'done',
    label: 'Claim Hidden Blood',
    payload: { server_id: 'clan-1' },
    result: { status: 'disputed', server_id: 'clan-1', dispute_id: 'dispute-1' },
  }],
  tournaments: noTournaments,
  prompt: 'That clan already has an owner, so I opened a review.',
  suggestions: [],
}

const legacyReady: OnboardingEnvelope = {
  state: {
    status: 'ready',
    current_step: 'review',
    revision: 4,
    lane: 'solo',
    roles: ['solo'],
    facts: { gamer_tag: 'SoloPlayer' },
  },
  actions: [{
    id: 'youtube-1',
    kind: 'connect_youtube',
    status: 'proposed',
    label: 'Connect KyubiReign YouTube',
    payload: {},
  }],
  tournaments: noTournaments,
  prompt: 'Confirm the changes you want me to make.',
  suggestions: ['Confirm selected', 'Change something'],
}

const mounted: TestRenderer.ReactTestRenderer[] = []

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : text(child as ReactTestInstance)).join(' ')
}

function button(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const found = renderer.root.findAllByType('button').find((candidate) => text(candidate).includes(label))
  if (!found) throw new Error(`No button containing ${label}`)
  return found
}

async function mount(path = '/setup') {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route path="/return" element={<div>RETURNED_TO_APP</div>} />
        </Routes>
      </MemoryRouter>,
    )
    await Promise.resolve()
  })
  mounted.push(renderer)
  return renderer
}

async function send(renderer: TestRenderer.ReactTestRenderer, value: string) {
  const composer = renderer.root.findByType('textarea')
  await act(async () => composer.props.onChange({ target: { value } }))
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
}

beforeEach(() => {
  display = { isSsl: false, productName: 'TKO', assistantName: 'Ask TKO' }
  fetchSetup.mockReset().mockResolvedValue(intro)
  sendTurn.mockReset().mockResolvedValue(clanComplete)
  submitVideo.mockReset().mockResolvedValue(legacyReady)
  defer.mockReset().mockResolvedValue({ ...intro, state: { ...intro.state, status: 'deferred', revision: 1 } })
  refreshUser.mockReset().mockResolvedValue(undefined)
  voiceFinal = null
  const values = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  await act(async () => {
    for (const renderer of mounted.splice(0)) renderer.unmount()
  })
  vi.unstubAllGlobals()
})

describe('natural chat setup', () => {
  it('shows one conversation composer without progress, fact, suggestion, or action-review controls', async () => {
    const renderer = await mount()
    const pageText = text(renderer.root)

    expect(pageText).toContain('Tell me your gamer tag')
    expect(renderer.root.findAllByType('textarea')).toHaveLength(1)
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
    expect(renderer.root.findAllByProps({ role: 'progressbar' })).toHaveLength(0)
    expect(pageText).not.toContain('Play solo')
    expect(pageText).not.toContain('What I have so far')
    expect(pageText).not.toContain('Review changes')
    expect(pageText).not.toContain('Confirm selected')
  })

  it('sends one natural statement and immediately shows the completed clan and roster outcome', async () => {
    const renderer = await mount()
    await send(renderer, "I'm KyubiReign and I run Hidden Blood.")

    expect(sendTurn).toHaveBeenCalledWith("I'm KyubiReign and I run Hidden Blood.", 0)
    expect(text(renderer.root)).toContain('Clan created and connected')
    expect(text(renderer.root)).toContain('Clan roster ready')
    expect(text(renderer.root)).toContain('[HB] Main is saved with you as captain')
    expect(text(renderer.root)).not.toContain('Confirm selected')
    expect(renderer.root.findAllByType('textarea')).toHaveLength(1)
  })

  it('reports a clan application as pending instead of pretending the player is a member', async () => {
    sendTurn.mockResolvedValue(pendingApplication)
    const renderer = await mount()
    await send(renderer, "I'm Sage and I'm in Hidden Blood.")

    const pageText = text(renderer.root)
    expect(pageText).toContain('Clan application sent')
    expect(pageText).toContain('A clan leader must approve it before you become a member')
    expect(pageText).not.toContain('Clan application approved')
    expect(renderer.root.findAllByType('a').map((link) => link.props.href)).toContain('/boards/clan-1')
  })

  it('protects an existing owner and reports a conflicting ownership claim as under review', async () => {
    sendTurn.mockResolvedValue(disputedClaim)
    const renderer = await mount()
    await send(renderer, 'I own Hidden Blood. My tag is Claimant.')

    const pageText = text(renderer.root)
    expect(pageText).toContain('Clan ownership is under review')
    expect(pageText).toContain('The current owner and clan data stay protected')
    expect(pageText).not.toContain('Clan created and connected')
    expect(renderer.root.findAllByType('a').map((link) => link.props.href)).toContain('/settings')
  })

  it('routes a pasted YouTube link through the dedicated video endpoint without adding another form', async () => {
    const renderer = await mount()
    await send(renderer, 'Here: https://youtu.be/abcdefghijk')

    expect(submitVideo).toHaveBeenCalledWith('https://youtu.be/abcdefghijk', 0)
    expect(sendTurn).not.toHaveBeenCalled()
    expect(renderer.root.findAllByType('textarea')).toHaveLength(1)
  })

  it('keeps a clan-name prompt as ordinary natural chat even when an old step says video', async () => {
    fetchSetup.mockResolvedValue({
      ...intro,
      state: {
        ...intro.state,
        status: 'active',
        current_step: 'video',
        revision: 3,
        lane: 'member',
        roles: ['member'],
        facts: { gamer_tag: 'ClanStepPlayer' },
      },
      prompt: "What's your clan's exact name or tag?",
    })
    const renderer = await mount()

    expect(text(renderer.root)).toContain("What's your clan's exact name or tag?")
    expect(renderer.root.findByType('textarea').props.placeholder).toBe('Type or speak naturally...')
    expect(renderer.root.findAllByType('a').some((link) => text(link).includes('gameplay video'))).toBe(false)
  })

  it('keeps microphone text editable and never auto-sends it', async () => {
    const renderer = await mount()
    await act(async () => voiceFinal?.('Kyubi Reign'))

    expect(renderer.root.findByType('textarea').props.value).toBe('Kyubi Reign')
    expect(sendTurn).not.toHaveBeenCalled()
    await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'KyubiReign' } }))
    expect(renderer.root.findByType('textarea').props.value).toBe('KyubiReign')
  })

  it('keeps the chat available after completion so corrections are also natural statements', async () => {
    fetchSetup.mockResolvedValue(clanComplete)
    sendTurn.mockResolvedValue({
      ...clanComplete,
      state: { ...clanComplete.state, revision: 2 },
      prompt: 'I changed the clan name.',
    })
    const renderer = await mount()
    await send(renderer, 'Change my clan name to Hidden Mist.')

    expect(sendTurn).toHaveBeenCalledWith('Change my clan name to Hidden Mist.', 1)
    expect(renderer.root.findAllByType('textarea')).toHaveLength(1)
  })

  it('hides legacy proposed actions and their suggestion chips instead of recreating a JSON checklist', async () => {
    fetchSetup.mockResolvedValue(legacyReady)
    const renderer = await mount()
    const pageText = text(renderer.root)

    expect(pageText).toContain('Your basic TKO setup is ready')
    expect(pageText).not.toContain('Connect KyubiReign YouTube')
    expect(pageText).not.toContain('Confirm selected')
    expect(pageText).not.toContain('Change something')
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
    expect(pageText).toContain('Continue to TKO')
  })

  it('shows the server clarification for a proposed ownership claim without adding a confirm button', async () => {
    fetchSetup.mockResolvedValue({
      ...intro,
      state: {
        ...intro.state,
        status: 'active',
        current_step: 'clan',
        revision: 1,
        lane: 'leader',
        roles: ['leader'],
        facts: { gamer_tag: 'Claimant', clan_name: 'Hidden Blood' },
      },
      actions: [{
        id: 'claim-1',
        kind: 'claim_clan',
        status: 'proposed',
        label: 'Claim Hidden Blood',
        payload: { server_id: 'clan-1' },
      }],
      prompt: 'That clan already has an owner. Tell me clearly if you want to open an ownership review.',
    })
    const renderer = await mount()
    const pageText = text(renderer.root)

    expect(pageText).toContain('Tell me clearly if you want to open an ownership review')
    expect(pageText).not.toContain('Claim Hidden Blood')
    expect(pageText).not.toContain('Confirm')
  })

  it('does not opt a player into following clanmates from a proposed action', async () => {
    fetchSetup.mockResolvedValue({
      ...clanComplete,
      actions: [
        ...clanComplete.actions,
        {
          id: 'follow-1',
          kind: 'follow_clanmates',
          status: 'proposed',
          label: 'Follow 24 Hidden Blood clanmates',
          payload: { server_id: 'clan-1' },
        },
      ],
    })
    const renderer = await mount()

    expect(text(renderer.root)).not.toContain('Follow 24 Hidden Blood clanmates')
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
  })

  it('shows a concise outcome when a clan write fails without claiming it succeeded', async () => {
    fetchSetup.mockResolvedValue({
      ...intro,
      state: { ...intro.state, status: 'active', lane: 'member', revision: 1 },
      actions: [{
        id: 'failed-1',
        kind: 'apply_clan',
        status: 'failed',
        label: 'Apply to Hidden Blood',
        payload: {},
        error: 'That clan could not be found.',
      }],
      prompt: 'Tell me the exact clan name or tag.',
    })
    const renderer = await mount()

    expect(text(renderer.root)).toContain('I could not finish the clan connection')
    expect(text(renderer.root)).toContain('That clan could not be found.')
    expect(text(renderer.root)).not.toContain('Clan application sent')
  })

  it('reloads fresh server state after a cross-tab revision conflict', async () => {
    sendTurn.mockRejectedValue(new OnboardingApiError(
      'revision conflict',
      409,
      'revision_conflict',
      pendingApplication,
    ))
    const renderer = await mount()
    await send(renderer, 'I am in Hidden Blood')

    expect(text(renderer.root)).toContain('Clan application sent')
    expect(text(renderer.root)).toContain('changed in another tab')
  })

  it('continues directly after a completed setup without deferring it', async () => {
    fetchSetup.mockResolvedValue(clanComplete)
    const renderer = await mount('/setup?returnTo=%2Freturn')
    await act(async () => button(renderer, 'Continue to TKO').props.onClick())

    expect(defer).not.toHaveBeenCalled()
    expect(text(renderer.root)).toContain('RETURNED_TO_APP')
  })

  it('renders SSL names while retaining the permitted powered-by attribution', async () => {
    display = { isSsl: true, productName: 'SSL', assistantName: 'Ask SSL' }
    fetchSetup.mockResolvedValue(clanComplete)
    const renderer = await mount()
    const pageText = text(renderer.root)

    expect(pageText).toContain('Ask SSL')
    expect(pageText).toContain('Continue to SSL')
    expect(pageText).not.toContain('Ask TKO')
    expect(pageText).toContain('Powered by TKO.cam')
  })

  it('keeps Not now discreet but persists the deferral before returning', async () => {
    const renderer = await mount('/setup?returnTo=%2Freturn')
    await act(async () => button(renderer, 'Not now').props.onClick())

    expect(defer).toHaveBeenCalledWith(0)
    expect(text(renderer.root)).toContain('RETURNED_TO_APP')
  })
})
