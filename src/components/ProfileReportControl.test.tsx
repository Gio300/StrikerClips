import TestRenderer, { act } from 'react-test-renderer'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileReportControl } from './ProfileReportControl'

const mounted: TestRenderer.ReactTestRenderer[] = []

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  await act(async () => {
    for (const renderer of mounted.splice(0)) renderer.unmount()
  })
  vi.unstubAllGlobals()
})

async function render(node: ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer
  await act(async () => {
    renderer = TestRenderer.create(node)
  })
  mounted.push(renderer)
  return renderer
}

describe('ProfileReportControl', () => {
  it('shows a direct report action for another player', async () => {
    const renderer = await render(
      <ProfileReportControl viewerId="viewer" profileId="other-player" />,
    )

    const action = renderer.root.findByProps({ 'aria-label': 'Report profile' })
    expect(action).toBeTruthy()
    expect(action.props.children).toContain('Report profile')
  })

  it('never shows on the viewer own profile or to a guest', async () => {
    const own = await render(
      <ProfileReportControl viewerId="same-player" profileId="same-player" />,
    )
    const guest = await render(
      <ProfileReportControl viewerId={null} profileId="other-player" />,
    )

    expect(own.toJSON()).toBeNull()
    expect(guest.toJSON()).toBeNull()
  })
})
