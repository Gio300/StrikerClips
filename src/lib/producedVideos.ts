import { supabase } from '@/lib/supabase'
import { thumbUrl } from '@/lib/youtubeConnect'
import type { MatchVersionRow } from '@/types/database'

/** The subset of a clip_records row this module reads. */
export interface ClipRecordLite {
  composite_youtube_id: string | null
  youtube_id: string | null
  player_id: string | null
  player_handle: string | null
  map: string | null
  mode: string | null
  category: string | null
  match_id: string | null
  recorded_at: string | null
  created_at: string | null
}

/** One produced video, collapsed from all of its angle rows. */
export interface ProducedVideo {
  youtubeId: string
  title: string
  thumbnail: string
  watchUrl: string
  playerIds: string[]
  handles: string[]
  angleCount: number
  matchId: string | null
  createdAt: string | null
}

const t = (value: string | null | undefined): string => (value ?? '').trim()

export function watchUrlFor(id: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
}

export function producedVideoTitle(rec: { map?: string | null; mode?: string | null }): string {
  const parts = [rec.mode, rec.map].map((value) => t(value)).filter(Boolean)
  return parts.length ? `Multi-angle · ${parts.join(' · ')}` : 'Multi-angle match'
}

/** Collapse legacy per-angle records into one card per composite upload. */
export function dedupeProducedVideos(rows: ClipRecordLite[]): ProducedVideo[] {
  const byVideo = new Map<string, ProducedVideo & { _ts: number }>()
  for (const row of rows) {
    const youtubeId = t(row.composite_youtube_id)
    if (!youtubeId) continue
    const rawTs = new Date(row.recorded_at ?? row.created_at ?? 0).getTime()
    const ts = Number.isFinite(rawTs) ? rawTs : 0
    let video = byVideo.get(youtubeId)
    if (!video) {
      video = {
        youtubeId,
        title: producedVideoTitle(row),
        thumbnail: thumbUrl(youtubeId),
        watchUrl: watchUrlFor(youtubeId),
        playerIds: [],
        handles: [],
        angleCount: 0,
        matchId: row.match_id ?? null,
        createdAt: row.recorded_at ?? row.created_at ?? null,
        _ts: ts,
      }
      byVideo.set(youtubeId, video)
    }
    video.angleCount += 1
    const playerId = t(row.player_id)
    if (playerId && !video.playerIds.includes(playerId)) video.playerIds.push(playerId)
    const handle = t(row.player_handle)
    if (handle && !video.handles.includes(handle)) video.handles.push(handle)
    if (!video.matchId && row.match_id) video.matchId = row.match_id
    if (ts > video._ts) {
      video._ts = ts
      video.createdAt = row.recorded_at ?? row.created_at ?? video.createdAt
    }
  }
  return [...byVideo.values()]
    .sort((a, b) => b._ts - a._ts)
    .map(({ _ts: ignored, ...video }) => {
      void ignored
      return video
    })
}

/**
 * YouTube uploads are immutable. The app, however, presents one current
 * version per match. When another verified camera arrives, the higher version
 * replaces the older card instead of creating a duplicate.
 */
export function latestProducedVersions(rows: MatchVersionRow[]): ProducedVideo[] {
  const latest = new Map<string, MatchVersionRow>()
  for (const row of rows) {
    if (!t(row.youtube_id) || row.reason === 'superseded') continue
    const current = latest.get(row.match_key)
    if (!current || Number(row.version) > Number(current.version)) {
      latest.set(row.match_key, row)
    }
  }
  return [...latest.values()]
    .sort((a, b) => {
      const at = new Date(a.created_at ?? 0).getTime() || 0
      const bt = new Date(b.created_at ?? 0).getTime() || 0
      return bt - at
    })
    .map((row) => {
      const youtubeId = t(row.youtube_id)
      const angleCount = Math.max(2, Number(row.angle_count) || 2)
      return {
        youtubeId,
        title: `${angleCount}-camera synchronized match`,
        thumbnail: thumbUrl(youtubeId),
        watchUrl: watchUrlFor(youtubeId),
        playerIds: [...new Set(row.participant_ids ?? [])],
        handles: [],
        angleCount,
        matchId: row.match_key,
        createdAt: row.created_at,
      }
    })
}

const SELECT_COLS =
  'composite_youtube_id, youtube_id, player_id, player_handle, map, mode, category, match_id, recorded_at, created_at'

export async function recentProducedVideos(limit = 24): Promise<ProducedVideo[]> {
  const { data: versions } = await supabase
    .from('match_versions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.max(limit, 1) * 8)
  const canonical = latestProducedVersions((versions ?? []) as MatchVersionRow[])
  if (canonical.length) return canonical.slice(0, limit)

  // Legacy fallback until an older installation receives its first canonical
  // render. Never surface arbitrary uploads from the TKO YouTube channel.
  const { data } = await supabase
    .from('clip_records')
    .select(SELECT_COLS)
    .order('created_at', { ascending: false })
    .limit(Math.max(limit, 1) * 8)
  const rows = ((data ?? []) as ClipRecordLite[]).filter((row) => t(row.composite_youtube_id))
  return dedupeProducedVideos(rows).slice(0, limit)
}

export async function producedVideosForPlayer(
  playerId: string,
  limit = 24,
): Promise<ProducedVideo[]> {
  if (!playerId) return []

  const { data: versions } = await supabase
    .from('match_versions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.max(limit, 1) * 16)
  const canonical = latestProducedVersions(
    ((versions ?? []) as MatchVersionRow[]).filter((row) => row.participant_ids?.includes(playerId)),
  )
  if (canonical.length) return canonical.slice(0, limit)

  const { data: mine } = await supabase
    .from('clip_records')
    .select('composite_youtube_id, player_id')
    .eq('player_id', playerId)
  const ids = [
    ...new Set(
      ((mine ?? []) as { composite_youtube_id: string | null }[])
        .map((row) => t(row.composite_youtube_id))
        .filter(Boolean),
    ),
  ]
  if (ids.length === 0) return []
  const { data } = await supabase
    .from('clip_records')
    .select(SELECT_COLS)
    .in('composite_youtube_id', ids)
  const rows = ((data ?? []) as ClipRecordLite[]).filter((row) => t(row.composite_youtube_id))
  return dedupeProducedVideos(rows).slice(0, limit)
}
