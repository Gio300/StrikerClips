import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UnreadNotificationsProvider,
  useUnreadNotifications,
} from './useUnreadNotifications'

let reads = 0
const authState = vi.hoisted(() => ({ user: { id: 'player-1' }, loading: false }))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authState,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from() {
      const builder: Record<string, unknown> = {
        select() { return builder },
        eq() { return builder },
        is() { return builder },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          reads += 1
          return Promise.resolve({ count: 4, data: null, error: null }).then(resolve, reject)
        },
      }
      return builder
    },
  },
}))

function Probe() {
  const { count } = useUnreadNotifications()
  return <span>{count}</span>
}

beforeEach(() => {
  reads = 0
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UnreadNotificationsProvider', () => {
  it('shares one backend read across every mounted navigation badge', async () => {
    let renderer!: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(
        <UnreadNotificationsProvider>
          <Probe />
          <Probe />
          <Probe />
        </UnreadNotificationsProvider>,
      )
      await Promise.resolve()
    })

    expect(reads).toBe(1)
    expect(renderer.root.findAllByType('span').map((node) => node.children.join(''))).toEqual(['4', '4', '4'])

    await act(async () => { renderer.unmount() })
  })
})
