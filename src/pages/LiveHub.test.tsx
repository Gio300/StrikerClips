import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveHub } from '@/pages/LiveHub'

const GO_LIVE_TO = '/live?do=golive'

/**
 * THE GO-LIVE DOOR HAS TO OPEN WHILE /live IS ALREADY MOUNTED.
 *
 * Operator, 2026-08-07, on the floating GO LIVE button: "doesn't appear to
 * work.. should just take the person to the live area so they can go".
 *
 * The deep link points at the one door, `/live?do=golive`, and starts nothing
 * itself. LiveHub was: it seeded its screen from
 * the query with `useState(() => screenFromParams(params))`, and a lazy
 * initializer runs ONCE PER MOUNT. `/live` and `/live?do=golive` are the same
 * <Route>, so a tap made while the Live area was already open re-rendered LiveHub
 * instead of remounting it — the address bar changed and the screen did not.
 *
 * And the button floats on EVERY screen, so the two easiest taps to make were
 * both from a mounted LiveHub: from the Live menu, and from the "Watch live now"
 * list. Tapping it from anywhere else in the app remounted LiveHub and worked
 * fine — which is what made it look intermittent rather than broken.
 *
 * These tests drive the component the way a person does: mount the Live area,
 * then NAVIGATE to the door without unmounting, and assert the screen changed.
 */

// The screens behind the menu are whole features of their own (supabase, tiers,
// YouTube linking, the DVR). This file is about which one LiveHub CHOOSES, so
// each is stubbed down to a nameplate.
vi.mock('@/pages/GoLive', () => ({ GoLive: () => <div>GO_LIVE_SCREEN</div> }))
vi.mock('@/pages/Director', () => ({ Director: () => <div>DVR_SCREEN</div> }))
vi.mock('@/pages/Videos', () => ({ Videos: () => <div>VIDEOS_SCREEN</div> }))
vi.mock('@/components/OBSPanel', () => ({ OBSPanel: () => <div>OBS_SCREEN</div> }))
vi.mock('@/components/LiveNowStrip', () => ({ LiveNowStrip: () => <div>LIVE_NOW_STRIP</div> }))
vi.mock('@/components/LiveNowBoard', () => ({ LiveNowBoard: () => <div>LIVE_NOW_BOARD</div> }))

const mounted: TestRenderer.ReactTestRenderer[] = []

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

/**
 * The Live area, mounted once at `path`, plus a way to navigate WITHOUT
 * remounting it — exactly what following an in-app deep link does.
 */
async function openLiveArea(path: string) {
  let go!: (to: string) => void

  function Harness() {
    const navigate = useNavigate()
    go = (to: string) => navigate(to)
    return <LiveHub />
  }

  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/live" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  mounted.push(renderer)

  return {
    renderer,
    /** Follow a link without remounting the route — same path, new query. */
    async tap(to: string) {
      await act(async () => { go(to) })
    },
    /** Tap one of the menu's own cards by its label. */
    async tapCard(label: string) {
      const card = renderer.root
        .findAllByType('button')
        .find((n) => String((n.props as { 'aria-label'?: string })['aria-label'] ?? '') === label)
      if (!card) throw new Error(`no menu card labelled "${label}"`)
      await act(async () => { (card.props as { onClick: () => void }).onClick() })
    },
    read: () => text(renderer.root),
  }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  await act(async () => {
    for (const renderer of mounted.splice(0)) renderer.unmount()
  })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('LiveHub — arriving from elsewhere in the app', () => {
  it('opens the menu at bare /live', async () => {
    const live = await openLiveArea('/live')
    expect(live.read()).toContain('Watch live now')
    expect(live.read()).not.toContain('GO_LIVE_SCREEN')
  })

  it('opens Go Live directly on the deep link the button uses', async () => {
    const live = await openLiveArea(GO_LIVE_TO)
    expect(live.read()).toContain('GO_LIVE_SCREEN')
  })

  it('shows one live-now surface in watch mode', async () => {
    const live = await openLiveArea('/live?do=watch')
    expect(live.read().match(/LIVE_NOW_BOARD/g)).toHaveLength(1)
    expect(live.read()).not.toContain('LIVE_NOW_STRIP')
    expect(live.read()).toContain('Open streams room')
  })
})

describe('LiveHub — a go-live deep link followed from inside /live', () => {
  it('opens Go Live from the Live MENU, without a remount', async () => {
    const live = await openLiveArea('/live')
    expect(live.read()).not.toContain('GO_LIVE_SCREEN')
    await live.tap(GO_LIVE_TO)
    expect(live.read()).toContain('GO_LIVE_SCREEN')
  })

  it('opens Go Live from the "Watch live now" list, without a remount', async () => {
    const live = await openLiveArea('/live?do=watch')
    expect(live.read()).toContain('LIVE_NOW_BOARD')
    await live.tap(GO_LIVE_TO)
    expect(live.read()).toContain('GO_LIVE_SCREEN')
    expect(live.read()).not.toContain('LIVE_NOW_BOARD')
  })

  it('opens Go Live from the produced-videos list too', async () => {
    const live = await openLiveArea('/live?do=videos')
    expect(live.read()).toContain('VIDEOS_SCREEN')
    await live.tap(GO_LIVE_TO)
    expect(live.read()).toContain('GO_LIVE_SCREEN')
  })

  it('goes back to the menu when the query drops again (browser Back)', async () => {
    const live = await openLiveArea(GO_LIVE_TO)
    expect(live.read()).toContain('GO_LIVE_SCREEN')
    await live.tap('/live')
    expect(live.read()).not.toContain('GO_LIVE_SCREEN')
    expect(live.read()).toContain('Watch live now')
  })
})

describe('LiveHub — the menu still drives itself', () => {
  it('opens the screen a menu card names', async () => {
    const live = await openLiveArea('/live')
    await live.tapCard('Go Live')
    expect(live.read()).toContain('GO_LIVE_SCREEN')
  })

  it('comes back to the menu from a screen', async () => {
    const live = await openLiveArea(GO_LIVE_TO)
    const back = live.renderer.root
      .findAllByType('button')
      .find((n) => text(n).includes('Live menu'))
    expect(back).toBeTruthy()
    await act(async () => { (back!.props as { onClick: () => void }).onClick() })
    expect(live.read()).toContain('Watch live now')
  })
})

describe('LiveHub — the old deep links still resolve', () => {
  it('folds the retired host-a-multi-stream door into Go Live', async () => {
    expect((await openLiveArea('/live?do=multi')).read()).toContain('GO_LIVE_SCREEN')
    expect((await openLiveArea('/live?do=host')).read()).toContain('GO_LIVE_SCREEN')
  })

  it('accepts the pre-`do=` tab links', async () => {
    expect((await openLiveArea('/live?tab=go-live')).read()).toContain('GO_LIVE_SCREEN')
    expect((await openLiveArea('/live?tab=watch')).read()).toContain('LIVE_NOW_BOARD')
  })

  it('ignores a screen name that is not one of ours', async () => {
    expect((await openLiveArea('/live?do=nonsense')).read()).toContain('Watch live now')
  })
})
