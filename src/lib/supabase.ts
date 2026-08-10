import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mockSupabase } from './mockSupabase'
import { realSupabase } from './realSupabase'
import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

// Backend selection:
//   VITE_REAL_BACKEND=1 -> Express API under /api (realSupabase shim). The base
//                          is VITE_API_BASE (absolute, e.g. https://tko.cam) or
//                          same-origin /api when unset — see src/lib/apiBase.ts.
//   VITE_MOCK_BACKEND=1 -> in-memory mock (local UI testing, no server needed).
//   otherwise           -> the hosted Supabase project via createClient.
// REAL deliberately outranks MOCK: production bundles are built with an explicit
// VITE_REAL_BACKEND=1, while VITE_MOCK_BACKEND=1 lives in developers' .env.local
// files — and Vite folds .env.local into EVERY build, including production. With
// mock-first precedence a stray .env.local shipped the in-memory mock to prod
// (login "worked", every read came back empty). Real-first makes that leak inert.
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
  useRealBackend
    ? realSupabase
    : useMockBackend
      ? mockSupabase
      : createClient<Database>(supabaseUrl, supabaseAnonKey)
) as unknown as SupabaseClient<Database>
