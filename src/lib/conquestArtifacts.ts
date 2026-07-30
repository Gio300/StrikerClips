/**
 * Server-shared rules for Shinobi Conquest artifacts.
 *
 * Clients choose a recipe code. They never submit effect amounts. The server
 * looks the recipe up here, checks the member tier, and derives every effect.
 * This keeps edited clients from forging arbitrary land, shields, or leads.
 */

export type ConquestMembershipTier = 'pro' | 'supporter' | 'creator'

export type ConquestEffectKind =
  | 'kill_lead'
  | 'base_shield_hours'
  | 'territory_tiles'
  | 'basic_clan_passes'
  | 'rivalry_resets'

export type ConquestEffect = {
  kind: ConquestEffectKind
  amount: number
}

export type ConquestArtifactRecipe = {
  code: string
  name: string
  description: string
  minimumTier: ConquestMembershipTier
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'
  listPriceCents: number
  slotCost: number
  durationHours: number
  officialOnly?: boolean
  effects: ConquestEffect[]
}

export const CONQUEST_TIER_ORDER: ConquestMembershipTier[] = [
  'pro',
  'supporter',
  'creator',
]

export const CONQUEST_TIER_LABEL: Record<ConquestMembershipTier, string> = {
  pro: 'Pro',
  supporter: 'Elite',
  creator: 'Legend',
}

export const CONQUEST_TIER_LIMITS: Record<
  ConquestMembershipTier,
  {
    activeSlots: number
    monthlyForges: number
    monthlyEffects: Record<ConquestEffectKind, number>
  }
> = {
  pro: {
    activeSlots: 1,
    monthlyForges: 2,
    monthlyEffects: {
      kill_lead: 3,
      base_shield_hours: 6,
      territory_tiles: 1,
      basic_clan_passes: 0,
      rivalry_resets: 0,
    },
  },
  supporter: {
    activeSlots: 2,
    monthlyForges: 4,
    monthlyEffects: {
      kill_lead: 6,
      base_shield_hours: 12,
      territory_tiles: 2,
      basic_clan_passes: 3,
      rivalry_resets: 0,
    },
  },
  creator: {
    activeSlots: 3,
    monthlyForges: 6,
    monthlyEffects: {
      kill_lead: 10,
      base_shield_hours: 24,
      territory_tiles: 4,
      basic_clan_passes: 10,
      rivalry_resets: 1,
    },
  },
}

export const CONQUEST_ARTIFACT_RECIPES: ConquestArtifactRecipe[] = [
  {
    code: 'scout-mark',
    name: 'Scout Mark',
    description: 'Start verified territory battles with a +3 lead for seven days.',
    minimumTier: 'pro',
    rarity: 'common',
    listPriceCents: 299,
    slotCost: 1,
    durationHours: 24 * 7,
    effects: [{ kind: 'kill_lead', amount: 3 }],
  },
  {
    code: 'village-ward',
    name: 'Village Ward',
    description: 'Protect one clan base from capture for six hours.',
    minimumTier: 'pro',
    rarity: 'rare',
    listPriceCents: 499,
    slotCost: 1,
    durationHours: 6,
    effects: [{ kind: 'base_shield_hours', amount: 6 }],
  },
  {
    code: 'territory-seal',
    name: 'Territory Seal',
    description: 'Claim one connected unoccupied territory.',
    minimumTier: 'pro',
    rarity: 'rare',
    listPriceCents: 999,
    slotCost: 1,
    durationHours: 0,
    effects: [{ kind: 'territory_tiles', amount: 1 }],
  },
  {
    code: 'battle-standard',
    name: 'Battle Standard',
    description: 'Grant a +6 battle lead and a 12-hour base shield.',
    minimumTier: 'supporter',
    rarity: 'epic',
    listPriceCents: 1999,
    slotCost: 2,
    durationHours: 12,
    effects: [
      { kind: 'kill_lead', amount: 6 },
      { kind: 'base_shield_hours', amount: 12 },
    ],
  },
  {
    code: 'expansion-scroll',
    name: 'Expansion Scroll',
    description: 'Claim two connected territories and unlock three one-month basic clan passes.',
    minimumTier: 'supporter',
    rarity: 'epic',
    listPriceCents: 2999,
    slotCost: 2,
    durationHours: 0,
    effects: [
      { kind: 'territory_tiles', amount: 2 },
      { kind: 'basic_clan_passes', amount: 3 },
    ],
  },
  {
    code: 'fortress-core',
    name: 'Fortress Core',
    description: 'Grant a +10 battle lead and protect a base for 24 hours.',
    minimumTier: 'creator',
    rarity: 'legendary',
    listPriceCents: 4999,
    slotCost: 2,
    durationHours: 24,
    effects: [
      { kind: 'kill_lead', amount: 10 },
      { kind: 'base_shield_hours', amount: 24 },
    ],
  },
  {
    code: 'realm-reset-scroll',
    name: 'Realm Reset Scroll',
    description: 'Clear the clan rivalry ledger for a new Conquest run.',
    minimumTier: 'creator',
    rarity: 'legendary',
    listPriceCents: 4999,
    slotCost: 1,
    durationHours: 0,
    effects: [{ kind: 'rivalry_resets', amount: 1 }],
  },
  {
    code: 'legendary-clan-campaign',
    name: 'Legendary Clan Campaign',
    description: 'A complete clan campaign: land, passes, lead, shield, and one rivalry reset.',
    minimumTier: 'creator',
    rarity: 'mythic',
    listPriceCents: 9999,
    slotCost: 3,
    durationHours: 24,
    effects: [
      { kind: 'territory_tiles', amount: 4 },
      { kind: 'basic_clan_passes', amount: 10 },
      { kind: 'kill_lead', amount: 10 },
      { kind: 'base_shield_hours', amount: 24 },
      { kind: 'rivalry_resets', amount: 1 },
    ],
  },
]

