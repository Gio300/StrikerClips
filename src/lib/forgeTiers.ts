/**
 * forgeTiers.ts — the ONE place the tier → forge-capability mapping lives.
 *
 * The unified /forge page is a single screen of collapsible sections; each paid
 * section is gated by the member's account tier BOTH client-side (the section
 * renders collapsed with an "Unlock — upgrade your account" CTA) and
 * server-side (the /api/fn/forge-artifact-save handler answers 403). Both sides
 * import THIS module, so retuning a gate is a one-line change here.
 *
 * Levels reuse the streaming tier ladder from src/lib/tiers.ts:
 *   free/'' & ad_free = 0   pro (Pro) = 1   supporter (Elite) = 2
 *   creator (Legend) = 3
 *
 * Shipped mapping (operator-tunable):
 *   basic  = 0  — anyone signed in may forge a plain artifact
 *   powers = 1  — Pro+ may attach powers (name + description, max 4)
 *   price  = 2  — Elite+ may attach a cash sale price (price_cents)
 *   shirt  = 3  — Legend may bundle one of THEIR designed shirts (shirt_ref)
 */
import { LEVEL_TIER_NAME, tierLevel } from './tiers'

export const TIER_FORGE = {
  /** Forge a basic collectible artifact (art + name + rarity + perk). */
  basic: 0,
  /** Attach creator-authored powers to the artifact. */
  powers: 1,
  /** Attach a cash sale price (stored display value, cents). */
  price: 2,
  /** Bundle the artifact with one of the member's designed t-shirts. */
  shirt: 3,
} as const

export type ForgeCapability = keyof typeof TIER_FORGE

/** True when a member on `tier` may use the given forge capability. */
export function canForge(capability: ForgeCapability, tier: string | undefined | null): boolean {
  return tierLevel(tier) >= TIER_FORGE[capability]
}

/** User-facing name of the tier that unlocks a capability (Pro/Elite/Legend). */
export function forgeTierName(capability: ForgeCapability): string {
  return LEVEL_TIER_NAME[TIER_FORGE[capability]] ?? 'a paid'
}

// ---------------------------------------------------------------------------
// VALIDATION — shared by the /forge page (instant feedback) and the trusted
// server write path (the enforcement). Server-side these are the law: a value
// that fails here is refused with a 400, whatever the client claimed.
// ---------------------------------------------------------------------------

/** Max number of powers a creator may attach to one artifact. */
export const FORGE_MAX_POWERS = 4
/** Max length of one power's name / description. */
export const FORGE_POWER_NAME_MAX = 40
export const FORGE_POWER_DESC_MAX = 200
/** Sale price bounds, in cents (0 .. $1,000). */
export const FORGE_PRICE_MAX_CENTS = 100_000

export type ForgePower = { name: string; description: string }

type Sanitized<T> = { ok: true; value: T } | { ok: false; error: string }

const squash = (value: unknown): string => String(value ?? '').trim().replace(/\s+/g, ' ')

/**
 * Validate a creator-authored powers list: an array of at most
 * FORGE_MAX_POWERS entries of `{ name, description }`. Entries with an empty
 * name are refused (a nameless power is a form mistake, not intent).
 */
export function sanitizeForgePowers(input: unknown): Sanitized<ForgePower[]> {
  if (!Array.isArray(input)) return { ok: false, error: 'powers must be a list' }
  if (input.length > FORGE_MAX_POWERS) {
    return { ok: false, error: `an artifact holds at most ${FORGE_MAX_POWERS} powers` }
  }
  const powers: ForgePower[] = []
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'each power needs a name and a description' }
    }
    const name = squash((entry as Record<string, unknown>).name)
    const description = squash((entry as Record<string, unknown>).description)
    if (!name) return { ok: false, error: 'every power needs a name' }
    if (name.length > FORGE_POWER_NAME_MAX) {
      return { ok: false, error: `power names cap at ${FORGE_POWER_NAME_MAX} characters` }
    }
    if (description.length > FORGE_POWER_DESC_MAX) {
      return { ok: false, error: `power descriptions cap at ${FORGE_POWER_DESC_MAX} characters` }
    }
    powers.push({ name, description })
  }
  return { ok: true, value: powers }
}

/**
 * Validate a sale price in cents: null clears the price; otherwise an integer
 * 0..FORGE_PRICE_MAX_CENTS. This is a STORED display value (no payment is
 * collected against it), but it is still money-adjacent, so out-of-range
 * values are refused rather than silently clamped.
 */
export function sanitizeForgePriceCents(input: unknown): Sanitized<number | null> {
  if (input == null) return { ok: true, value: null }
  const cents = Number(input)
  if (!Number.isSafeInteger(cents)) return { ok: false, error: 'price must be a whole number of cents' }
  if (cents < 0 || cents > FORGE_PRICE_MAX_CENTS) {
    return { ok: false, error: `price must be between $0 and $${FORGE_PRICE_MAX_CENTS / 100}` }
  }
  return { ok: true, value: cents }
}
