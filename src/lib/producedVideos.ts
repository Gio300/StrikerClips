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

/**
 * ONE player in a produced video, id and label kept TOGETHER.
 *
 * They used to travel as two parallel arrays (`playerIds` + `handles`), which
 * only lines up while every single player has a handle: the arrays are built by
 * separate de-duplications, so one player missing a handle shifts every later
 * label onto the wrong profile link. Pairs make that class of bug unreachable.
 */
export interface ProducedParticipant {
  /** TKO user id — the profile the chip links to. */
  id: string
  /** Gamertag to show. Null when nothing was recorded for this player. */
  handle: string | null
}

/** One produced video, collapsed from all of its angle rows. */
export interface ProducedVideo {
  youtubeId: string
  title: string
  thumbnail: string
  watchUrl: string
  /** The players in the video, id + label paired. Prefer this over the two
   *  flat arrays below, which are kept for existing call sites. */
  participants: ProducedParticipant[]
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

/** The app route that plays ONE produced video — the per-video share target. */
export function producedVideoRoute(youtubeId: string): string {
  return `/produced/${encodeURIComponent(t(youtubeId))}`
}

/** Title used when a video carries no map/mode metadata at all. */
export const GENERIC_PRODUCED_TITLE = 'Multi-angle match'

export function producedVideoTitle(rec: { map?: string | null; mode?: string | null }): string {
  const parts = [rec.mode, rec.map].map((value) => t(value)).filter(Boolean)
  return parts.length ? `Multi-angle · ${parts.join(' · ')}` : GENERIC_PRODUCED_TITLE
}

/** Flat mirrors of `participants`, kept in sync wherever a video is built. */
function withFlatParticipants<T extends { participants: ProducedParticipant[] }>(video: T): T {
  return Object.assign(video, {
    playerIds: video.participants.map((p) => p.id),
    handles: video.participants.map((p) => p.handle).filter((h): h is string => !!h),
  })
}

/** Union two participant lists, keeping the first non-empty handle per player. */
export function mergeParticipants(
  a: ProducedParticipant[],
  b: ProducedParticipant[],
): ProducedParticipant[] {
  const out: ProducedParticipant[] = []
  const index = new Map<string, number>()
  for (const p of [...a, ...b]) {
    const id = t(p.id)
    if (!id) continue
    const at = index.get(id)
    if (at === undefined) {
      index.set(id, out.length)
      out.push({ id, handle: t(p.handle) || null })
    } else if (!out[at].handle && t(p.handle)) {
      out[at].handle = t(p.handle)
    }
  }
  return out
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
        participants: [],
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
    // Pair id + handle so a player whose handle was never recorded can only
    // ever be MISSING a label, never given somebody else's.
    video.participants = mergeParticipants(video.participants, [
      { id: t(row.player_id), handle: t(row.player_handle) || null },
    ])
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
      return withFlatParticipants(video)
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
      // The version row already stores the handle the pipeline sent for each
      // angle — key it by user id so a participant gets its OWN label.
      const handleFor = new Map<string, string>()
      for (const angle of row.source_angles ?? []) {
        const id = t(angle?.user_id)
        const handle = t(angle?.handle)
        if (id && handle && !handleFor.has(id)) handleFor.set(id, handle)
      }
      return withFlatParticipants({
        youtubeId,
        title: `${angleCount}-camera synchronized match`,
        thumbnail: thumbUrl(youtubeId),
        watchUrl: watchUrlFor(youtubeId),
        participants: mergeParticipants(
          (row.participant_ids ?? []).map((id) => ({ id, handle: handleFor.get(t(id)) ?? null })),
          [],
        ),
        playerIds: [],
        handles: [],
        angleCount,
        matchId: row.match_key,
        createdAt: row.created_at,
      })
    })
}

