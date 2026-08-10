/**
 * League config — the ONE object the white-label League Studio edits and the
 * gateway/preview render. Its JSON shape mirrors the renderer's league files
 * (`Loras/assets/leagues/*.json`) so "Download league.json" is directly usable
 * by `tko_vertical.py --league <slug>`.
 *
 * Modeled on src/lib/broadcastTheme.ts: a localStorage-backed DRAFT store with
 * an injectable `ThemeStorage`, an event bus so every mounted PhonePreview
 * restyles live, and merge-over-defaults loading (never partial). The server
 * half (the `leagues` / `league_members` tables from the wire-in plan Step 3)
 * is reached through the Supabase shim and FAILS SOFT: with no backend the
 * gateway falls back to the seeded launch leagues and the Studio still works
 * as a pure local editor + JSON download.
 */

import type { ThemeStorage } from './broadcastTheme'
import { apiUrl } from './apiBase'
import { STOCK_LEAGUE_COLORS, TKO_NEUTRAL } from './leagueTheme'
import { MUSIC_LIBRARY, musicLabel, leagueAssetKit, type LeagueAssetKit } from './leagueAssets'
import {
  PART_LABEL,
  sanitizeLeagueStudioPatch,
  type LeaguePreviewPart,
} from './leagueStudioRanges'
import {
  isLeaguePlanId,
  leagueCan,
  planIsPaid,
  type LeaguePlanId,
  type LeaguePlanStatus,
} from './leaguePlans'

// The template asset manifest (intros/outros/banners/music) lives in
// src/lib/leagueAssets.ts so the server (GET /api/league/:slug/config) can
// share the exact same vocabulary. Re-exported here so existing importers
// (LeagueStudio and friends) keep working unchanged.
export { MUSIC_LIBRARY, musicLabel, leagueAssetKit }
export type { LeagueAssetKit, LeagueAssetOption } from './leagueAssets'

// The AI-chat guardrail vocabulary (template ranges + preview parts) lives in
// src/lib/leagueStudioRanges.ts, shared verbatim with the server fn.
export { PART_LABEL, sanitizeLeagueStudioPatch }
export type { LeaguePreviewPart }

// ───────────────────────────────────────────────────────────────────────────
//  Types + defaults
// ───────────────────────────────────────────────────────────────────────────

export type LeagueColors = {
  primary: string
  secondary: string
  accent: string
  text: string
}

/**
 * Owner plans — re-exported from THE catalogue (src/lib/leaguePlans.ts) rather
 * than re-declared. This type used to omit 'dynasty', which the DB CHECK has
 * always allowed, so rowToConfig() silently downgraded every Dynasty league to
 * 'starter' on read.
 */
export type LeagueTier = LeaguePlanId

/** Who owns the produced videos — the tier split from the operator brief. */
export type VideoOwnership = 'tko' | 'league'

export type LeagueConfig = {
  slug: string
  name: string
  domain: string
  tagline: string
  colors: LeagueColors
  /** Uploaded logo as a data: URL (Studio) or a hosted URL (saved league). */
  logoUrl: string
  /** Music file name from the TKO Suno library (see MUSIC_LIBRARY). */
  music: string
  video_ownership: VideoOwnership
  tier: LeagueTier
  /**
   * Whether the plan named by `tier` was actually PAID for — the server's
   * `leagues.plan_status`. `tier` alone entitles nothing (it defaults to
   * 'starter', which is itself a paid plan), so every gate reads BOTH through
   * leagueEntitlements(). A local Studio draft is always 'none'.
   */
  plan_status: LeaguePlanStatus
  /**
   * The league's template asset kit (intro/outro/banner/music manifest).
   * Derived — never stored: see leagueAssetKit() in src/lib/leagueAssets.ts.
   * Optional so drafts and seed configs stay lightweight; use leagueKitFor()
   * to read it with the TKO default fallback.
   */
  assets?: LeagueAssetKit
}

/**
 * The asset kit for a league config (or null/undefined = the TKO house kit).
 * The one accessor the reel builder + live overlays should use.
 */
export function leagueKitFor(cfg?: Pick<LeagueConfig, 'music' | 'assets'> | null): LeagueAssetKit {
  return cfg?.assets ?? leagueAssetKit(cfg ?? null)
}

/**
 * TKO neutral — the default Studio skin. Colors come from the TKO_NEUTRAL
 * token table in src/lib/leagueTheme.ts (palette v2, measured from the
 * operator's reference image 2026-08-03): sapphire primary, deep-royal
 * secondary (the preview derives its navy screens from it), spring-green
 * accent, ice text. Keep Loras/assets/leagues/tko.json (the renderer's
 * palette) in step with these four values.
 */
