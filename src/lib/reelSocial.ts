import { supabase } from '@/lib/supabase'

/**
 * reelSocial — the small read/write helpers the immersive player uses for the
 * social affordances on a reel.
 *
 * These map onto tables that already exist in the schema (see
 * `@/types/database`): `reel_likes` (id, reel_id, user_id, created_at) and
 * `reel_comments` (id, reel_id, user_id, content, created_at). We only ever
 * touch those existing tables — no new endpoints are invented here.
 *
 * Bookmark/Save has NO table today, so the player keeps it purely optimistic
 * and leaves a TODO where a `reel_bookmarks` table would slot in.
 */

export interface ReelLikeState {
  /** Total likes on the reel. */
  count: number
  /** Whether the signed-in viewer has already liked it. */
  liked: boolean
}

/** Read the like count for a reel, plus whether `userId` (if any) has liked it. */
export async function fetchLikeState(reelId: string, userId?: string | null): Promise<ReelLikeState> {
  if (!reelId) return { count: 0, liked: false }
  try {
    const [{ count }, mine] = await Promise.all([
      supabase.from('reel_likes').select('id', { count: 'exact', head: true }).eq('reel_id', reelId),
      userId
        ? supabase.from('reel_likes').select('id').eq('reel_id', reelId).eq('user_id', userId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    return { count: count ?? 0, liked: !!(mine as { data: unknown }).data }
  } catch {
    return { count: 0, liked: false }
  }
}

/**
 * Toggle a viewer's like on a reel. Returns the persisted `liked` state so the
 * caller can reconcile its optimistic update. Best-effort — a failure resolves
 * back to the previous value rather than throwing into the UI.
 */
export async function setReelLike(
  reelId: string,
  userId: string,
  liked: boolean,
): Promise<boolean> {
  if (!reelId || !userId) return !liked
  try {
    if (liked) {
      await supabase.from('reel_likes').insert({ reel_id: reelId, user_id: userId })
    } else {
      await supabase.from('reel_likes').delete().eq('reel_id', reelId).eq('user_id', userId)
    }
    return liked
  } catch {
    // Swallow: the caller already rolled the optimistic count; report the
    // pre-toggle state so it can revert.
    return !liked
  }
}

/** Live comment count for a reel (used for the rail badge before the drawer opens). */
export async function fetchCommentCount(reelId: string): Promise<number> {
  if (!reelId) return 0
  try {
    const { count } = await supabase
      .from('reel_comments')
      .select('id', { count: 'exact', head: true })
      .eq('reel_id', reelId)
    return count ?? 0
  } catch {
    return 0
  }
}
