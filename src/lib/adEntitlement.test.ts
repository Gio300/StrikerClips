import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { adFreeReason, adsHiddenFor, leagueHidesAds } from './adEntitlement'
import { LEAGUE_PLANS, leagueCan, type LeaguePlanId } from './leaguePlans'
import { hidesAds } from './tiers'

/**
 * A PAYING USER SEEING AN AD IS THE WORST OUTCOME THIS CODE HAS.
 *
 * The operator's rule is two sentences: "$1.99 just gets rid of ads.. the high
 * levels also get rid of ads". Before adEntitlement.ts only the first sentence
 * was true — `hidesAds()` takes a MEMBER tier string and has never been shown a
 * league, so a player inside a $149/mo Pro League saw exactly what a free
 * stranger saw. These tests pin both halves, and they pin them at the level
 * that actually decides: the pure resolver every ad surface consumes.
 */

const SRC = join(__dirname, '..')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')
/** The server and the catalogue script live OUTSIDE src/ but decide the same question. */
const readServer = (rel: string) => readFileSync(join(SRC, '..', 'server', rel), 'utf8')
const readScript = (rel: string) => readFileSync(join(SRC, '..', 'scripts', rel), 'utf8')

const FREE = { tier: '' }
const PAID_LEAGUE = (tier: LeaguePlanId) => ({ tier, plan_status: 'active' })

describe('adsHiddenFor — the member ladder half', () => {
  it('hides ads for every paid member tier, including the $1.99 ad_free rung', () => {
    for (const tier of ['ad_free', 'pro', 'supporter', 'creator']) {
      expect(adsHiddenFor({ tier }), tier).toBe(true)
      expect(adFreeReason({ tier })).toBe('member_tier')
    }
  })

  it('shows ads to a free member with no league', () => {
    expect(adsHiddenFor(FREE)).toBe(false)
    expect(adsHiddenFor({ tier: 'free' })).toBe(false)
    expect(adsHiddenFor({ tier: null })).toBe(false)
    expect(adsHiddenFor({})).toBe(false)
    expect(adFreeReason(FREE)).toBeNull()
  })

  it('stays exactly in step with hidesAds() for the no-league case', () => {
    for (const tier of ['', 'free', 'ad_free', 'pro', 'supporter', 'creator', 'mystery']) {
      expect(adsHiddenFor({ tier }), tier).toBe(hidesAds(tier))
    }
  })
})

describe('adsHiddenFor — the league ladder half ("the high levels also get rid of ads")', () => {
  /**
   * THE BUG THIS FILE EXISTS TO CLOSE. Each of these is a free player who pays
   * TKO nothing personally but whose league pays $149+/mo. Every one of them
   * used to see ads.
   */
  it('hides ads for a FREE member of a paid Pro / Dynasty / Enterprise league', () => {
    for (const plan of ['pro', 'dynasty', 'enterprise'] as LeaguePlanId[]) {
      expect(adsHiddenFor({ ...FREE, memberLeague: PAID_LEAGUE(plan) }), plan).toBe(true)
      expect(adFreeReason({ ...FREE, memberLeague: PAID_LEAGUE(plan) })).toBe('member_league')
    }
  })

  it('hides ads for anyone browsing an entitled league\'s own address', () => {
    expect(adsHiddenFor({ ...FREE, addressLeague: PAID_LEAGUE('dynasty') })).toBe(true)
    expect(adFreeReason({ ...FREE, addressLeague: PAID_LEAGUE('pro') })).toBe('league_address')
  })

  /**
   * SSL — the flagship at shinobistrikerleague.com — is tier 'enterprise' and
   * plan_status 'comped' (SEED_LEAGUES in src/lib/leagueConfig.ts). An operator
   * comp must entitle exactly like a live subscription or the house league
   * would start serving ads the day billing shipped.
   */
  it('treats an operator-comped league exactly like a paying one', () => {
    const ssl = { tier: 'enterprise', plan_status: 'comped' }
    expect(leagueHidesAds(ssl)).toBe(true)
    expect(adsHiddenFor({ ...FREE, memberLeague: ssl })).toBe(true)
    expect(adsHiddenFor({ ...FREE, addressLeague: ssl })).toBe(true)
  })

  it('does NOT hide ads for the $49 Starter rung — that inventory is TKO\'s', () => {
    expect(adsHiddenFor({ ...FREE, memberLeague: PAID_LEAGUE('starter') })).toBe(false)
    expect(leagueCan('member_ad_free', 'starter', 'active')).toBe(false)
  })

  /**
   * `leagues.tier` defaults to 'starter' and any owner can create a row, so tier
   * alone would hand every Studio draft a paid plan. plan_status is the money.
   */
  it('grants nothing to an unpaid, past_due or canceled league however high its tier', () => {
    for (const status of ['none', 'past_due', 'canceled', '', null, undefined]) {
      expect(adsHiddenFor({ ...FREE, memberLeague: { tier: 'dynasty', plan_status: status } }), String(status))
        .toBe(false)
    }
  })

  it('ignores a league whose tier is not a plan at all (e.g. a MEMBER tier key)', () => {
    expect(adsHiddenFor({ ...FREE, memberLeague: { tier: 'supporter', plan_status: 'active' } })).toBe(false)
    expect(leagueHidesAds(null)).toBe(false)
    expect(leagueHidesAds(undefined)).toBe(false)
  })
})

