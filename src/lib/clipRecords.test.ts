import { describe, it, expect, vi } from 'vitest'
import { syncClipRecordToBackend, type SyncClipRecordDeps } from './clipRecords'
import { autoMergeEnabled } from './entitlements'

/**
 * The AUTO-MERGE gate: a clip record ALWAYS lands (the user's own post / single
 * match is never gated), but the cross-user `auto-match` enqueue only fires when
 * the user is auto-merge-entitled (YouTube connected + a paid tier). These tests
 * inject fake backend deps so no real Supabase/env is needed.
 */
function fakeDeps(insertId: string | null = 'clip-1') {
  const insertClipRecord = vi.fn(async () => insertId)
  const enqueueAutoMatch = vi.fn(async () => {})
  const deps: SyncClipRecordDeps = { insertClipRecord, enqueueAutoMatch }
  return { deps, insertClipRecord, enqueueAutoMatch }
}

const base = { playerId: 'u1', playerHandle: 'ninja' }

describe('syncClipRecordToBackend — auto-merge gating', () => {
  it('an entitled user enqueues auto-match (clip inserted AND merge triggered)', async () => {
    const { deps, insertClipRecord, enqueueAutoMatch } = fakeDeps()
    await syncClipRecordToBackend({ ...base, autoMergeEnabled: true }, deps)
    expect(insertClipRecord).toHaveBeenCalledTimes(1)
    expect(enqueueAutoMatch).toHaveBeenCalledTimes(1)
    expect(enqueueAutoMatch).toHaveBeenCalledWith('clip-1')
  })

  it('a NON-entitled user still posts the clip but does NOT enqueue auto-match', async () => {
    const { deps, insertClipRecord, enqueueAutoMatch } = fakeDeps()
    await syncClipRecordToBackend({ ...base, autoMergeEnabled: false }, deps)
    expect(insertClipRecord).toHaveBeenCalledTimes(1) // own post is never gated
    expect(enqueueAutoMatch).not.toHaveBeenCalled()
  })

  it('defaults to NOT enqueuing when entitlement is unspecified', async () => {
    const { deps, enqueueAutoMatch } = fakeDeps()
    await syncClipRecordToBackend({ ...base }, deps)
    expect(enqueueAutoMatch).not.toHaveBeenCalled()
  })

  it('never enqueues when the clip insert failed, even if entitled', async () => {
    const { deps, enqueueAutoMatch } = fakeDeps(null)
    await syncClipRecordToBackend({ ...base, autoMergeEnabled: true }, deps)
    expect(enqueueAutoMatch).not.toHaveBeenCalled()
  })

  it('free tier is blocked; paid + YouTube unlocks (via autoMergeEnabled)', async () => {
    // free tier, YouTube connected → blocked
    {
      const { deps, enqueueAutoMatch } = fakeDeps()
      const on = autoMergeEnabled({ youtubeConnected: true, entitlements: { tier: '' } })
      await syncClipRecordToBackend({ ...base, autoMergeEnabled: on }, deps)
      expect(enqueueAutoMatch).not.toHaveBeenCalled()
    }
    // paid tier but NO YouTube → blocked
    {
      const { deps, enqueueAutoMatch } = fakeDeps()
      const on = autoMergeEnabled({ youtubeConnected: false, entitlements: { tier: 'pro' } })
      await syncClipRecordToBackend({ ...base, autoMergeEnabled: on }, deps)
      expect(enqueueAutoMatch).not.toHaveBeenCalled()
    }
    // paid tier + YouTube → enqueues
    {
      const { deps, enqueueAutoMatch } = fakeDeps()
      const on = autoMergeEnabled({ youtubeConnected: true, entitlements: { tier: 'pro' } })
      await syncClipRecordToBackend({ ...base, autoMergeEnabled: on }, deps)
      expect(enqueueAutoMatch).toHaveBeenCalledTimes(1)
    }
  })
})
