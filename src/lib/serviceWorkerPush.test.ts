/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE SERVICE WORKER'S PUSH HANDLERS, UNDER TEST.
 *
 * public/sw.js is plain script served to the browser, not an importable module,
 * so it is loaded here as source and evaluated against a fake
 * ServiceWorkerGlobalScope. That is worth the small amount of scaffolding,
 * because three of the guarantees in this slice live ONLY in that file and are
 * invisible to every server test:
 *
 *   • a `tag` is ALWAYS set, so twenty messages in one conversation collapse to
 *     one line in the notification shade instead of stacking;
 *   • the payload's `url` is re-based onto the worker's OWN scope, so the same
 *     server payload is correct for the '/' and '/app/' registrations, and a
 *     hostile url cannot send the member off-origin;
 *   • a click FOCUSES a tab that already has that conversation open rather than
 *     navigating it (which would remount the room and lose the scroll).
 *
 * It also pins the thing that must NOT change: the worker still installs,
 * activates and purges old caches exactly as before.
 */

const SW_SOURCE = readFileSync(
  path.resolve(__dirname, '../../public/sw.js'),
  'utf8',
)

interface FakeClient {
  url: string
  focused: boolean
  navigatedTo: string | null
  focus: () => Promise<void>
  navigate?: (url: string) => Promise<void>
}

function makeClient(url: string, options: { navigable?: boolean } = {}): FakeClient {
  const client: FakeClient = {
    url,
    focused: false,
    navigatedTo: null,
    focus: async () => {
      client.focused = true
    },
  }
  if (options.navigable !== false) {
    client.navigate = async (target: string) => {
      client.navigatedTo = target
    }
  }
  return client
}

/** Load sw.js into a fake global scope and hand back the levers a test needs. */
function loadWorker(scope: string, clients: FakeClient[] = []) {
  const handlers = new Map<string, (event: any) => void>()
  const shown: { title: string; options: any }[] = []
  const opened: string[] = []

  const scopeUrl = new URL(scope)
  const self: any = {
    registration: {
      scope,
      showNotification: async (title: string, options: any) => {
        shown.push({ title, options })
      },
    },
    location: { origin: scopeUrl.origin },
    addEventListener: (type: string, handler: (event: any) => void) => {
      handlers.set(type, handler)
    },
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => clients,
      openWindow: async (url: string) => {
        opened.push(url)
        return null
      },
    },
  }
  const caches: any = {
    keys: async () => [],
    delete: async () => true,
    open: async () => ({ put: async () => {}, match: async () => undefined }),
    match: async () => undefined,
  }

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', SW_SOURCE)(self, caches)

  const pending: Promise<any>[] = []
  const waitUntil = (value: any) => {
    pending.push(Promise.resolve(value))
  }

  return {
    handlers,
    shown,
    opened,
    self,
    async push(payload: any) {
      const data =
        payload === undefined
          ? null
          : {
              json: () => {
                if (typeof payload === 'string') throw new Error('not json')
                return payload
              },
              text: () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
            }
      handlers.get('push')!({ data, waitUntil })
      await Promise.all(pending)
    },
    async click(notificationData: any) {
      let closed = false
      handlers.get('notificationclick')!({
        notification: {
          data: notificationData,
          close: () => {
            closed = true
          },
        },
        waitUntil,
      })
      await Promise.all(pending)
      return { closed }
    },
  }
}

describe('service worker — the handlers that already existed', () => {
  it('still registers install, activate, message and fetch', () => {
    const worker = loadWorker('https://tko.cam/app/')
    expect([...worker.handlers.keys()].sort()).toEqual(
      ['activate', 'fetch', 'install', 'message', 'notificationclick', 'push'].sort(),
    )
  })
})

