import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './runtimeConfig'

/**
 * Supabase browser client.
 *
 * Config comes from `runtimeConfig` (window.__KILLCAM_CONFIG__ at runtime, or
 * VITE_* baked at build). When it is missing we still export a client built
 * against a harmless placeholder so top-level `import { supabase }` never
 * throws — the app instead short-circuits to a "configuration required" screen
 * (see `main.tsx` / `isSupabaseConfigured`). This is what prevents the white
 * screen the deploy used to show when the anon key was absent.
 */
const url = isSupabaseConfigured ? SUPABASE_URL : 'https://placeholder.supabase.co'
const key = isSupabaseConfigured ? SUPABASE_ANON_KEY : 'placeholder-anon-key'

export const supabase = createClient(url, key)

export { isSupabaseConfigured }
