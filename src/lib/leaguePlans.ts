/**
 * leaguePlans.ts — the ONE place the LEAGUE-OWNER plan catalogue lives.
 *
 * Imported by the client (plan cards, Studio gating) AND by the server
 * (checkout, webhook, the league config endpoint), exactly like leagueAssets.ts
 * and forgeTiers.ts. Retuning a plan is a one-line change here.
 *
 * ── THIS IS NOT THE MEMBER LADDER ────────────────────────────────────────────
 * Two completely separate products share the word "tier", and confusing them
 * would be a money bug:
 *
 *   MEMBER subscriptions  src/lib/tiers.ts   ad_free / pro / supporter / creator
 *                         $1.99–$29.99/mo, bought by a PLAYER, env vars
 *                         STRIPE_PRICE_AD_FREE / _PRO / _SUPPORTER / _CREATOR.
 *   LEAGUE plans          THIS FILE          starter / pro / dynasty / enterprise
 *                         bought by a league OWNER, env vars
 *                         STRIPE_PRICE_LEAGUE_STARTER / _PRO / _DYNASTY.
 *
 * Note both ladders contain the key 'pro'. The env-var namespaces are therefore
 * deliberately disjoint (`STRIPE_PRICE_LEAGUE_*`), and league checkout sessions
 * carry `metadata[kind]='league_plan'` + `metadata[league_plan]` rather than
 * `metadata[tier]` — if a league subscription ever set `metadata[tier]='pro'`
 * the member-subscription webhook branch would hand the buyer a free MEMBER Pro
 * account. server/app.ts branches on `kind` before it ever looks at `tier`.
 *
 * ── HONESTY RULE ─────────────────────────────────────────────────────────────
 * Every capability below carries a `status`, and it is derived from what the
 * code ACTUALLY does today — verified against both this repo and the render
 * factory (Loras/), not from the pricing page's ambitions:
 *
 *   shipped         enforced end-to-end right now.
 *   operator_setup  the entitlement is enforced and the renderer honours it,
 *                   but a human still has to provision something once (e.g.
 *                   drop the league's YouTube vault on the factory box). There
 *                   is no self-serve button yet.
 *   roadmap         NOT BUILT. Never put one of these in sales copy —
 *                   `sellableCapabilities()` filters them out for that reason.
 *
 * Two perks the pricing page advertised today are `roadmap`, and the data says
 * so out loud rather than quietly implying they work:
 *   • priority rendering — server/renderWorker.ts claims jobs strictly FIFO
 *     (`order by ready_at asc, created_at asc`); there is no priority column.
 *   • AI Studio asset help — POST /api/fn/league-studio-chat is gated by auth
 *     and a global 8-per-minute rate limit only. It is free to every signed-in
 *     account, on every plan.
 */

// ───────────────────────────────────────────────────────────────────────────
//  Identity
// ───────────────────────────────────────────────────────────────────────────

/** The four league plans. Mirrors the `leagues.tier` CHECK in db/schema.sql. */
export type LeaguePlanId = 'starter' | 'pro' | 'dynasty' | 'enterprise'

export const LEAGUE_PLAN_IDS: readonly LeaguePlanId[] = [
  'starter', 'pro', 'dynasty', 'enterprise',
] as const

/**
 * Whether the league was actually PAID for — `leagues.plan_status`.
 *
 * This column exists because `leagues.tier` defaults to 'starter', and
 * 'starter' is itself a $49/mo plan. Without a second column, a row somebody
 * typed into the Studio and a league somebody bought are byte-identical, so
 * every capability would leak to anyone who clicked Save. `tier` says WHICH
 * plan; `plan_status` says whether money (or an operator comp) stands behind it.
 *
 *   none      never purchased — the Studio-draft default. No paid capability.
 *   active    a live Stripe subscription.
 *   comped    operator-granted with no Stripe subscription. This is what the
 *             house leagues ('tko', 'shinobistrikerleague') run on: they
 *             predate billing and must not lose their skin the day it ships.
 *   past_due  a renewal failed and Stripe is still dunning. Capabilities OFF —
 *             matching the member ladder, which lapses on invoice.payment_failed
 *             and restores on the next invoice.paid.
 *   canceled  the subscription ended. Capabilities OFF.
 */
