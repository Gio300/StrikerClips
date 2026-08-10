import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageUnread } from './useMessageUnread'

const queryCalls = vi.hoisted(() => ({
  select: [] as unknown[][],
  kinds: [] as string[][],
}))
const authState = vi.hoisted(() => ({ user: { id: 'player-1' } }))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => authState,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from() {
      const builder: Record<string, unknown> = {
        select(...args: unknown[]) { queryCalls.select.push(args); return builder },
        eq() { return builder },
        in(_column: string, values: string[]) { queryCalls.kinds.push(values); return builder },
        is() { return builder },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve({ count: 37, data: null, error: null }).then(resolve, reject)
        },
      }
      return builder
    },
  },
}))

function Probe() {
  const { count } = useMessageUnread()
  return <span>{count}</span>
}

beforeEach(() => {
  queryCalls.select.length = 0
  queryCalls.kinds.length = 0
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

describe('useMessageUnread', () => {
  it('asks the database for one filtered count instead of downloading unread rows', async () => {
    let renderer!: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(<Probe />)
      await Promise.resolve()
    })

    expect(queryCalls.select).toEqual([['id', { count: 'exact', head: true }]])
    expect(queryCalls.kinds).toEqual([['direct_message', 'group_message']])
    expect(renderer.root.findByType('span').children.join('')).toBe('37')

    await act(async () => { renderer.unmount() })
  })
})
