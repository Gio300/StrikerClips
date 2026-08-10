import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  loadPreviewVertical,
  savePreviewVertical,
  subscribePreviewVertical,
} from './leaguePreviewVertical'
import { DEFAULT_PREVIEW_VERTICAL } from './leaguePreviewFixture'
import type { ThemeStorage } from './broadcastTheme'

/** In-memory storage stand-in (matches the broadcastTheme test pattern). */
function memStorage(): ThemeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

/**
 * The suite runs in node (no jsdom), so the event bus needs a stand-in window.
 * Minimal on purpose: the store only ever adds/removes listeners and fires a
 * typed event.
 */
function stubWindow() {
  const listeners = new Map<string, Set<() => void>>()
  vi.stubGlobal('CustomEvent', class { constructor(public type: string) {} })
  vi.stubGlobal('window', {
    addEventListener: (type: string, cb: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(cb)
    },
    removeEventListener: (type: string, cb: () => void) => {
      listeners.get(type)?.delete(cb)
    },
    dispatchEvent: (e: { type: string }) => {
      listeners.get(e.type)?.forEach((cb) => cb())
      return true
    },
  })
}

afterEach(() => vi.unstubAllGlobals())

// The vertical is a PRESENTATION preference for the phone preview — which
// sample league it renders. It is deliberately stored apart from LeagueConfig
// so league.json, the renderer schema and the AI-patch ranges never see it.

describe('leaguePreviewVertical — the sample-league choice', () => {
  it('defaults to the neutral vertical with nothing stored', () => {
    expect(loadPreviewVertical(memStorage())).toBe(DEFAULT_PREVIEW_VERTICAL)
  })

  it('round-trips a valid choice', () => {
    const store = memStorage()
    expect(savePreviewVertical('soccer', store)).toBe('soccer')
    expect(loadPreviewVertical(store)).toBe('soccer')
  })

  it('clamps junk on the way IN — a bad write can never poison the preview', () => {
    const store = memStorage()
    expect(savePreviewVertical('rocket-league', store)).toBe(DEFAULT_PREVIEW_VERTICAL)
    expect(loadPreviewVertical(store)).toBe(DEFAULT_PREVIEW_VERTICAL)
  })

  it('clamps junk on the way OUT — a hand-edited localStorage still renders', () => {
    const store = memStorage()
    store.setItem('tko_league_preview_vertical', 'not-a-vertical')
    expect(loadPreviewVertical(store)).toBe(DEFAULT_PREVIEW_VERTICAL)
  })

  it('fails soft with no storage at all (SSR / blocked cookies)', () => {
    expect(loadPreviewVertical(null)).toBe(DEFAULT_PREVIEW_VERTICAL)
    expect(savePreviewVertical('racing', null)).toBe('racing')
  })

  it('notifies every mounted preview when the choice changes', () => {
    stubWindow()
    const store = memStorage()
    let hits = 0
    const off = subscribePreviewVertical(() => hits++)
    savePreviewVertical('fighting', store)
    expect(hits).toBe(1)
    off()
    savePreviewVertical('hoops', store)
    expect(hits).toBe(1)
  })
})
