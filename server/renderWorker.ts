/* eslint-disable @typescript-eslint/no-explicit-any */
import { recomputePower } from './power'
// ===========================================================================
// RENDER WORKER — the muscle behind auto-match.
//
// runAutoMatch (server/autoMatch.ts) leaves a `render_jobs` row in 'pending'.
// This worker claims one at a time, assembles the multi-angle video from the
// bunch's source clips, uploads it to YouTube, writes the link back onto the
// match + clips, marks the job 'done', and notifies every participant that
// their video is live.
//
// The QUEUE MECHANICS here (atomic claim, complete, fail, notify) are pure
// pool logic and are unit-tested against pg-mem. The actual assemble+upload is
// injected as `renderAndUpload`, so tests run with a fake and production wires
// in the real one (ffmpeg via the killcam_clips pipeline + the YouTube API).
// ===========================================================================

type Pool = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }

export interface RenderJob {
  id: string
  match_id: string
  clip_ids: string[]
  participant_ids: string[]
  attempts: number
}

export interface RenderResult {
  youtubeId: string
  videoUrl: string
}

/** What actually assembles + uploads. Injected so the queue is testable. */
export type RenderAndUpload = (pool: Pool, job: RenderJob) => Promise<RenderResult>

const MAX_ATTEMPTS = 3

/**
 * Refuse to spend render time or a YouTube upload on clips that did not come
 * from the frame-analysis pipeline. Each angle must be tied to its own detected
 * match segment with the same confidence threshold used by the channel roster.
 */
export async function assertRenderJobHasCombatEvidence(pool: Pool, job: RenderJob): Promise<void> {
  if (job.clip_ids.length === 0) throw new Error('combat verification failed: render job has no clips')
  for (const clipId of job.clip_ids) {
    const verified = await pool.query(
      `select cr.id
         from clip_records cr
         join match_segments ms
           on ms.id=cr.segment_id and ms.source_id=cr.source_id
        where cr.id=$1
          and cr.segment_id is not null
          and cr.source_id is not null
          and cr.score_verification_status in ('shadow','verified')
          and coalesce(cr.boundary_confidence,ms.boundary_confidence,0) >= 0.70
        limit 1`,
      [clipId],
    )
    if (!verified.rows[0]) {
      throw new Error(`combat verification failed for clip ${clipId}`)
    }
  }
}

