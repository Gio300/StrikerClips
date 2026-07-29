/**
 * Account tiers — one source of truth for what free vs. full (Pro) users get.
 * `useEntitlements()` returns `isPremium`; gate any feature with `canUse()`.
 *
 * Free: watch (with ads), one-angle/basic reels, clans + chat, the in-app
 * browser, redeem a pass. Paid tiers (shown as Pro / Elite / Legend; keys stay
 * `pro` / `supporter` / `creator`): everything below.
 */

export type Feature =
  // free
  | 'watch'
  | 'basic_reel'
  | 'clans_chat'
  | 'browser'
  | 'redeem'
  // full / pro
  | 'multi_angle'
  | 'voice_director'
  | 'slow_mo'
  | 'auto_publish'
  | 'music_library'
  | 'no_ad_gate'
  | 'live_studio'
  | 'ai_commentary'

export const FREE_FEATURES: Feature[] = ['watch', 'basic_reel', 'clans_chat', 'browser', 'redeem']

export const FEATURE_LABELS: Record<Feature, string> = {
  watch: 'Watch reels & streams',
  basic_reel: 'Single-angle reels',
  clans_chat: 'Clans & live chat',
  browser: 'In-app browser',
  redeem: 'Redeem passes',
  multi_angle: 'Multi-angle director cuts',
  voice_director: 'Voice / text live director',
  slow_mo: 'Slow-motion replays',
  auto_publish: 'Auto-publish to our YouTube',
  music_library: 'Licensed music library',
  no_ad_gate: 'Skip the create-gate ad wait',
  live_studio: 'Live studio (run a stream link)',
  ai_commentary: 'AI play-by-play voiceover',
}

export function isFree(feature: Feature): boolean {
  return FREE_FEATURES.includes(feature)
}

// ─────────────────────────────────────────────────────────────────────────
//  AD-FREE TIER — a low, $1.99/mo tier whose ONLY perk is "no ads".
//
//  `ad_free` is a recognized tier key but is deliberately NOT part of the
//  streaming ladder below (it never appears in TIER_LEVEL), so adding it can't
//  shift any placement gate. It grants no streaming perks — just hides ads.
// ─────────────────────────────────────────────────────────────────────────

/** All recognized non-free tier keys (streaming ladder + the ad-free tier). */
export type TierKey = '' | 'ad_free' | 'pro' | 'supporter' | 'creator'

/**
 * The single HIGHEST paid plan (key `creator`, shown as "Legend"). This is the
 * top of the streaming ladder (TIER_LEVEL 3) and what the founder bypass and the
 * TKO-BETA tester pass both grant. The HOST lane is gated to this tier OR a
 * founder host code (see canHost in src/lib/tkoKing.ts).
 */
export const TOP_TIER: TierKey = 'creator'

/** True if a resolved (non-expired) tier string is the single top paid plan. */
export function isTopTierKey(tier: string | undefined | null): boolean {
  return (tier ?? '') === TOP_TIER
}

/**
 * True if a user on this tier should have ads hidden. Any non-free tier hides
 * ads: the dedicated `ad_free` tier plus every streaming tier (pro / supporter
 * / creator). Free ('' or 'free') still sees ads.
 */
export function hidesAds(tier: string | undefined | null): boolean {
  const t = tier ?? ''
  return t !== '' && t !== 'free'
}

/** True if a user at the given premium state may use `feature`. */
export function canUse(feature: Feature, isPremium: boolean): boolean {
  return isFree(feature) || isPremium
}

/** The features unlocked by going Pro (for upgrade prompts / pricing UI). */
export function proFeatures(): { id: Feature; label: string }[] {
  return (Object.keys(FEATURE_LABELS) as Feature[])
    .filter((f) => !isFree(f))
    .map((f) => ({ id: f, label: FEATURE_LABELS[f] }))
}

