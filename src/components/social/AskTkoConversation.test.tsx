import { MemoryRouter } from 'react-router-dom'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskTkoConversation } from './AskTkoConversation'

const invoke = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'player-1' }, profile: { power_level: 15_900 } }),
}))

vi.mock('@/components/AskTkoContext', () => ({
  useAskTko: () => ({ open: vi.fn() }),
}))

let renderer: TestRenderer.ReactTestRenderer | null = null

beforeEach(() => {
  invoke.mockReset()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = null
  vi.unstubAllGlobals()
})

async function ask(text: string) {
  const input = renderer!.root.findByType('input')
  await act(async () => input.props.onChange({ target: { value: text } }))
  const form = renderer!.root.findByType('form')
  await act(async () => form.props.onSubmit({ preventDefault() {} }))
}

describe('Ask TKO conversation continuity', () => {
  it('sends prior player and assistant turns with a follow-up question', async () => {
    invoke
      .mockResolvedValueOnce({ data: { ok: true, answer: 'SPL is an open tournament.' } })
      .mockResolvedValueOnce({ data: { ok: true, answer: 'The SPL rules are loaded.' } })

    await act(async () => {
      renderer = TestRenderer.create(
        <MemoryRouter initialEntries={['/messages']}>
          <AskTkoConversation />
        </MemoryRouter>,
      )
    })

    await ask('SPL is a tournament')
    await ask('I need the rules')

    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[0][1].body.history).toEqual([])
    expect(invoke.mock.calls[1][1].body).toMatchObject({
      question: 'I need the rules',
      history: [
        { role: 'user', text: 'SPL is a tournament' },
        { role: 'assistant', text: 'SPL is an open tournament.' },
      ],
      clientContext: { signedIn: true, path: '/messages' },
    })
  })
})
