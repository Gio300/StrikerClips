/**
 * adEntitlement — THE question "should this person see an ad?", answered once.
 *
 * Two completely separate products can buy ad-free, and before this file only
 * one of them worked:
 *
 *   MEMBER ladder   src/lib/tiers.ts      a PLAYER holds `ad_free` (the $1.99
 *                                          rung, RETIRED 2026-08 but still
 *                                          honoured and still renewing) or
 *                                          pro/supporter/creator, which include
 *                                          it. `hidesAds(tier)`.
 *   LEAGUE ladder   src/lib/leaguePlans.ts a league OWNER pays for Pro League /
 *                                          Dynasty / Enterprise, which carry the
 *                                          `member_ad_free` capability for their
 *                                          people. `leagueCan(...)`.
 *
 * The operator's rule is "$1.99 just gets rid of ads.. the high levels also get
 * rid of ads". `hidesAds()` alone only ever answered the first half — it takes a
 * member tier string and has never been shown a league. This module is the union
 * of the two, and it is what every ad surface consumes (through the
 * `useAdsHidden()` hook, which does the async membership lookup).
 *
 * Pure, no React, no Supabase, injectable inputs — same shape as tiers.ts and
 * leaguePlans.ts, so the whole gate is unit-testable and one import deep.
 *
 * FAIL DIRECTION: every unknown resolves toward SHOWING an ad here, and the hook
 * on top compensates by refusing to render anything until the league answer is
 * IN. That split matters: a pure function that guessed "hidden" on missing data
 * would silently zero out ad revenue the day a query broke, whereas a component
 * that waits simply paints the ad a moment later — while a paying member never
 * sees one flash.
 */

import { hidesAds } from './tiers'
import { leagueCan, type LeagueCapabilityId } from './leaguePlans'

/** The league capability that buys a league's people out of ads. */
export const AD_FREE_LEAGUE_CAPABILITY: LeagueCapabilityId = 'member_ad_free'

/** The two stored columns of a league, as any ad surface sees them. */
export type LeagueAdContext = {
  /** `leagues.tier` — a LeaguePlanId. */
  tier?: string | null
  /** `leagues.plan_status` — only 'active' / 'comped' entitle anything. */
  plan_status?: string | null
} | null | undefined

export type AdEntitlementInput = {
  /** The viewer's MEMBER tier ('' | 'ad_free' | 'pro' | 'supporter' | 'creator'). */
  tier?: string | null
  /**
   * The league this viewer is a MEMBER of (`league_members` → `leagues`), or
   * null when they are unaffiliated / signed out.
   */
  memberLeague?: LeagueAdContext
  /**
   * The league whose ADDRESS this page is being served as — `tko.cam/<slug>`,
   * `<slug>.tko.cam`, or the league's own domain (see src/lib/leagueDomain.ts).
   *
   * Counted deliberately. An entitled league that paid for its own address is
   * buying a space that is theirs; running Google's inventory inside it is
   * exactly the "TKO marks on my league" complaint the higher plans exist to
   * remove. The cost of including it is only forgone ad revenue on that
   * league's own domain; the cost of leaving it out is a paying league's
   * audience seeing ads on the league's own front page.
   */
  addressLeague?: LeagueAdContext
}

/** True when a league's two columns entitle its people to no ads. */
export function leagueHidesAds(league: LeagueAdContext): boolean {
  if (!league) return false
  return leagueCan(AD_FREE_LEAGUE_CAPABILITY, league.tier ?? null, league.plan_status ?? null)
}

/**
 * THE gate. True when this viewer must not be shown an ad, from EITHER ladder.
 *
 * Union, never intersection: a free member inside a Dynasty league is ad-free,
 * and an `ad_free` member in no league at all is ad-free. Nothing here can
 * REVOKE ad-free — every branch only ever adds a reason to hide.
 */
export function adsHiddenFor(input: AdEntitlementInput): boolean {
  if (hidesAds(input.tier)) return true
  if (leagueHidesAds(input.memberLeague)) return true
  if (leagueHidesAds(input.addressLeague)) return true
  return false
}

/**
 * Why ads are hidden — for support ("I still see ads") and for the upgrade copy,
 * which must not pitch $1.99 Ad-Free at someone whose league already covers it.
 */
export type AdFreeReason = 'member_tier' | 'member_league' | 'league_address' | null

export function adFreeReason(input: AdEntitlementInput): AdFreeReason {
  if (hidesAds(input.tier)) return 'member_tier'
  if (leagueHidesAds(input.memberLeague)) return 'member_league'
  if (leagueHidesAds(input.addressLeague)) return 'league_address'
  return null
}
