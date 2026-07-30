import { supabase } from '@/lib/supabase'

/**
 * activity — write to the public `activities` feed.
 *
 * The Activity tab reads `activities` for you + everyone you follow, but nothing
 * ever WROTE to it, so it was always empty. This is the single place that
 * records a feed event. Best-effort: a feed write must never block or fail the
 * action that triggered it.
 */
export type ActivityType = 'reel_created' | 'follow' | 'reel_like' | 'poll_created'

export async function recordActivity(
  userId: string,
  type: ActivityType,
  targetId?: string | null,
  targetMeta?: Record<string, unknown> | null,
): Promise<void> {
  if (!userId) return
  try {
    await supabase.from('activities').insert({
      user_id: userId,
      type,
      target_id: targetId ?? null,
      target_meta: (targetMeta ?? null) as never,
    } as never)
  } catch {
    /* feed is additive — never block the real action on it */
  }
}