export type LeaguePlanStatus = 'none' | 'active' | 'comped' | 'past_due' | 'canceled'

/** Does this status entitle anything? Only a live subscription or an operator comp. */
export function planIsPaid(status: string | null | undefined): boolean {
  return status === 'active' || status === 'comped'
}

// ───────────────────────────────────────────────────────────────────────────
//  Capabilities
// ───────────────────────────────────────────────────────────────────────────

export type LeagueCapabilityId =
  | 'branded_app'
  | 'auto_highlights'
  | 'custom_domain'
  | 'clean_brand'
  | 'league_video_ownership'
  | 'league_posting'
  | 'member_ad_free'
  | 'priority_render'
  | 'ai_studio_assets'

export type CapabilityStatus = 'shipped' | 'operator_setup' | 'roadmap'

export type LeagueCapability = {
  id: LeagueCapabilityId
  /** Short label — safe for a pricing card bullet. */
  label: string
  /** One honest sentence about what actually happens. */
  detail: string
  status: CapabilityStatus
  /** Where the gate lives, so the next reader can check this file did not rot. */
  enforcedAt: string
}

export const LEAGUE_CAPABILITIES: Record<LeagueCapabilityId, LeagueCapability> = {
  branded_app: {
    id: 'branded_app',
    label: 'Your branded league inside the TKO app',
    detail:
      'Your colors, logo, tagline and anthem skin the app, the league feed and the ' +
      'produced videos. On a league domain the whole app wears the league.',
    status: 'shipped',
    enforcedAt: 'src/lib/leagueTheme.ts + GET /api/league/:slug/config',
  },
  auto_highlights: {
    id: 'auto_highlights',
    label: 'Auto-cut multi-angle highlight shorts',
    detail:
      'The render factory cuts vertical multi-angle highlights with commentary for ' +
      'your members and delivers them back into the league feed.',
    status: 'shipped',
    enforcedAt: 'Loras/common/tko_factory.py + POST /api/internal/publish-reel',
  },
  custom_domain: {
    id: 'custom_domain',
    label: 'Your own domain takes the app over',
    detail:
      'Serve the app from your domain and every surface re-skins to your league. ' +
      'tko.cam itself always stays TKO-branded.',
    status: 'shipped',
    enforcedAt: 'src/lib/leagueDomain.ts (resolveTakeover)',
  },
  clean_brand: {
    id: 'clean_brand',
    label: 'White-label — no TKO marks on your videos',
    detail:
      'Suppresses the burned-in TKO watermark and the TKO pitch line, site and ' +
      'hashtags in every title and caption, and drops the "powered by TKO" lockup ' +
      'from your app chrome.',
    status: 'shipped',
    enforcedAt:
      'clean_brand in GET /api/league/:slug/config + toRendererJson(); honoured by ' +
      'Loras/common/tko_vertical.py (marks) and tko_factory.py (title_caption)',
  },
  league_video_ownership: {
    id: 'league_video_ownership',
    label: 'You own every video',
    detail:
      'The league is declared the owner of its produced videos. The served config ' +
      'reports video_ownership="league" only for an entitled league — an unpaid ' +
      'league cannot claim it, whatever its row says.',
    status: 'shipped',
    enforcedAt: 'effectiveVideoOwnership() in GET /api/league/:slug/config',
  },
  league_posting: {
    id: 'league_posting',
    label: 'Videos post to YOUR channel',
    detail:
      'The factory posts to the league\'s own YouTube and Facebook rather than ' +
      "TKO's, and fails closed if the league's credentials are missing. The " +
      'credential vault is installed once by the operator; there is no self-serve ' +
      'channel connect for a league yet.',
    status: 'operator_setup',
    enforcedAt: 'Loras/common/tko_factory.py posting.yt_vault / posting.fb_token_env',
  },
  member_ad_free: {
    id: 'member_ad_free',
    label: 'Your league browses ad-free',
    detail:
      'Nobody sees an ad inside your league. Every AdSlot in the app — including ' +
      'the in-chat strip — short-circuits for a member of an entitled league and ' +
      'for anyone browsing the league\'s own address, without them buying a paid ' +
      'member tier at all. Members keep whatever personal tier they hold; this ' +
      'only ever ADDS an entitlement.',
    status: 'shipped',
    enforcedAt:
      'adsHiddenFor() in src/lib/adEntitlement.ts, consumed by useAdsHidden() → ' +
      'AdSlot.tsx / AdGate.tsx / ChatAdRail.tsx / AdRollPixel.tsx',
  },
  priority_render: {
    id: 'priority_render',
    label: 'Priority render queue',
    detail:
      'NOT BUILT. render_jobs has no priority column and the worker claims jobs ' +
      'strictly FIFO. The factory does sort by MEMBER tier, but nothing anywhere ' +
      'reads the league plan when ordering work.',
    status: 'roadmap',
    enforcedAt: 'server/renderWorker.ts:81 — order by ready_at asc, created_at asc',
  },
  ai_studio_assets: {
    id: 'ai_studio_assets',
    label: 'AI Studio help with league assets',
    detail:
      'NOT A PAID PERK TODAY. The Studio AI chat is open to every signed-in ' +
      'account under a global rate limit, on every plan, including no plan at all.',
    status: 'roadmap',
    enforcedAt: 'POST /api/fn/league-studio-chat — auth + rate limit only',
  },
}

