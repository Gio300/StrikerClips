import { createClient } from '@supabase/supabase-js'
import { mockSupabase } from './mockSupabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

// VITE_MOCK_BACKEND=1 swaps in an in-memory backend for local end-to-end UI
// testing (no Docker / cloud needed). Never set in production.
export const supabase = (
  import.meta.env.VITE_MOCK_BACKEND === '1'
    ? mockSupabase
    : createClient(supabaseUrl, supabaseAnonKey)
) as ReturnType<typeof createClient>
