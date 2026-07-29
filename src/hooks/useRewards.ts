import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { earned, nextMilestone, type ArtifactDef, type EarnKind } from '@/lib/artifacts'

export interface RewardsState {
  counts: Record<EarnKind, number>
  earnedArtifacts: ArtifactDef[]
  next: Partial<Record<EarnKind, ReturnType<typeof nextMilestone>>>
  loading: boolean
}

async function countOrZero(fn: () => PromiseLike<{ count: number | null }>): Promise<number> {
  try { return (await fn()).count ?? 0 } catch { return 0 }
}

/**
 * Resolve the signed-in player's reward progress: how many clips they've
 * uploaded and friends they've referred, the artifacts that unlocks, and the
 * next milestone for each track. Counts are best-effort so a missing table
 * (e.g. referrals, until wired) just reads 0 instead of breaking the page.
 */
export function useRewards(): RewardsState {
  const { user } = useAuth()
  const [counts, setCounts] = useState<Record<EarnKind, number>>({
    uploads: 0, referrals: 0, paid_referrals: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) { setLoading(false); return }
    let alive = true
    ;(async () => {
      setLoading(true)
      const uploads = await countOrZero(() =>
        supabase.from('clips').select('id', { count: 'exact', head: true }).eq('user_id', user.id))
      // `referrals` ships in the artifacts migration; until it's applied these
      // read 0 (countOrZero swallows the missing-relation error). Cast past the
      // generated schema types so the untyped table name compiles.
      const sb = supabase as unknown as {
        from: (t: string) => {
          select: (c: string, o: { count: 'exact'; head: true }) => {
            eq: (k: string, v: unknown) => { eq: (k: string, v: unknown) => PromiseLike<{ count: number | null }> } & PromiseLike<{ count: number | null }>
          }
        }
      }
      const referrals = await countOrZero(() =>
        sb.from('referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', user.id))
      const paid = await countOrZero(() =>
        sb.from('referrals').select('id', { count: 'exact', head: true })
          .eq('referrer_id', user.id).eq('went_paid', true))
      if (alive) {
        setCounts({ uploads, referrals, paid_referrals: paid })
        setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [user?.id])

  const kinds: EarnKind[] = ['uploads', 'referrals', 'paid_referrals']
  const earnedArtifacts = kinds.flatMap((k) => earned(k, counts[k]))
  const next: Partial<Record<EarnKind, ReturnType<typeof nextMilestone>>> = {}
  for (const k of kinds) next[k] = nextMilestone(k, counts[k])

  return { counts, earnedArtifacts, next, loading }
}
