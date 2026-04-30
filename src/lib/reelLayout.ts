// Layout (and friend-invite) encoding for reels.
//
// Background: migration 009 adds dedicated columns for `reels.layout` and
// invite slots. Until that migration is applied, we encode this state into
// the existing `combined_video_url` column using a fake URI scheme:
//
//   reelone-layout://<layout>            (new — use this in new writes)
//   clutchlens-layout://<layout>         (legacy — still decoded for old rows)
//   shinobi-layout://<layout>            (legacy — still decoded for old rows)
//   ?slots=N = locked until N total clips
//
// `slots` is the TOTAL clip count required before the reel unlocks. The
// counting includes:
//   - clips officially attached via reel.clip_ids[]
//   - clips with title `[for:<reelId>]` submitted by invited friends
//
// Decode order on read:
//   1. If `reel.layout` is set (column exists post-009)  -> use it
//   2. If `combined_video_url` is any `*-layout://` scheme we recognise -> parse
//   3. Otherwise -> 'concat' (default)
//
// Encode rules on write:
//   - Uploads (any layout): `combined_video_url` = actual rendered MP4 URL.
//     The MP4 already bakes in the layout, so we don't need to record it.
//   - YouTube + concat + no invites: `combined_video_url` = null.
//   - YouTube + non-concat OR pending invites: `combined_video_url` =
//     `reelone-layout://<layout>?slots=<N>` (legacy schemes still read).
//
// This keeps the feature working before and after migration 009, and across
// the ClutchLens → ReelOne brand swap.

import type { ReelLayout } from '@/types/database'

const SCHEME = 'reelone-layout://'
const LEGACY_SCHEMES = ['clutchlens-layout://', 'shinobi-layout://']

function markerBody(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  if (value.startsWith(SCHEME)) return value.slice(SCHEME.length)
  for (const legacy of LEGACY_SCHEMES) {
    if (value.startsWith(legacy)) return value.slice(legacy.length)
  }
  return null
}

const VALID_LAYOUTS: ReelLayout[] = ['concat', 'grid', 'side-by-side', 'pip', 'action', 'ultra']

const INVITE_TITLE_PREFIX = '[for:'
const INVITE_TITLE_SUFFIX = ']'

export type LayoutMarkerData = {
  layout: ReelLayout
  slots?: number // total expected clips before the reel unlocks
}

export function isLayoutMarker(value: string | null | undefined): boolean {
  return markerBody(value) != null
}

export function isPlayableUrl(value: string | null | undefined): boolean {
  if (!value) return false
  if (isLayoutMarker(value)) return false
  return /^https?:\/\//i.test(value)
}

export function encodeLayoutMarker(layout: ReelLayout, opts?: { slots?: number }): string {
  const params: string[] = []
  if (opts?.slots && opts.slots > 0) params.push(`slots=${Math.floor(opts.slots)}`)
  const query = params.length > 0 ? `?${params.join('&')}` : ''
  return `${SCHEME}${layout}${query}`
}

export function decodeLayoutMarker(value: string | null | undefined): LayoutMarkerData | null {
  const body = markerBody(value)
  if (!body) return null
  const [layoutRaw, queryRaw] = body.split('?')
  const layoutLower = layoutRaw.toLowerCase()
  if (!(VALID_LAYOUTS as string[]).includes(layoutLower)) return null
  const data: LayoutMarkerData = { layout: layoutLower as ReelLayout }
  if (queryRaw) {
    for (const piece of queryRaw.split('&')) {
      const [k, v] = piece.split('=')
      if (k === 'slots') {
        const n = Number(v)
        if (Number.isFinite(n) && n > 0) data.slots = Math.floor(n)
      }
    }
  }
  return data
}

// Pull the layout for a reel record, regardless of whether 009 has been applied.
export function resolveLayout(reel: { layout?: ReelLayout | null; combined_video_url?: string | null }): ReelLayout {
  if (reel.layout && (VALID_LAYOUTS as string[]).includes(reel.layout)) return reel.layout
  const fromMarker = decodeLayoutMarker(reel.combined_video_url ?? null)
  if (fromMarker) return fromMarker.layout
  return 'concat'
}

// Pull the requested slot count (if any) for a reel.
export function resolveSlots(reel: { combined_video_url?: string | null }): number | null {
  const fromMarker = decodeLayoutMarker(reel.combined_video_url ?? null)
  return fromMarker?.slots ?? null
}

/**
 * Friend-submitted clips are tagged with `[for:<reelId>]` in their title so
 * we can virtually attach them to a reel without needing an UPDATE on the
 * reel row itself (which RLS would block for non-owners).
 */
export function buildInviteTitle(reelId: string, friendlyTitle?: string): string {
  const tag = `${INVITE_TITLE_PREFIX}${reelId}${INVITE_TITLE_SUFFIX}`
  if (!friendlyTitle) return tag
  return `${tag} ${friendlyTitle}`
}

export function isInviteTitleFor(title: string | null | undefined, reelId: string): boolean {
  if (!title) return false
  return title.startsWith(`${INVITE_TITLE_PREFIX}${reelId}${INVITE_TITLE_SUFFIX}`)
}

export function inviteSearchPattern(reelId: string): string {
  return `${INVITE_TITLE_PREFIX}${reelId}${INVITE_TITLE_SUFFIX}%`
}
