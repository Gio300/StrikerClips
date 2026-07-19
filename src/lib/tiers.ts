/**
 * Account tiers — one source of truth for what free vs. full (Pro) users get.
 * `useEntitlements()` returns `isPremium`; gate any feature with `canUse()`.
 *
 * Free: watch (with ads), one-angle/basic reels, clans + chat, the in-app
 * browser, redeem a pass. Full (Pro / Supporter / Creator): everything below.
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
