/**
 * Centralized feature flags so we never reach into `import.meta.env` from
 * components. Flip a feature on by setting the matching env var in
 * `.env.local` (development) or your deploy target (production).
 *
 * All flags default OFF if the env var is missing — that way a fresh clone
 * runs without API keys and the UI degrades gracefully.
 */

const env = import.meta.env

/** Stripe Connect donations (DonateButton, payouts card on /dashboard). */
export const donationsEnabled: boolean = Boolean(env.VITE_STRIPE_PUBLISHABLE_KEY)

/** Auto-upload to ReelOne YouTube channel (button on ReelDetail). */
export const youtubeAutoUploadEnabled: boolean = Boolean(env.VITE_YOUTUBE_AUTOUPLOAD === '1')

/** OCR-driven match result parsing on screenshot upload. */
export const ocrMatchResultsEnabled: boolean = env.VITE_OCR_MATCH_RESULTS !== '0'

/** Influencer dashboard (`/dashboard`). Always on; gated only by login. */
export const influencerDashboardEnabled = true

/** Frame-labeling tool for the CV roadmap (`/ai/label`). Always on. */
export const frameLabelerEnabled = true

/** Stripe public key (only used by the browser; private key lives in Edge Function secrets). */
export const STRIPE_PUBLISHABLE_KEY: string | undefined = env.VITE_STRIPE_PUBLISHABLE_KEY