// ───────────────────────────────────────────────────────────────────────────
//  The plans
// ───────────────────────────────────────────────────────────────────────────

export type LeaguePlan = {
  id: LeaguePlanId
  /** User-facing name. */
  name: string
  /** Monthly price in CENTS. null = no published price (enterprise). */
  priceCents: number | null
  billingPeriod: 'month' | 'custom'
  /** One-line positioning. */
  blurb: string
  /** Can this be bought with a card right now? Enterprise is a lead capture. */
  purchasable: boolean
  /** SERVER env var holding the Stripe price id. Null for enterprise. */
  stripeEnvVar: string | null
  /** Deterministic Stripe product id + price lookup_key (scripts/stripe-setup.ts). */
  stripeKey: string | null
  /** What this plan unlocks — ids into LEAGUE_CAPABILITIES. */
  capabilities: LeagueCapabilityId[]
  /** What the produced videos declare as their owner. */
  videoOwnership: 'tko' | 'league'
}

/**
 * THE LADDER. Prices mirror the gateway pricing cards (operator, 2026-08-03):
 * Starter $49, Pro League $149. DYNASTY'S $399 IS A PLACEHOLDER — it has never
 * appeared on a pricing page, and the operator must confirm it before the
 * Stripe product is created. Everything else about the plan is real.
 *
 * The split is VIDEO OWNERSHIP, which is also what db/schema.sql says:
 * starter posts to TKO's channel and TKO owns the videos; pro and up own their
 * videos and post to their own channel.
 */
