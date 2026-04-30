import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

/**
 * useInviteContext — pre-fetches the things the current user is *allowed*
 * to invite people INTO. Used by `UniversalInviteMenu` to populate the
 * dropdown without re-querying every time the menu opens.
 *
 * Returns lightweight lists of:
 *   - tournaments I created (so I can invite admins to them)
 *   - live groups I created (so I can invite members)
 *   - servers/clans I own (so I can invite members)
 *   - reels I created with open invite slots (so I can invite friends to add a clip)
 *
 * Empty arrays when the user is logged out — the menu falls back to safe
 * actions (View profile, Follow, DM).
 */

export type OwnedTournament = { id: string; name: string }
export type OwnedLiveGroup = { id: string; name: string }
export type OwnedServer = { id: string; name: string }
export type PendingStatCheck = {
  id: string
  tournament_id: string
  tournament_name: string
  invited_admin_id: string | null
}

export type InviteContext = {
  ready: boolean
  ownedTournaments: OwnedTournament[]
  ownedLiveGroups: OwnedLiveGroup[]
  ownedServers: OwnedServer[]
  /** My pending stat-check submissions (so I can route to a different admin). */
  myPendingStatChecks: PendingStatCheck[]
}

const empty: InviteContext = {
  ready: false,
  ownedTournaments: [],
  ownedLiveGroups: [],
  ownedServers: [],
  myPendingStatChecks: [],
}

let cache: { uid: string; data: InviteContext } | null = null

/**
 * Cached per-session. Refresh via `refreshInviteContext()`.
 */
export function useInviteContext(): InviteContext {
  const { user } = useAuth()
  const [ctx, setCtx] = useState<InviteContext>(() => {
    if (user && cache?.uid === user.id) return cache.data
    return empty
  })

  useEffect(() => {
    if (!user) {
      setCtx(empty)
      cache = null
      return
    }
    if (cache?.uid === user.id && cache.data.ready) {
      setCtx(cache.data)
      return
    }
    let cancelled = false
    ;(async () => {
      const [t, lg, srv, sc] = await Promise.all([
        supabase
          .from('tournaments')
          .select('id, name')
          .eq('created_by', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('live_groups')
          .select('id, name')
          .eq('creator_id', user.id)
          .order('created_at', { ascending: false }),
        // Servers may have varying schemas. Best-effort — gracefully empty.
        supabase
          .from('servers')
          .select('id, name, owner_id')
          .eq('owner_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('stat_check_submissions')
          .select('id, tournament_id, invited_admin_id, tournaments(name)')
          .eq('user_id', user.id)
          .eq('status', 'pending'),
      ])
      if (cancelled) return
      type StatCheckRow = {
        id: string
        tournament_id: string | null
        invited_admin_id: string | null
        tournaments?: { name: string } | { name: string }[] | null
      }
      const data: InviteContext = {
        ready: true,
        ownedTournaments: (t.data ?? []) as OwnedTournament[],
        ownedLiveGroups: (lg.data ?? []) as OwnedLiveGroup[],
        ownedServers: ((srv.data ?? []) as { id: string; name: string }[]).map((s) => ({
          id: s.id,
          name: s.name,
        })),
        myPendingStatChecks: ((sc.data ?? []) as StatCheckRow[])
          .filter((r): r is StatCheckRow & { tournament_id: string } => Boolean(r.tournament_id))
          .map((r) => {
            const t = Array.isArray(r.tournaments) ? r.tournaments[0] : r.tournaments
            return {
              id: r.id,
              tournament_id: r.tournament_id,
              invited_admin_id: r.invited_admin_id,
              tournament_name: t?.name ?? 'Tournament',
            }
          }),
      }
      cache = { uid: user.id, data }
      setCtx(data)
    })()
    return () => { cancelled = true }
  }, [user])

  return ctx
}

/** Force a refetch on next mount (e.g., after the user creates a tournament). */
export function invalidateInviteContext(): void {
  cache = null
}
