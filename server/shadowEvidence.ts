/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Queryable } from './autoLive'

const STATUSES = new Set(['queued', 'processing', 'complete', 'needs_review', 'failed'])
const OUTCOMES = new Set(['win', 'loss', 'draw', 'unknown'])

function text(value: unknown, max = 500): string {
  return String(value ?? '').trim().slice(0, max)
}

function finite(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function confidence(value: unknown): number {
  return Math.max(0, Math.min(1, finite(value) ?? 0))
}

function integer(value: unknown): number | null {
  const parsed = finite(value)
  return parsed == null ? null : Math.max(0, Math.round(parsed))
}

function json(value: unknown, fallback: unknown): string {
  try { return JSON.stringify(value ?? fallback) } catch { return JSON.stringify(fallback) }
}

export type ShadowEvidenceInput = {
  source_fingerprint: string
  source_kind?: string
  source_ref?: string
  status?: string
  match_signature?: string
  game?: string
  mode?: string
  verdict?: Record<string, unknown>
  confidence?: number
  evidence_quality?: number
  analyzer?: string
  model?: string
  analyzer_version?: string
  evidence?: unknown[]
  analysis?: Record<string, unknown>
  error?: string
  participants?: Array<{
    profile_id?: string | null
    detected_name: string
    team?: string | null
    outcome?: string
    kills?: number | null
    deaths?: number | null
    assists?: number | null
    confidence?: number
    evidence?: Record<string, unknown>
  }>
}

/**
 * Persist model evidence in the SHADOW namespace only. This function never
 * references official result, rating, tournament, prize, or Conquest tables.
 */
export async function saveShadowEvidence(db: Queryable, body: ShadowEvidenceInput) {
  const fingerprint = text(body?.source_fingerprint, 128)
  if (!fingerprint) throw new Error('source_fingerprint required')
  const requestedStatus = text(body.status, 30) || 'complete'
  const status = STATUSES.has(requestedStatus) ? requestedStatus : 'needs_review'
  const completedAt = ['complete', 'needs_review', 'failed'].includes(status) ? new Date() : null
  const result = await db.query(
    `insert into shadow_match_analyses
       (source_fingerprint,source_kind,source_ref,status,match_signature,game,mode,
        verdict,confidence,evidence_quality,analyzer,model,analyzer_version,
        evidence,analysis,error,updated_at,completed_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,now(),$17)
     on conflict (source_fingerprint) do update set
       source_kind=excluded.source_kind, source_ref=excluded.source_ref,
       status=excluded.status, match_signature=excluded.match_signature,
       game=excluded.game, mode=excluded.mode, verdict=excluded.verdict,
       confidence=excluded.confidence, evidence_quality=excluded.evidence_quality,
       analyzer=excluded.analyzer, model=excluded.model,
       analyzer_version=excluded.analyzer_version, evidence=excluded.evidence,
       analysis=excluded.analysis, error=excluded.error,
       updated_at=now(), completed_at=excluded.completed_at
     returning *`,
    [
      fingerprint, text(body.source_kind, 80) || 'footage_group', text(body.source_ref, 1000) || null,
      status, text(body.match_signature, 200) || null, text(body.game, 80) || 'shinobi_striker',
      text(body.mode, 100) || null, json(body.verdict, {}), confidence(body.confidence),
      confidence(body.evidence_quality), text(body.analyzer, 80) || 'local', text(body.model, 120) || null,
      text(body.analyzer_version, 80) || null, json(body.evidence, []), json(body.analysis, {}),
      text(body.error, 2000) || null, completedAt,
    ],
  )
  const row = result.rows[0]
  await db.query('delete from shadow_match_participants where analysis_id=$1', [row.id])
  const participants: any[] = []
  for (const raw of Array.isArray(body.participants) ? body.participants.slice(0, 24) : []) {
    const detectedName = text(raw.detected_name, 100)
    if (!detectedName) continue
    let profileId = text(raw.profile_id, 80) || null
    if (!profileId) {
      const matched = await db.query('select id from profiles where lower(username)=lower($1) limit 1', [detectedName])
      profileId = matched.rows[0]?.id || null
    }
    const requestedOutcome = text(raw.outcome, 20) || 'unknown'
    const outcome = OUTCOMES.has(requestedOutcome) ? requestedOutcome : 'unknown'
    const inserted = await db.query(
      `insert into shadow_match_participants
         (analysis_id,profile_id,detected_name,team,outcome,kills,deaths,assists,confidence,evidence)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) returning *`,
      [row.id, profileId, detectedName, text(raw.team, 100) || null, outcome,
        integer(raw.kills), integer(raw.deaths), integer(raw.assists), confidence(raw.confidence),
        json(raw.evidence, {})],
    )
    participants.push(inserted.rows[0])
  }
  return { analysis: row, participants, official_state_changed: false }
}

export async function listShadowEvidence(db: Queryable, limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Math.round(limit || 50)))
  const analyses = (await db.query(
    `select * from shadow_match_analyses order by updated_at desc limit $1`, [safeLimit],
  )).rows
  if (!analyses.length) return []
  const ids = analyses.map((row) => row.id)
  const participants = (await db.query(
    `select * from shadow_match_participants where analysis_id = any($1) order by detected_name`, [ids],
  )).rows
  return analyses.map((analysis) => ({
    ...analysis,
    participants: participants.filter((participant) => String(participant.analysis_id) === String(analysis.id)),
  }))
}
