import { describe, it, expect, beforeEach } from 'vitest'
import {
  readTray,
  addToTray,
  removeFromTray,
  clearTray,
  isInTray,
  isStashable,
  type TrayStorage,
} from './clipTray'

// In-memory storage shim so the core is testable without a DOM/localStorage.
function memStorage(): TrayStorage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, v) },
  }
}

const YT_A = 'https://www.youtube.com/watch?v=dPCS6ACHeQ0'
const YT_A_SHORT = 'https://youtu.be/dPCS6ACHeQ0?t=30'
const YT_B = 'https://youtu.be/IZcwiJrMwas'

describe('clipTray', () => {
  let s: TrayStorage
  beforeEach(() => { s = memStorage() })

  it('adds items newest-first', () => {
    addToTray({ url: YT_A, source: 'browser' }, s, 1000)
    const t = addToTray({ url: YT_B, source: 'paste' }, s, 2000)
    expect(t.map((x) => x.url)).toEqual([YT_B, YT_A])
  })

  it('dedupes by youtube id even across url forms, refreshing to front', () => {
    addToTray({ url: YT_A, source: 'browser' }, s, 1000)
    addToTray({ url: YT_B, source: 'paste' }, s, 2000)
    const t = addToTray({ url: YT_A_SHORT, source: 'browser' }, s, 3000)
    expect(t.length).toBe(2) // not 3 — A collapsed
    expect(t[0].id).toBe('dPCS6ACHeQ0') // refreshed to front
    expect(t[0].url).toBe(YT_A_SHORT)
  })

  it('removes by id and clears', () => {
    addToTray({ url: YT_A, source: 'browser' }, s, 1000)
    addToTray({ url: YT_B, source: 'paste' }, s, 2000)
    let t = removeFromTray('dPCS6ACHeQ0', s)
    expect(t.map((x) => x.id)).toEqual(['IZcwiJrMwas'])
    clearTray(s)
    expect(readTray(s)).toEqual([])
  })

  it('reports membership', () => {
    addToTray({ url: YT_A, source: 'browser' }, s, 1000)
    expect(isInTray(YT_A_SHORT, s)).toBe(true)
    expect(isInTray(YT_B, s)).toBe(false)
  })

  it('ignores empty urls', () => {
    const t = addToTray({ url: '   ', source: 'paste' }, s, 1000)
    expect(t).toEqual([])
  })

  it('isStashable only accepts http(s) links', () => {
    expect(isStashable(YT_A)).toBe(true)
    expect(isStashable('not a url')).toBe(false)
    expect(isStashable('')).toBe(false)
  })
})
