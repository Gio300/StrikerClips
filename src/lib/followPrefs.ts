/**
 * Granular follow notification preferences.
 *
 * The mock/limited backend has no place to store *what* a follower wants to be
 * notified about for a given creator, so we persist those toggles in
 * localStorage, keyed per (follower, target) pair:
 *
 *   kc_followprefs:<followerId>:<targetId>  ->  FollowPrefs (JSON)
 *
 * Defaults to all-on when a follow is created. When a real backend grows a
 * `follow_prefs` table, swap the get/set bodies to hit it — the call sites
 * won't change.
 */

export interface FollowPrefs {
  tournaments: boolean
  live: boolean
  clips: boolean
  posts: boolean
}

export const DEFAULT_FOLLOW_PREFS: FollowPrefs = {
  tournaments: true,
  live: true,
  clips: true,
  posts: true,
}

function keyFor(followerId: string, targetId: string): string {
  return `kc_followprefs:${followerId}:${targetId}`
}

/** Read stored prefs for a (follower, target) pair, falling back to all-on. */
export function getFollowPrefs(followerId: string, targetId: string): FollowPrefs {
  if (!followerId || !targetId) return { ...DEFAULT_FOLLOW_PREFS }
  try {
    const raw = localStorage.getItem(keyFor(followerId, targetId))
    if (!raw) return { ...DEFAULT_FOLLOW_PREFS }
    const parsed = JSON.parse(raw) as Partial<FollowPrefs>
    return { ...DEFAULT_FOLLOW_PREFS, ...parsed }
  } catch {
    return { ...DEFAULT_FOLLOW_PREFS }
  }
}

/** Persist prefs for a (follower, target) pair. */
export function setFollowPrefs(
  followerId: string,
  targetId: string,
  prefs: FollowPrefs,
): void {
  if (!followerId || !targetId) return
  try {
    localStorage.setItem(keyFor(followerId, targetId), JSON.stringify(prefs))
  } catch {
    /* localStorage unavailable (private mode / quota) — non-fatal */
  }
}

/** Remove stored prefs — call on unfollow so a re-follow starts fresh (all-on). */
export function clearFollowPrefs(followerId: string, targetId: string): void {
  if (!followerId || !targetId) return
  try {
    localStorage.removeItem(keyFor(followerId, targetId))
  } catch {
    /* noop */
  }
}
