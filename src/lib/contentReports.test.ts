import { describe, expect, it, vi } from 'vitest'
import { submitContentReport } from './contentReports'

describe('content report client', () => {
  it('sends only target/reason context and returns the durable report id', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, duplicate: false, report: { id: 'report-1' } },
      error: null,
    })
    const result = await submitContentReport({
      targetType: 'post_comment',
      targetId: 'target-1',
      reason: 'harassment',
      details: '  context  ',
      sourcePath: '/profile/player',
    }, { functions: { invoke } })

    expect(result).toEqual({ duplicate: false, id: 'report-1' })
    expect(invoke).toHaveBeenCalledWith('report-content', {
      body: {
        target_type: 'post_comment',
        target_id: 'target-1',
        reason: 'harassment',
        details: 'context',
        source_path: '/profile/player',
      },
    })
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('reporter_id')
  })

  it('surfaces backend failures instead of pretending the report was saved', async () => {
    const client = {
      functions: {
        invoke: vi.fn().mockResolvedValue({ data: null, error: { message: 'Please sign in again.' } }),
      },
    }
    await expect(submitContentReport({
      targetType: 'reel',
      targetId: 'target-2',
      reason: 'spam',
    }, client)).rejects.toThrow('Please sign in again.')
  })
})
