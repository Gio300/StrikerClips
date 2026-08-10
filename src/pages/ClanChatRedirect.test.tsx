import { MemoryRouter, Route, Routes } from 'react-router-dom'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null, loading: true },
  fromCalls: [] as string[],
  fnCalls: [] as Array<{ name: string; body: Record<string, unknown> }>,
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mocks.auth,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      mocks.fromCalls.push(table)
      const query: Record<string, unknown> = {}
      query.select = () => query
      query.eq = () => query
      query.maybeSingle = async () => ({
        data: null,
        error: null,
      })
      return query
    },
  },
}))

vi.mock('@/lib/backend', () => ({
  callFn: async (name: string, body: Record<string, unknown>) => {
    mocks.fnCalls.push({ name, body })
    return { ok: true, space: { id: 'hb-chat', kind: 'clan', name: 'Hellborn Chat' } }
  },
}))

import { ClanChatRedirect } from '@/pages/ChatSpace'

let renderer: TestRenderer.ReactTestRenderer | null = null

function app() {
  return (
    <MemoryRouter initialEntries={['/clans/hb/chat']}>
      <Routes>
        <Route path="/clans/:serverId/chat" element={<ClanChatRedirect />} />
        <Route path="/chat/:spaceId" element={<div>CHAT_OPEN</div>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.auth.user = null
  mocks.auth.loading = true
  mocks.fromCalls.length = 0
  mocks.fnCalls.length = 0
})

afterEach(async () => {
  if (renderer) {
    await act(async () => renderer?.unmount())
    renderer = null
  }
  vi.unstubAllGlobals()
})

describe('ClanChatRedirect authentication hydration', () => {
  it('waits for the signed-in owner before creating the clan chat space', async () => {
    await act(async () => {
      renderer = TestRenderer.create(app())
    })

    expect(mocks.fromCalls).toEqual([])
    expect(mocks.fnCalls).toEqual([])

    mocks.auth.loading = false
    mocks.auth.user = { id: 'kyubi' }
    await act(async () => {
      renderer?.update(app())
    })

    expect(mocks.fnCalls).toContainEqual({
      name: 'clan-chat-space-ensure',
      body: { serverId: 'hb' },
    })
    expect(renderer?.root.findByType('div').children).toEqual(['CHAT_OPEN'])
  })
})
