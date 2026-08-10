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
//   ?intro=&outro=&banner=&music=&league= = league template kit picks
//     (see ReelKitPicks below — read later by the Loras render factory)
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
//   - YouTube + concat + no invites + no kit picks: `combined_video_url` = null.
//   - YouTube + non-concat OR pending invites OR league-kit picks:
//     `combined_video_url` = `reelone-layout://<layout>?slots=<N>&intro=...`
//     (legacy schemes still read). A bare-concat marker decodes identically
//     to null for every reader (resolveLayout → 'concat', not playable).
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

/**
 * The member's league TEMPLATE KIT picks for a reel — which intro/outro/banner
 * style and music track from their league's asset manifest (see
 * src/lib/leagueAssets.ts) the render should use instead of the factory's
 * default rotation.
 *
 * PERSISTENCE: rides in the same `combined_video_url` marker as `layout` and
 * `slots` (no schema change), e.g.
 *   reelone-layout://concat?intro=vs-01&outro=king-02&banner=fire&music=...&league=tko
 *
 * FACTORY CONSUMPTION (Loras repo): when the render factory
 * (Loras/common/tko_factory.py -> tko_vertical.py) picks this reel up, it
 * should decode these params from the reel row's combined_video_url and map:
 *   intro/outro/banner id -> the file in assets/brand/ (or the league's
 *     override in assets/leagues/<slug>/) per the id->file table in
 *     src/lib/leagueAssets.ts, instead of the variant rotation;
 *   music -> the file in its music_dir, instead of a random song pick;
 *   league -> the --league <slug> skin argument.
 */
export type ReelKitPicks = {
  intro?: string // LeagueAssetOption id, e.g. 'vs-01'
  outro?: string // e.g. 'king-01' | 'king-02'
  banner?: string // e.g. 'fire' | 'smoke' | 'dark'
  music?: string // track FILE name, e.g. 'suno_shinobi_striker_league.mp3'
  league?: string // league slug the kit came from, e.g. 'shinobistrikerleague'
}

const KIT_KEYS = ['intro', 'outro', 'banner', 'music', 'league'] as const

export type LayoutMarkerData = {
  layout: ReelLayout
  slots?: number // total expected clips before the reel unlocks
  kit?: ReelKitPicks // league template picks (intro/outro/banner/music)
}

export function isLayoutMarker(value: string | null | undefined): boolean {
  return markerBody(value) != null
}

export function isPlayableUrl(value: string | null | undefined): boolean {
  if (!value) return false
  if (isLayoutMarker(value)) return false
  return /^https?:\/\//i.test(value)
}

export function encodeLayoutMarker(
  layout: ReelLayout,
  opts?: { slots?: number; kit?: ReelKitPicks },
): string {
  const params: string[] = []
  if (opts?.slots && opts.slots > 0) params.push(`slots=${Math.floor(opts.slots)}`)
  for (const key of KIT_KEYS) {
    const value = opts?.kit?.[key]
    if (typeof value === 'string' && value.trim()) {
      params.push(`${key}=${encodeURIComponent(value.trim())}`)
    }
  }
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
      } else if ((KIT_KEYS as readonly string[]).includes(k) && v) {
        let decoded = ''
        try { decoded = decodeURIComponent(v) } catch { decoded = v }
        if (decoded.trim()) {
          data.kit = { ...data.kit, [k]: decoded.trim() }
        }
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

// Pull the league template kit picks (if any) for a reel. This is what the
// Loras render factory reads to brand the render (see ReelKitPicks above).
export function resolveKit(reel: { combined_video_url?: string | null }): ReelKitPicks | null {
  const fromMarker = decodeLayoutMarker(reel.combined_video_url ?? null)
  return fromMarker?.kit ?? null
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
