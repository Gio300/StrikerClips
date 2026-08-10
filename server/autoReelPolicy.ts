/* eslint-disable @typescript-eslint/no-explicit-any */

export type AutoReelTier = '' | 'ad_free' | 'pro' | 'supporter' | 'creator'
export type AutoReelProfile =
  | 'manual_only'
  | 'quick_vertical'
  | 'enhanced_vertical'
  | 'coach_dee_full'

export type AutoReelPolicy = {
  tier: AutoReelTier
  profile: AutoReelProfile
  automatic: boolean
  orientation: 'vertical' | 'landscape'
  width: number
  height: number
  maxDurationSeconds: number | null
  preRollSeconds: number
  maxAngles: number
  reactionCount: number
  commentary: 'none' | 'hype' | 'enhanced' | 'coach_dee'
}

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>
}

const TIER_RANK: Record<AutoReelTier, number> = {
  '': 0,
  ad_free: 0,
  pro: 1,
  supporter: 2,
  creator: 3,
}

const POLICIES: Record<AutoReelTier, AutoReelPolicy> = {
  '': {
    tier: '',
    profile: 'manual_only',
    automatic: false,
    orientation: 'vertical',
    width: 1080,
    height: 1920,
    maxDurationSeconds: null,
    preRollSeconds: 0,
    maxAngles: 1,
    reactionCount: 0,
    commentary: 'none',
  },
  ad_free: {
    tier: 'ad_free',
    profile: 'manual_only',
    automatic: false,
    orientation: 'vertical',
    width: 1080,
    height: 1920,
    maxDurationSeconds: null,
    preRollSeconds: 0,
    maxAngles: 1,
    reactionCount: 0,
    commentary: 'none',
  },
  pro: {
    tier: 'pro',
    profile: 'quick_vertical',
    automatic: true,
    orientation: 'vertical',
    width: 1080,
    height: 1920,
    maxDurationSeconds: 24,
    preRollSeconds: 8,
    maxAngles: 1,
    reactionCount: 1,
    commentary: 'hype',
  },
  supporter: {
    tier: 'supporter',
    profile: 'enhanced_vertical',
    automatic: true,
    orientation: 'vertical',
    width: 1080,
    height: 1920,
    maxDurationSeconds: 42,
    preRollSeconds: 12,
    maxAngles: 2,
    reactionCount: 2,
    commentary: 'enhanced',
  },
  creator: {
    tier: 'creator',
    profile: 'coach_dee_full',
    automatic: true,
    orientation: 'landscape',
    width: 1920,
    height: 1080,
    maxDurationSeconds: null,
    preRollSeconds: 0,
    maxAngles: 4,
    reactionCount: 3,
    commentary: 'coach_dee',
  },
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function activeAutoReelTier(metadata: unknown, now = Date.now()): AutoReelTier {
  const meta = parseMetadata(metadata)
  const rawTier = typeof meta.reelone_tier === 'string'
    ? meta.reelone_tier
    : (typeof meta.clutchlens_tier === 'string' ? meta.clutchlens_tier : '')
  const tier = rawTier in POLICIES ? rawTier as AutoReelTier : ''
  const expiresRaw = typeof meta.reelone_tier_expires === 'string'
    ? meta.reelone_tier_expires
    : ''
  const expiresAt = expiresRaw ? Date.parse(expiresRaw) : Number.NaN
  return Number.isFinite(expiresAt) && expiresAt < now ? '' : tier
}

export function autoReelPolicyForTier(tier: string | null | undefined): AutoReelPolicy {
  const resolved = tier && tier in POLICIES ? tier as AutoReelTier : ''
  return { ...POLICIES[resolved] }
}

/**
 * A produced match has one shared public video, so the best active membership
 * in that match controls its cut. This prevents a Legend member from being
 * downgraded because a teammate is on Pro while never granting automation to a
 * match whose entire roster is Free or Ad-Free.
 */
export function autoReelPolicyForParticipants(
  metadata: unknown[],
  now = Date.now(),
): AutoReelPolicy {
  const tier = metadata
    .map((value) => activeAutoReelTier(value, now))
    .sort((a, b) => TIER_RANK[b] - TIER_RANK[a])[0] ?? ''
  return autoReelPolicyForTier(tier)
}

export async function resolveAutoReelPolicy(
  db: Queryable,
  participantIds: string[],
  now = Date.now(),
): Promise<AutoReelPolicy> {
  if (participantIds.length === 0) return autoReelPolicyForTier('')
  const result = await db.query(
    'select user_metadata from users where id = any($1::uuid[])',
    [participantIds],
  )
  return autoReelPolicyForParticipants(
    result.rows.map((row) => row.user_metadata),
    now,
  )
}