export const DEFAULT_LEAGUE_CONFIG: LeagueConfig = {
  slug: 'tko',
  name: 'TKO',
  domain: 'tko.cam',
  tagline: 'every angle. one cam.',
  colors: {
    primary: TKO_NEUTRAL.blue,
    secondary: TKO_NEUTRAL.royal,
    accent: TKO_NEUTRAL.teal,
    text: TKO_NEUTRAL.ice,
  },
  logoUrl: '',
  music: '',
  video_ownership: 'tko',
  tier: 'starter',
  // A draft has never been bought. Every capability gate answers "no" until the
  // server says otherwise, which is the safe direction for an unsaved league.
  plan_status: 'none',
}

/**
 * Launch leagues shown on the gateway when the `leagues` table is empty or the
 * backend is unreachable. shinobistrikerleague.com is league #1; TKO itself is
 * the house league.
 */
export const SEED_LEAGUES: LeagueConfig[] = [
  {
    slug: 'shinobistrikerleague',
    name: 'SHINOBI STRIKER LEAGUE',
    domain: 'shinobistrikerleague.com',
    tagline: 'rise. strike. reign.',
    // SSL = branding-only takeover; colors stay stock (operator 2026-08-02).
    // The indigo/red/cream of Loras/assets/leagues/shinobistrikerleague.json
    // are LOGO/renderer colors, not UI chrome — the app keeps the stock
    // dark+accent scheme (see STOCK_LEAGUE_COLORS / index.css defaults).
    colors: { ...STOCK_LEAGUE_COLORS },
    logoUrl: '',
    music: 'suno_shinobi_striker_league.mp3',
    video_ownership: 'league',
    // The operator's own league receives the complete clean-brand build.
    tier: 'enterprise',
    // Both house leagues are operator-comped: they predate billing and must not
    // lose their skin the day entitlements start reading plan_status. Mirrors
    // the grandfathering UPDATE in db/schema.sql / server/index.ts.
    plan_status: 'comped',
  },
  {
    // League #3, and the first that is not a video game (operator 2026-08-06).
    // Circus Runaways is a breaking crew est. 2000; the league is the TKO
    // adaptation of their "Originality: the Fifth Element of Breaking"
    // standard, launching at the March 2027 anniversary.
    slug: 'circusrunaways',
    name: 'CIRCUS RUNAWAYS',
    // RUNG 3 — its own domain, entitled by the enterprise plan. The host does
    // not match the slug (see KNOWN_LEAGUE_HOSTS in LeagueWatermark.tsx).
    domain: 'thecircusrunaways.com',
    tagline: 'originality is the fifth element',
    // Unlike SSL — which runs stock chrome deliberately — this league DOES
    // re-skin: the operator asked for its own scheme. Measured off the crew's
    // anniversary key art: circus red, marquee gold, antique cream on
    // night-sky black. Keep in step with Loras/assets/leagues/circusrunaways.json.
    colors: {
      primary: '#c1272d',
      secondary: '#0d0e1a',
      accent: '#e8b84b',
      text: '#f2e3c0',
    },
    logoUrl: '',
    // No league track yet — killcam_clips/music/circusrunaways/ is empty, and
    // an empty pool falls back to a SHINOBI track. Brand leak, not a crash.
    music: '',
    video_ownership: 'league',
    tier: 'enterprise',
    // Comped, not sold: this is the operator's own project and the enterprise
    // plan is deliberately not purchasable (leaguePlans.ts).
    plan_status: 'comped',
  },
  { ...DEFAULT_LEAGUE_CONFIG, plan_status: 'comped' },
]

// (MUSIC_LIBRARY / musicLabel moved to src/lib/leagueAssets.ts — re-exported above.)

// ───────────────────────────────────────────────────────────────────────────
//  Small pure helpers
// ───────────────────────────────────────────────────────────────────────────

/** Coerce input into #rrggbb, or return null when it isn't hex-like. */
export function toHex(input: string | undefined | null): string | null {
  const raw = (input ?? '').trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const [r, g, b] = raw.split('')
    return `#${(r + r + g + g + b + b).toLowerCase()}`
  }
  return null
}

/** URL-safe league slug from a display name ("Blaze League" → "blazeleague"). */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40) || 'league'
}

