import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportContentButton } from './ReportContentButton'

const reports = vi.hoisted(() => ({ submit: vi.fn() }))

vi.mock('@/lib/contentReports', () => ({
  CONTENT_REPORT_REASONS: [
    ['harassment', 'Harassment or bullying'],
    ['spam', 'Spam'],
  ],
  submitContentReport: reports.submit,
}))

const mounted: TestRenderer.ReactTestRenderer[] = []

beforeEach(() => {
  reports.submit.mockResolvedValue({ duplicate: false, id: 'report-1' })
  vi.stubGlobal('window', { location: { pathname: '/feed', search: '?from=home' } })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  await act(async () => {
    for (const renderer of mounted.splice(0)) renderer.unmount()
  })
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ReportContentButton', () => {
  it('does not offer a self-report action', () => {
    const renderer = TestRenderer.create(
      <ReportContentButton
        reporterId="same-user"
        targetOwnerId="same-user"
        targetType="post"
        targetId="post-1"
      />,
    )
    mounted.push(renderer)
    expect(renderer.toJSON()).toBeNull()
  })

  it('collects a reason and sends a target-only report', async () => {
    let renderer!: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(
        <ReportContentButton
          reporterId="viewer"
          targetOwnerId="author"
          targetType="post_comment"
          targetId="comment-1"
        />,
      )
    })
    mounted.push(renderer)

    await act(async () => renderer.root.findByProps({ 'aria-label': 'Report content' }).props.onClick())
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
    await act(async () => {
      renderer.root.findByType('select').props.onChange({ target: { value: 'spam' } })
      renderer.root.findByType('textarea').props.onChange({ target: { value: 'Repeated links' } })
    })
    const submit = renderer.root.findAllByType('button').find((button) => button.props.children === 'Send report')!
    await act(async () => submit.props.onClick())

    expect(reports.submit).toHaveBeenCalledWith({
      targetType: 'post_comment',
      targetId: 'comment-1',
      reason: 'spam',
      details: 'Repeated links',
      sourcePath: '/feed?from=home',
    })
    expect(renderer.root.findByProps({ 'aria-label': 'Content reported' })).toBeTruthy()
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  })

  it('uses profile-specific copy and submits a profile target', async () => {
    let renderer!: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(
        <ReportContentButton
          reporterId="viewer"
          targetOwnerId="other-player"
          targetType="profile"
          targetId="other-player"
          compact={false}
        />,
      )
    })
    mounted.push(renderer)

    await act(async () => renderer.root.findByProps({ 'aria-label': 'Report profile' }).props.onClick())
    expect(renderer.root.findByType('h2').props.children.join('')).toBe('Report profile')
    const submit = renderer.root.findAllByType('button').find((button) => button.props.children === 'Send report')!
    await act(async () => submit.props.onClick())

    expect(reports.submit).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'profile',
      targetId: 'other-player',
    }))
    expect(renderer.root.findByProps({ 'aria-label': 'Profile reported' })).toBeTruthy()
  })
})
