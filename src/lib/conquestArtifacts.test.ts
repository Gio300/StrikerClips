import { describe, expect, it } from 'vitest'
import {
  CONQUEST_TIER_LIMITS,
  canActivateConquestArtifact,
  canUseConquestEffects,
  conquestPowerScore,
  conquestRecipe,
  conquestTierAllows,
} from './conquestArtifacts'

describe('Conquest artifact recipes', () => {
  it('keeps effect amounts server-defined and tier-gated', () => {
    const bundle = conquestRecipe('legendary-clan-campaign')
    expect(bundle).not.toBeNull()
    expect(bundle?.listPriceCents).toBe(9999)
    expect(bundle?.effects).toEqual([
      { kind: 'territory_tiles', amount: 4 },
      { kind: 'basic_clan_passes', amount: 10 },
      { kind: 'kill_lead', amount: 10 },
      { kind: 'base_shield_hours', amount: 24 },
      { kind: 'rivalry_resets', amount: 1 },
    ])
    expect(conquestTierAllows('pro', bundle!)).toBe(false)
    expect(conquestTierAllows('creator', bundle!)).toBe(true)
  })

  it('uses all Legend slots for the $99 campaign bundle', () => {
    const bundle = conquestRecipe('legendary-clan-campaign')!
    expect(CONQUEST_TIER_LIMITS.creator.activeSlots).toBe(3)
    expect(canActivateConquestArtifact({
      tier: 'creator',
      activeSlotCost: 0,
      recipe: bundle,
    })).toBe(true)
    expect(canActivateConquestArtifact({
      tier: 'creator',
      activeSlotCost: 1,
      recipe: bundle,
    })).toBe(false)
  })

  it('prevents sequential cheap items from exceeding monthly effect caps', () => {
    const result = canUseConquestEffects({
      tier: 'pro',
      usedThisMonth: [{ kind: 'territory_tiles', amount: 1 }],
      next: [{ kind: 'territory_tiles', amount: 1 }],
    })
    expect(result.allowed).toBe(false)
    expect(result.exceeded).toEqual(['territory_tiles'])
  })

  it('scores stronger bundles above single-effect artifacts', () => {
    const small = conquestRecipe('scout-mark')!
    const bundle = conquestRecipe('legendary-clan-campaign')!
    expect(conquestPowerScore(bundle.effects)).toBeGreaterThan(conquestPowerScore(small.effects))
  })

  it('does not expose official recipes through the public catalogue', () => {
    expect(conquestRecipe('official-grand-conquest')).toBeNull()
    expect(conquestRecipe('official-grand-conquest', true)?.officialOnly).toBe(true)
  })
})
