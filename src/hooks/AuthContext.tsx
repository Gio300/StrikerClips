import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { callFn } from '@/lib/backend'
import type { Profile } from '@/types/database'

/**
 * Shared auth state for the whole app.
 *
 * ROOT-CAUSE FIX: `useAuth()` used to be a per-component hook. Every component
 * that called it spun up its OWN `getSession()` + `onAuthStateChange`, each
 * starting from `{ user: null, loading: true }`. Components that redirected on
 * `!user` without waiting for `loading` (e.g. the Profile page) bounced a
 * signed-in user to /login before their own `getSession()` resolved.
 *
 * Now there is a SINGLE source of truth: one provider runs one session lookup
 * and one auth subscription, and every `useAuth()` consumer reads the same
 * `{ user, profile, loading }`. Redirect guards can trust a single `loading`
 * flag, so a logged-in user is never bounced.
 *
 * ENTITLEMENT-PERSISTENCE FIX: after a redeem grant writes a paid tier onto
 * `user.user_metadata`, the UI must reflect it right away. Two things make that
 * reliable here: (1) we always store a FRESH user object (spread copy) so React
 * never bails out of a re-render when a backend hands back the same session-user
 * instance after a metadata write; (2) `refreshUser()` re-mints the session and
 * re-reads the user so the grant is picked up in-session and persisted for the
 * next reload.
 */

export interface AuthState {
  user: User | null
  profile: Profile | null
  loading: boolean
  /** Re-fetch the authoritative user (e.g. after redeeming a code). */
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(async (userId: string) => {
    // Recompute power from real activity first (self-backfills), then read the
    // fresh profile. Best-effort — never block sign-in on it.
    try { await callFn('sync-power', {}) } catch { /* offline / mock */ }
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data)
  }, [])

  // Always take a shallow copy so the state reference changes even when a shim
  // mutates its cached session-user in place — otherwise React skips the render
  // and entitlement-gated UI stays stale.
  const applyUser = useCallback((u: User | null | undefined) => {
    setUser(u ? ({ ...u } as User) : null)
    if (u) fetchProfile(u.id)
    else setProfile(null)
  }, [fetchProfile])

  const refreshUser = useCallback(async () => {
    // refreshSession re-mints/re-hydrates the persisted session so the new
    // metadata survives a reload; getUser then reads the freshest record back.
    try { await supabase.auth.refreshSession() } catch { /* best-effort */ }
    const { data } = await supabase.auth.getUser()
    applyUser(data?.user ?? null)
  }, [applyUser])

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      applyUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      applyUser(session?.user ?? null)
      // A later auth event (sign-in/out) must never leave us stuck "loading".
      setLoading(false)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [applyUser])

  return (
    <AuthContext.Provider value={{ user, profile, loading, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

/**
 * Read the shared auth state. If a component renders outside the provider (e.g.
 * a stray test mount), we fall back to a safe "still loading" state instead of
 * throwing, so nothing redirects on a false `!user`.
 */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (ctx === undefined) {
    return { user: null, profile: null, loading: true, refreshUser: async () => {} }
  }
  return ctx
}
