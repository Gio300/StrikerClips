/**
 * League Studio AI ranges — the HARD, SERVER-ENFORCED guardrails for the
 * Studio's AI chat (and any other automated patcher of a league config).
 *
 * THE RULE (operator brief): a league app is ALWAYS the same TKO app wearing
 * the league's skin. The AI may restyle inside the template — the league
 * name, the tagline, the four color slots, a music track from the TKO
 * library, and clearing the logo slot — and NOTHING ELSE. No routes, screens,
 * features, tiers, plans, slugs, domains or ownership flags can ever ride in
 * on a chat patch: sanitizeLeagueStudioPatch() CLAMPS what it can (length
 * caps, hex normalization, library lookup) and DROPS what it can't, so
 * out-of-range AI output is never applied.
 *
 * Enforced twice on purpose:
 *   • server/app.ts (the `league-studio-chat` fn) runs it on whatever Gemini
 *     returns, BEFORE the patch leaves the server;
 *   • src/lib/leagueConfig.ts (applyChatIntentAI) runs it AGAIN on whatever
 *     the server returns, so a stale or hostile server can't push a
 *     structural change into the draft either.
 *
 * Pure + dependency-light (only the leagueAssets manifest) so both sides
 * import the exact same law — mirroring how src/lib/leagueAssets.ts is shared.
 */

import { MUSIC_LIBRARY } from './leagueAssets'

// ───────────────────────────────────────────────────────────────────────────
//  The ranges constant
// ───────────────────────────────────────────────────────────────────────────

export const LEAGUE_COLOR_SLOTS = ['primary', 'secondary', 'accent', 'text'] as const
export type LeagueColorSlot = (typeof LEAGUE_COLOR_SLOTS)[number]

/**
 * The whole template, as data. Every AI (or remote) patch is validated
 * against this — fields not listed here simply cannot be patched via chat.
 */
export const LEAGUE_STUDIO_RANGES = {
  /** Whitelisted patchable fields — anything else is dropped, never applied. */
  fields: ['name', 'tagline', 'colors', 'music', 'logoUrl'] as const,
  /** League display name — same cap as the Studio's direct input. */
  name: { minLength: 1, maxLength: 60 },
  /** Tagline — '' is a valid value (clears it). */
  tagline: { minLength: 0, maxLength: 80 },
  /** The four color slots; values must normalize to #rrggbb hex. */
  colors: { slots: LEAGUE_COLOR_SLOTS, hex: /^#[0-9a-f]{6}$/ },
  /** Music must come from the TKO Suno library ('' = no music). */
  music: { files: MUSIC_LIBRARY.map((t) => t.file), allowEmpty: true },
  /**
   * The AI can only CLEAR the logo slot ('' — "remove my logo"). Setting a
   * logo goes through the Studio's upload button; a model-invented URL is
   * dropped so chat can never inject remote content into the app chrome.
   */
  logoUrl: { allowedValues: [''] as readonly string[] },
} as const

// ───────────────────────────────────────────────────────────────────────────
//  Click-to-reference parts (the preview's blue tags)
// ───────────────────────────────────────────────────────────────────────────

/** Clickable areas of the phone preview — each becomes a blue chat tag. */
export const LEAGUE_PREVIEW_PARTS = [
  'logo',
  'name',
  'tagline',
  'colors',
  'banner',
  'music',
] as const
export type LeaguePreviewPart = (typeof LEAGUE_PREVIEW_PARTS)[number]

/**
 * Which whitelisted fields a part-scoped request may patch. When the operator
 * clicks (say) the tagline strip and asks for a change, the AI's patch is
 * validated against THIS subset — a part-scoped ask can only ever move that
 * part's fields, everything else is dropped.
 */
export const PART_FIELDS: Record<LeaguePreviewPart, readonly (typeof LEAGUE_STUDIO_RANGES.fields)[number][]> = {
  logo: ['logoUrl'],
  name: ['name'],
  tagline: ['tagline'],
  colors: ['colors'],
  // The banner strips render in the league's colors — a banner ask is a
  // color ask, scoped to the colors object (typically the accent slot).
  banner: ['colors'],
  music: ['music'],
}

/** Human labels — the chip text in chat and the preview's hover hints. */
export const PART_LABEL: Record<LeaguePreviewPart, string> = {
  logo: 'Header logo',
  name: 'League name',
  tagline: 'Tagline',
  colors: 'Theme colors',
  banner: 'Banner',
  music: 'Music',
}

/** Coerce an untrusted part value to a known part, else null. */
export function normalizeLeaguePreviewPart(raw: unknown): LeaguePreviewPart | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return (LEAGUE_PREVIEW_PARTS as readonly string[]).includes(s)
    ? (s as LeaguePreviewPart)
    : null
}

