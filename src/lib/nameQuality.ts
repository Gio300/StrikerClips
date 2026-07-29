/**
 * nameQuality — the pure, unit-tested rule for "is this a real name?".
 *
 * Used by every create-something-with-a-name flow (clans, chat spaces, matches)
 * so a user can't ship an emoji-only, whitespace-only, or one-character name.
 * The rule: after trimming, a name needs at least `min` (default 2) alphanumeric
 * characters — letters or digits from any script. Emoji and punctuation don't
 * count toward that floor, so "🔥🔥" / "!!" / "  " / "x" are all rejected while
 * "GG", "Zé", and "клан" pass.
 *
 * DOM-free / side-effect-free, mirroring chat.ts / clans.ts, so it's trivially
 * testable and reusable on the server later.
 */

/** Minimum alphanumeric characters a name must contain. */
export const MIN_NAME_ALNUM = 2

/** Count alphanumeric characters (unicode letters + digits) in a string. */
export function alnumCount(s: string): number {
  const m = s.match(/[\p{L}\p{N}]/gu)
  return m ? m.length : 0
}

/**
 * The inline rule copy shown under a name field before the user types anything
 * (or as the persistent hint). Kept here so UI + validation never drift.
 */
export function nameRuleHint(label = 'name', min: number = MIN_NAME_ALNUM): string {
  return `Give it a real ${label} — at least ${min} letters or numbers (emoji or symbols alone won't do).`
}

/**
 * Returns an inline error string when the name is low-quality, else `null`.
 * `label` customizes the copy ("clan name", "space name", "match name").
 */
export function nameQualityError(
  raw: string,
  opts: { min?: number; label?: string } = {},
): string | null {
  const min = opts.min ?? MIN_NAME_ALNUM
  const label = opts.label ?? 'name'
  const trimmed = (raw ?? '').trim()
  if (trimmed === '') return `Enter a ${label}.`
  if (alnumCount(trimmed) < min) {
    return `That ${label} needs at least ${min} letters or numbers — emoji or symbols alone won't do.`
  }
  return null
}

/** Convenience boolean: does the name pass the quality rule? */
export function isValidName(raw: string, opts?: { min?: number; label?: string }): boolean {
  return nameQualityError(raw, opts) === null
}
