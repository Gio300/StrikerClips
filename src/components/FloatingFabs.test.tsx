import { MemoryRouter } from 'react-router-dom'
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandBar } from '@/components/CommandBar'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from() {
      const builder: Record<string, unknown> = {
        select() { return builder },
        eq() { return builder },
        in() { return builder },
        is() { return builder },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject)
        },
      }
      return builder
    },
    functions: { invoke: async () => ({ data: null }) },
  },
}))

let currentUser: { id: string; user_metadata: Record<string, unknown> } | null = null
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: currentUser, profile: { power_level: 7_400 }, loading: false }),
}))

class FakeEvents {
  private readonly listeners = new Map<string, Set<() => void>>()
  addEventListener(type: string, fn: () => void) {
    const set = this.listeners.get(type) ?? new Set<() => void>()
    set.add(fn)
    this.listeners.set(type, set)
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn)
  }
}

const mounted: TestRenderer.ReactTestRenderer[] = []

async function mount(path = '/') {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      <MemoryRouter initialEntries={[path]}><CommandBar /></MemoryRouter>,
    )
    await Promise.resolve()
  })
  mounted.push(renderer)
  return renderer
}

function classOf(node: ReactTestInstance): string {
  return String((node.props as { className?: string }).className ?? '')
}

beforeEach(() => {
  currentUser = { id: 'me', user_metadata: {} }
  vi.stubGlobal('document', Object.assign(new FakeEvents(), {
    visibilityState: 'visible',
    body: { style: {} },
  }))
  // The unread chat hook polls, so the fake window has to carry timers.
  vi.stubGlobal('window', Object.assign(new FakeEvents(), {
    location: { pathname: '/' },
    setInterval: (fn: TimerHandler, ms?: number) => setInterval(fn, ms),
    clearInterval: (id: unknown) => clearInterval(id as ReturnType<typeof setInterval>),
    setTimeout: (fn: TimerHandler, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
  }))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  await act(async () => {
    for (const renderer of mounted.splice(0)) renderer.unmount()
  })
  vi.unstubAllGlobals()
})

describe('the one floating chat entry', () => {
  it('renders one icon-only inbox link and none of the retired rail actions', async () => {
    const renderer = await mount('/')
    const links = renderer.root.findAllByType('a')
    expect(links).toHaveLength(1)
    expect(links[0].props.href).toBe('/messages')
    expect(links[0].props['aria-label']).toBe('Open chats')
    expect(links[0].findAllByType('span')).toHaveLength(0)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Ask TKO')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Go live')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('/profile')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('/chat')
  })

  it('owns the bottom-right dock at a stable icon-button size', async () => {
    const renderer = await mount('/')
    const link = renderer.root.findByType('a')
    const classes = classOf(link)
    expect(classes).toContain('fixed')
    expect(classes).toContain('bottom-[var(--tko-chat-fab-bottom)]')
    expect(classes).toContain('h-14')
    expect(classes).toContain('w-14')
    expect(classes).toContain('rounded-full')
  })

  it('does not cover the inbox composer while the inbox is open', async () => {
    expect((await mount('/messages')).toJSON()).toBeNull()
  })

  it('renders nothing while signed out', async () => {
    currentUser = null
    expect((await mount('/')).toJSON()).toBeNull()
  })
})
