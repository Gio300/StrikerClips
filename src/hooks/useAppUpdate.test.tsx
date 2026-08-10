import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RUNNING_VERSION } from '@/lib/buildInfo'
import { useAppUpdate, type AppUpdateState } from './useAppUpdate'

const swMocks = vi.hoisted(() => ({
  register: vi.fn(),
  activate: vi.fn(),
  hardReset: vi.fn(),
}))

vi.mock('@/lib/swClient', () => ({
  canUseServiceWorker: () => true,
  registerServiceWorker: swMocks.register,
  activateUpdateAndReload: swMocks.activate,
  hardResetAndReload: swMocks.hardReset,
}))

type Listener = (event: { data?: unknown }) => void

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  }
}

describe('useAppUpdate service-worker reconciliation', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null
  let latest: AppUpdateState | null = null
  let messageListener: Listener | null = null

  beforeEach(() => {
    latest = null
    messageListener = null
    swMocks.register.mockReset()
    swMocks.activate.mockReset()
    swMocks.hardReset.mockReset()

    const registration = {
      waiting: { postMessage: vi.fn() },
      installing: null,
      addEventListener: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    }
    swMocks.register.mockResolvedValue(registration)

    vi.stubGlobal('sessionStorage', memoryStorage())
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: {},
        addEventListener: vi.fn((type: string, listener: Listener) => {
          if (type === 'message') messageListener = listener
        }),
        removeEventListener: vi.fn(),
      },
    })
    vi.stubGlobal('window', {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount())
      renderer = null
    }
    vi.unstubAllGlobals()
  })

  it('clears a transient hint when the activated worker matches the running bundle', async () => {
    function Probe() {
      latest = useAppUpdate()
      return null
    }

    await act(async () => {
      renderer = TestRenderer.create(<Probe />)
      await Promise.resolve()
    })

    expect(latest?.updateReady).toBe(true)
    expect(messageListener).not.toBeNull()

    act(() => {
      messageListener?.({
        data: { type: 'TKO_UPDATE_ACTIVATED', buildId: RUNNING_VERSION.buildId },
      })
    })

    expect(latest?.updateReady).toBe(false)
    expect(swMocks.activate).not.toHaveBeenCalled()
  })
})
