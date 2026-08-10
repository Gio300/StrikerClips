import { describe, expect, it } from 'vitest'
import {
  LEAGUE_CAPABILITIES,
  LEAGUE_PLANS,
  LEAGUE_PLAN_IDS,
  MEMBER_RENDER_CAPS,
  PURCHASABLE_LEAGUE_PLANS,
  effectiveVideoOwnership,
  isLeaguePlanId,
  isPurchasableLeaguePlan,
  leagueCan,
  leagueEntitlements,
  leaguePlanById,
  leaguePlanPriceLabel,
  planIsPaid,
  roadmapCapabilities,
  sellableCapabilities,
  type LeagueCapabilityId,
} from './leaguePlans'

describe('league plan catalogue', () => {
  it('has exactly the four plans the DB CHECK allows', () => {
    expect(LEAGUE_PLANS.map((p) => p.id)).toEqual(['starter', 'pro', 'dynasty', 'enterprise'])
    expect(LEAGUE_PLAN_IDS).toEqual(['starter', 'pro', 'dynasty', 'enterprise'])
  })

  it('prices the ladder in ascending order', () => {
    const priced = LEAGUE_PLANS.filter((p) => p.priceCents != null)
    const amounts = priced.map((p) => p.priceCents as number)
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b))
    expect(leaguePlanById('starter')?.priceCents).toBe(4900)
    expect(leaguePlanById('pro')?.priceCents).toBe(14900)
  })

  it('renders a price label, and "let\'s talk" for the unpriced plan', () => {
    expect(leaguePlanPriceLabel(leaguePlanById('pro')!)).toBe('$149')
    expect(leaguePlanPriceLabel(leaguePlanById('enterprise')!)).toBe("Let's talk")
  })

  // ENTERPRISE IS A LEAD, NOT A CHECKOUT. If this ever flips, /api/league/checkout
  // would try to resolve a price env var that deliberately does not exist.
  it('makes enterprise a contact-us plan with no Stripe price', () => {
    const ent = leaguePlanById('enterprise')!
    expect(ent.purchasable).toBe(false)
    expect(ent.stripeEnvVar).toBeNull()
    expect(isPurchasableLeaguePlan('enterprise')).toBe(false)
    expect(PURCHASABLE_LEAGUE_PLANS.map((p) => p.id)).toEqual(['starter', 'pro', 'dynasty'])
  })

  /**
   * The two ladders share the key 'pro'. If a league plan ever resolved through
   * `STRIPE_PRICE_PRO` it would open a league checkout against the $4.99 MEMBER
   * price — so the namespaces must stay disjoint.
   */
  it('keeps league price env vars in a namespace disjoint from the member ladder', () => {
    for (const p of PURCHASABLE_LEAGUE_PLANS) {
      expect(p.stripeEnvVar).toMatch(/^STRIPE_PRICE_LEAGUE_[A-Z]+$/)
    }
    const vars = PURCHASABLE_LEAGUE_PLANS.map((p) => p.stripeEnvVar)
    expect(new Set(vars).size).toBe(vars.length)
    expect(vars).not.toContain('STRIPE_PRICE_PRO')
  })

  it('rejects anything that is not a plan id', () => {
    expect(isLeaguePlanId('dynasty')).toBe(true)
    expect(isLeaguePlanId('supporter')).toBe(false) // a MEMBER tier
    expect(isLeaguePlanId('')).toBe(false)
    expect(leaguePlanById('nope')).toBeNull()
    expect(leaguePlanById(undefined)).toBeNull()
  })

  it('references only capabilities that exist in the registry', () => {
    for (const plan of LEAGUE_PLANS) {
      for (const c of plan.capabilities) {
        expect(LEAGUE_CAPABILITIES[c], `${plan.id} -> ${c}`).toBeTruthy()
        expect(LEAGUE_CAPABILITIES[c].id).toBe(c)
      }
    }
  })

  it('makes each plan a superset of the one below it', () => {
    const ladder = ['starter', 'pro', 'dynasty'] as const
    for (let i = 1; i < ladder.length; i++) {
      const lower = new Set(leaguePlanById(ladder[i - 1])!.capabilities)
      const higher = new Set(leaguePlanById(ladder[i])!.capabilities)
      for (const c of lower) expect(higher.has(c), `${ladder[i]} is missing ${c}`).toBe(true)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Honesty: nothing unbuilt may reach sales copy
// ───────────────────────────────────────────────────────────────────────────

describe('capability honesty', () => {
  it('never lets a roadmap capability into sales copy', () => {
    for (const plan of LEAGUE_PLANS) {
      for (const c of sellableCapabilities(plan.id)) {
        expect(c.status, `${plan.id} sells unbuilt ${c.id}`).not.toBe('roadmap')
      }
    }
  })

  /**
   * These two are advertised on the pricing page's Pro card historically, and
   * NEITHER is implemented: render_jobs is claimed strictly FIFO, and the Studio
   * AI chat is gated by auth + a rate limit only, on every plan. They stay in the
   * plan data (so the entitlement is ready) but must never be sold.
   */
  it('marks priority rendering and AI Studio help as roadmap, not shipped', () => {
    expect(LEAGUE_CAPABILITIES.priority_render.status).toBe('roadmap')
    expect(LEAGUE_CAPABILITIES.ai_studio_assets.status).toBe('roadmap')
    const dynastyRoadmap = roadmapCapabilities('dynasty').map((c) => c.id)
    expect(dynastyRoadmap).toContain('priority_render')
    expect(dynastyRoadmap).toContain('ai_studio_assets')
    expect(sellableCapabilities('dynasty').map((c) => c.id)).not.toContain('priority_render')
  })

  it('sells clean_brand and league video ownership, which ARE enforced', () => {
    expect(LEAGUE_CAPABILITIES.clean_brand.status).toBe('shipped')
    expect(LEAGUE_CAPABILITIES.league_video_ownership.status).toBe('shipped')
    expect(sellableCapabilities('dynasty').map((c) => c.id)).toContain('clean_brand')
  })

  it('every capability documents where it is enforced', () => {
    for (const c of Object.values(LEAGUE_CAPABILITIES)) {
      expect(c.enforcedAt.length, c.id).toBeGreaterThan(0)
      expect(c.label.length, c.id).toBeGreaterThan(0)
    }
  })

  it('states the member caps that every plan inherits equally', () => {
    expect(MEMBER_RENDER_CAPS.map((m) => m.tier)).toEqual(['', 'ad_free', 'pro', 'supporter', 'creator'])
    // Free members render but are never promoted — the factory forces post=false.
    expect(MEMBER_RENDER_CAPS.find((m) => m.tier === '')?.promoted).toBe(false)
    expect(MEMBER_RENDER_CAPS.find((m) => m.tier === 'creator')?.promoted).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Entitlement — the gate itself
// ───────────────────────────────────────────────────────────────────────────

describe('leagueEntitlements', () => {
  const ALL: LeagueCapabilityId[] = Object.keys(LEAGUE_CAPABILITIES) as LeagueCapabilityId[]

  /**
   * THE BUG THIS EXISTS TO PREVENT. `leagues.tier` defaults to 'starter' and
   * every league owner can create a row, so tier alone would hand every Studio
   * draft a paid plan. Both columns are required.
   */
  it('grants NOTHING to an unpaid league however high its tier', () => {
    for (const tier of ['starter', 'pro', 'dynasty', 'enterprise']) {
      const e = leagueEntitlements(tier, 'none')
      for (const c of ALL) expect(e[c], `${tier}/none granted ${c}`).toBe(false)
    }
  })

  it('grants nothing while a renewal is failing or after cancellation', () => {
    for (const status of ['past_due', 'canceled']) {
      const e = leagueEntitlements('dynasty', status)
      expect(e.clean_brand).toBe(false)
      expect(e.league_video_ownership).toBe(false)
      expect(e.custom_domain).toBe(false)
    }
  })

  it('treats an operator comp exactly like a live subscription', () => {
    expect(planIsPaid('comped')).toBe(true)
    expect(planIsPaid('active')).toBe(true)
    expect(planIsPaid('none')).toBe(false)
    expect(planIsPaid(null)).toBe(false)
    expect(leagueEntitlements('pro', 'comped')).toEqual(leagueEntitlements('pro', 'active'))
  })

  it('gives a paid Starter the league, but not ownership or white-label', () => {
    const e = leagueEntitlements('starter', 'active')
    expect(e.branded_app).toBe(true)
    expect(e.auto_highlights).toBe(true)
    expect(e.league_video_ownership).toBe(false)
    expect(e.league_posting).toBe(false)
    expect(e.clean_brand).toBe(false)
    expect(e.custom_domain).toBe(false)
  })

  it('gives a paid Pro their videos, channel and domain — but not white-label', () => {
    const e = leagueEntitlements('pro', 'active')
    expect(e.league_video_ownership).toBe(true)
    expect(e.league_posting).toBe(true)
    expect(e.custom_domain).toBe(true)
    expect(e.clean_brand).toBe(false)
  })

  it('gives a paid Dynasty white-label on top', () => {
    expect(leagueCan('clean_brand', 'dynasty', 'active')).toBe(true)
    expect(leagueCan('clean_brand', 'dynasty', 'none')).toBe(false)
    expect(leagueCan('clean_brand', 'pro', 'active')).toBe(false)
  })

  it('grants nothing for a tier that is not a plan at all', () => {
    const e = leagueEntitlements('supporter', 'active') // a MEMBER tier key
    for (const c of ALL) expect(e[c]).toBe(false)
  })

  it('returns a fresh object so a caller cannot poison the shared default', () => {
    const a = leagueEntitlements('pro', 'active')
    a.clean_brand = true
    expect(leagueEntitlements('pro', 'active').clean_brand).toBe(false)
  })
})

describe('effectiveVideoOwnership', () => {
  /**
   * `leagues.video_ownership` is Studio-writable, so an unpaid league can have
   * 'league' sitting in its row. What the config endpoint and the renderer JSON
   * serve must be what was PAID for, not what was typed.
   */
  it('collapses an unentitled league to tko even when the row says league', () => {
    expect(effectiveVideoOwnership('starter', 'active', 'league')).toBe('tko')
    expect(effectiveVideoOwnership('pro', 'none', 'league')).toBe('tko')
    expect(effectiveVideoOwnership('dynasty', 'past_due', 'league')).toBe('tko')
  })

  it('honours league ownership once it is paid for', () => {
    expect(effectiveVideoOwnership('pro', 'active', 'league')).toBe('league')
    expect(effectiveVideoOwnership('dynasty', 'comped', null)).toBe('league')
  })

  it('lets an entitled league still choose tko explicitly', () => {
    expect(effectiveVideoOwnership('pro', 'active', 'tko')).toBe('tko')
  })
})
