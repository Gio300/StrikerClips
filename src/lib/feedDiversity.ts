import { reelStatus, type ReelStatusInput } from './reelStatus'

export const REELS_PAGE_SIZE = 24
export const PRODUCED_WATCH_LIMIT = 48
export const REELS_DIVERSITY_SCAN_FACTOR = 3

export function reelsFetchWindow(displayLimit: number): number {
  return Math.max(REELS_PAGE_SIZE, Math.floor(displayLimit) * REELS_DIVERSITY_SCAN_FACTOR)
}

export function takeFeedPage<T>(items: readonly T[], limit = REELS_PAGE_SIZE): {
  items: T[]
  hasMore: boolean
} {
  const size = Math.max(1, Math.floor(limit))
  return { items: items.slice(0, size), hasMore: items.length > size }
}

/**
 * Stable round-robin over creator buckets. The newest item for every creator
 * appears before any creator's second item, while order inside each creator's
 * own bucket remains chronological.
 */
export function interleaveCreators<T>(
  items: readonly T[],
  creatorKey: (item: T) => string | null | undefined,
): T[] {
  const order: string[] = []
  const buckets = new Map<string, T[]>()
  items.forEach((item, index) => {
    const key = String(creatorKey(item) ?? '').trim() || `__unattributed_${index}`
    if (!buckets.has(key)) {
      buckets.set(key, [])
      order.push(key)
    }
    buckets.get(key)!.push(item)
  })

  const out: T[] = []
  for (let round = 0; out.length < items.length; round += 1) {
    for (const key of order) {
      const item = buckets.get(key)?.[round]
      if (item !== undefined) out.push(item)
    }
  }
  return out
}

/** Search results stay chronological; only the ordinary discovery feed mixes creators. */
export function orderCreatorFeed<T>(
  items: readonly T[],
  creatorKey: (item: T) => string | null | undefined,
  searchQuery = '',
): T[] {
  return searchQuery.trim() ? [...items] : interleaveCreators(items, creatorKey)
}

export interface ReelFeedMetaInput extends ReelStatusInput {
  clip_ids?: readonly string[] | null
}

/** Never describe an externally playable factory reel as having “0 clips.” */
export function reelFeedMediaLabel(reel: ReelFeedMetaInput): string {
  const status = reelStatus(reel)
  if (status === 'produced') return 'Produced video'
  if (status === 'playable') return 'Playable video'
  const count = reel.clip_ids?.length ?? 0
  if (count > 0) return `${count} clip${count === 1 ? '' : 's'}`
  return 'Saved reel'
}

export interface ProducedCreatorInput {
  youtubeId: string
  participants?: readonly { id?: string | null }[]
  handles?: readonly string[]
}

/** Best stable owner/player identity available on one produced-video record. */
export function producedVideoCreatorKey(video: ProducedCreatorInput): string {
  return String(video.participants?.[0]?.id || video.handles?.[0] || video.youtubeId)
}
