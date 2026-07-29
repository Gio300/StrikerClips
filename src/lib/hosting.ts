/**
 * hosting.ts — who can ADD AN ANGLE or HOST on a video, and the budget/abuse
 * limits that keep re-renders paid for. Pure + unit-tested; the cloud renderer,
 * the "add my angle" button, and the host flow all gate on these.
 *
 * The economics: every re-render/host costs cloud money (RENDER_COST_USD). So a
 * re-render is only triggered by a PAID content-tier member (their sub pays for
 * the compute), joins are BATCHED so a burst of angles costs one render, and
 * each tier has a MONTHLY re-render budget so nobody can drain us by spamming.
 */

export type Tier = 'free' | 'ad_free' | 'pro' | 'supporter' | 'creator'

/** Paid CONTENT tiers — the ones whose clips may enter the merge + trigger a
 *  re-render. `ad_free` is the no-ads tier and does NOT count (matches
 *  entitlements.hasContentTier). */
export const CONTENT_TIERS: Tier[] = ['pro', 'supporter', 'creator']
/** Top tier = "Legend"/creator. */
export const TOP_TIER: Tier = 'creator'

/** Approx cloud cost of one CPU render, for budget/quotas + reporting. */
export const RENDER_COST_USD = 0.05

/** Monthly re-render / host allowance per tier. Higher tiers pay more, get more;
 *  the cap is the abuse limit (a burst of joins still costs one render each). */
export const RERENDER_BUDGET: Record<Tier, number> = {
  free: 0,
  ad_free: 0,
  pro: 10,
  supporter: 30,
  creator: 100,
}

/** Collect angles that land within this window into ONE re-render (cost control). */
export const JOIN_BATCH_WINDOW_MS = 15 * 60 * 1000   // 15 min
/** Never re-render the same match more often than this (hard floor vs. churn). */
export const MIN_RERENDER_GAP_MS = 10 * 60 * 1000    // 10 min
/** Cap total versions of a single match so it can't be re-rendered forever. */
export const MAX_MATCH_VERSIONS = 12

export function isContentTier(tier: Tier): boolean {
  return CONTENT_TIERS.includes(tier)
}

/** Can this user add THEIR angle to a match (join → re-render)? Paid content
 *  tier AND a connected YouTube (so we can actually fetch their clip). */
export function canAddAngle(tier: Tier, hasYouTube: boolean): boolean {
  return isContentTier(tier) && hasYouTube
}

/** Legend/creator may host (commentate) on ANYONE's video. */
export function canHostAnywhere(tier: Tier): boolean {
  return tier === TOP_TIER
}

/** A lower tier that can throw tournaments may host on videos from THEIR OWN
 *  tournament, even without being top tier. `isTournamentHost` = they own/run
 *  that tournament (or hold a TKO host code). */
export function canHostOwnTournament(tier: Tier, isTournamentHost: boolean): boolean {
  return isContentTier(tier) && isTournamentHost
}

/** Combined host permission for a specific video. */
export function canHostOnVideo(opts: {
  tier: Tier
  isTournamentHost?: boolean
  videoFromTheirTournament?: boolean
}): boolean {
  if (canHostAnywhere(opts.tier)) return true
  return !!opts.videoFromTheirTournament && canHostOwnTournament(opts.tier, !!opts.isTournamentHost)
}

/** Is the user still within their monthly re-render/host budget? */
export function withinRenderBudget(tier: Tier, usedThisMonth: number): boolean {
  return usedThisMonth < RERENDER_BUDGET[tier]
}

/** Should we re-render a match right now, given a newly joined angle? Batches
 *  bursts, enforces the min gap, and caps total versions. Pure so it's testable. */
export function shouldRerender(args: {
  now: number
  lastRenderAt: number | null      // when this match last rendered (ms epoch)
  versions: number                 // how many versions already exist
  pendingSince: number | null      // when the earliest un-rendered join arrived
}): { render: boolean; reason: string } {
  if (args.versions >= MAX_MATCH_VERSIONS) return { render: false, reason: 'max_versions' }
  if (args.lastRenderAt != null && args.now - args.lastRenderAt < MIN_RERENDER_GAP_MS) {
    return { render: false, reason: 'min_gap' }
  }
  // let a burst of joiners settle so they land in one render
  if (args.pendingSince != null && args.now - args.pendingSince < JOIN_BATCH_WINDOW_MS) {
    return { render: false, reason: 'batching' }
  }
  return { render: true, reason: 'ok' }
}

/** Estimated monthly cloud cost a tier's full budget represents (for reporting). */
export function budgetCostUsd(tier: Tier): number {
  return RERENDER_BUDGET[tier] * RENDER_COST_USD
}