/**
 * Official artifacts are source-controlled and can only be issued by a TKO
 * host. There is no endpoint for a client to submit custom official effects.
 */
export const OFFICIAL_CONQUEST_ARTIFACT_RECIPES: ConquestArtifactRecipe[] = [
  {
    code: 'official-grand-conquest',
    name: 'Grand Conquest Relic',
    description: 'Official TKO tournament relic. Issued only by the platform.',
    minimumTier: 'creator',
    rarity: 'mythic',
    listPriceCents: 0,
    slotCost: 4,
    durationHours: 72,
    officialOnly: true,
    effects: [
      { kind: 'territory_tiles', amount: 8 },
      { kind: 'basic_clan_passes', amount: 25 },
      { kind: 'kill_lead', amount: 25 },
      { kind: 'base_shield_hours', amount: 72 },
      { kind: 'rivalry_resets', amount: 1 },
    ],
  },
]

export function conquestRecipe(
  code: string,
  includeOfficial = false,
): ConquestArtifactRecipe | null {
  const recipes = includeOfficial
    ? [...CONQUEST_ARTIFACT_RECIPES, ...OFFICIAL_CONQUEST_ARTIFACT_RECIPES]
    : CONQUEST_ARTIFACT_RECIPES
  return recipes.find((recipe) => recipe.code === code) ?? null
}

export function conquestTierAllows(
  tier: string,
  recipe: ConquestArtifactRecipe,
): boolean {
  const held = CONQUEST_TIER_ORDER.indexOf(tier as ConquestMembershipTier)
  const required = CONQUEST_TIER_ORDER.indexOf(recipe.minimumTier)
  return held >= 0 && required >= 0 && held >= required
}

export function effectTotals(
  effects: ConquestEffect[],
): Record<ConquestEffectKind, number> {
  const totals: Record<ConquestEffectKind, number> = {
    kill_lead: 0,
    base_shield_hours: 0,
    territory_tiles: 0,
    basic_clan_passes: 0,
    rivalry_resets: 0,
  }
  for (const effect of effects) {
    if (effect.kind in totals && Number.isFinite(effect.amount)) {
      totals[effect.kind] += Math.max(0, Math.floor(effect.amount))
    }
  }
  return totals
}

export function canUseConquestEffects(input: {
  tier: ConquestMembershipTier
  usedThisMonth: ConquestEffect[]
  next: ConquestEffect[]
}): { allowed: boolean; exceeded: ConquestEffectKind[] } {
  const limits = CONQUEST_TIER_LIMITS[input.tier].monthlyEffects
  const used = effectTotals(input.usedThisMonth)
  const next = effectTotals(input.next)
  const exceeded = (Object.keys(limits) as ConquestEffectKind[])
    .filter((kind) => used[kind] + next[kind] > limits[kind])
  return { allowed: exceeded.length === 0, exceeded }
}

export function canActivateConquestArtifact(input: {
  tier: ConquestMembershipTier
  activeSlotCost: number
  recipe: ConquestArtifactRecipe
}): boolean {
  if (input.recipe.officialOnly) return true
  return (
    conquestTierAllows(input.tier, input.recipe) &&
    input.activeSlotCost + input.recipe.slotCost <= CONQUEST_TIER_LIMITS[input.tier].activeSlots
  )
}

export function conquestPowerScore(effects: ConquestEffect[]): number {
  const total = effectTotals(effects)
  return (
    total.kill_lead * 8 +
    total.base_shield_hours * 2 +
    total.territory_tiles * 30 +
    total.basic_clan_passes * 4 +
    total.rivalry_resets * 40
  )
}
