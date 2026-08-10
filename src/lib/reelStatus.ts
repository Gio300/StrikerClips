import { isPlayableUrl } from './reelLayout'

export interface ReelStatusInput {
  combined_video_url?: string | null
  league_slug?: string | null
}

export type ReelStatus = 'saved' | 'playable' | 'produced'

/**
 * A saved layout marker is not a rendered video. Keep that distinction visible
 * so a user never mistakes "the reel row exists" for "the factory finished".
 */
export function reelStatus(reel: ReelStatusInput): ReelStatus {
  if (!isPlayableUrl(reel.combined_video_url)) return 'saved'
  return reel.league_slug ? 'produced' : 'playable'
}

export function reelBadgeLabel(reel: ReelStatusInput, justCreated = false): string {
  const status = reelStatus(reel)
  if (status === 'produced') return 'PRODUCED'
  if (status === 'playable') return 'PLAYABLE'
  return justCreated ? 'JUST SAVED' : 'SAVED'
}