async function recordMatchVersion(
  pool: Pool,
  job: RenderJob,
  result: RenderResult,
  reason = 'render',
): Promise<number> {
  const next = await pool.query(
    `select coalesce(max(version),0)::int + 1 as version
       from match_versions where match_key=$1`,
    [job.match_id],
  )
  const version = Number(next.rows[0]?.version ?? 1)
  await pool.query(
    `insert into match_versions
       (match_key,version,youtube_id,angle_count,participant_ids,clip_ids,reason)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      job.match_id,
      version,
      result.youtubeId,
      job.participant_ids.length,
      job.participant_ids,
      job.clip_ids,
      reason,
    ],
  )
  for (const participantId of job.participant_ids) {
    await pool.query(
      `update match_angles set included_in_version=$1
        where match_key=$2 and user_id=$3 and status='active'`,
      [version, job.match_id, participantId],
    )
  }
  return version
}

/**
 * Atomically claim the oldest pending job. Two workers can race safely: the
 * guarded UPDATE only flips a row that is STILL 'pending', so exactly one wins
 * (same pattern as the redeem-code / daily-grant fixes).
 */
export async function claimNextJob(pool: Pool): Promise<RenderJob | null> {
  const pick = await pool.query(
    `select id from render_jobs
      where status='pending' and coalesce(ready_at, created_at) <= now()
      order by ready_at asc, created_at asc
      limit 1`,
  )
  const id = pick.rows[0]?.id
  if (!id) return null
  const claimed = await pool.query(
    `update render_jobs
        set status='rendering', attempts=attempts+1, updated_at=now()
      where id=$1 and status='pending'
    returning id, match_id, clip_ids, participant_ids, attempts`,
    [id],
  )
  if (!claimed.rows[0]) return null // lost the race; caller loops again
  const r = claimed.rows[0]
  return {
    id: String(r.id),
    match_id: String(r.match_id),
    clip_ids: (r.clip_ids ?? []).map(String),
    participant_ids: (r.participant_ids ?? []).map(String),
    attempts: Number(r.attempts ?? 1),
  }
}

/** Mark a job done, stamp the link everywhere, and notify the participants. */
export async function completeJob(pool: Pool, job: RenderJob, result: RenderResult): Promise<void> {
  const current = await pool.query(
    'select rerender_requested,participant_ids from render_jobs where id=$1',
    [job.id],
  )
  if (current.rows[0]?.rerender_requested) {
    // Preserve the upload as immutable history even though a camera joined or
    // was removed while this attempt was rendering. It is not promoted as the
    // current app-visible version.
    await recordMatchVersion(pool, job, result, 'superseded')
    const remaining = (current.rows[0]?.participant_ids ?? []).map(String)
    if (remaining.length < 2) {
      await pool.query(
        `update render_jobs
            set status='done', rerender_requested=false, attempts=0,
                youtube_id=null, combined_video_url=null, error=null, updated_at=now()
          where id=$1`,
        [job.id],
      )
      return
    }
    // A fuller angle set arrived while this attempt was rendering. Do not stamp
    // or notify the obsolete pair; leave the expanded clip_ids on the row and
    // let the worker claim it again after its short collection deadline.
    await pool.query(
      `update render_jobs
          set status='pending', rerender_requested=false, attempts=0,
              youtube_id=null, combined_video_url=null, error=null, updated_at=now()
        where id=$1`,
      [job.id],
    )
    return
  }

  await recordMatchVersion(pool, job, result)
  await pool.query(
    `update render_jobs set status='done', youtube_id=$1, combined_video_url=$2, updated_at=now() where id=$3`,
    [result.youtubeId, result.videoUrl, job.id],
  )
  // Stamp the finished TKO-channel composite onto every clip in the bunch, in a
  // SEPARATE column from the clip's own raw source id. `youtube_id` stays the
  // clip's raw upload (on the uploader's channel — the render worker needs it to
  // re-fetch the angle); `composite_youtube_id` is the TKO-channel produced
  // video. Only the latter is showcased in the public feed, so raw user uploads
  // never masquerade as produced videos pointing at someone else's channel.
  for (const clipId of job.clip_ids) {
    await pool.query('update clip_records set composite_youtube_id=$1 where id=$2', [result.youtubeId, clipId])
  }
  // Bump each participant's power for appearing in a produced multi-angle video
  // (recompute from their clips so it stays consistent with server/app.ts:
  // wins +250, losses −75, neutral uploads +100, produced +150, floored at 0).
  for (const pid of job.participant_ids) {
    await recomputePower(pool, pid)
  }
  // AUTO-MERGE → CONQUEST: this produced match is verified (same-match, linked
  // accounts). If it's a clan-vs-clan match with a tagged winner, feed the
  // result into the map. Best-effort — a produced video must never fail on it.
  try {
    const { recordMatchToConquest } = await import('./conquestFromMatch')
    await recordMatchToConquest(pool, job.clip_ids, result.youtubeId)
  } catch { /* conquest wiring is additive */ }

  // Tell everyone their video is live.
  for (const uid of job.participant_ids) {
    await pool.query(
      `insert into notifications (user_id, kind, title, body, link, related_id)
       values ($1,'auto_match_ready',$2,$3,$4,$5)`,
      [
        uid,
        'Your multi-angle video is live',
        'We assembled every angle of your match into one video and posted it. Tap to watch.',
        result.videoUrl,
        job.match_id,
      ],
    )
  }
}

/** Record a failure: retry (back to pending) until MAX_ATTEMPTS, then give up. */
export async function failJob(pool: Pool, job: RenderJob, error: string): Promise<void> {
  const current = await pool.query(
    'select rerender_requested from render_jobs where id=$1',
    [job.id],
  )
  if (current.rows[0]?.rerender_requested) {
    await pool.query(
      `update render_jobs
          set status='pending', rerender_requested=false, attempts=0,
              error=null, updated_at=now()
        where id=$1`,
      [job.id],
    )
    return
  }

  const giveUp = job.attempts >= MAX_ATTEMPTS
  await pool.query(
    `update render_jobs set status=$1, error=$2, updated_at=now() where id=$3`,
    [giveUp ? 'failed' : 'pending', String(error).slice(0, 500), job.id],
  )
}

/** Claim + process one job. Returns the job id handled, or null if queue empty. */
export async function runWorkerOnce(pool: Pool, render: RenderAndUpload): Promise<string | null> {
  const job = await claimNextJob(pool)
  if (!job) return null
  try {
    const result = await render(pool, job)
    await completeJob(pool, job, result)
  } catch (e: any) {
    await failJob(pool, job, e?.message || 'render failed')
  }
  return job.id
}

/**
 * Drain the queue: process pending jobs until none remain (or a cap is hit).
 * A long-running worker would call this on an interval.
 */
export async function drainQueue(pool: Pool, render: RenderAndUpload, cap = 100): Promise<number> {
  let handled = 0
  while (handled < cap) {
    const id = await runWorkerOnce(pool, render)
    if (!id) break
    handled++
  }
  return handled
}