// ─────────────────────────────────────────────────────────────────────────
//  TIER LADDER — for "Go Live" placement gating.
//
//  Free can't stream at all. Paid tiers form a simple ladder; higher placements
//  (clan page, front page) need higher tiers. We reuse the existing tier strings
//  from useEntitlements() (`pro` / `supporter` / `creator`) as the three paid
//  rungs so nothing else has to change.
//
//    free/''    = 0  (can't live stream)
//    pro        = 1  (stream on My Profile)
//    supporter  = 2  (+ My Clan page)
//    creator    = 3  (+ Front Page)
// ─────────────────────────────────────────────────────────────────────────

export type Placement = 'profile' | 'clan' | 'front_page' | 'tournament'

/** Map a tier string (from useEntitlements) to its ladder level. */
export const TIER_LEVEL: Record<string, number> = {
  '': 0,
  free: 0,
  pro: 1,
  supporter: 2,
  creator: 3,
}

/** Minimum ladder level each placement requires. Tournament = any paid tier. */
export const PLACEMENT_MIN_LEVEL: Record<Placement, number> = {
  profile: 1,
  clan: 2,
  front_page: 3,
  tournament: 1,
}

/** Human label for each placement (for the Go Live cards). */
export const PLACEMENT_LABEL: Record<Placement, string> = {
  profile: 'My Profile',
  clan: 'My Clan Page',
  front_page: 'Front Page',
  tournament: 'Tournament',
}

/**
 * Display name a user sees for each ladder level (for nudges / pricing UI).
 * These are the USER-FACING tier names: Free / Pro / Elite / Legend. The
 * underlying key strings stay `pro` / `supporter` / `creator` (see TIER_LEVEL)
 * so entitlement logic, redeem codes, and tests are unaffected.
 */
export const LEVEL_TIER_NAME: Record<number, string> = {
  1: 'Pro',
  2: 'Elite',
  3: 'Legend',
}

export function tierLevel(tier: string | undefined | null): number {
  return TIER_LEVEL[tier ?? ''] ?? 0
}

/** True if a user on `tier` may stream to `placement`. */
export function canStreamTo(placement: Placement, tier: string | undefined | null): boolean {
  return tierLevel(tier) >= PLACEMENT_MIN_LEVEL[placement]
}

/** The minimum tier level a placement needs (e.g. for pricing / gates). */
export function tierForPlacement(placement: Placement): number {
  return PLACEMENT_MIN_LEVEL[placement]
}