/** Lighten (positive) / darken (negative) a hex color by `amount` 0..1. */
export function shade(hex: string, amount: number): string {
  const h = toHex(hex)
  if (!h) return hex
  const n = parseInt(h.slice(1), 16)
  const ch = (v: number) => {
    const next = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)
    return Math.max(0, Math.min(255, Math.round(next)))
  }
  const r = ch((n >> 16) & 255)
  const g = ch((n >> 8) & 255)
  const b = ch(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

/** Named colors the chat editor understands ("crimson and gold"). */
export const COLOR_NAMES: Record<string, string> = {
  red: '#e03131', crimson: '#a61e2e', scarlet: '#ff2400', maroon: '#6d071a',
  orange: '#ff7a18', amber: '#ffb224', gold: '#f5c542', yellow: '#ffd43b',
  green: '#2ccb7f', emerald: '#0f9d58', teal: '#12b5a5', cyan: '#2ed3dc',
  blue: '#2563ff', navy: '#0e1a2f', indigo: '#484878', purple: '#7048e8',
  violet: '#9775fa', pink: '#f06595', magenta: '#d6336c',
  black: '#0a0a0c', white: '#ffffff', cream: '#f0f0c0', silver: '#c0c4cc',
  gray: '#868e96', grey: '#868e96', brown: '#795234',
}

/** Resolve a word or hex string to a #rrggbb hex, else null. */
export function parseColorWord(word: string): string | null {
  const w = word.trim().toLowerCase()
  return COLOR_NAMES[w] ?? toHex(w)
}

/**
 * ONE-TAP PALETTES — the fast lane's entire color step (operator 2026-08-04:
 * "they could just drop branding and go"). Picking a preset writes the three
 * themable slots at once, which restyles every preview surface instantly, so an
 * owner who does not want to think about hex codes is done in one click.
 *
 * `text` is deliberately left alone: it is the app's ink slot and the theme
 * derives readable ink per surface (see leagueThemeVars) — letting a preset
 * push it is how you get white-on-white.
 */
export type LeaguePalettePreset = {
  id: string
  label: string
  colors: Pick<LeagueColors, 'primary' | 'secondary' | 'accent'>
}

export const PALETTE_PRESETS: LeaguePalettePreset[] = [
  {
    id: 'midnight',
    label: 'Midnight',
    colors: { primary: TKO_NEUTRAL.blue, secondary: TKO_NEUTRAL.royal, accent: TKO_NEUTRAL.teal },
  },
  {
    id: 'crimson',
    label: 'Crimson',
    colors: { primary: '#c0202f', secondary: '#2a0a0e', accent: '#f5c542' },
  },
  {
    id: 'emerald',
    label: 'Emerald',
    colors: { primary: '#0f9d58', secondary: '#07281a', accent: '#8ef0bd' },
  },
  {
    id: 'violet',
    label: 'Violet',
    colors: { primary: '#7048e8', secondary: '#1b1033', accent: '#e5b4ff' },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    colors: { primary: '#f2610c', secondary: '#2b1104', accent: '#ffd43b' },
  },
  {
    id: 'ice',
    label: 'Ice',
    colors: { primary: '#1aa9c4', secondary: '#062430', accent: '#9de6f5' },
  },
  {
    id: 'mono',
    label: 'Mono',
    colors: { primary: '#3c4757', secondary: '#0b0f14', accent: '#cbd5e1' },
  },
]

/** The preset a config currently matches (all three slots), or null. */
export function matchingPalettePreset(colors: LeagueColors): LeaguePalettePreset | null {
  return (
    PALETTE_PRESETS.find(
      (p) =>
        p.colors.primary === colors.primary &&
        p.colors.secondary === colors.secondary &&
        p.colors.accent === colors.accent,
    ) ?? null
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  Draft store (localStorage + event bus, storage injectable like
//  broadcastTheme.ts so tests can pass a fake)
// ───────────────────────────────────────────────────────────────────────────

const DRAFT_KEY = 'tko_league_draft'
const DRAFT_EVENT = 'tko:league-draft'

/** The league a visitor/member is currently "inside" — the Step 2
 *  LeagueThemeProvider keys the app skin off this slug. */
const ACTIVE_KEY = 'tko_league_active'

function defaultStorage(): ThemeStorage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch { /* access blocked (SSR / private mode) */ }
  return null
}

function emitDraftChange(): void {
  if (typeof window === 'undefined') return
  try { window.dispatchEvent(new CustomEvent(DRAFT_EVENT)) } catch { /* non-DOM */ }
}

function normalizeColors(colors: Partial<LeagueColors> | undefined): LeagueColors {
  const d = DEFAULT_LEAGUE_CONFIG.colors
  return {
    primary: toHex(colors?.primary) ?? d.primary,
    secondary: toHex(colors?.secondary) ?? d.secondary,
    accent: toHex(colors?.accent) ?? d.accent,
    text: toHex(colors?.text) ?? d.text,
  }
}

/** Load the Studio draft, merged over the TKO defaults (never partial). */
export function loadLeagueDraft(storage: ThemeStorage | null = defaultStorage()): LeagueConfig {
  if (!storage) return { ...DEFAULT_LEAGUE_CONFIG }
  try {
    const raw = storage.getItem(DRAFT_KEY)
    if (!raw) return { ...DEFAULT_LEAGUE_CONFIG }
    const parsed = JSON.parse(raw) as Partial<LeagueConfig>
    return {
      ...DEFAULT_LEAGUE_CONFIG,
      ...parsed,
      colors: normalizeColors(parsed.colors),
    }
  } catch {
    return { ...DEFAULT_LEAGUE_CONFIG }
  }
}

/** Persist a draft patch (merged over what's stored) and notify listeners. */
export function saveLeagueDraft(
  patch: Partial<LeagueConfig>,
  storage: ThemeStorage | null = defaultStorage(),
): LeagueConfig {
  const cur = loadLeagueDraft(storage)
  const next: LeagueConfig = {
    ...cur,
    ...patch,
    colors: normalizeColors({ ...cur.colors, ...(patch.colors ?? {}) }),
  }
  // Renaming the league re-derives slug + domain unless explicitly provided.
  if (patch.name != null && patch.slug == null) next.slug = slugify(patch.name)
  if (patch.name != null && patch.domain == null) next.domain = `${next.slug}.tko.cam`
  if (storage) {
    try { storage.setItem(DRAFT_KEY, JSON.stringify(next)) } catch { /* quota */ }
  }
  emitDraftChange()
  return next
}

/** Reset the draft back to TKO neutral. */
export function resetLeagueDraft(storage: ThemeStorage | null = defaultStorage()): LeagueConfig {
  if (storage) {
    try { storage.setItem(DRAFT_KEY, JSON.stringify(DEFAULT_LEAGUE_CONFIG)) } catch { /* quota */ }
  }
  emitDraftChange()
  return { ...DEFAULT_LEAGUE_CONFIG }
}

/** Subscribe a component to draft changes. Returns an unsubscribe fn. */
export function subscribeLeagueDraft(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => cb()
  window.addEventListener(DRAFT_EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(DRAFT_EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Logo upload path — the ONE way a logo enters the draft (Studio panel button
//  AND preview drag-and-drop both go through here). The image becomes a data:
//  URL on the draft's `logoUrl`; the chat AI can only ever CLEAR that slot (see
//  leagueStudioRanges.ts), so uploaded logos are the only images in the chrome.
// ───────────────────────────────────────────────────────────────────────────

/** True for a droppable/uploadable image file (used by the drop targets). */
export function isImageFile(file: File | null | undefined): boolean {
  return !!file && typeof file.type === 'string' && file.type.startsWith('image/')
}

/** Read an image File to a data: URL (the Studio's existing FileReader path). */
export function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('image read failed'))
    reader.readAsDataURL(file)
  })
}

/** Apply an already-read logo data URL to the shared draft (drop-to-apply). */
export function applyLogoDataUrl(
  dataUrl: string,
  storage: ThemeStorage | null = defaultStorage(),
): LeagueConfig {
  return saveLeagueDraft({ logoUrl: dataUrl }, storage)
}

/**
 * The whole logo-upload gesture in one call: validate → read → apply to the
 * draft. Returns the new config, or null when the file wasn't an image (so a
 * caller can ignore a stray drop). Shared by the Studio's upload button and
 * every preview drop target.
 */
export async function uploadLogoFile(
  file: File | null | undefined,
  storage: ThemeStorage | null = defaultStorage(),
): Promise<LeagueConfig | null> {
  if (!isImageFile(file)) return null
  const dataUrl = await readImageFileAsDataUrl(file as File)
  if (!dataUrl) return null
  return applyLogoDataUrl(dataUrl, storage)
}

/** Event fired whenever the active-league slug changes (same tab). */
const ACTIVE_EVENT = 'tko:league-active'

/** Remember which league the current visitor is inside (skin key for Step 2). */
export function setActiveLeagueSlug(slug: string, storage: ThemeStorage | null = defaultStorage()): void {
  if (storage) {
    try { storage.setItem(ACTIVE_KEY, slug) } catch { /* quota */ }
  }
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent(ACTIVE_EVENT)) } catch { /* non-DOM */ }
  }
}

