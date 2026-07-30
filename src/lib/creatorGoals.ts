import { supabase } from '@/lib/supabase'
import { callFn } from '@/lib/backend'

/**
 * Client helpers for the paid Creator/Streamer Dashboard goals + stats.
 *
 * Goals live in the public-read `creator_goals` table (so viewers and the live
 * banner can show a creator's progress). All WRITES go through trusted server
 * functions — `/api/fn/goal-set` and `/api/fn/goal-remove` — which enforce the
 * paid streaming-tier gate; the `creator_goals` TABLE_POLICY denies direct
 * writes. Real-time stats come from `/api/fn/creator-stats`, a single paid-gated
 * aggregate the dashboard polls (it reads gifted_subs received server-side,
 * which the giver-owned table policy makes unreadable from the client).
 */

export type GoalKind = 'followers' | 'sub_points' | 'donations' | 'custom'

export interface CreatorGoal {
  id: string
  user_id: string
  kind: GoalKind
  label: string
  target: number
  active: boolean
  created_at: string
}

export interface CreatorStats {
  followers: number
  subPoints: number
  donations: number
  donationCents: number
  producedVideos: number
  powerLevel: number
  tokens: number
  sweeps: number
  liveNow: boolean
  /** Per-stream viewer count — not tracked yet (server returns null). */
  liveViewers: number | null
}

export const GOAL_KINDS: { id: GoalKind; label: string; hint: string }[] = [
  { id: 'followers', label: 'Followers', hint: 'Grow your follower count' },
  { id: 'sub_points', label: 'Sub points', hint: 'Gift subs received' },
  { id: 'donations', label: 'Donations', hint: 'Number of tips received' },
  { id: 'custom', label: 'Custom', hint: 'Track anything (manual)' },
]

/** Public read of a creator's ACTIVE goals (viewers + the live banner use this). */
export async function loadActiveGoals(userId: string): Promise<CreatorGoal[]> {
  if (!userId) return []
  const { data } = await supabase
    .from('creator_goals')
    .select('id, user_id, kind, label, target, active, created_at')
    .eq('user_id', userId)
    .eq('active', true)
    .order('created_at', { ascending: true })
  return (data ?? []) as CreatorGoal[]
}

/** The signed-in creator's own real-time stats (paid-gated server aggregate). */
export async function loadCreatorStats(): Promise<CreatorStats | null> {
  const res = await callFn<{ ok: boolean; stats?: CreatorStats }>('creator-stats', {})
  return res?.ok && res.stats ? res.stats : null
}

/** Create / upsert one active goal per kind. Returns the saved goal or null. */
export async function setGoal(input: { kind: GoalKind; label: string; target: number }): Promise<CreatorGoal | null> {
  const res = await callFn<{ ok: boolean; goal?: CreatorGoal }>('goal-set', input)
  return res?.ok && res.goal ? res.goal : null
}

/** Remove one of the caller's own goals. */
export async function removeGoal(id: string): Promise<boolean> {
  const res = await callFn<{ ok: boolean }>('goal-remove', { id })
  return !!res?.ok
}

/**
 * Map a goal kind to its CURRENT value from a stats snapshot. `custom` has no
 * live metric yet, so it returns null and the UI shows the target with no bar.
 */
export function goalCurrent(kind: GoalKind, stats: CreatorStats | null): number | null {
  if (!stats) return null
  switch (kind) {
    case 'followers': return stats.followers
    case 'sub_points': return stats.subPoints
    case 'donations': return stats.donations
    case 'custom': return null
  }
}

/** Progress percent (0..100) for a goal given the current value. */
export function goalPercent(current: number | null, target: number): number {
  if (current == null || target <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((current / target) * 100)))
}

/** "24 to go" style remaining count, floored at 0. */
export function goalRemaining(current: number | null, target: number): number {
  if (current == null) return target
  return Math.max(0, target - current)
}
