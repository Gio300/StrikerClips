export const CONTENT_REPORT_TARGETS = [
  'profile',
  'post',
  'post_comment',
  'reel',
  'reel_comment',
  'chat_message',
  'dm_message',
  'stream_message',
  'tournament_message',
  'board_message',
] as const

export type ContentReportTarget = (typeof CONTENT_REPORT_TARGETS)[number]

export const CONTENT_REPORT_REASONS = [
  'harassment',
  'hate',
  'violence',
  'sexual',
  'spam',
  'scam',
  'impersonation',
  'self_harm',
  'other',
] as const

export type ContentReportReason = (typeof CONTENT_REPORT_REASONS)[number]

type Pooly = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>
}

type ReportInput = {
  target_type?: unknown
  target_id?: unknown
  reason?: unknown
  details?: unknown
  source_path?: unknown
}

export type CreateContentReportResult =
  | { ok: true; duplicate: boolean; report: { id: string; status: string; created_at: string } }
  | { ok: false; code: 'invalid_report' | 'not_found' | 'not_visible' | 'own_content' | 'rate_limited'; message: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const targetSet = new Set<string>(CONTENT_REPORT_TARGETS)
const reasonSet = new Set<string>(CONTENT_REPORT_REASONS)

const TARGET_SQL: Record<Exclude<ContentReportTarget, 'dm_message'>, string> = {
  profile: 'select id as user_id from profiles where id=$1',
  post: 'select user_id, body as content from posts where id=$1',
  post_comment: 'select user_id, body as content from post_comments where id=$1',
  reel: 'select user_id, title as content from reels where id=$1',
  reel_comment: 'select user_id, content from reel_comments where id=$1',
  chat_message: 'select user_id, body as content from chat_messages where id=$1',
  stream_message: 'select user_id, content from stream_messages where id=$1',
  tournament_message: 'select user_id, content from tournament_messages where id=$1',
  board_message: 'select user_id, content from messages where id=$1',
}

function cleanOptionalText(value: unknown, max: number): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? text.slice(0, max) : null
}

async function targetOwner(
  pool: Pooly,
  reporterId: string,
  targetType: ContentReportTarget,
  targetId: string,
): Promise<{ found: boolean; visible: boolean; ownerId: string | null; aiGenerated: boolean }> {
  if (targetType === 'dm_message') {
    const result = await pool.query(
      `select m.user_id,m.content
         from dm_messages m
         join dm_participants p on p.conversation_id=m.conversation_id
        where m.id=$1 and p.user_id=$2
        limit 1`,
      [targetId, reporterId],
    )
    if (result.rows[0]) {
      return {
        found: true,
        visible: true,
        ownerId: result.rows[0].user_id ? String(result.rows[0].user_id) : null,
        aiGenerated: String(result.rows[0].content || '').startsWith('[[tko-bot]]'),
      }
    }
    const exists = await pool.query('select 1 from dm_messages where id=$1', [targetId])
    return { found: exists.rows.length > 0, visible: false, ownerId: null, aiGenerated: false }
  }

  const result = await pool.query(TARGET_SQL[targetType], [targetId])
  const row = result.rows[0]
  return {
    found: Boolean(row),
    visible: Boolean(row),
    ownerId: row?.user_id ? String(row.user_id) : null,
    aiGenerated: targetType !== 'profile' && String(row?.content || '').startsWith('[[tko-bot]]'),
  }
}

/**
 * Validate and enqueue one report. reporterId is always taken from the bearer
 * token by the route; it is deliberately absent from ReportInput.
 */
export async function createContentReport(
  pool: Pooly,
  reporterId: string,
  input: ReportInput,
  at: Date = new Date(),
): Promise<CreateContentReportResult> {
  const targetType = String(input?.target_type || '')
  const targetId = String(input?.target_id || '').trim()
  const reason = String(input?.reason || '')
  if (!targetSet.has(targetType) || !UUID.test(targetId) || !reasonSet.has(reason)) {
    return {
      ok: false,
      code: 'invalid_report',
      message: 'Choose a valid reason and content item.',
    }
  }

  const target = await targetOwner(pool, reporterId, targetType as ContentReportTarget, targetId)
  if (!target.found) {
    return { ok: false, code: 'not_found', message: 'That content is no longer available.' }
  }
  if (!target.visible) {
    return { ok: false, code: 'not_visible', message: 'You cannot report content you cannot view.' }
  }
  if (target.ownerId === reporterId && !target.aiGenerated) {
    return { ok: false, code: 'own_content', message: 'You can delete your own content instead.' }
  }

  // The durable hourly ceiling works across every API instance. The route also
  // applies a short in-process burst limit so a single connection cannot pound
  // the database with repeated attempts.
  const cutoff = new Date(at.getTime() - 60 * 60 * 1000).toISOString()
  const recent = await pool.query(
    'select count(*)::int as count from content_reports where reporter_id=$1 and created_at >= $2',
    [reporterId, cutoff],
  )
  if (Number(recent.rows[0]?.count || 0) >= 30) {
    return { ok: false, code: 'rate_limited', message: 'Too many reports. Please try again later.' }
  }

  const details = cleanOptionalText(input.details, 1000)
  const sourcePath = cleanOptionalText(input.source_path, 1000)
  const inserted = await pool.query(
    `insert into content_reports
       (reporter_id,target_type,target_id,target_owner_id,target_is_ai,reason,details,source_path,created_at,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
     on conflict do nothing
     returning id,status,created_at`,
    [reporterId, targetType, targetId, target.ownerId, target.aiGenerated, reason, details, sourcePath, at.toISOString()],
  )
  if (inserted.rows[0]) {
    return { ok: true, duplicate: false, report: inserted.rows[0] }
  }

  const duplicate = await pool.query(
    `select id,status,created_at from content_reports
      where reporter_id=$1 and target_type=$2 and target_id=$3
        and status in ('open','reviewing')
      order by created_at desc limit 1`,
    [reporterId, targetType, targetId],
  )
  if (duplicate.rows[0]) {
    return { ok: true, duplicate: true, report: duplicate.rows[0] }
  }
  // A conflict without an active duplicate is unexpected, but fail closed and
  // give the player a retryable message instead of inventing a successful row.
  return { ok: false, code: 'invalid_report', message: 'The report could not be saved. Try again.' }
}
