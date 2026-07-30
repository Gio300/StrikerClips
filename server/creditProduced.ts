/* eslint-disable @typescript-eslint/no-explicit-any */
// ===========================================================================
// CREDIT PRODUCED — the missing link between auto-merge and power level.
//
// The Python auto-merge pipeline finds a player's clips, builds the multi-angle
// video and uploads it to the TKO YouTube channel — but it never told the app
// "these players were in this match". Power level is computed ONLY from
// clip_records (server/app.ts recomputePower), so an auto-uploaded video could
// never raise anyone's power: there was nothing in the database to count.
//
// This module closes that loop. Given a produced composite video id and the
// angles that went into it, it resolves each angle to a TKO user (by explicit
// id, by a channel_id→owner override, or by matching the connected YouTube
// handle in user_youtube_links), writes ONE idempotent clip_records row per
// player marking them as a participant in that produced video, and recomputes
// their power. Being in an auto-merged video is now worth power, exactly like a
// clip the player posted themselves.
//
// Pure orchestration over the pool + an injected recompute fn, so it unit-tests
// against pg-mem with no circular import back into app.ts.
// ===========================================================================

type Pool = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }

export type CreditOutcome = 'victory' | 'defeat' | 'draw'

export interface CreditAngle {
  /** Explicit TKO user id — used directly if present. */
  user_id?: string
  /** YouTube handle (with or without @) — matched against user_youtube_links. */
  handle?: string
  /** YouTube channel id (UC…) — matched against the ownerMap override. */
  channel_id?: string
  /** The angle's own raw source upload id (for reference / render). */
  source_youtube_id?: string
  /** Tagged result for this player, if known. */
  outcome?: CreditOutcome
  /** Window inside the original upload that contains this match. */
  source_start?: number
  source_end?: number
  /** Usable location on the combined match timeline. */
  timeline_start?: number
  timeline_end?: number
  coverage_seconds?: number
  partial?: boolean
}

export interface CreditResult {
  credited: {
    user_id: string
    power: number
    created: boolean
    clip_record_id: string
    source_youtube_id?: string
  }[]
  /** Angles we couldn't map to a TKO account (not connected / unknown handle). */
  unresolved: CreditAngle[]
}

/** channel_id → TKO user_id, for channels whose owner we know but who may not
 *  have a matchable handle row yet (e.g. the founding clan). */
export type OwnerMap = Record<string, string>

function cleanHandle(h?: string): string {
  return (h || '').trim().replace(/^@+/, '').replace(/\/.*$/, '').toLowerCase()
}

/** Resolve one angle to a TKO user id, or null if we can't. */
async function resolveUser(pool: Pool, angle: CreditAngle, ownerMap: OwnerMap): Promise<string | null> {
  if (angle.user_id) return String(angle.user_id)
  if (angle.channel_id && ownerMap[angle.channel_id]) return ownerMap[angle.channel_id]
  const h = cleanHandle(angle.handle)
  if (h) {
    try {
      // user_youtube_links.url is stored as https://www.youtube.com/@handle by
      // recordYouTubeLink, so match the exact channel URL, case-insensitively.
      const r = await pool.query(
        'select user_id from user_youtube_links where lower(url) = $1 limit 1',
        [`https://www.youtube.com/@${h}`],
      )
      if (r.rows[0]?.user_id) return String(r.rows[0].user_id)
    } catch {
      /* table missing in a slim test schema — fall through to unresolved */
    }
  }
  return null
}

/**
 * Credit every resolvable angle of a produced composite video with a
 * participant clip_records row and recompute their power.
 *
 * Idempotent per (player, composite): re-running for the same video never
 * double-credits. If a row already exists and an outcome arrives later, the
 * outcome is filled in (win/loss then moves power the right way).
 */
export async function creditProduced(
  pool: Pool,
  compositeYoutubeId: string,
  angles: CreditAngle[],
  recompute: (pool: Pool, userId: string) => Promise<number>,
  ownerMap: OwnerMap = {},
): Promise<CreditResult> {
  const credited: CreditResult['credited'] = []
  const unresolved: CreditAngle[] = []
  const seen = new Set<string>()
  const composite = String(compositeYoutubeId || '').trim()
  if (!composite) return { credited, unresolved: angles.slice() }

  for (const a of angles) {
    const userId = await resolveUser(pool, a, ownerMap)
    if (!userId) {
      unresolved.push(a)
      continue
    }
    if (seen.has(userId)) continue // one credit per player per video
    seen.add(userId)

    const existing = await pool.query(
      'select id, outcome from clip_records where player_id=$1 and composite_youtube_id=$2 limit 1',
      [userId, composite],
    )
    let created = false
    let clipRecordId = existing.rows[0]?.id ? String(existing.rows[0].id) : ''
    if (!existing.rows.length) {
      const inserted = await pool.query(
        `insert into clip_records (player_id, composite_youtube_id, youtube_id, outcome, recorded_at)
         values ($1,$2,$3,$4, now())
         returning id`,
        [userId, composite, a.source_youtube_id || null, a.outcome || null],
      )
      clipRecordId = String(inserted.rows[0]?.id || '')
      created = true
    } else if (a.outcome && !existing.rows[0].outcome) {
      await pool.query(
        'update clip_records set outcome=$3 where player_id=$1 and composite_youtube_id=$2 and outcome is null',
        [userId, composite, a.outcome],
      )
    }
    const power = await recompute(pool, userId)
    credited.push({
      user_id: userId,
      power,
      created,
      clip_record_id: clipRecordId,
      source_youtube_id: a.source_youtube_id,
    })
  }
  return { credited, unresolved }
}