/** One-line upgrade nudge shown on a locked placement card. */
export function upgradeNudge(placement: Placement): string {
  const need = LEVEL_TIER_NAME[PLACEMENT_MIN_LEVEL[placement]] ?? 'a paid'
  switch (placement) {
    case 'front_page': return `Upgrade to ${need} to stream on the front page`
    case 'clan': return `Upgrade to ${need} to stream on your clan page`
    case 'profile': return `Upgrade to ${need} to live stream on your profile`
    case 'tournament': return `Upgrade to ${need} to stream to a tournament`
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  ORACLE PREDICTION QUOTA — how many tournaments a user may hold an OPEN
//  prediction on at the same time.
//
//  This is the Oracle system's tier gate. Predicting is FREE (correct guesses
//  earn cosmetic assets + Oracle badges, never cash — see src/lib/predictions.ts);
//  your tier just caps how many live guesses you can juggle at once. Higher tiers
//  = more simultaneous calls. Unlike TIER_LEVEL this DELIBERATELY includes
//  `ad_free`, since the cap is a soft convenience gate, not a streaming gate.
//
//    free/''    = 1
//    ad_free    = 2
//    pro        = 3
//    supporter  = 6   (shown as Elite)
//    creator    = ∞   (shown as Legend — unlimited)
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
//  ART / ASSET UPLOAD CAP — how many pieces of gear (assets) a user may LIST.
//
//  The Team Shop lets users design & sell cosmetics (jerseys, banners, emotes,
//  badge skins — see src/lib/assets.ts). Free accounts get a small taste; paid
//  tiers unlock progressively more; Legend (creator) is unlimited. Like the
//  prediction quota this DELIBERATELY includes `ad_free` (a soft convenience cap,
//  not a streaming gate) — and since ad_free isn't a creation tier it stays at
//  the free cap.
//
//    free/''    = 3
//    ad_free    = 3   (no creation perks — same as free)
//    pro        = 25
//    supporter  = 100 (shown as Elite)
//    creator    = ∞   (shown as Legend — unlimited)
// ─────────────────────────────────────────────────────────────────────────

export const ART_UPLOAD_LIMIT: Record<TierKey, number> = {
  '': 3,
  ad_free: 3,
  pro: 25,
  supporter: 100,
  creator: Infinity,
}

/**
 * How many assets a tier may list. Unknown / free tiers (including the literal
 * 'free') fall back to the free cap.
 */
export function artUploadLimit(tier: string | undefined | null): number {
  const t = (tier ?? '') as TierKey
  const cap = ART_UPLOAD_LIMIT[t]
  return typeof cap === 'number' ? cap : ART_UPLOAD_LIMIT['']
}

/** True if a user on `tier` may list one more asset given how many they already have. */
export function canUploadArt(currentCount: number, tier: string | undefined | null): boolean {
  return currentCount < artUploadLimit(tier)
}

/**
 * One-line nudge shown when a user has hit their upload cap. Points at the next
 * rung that actually raises the cap.
 */
export function artUploadUpgradeNudge(tier: string | undefined | null): string {
  const cur = artUploadLimit(tier)
  const curLabel = cur === Infinity ? 'unlimited' : String(cur)
  const curName = tierUploadName(tier)
  const next = [
    { name: 'Pro', cap: ART_UPLOAD_LIMIT.pro },
    { name: 'Elite', cap: ART_UPLOAD_LIMIT.supporter },
    { name: 'Legend', cap: ART_UPLOAD_LIMIT.creator },
  ].find((r) => r.cap > cur)
  if (!next) return `You're at your upload cap (${curLabel}).`
  const target = next.cap === Infinity ? `${next.name} for unlimited` : `${next.name} for ${next.cap}`
  return `You've reached your ${curName} upload limit (${curLabel}) — upgrade to ${target}.`
}

/** Friendly tier name used in upload-cap copy. */
function tierUploadName(tier: string | undefined | null): string {
  switch ((tier ?? '') as TierKey) {
    case 'pro': return 'Pro'
    case 'supporter': return 'Elite'
    case 'creator': return 'Legend'
    case 'ad_free': return 'Ad-Free'
    default: return 'Free'
  }
}

export const PREDICTION_QUOTA: Record<TierKey, number> = {
  '': 1,
  ad_free: 2,
  pro: 3,
  supporter: 6,
  creator: Infinity,
}

/**
 * How many simultaneously-OPEN predictions a tier allows. Unknown / free tiers
 * (including the literal 'free') fall back to the free quota of 1.
 */
export function predictionQuota(tier: string | undefined | null): number {
  const t = (tier ?? '') as TierKey
  const q = PREDICTION_QUOTA[t]
  return typeof q === 'number' ? q : PREDICTION_QUOTA['']
}

/**
 * One-line upgrade nudge for when a user is at their open-prediction cap.
 * Points at the next rung up that actually raises the quota.
 */
export function predictionUpgradeNudge(tier: string | undefined | null): string {
  const cur = predictionQuota(tier)
  const curLabel = cur === Infinity ? 'unlimited' : String(cur)
  const next = [
    { name: 'Pro', q: PREDICTION_QUOTA.pro },
    { name: 'Elite', q: PREDICTION_QUOTA.supporter },
    { name: 'Legend', q: PREDICTION_QUOTA.creator },
  ].find((r) => r.q > cur)
  if (!next) {
    return `You're at your prediction cap (${curLabel}). Resolve one to free up a slot.`
  }
  const target = next.q === Infinity ? `${next.name} for unlimited` : `${next.name} for ${next.q}`
  return `You're at your prediction cap (${curLabel}). Upgrade to ${target} simultaneous predictions.`
}