describe('adsHiddenFor — the two ladders are a UNION, never an intersection', () => {
  it('nothing can revoke ad-free: a paid member in an unpaid league still sees no ads', () => {
    expect(adsHiddenFor({
      tier: 'ad_free',
      memberLeague: { tier: 'starter', plan_status: 'none' },
      addressLeague: { tier: 'starter', plan_status: 'none' },
    })).toBe(true)
  })

  it('a free member in an entitled league sees no ads even off that league\'s address', () => {
    expect(adsHiddenFor({
      tier: '',
      memberLeague: PAID_LEAGUE('dynasty'),
      addressLeague: null,
    })).toBe(true)
  })

  /** The exhaustive cross product — every entitled combination must hide. */
  it('hides for EVERY combination where either ladder is entitled', () => {
    const tiers = ['', 'free', 'ad_free', 'pro', 'supporter', 'creator']
    const leagues = [null, PAID_LEAGUE('starter'), PAID_LEAGUE('pro'), PAID_LEAGUE('dynasty')]
    for (const tier of tiers) {
      for (const memberLeague of leagues) {
        for (const addressLeague of leagues) {
          const expected =
            hidesAds(tier) || leagueHidesAds(memberLeague) || leagueHidesAds(addressLeague)
          expect(adsHiddenFor({ tier, memberLeague, addressLeague }), `${tier}|${memberLeague?.tier}|${addressLeague?.tier}`)
            .toBe(expected)
        }
      }
    }
  })
})

describe('the ad-free league capability is on the plans the operator described', () => {
  it('is carried by Pro League and up, and only by them', () => {
    const carriers = LEAGUE_PLANS.filter((p) => p.capabilities.includes('member_ad_free')).map((p) => p.id)
    expect(carriers).toEqual(['pro', 'dynasty', 'enterprise'])
  })
})

/**
 * SOURCE GUARDS. The resolver above can be perfect and a payer can still see an
 * ad if a component forgets to consume it — which is exactly how the gap this
 * slice closes was created (hidesAds() was correct; nothing showed it a league).
 * These assert that every ad-rendering surface routes through the ONE hook, and
 * that the hook refuses to paint while the league answer is still in flight.
 */
