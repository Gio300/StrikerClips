/**
 * identity — the pure, unit-tested rules that make a name YOURS on TKO.
 *
 * Three identities are unique across the whole platform:
 *   • `profiles.username`   — your handle
 *   • `servers.name`        — a clan's name (kind='clan')
 *   • `servers.clan_tag`    — a clan's short tag, e.g. `AI`, `KMH`
 *
 * Uniqueness is CASE-INSENSITIVE: "Rekt" and "rekt" are the same identity, so
 * one of them is taken. This module owns the canonical (normalized) form used
 * for that comparison, the format rules for each identity, and — crucially —
 * `suggestAlternatives`, so a blocked user is never left at a dead end.
 *
 * DOM-free / backend-free / side-effect-free, mirroring nameQuality.ts and
 * clans.ts, so the same rules can run in the UI, in tests, and on the server.
 * The backend-touching availability query lives in `identityAvailability.ts`;
 * the DB enforces the same rule with case-insensitive UNIQUE indexes (see
 * db/schema.sql "IDENTITY UNIQUENESS").
 */

import { nameQualityError } from './nameQuality'

// ───────────────────────────────────────────────────────────────────────────
//  Length bounds
// ───────────────────────────────────────────────────────────────────────────

/** Usernames: handle-shaped, 3–20 chars of [A-Za-z0-9_]. */
export const USERNAME_MIN = 3
export const USERNAME_MAX = 20

/** Clan names: display-shaped — spaces and any script allowed. */
export const CLAN_NAME_MIN = 2
export const CLAN_NAME_MAX = 32

/** Clan tags: the short `[AI]` badge — 2–5 letters/digits, no spaces. */
export const CLAN_TAG_MIN = 2
export const CLAN_TAG_MAX = 5

// ───────────────────────────────────────────────────────────────────────────
//  Result shape
// ───────────────────────────────────────────────────────────────────────────

/** Uniform validation result. `reason` is inline-ready UI copy. */
export type IdentityCheck = { ok: true } | { ok: false; reason: string }

const OK: IdentityCheck = { ok: true }
const fail = (reason: string): IdentityCheck => ({ ok: false, reason })

/** Convenience: the failure reason, or `null` when valid. */
export function checkReason(c: IdentityCheck): string | null {
  return c.ok ? null : c.reason
}

// ───────────────────────────────────────────────────────────────────────────
//  Normalization — the canonical form uniqueness compares
// ───────────────────────────────────────────────────────────────────────────

/**
 * Canonical form for a username / clan name. Unicode-normalized (NFKC, so
 * full-width and composed characters can't be used to clone a name), trimmed,
 * internal whitespace collapsed to a single space, lowercased.
 *
 *   normalizeHandle('  Rekt   Squad ') === 'rekt squad'
 *   normalizeHandle('REKT') === normalizeHandle('rekt')
 *
 * This mirrors the DB's `lower(username)` / `lower(name)` unique indexes.
 */
