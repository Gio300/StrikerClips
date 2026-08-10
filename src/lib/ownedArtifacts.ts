/**
 * ownedArtifacts.ts — the READ side of the unified Forge (pure, unit-tested).
 *
 * /forge writes a member's collectible through /api/fn/forge-artifact-save,
 * including the three tier-gated extras (powers = Pro+, price_cents = Elite+,
 * shirt_ref = Legend). Until now nothing read them back, so forging produced
 * something the owner could never see. `/api/fn/forge-artifact-list` returns
 * the caller's own artifacts with the shirt resolved; this module turns that
 * payload into the shape <ArtifactCard/> renders, and is deliberately free of
 * React and of the network so the mapping can be tested directly.
 *
 * The server shapes the same fields (server/app.ts shapeOwnedArtifact); this is
 * the client-side mirror, so a partial/legacy row still renders a sane card.
 */
import { RARITY, CAPABILITY_LABEL, type ArtifactDef, type Capability, type Rarity } from './artifacts'

export type OwnedArtifactPower = { name: string; description: string }

export type OwnedArtifactShirt = {
  id: string
  title: string
  artwork_url: string | null
  sale_price_cents: number | null
  status: string
}

export type OwnedArtifact = {
  id: string
  slug: string
  name: string
  rarity: Rarity
  capability: string
  image_url: string | null
  code: string | null
  powers: OwnedArtifactPower[]
  price_cents: number | null
  created_at: string | null
  conquest: boolean
  shirt: OwnedArtifactShirt | null
}

const isRarity = (value: unknown): value is Rarity =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(RARITY, value)

const text = (value: unknown, max: number): string => String(value ?? '').trim().slice(0, max)

const nullableText = (value: unknown): string | null =>
  value == null || value === '' ? null : String(value)

const nullableCents = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const cents = Number(value)
  return Number.isFinite(cents) ? Math.round(cents) : null
}

/** Coerce one power entry; a nameless power is dropped (it renders as noise). */
function normalizePowers(input: unknown): OwnedArtifactPower[] {
  let raw: unknown = input
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(raw)) return []
  const powers: OwnedArtifactPower[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const name = text((entry as Record<string, unknown>).name, 80)
    if (!name) continue
    powers.push({ name, description: text((entry as Record<string, unknown>).description, 400) })
    if (powers.length >= 8) break
  }
  return powers
}

function normalizeShirt(input: unknown): OwnedArtifactShirt | null {
  if (!input || typeof input !== 'object') return null
  const src = input as Record<string, unknown>
  const title = text(src.title, 120)
  if (!title) return null
  return {
    id: String(src.id ?? ''),
    title,
    artwork_url: nullableText(src.artwork_url),
    sale_price_cents: nullableCents(src.sale_price_cents),
    status: String(src.status ?? 'pending_review'),
  }
}

/** Turn one `/api/fn/forge-artifact-list` row into a render-safe artifact. */
export function normalizeOwnedArtifact(input: unknown): OwnedArtifact | null {
  if (!input || typeof input !== 'object') return null
  const src = input as Record<string, unknown>
  const id = String(src.id ?? '')
  if (!id) return null
  return {
    id,
    slug: String(src.slug ?? ''),
    name: text(src.name, 80) || 'Forged Artifact',
    rarity: isRarity(src.rarity) ? src.rarity : 'common',
    capability: String(src.capability ?? 'none'),
    image_url: nullableText(src.image_url),
    code: nullableText(src.code),
    powers: normalizePowers(src.powers),
    price_cents: nullableCents(src.price_cents),
    created_at: nullableText(src.created_at),
    conquest: src.conquest === true,
    shirt: normalizeShirt(src.shirt),
  }
}

/** Normalize a whole payload, dropping anything unusable. */
export function normalizeOwnedArtifacts(input: unknown): OwnedArtifact[] {
  if (!Array.isArray(input)) return []
  return input
    .map(normalizeOwnedArtifact)
    .filter((artifact): artifact is OwnedArtifact => artifact !== null)
}

/**
 * The <ArtifactCard/> def for an owned artifact. `reason` is the card's
 * subtitle: for a forged item that is what it IS (Conquest recipe / a member
 * forge), not how it was earned.
 */
export function ownedArtifactDef(artifact: OwnedArtifact): ArtifactDef {
  const known = Object.prototype.hasOwnProperty.call(CAPABILITY_LABEL, artifact.capability)
  return {
    slug: artifact.slug || artifact.id,
    name: artifact.name,
    rarity: artifact.rarity,
    capability: (known ? artifact.capability : 'none') as Capability,
    reason: artifact.conquest ? 'Forged from a Conquest recipe' : 'Forged in your Forge',
  }
}

/** Cents → "$12.50"; whole dollars drop the cents ("$12"). */
export function formatPriceCents(cents: number): string {
  const dollars = cents / 100
  return dollars % 1 === 0 ? `$${dollars.toFixed(0)}` : `$${dollars.toFixed(2)}`
}

/** A one-line summary of the paid extras attached to an artifact. */
export function forgeExtrasSummary(artifact: OwnedArtifact): string {
  const bits: string[] = []
  if (artifact.powers.length) {
    bits.push(`${artifact.powers.length} power${artifact.powers.length === 1 ? '' : 's'}`)
  }
  if (artifact.price_cents != null) bits.push(formatPriceCents(artifact.price_cents))
  if (artifact.shirt) bits.push(`shirt: ${artifact.shirt.title}`)
  return bits.join(' · ')
}