export const LEAGUE_PLANS: readonly LeaguePlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    priceCents: 4900,
    billingPeriod: 'month',
    blurb:
      "Videos post to TKO's YouTube and TKO owns them. You get the league, the app " +
      'and the highlight machine at the lowest price.',
    purchasable: true,
    stripeEnvVar: 'STRIPE_PRICE_LEAGUE_STARTER',
    stripeKey: 'tko_league_starter',
    capabilities: ['branded_app', 'auto_highlights'],
    videoOwnership: 'tko',
  },
  {
    id: 'pro',
    name: 'Pro League',
    priceCents: 14900,
    billingPeriod: 'month',
    blurb:
      'Your channel, your videos, your audience, your domain — TKO does the cutting ' +
      'and the posting.',
    purchasable: true,
    stripeEnvVar: 'STRIPE_PRICE_LEAGUE_PRO',
    stripeKey: 'tko_league_pro',
    capabilities: [
      'branded_app',
      'auto_highlights',
      'custom_domain',
      'league_video_ownership',
      'league_posting',
      // "the high levels also get rid of ads" (operator). The ladder's high
      // levels start at Pro League: Starter is the $49 entry rung whose whole
      // positioning is "TKO owns the videos at the lowest price", so it keeps
      // TKO's ad inventory. Pro and up are ad-free for their people.
      'member_ad_free',
    ],
    videoOwnership: 'league',
  },
  {
    id: 'dynasty',
    name: 'Dynasty',
    priceCents: 39900,
    billingPeriod: 'month',
    blurb:
      'Everything in Pro League, with every TKO mark stripped off your videos and ' +
      'your app. Your league, not a league on TKO.',
    purchasable: true,
    stripeEnvVar: 'STRIPE_PRICE_LEAGUE_DYNASTY',
    stripeKey: 'tko_league_dynasty',
    capabilities: [
      'branded_app',
      'auto_highlights',
      'custom_domain',
      'league_video_ownership',
      'league_posting',
      'clean_brand',
      'member_ad_free',
      // Sold as Dynasty's ceiling once they exist; filtered out of sales copy
      // by sellableCapabilities() until then.
      'priority_render',
      'ai_studio_assets',
    ],
    videoOwnership: 'league',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    priceCents: null,
    billingPeriod: 'custom',
    blurb:
      'Multi-league operators, custom integrations and a contract. We scope it with ' +
      'you — there is no self-serve checkout.',
    // DELIBERATELY not purchasable: this captures a lead, never a card.
    purchasable: false,
    stripeEnvVar: null,
    stripeKey: null,
    capabilities: [
      'branded_app',
      'auto_highlights',
      'custom_domain',
      'league_video_ownership',
      'league_posting',
      'clean_brand',
      'member_ad_free',
      'priority_render',
      'ai_studio_assets',
    ],
    videoOwnership: 'league',
  },
]

/** The plans a card can actually be charged for. Enterprise is excluded. */
export const PURCHASABLE_LEAGUE_PLANS = LEAGUE_PLANS.filter((p) => p.purchasable)

/** Look a plan up by id. Null for anything not in the catalogue — never guess. */
export function leaguePlanById(id: string | null | undefined): LeaguePlan | null {
  return LEAGUE_PLANS.find((p) => p.id === id) ?? null
}

/** Is this a real plan id? The server's input validation. */
export function isLeaguePlanId(id: string | null | undefined): id is LeaguePlanId {
  return LEAGUE_PLAN_IDS.includes(id as LeaguePlanId)
}

/** Is this a plan a Checkout Session may be opened for? */
export function isPurchasableLeaguePlan(id: string | null | undefined): boolean {
  return !!leaguePlanById(id)?.purchasable
}

/** "$149" / "Let's talk" — the price as a pricing card shows it. */
export function leaguePlanPriceLabel(plan: LeaguePlan): string {
  if (plan.priceCents == null) return "Let's talk"
  return `$${Math.round(plan.priceCents / 100)}`
}

// ───────────────────────────────────────────────────────────────────────────
//  Entitlement — THE gate
// ───────────────────────────────────────────────────────────────────────────

export type LeagueEntitlements = Record<LeagueCapabilityId, boolean>

const NO_ENTITLEMENTS: LeagueEntitlements = {
  branded_app: false,
  auto_highlights: false,
  custom_domain: false,
  clean_brand: false,
  league_video_ownership: false,
  league_posting: false,
  member_ad_free: false,
  priority_render: false,
  ai_studio_assets: false,
}