describe('service worker — push', () => {
  it('shows the notification the server described', async () => {
    const worker = loadWorker('https://tko.cam/app/')
    await worker.push({
      title: 'push_alice sent you a message',
      body: 'ranked in 10?',
      url: '/messages',
      tag: 'dm:abc',
    })

    expect(worker.shown).toHaveLength(1)
    expect(worker.shown[0].title).toBe('push_alice sent you a message')
    expect(worker.shown[0].options.body).toBe('ranked in 10?')
    expect(worker.shown[0].options.tag).toBe('dm:abc')
    // A tag without renotify replaces SILENTLY — which would defeat the point.
    expect(worker.shown[0].options.renotify).toBe(true)
    expect(worker.shown[0].options.data.url).toBe('/app/messages')
  })

  it('ALWAYS carries a tag, so a burst collapses instead of stacking', async () => {
    const worker = loadWorker('https://tko.cam/app/')
    await worker.push({ title: 'one', url: '/messages' })
    expect(worker.shown[0].options.tag).toBeTruthy()
  })

  it('re-bases the url onto its own scope', async () => {
    const rootWorker = loadWorker('https://tko.cam/')
    await rootWorker.push({ title: 'x', url: '/messages' })
    expect(rootWorker.shown[0].options.data.url).toBe('/messages')

    const appWorker = loadWorker('https://tko.cam/app/')
    await appWorker.push({ title: 'x', url: '/tournaments/7' })
    expect(appWorker.shown[0].options.data.url).toBe('/app/tournaments/7')
  })

  it('refuses to send the member off-origin or out of scope', async () => {
    const worker = loadWorker('https://tko.cam/app/')
    for (const url of [
      'https://evil.example/steal',
      '//evil.example/steal',
      'javascript:alert(1)',
      '../../outside',
    ]) {
      worker.shown.length = 0
      await worker.push({ title: 'x', url })
      expect(worker.shown[0].options.data.url, `url ${url} escaped the scope`).toBe('/app/')
    }
  })

  it('still shows something when the payload is unusable', async () => {
    // A push event that resolves without showNotification earns the browser's
    // own "this site was updated in the background" notice instead.
    const worker = loadWorker('https://tko.cam/app/')
    await worker.push(undefined)
    expect(worker.shown).toHaveLength(1)
    expect(worker.shown[0].title).toBe('TKO.cam')

    worker.shown.length = 0
    await worker.push('just some text')
    expect(worker.shown).toHaveLength(1)
    expect(worker.shown[0].title).toBe('TKO.cam')
    expect(worker.shown[0].options.body).toBe('just some text')
  })

  it('uses SSL branding for titles on the SSL hostname without rewriting message bodies', async () => {
    const worker = loadWorker('https://shinobistrikerleague.com/app/')
    await worker.push({ title: 'Ask TKO on TKO.cam', body: 'I still call it TKO.cam' })
    expect(worker.shown[0].title).toBe('Ask SSL on SSL')
    expect(worker.shown[0].options.body).toBe('I still call it TKO.cam')

    worker.shown.length = 0
    await worker.push(undefined)
    expect(worker.shown[0].title).toBe('SSL')
  })
})

describe('service worker — notificationclick', () => {
  it('focuses a tab already showing that exact conversation, and does not navigate it', async () => {
    const open = makeClient('https://tko.cam/app/messages')
    const worker = loadWorker('https://tko.cam/app/', [open])
    const { closed } = await worker.click({ url: '/app/messages' })

    expect(closed).toBe(true)
    expect(open.focused).toBe(true)
    // Navigating would remount the room and throw away the scroll position.
    expect(open.navigatedTo).toBeNull()
    expect(worker.opened).toEqual([])
  })

  it('reuses another TKO tab rather than piling up windows', async () => {
    const elsewhere = makeClient('https://tko.cam/app/reels')
    const worker = loadWorker('https://tko.cam/app/', [elsewhere])
    await worker.click({ url: '/app/messages' })

    expect(elsewhere.focused).toBe(true)
    expect(elsewhere.navigatedTo).toBe('https://tko.cam/app/messages')
    expect(worker.opened).toEqual([])
  })

  it('opens a window when nothing of ours is open', async () => {
    const worker = loadWorker('https://tko.cam/app/', [])
    await worker.click({ url: '/app/tournaments/7' })
    expect(worker.opened).toEqual(['https://tko.cam/app/tournaments/7'])
  })

  it('ignores foreign tabs entirely', async () => {
    const foreign = makeClient('https://someone-else.example/app/messages')
    const worker = loadWorker('https://tko.cam/app/', [foreign])
    await worker.click({ url: '/app/messages' })

    expect(foreign.focused).toBe(false)
    expect(worker.opened).toEqual(['https://tko.cam/app/messages'])
  })

  it('falls back to the scope root when the notification carries no url', async () => {
    const worker = loadWorker('https://tko.cam/app/', [])
    await worker.click(undefined)
    expect(worker.opened).toEqual(['https://tko.cam/app/'])
  })
})
