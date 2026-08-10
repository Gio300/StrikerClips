/**
 * Single ad-account config surface for TKO.
 *
 * ─── OWNER: paste your ad-network account IDs here ──────────────────────────
 * Everything is read from Vite env vars with an empty-string default, so every
 * network stays INERT (nothing loads, nothing tracks) until you fill it in.
 * Set these in `.env.local` for local dev, or in your deploy env / GitHub Pages
 * secrets for production:
 *
 *   Google AdSense / AdMob
 *     VITE_ADSENSE_CLIENT          your publisher id, e.g. "ca-pub-1234567890123456"
 *     VITE_ADSENSE_<SLOT>          per-slot ad-unit ids (one per row in `slots` below)
 *     → The AdSense <script> is auto-injected by main.tsx when VITE_ADSENSE_CLIENT
 *       is set; AdSlot.tsx renders real units for any slot that also has an id,
 *       and falls back to the in-house "house ad" otherwise.
 *
 *   AdRoll retargeting (Smart Pixel v2)
 *     VITE_ADROLL_ADV_ID          your AdRoll advertiser id
 *     VITE_ADROLL_PIX_ID          your AdRoll pixel id
 *     → The pixel is injected by <AdRollPixel/> (mounted in Layout.tsx) ONLY
 *       when BOTH ids are present.
 * ───────────────────────────────────────────────────────────────────────────
 */

/** Google AdSense/AdMob publisher (client) id. Empty = house-ad fallback only. */
export const adsenseClient = import.meta.env.VITE_ADSENSE_CLIENT ?? ''

/** Per-slot AdSense ad-unit ids. Empty value for a slot = house ad for that slot. */
export const adsenseSlots: Record<string, string> = {
  'rankings-hero-below': import.meta.env.VITE_ADSENSE_RANKINGS_HERO ?? '',
  'rankings-between': import.meta.env.VITE_ADSENSE_RANKINGS_BETWEEN ?? '',
  'stat-check-hero-below': import.meta.env.VITE_ADSENSE_STAT_CHECK_HERO ?? '',
  'stat-check-between': import.meta.env.VITE_ADSENSE_STAT_CHECK_BETWEEN ?? '',
  'screenshots-submit-below': import.meta.env.VITE_ADSENSE_SCREENSHOTS_SUBMIT ?? '',
  'reel-preroll': import.meta.env.VITE_ADSENSE_REEL_PREROLL ?? '',
  'reel-top': import.meta.env.VITE_ADSENSE_REEL_TOP ?? '',
  'reel-bottom': import.meta.env.VITE_ADSENSE_REEL_BOTTOM ?? '',
  'landing-mid': import.meta.env.VITE_ADSENSE_LANDING_MID ?? '',
  'reels-list-inline': import.meta.env.VITE_ADSENSE_REELS_LIST_INLINE ?? '',
  'feed-inline': import.meta.env.VITE_ADSENSE_FEED_INLINE ?? '',
  'create-gate': import.meta.env.VITE_ADSENSE_CREATE_GATE ?? '',
  'export-gate': import.meta.env.VITE_ADSENSE_EXPORT_GATE ?? '',
  // ONE small strip pinned under the message list on every PUBLIC chat surface
  // (live stream chat, tournament chat, clan/open channels). Deliberately not
  // one-ad-per-N-messages: it is a single unit that swaps creative on a timer
  // (see ChatAdRail.tsx), so the feed itself is never interrupted. DMs are
  // excluded — a private conversation carries no inventory.
  'chat-inline': import.meta.env.VITE_ADSENSE_CHAT_INLINE ?? '',
}

/**
 * How often the single in-chat strip swaps creative, in SECONDS.
 * Operator's words: "small ad at the bottom that changes every once in a while".
 * Clamped to a sane band by chatAdRotateMs() so a typo can't spin the ad.
 */
export const adChatRotateSeconds = import.meta.env.VITE_AD_CHAT_ROTATE_SECONDS ?? ''

/** Rotation period in ms — default 45s, clamped to [20s, 10min]. */
export function chatAdRotateMs(raw: string = adChatRotateSeconds): number {
  const n = Number.parseInt(raw, 10)
  const seconds = Number.isFinite(n) && n > 0 ? n : 45
  return Math.min(600, Math.max(20, seconds)) * 1000
}

/** AdRoll Smart Pixel v2 advertiser id. Empty = pixel stays inert. */
export const adrollAdvId = import.meta.env.VITE_ADROLL_ADV_ID ?? ''

/** AdRoll Smart Pixel v2 pixel id. Empty = pixel stays inert. */
export const adrollPixId = import.meta.env.VITE_ADROLL_PIX_ID ?? ''

/**
 * Fallback behaviour when AdSense isn't configured for a slot.
 *
 * By DEFAULT (this flag off) an unconfigured slot renders a clearly-labeled
 * "Advertisement · your ad here" PLACEHOLDER box at the correct size, so the
 * team can SEE exactly where ads sit in every flow before a network is wired.
 *
 * Set `VITE_AD_HOUSE_ADS=1` to instead serve the clickable in-house "house ad"
 * creatives (promote signup / tournaments / live) in those same slots.
 */
export const adHouseAds = import.meta.env.VITE_AD_HOUSE_ADS === '1'

/**
 * Back-compat aggregate consumed by AdSlot.tsx (`clientId` + `slots`).
 * New code can import the named exports above directly.
 */
export const adConfig = {
  clientId: adsenseClient,
  slots: adsenseSlots,
  houseAds: adHouseAds,
}
