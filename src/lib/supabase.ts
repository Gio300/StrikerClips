import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mockSupabase } from './mockSupabase'
import { realSupabase } from './realSupabase'
import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

// Backend selection:
//   VITE_MOCK_BACKEND=1 -> in-memory mock (local UI testing, no server needed).
//   VITE_REAL_BACKEND=1 -> same-origin Express API under /api (realSupabase shim).
//   otherwise           -> the hosted Supabase project via createClient.
// Never set the mock/real flags in a hosted-Supabase production build.
// The mock/real shims are structurally untyped (`any`) stand-ins, so we cast the
// selected backend to the typed client. The real hosted client already carries
// the `Database` generic via createClient<Database>. Backend selection is
// unchanged — only the exported type is annotated.
// Trim + stringify before comparing so a stray space / newline in the env var
// (e.g. `VITE_MOCK_BACKEND=1 ` from a .env line) can't silently flip backends.
const useMockBackend = String(import.meta.env.VITE_MOCK_BACKEND).trim() === '1'
const useRealBackend = String(import.meta.env.VITE_REAL_BACKEND).trim() === '1'

export const supabase = (
  useMockBackend
    ? mockSupabase
    : useRealBackend
      ? realSupabase
      : createClient<Database>(supabaseUrl, supabaseAnonKey)
) as unknown as SupabaseClient<Database>
