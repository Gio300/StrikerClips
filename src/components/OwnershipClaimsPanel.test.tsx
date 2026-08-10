import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OwnershipClaimsPanel } from './OwnershipClaimsPanel'

const apiMocks = vi.hoisted(() => ({
  fetchOnboardingDisputes: vi.fn(),
  resolveOnboardingDispute: vi.fn(),
}))

vi.mock('@/lib/onboardingApi', () => ({
  fetchOnboardingDisputes: apiMocks.fetchOnboardingDisputes,
  resolveOnboardingDispute: apiMocks.resolveOnboardingDispute,
}))

const baseDispute = {
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

const mounted: TestRenderer.ReactTestRenderer[] = []
const confirmDecision = vi.fn()

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : text(child as ReactTestInstance)).join(' ')
}

function button(renderer: TestRenderer.ReactTestRenderer, label: string): ReactTestInstance {
  const found = renderer.root.findAllByType('button').find((candidate) => text(candidate).includes(label))
  if (!found) throw new Error(`No button containing ${label}`)
  return found
}

async function mount() {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(<OwnershipClaimsPanel productName="SSL" />)
    await Promise.resolve()
    await Promise.resolve()
  })
  mounted.push(renderer)
  return renderer
}

beforeEach(() => {
  apiMocks.fetchOnboardingDisputes.mockReset().mockResolvedValue([])
  apiMocks.resolveOnboardingDispute.mockReset()
  confirmDecision.mockReset().mockReturnValue(true)
  vi.stubGlobal('confirm', confirmDecision)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  await act(async () => {
    for (const renderer of mounted.splice(0)) renderer.unmount()
  })
  vi.unstubAllGlobals()
})

describe('ownership claims settings panel', () => {
  it('lets a host approve a transfer only after an explicit consequence confirmation', async () => {
    const hostDispute = { ...baseDispute, viewer_role: 'admin', can_resolve: true }
    const transferred = {
      ...hostDispute,
      status: 'transferred',
      can_resolve: false,
      resolved_at: '2026-08-10T02:00:00.000Z',
    }
    apiMocks.fetchOnboardingDisputes.mockResolvedValue([hostDispute])
    apiMocks.resolveOnboardingDispute.mockResolvedValue(transferred)
    const renderer = await mount()

    expect(text(renderer.root)).toContain('Review YouTube and clan ownership claims connected to')
    expect(text(renderer.root)).toContain('SSL')
    expect(text(renderer.root)).toContain('Needs your review')
    await act(async () => {
      button(renderer, 'Approve transfer').props.onClick()
      await Promise.resolve()
    })

    expect(confirmDecision).toHaveBeenCalledWith(expect.stringContaining('removed from @CurrentOwner and assigned to @ChannelChallenger'))
    expect(confirmDecision).toHaveBeenCalledWith(expect.stringContaining('in SSL'))
    expect(apiMocks.resolveOnboardingDispute).toHaveBeenCalledWith(hostDispute.id, 'approve')
    expect(text(renderer.root)).toContain('Approved')
    expect(renderer.root.findAllByType('button')).toHaveLength(0)
  })

  it('lets the current owner reject while confirming that no ownership transfers', async () => {
    const clanDispute = {
      ...baseDispute,
      kind: 'clan',
      evidence: { name: 'Hidden Mist', clan_tag: 'HM' },
    }
    const rejected = {
      ...clanDispute,
      status: 'rejected',
      can_resolve: false,
      resolution_note: 'This remains with the current clan leader.',
    }
    apiMocks.fetchOnboardingDisputes.mockResolvedValue([clanDispute])
    apiMocks.resolveOnboardingDispute.mockResolvedValue(rejected)
    const renderer = await mount()

    await act(async () => {
      button(renderer, 'Keep current ownership').props.onClick()
      await Promise.resolve()
    })

    expect(confirmDecision).toHaveBeenCalledWith(expect.stringContaining('No ownership will transfer.'))
    expect(apiMocks.resolveOnboardingDispute).toHaveBeenCalledWith(clanDispute.id, 'reject')
    expect(text(renderer.root)).toContain('Rejected')
    expect(text(renderer.root)).toContain('Review note:')
  })

  it('shows challenger pending, approved, and rejected states without review controls', async () => {
    apiMocks.fetchOnboardingDisputes.mockResolvedValue([
      { ...baseDispute, id: 'open', viewer_role: 'challenger', can_resolve: false },
      { ...baseDispute, id: 'approved', status: 'transferred', viewer_role: 'challenger', can_resolve: false },
      { ...baseDispute, id: 'rejected', status: 'rejected', viewer_role: 'challenger', can_resolve: false },
    ])
    const renderer = await mount()
    const rendered = text(renderer.root)

    expect(rendered).toContain('Pending review')
    expect(rendered).toContain('Approved')
    expect(rendered).toContain('Rejected')
    expect(renderer.root.findAllByType('button')).toHaveLength(0)
    expect(apiMocks.resolveOnboardingDispute).not.toHaveBeenCalled()
  })
})
