import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'
import { fetchMemberLeague } from '@/lib/leagueConfig'
import { adsHiddenFor, adFreeReason, type AdFreeReason, type LeagueAdContext } from '@/lib/adEntitlement'

/**
 * useAdsHidden — the ONE hook every ad surface asks before painting.
 *
 * It answers the union of both ad-free ladders (see src/lib/adEntitlement.ts):
 * the viewer's personal MEMBER tier, the league they are a MEMBER of, and the
 * league whose ADDRESS this page is served as.
 *
 * ── WHY IT RETURNS `resolved` ───────────────────────────────────────────────
 * The member tier is synchronous (it lives on `user.user_metadata`). League
 * membership is a round trip. If an ad painted while that round trip was in
 * flight, every member of a paid league would see an ad flash on every page
 * load — which is the single worst outcome this gate exists to prevent. So the
 * hook reports `resolved: false` until it KNOWS, and callers render nothing
 * until then. An ad appearing 200ms late costs nothing; an ad appearing at all
 * for someone who paid not to see one costs a refund and a review.
 *
 * `resolved` is true IMMEDIATELY (no waiting, no fetch) whenever the answer
 * cannot change: signed out, still loading auth, or the member tier already
 * hides ads.
 *
 * FAIL-SOFT: a failed or unreachable membership lookup resolves to "no league",
 * i.e. ads show for a free member. That matches every other league read in the
 * app (fetchMemberLeague itself swallows and returns null) and it degrades
 * toward the status quo rather than toward silently zeroing ad revenue.
 */

export type AdsHiddenState = {
  /** True when NOTHING ad-shaped may render for this viewer. */
  adsHidden: boolean
  /** False while the league answer is still in flight — render nothing. */
  resolved: boolean
  /** Which ladder paid for it (for support + upgrade copy). */
  reason: AdFreeReason
}

/**
 * Per-user membership cache. One lookup per signed-in user per page load,
 * shared by every mounted AdSlot — without it a feed with six slots would fire
 * six identical queries.
 */
const leagueCache = new Map<string, LeagueAdContext>()
const inFlight = new Map<string, Promise<LeagueAdContext>>()

function loadMemberLeague(userId: string): Promise<LeagueAdContext> {
  const cached = inFlight.get(userId)
  if (cached) return cached
  const p = fetchMemberLeague(userId)
    .then((cfg) => {
      const ctx: LeagueAdContext = cfg ? { tier: cfg.tier, plan_status: cfg.plan_status } : null
      leagueCache.set(userId, ctx)
      return ctx
    })
    .catch(() => {
      // Fail-soft: treat as unaffiliated. Do NOT cache a failure — a transient
      // outage should not pin someone to "sees ads" for the whole session.
      inFlight.delete(userId)
      return null
    })
  inFlight.set(userId, p)
  return p
}

/** Test seam: drop the module-level membership cache. */
export function resetAdLeagueCache(): void {
  leagueCache.clear()
  inFlight.clear()
}

export function useAdsHidden(): AdsHiddenState {
  const { user, loading } = useAuth()
  const { tier } = useEntitlements()
  const { league } = useLeagueTheme()

  const userId = user?.id ?? ''
  const [memberLeague, setMemberLeague] = useState<LeagueAdContext>(
    () => (userId ? leagueCache.get(userId) ?? undefined : null),
  )

  // `undefined` = not looked up yet, `null` = looked up, no league.
  const pending = userId ? memberLeague === undefined : false

  useEffect(() => {
    if (!userId) {
      setMemberLeague(null)
      return
    }
    if (leagueCache.has(userId)) {
      setMemberLeague(leagueCache.get(userId) ?? null)
      return
    }
    let alive = true
    void loadMemberLeague(userId).then((ctx) => {
      if (alive) setMemberLeague(ctx ?? null)
    })
    return () => { alive = false }
  }, [userId])

  // The address takeover already carries the league's two entitlement columns
  // (src/lib/leagueTheme.ts LeagueConfig), so it needs no extra round trip.
  const addressLeague: LeagueAdContext = league
    ? { tier: league.tier ?? null, plan_status: league.plan_status ?? null }
    : null

  const input = { tier, memberLeague: memberLeague ?? null, addressLeague }
  const adsHidden = adsHiddenFor(input)

  // Resolved the moment the answer can no longer change: already hidden, signed
  // out, or the membership lookup landed. Auth still loading counts as pending
  // for a would-be signed-in user, since their tier isn't known yet either.
  const resolved = adsHidden || (!loading && !pending)

  return { adsHidden, resolved, reason: adFreeReason(input) }
}
