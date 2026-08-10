import { MemoryRouter, Route, Routes } from 'react-router-dom'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingHomeGate, onboardingNeedsSetup } from './OnboardingHomeGate'

const fetchSetup = vi.fn()

vi.mock('@/lib/onboardingApi', () => ({
  fetchOnboarding: (...args: unknown[]) => fetchSetup(...args),
}))

const mounted: TestRenderer.ReactTestRenderer[] = []

async function mount() {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={(
            <OnboardingHomeGate userId="player-1">
              <div>MEMBER_HOME</div>
            </OnboardingHomeGate>
          )} />
          <Route path="/setup" element={<div>SETUP_SCREEN</div>} />
        </Routes>
      </MemoryRouter>,
    )
    await Promise.resolve()
  })
  mounted.push(renderer)
  return renderer
}

function body(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root.findAllByType('div')
    .flatMap((node) => node.children.filter((child): child is string => typeof child === 'string'))
    .join(' ')
}

beforeEach(() => {
  fetchSetup.mockReset()
})
afterEach(async () => {
  await act(async () => mounted.splice(0).forEach((renderer) => renderer.unmount()))
})

describe('post-auth onboarding home gate', () => {
  it('routes unfinished accounts to setup', async () => {
    fetchSetup.mockResolvedValue({ state: { status: 'active' } })
    const renderer = await mount()
    expect(body(renderer)).toContain('SETUP_SCREEN')
    expect(body(renderer)).not.toContain('MEMBER_HOME')
  })

  it.each(['deferred', 'complete'] as const)('lets %s accounts enter home', async (status) => {
    fetchSetup.mockResolvedValue({ state: { status } })
    const renderer = await mount()
    expect(body(renderer)).toContain('MEMBER_HOME')
  })

  it('fails open to home when the onboarding endpoint is unavailable', async () => {
    fetchSetup.mockRejectedValue(new Error('offline'))
    const renderer = await mount()
    expect(body(renderer)).toContain('MEMBER_HOME')
  })

  it('only gates unfinished server states', () => {
    expect(onboardingNeedsSetup('new')).toBe(true)
    expect(onboardingNeedsSetup('active')).toBe(true)
    expect(onboardingNeedsSetup('ready')).toBe(true)
    expect(onboardingNeedsSetup('deferred')).toBe(false)
    expect(onboardingNeedsSetup('complete')).toBe(false)
  })
})
