/**
 * Preview vertical store — WHICH sample league the phone preview shows.
 *
 * WHY IT EXISTS (operator 2026-08-04): "I need to advertise something other
 * than 1 video game." A prospect picks their competition (esports, shooter,
 * soccer, racing, fighting, hoops) on the gateway or in the Studio, and the
 * fixture behind the phone preview re-skins its LANGUAGE — clubs vs squads,
 * fixtures vs sets — so they see their own league in the mockup within
 * seconds. That choice is a PRESENTATION preference, not league data: it is
 * deliberately kept OUT of LeagueConfig so `league.json`, the server's
 * sanitizer (src/lib/leagueStudioRanges.ts) and the renderer schema all stay
 * exactly as they were.
 *
 * Modeled on the draft store in src/lib/leagueConfig.ts: localStorage-backed,
 * injectable storage for tests, and a window event bus so every mounted
 * PhonePreview (the gateway hero and the Studio pull-out) re-renders together.
 * Fails soft everywhere — no storage, no window, no problem.
 */

import type { ThemeStorage } from './broadcastTheme'
import {
  DEFAULT_PREVIEW_VERTICAL,
  normalizePreviewVertical,
  type PreviewVerticalId,
} from './leaguePreviewFixture'

const VERTICAL_KEY = 'tko_league_preview_vertical'
const VERTICAL_EVENT = 'tko:league-preview-vertical'

function defaultStorage(): ThemeStorage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* access blocked (SSR / private mode) */
  }
  return null
}

/** The vertical the preview should render (always a valid id). */
export function loadPreviewVertical(
  storage: ThemeStorage | null = defaultStorage(),
): PreviewVerticalId {
  if (!storage) return DEFAULT_PREVIEW_VERTICAL
  try {
    return normalizePreviewVertical(storage.getItem(VERTICAL_KEY))
  } catch {
    return DEFAULT_PREVIEW_VERTICAL
  }
}

/** Persist the choice and notify every mounted preview. Returns what stuck. */
export function savePreviewVertical(
  raw: unknown,
  storage: ThemeStorage | null = defaultStorage(),
): PreviewVerticalId {
  const id = normalizePreviewVertical(raw)
  if (storage) {
    try {
      storage.setItem(VERTICAL_KEY, id)
    } catch {
      /* quota */
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(VERTICAL_EVENT))
    } catch {
      /* non-DOM */
    }
  }
  return id
}

/** Subscribe to vertical changes (this tab + other tabs). Returns unsubscribe. */
export function subscribePreviewVertical(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => cb()
  window.addEventListener(VERTICAL_EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(VERTICAL_EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}
