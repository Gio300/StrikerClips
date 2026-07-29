/**
 * Broadcast theme — light, per-host/tournament branding for the LIVE broadcast
 * composition (see src/pages/Broadcast.tsx).
 *
 * SCAFFOLDING, on purpose. Like assets.ts / wallet.ts this is a localStorage-
 * backed stand-in that a real table (e.g. Supabase `broadcast_themes`) plugs
 * into later. It carries ONE simple theme per key — an accent color, an optional
 * logo/banner URL, the tournament name, the two team names (+ optional team
 * logos) and the host's display name — so a host can lightly brand the screen
 * their audience watches without a heavy editor.
 *
 * Keyed per host or tournament: `kc_broadcast_theme:<key>` so two different
 * tournaments (or hosts) keep their own look.
 */

export type BroadcastTheme = {
  /** Host accent color as a #rrggbb hex — trims badges, tile borders, buttons. */
  accent: string
  /** Optional brand logo / banner image URL shown centered in the header. */
  logoUrl: string
  /** Tournament / event name shown big + centered in the header. */
  tournamentName: string
  /** The host's display name (labels the host tile). */
  hostName: string
  /** Left team. */
  teamA: string
  /** Right team. */
  teamB: string
  /** Optional team crest URLs for the "A vs B" strip. */
  teamALogo: string
  teamBLogo: string
  /** Selected TKO clan/profile identity used by the live matchup. */
  teamAEntityId: string
  teamBEntityId: string
  teamAEntityType: '' | 'clan' | 'player'
  teamBEntityType: '' | 'clan' | 'player'
}

const KEY_PREFIX = 'kc_broadcast_theme:'
const EVENT = 'kc:broadcast-theme'

/** The brand's near-black + orange base. Accent defaults to TKO orange. */
export const DEFAULT_THEME: BroadcastTheme = {
  accent: '#ff7a18',
  logoUrl: '',
  tournamentName: 'TKO Live',
  hostName: 'Host',
  teamA: 'Team A',
  teamB: 'Team B',
  teamALogo: '',
  teamBLogo: '',
  teamAEntityId: '',
  teamBEntityId: '',
  teamAEntityType: '',
  teamBEntityType: '',
}

// Storage is injectable so tests can pass a fake; defaults to localStorage.
export interface ThemeStorage {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

function defaultStorage(): ThemeStorage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch { /* access blocked (SSR / private mode) */ }
  return null
}

function storageKey(key: string): string {
  return `${KEY_PREFIX}${key || 'default'}`
}

function broadcast(): void {
  if (typeof window === 'undefined') return
  try { window.dispatchEvent(new CustomEvent(EVENT)) } catch { /* non-DOM */ }
}

/**
 * Coerce any input into a safe #rrggbb hex, falling back to the default accent.
 * Accepts `#abc`, `#aabbcc`, or the same without the leading `#`.
 */
export function normalizeAccent(input: string | undefined | null): string {
  const raw = (input ?? '').trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const [r, g, b] = raw.split('')
    return `#${(r + r + g + g + b + b).toLowerCase()}`
  }
  return DEFAULT_THEME.accent
}

/** Load a host/tournament's theme, merged over the defaults (never partial). */
export function loadTheme(
  key: string,
  storage: ThemeStorage | null = defaultStorage(),
): BroadcastTheme {
  if (!storage) return { ...DEFAULT_THEME }
  try {
    const raw = storage.getItem(storageKey(key))
    if (!raw) return { ...DEFAULT_THEME }
    const parsed = JSON.parse(raw) as Partial<BroadcastTheme>
    return {
      ...DEFAULT_THEME,
      ...parsed,
      accent: normalizeAccent(parsed.accent),
    }
  } catch {
    return { ...DEFAULT_THEME }
  }
}

/** Persist a theme (partials merged over what's stored) and notify listeners. */
export function saveTheme(
  key: string,
  patch: Partial<BroadcastTheme>,
  storage: ThemeStorage | null = defaultStorage(),
): BroadcastTheme {
  const next: BroadcastTheme = {
    ...loadTheme(key, storage),
    ...patch,
  }
  next.accent = normalizeAccent(next.accent)
  if (storage) {
    try { storage.setItem(storageKey(key), JSON.stringify(next)) } catch { /* quota */ }
  }
  broadcast()
  return next
}

/** Subscribe a component to theme changes. Returns an unsubscribe fn. */
export function subscribeTheme(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => cb()
  window.addEventListener(EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}
