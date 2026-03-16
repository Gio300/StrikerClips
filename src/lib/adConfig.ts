/**
 * Ad slot configuration for SmashHub.
 * Add NEXT_PUBLIC_ADSENSE_CLIENT and slot IDs to env when ready.
 */
export const adConfig = {
  clientId: import.meta.env.VITE_ADSENSE_CLIENT ?? '',
  slots: {
    'rankings-hero-below': import.meta.env.VITE_ADSENSE_RANKINGS_HERO ?? '',
    'rankings-between': import.meta.env.VITE_ADSENSE_RANKINGS_BETWEEN ?? '',
    'stat-check-hero-below': import.meta.env.VITE_ADSENSE_STAT_CHECK_HERO ?? '',
    'stat-check-between': import.meta.env.VITE_ADSENSE_STAT_CHECK_BETWEEN ?? '',
    'screenshots-submit-below': import.meta.env.VITE_ADSENSE_SCREENSHOTS_SUBMIT ?? '',
  } as Record<string, string>,
}
