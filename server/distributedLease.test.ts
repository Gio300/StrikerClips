import { describe, expect, it, vi } from 'vitest'
import { withDistributedLease } from './distributedLease'

describe('withDistributedLease', () => {
  it('runs and releases work after acquiring the lease', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ owner_id: 'worker' }] })
      .mockResolvedValueOnce({ rows: [] })
    const work = vi.fn().mockResolvedValue('done')

    await expect(withDistributedLease({ query }, 'scan', 60, work)).resolves.toEqual({
      acquired: true,
      value: 'done',
    })
    expect(work).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[1][0]).toContain('delete from worker_leases')
  })

  it('skips work when another instance owns the lease', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const work = vi.fn()

    await expect(withDistributedLease({ query }, 'scan', 60, work)).resolves.toEqual({ acquired: false })
    expect(work).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledOnce()
  })

  it('releases the lease when the job fails', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ owner_id: 'worker' }] })
      .mockResolvedValueOnce({ rows: [] })

    await expect(withDistributedLease(
      { query },
      'scan',
      60,
      async () => { throw new Error('boom') },
    )).rejects.toThrow('boom')
    expect(query).toHaveBeenCalledTimes(2)
  })
})
