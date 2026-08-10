import type { Reel } from '@/types/database'

export interface ReelAuthorProfile {
  username?: string | null
  power_level?: number | null
}

export type ReelWithAuthor = Reel & {
  profiles?: ReelAuthorProfile | ReelAuthorProfile[] | null
}

export function reelAuthorProfile(reel: ReelWithAuthor): ReelAuthorProfile | null {
  const raw = Array.isArray(reel.profiles) ? reel.profiles[0] : reel.profiles
  if (!raw || typeof raw !== 'object') return null
  return raw
}

export function reelAuthorName(reel: ReelWithAuthor): string {
  return reelAuthorProfile(reel)?.username?.trim() || 'Anonymous shinobi'
}

/**
 * Embedded profile joins are absent in the Express and mock adapters. Resolve
 * the reel's explicit user_id before allowing the detail page to use a fallback
 * label, so a known player never becomes “@Unknown.”
 */
export async function ensureReelAuthor(
  reel: ReelWithAuthor,
  loadProfile: (userId: string) => Promise<ReelAuthorProfile | null>,
): Promise<ReelWithAuthor> {
  const joined = reelAuthorProfile(reel)
  if (joined?.username?.trim() || !reel.user_id) return reel
  try {
    const fallback = await loadProfile(reel.user_id)
    return fallback ? { ...reel, profiles: fallback } : reel
  } catch {
    return reel
  }
}
