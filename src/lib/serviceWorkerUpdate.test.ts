/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SW_SOURCE = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8')

function response(contentType: string, body: string) {
  return {
    ok: true,
    type: 'basic',
    body,
    headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null },
    clone() { return response(contentType, body) },
  }
}

function loadWorker(initialKeys: string[] = [], fetchImpl: (request: any) => Promise<any> = async () => response('text/plain', 'ok')) {
  const handlers = new Map<string, (event: any) => void>()
  const deletedCaches: string[] = []
  const buckets = new Map<string, Map<string, any>>()
  for (const key of initialKeys) buckets.set(key, new Map())
  const messages: any[] = []

  const cacheKey = (request: any) => typeof request === 'string' ? request : request.url
  const caches: any = {
    keys: async () => [...buckets.keys()],
    delete: async (name: string) => {
      deletedCaches.push(name)
      return buckets.delete(name)
    },
    open: async (name: string) => {
      if (!buckets.has(name)) buckets.set(name, new Map())
      const bucket = buckets.get(name)!
      return {
        match: async (request: any) => bucket.get(cacheKey(request)),
        put: async (request: any, value: any) => { bucket.set(cacheKey(request), value) },
        delete: async (request: any) => bucket.delete(cacheKey(request)),
      }
    },
    match: async (request: any, options?: { cacheName?: string }) =>
      options?.cacheName ? buckets.get(options.cacheName)?.get(cacheKey(request)) : undefined,
  }
  const self: any = {
    registration: { scope: 'https://tko.cam/' },
    location: { origin: 'https://tko.cam' },
    addEventListener: (type: string, handler: (event: any) => void) => handlers.set(type, handler),
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => [{ postMessage: (message: any) => messages.push(message) }],
      openWindow: async () => null,
    },
  }

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', SW_SOURCE)(self, caches, fetchImpl)

  return {
    buckets,
    deletedCaches,
    handlers,
    messages,
    async activate() {
      let pending = Promise.resolve()
      handlers.get('activate')!({ waitUntil: (value: Promise<void>) => { pending = value } })
      await pending
    },
    async fetch(request: any) {
      let pending: Promise<any> | undefined
      handlers.get('fetch')!({ request, respondWith: (value: Promise<any>) => { pending = value } })
      return pending ? pending : undefined
    },
  }
}

describe('service worker update safety', () => {
  it('keeps one prior cache for tabs that are still running the old build', async () => {
    const current = 'tko-shell::/::dev'
    const previous = 'tko-shell::/::previous'
    const oldest = 'tko-shell::/::oldest'
    const siblingScope = 'tko-shell::/app/::other'
    const worker = loadWorker([oldest, previous, siblingScope, current])

    await worker.activate()

    expect(worker.deletedCaches).toEqual([oldest])
    expect(worker.buckets.has(previous)).toBe(true)
    expect(worker.buckets.has(siblingScope)).toBe(true)
    expect(worker.messages).toEqual([{ type: 'TKO_UPDATE_ACTIVATED', buildId: 'dev' }])
  })

  it('evicts cached HTML masquerading as JavaScript and replaces it with JavaScript', async () => {
    const request = {
      method: 'GET',
      mode: 'cors',
      destination: 'script',
      url: 'https://tko.cam/assets/index-new.js',
    }
    const worker = loadWorker([], async () => response('text/javascript', 'export {}'))
    const cache = await (worker as any).buckets
    worker.buckets.set('tko-shell::/::dev', new Map([[request.url, response('text/html', '<!doctype html>')]]))

    const result = await worker.fetch(request)

    expect(result.body).toBe('export {}')
    expect(cache.get('tko-shell::/::dev')?.get(request.url)?.body).toBe('export {}')
  })

  it('never stores an HTML fallback fetched for a build asset', async () => {
    const request = {
      method: 'GET',
      mode: 'cors',
      destination: 'script',
      url: 'https://tko.cam/assets/index-missing.js',
    }
    const worker = loadWorker([], async () => response('text/html', '<!doctype html>'))

    await worker.fetch(request)

    expect(worker.buckets.get('tko-shell::/::dev')?.has(request.url)).toBe(false)
  })
})