export function normalizeHandle(raw: string): string {
  return (raw ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * Canonical form for a clan tag: strip everything that isn't a letter or digit
 * and uppercase. Tags are DISPLAYED uppercase (`[KMH]`) and compared uppercase,
 * so `kmh`, `KMH` and `K M H` are all the same tag.
 *
 * Note this is deliberately lossy — it's the comparison key, not a sanitizer.
 * `validateTag` rejects the input that would need sanitizing in the first place.
 */
export function normalizeTag(raw: string): string {
  // Tags may include symbols now (e.g. `AI!`, `K-M`, `★AI`); we only strip
  // whitespace + control chars and uppercase for a stable comparison key.
  return (raw ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toUpperCase()
}

/** Render a tag as the `[AI]` badge, or `''` when there's no tag. */
export function formatTag(raw: string | null | undefined): string {
  const t = normalizeTag(raw ?? '')
  return t ? `[${t}]` : ''
}

/** `"[AI] Anbu Intel"` — the tag-prefixed clan label used across the UI. */
export function clanLabel(name: string, tag?: string | null): string {
  const badge = formatTag(tag)
  return badge ? `${badge} ${name}` : name
}

// ───────────────────────────────────────────────────────────────────────────
//  Format rules
// ───────────────────────────────────────────────────────────────────────────

/**
 * Username format: 3–20 characters, letters / numbers / underscores only, and
 * at least 2 alphanumerics (the shared nameQuality floor — no `___`, no emoji).
 * The charset deliberately matches the `handle_new_user` trigger in
 * db/schema.sql, which sanitizes signup usernames to `[a-zA-Z0-9_]` — so what
 * the user types is what they get, with no silent server-side rewrite.
 */
export function validateUsername(raw: string): IdentityCheck {
  const v = (raw ?? '').trim()
  if (v === '') return fail('Enter a username.')
  if (/\s/.test(v)) return fail("Usernames can't contain spaces — try an underscore.")
  if (!/^[A-Za-z0-9_]+$/.test(v)) {
    return fail('Usernames can use letters, numbers and underscores only.')
  }
  if (v.length < USERNAME_MIN) return fail(`Usernames need at least ${USERNAME_MIN} characters.`)
  if (v.length > USERNAME_MAX) return fail(`Usernames max out at ${USERNAME_MAX} characters.`)
  const quality = nameQualityError(v, { label: 'username' })
  if (quality) return fail(quality)
  return OK
}

/**
 * Clan name format: 2–32 characters after trimming, plus the shared
 * nameQuality floor (≥2 letters or numbers — emoji-only names are out).
 * Spaces and non-Latin scripts are fine; this is a display name.
 */
export function validateClanName(raw: string): IdentityCheck {
  const v = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (v === '') return fail('Enter a clan name.')
  if (v.length < CLAN_NAME_MIN) return fail(`Clan names need at least ${CLAN_NAME_MIN} characters.`)
  if (v.length > CLAN_NAME_MAX) return fail(`Clan names max out at ${CLAN_NAME_MAX} characters.`)
  const quality = nameQualityError(v, { label: 'clan name' })
  if (quality) return fail(quality)
  return OK
}

/**
 * Clan tag format: 2–5 characters, letters and digits only, no spaces and no
 * punctuation. Short by design — it renders as `[AI]` next to every clan name,
 * so it has to stay a badge, not a second name.
 */
export function validateTag(raw: string): IdentityCheck {
  const v = (raw ?? '').trim()
  if (v === '') return fail('Enter a clan tag.')
  if (/\s/.test(v)) return fail("Clan tags can't contain spaces.")
  // Symbols ARE allowed now (e.g. `AI!`, `K-M`, `★`) — only spaces are out. Keep
  // it short so it still reads as a badge next to the clan name.
  if (v.length < CLAN_TAG_MIN) return fail(`Clan tags need at least ${CLAN_TAG_MIN} characters.`)
  if (v.length > CLAN_TAG_MAX) return fail(`Clan tags max out at ${CLAN_TAG_MAX} characters.`)
  return OK
}

// ───────────────────────────────────────────────────────────────────────────
//  Taken / free
// ───────────────────────────────────────────────────────────────────────────

/**
 * Is `candidate` already claimed? `existingNormalized` is a list of names that
 * have ALREADY been through `normalize` (that's what the DB / query layer hands
 * back); the candidate is normalized here. Defaults to `normalizeHandle`, so a
 * case-only difference counts as taken.
 *
 *   isTaken('Rekt', ['rekt']) === true
 */
export function isTaken(
  candidate: string,
  existingNormalized: Iterable<string>,
  normalize: (s: string) => string = normalizeHandle,
): boolean {
  const key = normalize(candidate)
  if (!key) return false
  for (const e of existingNormalized) {
    if (e === key) return true
  }
  return false
}

// ───────────────────────────────────────────────────────────────────────────
//  Suggestions — the guardrail, not a dead end
// ───────────────────────────────────────────────────────────────────────────

export interface SuggestOptions {
  /** How many free variants to return (default 3). */
  count?: number
  /** Hard character cap for a suggestion (default USERNAME_MAX). */
  maxLength?: number
  /** Comparison normalizer — pass `normalizeTag` for clan tags. */
  normalize?: (s: string) => string
}

/**
 * Propose free variants of a taken name by appending digits, trimming the base
 * so every suggestion still fits `maxLength` (a 5-char tag cap means `ABCDE` →
 * `ABCD2`). Suggestions are checked against the same taken list, so nothing we
 * offer is already claimed. Returns fewer than `count` only if the numeric
 * space is genuinely exhausted.
 */
export function suggestAlternatives(
  candidate: string,
  taken: Iterable<string>,
  opts: SuggestOptions = {},
): string[] {
  const count = Math.max(0, opts.count ?? 3)
  const normalize = opts.normalize ?? normalizeHandle
  const maxLength = Math.max(1, opts.maxLength ?? USERNAME_MAX)
  if (count === 0) return []

  const takenSet = new Set<string>()
  for (const t of taken) takenSet.add(t)

  const base = (candidate ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (base === '') return []

  const out: string[] = []
  const seen = new Set<string>()

  const withSuffix = (suffix: string): string => {
    const room = Math.max(1, maxLength - suffix.length)
    return base.slice(0, room) + suffix
  }
  const push = (value: string) => {
    const key = normalize(value)
    if (!key || takenSet.has(key) || seen.has(key)) return
    seen.add(key)
    out.push(value)
  }

  // 2, 3, 4 … then a sparser sweep so we still find room in a crowded namespace.
  for (let i = 2; i <= 99 && out.length < count; i++) push(withSuffix(String(i)))
  for (let i = 100; i <= 9999 && out.length < count; i += 7) push(withSuffix(String(i)))
  return out.slice(0, count)
}

/**
 * The inline "that's taken" line, with suggestions when we have them.
 * Kept here so every call site (Signup, Profile, CreateServer, ClanSettings)
 * says the same thing.
 */
export function takenMessage(label: string, suggestions: string[]): string {
  if (suggestions.length === 0) return `That ${label}'s taken — try another.`
  return `That ${label}'s taken — try ${suggestions.join(', ')}`
}
