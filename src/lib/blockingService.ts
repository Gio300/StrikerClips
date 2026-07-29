/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * blockingService — the impure half of blocking.
 *
 * `src/lib/blocking.ts` holds the rules. This does the I/O against the `blocks`
 * table, plus the unfollow that the UI offers FIRST.
 *
 * PRIVACY. TABLE_POLICY marks `blocks` owner = blocker_id with select 'owner',
 * so a client can only ever read the blocks IT created. Nobody can discover who
 * blocked them — not by reading the table, not by watching a stage fail to
 * form. That means the client-side engine can only enforce the "I blocked them"
 * direction; the "they blocked me" direction is enforced server-side, where the
 * write actually lands:
 *
 *   reel_participants.insertCheck   refuses a cast row for a blocked pair
 *   live_group_members.insertCheck  refuses to add a member to a stage that
 *                                   already holds someone they can't share with
 *
 * so a block cannot be defeated by having the other person start the stage or
 * assemble the reel.
 */

import { supabase } from '@/lib/supabase'
import { clearFollowPrefs } from '@/lib/followPrefs'
import { normalizeBlocks, type BlockFact } from '@/lib/blocking'

/** Every block THIS user created. (The only ones they may read.) */
export async function loadMyBlocks(blockerId: string): Promise<BlockFact[]> {
  if (!blockerId) return []
  try {
    const { data } = await supabase.from('blocks').select('*').eq('blocker_id', blockerId)
    return normalizeBlocks((data ?? []) as never[])
  } catch {
    return []
  }
}

/** The block this user created against one person, or null. */
export async function loadMyBlockOf(
  blockerId: string,
  blockedId: string,
): Promise<BlockFact | null> {
  if (!blockerId || !blockedId) return null
  try {
    const { data } = await supabase
      .from('blocks')
      .select('*')
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId)
      .maybeSingle()
    if (!data) return null
    return normalizeBlocks([data as never])[0] ?? null
  } catch {
    return null
  }
}

/**
 * The SOFTER option, and the one the UI leads with. Unfollowing stops their
 * posts appearing without costing the user any clips — see BlockControl.
 */
export async function unfollowUser(followerId: string, targetId: string): Promise<boolean> {
  if (!followerId || !targetId) return false
  try {
    await supabase.from('follows').delete().eq('follower_id', followerId).eq('following_id', targetId)
    clearFollowPrefs(followerId, targetId)
    return true
  } catch {
    return false
  }
}

/**
 * Block someone.
 *
 * `hideInSharedLives` is the blocker's choice about REACH: false (the default)
 * means they may still end up on the same stage via a tournament or a third
 * party but are never auto-linked; true means they may not share a stage at
 * all. Either way the pair is dropped from each other's multi-angle clips.
 *
 * Blocking also unfollows in the blocker's direction — keeping a follow you've
 * blocked is never what anyone means.
 */
export async function blockUser(args: {
  blockerId: string
  blockedId: string
  hideInSharedLives?: boolean
}): Promise<boolean> {
  const { blockerId, blockedId } = args
  if (!blockerId || !blockedId || blockerId === blockedId) return false
  const hide = args.hideInSharedLives === true
  try {
    const existing = await loadMyBlockOf(blockerId, blockedId)
    if (existing) {
      await supabase
        .from('blocks')
        .update({ hide_in_shared_lives: hide } as any)
        .eq('blocker_id', blockerId)
        .eq('blocked_id', blockedId)
    } else {
      await supabase.from('blocks').insert({
        blocker_id: blockerId,
        blocked_id: blockedId,
        hide_in_shared_lives: hide,
      } as any)
    }
    await unfollowUser(blockerId, blockedId)
    return true
  } catch {
    return false
  }
}

/** Change how far an existing block reaches, without re-blocking. */
export async function setBlockScope(
  blockerId: string,
  blockedId: string,
  hideInSharedLives: boolean,
): Promise<boolean> {
  if (!blockerId || !blockedId) return false
  try {
    const { error } = await supabase
      .from('blocks')
      .update({ hide_in_shared_lives: hideInSharedLives } as any)
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId)
    return !error
  } catch {
    return false
  }
}

/** Lift a block. Does not restore the follow — that's the user's call. */
export async function unblockUser(blockerId: string, blockedId: string): Promise<boolean> {
  if (!blockerId || !blockedId) return false
  try {
    await supabase.from('blocks').delete().eq('blocker_id', blockerId).eq('blocked_id', blockedId)
    return true
  } catch {
    return false
  }
}