// ───────────────────────────────────────────────────────────────────────────
//  The validator
// ───────────────────────────────────────────────────────────────────────────

/** A validated, template-only patch — the ONLY shape chat may apply. */
export type LeagueStudioPatch = {
  name?: string
  tagline?: string
  colors?: Partial<Record<LeagueColorSlot, string>>
  music?: string
  logoUrl?: string
}

export type LeagueStudioPatchResult = {
  /** The clamped patch, or null when nothing valid survived. */
  patch: LeagueStudioPatch | null
  /** Dot-paths of everything that was dropped (for logging/debugging). */
  dropped: string[]
}

/** Coerce input into #rrggbb (accepts #rgb / bare hex), or null. */
export function toHexColor(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const [r, g, b] = raw.split('')
    return `#${(r + r + g + g + b + b).toLowerCase()}`
  }
  return null
}

/**
 * Resolve a music value against the TKO library by file, id, or label
 * (case-insensitive). '' resolves to '' (no music); anything the library
 * doesn't contain resolves to null (dropped).
 */
export function resolveLibraryTrack(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  const hit = MUSIC_LIBRARY.find(
    (t) =>
      t.file.toLowerCase() === lower ||
      t.id.toLowerCase() === lower ||
      t.label.toLowerCase() === lower,
  )
  return hit ? hit.file : null
}

/**
 * Force an untrusted patch (typically straight from the model) into the
 * template ranges. CLAMPS name/tagline to their caps and hex to #rrggbb;
 * DROPS unknown fields, structural fields, invalid colors, non-library music
 * and non-empty logo URLs. With a `part`, only that part's fields survive.
 *
 * This is the guardrail: whatever the AI says, the league app stays the same
 * app — only the skin moves, and only inside these ranges.
 */
export function sanitizeLeagueStudioPatch(
  raw: unknown,
  part: LeaguePreviewPart | null = null,
): LeagueStudioPatchResult {
  if (raw === null || raw === undefined) return { patch: null, dropped: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { patch: null, dropped: ['patch'] }

  const allowed: readonly string[] = part ? PART_FIELDS[part] : LEAGUE_STUDIO_RANGES.fields
  const rec = raw as Record<string, unknown>
  const out: LeagueStudioPatch = {}
  const dropped: string[] = []

  for (const [key, value] of Object.entries(rec)) {
    if (value === undefined) continue
    if (!allowed.includes(key)) {
      dropped.push(key)
      continue
    }
    switch (key as (typeof LEAGUE_STUDIO_RANGES.fields)[number]) {
      case 'name': {
        const name =
          typeof value === 'string'
            ? value.trim().slice(0, LEAGUE_STUDIO_RANGES.name.maxLength).trim()
            : ''
        if (name.length >= LEAGUE_STUDIO_RANGES.name.minLength) out.name = name
        else dropped.push('name')
        break
      }
      case 'tagline': {
        if (typeof value !== 'string') {
          dropped.push('tagline')
          break
        }
        out.tagline = value.trim().slice(0, LEAGUE_STUDIO_RANGES.tagline.maxLength).trim()
        break
      }
      case 'colors': {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          dropped.push('colors')
          break
        }
        const colors: Partial<Record<LeagueColorSlot, string>> = {}
        let sawSlot = false
        for (const [slot, v] of Object.entries(value as Record<string, unknown>)) {
          if (v === undefined) continue
          sawSlot = true
          if (!(LEAGUE_COLOR_SLOTS as readonly string[]).includes(slot)) {
            dropped.push(`colors.${slot}`)
            continue
          }
          const hex = toHexColor(v)
          if (hex) colors[slot as LeagueColorSlot] = hex
          else dropped.push(`colors.${slot}`)
        }
        if (Object.keys(colors).length) out.colors = colors
        else if (!sawSlot) dropped.push('colors')
        break
      }
      case 'music': {
        const file = resolveLibraryTrack(value)
        if (file === null) dropped.push('music')
        else out.music = file
        break
      }
      case 'logoUrl': {
        if (
          typeof value === 'string' &&
          LEAGUE_STUDIO_RANGES.logoUrl.allowedValues.includes(value.trim())
        ) {
          out.logoUrl = value.trim()
        } else {
          dropped.push('logoUrl')
        }
        break
      }
    }
  }

  return { patch: Object.keys(out).length ? out : null, dropped }
}
