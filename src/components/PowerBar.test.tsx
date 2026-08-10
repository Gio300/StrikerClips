import { MemoryRouter } from 'react-router-dom'
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PowerBar } from '@/components/PowerBar'

/**
 * THE TOP BANNER CARRIES IDENTITY, NOT THE GO-LIVE CONTROL.
 *
 * GO LIVE briefly lived here, and paying for it cost the player's earned rank on
 * anything under 640px. Live controls now stay in the Live area. What this file
 * pins is the consequence: with the go-live pill gone the bar has room, so rank is
 * EVERY width, the bell still cannot be pushed off the edge, and nothing in the
 * bar reaches for the live-state read any more.
 */

// ── The backend, as the bar's hooks see it ─────────────────────────────────
interface Read {
  table: string
  columns: string
  filters: [string, unknown][]
  head: boolean
}

const reads: Read[] = []
let unreadCount = 0

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const read: Read = { table, columns: '', filters: [], head: false }
      const answer = () => {
        reads.push(read)
        if (read.table === 'notifications') return { data: null, error: null, count: unreadCount }
        return { data: [], error: null, count: null }
      }
      const builder: Record<string, unknown> = {
        select(columns: string, opts?: { head?: boolean }) {
          read.columns = columns
          read.head = Boolean(opts?.head)
          return builder
        },
        eq(col: string, val: unknown) { read.filters.push([col, val]); return builder },
        is(col: string, val: unknown) { read.filters.push([col, val]); return builder },
        order() { return builder },
        limit() { return builder },
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          return Promise.resolve(answer()).then(resolve, reject)
        },
      }
      return builder
    },
  },
}))

// ── The signed-in user, as every hook in the bar sees it ───────────────────
let currentUser: { id: string; user_metadata: Record<string, unknown> } | null = null

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: currentUser, profile: { power_level: 7_400 }, loading: false }),
}))

// Tier resolution is its own unit-tested module (lib/entitlements); the bar only
// needs an answer, so this seam is stubbed rather than re-derived.
vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({ tier: 'creator', isPremium: true }),
}))

// ── The browser the hooks poll against ─────────────────────────────────────
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

async function mount() {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      <MemoryRouter>
        <PowerBar />
      </MemoryRouter>,
    )
  })
  // Let the unread-count read resolve before anything is asserted.
  await act(async () => { await Promise.resolve() })
  mounted.push(renderer)
  return renderer
}

/** Every rendered anchor, with its href and its flattened visible text. */
function links(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAllByType('a').map((node) => ({
    node,
    href: String((node.props as { href?: string }).href ?? ''),
    label: String((node.props as { 'aria-label'?: string })['aria-label'] ?? ''),
    className: String((node.props as { className?: string }).className ?? ''),
    text: text(node),
  }))
}

/** Everything a person would read inside `node`, in order. */
function text(node: ReactTestInstance): string {
  const out: string[] = []
  const walk = (n: ReactTestInstance | string) => {
    if (typeof n === 'string') { out.push(n); return }
    for (const child of n.children) walk(child as ReactTestInstance | string)
  }
  walk(node)
  return out.join(' ')
}

const classOf = (node: ReactTestInstance) => String((node.props as { className?: string }).className ?? '')

const bell = (renderer: TestRenderer.ReactTestRenderer) =>
  links(renderer).find((l) => l.href.includes('/notifications'))

beforeEach(() => {
  reads.length = 0
  unreadCount = 0
  currentUser = { id: 'me', user_metadata: {} }
  vi.stubGlobal('document', Object.assign(new FakeEvents(), { visibilityState: 'visible' }))
  vi.stubGlobal('window', Object.assign(new FakeEvents(), { location: { pathname: '/' } }))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  await act(async () => {
    for (const renderer of mounted.splice(0)) renderer.unmount()
  })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PowerBar — the go-live control moved out', () => {
  it('carries no go-live door of its own any more', async () => {
    const renderer = await mount()
    expect(links(renderer).some((l) => l.href.includes('do=golive'))).toBe(false)
  })

  it('stops paying for the live-state poll it no longer reads', async () => {
    await mount()
    expect(reads.some((r) => r.table === 'live_streams')).toBe(false)
  })
})

describe('PowerBar — every width', () => {
  it('gives the earned-rank word back at 360px, now that GO LIVE is gone', async () => {
    const renderer = await mount()
    // Parents come first out of findAllByType, so the LAST match is the block
    // that actually wraps the rank — not the whole bar around it.
    // 7,400 power = "Challenger".
    const rankBlocks = renderer.root
      .findAllByType('div')
      .filter((n) => text(n).includes('Challenger'))
    expect(rankBlocks.length).toBeGreaterThan(0)
    const cls = classOf(rankBlocks[rankBlocks.length - 1])
    expect(cls).not.toMatch(/\bhidden\b/)
  })

  it('never lets the bell be squeezed out', async () => {
    const renderer = await mount()
    expect(bell(renderer)!.className).not.toMatch(/\bhidden\b/)
  })

  it('keeps the power level and the membership tier on a phone', async () => {
    const renderer = await mount()
    const tierPill = renderer.root
      .findAllByType('span')
      .find((n) => text(n).trim() === 'Legend')
    expect(tierPill).toBeTruthy()
    expect(classOf(tierPill!)).not.toMatch(/\bhidden\b/)
    expect(text(renderer.root)).toContain('7,400')
  })
})

describe('PowerBar — signed out', () => {
  it('renders nothing: the whole strip belongs to a signed-in user', async () => {
    currentUser = null
    const renderer = await mount()
    expect(renderer.toJSON()).toBeNull()
  })
})
