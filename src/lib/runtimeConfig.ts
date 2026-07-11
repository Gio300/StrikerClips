/**
 * Runtime configuration resolver.
 *
 * Vite normally bakes `VITE_*` env vars into the bundle at BUILD time. That
 * means a production build with no Supabase keys ships a broken bundle that
 * white-screens (createClient throws on an empty URL). To make the same static
 * build deployable to any environment WITHOUT a rebuild, we also read config
 * from `window.__KILLCAM_CONFIG__`, which the container writes at startup from
 * its environment (see `docker-entrypoint.sh` → `public/runtime-config.js`).
 *
 * Resolution order (first non-empty wins):
 *   1. window.__KILLCAM_CONFIG__  (injected at container start — production)
 *   2. import.meta.env.VITE_*     (baked at build — local dev via .env.local)
 *
 * This is why the operator can set the Supabase anon key as a Cloud Run env
 * var and never needs the key at build time.
 */

type RuntimeConfig = {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  APP_URL?: string
  ADSENSE_CLIENT?: string
  ADROLL_ADV_ID?: string
  ADROLL_PIX_ID?: string
}

const w: RuntimeConfig =
  (typeof window !== 'undefined' && (window as unknown as { __KILLCAM_CONFIG__?: RuntimeConfig }).__KILLCAM_CONFIG__) || {}

const env = import.meta.env

function pick(runtimeKey: keyof RuntimeConfig, viteVal: string | undefined): string {
  const rv = w[runtimeKey]
  return (typeof rv === 'string' && rv.trim() ? rv : viteVal || '').trim()
}

export const SUPABASE_URL = pick('SUPABASE_URL', env.VITE_SUPABASE_URL)
export const SUPABASE_ANON_KEY = pick('SUPABASE_ANON_KEY', env.VITE_SUPABASE_ANON_KEY)
export const APP_URL = pick('APP_URL', env.VITE_APP_URL)
export const ADSENSE_CLIENT = pick('ADSENSE_CLIENT', env.VITE_ADSENSE_CLIENT)
export const ADROLL_ADV_ID = pick('ADROLL_ADV_ID', env.VITE_ADROLL_ADV_ID)
export const ADROLL_PIX_ID = pick('ADROLL_PIX_ID', env.VITE_ADROLL_PIX_ID)

/** True only when Supabase is fully configured. Gates the app so we render a
 * clear "configuration required" screen instead of a white page. */
export const isSupabaseConfigured = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && /^https?:\/\//i.test(SUPABASE_URL),
)