export function getActiveLeagueSlug(storage: ThemeStorage | null = defaultStorage()): string {
  try { return storage?.getItem(ACTIVE_KEY) ?? '' } catch { return '' }
}

/** Subscribe to active-league changes (this tab + other tabs). Returns unsubscribe. */
export function subscribeActiveLeague(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => cb()
  window.addEventListener(ACTIVE_EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(ACTIVE_EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Renderer-compatible JSON ("Download league.json")
// ───────────────────────────────────────────────────────────────────────────

/**
 * Serialize to the `Loras/assets/leagues/*.json` schema the renderer reads.
 *
 * THIS FILE IS THE ENTITLEMENT'S DELIVERY VEHICLE. The render factory does not
 * call our API — all three of its loaders (tko_factory.py, tko_vertical.py,
 * tko_recorder.py) read `Loras/assets/leagues/<slug>.json` off disk. So the
 * white-label purchase becomes real at the moment this JSON is installed on the
 * factory box: `clean_brand: true` is what makes tko_vertical.py stop compositing
 * the TKO watermark and tko_factory.py stop appending the TKO pitch line, site
 * and hashtags to every title and caption.
 *
 * `clean_brand` is emitted ONLY when the league is entitled, and it is omitted
 * (rather than written `false`) otherwise, so an unpaid league's file is
 * byte-identical to what it produces today.
 */
export function toRendererJson(cfg: LeagueConfig): Record<string, unknown> {
  const clean = leagueCan('clean_brand', cfg.tier, cfg.plan_status)
  return {
    name: cfg.name,
    domain: cfg.domain,
    colors: {
      primary: cfg.colors.primary,
      secondary: cfg.colors.secondary,
      accent: cfg.colors.accent,
      text: cfg.colors.text,
    },
    assets_dir: `assets/leagues/${cfg.slug}`,
    music: cfg.music,
    // Collapsed to what the plan entitles — the stored column is Studio-writable
    // and an unpaid league may well have 'league' sitting in it.
    video_ownership: planIsPaid(cfg.plan_status) ? cfg.video_ownership : 'tko',
    tagline: cfg.tagline,
    ...(clean ? { clean_brand: true } : {}),
  }
}

/** Trigger a browser download of the renderer-compatible league.json. */
export function downloadLeagueJson(cfg: LeagueConfig): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([JSON.stringify(toRendererJson(cfg), null, 1)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'league.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ───────────────────────────────────────────────────────────────────────────
//  Chat editor — the free-form intent matcher
// ───────────────────────────────────────────────────────────────────────────

export type ChatIntentResult = {
  /** The config patch this prompt produces, or null when nothing matched. */
  patch: Partial<LeagueConfig> | null
  /** Assistant reply bubble text. */
  reply: string
}

const SLOT_WORDS: Record<string, keyof LeagueColors> = {
  primary: 'primary',
  main: 'primary',
  secondary: 'secondary',
  background: 'secondary',
  accent: 'accent',
  highlight: 'accent',
  text: 'text',
}

/**
 * Turn a free-form prompt into a config patch. Template edits only — name,
 * tagline, the four color slots, darker/lighter, and music picks. Pure so the
 * Studio chat stays a thin shell around it.
 *
 * With a `part` (a click-to-reference blue tag from the phone preview) the
 * prompt is interpreted FOR that part only, and the patch can only touch that
 * part's fields — the local mirror of the server-side PART_FIELDS scoping.
 */
export function applyChatIntent(
  cfg: LeagueConfig,
  prompt: string,
  part: LeaguePreviewPart | null = null,
): ChatIntentResult {
  const p = prompt.trim()
  if (!p) return { patch: null, reply: 'Say something like "make the accent gold".' }
  if (part) return applyPartScopedIntent(cfg, p, part)

  // "call it Blaze League" / "name it ..." / "rename to ..."
  const nameM = p.match(/(?:call it|name it|rename(?: it)?(?: to)?|league name(?: is)?)\s+(.{2,60})/i)
  if (nameM) {
    const name = nameM[1].replace(/["'.]+$/g, '').trim()
    return { patch: { name }, reply: `Done — your league is now "${name}".` }
  }

  // "tagline: rise and grind" / "set the tagline to ..."
  const tagM = p.match(/tagline(?:\s*(?:is|to|:|=))?\s+(.{2,80})/i)
  if (tagM) {
    const tagline = tagM[1].replace(/["']+$/g, '').trim()
    return { patch: { tagline }, reply: `Tagline set: "${tagline}".` }
  }

  // "music: shadow kage" / "use the samurai track"
  if (/\b(music|track|song|anthem)\b/i.test(p)) {
    const hit = MUSIC_LIBRARY.find((t) => p.toLowerCase().includes(t.label.toLowerCase()))
      ?? MUSIC_LIBRARY.find((t) =>
        t.label.toLowerCase().split(/\s+/).some((w) => w.length > 3 && p.toLowerCase().includes(w)))
    if (hit) return { patch: { music: hit.file }, reply: `Music set to "${hit.label}".` }
    return {
      patch: null,
      reply: `Pick a track from the TKO library: ${MUSIC_LIBRARY.slice(0, 6).map((t) => t.label).join(', ')}…`,
    }
  }

  // "darker background" / "lighter"
  const darkM = p.match(/\b(darker|lighter)\b/i)
  if (darkM) {
    const dir = darkM[1].toLowerCase() === 'darker' ? -0.25 : 0.25
    const slotWord = Object.keys(SLOT_WORDS).find((w) => p.toLowerCase().includes(w))
    const slot = slotWord ? SLOT_WORDS[slotWord] : 'secondary'
    const next = shade(cfg.colors[slot], dir)
    return {
      patch: { colors: { ...cfg.colors, [slot]: next } },
      reply: `Made the ${slot} color ${darkM[1].toLowerCase()} (${next}).`,
    }
  }

  // "make the accent gold" / "primary #480000" / "set text to cream"
  const slotWord = Object.keys(SLOT_WORDS).find((w) => new RegExp(`\\b${w}\\b`, 'i').test(p))
  if (slotWord) {
    const slot = SLOT_WORDS[slotWord]
    const hexM = p.match(/#?[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/)
    let hex = hexM ? toHex(hexM[0]) : null
    if (!hex) {
      for (const w of p.toLowerCase().split(/[^a-z]+/)) {
        if (w && w !== slotWord && COLOR_NAMES[w]) { hex = COLOR_NAMES[w]; break }
      }
    }
    if (hex) {
      return {
        patch: { colors: { ...cfg.colors, [slot]: hex } },
        reply: `${slot[0].toUpperCase()}${slot.slice(1)} color is now ${hex}.`,
      }
    }
    return { patch: null, reply: `What color for ${slot}? Name it (gold, crimson…) or paste a hex like #480000.` }
  }

  // Bare pair of colors ("crimson and gold") → primary + accent.
  const words = p.toLowerCase().split(/[^a-z0-9#]+/).filter(Boolean)
  const found = words.map(parseColorWord).filter((h): h is string => !!h)
  if (found.length >= 2) {
    return {
      patch: { colors: { ...cfg.colors, primary: found[0], accent: found[1] } },
      reply: `Colors set — primary ${found[0]}, accent ${found[1]}.`,
    }
  }
  if (found.length === 1) {
    return {
      patch: { colors: { ...cfg.colors, primary: found[0] } },
      reply: `Primary color set to ${found[0]}.`,
    }
  }

  return {
    patch: null,
    reply: 'I can rename the league, set the tagline, change any color ("make the accent gold", "#480000 background"), go darker/lighter, or pick music. Flip to Direct input for full control.',
  }
}

/**
 * The part-scoped half of applyChatIntent — the prompt arrived with a blue
 * reference tag from the preview, so the whole message is ABOUT that part.
 * Each branch can only ever emit that part's fields (see PART_FIELDS in
 * leagueStudioRanges.ts), which keeps the local matcher inside the exact
 * guardrails the server enforces on the AI.
 */
function applyPartScopedIntent(
  cfg: LeagueConfig,
  p: string,
  part: LeaguePreviewPart,
): ChatIntentResult {
  switch (part) {
    case 'name': {
      const m = p.match(/(?:call it|name it|rename(?: it)?(?: to)?|league name(?: is)?)\s+(.{2,60})/i)
      const name = (m ? m[1] : p).replace(/["'.]+$/g, '').trim().slice(0, 60)
      if (name.length < 2) return { patch: null, reply: 'Tell me the new league name.' }
      return { patch: { name }, reply: `Done — your league is now "${name}".` }
    }
    case 'tagline': {
      const m = p.match(/tagline(?:\s*(?:is|to|:|=))?\s+(.{2,80})/i)
      const tagline = (m ? m[1] : p).replace(/["']+$/g, '').trim().slice(0, 80)
      if (!tagline) return { patch: null, reply: 'Tell me the new tagline.' }
      return { patch: { tagline }, reply: `Tagline set: "${tagline}".` }
    }
    case 'logo': {
      if (/\b(remove|clear|delete|drop|none|no logo)\b/i.test(p)) {
        return { patch: { logoUrl: '' }, reply: 'Logo removed — the monogram is back.' }
      }
      return {
        patch: null,
        reply: 'Use the "Upload logo" button (in chat or the basics panel) to change the logo — or say "remove the logo".',
      }
    }
    case 'music': {
      if (/\b(off|none|silent|mute|no music|remove)\b/i.test(p)) {
        return { patch: { music: '' }, reply: 'Music off.' }
      }
      const lower = p.toLowerCase()
      const hit =
        MUSIC_LIBRARY.find((t) => lower.includes(t.label.toLowerCase())) ??
        MUSIC_LIBRARY.find((t) =>
          t.label.toLowerCase().split(/\s+/).some((w) => w.length > 3 && lower.includes(w)))
      if (hit) return { patch: { music: hit.file }, reply: `Music set to "${hit.label}".` }
      return {
        patch: null,
        reply: `Pick a track from the TKO library: ${MUSIC_LIBRARY.slice(0, 6).map((t) => t.label).join(', ')}…`,
      }
    }
    case 'banner':
    case 'colors': {
      const darkM = p.match(/\b(darker|lighter)\b/i)
      const slotWord = Object.keys(SLOT_WORDS).find((w) => new RegExp(`\\b${w}\\b`, 'i').test(p))
      if (darkM) {
        const dir = darkM[1].toLowerCase() === 'darker' ? -0.25 : 0.25
        const slot = slotWord ? SLOT_WORDS[slotWord] : part === 'banner' ? 'accent' : 'secondary'
        const next = shade(cfg.colors[slot], dir)
        return {
          patch: { colors: { ...cfg.colors, [slot]: next } },
          reply: `Made the ${slot} color ${darkM[1].toLowerCase()} (${next}).`,
        }
      }
      const found = p.toLowerCase().split(/[^a-z0-9#]+/).map(parseColorWord)
        .filter((h): h is string => !!h)
      if (found.length === 0) {
        return { patch: null, reply: 'Name a color (gold, crimson…) or paste a hex like #480000.' }
      }
      if (part === 'banner') {
        return {
          patch: { colors: { ...cfg.colors, accent: found[0] } },
          reply: `Banner accent set to ${found[0]}.`,
        }
      }
      if (slotWord) {
        const slot = SLOT_WORDS[slotWord]
        return {
          patch: { colors: { ...cfg.colors, [slot]: found[0] } },
          reply: `${slot[0].toUpperCase()}${slot.slice(1)} color is now ${found[0]}.`,
        }
      }
      if (found.length >= 2) {
        return {
          patch: { colors: { ...cfg.colors, primary: found[0], accent: found[1] } },
          reply: `Colors set — primary ${found[0]}, accent ${found[1]}.`,
        }
      }
      return {
        patch: { colors: { ...cfg.colors, primary: found[0] } },
        reply: `Primary color set to ${found[0]}.`,
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Chat editor — the AI-backed path (server fn + local fallback)
// ───────────────────────────────────────────────────────────────────────────

export type ChatIntentAIResult = ChatIntentResult & {
  /** Which brain answered — 'ai' (server Gemini fn) or 'local' (fallback). */
  source: 'ai' | 'local'
}

/**
 * The real-AI chat path: POST /api/fn/league-studio-chat with the message,
 * the (optional) preview part reference, and a small summary of the current
 * draft. The server interprets with Gemini and returns a patch ALREADY forced
 * through the template ranges (src/lib/leagueStudioRanges.ts).
 *
 * BELT AND BRACES: the same validator runs again here on the response, so a
 * stale or misbehaving server can never push a structural change into the
 * draft either. Any failure — signed out, offline, rate-limited, model error
 * — falls back to the local intent matcher, so chat always answers.
 */
export async function applyChatIntentAI(
  cfg: LeagueConfig,
  prompt: string,
  part: LeaguePreviewPart | null = null,
): Promise<ChatIntentAIResult> {
  const message = prompt.trim().slice(0, 500)
  if (message) {
    try {
      const { callFn } = await import('./backend')
      const res = await callFn<{ ok?: boolean; reply?: string; patch?: unknown }>(
        'league-studio-chat',
        {
          message,
          part: part ?? undefined,
          // Summary only — never the logo data URL (it can be megabytes).
          config: {
            name: cfg.name,
            tagline: cfg.tagline,
            colors: cfg.colors,
            music: cfg.music,
            hasLogo: Boolean(cfg.logoUrl),
          },
        },
      )
      if (res?.ok && typeof res.reply === 'string' && res.reply.trim()) {
        const { patch } = sanitizeLeagueStudioPatch(res.patch, part)
        let merged: Partial<LeagueConfig> | null = null
        if (patch) {
          merged = {}
          if (patch.name !== undefined) merged.name = patch.name
          if (patch.tagline !== undefined) merged.tagline = patch.tagline
          if (patch.music !== undefined) merged.music = patch.music
          if (patch.logoUrl !== undefined) merged.logoUrl = patch.logoUrl
          if (patch.colors) merged.colors = { ...cfg.colors, ...patch.colors }
        }
        return { patch: merged, reply: res.reply.trim(), source: 'ai' }
      }
    } catch { /* unreachable/offline — the local matcher below still answers */ }
  }
  return { ...applyChatIntent(cfg, prompt, part), source: 'local' }
}

// ───────────────────────────────────────────────────────────────────────────
//  Server half — leagues / league_members (fail-soft, plan Step 3 tables)
// ───────────────────────────────────────────────────────────────────────────

type LeagueRow = {
  id?: string
  slug: string
  name: string
  domain?: string | null
  colors?: Partial<LeagueColors> | null
  logo_url?: string | null
  tagline?: string | null
  music?: { track?: string } | string | null
  video_ownership?: string | null
  tier?: string | null
  plan_status?: string | null
  owner_id?: string | null
}

const PLAN_STATUSES: readonly LeaguePlanStatus[] = [
  'none', 'active', 'comped', 'past_due', 'canceled',
]

/**
 * Narrow a stored plan_status, defaulting to 'none'.
 *
 * Defaulting to the UNPAID value is the safe direction: a row from an older
 * deploy that predates the column reads as unentitled rather than as a free
 * Dynasty. The two house leagues are comped explicitly by the boot DDL.
 */
function planStatusOf(raw: string | null | undefined): LeaguePlanStatus {
  return PLAN_STATUSES.includes(raw as LeaguePlanStatus) ? (raw as LeaguePlanStatus) : 'none'
}

function rowToConfig(row: LeagueRow): LeagueConfig {
  const music = typeof row.music === 'string' ? row.music : row.music?.track ?? ''
  return {
    slug: row.slug,
    name: row.name || row.slug,
    domain: row.domain || `${row.slug}.tko.cam`,
    tagline: row.tagline || '',
    colors: normalizeColors(row.colors ?? undefined),
    logoUrl: row.logo_url || '',
    music,
    video_ownership: row.video_ownership === 'league' ? 'league' : 'tko',
    // isLeaguePlanId covers all four plans. The old literal list omitted
    // 'dynasty', so a Dynasty league read back as 'starter' — silently
    // downgrading a customer to the plan below the one they paid for.
    tier: (isLeaguePlanId(row.tier) ? row.tier : 'starter') as LeagueTier,
    plan_status: (planStatusOf(row.plan_status)),
    // Derived manifest (never stored on the row) so every consumer of a
    // fetched league — reel builder, live overlays — gets the branded kit.
    assets: leagueAssetKit({ music }),
  }
}

async function backendClient(): Promise<any | null> {
  try {
    const m = await import('./backend')
    return await m.backend()
  } catch {
    return null
  }
}

/** Every browsable league, falling back to the seeded launch leagues. */
export async function listLeagues(): Promise<LeagueConfig[]> {
  const sb = await backendClient()
  if (!sb) return SEED_LEAGUES
  try {
    const { data, error } = await sb.from('leagues').select('*').order('name', { ascending: true })
    if (error || !Array.isArray(data) || data.length === 0) return SEED_LEAGUES
    return (data as LeagueRow[]).filter((r) => r?.slug).map(rowToConfig)
  } catch {
    return SEED_LEAGUES
  }
}

/**
 * Upsert the Studio config as the caller's league ("Save" in the Studio) and
 * make the caller its owner-member. Returns true only when the row landed.
 */
export async function upsertLeague(cfg: LeagueConfig, ownerId: string): Promise<boolean> {
  const sb = await backendClient()
  if (!sb) return false
  try {
    const { error } = await sb.from('leagues').upsert({
      slug: cfg.slug,
      name: cfg.name,
      domain: cfg.domain,
      colors: cfg.colors,
      logo_url: cfg.logoUrl,
      tagline: cfg.tagline,
      music: { track: cfg.music },
      // `tier` and `video_ownership` are deliberately NOT sent. They are
      // PRIVILEGE_COLS on the server (written only by the Stripe webhook), so
      // sending them would be scrubbed silently — and a client that pretends to
      // set its own plan is exactly the bug this whole path exists to close.
      // Buying a plan goes through POST /api/league/checkout.
      owner_id: ownerId,
    })
    if (error) return false
    // Owner membership is what routes this user's `/` into their league.
    const { data: row } = await sb.from('leagues').select('id').eq('slug', cfg.slug).maybeSingle()
    if (row?.id) {
      await sb.from('league_members').upsert({ league_id: row.id, user_id: ownerId, role: 'owner' })
    }
    return true
  } catch {
    return false
  }
}

/** Valid slug shape — mirrors the server's check and the DB constraint. */
export const LEAGUE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

/**
 * The public config of ONE league, by slug — `GET /api/league/:slug/config`,
 * the same endpoint the renderer reads. This is what the DOMAIN TAKEOVER uses:
 * when the SPA boots on a league's own domain, the resolved slug is fetched
 * here and fed to the LeagueThemeProvider so the whole app wears the league.
 *
 * FAILS SOFT twice over: an unreachable or erroring API falls back to the
 * seeded launch leagues, and an unknown slug resolves to null (the stock TKO
 * look). A league domain must NEVER boot into a broken app.
 */
export async function fetchLeagueBySlug(slug: string): Promise<LeagueConfig | null> {
  const clean = (slug ?? '').trim().toLowerCase()
  if (!LEAGUE_SLUG_RE.test(clean)) return null
  try {
    const res = await fetch(apiUrl(`/league/${clean}/config`))
    if (res.ok) {
      const row = (await res.json()) as LeagueRow | null
      if (row && typeof row === 'object' && row.slug) return rowToConfig(row)
    }
  } catch { /* offline / no API — fall through to the seeds */ }
  return SEED_LEAGUES.find((l) => l.slug === clean) ?? null
}

/**
 * The league a GROUP of users competes in — the first membership found among
 * them. This is how a produced multi-angle video gets its league context: the
 * video carries no league column, but the players in it do. Public read, so it
 * resolves for a signed-out visitor following a shared link.
 */
export async function fetchLeagueForMembers(userIds: string[]): Promise<LeagueConfig | null> {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return null
  const sb = await backendClient()
  if (!sb) return null
  try {
    const { data: members } = await sb.from('league_members').select('league_id').in('user_id', ids)
    const leagueId = (Array.isArray(members) ? members : []).find((m: any) => m?.league_id)?.league_id
    if (!leagueId) return null
    const { data: row } = await sb.from('leagues').select('*').eq('id', leagueId).maybeSingle()
    return row?.slug ? rowToConfig(row as LeagueRow) : null
  } catch {
    return null
  }
}

/**
 * The league a signed-in user belongs to (owner or member) — what the root
 * route uses to drop them straight into THEIR league. Null when unaffiliated
 * (they ride in the TKO house league).
 */
export async function fetchMemberLeague(userId: string): Promise<LeagueConfig | null> {
  const sb = await backendClient()
  if (!sb) return null
  try {
    const { data: member } = await sb
      .from('league_members')
      .select('league_id')
      .eq('user_id', userId)
      .limit(1)
    const leagueId = Array.isArray(member) ? member[0]?.league_id : null
    if (!leagueId) return null
    const { data: row } = await sb.from('leagues').select('*').eq('id', leagueId).maybeSingle()
    return row?.slug ? rowToConfig(row as LeagueRow) : null
  } catch {
    return null
  }
}