/**
 * What a league may actually DO, from its two stored columns.
 *
 * Both are required: an unpaid row (`plan_status='none'`) gets nothing no matter
 * what `tier` says, which is what stops a league owner from typing themselves a
 * free Dynasty. Server-side this is the law; client-side it decides what renders.
 *
 * A `roadmap` capability resolves TRUE here on the plans that include it — the
 * entitlement is correct, there is simply no enforcement point consuming it yet.
 * That way the gate does not have to be revisited when the feature lands; only
 * `sellableCapabilities()` cares about the distinction, so nothing gets SOLD early.
 */
export function leagueEntitlements(
  tier: string | null | undefined,
  planStatus: string | null | undefined,
): LeagueEntitlements {
  if (!planIsPaid(planStatus)) return { ...NO_ENTITLEMENTS }
  const plan = leaguePlanById(tier)
  if (!plan) return { ...NO_ENTITLEMENTS }
  const out = { ...NO_ENTITLEMENTS }
  for (const c of plan.capabilities) out[c] = true
  return out
}

/** True when this league may use `capability` right now. */
export function leagueCan(
  capability: LeagueCapabilityId,
  tier: string | null | undefined,
  planStatus: string | null | undefined,
): boolean {
  return leagueEntitlements(tier, planStatus)[capability]
}

/**
 * The EFFECTIVE video ownership of a league — never trust the stored column.
 *
 * `leagues.video_ownership` is writable through the Studio, so an unpaid league
 * can have 'league' sitting in the row. This collapses it to what the plan
 * actually entitles, and it is what the config endpoint and the renderer JSON
 * both serve.
 */
export function effectiveVideoOwnership(
  tier: string | null | undefined,
  planStatus: string | null | undefined,
  stored?: string | null,
): 'tko' | 'league' {
  if (!leagueCan('league_video_ownership', tier, planStatus)) return 'tko'
  return stored === 'tko' ? 'tko' : 'league'
}

/**
 * The capabilities of a plan that may appear in SALES COPY — everything that is
 * `shipped` or `operator_setup`. Roadmap perks are filtered out here so a
 * pricing card physically cannot promise something the product does not do.
 */
export function sellableCapabilities(planId: LeaguePlanId): LeagueCapability[] {
  const plan = leaguePlanById(planId)
  if (!plan) return []
  return plan.capabilities
    .map((c) => LEAGUE_CAPABILITIES[c])
    .filter((c) => c.status !== 'roadmap')
}

/** Capabilities a plan includes that are not built yet — for the operator, not the buyer. */
export function roadmapCapabilities(planId: LeaguePlanId): LeagueCapability[] {
  const plan = leaguePlanById(planId)
  if (!plan) return []
  return plan.capabilities
    .map((c) => LEAGUE_CAPABILITIES[c])
    .filter((c) => c.status === 'roadmap')
}

// ───────────────────────────────────────────────────────────────────────────
//  What the league's MEMBERS inherit
// ───────────────────────────────────────────────────────────────────────────

/**
 * Members ride on the MEMBER ladder (src/lib/tiers.ts), not the league plan, so
 * these numbers are identical on every league plan — the league owner's plan
 * buys the league's identity and distribution, not their players' quotas.
 * Saying so plainly is the point: it is the question every prospect asks.
 *
 * The caps are enforced in the render factory, which reads each member's tier
 * from POST /api/internal/auto-merge-channels and counts renders against its own
 * ledger — Loras/common/tko_factory.py TIERS / FREE_TIERS / allowed().
 */
export type MemberRenderCap = {
  tier: string
  label: string
  /** Rendered highlight videos included, as a human string. */
  cap: string
  /** Do those videos get promoted into the public feed? */
  promoted: boolean
}

export const MEMBER_RENDER_CAPS: readonly MemberRenderCap[] = [
  { tier: '', label: 'Free', cap: '1 per week', promoted: false },
  { tier: 'ad_free', label: 'Ad-Free', cap: '1 per week', promoted: false },
  { tier: 'pro', label: 'Pro', cap: '4 per month', promoted: true },
  { tier: 'supporter', label: 'Elite', cap: '12 per month', promoted: true },
  { tier: 'creator', label: 'Legend', cap: '30 per month', promoted: true },
]
