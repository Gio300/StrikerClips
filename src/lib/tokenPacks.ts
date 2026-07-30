/**
 * TOKEN PACKS — the canonical catalogue of what a Token purchase delivers.
 *
 * This file is the SINGLE SOURCE OF TRUTH for pack contents on the client. The
 * server keeps a byte-for-byte mirror (`SERVER_TOKEN_PACKS` in server/app.ts)
 * for the same reason ageFromDob and the King artifact derivations are mirrored:
 * server/ is built by tsx independently of the Vite app, and reaching into src/
 * would couple the API build to the frontend's alias + bundler config.
 *
 * `server/app.test.ts` asserts the two lists are identical, so they cannot drift
 * silently — and drift here would mean charging for one thing and delivering
 * another.
 *
 * WHY THE SERVER RE-DERIVES THE CONTENTS: the Checkout Session carries the pack
 * ID in metadata, but fulfilment looks the tokens/sweeps up in ITS OWN copy of
 * this table. Nothing a client (or a tampered metadata field) says about "how
 * many tokens" is ever trusted.
 *
 * PRICING MODEL: bonus Sweeps Points are capped at 40% of the cash price
 * (1 Sweeps Point = $0.01), so the platform retains a 60% margin up front —
 * bonusSweeps = priceUsd × 40. Tokens are the bought utility currency and have
 * no cash value; Sweeps are free promotional points that ride along.
 */

export type TokenPack = {
  /** Stable key. Used in Stripe metadata and in STRIPE_PRICE_PACK_<ID>. */
  id: string
  /** Tokens credited to the wallet on a PAID session. */
  tokens: number
  /** Free bonus Sweeps Points included with the pack. */
  bonusSweeps: number
  /** Price in USD. Must match the Stripe Price created by scripts/stripe-setup.ts. */
  priceUsd: number
  /** Optional "best value" style tag for the store card. */
  tag?: string
}

export const TOKEN_PACKS: readonly TokenPack[] = [
  { id: 'starter', tokens: 100, bonusSweeps: 40, priceUsd: 0.99 },
  { id: 'plus', tokens: 550, bonusSweeps: 200, priceUsd: 4.99, tag: 'Popular' },
  { id: 'pro', tokens: 1200, bonusSweeps: 400, priceUsd: 9.99 },
  { id: 'mega', tokens: 3000, bonusSweeps: 800, priceUsd: 19.99, tag: 'Best value' },
]

/** Look a pack up by id. Returns null for anything not in the catalogue. */
export function packById(id: string | null | undefined): TokenPack | null {
  const key = String(id ?? '')
  return TOKEN_PACKS.find((p) => p.id === key) ?? null
}

/** The pack price in whole cents — the unit Stripe bills in. */
export function packPriceCents(pack: TokenPack): number {
  return Math.round(pack.priceUsd * 100)
}
