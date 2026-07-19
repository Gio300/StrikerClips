/**
 * Clip Tray — the transfer bus between surfaces.
 *
 * The in-app Browser is where players GATHER (they're on YouTube / PlayStation /
 * Twitch and spot a clip); the reel builder is where they BUILD. The tray is the
 * shared stash in between: anything can drop a clip in, anything can pull it out.
 * This is the "center we flow from" — Browser → tray → Create, and back out to
 * Browser for sharing.
 *
 * Backed by localStorage so a stash survives navigation and reloads, and it
 * broadcasts a window event so every mounted surface (tray badge, create screen)
 * updates live. Pure/DOM-light so the core is unit-testable with a storage shim.
 */

import { extractYouTubeId } from './youtubeApi'

export type TraySource = 'browser' | 'youtube' | 'reel' | 'paste' | 'connect'

export type TrayItem = {
  /** stable key: the youtube id when we can resolve one, else the full url */
  id: string
  url: string
  title?: string
  source: TraySource
  /** originating page host, when stashed from the Browser */
  fromHost?: string
  addedAt: number
}

const KEY = 'kc_clip_tray'
const EVENT = 'kc:tray'
const MAX = 50

// Storage is injectable so tests can pass a fake; defaults to localStorage.
export interface TrayStorage {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

function defaultStorage(): TrayStorage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch { /* access blocked */ }
  return null
}

function keyFor(url: string): string {
  const id = extractYouTubeId(url)
  return id ?? url.trim()
}

export function readTray(storage: TrayStorage | null = defaultStorage()): TrayItem[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as TrayItem[]) : []
  } catch {
    return []
  }
}

function writeTray(items: TrayItem[], storage: TrayStorage | null = defaultStorage()): void {
  if (!storage) return
  try {
    storage.setItem(KEY, JSON.stringify(items.slice(0, MAX)))
  } catch { /* quota / private mode */ }
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent(EVENT)) } catch { /* non-DOM */ }
  }
}

/**
 * Add a clip to the tray. Deduplicates by YouTube id (or url); a repeat add
 * refreshes the existing item to the front rather than duplicating. Returns the
 * new tray. `now` injectable for deterministic tests.
 */
export function addToTray(
  input: { url: string; title?: string; source?: TraySource; fromHost?: string },
  storage: TrayStorage | null = defaultStorage(),
  now: number = Date.now(),
): TrayItem[] {
  const url = input.url.trim()
  if (!url) return readTray(storage)
  const id = keyFor(url)
  const existing = readTray(storage).filter((x) => x.id !== id)
  const item: TrayItem = {
    id,
    url,
    title: input.title,
    source: input.source ?? 'paste',
    fromHost: input.fromHost,
    addedAt: now,
  }
  const next = [item, ...existing]
  writeTray(next, storage)
  return next
}

export function removeFromTray(id: string, storage: TrayStorage | null = defaultStorage()): TrayItem[] {
  const next = readTray(storage).filter((x) => x.id !== id)
  writeTray(next, storage)
  return next
}

export function clearTray(storage: TrayStorage | null = defaultStorage()): void {
  writeTray([], storage)
}

export function isInTray(url: string, storage: TrayStorage | null = defaultStorage()): boolean {
  const id = keyFor(url)
  return readTray(storage).some((x) => x.id === id)
}

/** Subscribe a component to tray changes. Returns an unsubscribe fn. */
export function subscribeTray(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => cb()
  window.addEventListener(EVENT, handler)
  // storage event fires cross-tab; local dispatch covers same-tab.
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

/** True when a URL is something worth stashing (a real link, ideally a video). */
export function isStashable(url: string): boolean {
  const v = (url || '').trim()
  if (!/^https?:\/\//i.test(v)) return false
  // Anything on http(s) is stashable; YouTube links are the sweet spot.
  return true
}
