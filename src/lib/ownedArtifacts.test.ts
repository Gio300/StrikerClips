import { describe, expect, it } from 'vitest'
import {
  forgeExtrasSummary,
  formatPriceCents,
  normalizeOwnedArtifact,
  normalizeOwnedArtifacts,
  ownedArtifactDef,
} from './ownedArtifacts'

const row = (patch: Record<string, unknown> = {}) => ({
  id: 'a1',
  slug: 'forged',
  name: 'Kunai of Proof',
  rarity: 'legendary',
  capability: 'profile_flair',
  image_url: 'https://cdn.example.test/art.png',
  code: null,
  powers: [{ name: 'Shadow Step', description: 'Blink behind the target.' }],
  price_cents: 4200,
  created_at: '2026-08-01T00:00:00.000Z',
  conquest: false,
  shirt: {
    id: 's1',
    title: 'Forge Tee',
    artwork_url: 'https://cdn.example.test/tee.png',
    sale_price_cents: 2900,
    status: 'active',
  },
  ...patch,
})

describe('normalizeOwnedArtifact', () => {
  it('keeps the paid Forge extras that make a forged artifact visible', () => {
    const artifact = normalizeOwnedArtifact(row())!
    expect(artifact.powers).toEqual([{ name: 'Shadow Step', description: 'Blink behind the target.' }])
    expect(artifact.price_cents).toBe(4200)
    expect(artifact.shirt?.title).toBe('Forge Tee')
    expect(artifact.shirt?.sale_price_cents).toBe(2900)
  })

  it('parses powers delivered as a jsonb string', () => {
    const artifact = normalizeOwnedArtifact(row({
      powers: '[{"name":"Ember","description":"Burns"}]',
    }))!
    expect(artifact.powers).toEqual([{ name: 'Ember', description: 'Burns' }])
  })

  it('drops nameless / malformed powers instead of rendering blanks', () => {
    const artifact = normalizeOwnedArtifact(row({
      powers: [{ description: 'no name' }, null, 'nope', { name: '  ', description: 'blank' }, { name: 'Real' }],
    }))!
    expect(artifact.powers).toEqual([{ name: 'Real', description: '' }])
  })

  it('survives a legacy row with no extras at all', () => {
    const artifact = normalizeOwnedArtifact({ id: 'a2', name: 'Plain' })!
    expect(artifact.powers).toEqual([])
    expect(artifact.price_cents).toBeNull()
    expect(artifact.shirt).toBeNull()
    expect(artifact.rarity).toBe('common')
  })

  it('refuses rows with no id, and unknown rarities fall back to common', () => {
    expect(normalizeOwnedArtifact({ name: 'No id' })).toBeNull()
    expect(normalizeOwnedArtifact(null)).toBeNull()
    expect(normalizeOwnedArtifact(row({ rarity: 'ultra' }))!.rarity).toBe('common')
  })

  it('treats a shirt_ref whose product vanished as no shirt', () => {
    expect(normalizeOwnedArtifact(row({ shirt: { id: 's1', title: '' } }))!.shirt).toBeNull()
    expect(normalizeOwnedArtifact(row({ shirt: null }))!.shirt).toBeNull()
  })

  it('normalizes a whole payload and skips what it cannot use', () => {
    expect(normalizeOwnedArtifacts([row(), { name: 'no id' }, 7])).toHaveLength(1)
    expect(normalizeOwnedArtifacts('nope')).toEqual([])
  })
})

describe('ownedArtifactDef', () => {
  it('renders a forged artifact with its own provenance line', () => {
    const def = ownedArtifactDef(normalizeOwnedArtifact(row())!)
    expect(def.name).toBe('Kunai of Proof')
    expect(def.rarity).toBe('legendary')
    expect(def.capability).toBe('profile_flair')
    expect(def.reason).toBe('Forged in your Forge')
  })

  it('labels a Conquest recipe artifact and neutralises its server-only capability', () => {
    const def = ownedArtifactDef(normalizeOwnedArtifact(row({
      conquest: true,
      capability: 'conquest_power',
    }))!)
    // conquest_power has no client label — it must never render as "undefined".
    expect(def.capability).toBe('none')
    expect(def.reason).toBe('Forged from a Conquest recipe')
  })
})

describe('formatPriceCents / forgeExtrasSummary', () => {
  it('drops the cents on whole dollars', () => {
    expect(formatPriceCents(4200)).toBe('$42')
    expect(formatPriceCents(4250)).toBe('$42.50')
    expect(formatPriceCents(0)).toBe('$0')
  })

  it('summarises only the extras that exist', () => {
    expect(forgeExtrasSummary(normalizeOwnedArtifact(row())!))
      .toBe('1 power · $42 · shirt: Forge Tee')
    expect(forgeExtrasSummary(normalizeOwnedArtifact({ id: 'a3', name: 'Plain' })!)).toBe('')
  })
})
