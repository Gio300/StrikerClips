import { creatorApi } from '@/lib/creatorCommerceApi'
import {
  DEFAULT_REEL_USE_PRIVACY,
  normalizeReelUsePrivacy,
  type ReelUsePrivacy,
} from '@/lib/reelPrivacy'

export async function loadReelUsePrivacy(): Promise<ReelUsePrivacy> {
  const result = await creatorApi<{ value?: unknown }>('/privacy/reels')
  if (!result.ok) throw new Error(result.error || 'Could not load reel privacy.')
  return normalizeReelUsePrivacy(result.data?.value ?? DEFAULT_REEL_USE_PRIVACY)
}

export async function saveReelUsePrivacy(value: ReelUsePrivacy): Promise<ReelUsePrivacy> {
  const result = await creatorApi<{ value?: unknown }>('/privacy/reels', {
    method: 'POST',
    body: { value },
  })
  if (!result.ok) throw new Error(result.error || 'Could not save reel privacy.')
  return normalizeReelUsePrivacy(result.data?.value)
}
