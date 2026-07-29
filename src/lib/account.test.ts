import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DELETE_CONFIRM_WORD,
  isDeleteConfirmed,
  parseDeleteResponse,
  deleteAccount,
  type AccountClient,
} from './account'

// The node test env has no DOM; deleteAccount touches localStorage.
class MemStorage {
  store = new Map<string, string>()
  getItem(k: string): string | null { return this.store.has(k) ? this.store.get(k)! : null }
  setItem(k: string, v: string): void { this.store.set(k, String(v)) }
  removeItem(k: string): void { this.store.delete(k) }
  clear(): void { this.store.clear() }
}

let storage: MemStorage
beforeEach(() => {
  storage = new MemStorage()
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
})

/** A stand-in for the supabase shim, so no network or client is constructed. */
function fakeClient(reply: { data?: unknown; error?: { message?: string } | null }) {
  const calls: { name: string; body: unknown }[] = []
  const signOut = vi.fn(async () => ({ error: null }))
  const client: AccountClient = {
    functions: {
      invoke: async (name, opts) => {
        calls.push({ name, body: opts?.body })
        return { data: reply.data ?? null, error: reply.error ?? null }
      },
    },
    auth: { signOut },
  }
  return { client, calls, signOut }
}

describe('isDeleteConfirmed', () => {
  it('requires the exact word', () => {
    expect(isDeleteConfirmed(DELETE_CONFIRM_WORD)).toBe(true)
    expect(isDeleteConfirmed('  DELETE  ')).toBe(true) // surrounding space forgiven
  })

  it('rejects near-misses — this guard is the whole point of the step', () => {
    expect(isDeleteConfirmed('delete')).toBe(false) // case matters
    expect(isDeleteConfirmed('Delete')).toBe(false)
    expect(isDeleteConfirmed('DELETE ME')).toBe(false)
    expect(isDeleteConfirmed('DEL')).toBe(false)
    expect(isDeleteConfirmed('')).toBe(false)
    expect(isDeleteConfirmed(null)).toBe(false)
    expect(isDeleteConfirmed(undefined)).toBe(false)
  })
})

describe('parseDeleteResponse', () => {
  it('reports the clan outcome the server chose', () => {
    const r = parseDeleteResponse({ ok: true, clans: { transferred: 2, disbanded: 1 } }, null)
    expect(r).toEqual({ ok: true, clansTransferred: 2, clansDisbanded: 1 })
  })

  it('defaults the clan counters when the server omits them', () => {
    expect(parseDeleteResponse({ ok: true }, null)).toEqual({ ok: true, clansTransferred: 0, clansDisbanded: 0 })
  })

  it('surfaces a transport error', () => {
    const r = parseDeleteResponse(null, { message: 'unauthorized' })
    expect(r).toEqual({ ok: false, error: 'unauthorized' })
  })

  it('surfaces an application-level failure body', () => {
    const r = parseDeleteResponse({ ok: false, error: 'account not found' }, null)
    expect(r).toEqual({ ok: false, error: 'account not found' })
  })

  it('always has a message, even when the server gives none', () => {
    const r = parseDeleteResponse({ ok: false }, null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0)
  })
})

describe('deleteAccount', () => {
  it('calls delete-account and then signs out, clearing the token', async () => {
    storage.setItem('kc_token', 'jwt-value')
    const { client, calls, signOut } = fakeClient({ data: { ok: true, clans: { transferred: 1, disbanded: 0 } } })

    const r = await deleteAccount(client)

    expect(r).toEqual({ ok: true, clansTransferred: 1, clansDisbanded: 0 })
    expect(calls).toEqual([{ name: 'delete-account', body: {} }])
    expect(signOut).toHaveBeenCalledOnce()
    // A live JWT for a deleted row would put the app in a 401 loop.
    expect(storage.getItem('kc_token')).toBeNull()
  })

  it('does NOT sign out when the delete failed — the account still exists', async () => {
    storage.setItem('kc_token', 'jwt-value')
    const { client, signOut } = fakeClient({ error: { message: 'unauthorized' } })

    const r = await deleteAccount(client)

    expect(r).toEqual({ ok: false, error: 'unauthorized' })
    expect(signOut).not.toHaveBeenCalled()
    expect(storage.getItem('kc_token')).toBe('jwt-value')
  })

  it('never throws — a network failure comes back as a result', async () => {
    const client: AccountClient = {
      functions: { invoke: async () => { throw new Error('Failed to fetch') } },
      auth: { signOut: async () => ({}) },
    }
    const r = await deleteAccount(client)
    expect(r).toEqual({ ok: false, error: 'Failed to fetch' })
  })

  it('still reports success if signOut itself blows up', async () => {
    const client: AccountClient = {
      functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
      auth: { signOut: async () => { throw new Error('no session') } },
    }
    const r = await deleteAccount(client)
    expect(r.ok).toBe(true)
  })
})
