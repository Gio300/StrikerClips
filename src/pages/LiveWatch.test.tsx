import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollapsibleOracle } from '@/pages/LiveWatch'

describe('live Oracle disclosure', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts collapsed and does not mount Oracle until the viewer opens it', async () => {
    let rendered = 0
    function OptionalOracle() {
      rendered += 1
      return createElement('p', null, 'ORACLE_PANEL')
    }

    let view!: TestRenderer.ReactTestRenderer
    await act(async () => {
      view = TestRenderer.create(
        createElement(CollapsibleOracle, {
          streamId: 'stream-1',
          children: createElement(OptionalOracle),
        }),
      )
    })

    const toggle = view.root.findByType('button')
    expect(toggle.props['aria-expanded']).toBe(false)
    expect(rendered).toBe(0)
    expect(JSON.stringify(view.toJSON())).not.toContain('ORACLE_PANEL')

    await act(async () => { toggle.props.onClick() })
    expect(view.root.findByType('button').props['aria-expanded']).toBe(true)
    expect(rendered).toBe(1)
    expect(JSON.stringify(view.toJSON())).toContain('ORACLE_PANEL')

    await act(async () => { view.unmount() })
  })
})
