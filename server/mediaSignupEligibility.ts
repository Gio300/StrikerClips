/* eslint-disable @typescript-eslint/no-explicit-any */

export type SignupEligibilityQueryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>
}

export type MediaSignupWindowRow = {
  provider?: unknown
  source_kind?: unknown
  recorded_at?: unknown
  source_created_at?: unknown
  owner_created_at?: unknown
}

export type MediaSignupEligibility = {
  eligible: boolean
  reason: 'eligible' | 'missing_source' | 'missing_signup_date' | 'missing_recorded_date' | 'pre_signup'
}

function utcDay(value: unknown): string | null {
  if (value == null || value === '') return null
  const date = new Date(value as any)
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

/**
 * Signup-day eligibility is deliberately day-inclusive: footage uploaded at
 * any point on the UTC day the member created their account is allowed, even
 * when it predates the exact signup time by a few hours.
 */
export function isOnOrAfterSignupDay(recordedAt: unknown, signupAt: unknown): boolean {
  const recordedDay = utcDay(recordedAt)
  const signupDay = utcDay(signupAt)
  return Boolean(recordedDay && signupDay && recordedDay >= signupDay)
}

export function evaluateMediaSignupEligibility(row: MediaSignupWindowRow | null | undefined): MediaSignupEligibility {
  if (!row) return { eligible: false, reason: 'missing_source' }
  if (!utcDay(row.owner_created_at)) return { eligible: false, reason: 'missing_signup_date' }

  // YouTube's Atom `published` timestamp is the proof that an upload is not
  // retro footage. Never substitute the discovery/source-row creation time for
  // a YouTube upload; doing so would make an old upload look newly eligible.
  const needsPublishedProof = String(row.provider || '').toLowerCase() === 'youtube'
    && String(row.source_kind || '').toLowerCase() === 'youtube_upload'
  const recordedAt = row.recorded_at || (needsPublishedProof ? null : row.source_created_at)
  if (!utcDay(recordedAt)) return { eligible: false, reason: 'missing_recorded_date' }
  if (!isOnOrAfterSignupDay(recordedAt, row.owner_created_at)) {
    return { eligible: false, reason: 'pre_signup' }
  }
  return { eligible: true, reason: 'eligible' }
}

export async function mediaSourceSignupEligibility(
  db: SignupEligibilityQueryable,
  sourceId: string,
): Promise<MediaSignupEligibility> {
  const row = (await db.query(
    `select s.provider,s.source_kind,s.recorded_at,s.created_at as source_created_at,
            u.created_at as owner_created_at
       from media_sources s
       join users u on u.id=s.owner_id
      where s.id=$1
      limit 1`,
    [sourceId],
  )).rows[0]
  return evaluateMediaSignupEligibility(row)
}