const producedAt = (video: ProducedVideo): number => {
  const parsed = new Date(video.createdAt ?? 0).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Combine canonical match versions with legacy clip records without allowing a
 * stale canonical table to hide newer completed renders. The newest upload wins
 * when both sources identify the same match, and a YouTube upload is shown only
 * once even when both tables reference it.
 */
export function mergeProducedVideoSources(
  canonical: ProducedVideo[],
  legacy: ProducedVideo[],
): ProducedVideo[] {
  const merged = [...canonical, ...legacy].sort((a, b) => producedAt(b) - producedAt(a))
  const seenYoutubeIds = new Set<string>()
  const seenMatchIds = new Set<string>()

  return merged.filter((video) => {
    const youtubeId = t(video.youtubeId)
    const matchId = t(video.matchId)
    if (!youtubeId || seenYoutubeIds.has(youtubeId)) return false
    if (matchId && seenMatchIds.has(matchId)) return false

    seenYoutubeIds.add(youtubeId)
    if (matchId) seenMatchIds.add(matchId)
    return true
  })
}

/**
 * Fold the SAME upload seen through both tables into one video, keeping what
 * each source knows best: `match_versions` is authoritative for angle count and
 * match key, the clip records carry the map/mode title, and either may hold the
 * handle for a given player. Used by the single-video reader, where the two
 * sources must UNION rather than one hiding the other (which is what
 * mergeProducedVideoSources deliberately does for feeds).
 */
export function combineProducedVideo(
  canonical: ProducedVideo | null | undefined,
  legacy: ProducedVideo | null | undefined,
): ProducedVideo | null {
  if (!canonical) return legacy ?? null
  if (!legacy) return canonical
  const participants = mergeParticipants(canonical.participants, legacy.participants)
  return withFlatParticipants({
    ...canonical,
    // The clip records know the map/mode; the version row only ever counts cameras.
    title: legacy.title === GENERIC_PRODUCED_TITLE ? canonical.title : legacy.title,
    participants,
    playerIds: [],
    handles: [],
    angleCount: Math.max(canonical.angleCount, legacy.angleCount),
    matchId: canonical.matchId ?? legacy.matchId,
    createdAt: canonical.createdAt ?? legacy.createdAt,
  })
}

const SELECT_COLS =
  'composite_youtube_id, youtube_id, player_id, player_handle, map, mode, category, match_id, recorded_at, created_at'

/**
 * Fill in any participant whose handle was never recorded with their TKO
 * username, so a chip shows a real gamertag instead of the word "player".
 *
 * Every produced row written before the pipeline's handle was persisted (see
 * server/creditProduced.ts) has a null player_handle, and those videos are not
 * re-credited — this read-side fallback is what makes them legible without a
 * backfill. One batched profiles read per fetch; fails soft to the ids alone.
 */
export async function hydrateParticipantHandles(videos: ProducedVideo[]): Promise<ProducedVideo[]> {
  const missing = [
    ...new Set(
      videos.flatMap((v) => v.participants.filter((p) => !p.handle).map((p) => p.id)).filter(Boolean),
    ),
  ]
  if (!missing.length) return videos
  let names = new Map<string, string>()
  try {
    const { data } = await supabase.from('profiles').select('id, username').in('id', missing)
    names = new Map(
      ((data ?? []) as { id: string; username: string | null }[])
        .filter((row) => t(row.username))
        .map((row) => [String(row.id), t(row.username)]),
    )
  } catch {
    return videos
  }
  if (!names.size) return videos
  return videos.map((video) =>
    withFlatParticipants({
      ...video,
      participants: video.participants.map((p) =>
        p.handle ? p : { ...p, handle: names.get(p.id) ?? null },
      ),
      playerIds: [],
      handles: [],
    }),
  )
}

/**
 * ONE produced video by its composite YouTube id — what the public
 * `/produced/:youtubeId` page reads. Both source tables are PUBLIC-select (see
 * TABLE POLICY in server/app.ts), so this resolves for a SIGNED-OUT visitor
 * landing on a shared link.
 */
export async function producedVideoById(youtubeId: string): Promise<ProducedVideo | null> {
  const id = t(youtubeId)
  if (!id) return null

  const { data: versions } = await supabase.from('match_versions').select('*').eq('youtube_id', id)
  const canonical = latestProducedVersions((versions ?? []) as MatchVersionRow[])[0] ?? null

  const { data } = await supabase.from('clip_records').select(SELECT_COLS).eq('composite_youtube_id', id)
  const rows = ((data ?? []) as ClipRecordLite[]).filter((row) => t(row.composite_youtube_id) === id)
  const legacy = dedupeProducedVideos(rows)[0] ?? null

  const video = combineProducedVideo(canonical, legacy)
  if (!video) return null
  return (await hydrateParticipantHandles([video]))[0] ?? video
}

export async function recentProducedVideos(limit = 24): Promise<ProducedVideo[]> {
  const { data: versions } = await supabase
    .from('match_versions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.max(limit, 1) * 8)
  const canonical = latestProducedVersions((versions ?? []) as MatchVersionRow[])

  // Keep reading legacy rows while older pipeline/server revisions are still
  // being drained. Only produced composite ids are eligible, never arbitrary
  // uploads from a user's YouTube channel.
  const { data } = await supabase
    .from('clip_records')
    .select(SELECT_COLS)
    .order('created_at', { ascending: false })
    .limit(Math.max(limit, 1) * 8)
  const rows = ((data ?? []) as ClipRecordLite[]).filter((row) => t(row.composite_youtube_id))
  return hydrateParticipantHandles(
    mergeProducedVideoSources(canonical, dedupeProducedVideos(rows)).slice(0, limit),
  )
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
  const { data } = ids.length
    ? await supabase
        .from('clip_records')
        .select(SELECT_COLS)
        .in('composite_youtube_id', ids)
    : { data: [] }
  const rows = ((data ?? []) as ClipRecordLite[]).filter((row) => t(row.composite_youtube_id))
  return hydrateParticipantHandles(
    mergeProducedVideoSources(canonical, dedupeProducedVideos(rows)).slice(0, limit),
  )
}
