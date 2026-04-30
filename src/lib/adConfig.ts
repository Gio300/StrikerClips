/**
 * Ad slot configuration for ClutchLens.
 * Set VITE_ADSENSE_CLIENT + per-slot IDs in .env.local (or GitHub Pages secrets) to enable.
 * The AdSense script tag is auto-injected by main.tsx when VITE_ADSENSE_CLIENT is set.
 *
 * `create-gate`: full-width sponsor shown before a free user can submit a new reel
 * (paired with VITE_CREATION_AD_SECONDS). Future: `export-gate` before MP4 download.
 */
export const adConfig = {
  clientId: import.meta.env.VITE_ADSENSE_CLIENT ?? '',
  slots: {
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
  } as Record<string, string>,
}
