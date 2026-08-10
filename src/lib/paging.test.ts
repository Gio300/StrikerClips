import { describe, expect, it } from 'vitest'
import { appendUniqueById, splitExtraRowPage } from './paging'
import { mockSupabase } from './mockSupabase'

describe('bounded list paging', () => {
  it('uses one extra row only to report that another page exists', () => {
    expect(splitExtraRowPage([{ id: '1' }, { id: '2' }, { id: '3' }], 2)).toEqual({
      items: [{ id: '1' }, { id: '2' }],
      hasMore: true,
    })
    expect(splitExtraRowPage([{ id: '1' }, { id: '2' }], 2).hasMore).toBe(false)
  })

  it('deduplicates rows when data shifts between pages', () => {
    expect(appendUniqueById([{ id: '1' }, { id: '2' }], [{ id: '2' }, { id: '3' }]))
      .toEqual([{ id: '1' }, { id: '2' }, { id: '3' }])
  })

  it('makes range a real offset window in the local client', async () => {
    const table = `paging-${Date.now()}-${Math.random()}`
    await mockSupabase.from(table).insert([
      { id: '1', position: 1 },
      { id: '2', position: 2 },
      { id: '3', position: 3 },
      { id: '4', position: 4 },
    ])
    const { data } = await mockSupabase.from(table).select('*').order('position').range(1, 2)
    expect(data.map((row: { position: number }) => row.position)).toEqual([2, 3])
  })
})