describe('every ad surface consumes the one gate', () => {
  const SURFACES = [
    'components/AdSlot.tsx',
    'components/AdGate.tsx',
    'components/ChatAdRail.tsx',
    'components/AdRollPixel.tsx',
    'pages/ReelDetail.tsx',
  ]

  it('uses useAdsHidden(), not the league-blind hidesAds(tier)', () => {
    for (const rel of SURFACES) {
      const src = read(rel)
      expect(src, rel).toContain('useAdsHidden')
      expect(src, `${rel} still gates on the member tier alone`).not.toMatch(/\bhidesAds\s*\(/)
    }
  })

  it('waits for `resolved` before rendering anything ad-shaped', () => {
    for (const rel of SURFACES) {
      expect(read(rel), rel).toContain('resolved')
    }
  })

  /**
   * AdSlot is the last line of defence: every slot in the app renders through
   * it, so its short-circuit must come BEFORE any AdSense tag or placeholder.
   */
  it('short-circuits AdSlot before any unit or placeholder is emitted', () => {
    const src = read('components/AdSlot.tsx')
    const guard = src.indexOf('if (!resolved || adsHidden || dismissed) return null')
    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(src.indexOf('adsbygoogle block'))
    expect(guard).toBeLessThan(src.indexOf('<AdPlaceholder'))
    expect(guard).toBeLessThan(src.indexOf('<HouseAd'))
  })

  /** The hook must fail toward "show nothing", never toward "show an ad". */
  it('useAdsHidden reports resolved:false until the league lookup lands', () => {
    const hook = read('hooks/useAdsHidden.ts')
    expect(hook).toContain('const resolved = adsHidden || (!loading && !pending)')
  })
})

describe('the chat ad slot', () => {
  it('is one env-driven slot following the existing adConfig pattern', () => {
    const cfg = read('lib/adConfig.ts')
    expect(cfg).toContain("'chat-inline': import.meta.env.VITE_ADSENSE_CHAT_INLINE ?? ''")
  })

  it('renders ONE unit that rotates on a timer, not one ad per N messages', () => {
    const rail = read('components/ChatAdRail.tsx')
    expect((rail.match(/<AdSlot/g) ?? []).length).toBe(1)
    expect(rail).toContain('setInterval')
    expect(rail).toContain('visibilityState')
  })

  it('is mounted on the public chat surfaces and NOT in private DMs', () => {
    for (const rel of ['components/StreamChat.tsx', 'components/TournamentChat.tsx', 'pages/ChatSpace.tsx']) {
      expect(read(rel), rel).toContain('<ChatAdRail')
    }
    expect(read('components/social/DirectMessages.tsx')).not.toContain('ChatAdRail')
  })
})

/**
 * THE RETIRED $1.99 SKU MUST NOT COST ANYONE THEIR ADS-OFF.
 *
 * `ad_free` was retired in 2026-08 (Stripe's flat $0.30 is 15.1 points of an
 * 18.0% total fee at $1.99; any SKU under $4.23 pays Stripe over 10%). Retiring
 * a SKU in our catalogue cancels nothing in Stripe — those cards keep being
 * charged — so the entitlement has to keep working indefinitely, and it has to
 * keep working through EVERY gate, not just the one that was easy to fix.
 *
 * A subscriber who is still being billed $1.99 and starts seeing ads again is
 * the single worst outcome of this change, so it is pinned at the resolver
 * every ad surface consumes.
 */
describe('ad_free after retirement — sold no more, honoured still', () => {
  const AD_FREE = { tier: 'ad_free' }

  it('an ad_free holder sees ZERO ads, with no league helping them', () => {
    expect(adsHiddenFor(AD_FREE)).toBe(true)
    expect(adsHiddenFor({ ...AD_FREE, memberLeague: null, addressLeague: null })).toBe(true)
    expect(adFreeReason(AD_FREE)).toBe('member_tier')
  })

  it('answers identically to every still-sold paid tier', () => {
    for (const tier of ['pro', 'supporter', 'creator']) {
      expect(adsHiddenFor(AD_FREE)).toBe(adsHiddenFor({ tier }))
      expect(adFreeReason(AD_FREE)).toBe(adFreeReason({ tier }))
    }
  })

  it('is still ad-free inside a free league and on a free league address', () => {
    const FREE_LEAGUE = { tier: 'starter', plan_status: 'none' }
    expect(adsHiddenFor({ ...AD_FREE, memberLeague: FREE_LEAGUE })).toBe(true)
    expect(adsHiddenFor({ ...AD_FREE, addressLeague: FREE_LEAGUE })).toBe(true)
  })

  it('hidesAds() stays a DENYLIST, which is WHY retirement cannot un-hide ads', () => {
    // If this were an allowlist of currently-sold keys, retiring ad_free would
    // have switched ads back on for everyone still paying for it.
    expect(hidesAds('ad_free')).toBe(true)
    expect(hidesAds('a_tier_that_does_not_exist_yet')).toBe(true)
    expect(hidesAds('')).toBe(false)
    expect(hidesAds('free')).toBe(false)
    expect(read('lib/tiers.ts')).toContain("return t !== '' && t !== 'free'")
  })

  it('keeps ad_free on every HONOUR surface that is keyed by the literal string', () => {
    expect(read('lib/tiers.ts')).toContain("export type TierKey = '' | 'ad_free' | 'pro' | 'supporter' | 'creator'")
    // Billing UI can still NAME the plan a retired subscriber is paying for.
    expect(read('lib/payments.ts')).toContain("ad_free: 'Ad-Free'")
    // Server still fulfils it.
    expect(readServer('app.ts')).toContain("export const SUBSCRIPTION_TIERS = ['ad_free', 'pro', 'supporter', 'creator'] as const")
  })

  it('removes ad_free from every SELL surface', () => {
    const upgrade = read('pages/Upgrade.tsx')
    // No purchasable card, and no $1.99 anywhere a user can read.
    expect(upgrade).not.toMatch(/key:\s*'ad_free'/)
    expect(upgrade).not.toContain('priceUsd: 1.99')
    // The catalogue script must not re-create the product on the next run.
    expect(readScript('stripe-setup.ts')).not.toContain("tierKey: 'ad_free'")
    // The server shop excludes it while the fulfilment ladder keeps it.
    expect(readServer('app.ts')).toContain("export const RETIRED_TIERS = ['ad_free'] as const")
  })

  it('no user-facing surface still quotes $1.99 as a price you can pay', () => {
    for (const rel of [
      'components/AdGate.tsx',
      'components/ChatAdRail.tsx',
      'pages/Profile.tsx',
      'pages/Upgrade.tsx',
    ]) {
      const src = read(rel)
      // Strip comments — the rationale is allowed to name the retired price.
      const visible = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(visible, rel).not.toContain('$1.99')
    }
  })

  /**
   * The local answer bank is what a RATE-LIMITED Ask TKO caller sees instead of
   * the model, so a stale price here is quoted to precisely the users nobody
   * can observe. It must not sell the retired rung, and it must not pretend the
   * tier vanished for the people who hold it.
   */
  it('the offline answer bank stops selling $1.99 but still explains it', () => {
    const bar = read('components/CommandBar.tsx')
    expect(bar).not.toContain('Ad-Free ($1.99/mo) removes ads')
    expect(bar).toContain('Pro ($4.99/mo) removes ads')
    expect(bar).toContain('no longer sold')
  })

  /** A published contract naming a tier cannot silently stop matching reality. */
  it('the Terms name the retirement and promise existing subscribers no change', () => {
    const terms = read('pages/Terms.tsx')
    // JSX wraps prose across lines, so read the copy the way a user does.
    const prose = terms.replace(/\s+/g, ' ')
    expect(prose).toContain('Retired plan')
    expect(prose).toContain('no longer offered to new subscribers')
    expect(prose).toContain('tiers available to buy are')
    // The promise that matters to someone already paying $1.99/month.
    expect(prose).toContain('nothing changes')
    expect(prose).toContain('the same automatic renewal')
    // The retired rung is no longer listed among the tiers on sale — the only
    // remaining mention is the retirement paragraph, which ends in a full stop.
    expect(terms).not.toContain('Ad-Free ($1.99/month)</strong>,')
  })
})
