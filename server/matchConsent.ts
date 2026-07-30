/* eslint-disable @typescript-eslint/no-explicit-any */

type Pool = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }

export class MatchConsentError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message)
  }
}

export interface RemoveMatchAngleResult {
  removed: true
  matchId: string
  remainingAngles: number
  rerenderQueued: boolean
  oldUploadPreserved: true
}

/**
 * Remove the caller's camera from the CURRENT recorded-match version.
 *
 * Previously uploaded YouTube versions are intentionally never deleted. When
 * at least two cameras remain, the canonical job is queued again with the
 * reduced roster; otherwise the current composite is retired. Live matches are
 * immutable because their frames have already been broadcast.
 */
export async function removeRecordedMatchAngle(
  pool: Pool,
  userId: string,
  matchId: string,
  reason = 'player requested removal',
): Promise<RemoveMatchAngleResult> {
  const live = await pool.query(
    `select id from live_sessions where match_id=$1 and status='live' limit 1`,
    [matchId],
  )
  if (live.rows.length) {
    throw new MatchConsentError(
      'This game is live. Change your future auto-merge setting instead; a live broadcast cannot be edited.',
      409,
    )
  }

  const jobs = await pool.query(
    `select id,status,clip_ids,participant_ids,youtube_id
       from render_jobs where match_id=$1 limit 1`,
    [matchId],
  )
  const job = jobs.rows[0]
  if (!job) throw new MatchConsentError('Recorded match not found', 404)

  let angles = await pool.query(
    `select id,clip_record_id,status
       from match_angles where match_key=$1 and user_id=$2 limit 1`,
    [matchId, userId],
  )

  // Backfill consent state for matches created before match_angles was wired.
  if (!angles.rows[0]) {
    const legacy = await pool.query(
      `select id,youtube_id from clip_records
        where match_id=$1 and player_id=$2
        order by created_at desc limit 1`,
      [matchId, userId],
    )
    const clip = legacy.rows[0]
    if (!clip || !(job.participant_ids ?? []).map(String).includes(userId)) {
      throw new MatchConsentError('You are not tagged in this recorded match', 403)
    }
    await pool.query(
      `insert into match_angles
         (match_key,user_id,youtube_video_id,clip_record_id,status)
       values ($1,$2,$3,$4,'active')`,
      [matchId, userId, String(clip.youtube_id || clip.id), clip.id],
    )
    angles = await pool.query(
      `select id,clip_record_id,status
         from match_angles where match_key=$1 and user_id=$2 limit 1`,
      [matchId, userId],
    )
  }

  const angle = angles.rows[0]
  if (String(angle.status) === 'removed') {
    throw new MatchConsentError('Your camera is already removed from the current version', 409)
  }

  const owned = await pool.query(
    `select id from clip_records where match_id=$1 and player_id=$2`,
    [matchId, userId],
  )
  const ownedIds = new Set(owned.rows.map((row) => String(row.id)))
  const remainingClipIds = (job.clip_ids ?? []).map(String).filter((id: string) => !ownedIds.has(id))
  const remainingParticipantIds = (job.participant_ids ?? [])
    .map(String)
    .filter((id: string) => id !== userId)

  // Backfill the immutable version ledger for a game completed before this
  // feature shipped. Its public upload stays available after the current
  // version is rebuilt.
  if (job.youtube_id) {
    const known = await pool.query(
      `select 1 from match_versions where match_key=$1 and youtube_id=$2 limit 1`,
      [matchId, job.youtube_id],
    )
    if (!known.rows.length) {
      const next = await pool.query(
        `select coalesce(max(version),0)::int + 1 as version
           from match_versions where match_key=$1`,
        [matchId],
      )
      await pool.query(
        `insert into match_versions
           (match_key,version,youtube_id,angle_count,participant_ids,clip_ids,reason)
         values ($1,$2,$3,$4,$5,$6,'legacy')`,
        [
          matchId,
          Number(next.rows[0]?.version ?? 1),
          job.youtube_id,
          (job.participant_ids ?? []).length,
          job.participant_ids ?? [],
          job.clip_ids ?? [],
        ],
      )
    }
  }

  await pool.query(
    `update match_angles
        set status='removed', removed_at=now(), removal_reason=$1
      where id=$2`,
    [String(reason).slice(0, 240), angle.id],
  )

  // The immutable historical upload remains in match_versions. Remove its id
  // only from the CURRENT catalogue rows while a reduced version is assembled.
  for (const clipId of (job.clip_ids ?? []).map(String)) {
    await pool.query(
      `update clip_records set composite_youtube_id=null where id=$1`,
      [clipId],
    )
  }

  const activeRender = job.status === 'rendering' || job.status === 'uploading'
  const rerenderQueued = remainingParticipantIds.length >= 2
  if (activeRender) {
    await pool.query(
      `update render_jobs
          set clip_ids=$1, participant_ids=$2, ready_at=now(),
              rerender_requested=true, updated_at=now()
        where id=$3`,
      [remainingClipIds, remainingParticipantIds, job.id],
    )
  } else if (rerenderQueued) {
    await pool.query(
      `update render_jobs
          set status='pending', clip_ids=$1, participant_ids=$2, ready_at=now(),
              rerender_requested=false, youtube_id=null, combined_video_url=null,
              error=null, attempts=0, updated_at=now()
        where id=$3`,
      [remainingClipIds, remainingParticipantIds, job.id],
    )
  } else {
    await pool.query(
      `update render_jobs
          set status='done', clip_ids=$1, participant_ids=$2,
              rerender_requested=false, youtube_id=null, combined_video_url=null,
              error=null, updated_at=now()
        where id=$3`,
      [remainingClipIds, remainingParticipantIds, job.id],
    )
  }

  await pool.query(
    `insert into notifications (user_id,kind,title,body,link,related_id)
     values ($1,'match_angle_removed',$2,$3,$4,$5)`,
    [
      userId,
      'Your camera was removed',
      rerenderQueued
        ? 'TKO is rebuilding the current recorded game without your camera. The earlier public upload remains in version history.'
        : 'Your camera is no longer part of the current TKO game. The earlier public upload remains in version history.',
      `/matches/${matchId}`,
      matchId,
    ],
  )

  return {
    removed: true,
    matchId,
    remainingAngles: remainingParticipantIds.length,
    rerenderQueued,
    oldUploadPreserved: true,
  }
}
