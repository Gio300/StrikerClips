import { createHash, randomUUID } from 'node:crypto'
import { runAutoMatch } from './autoMatch'
import {
  detectMatchSegments,
  matchSegmentFingerprint,
  normalizeGameAlias,
  type MatchBoundaryObservation,
} from './matchDetection'
import { observeOwnedAlias, resolveMemberAlias, type IdentityQueryable } from './memberIdentity'
import { reconcileVerifiedMatchScoring } from './verifiedScoring'
import {
  evaluateMediaSignupEligibility,
  mediaSourceSignupEligibility,
} from './mediaSignupEligibility'

export type MediaQueryable = IdentityQueryable

export type MediaProvider = 'youtube' | 'tko' | 'external'
export type MediaSourceKind = 'youtube_upload' | 'youtube_live' | 'direct_upload' | 'external_live'
export type MediaAnalysisJobKind = 'match_boundaries_v1' | 'shinobi_integrity_v1'

export type RegisterMediaSourceInput = {
  ownerId: string
  liveStreamId?: string | null
  provider: MediaProvider
  sourceKind: MediaSourceKind
  externalId?: string | null
  sourceUrl: string
  status?: 'recording' | 'queued' | 'processing' | 'complete' | 'failed'
  recordedAt?: Date | string | null
  endedAt?: Date | string | null
  durationSec?: number | null
  metadata?: Record<string, unknown>
}

export function mediaSourceFingerprint(input: Pick<RegisterMediaSourceInput, 'provider' | 'externalId' | 'sourceUrl'>): string {
  const identity = input.externalId
    ? `${input.provider}:id:${String(input.externalId).trim()}`
    : `${input.provider}:url:${String(input.sourceUrl).trim().toLowerCase()}`
  return createHash('sha256').update(identity).digest('hex')
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function bounded(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback
}

export async function registerMediaSource(db: MediaQueryable, input: RegisterMediaSourceInput): Promise<any> {
  const sourceUrl = String(input.sourceUrl || '').trim()
  if (!sourceUrl) throw new Error('sourceUrl required')
  const fingerprint = mediaSourceFingerprint(input)
  const existing = (await db.query(
    'select id, owner_id from media_sources where source_fingerprint=$1',
    [fingerprint],
  )).rows[0]
  if (existing && String(existing.owner_id) !== input.ownerId) {
    throw new Error('this media source is already linked to another TKO member')
  }
  const status = input.status || (input.sourceKind.endsWith('_live') ? 'recording' : 'queued')
  return (await db.query(
    `insert into media_sources
       (owner_id,live_stream_id,provider,source_kind,external_id,source_url,source_fingerprint,status,
        recorded_at,ended_at,duration_sec,metadata,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,now())
     on conflict (source_fingerprint) do update set
       live_stream_id=coalesce(excluded.live_stream_id,media_sources.live_stream_id),
       source_kind=case
         when excluded.source_kind='youtube_upload' then excluded.source_kind
         else media_sources.source_kind end,
       source_url=excluded.source_url,
       status=case
         when excluded.status='recording' then 'recording'
         when media_sources.status='recording' and excluded.status='queued' then 'queued'
         else media_sources.status end,
       recorded_at=coalesce(media_sources.recorded_at,excluded.recorded_at),
       ended_at=coalesce(excluded.ended_at,media_sources.ended_at),
       duration_sec=coalesce(excluded.duration_sec,media_sources.duration_sec),
       metadata=case
         when excluded.metadata='{}'::jsonb then media_sources.metadata
         else excluded.metadata end,
       updated_at=now()
     returning *`,
    [
      input.ownerId,
      input.liveStreamId || null,
      input.provider,
      input.sourceKind,
      input.externalId ? String(input.externalId).trim() : null,
      sourceUrl,
      fingerprint,
      status,
      iso(input.recordedAt),
      iso(input.endedAt),
      input.durationSec == null ? null : bounded(input.durationSec),
      JSON.stringify(input.metadata || {}),
    ],
  )).rows[0]
}

export async function queueMediaAnalysis(
  db: MediaQueryable,
  sourceId: string,
  reason: string,
  readyAt = new Date(),
  jobKind: MediaAnalysisJobKind = 'match_boundaries_v1',
): Promise<any | null> {
  const signupEligibility = await mediaSourceSignupEligibility(db, sourceId)
  if (!signupEligibility.eligible) return null
  return (await db.query(
    `insert into media_analysis_jobs (source_id,job_kind,status,reason,ready_at,updated_at)
     values ($1,$2,'queued',$3,$4,now())
     on conflict (source_id,job_kind) do update set
       ready_at=case
         when media_analysis_jobs.status='failed'
           and media_analysis_jobs.reason=excluded.reason then media_analysis_jobs.ready_at
         when media_analysis_jobs.ready_at <= excluded.ready_at then media_analysis_jobs.ready_at
         else excluded.ready_at end,
       attempts=case
         when media_analysis_jobs.status='failed'
           and media_analysis_jobs.reason<>excluded.reason then 0
         else media_analysis_jobs.attempts end,
       error=case
         when media_analysis_jobs.status='failed'
           and media_analysis_jobs.reason=excluded.reason then media_analysis_jobs.error
         else null end,
       status=case
         when media_analysis_jobs.status='processing' then 'processing'
         when media_analysis_jobs.status='failed'
           and media_analysis_jobs.reason=excluded.reason then 'failed'
         else 'queued' end,
       reason=excluded.reason,
       updated_at=now()
     returning *`,
    [sourceId, jobKind, reason, readyAt.toISOString()],
  )).rows[0]
}

export async function queueTournamentIntegrityAnalysis(
  db: MediaQueryable,
  sourceId: string,
  reason: string,
  readyAt = new Date(),
): Promise<any | null> {
  const eligible = (await db.query(
    `select s.id
       from media_sources s
       join live_streams l on l.id=s.live_stream_id
       join tournaments t on t.id=l.tournament_id
      where s.id=$1
        and s.source_kind in ('youtube_live','external_live')
        and lower(coalesce(l.game,'')) like '%shinobi%striker%'
      limit 1`,
    [sourceId],
  )).rows[0]
  if (!eligible) return null
  return queueMediaAnalysis(db, sourceId, reason, readyAt, 'shinobi_integrity_v1')
}

export async function claimMediaAnalysisJob(
  db: MediaQueryable,
  workerId: string,
  leaseSeconds = 900,
  jobKind: MediaAnalysisJobKind = 'match_boundaries_v1',
): Promise<any | null> {
  const lease = Math.max(60, Math.min(3600, Math.round(leaseSeconds)))
  const leaseUntil = new Date(Date.now() + lease * 1_000).toISOString()
  // Existing deployments may already contain pre-signup jobs. Read the ready
  // candidates with their source/account dates and atomically claim the first
  // eligible one. Old rows remain untouched for an explicit operator-reviewed
  // quarantine; crucially, they cannot starve newer eligible work or be leased.
  const candidates = (await db.query(
    `select j.id,s.provider,s.source_kind,s.recorded_at,s.created_at as source_created_at,
            u.created_at as owner_created_at
       from media_analysis_jobs j
       join media_sources s on s.id=j.source_id
       join users u on u.id=s.owner_id
      where j.ready_at <= now()
        and j.job_kind=$1
        and (j.status='queued' or (j.status='processing' and j.lease_until < now()))
      order by j.ready_at,j.created_at`,
    [jobKind],
  )).rows
  for (const candidate of candidates) {
    if (!evaluateMediaSignupEligibility(candidate).eligible) continue
    const row = (await db.query(
      `update media_analysis_jobs
          set status='processing', worker_id=$2, attempts=attempts+1,
              lease_until=$3, updated_at=now()
        where id=$1
          and ready_at <= now()
          and job_kind=$4
          and (status='queued' or (status='processing' and lease_until < now()))
        returning *`,
      [candidate.id, workerId, leaseUntil, jobKind],
    )).rows[0]
    if (!row) continue
    const source = (await db.query('select * from media_sources where id=$1', [row.source_id])).rows[0]
    if (source) return { ...row, source }
  }
  return null
}

export async function completeMediaAnalysisJob(
  db: MediaQueryable,
  jobId: string,
  result: { ok: boolean; error?: string | null; cursorSec?: number | null; retryable?: boolean },
): Promise<void> {
  const current = (await db.query(
    'select attempts from media_analysis_jobs where id=$1',
    [jobId],
  )).rows[0]
  if (!current) return
  const attempts = Math.max(0, Number(current.attempts || 0))
  const retry = !result.ok && result.retryable !== false && attempts < 3
  const retryAt = retry
    ? new Date(Date.now() + 60_000 * (2 ** Math.max(0, attempts - 1))).toISOString()
    : null
  await db.query(
    `update media_analysis_jobs
        set status=$2, error=$3, lease_until=null, worker_id=null,
            ready_at=coalesce($4,ready_at), updated_at=now()
      where id=$1`,
    [jobId, result.ok ? 'complete' : retry ? 'queued' : 'failed', result.error || null, retryAt],
  )
  if (result.cursorSec != null) {
    await db.query(
      `update media_sources set analysis_cursor_sec=greatest(analysis_cursor_sec,$2), updated_at=now()
        where id=(select source_id from media_analysis_jobs where id=$1)`,
      [jobId, bounded(result.cursorSec)],
    )
  }
}

export type ParticipantObservation = {
  alias: string
  atSec: number
  team?: string | null
  confidence?: number
  evidenceRef?: string | null
}

export type CombatObservation = {
  atSec: number
  eventType?: 'ko' | 'death' | 'assist'
  matchClockSec?: number | null
  killerAlias?: string | null
  victimAlias?: string | null
  confidence?: number
  evidenceRef?: string | null
}

export type MatchResultObservation = {
  atSec: number
  outcome: 'victory' | 'defeat' | 'draw'
  kills?: number | null
  deaths?: number | null
  assists?: number | null
  scoreLine?: string | null
  team?: string | null
  confidence?: number
  explicitEvidence?: boolean
  exactText?: string | null
  evidenceRef?: string | null
}

export type IngestMediaEvidenceInput = {
  sourceId: string
  observations: MatchBoundaryObservation[]
  sourceDurationSec?: number | null
  segmentIndexOffset?: number
  ownerAlias?: { displayAlias: string; confidence: number; evidenceRef?: string | null } | null
  participants?: ParticipantObservation[]
  combatEvents?: CombatObservation[]
  results?: MatchResultObservation[]
  final?: boolean
  detectorVersion?: string
}

function observationTime(source: any, atSec: number): string {
  const base = new Date(source.recorded_at || source.created_at || Date.now()).getTime()
  return new Date(base + Math.max(0, atSec) * 1000).toISOString()
}

async function refreshSegmentMembers(db: MediaQueryable, segmentId: string): Promise<string[]> {
  const rows = (await db.query(
    `select distinct resolved_profile_id from match_member_observations
      where segment_id=$1 and resolution_status='resolved' and resolved_profile_id is not null`,
    [segmentId],
  )).rows
  const ids = rows.map((row) => String(row.resolved_profile_id))
  await db.query(
    `update match_segments set resolved_member_ids=$2, member_vs_member=$3, updated_at=now() where id=$1`,
    [segmentId, ids, ids.length >= 2],
  )
  return ids
}

function eventFingerprint(sourceFingerprint: string, segmentId: string, event: CombatObservation): string {
  return createHash('sha256').update([
    sourceFingerprint,
    segmentId,
    event.eventType || 'ko',
    Math.round(bounded(event.atSec) * 2) / 2,
    event.matchClockSec == null ? '' : Math.round(bounded(event.matchClockSec)),
    normalizeGameAlias(event.killerAlias || ''),
    normalizeGameAlias(event.victimAlias || ''),
  ].join('|')).digest('hex')
}

async function saveCombatObservation(
  db: MediaQueryable,
  source: any,
  segment: any,
  event: CombatObservation,
): Promise<string> {
  const observedAt = observationTime(source, event.atSec)
  const killer = event.killerAlias
    ? await resolveMemberAlias(db, event.killerAlias, observedAt)
    : { status: 'unresolved' as const, profileId: null, aliasId: null, confidence: 0 }
  const victim = event.victimAlias
    ? await resolveMemberAlias(db, event.victimAlias, observedAt)
    : { status: 'unresolved' as const, profileId: null, aliasId: null, confidence: 0 }
  const confidence = Math.max(0, Math.min(1, Number(event.confidence) || 0))
  const ambiguous = killer.status === 'ambiguous' || victim.status === 'ambiguous'
  const bothResolved = killer.status === 'resolved' && victim.status === 'resolved'
    && killer.profileId !== victim.profileId
  const status = ambiguous ? 'ambiguous' : (bothResolved && confidence >= 0.75 ? 'single_camera' : 'candidate')
  const fingerprint = eventFingerprint(String(source.source_fingerprint), String(segment.id), event)
  return String((await db.query(
    `insert into combat_events
       (source_id,segment_id,match_group_id,event_fingerprint,event_type,at_sec,match_clock_sec,
        killer_alias,victim_alias,killer_profile_id,victim_profile_id,verification_status,confidence,evidence)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
     on conflict (event_fingerprint) do update set
       confidence=greatest(combat_events.confidence,excluded.confidence),
       evidence=excluded.evidence,
       updated_at=now()
     returning id`,
    [
      source.id,
      segment.id,
      segment.match_group_id || null,
      fingerprint,
      event.eventType || 'ko',
      bounded(event.atSec),
      event.matchClockSec == null ? null : Math.round(bounded(event.matchClockSec)),
      event.killerAlias || null,
      event.victimAlias || null,
      killer.profileId,
      victim.profileId,
      status,
      confidence,
      JSON.stringify({ evidence_ref: event.evidenceRef || null, scoring_mode: 'shadow' }),
    ],
  )).rows[0].id)
}

async function saveResultObservation(
  db: MediaQueryable,
  source: any,
  segment: any,
  result: MatchResultObservation,
): Promise<string> {
  const confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0))
  const explicitEvidence = Boolean(result.explicitEvidence)
  const status = explicitEvidence && confidence >= 0.85 ? 'single_camera' : 'candidate'
  const atSec = Math.round(bounded(result.atSec) * 2) / 2
  return String((await db.query(
    `insert into match_result_observations
       (source_id,segment_id,match_group_id,owner_profile_id,outcome,kills,deaths,assists,
        score_line,team,at_sec,explicit_evidence,verification_status,confidence,evidence)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
     on conflict (source_id,segment_id,outcome,at_sec) do update set
       kills=coalesce(excluded.kills,match_result_observations.kills),
       deaths=coalesce(excluded.deaths,match_result_observations.deaths),
       assists=coalesce(excluded.assists,match_result_observations.assists),
       score_line=coalesce(excluded.score_line,match_result_observations.score_line),
       team=coalesce(excluded.team,match_result_observations.team),
       explicit_evidence=match_result_observations.explicit_evidence or excluded.explicit_evidence,
       verification_status=case
         when match_result_observations.verification_status='verified' then 'verified'
         else excluded.verification_status end,
       confidence=greatest(match_result_observations.confidence,excluded.confidence),
       evidence=excluded.evidence,
       updated_at=now()
     returning id`,
    [
      source.id,
      segment.id,
      segment.match_group_id || null,
      source.owner_id,
      result.outcome,
      result.kills == null ? null : Math.max(0, Math.round(result.kills)),
      result.deaths == null ? null : Math.max(0, Math.round(result.deaths)),
      result.assists == null ? null : Math.max(0, Math.round(result.assists)),
      result.scoreLine || null,
      result.team || null,
      atSec,
      explicitEvidence,
      status,
      confidence,
      JSON.stringify({
        evidence_ref: result.evidenceRef || null,
        exact_text: result.exactText || null,
        scoring_mode: 'shadow',
      }),
    ],
  )).rows[0].id)
}

export async function ingestMediaEvidence(
  db: MediaQueryable,
  input: IngestMediaEvidenceInput,
): Promise<{
  sourceId: string
  segmentIds: string[]
  clipRecordIds: string[]
  combatEventIds: string[]
  resultObservationIds: string[]
}> {
  const source = (await db.query(
    `select s.*,s.created_at as source_created_at,u.created_at as owner_created_at
       from media_sources s
       join users u on u.id=s.owner_id
      where s.id=$1`,
    [input.sourceId],
  )).rows[0]
  if (!source) throw new Error('media source not found')
  const signupEligibility = evaluateMediaSignupEligibility(source)
  if (!signupEligibility.eligible) {
    throw new Error(`media source is outside the owner's signup window (${signupEligibility.reason})`)
  }
  const segments = detectMatchSegments(input.observations || [], {
    sourceDurationSec: input.sourceDurationSec ?? source.duration_sec,
  })
  const segmentIds: string[] = []
  const clipRecordIds: string[] = []
  const combatEventIds: string[] = []
  const resultObservationIds: string[] = []
  const offset = Math.max(0, Math.round(Number(input.segmentIndexOffset) || 0))
  let ownerAliasObserved = false

  for (const detected of segments) {
    const segmentIndex = detected.segmentIndex + offset
    const fingerprint = matchSegmentFingerprint(String(source.source_fingerprint), detected)
    const segment = (await db.query(
      `insert into match_segments
         (source_id,segment_index,segment_fingerprint,start_sec,end_sec,start_reason,end_reason,
          boundary_confidence,first_timer_sec,last_timer_sec,mode,map,roster,detector_version,evidence,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,now())
       on conflict (source_id,segment_index) do update set
         segment_fingerprint=excluded.segment_fingerprint,
         start_sec=excluded.start_sec,end_sec=excluded.end_sec,
         start_reason=excluded.start_reason,end_reason=excluded.end_reason,
         boundary_confidence=excluded.boundary_confidence,
         first_timer_sec=excluded.first_timer_sec,last_timer_sec=excluded.last_timer_sec,
         mode=excluded.mode,map=excluded.map,roster=excluded.roster,
         detector_version=excluded.detector_version,evidence=excluded.evidence,updated_at=now()
       returning *`,
      [
        source.id, segmentIndex, fingerprint, detected.startSec, detected.endSec,
        detected.startReason, detected.endReason, detected.boundaryConfidence,
        detected.firstTimerSec, detected.lastTimerSec, detected.mode, detected.map,
        detected.roster, input.detectorVersion || 'match-boundaries-v1', JSON.stringify(detected.evidence),
      ],
    )).rows[0]
    segmentIds.push(String(segment.id))

    if (input.ownerAlias && !ownerAliasObserved) {
      await observeOwnedAlias(db, {
        profileId: String(source.owner_id),
        sourceId: String(source.id),
        segmentId: String(segment.id),
        displayAlias: input.ownerAlias.displayAlias,
        observedAt: observationTime(source, detected.startSec),
        confidence: input.ownerAlias.confidence,
        evidenceType: 'owned_hud',
        evidence: { evidence_ref: input.ownerAlias.evidenceRef || null },
      })
      ownerAliasObserved = true
    }

    const aliases = new Map<string, ParticipantObservation>()
    for (const displayAlias of detected.roster) {
      const key = normalizeGameAlias(displayAlias)
      if (key) aliases.set(key, { alias: displayAlias, atSec: detected.startSec, confidence: 0.72 })
    }
    for (const participant of input.participants || []) {
      if (participant.atSec < detected.startSec || participant.atSec > detected.endSec) continue
      const key = normalizeGameAlias(participant.alias)
      const previous = aliases.get(key)
      if (key && (!previous || Number(participant.confidence || 0) >= Number(previous.confidence || 0))) {
        aliases.set(key, participant)
      }
    }
    if (input.ownerAlias) {
      const key = normalizeGameAlias(input.ownerAlias.displayAlias)
      if (key) aliases.set(key, {
        alias: input.ownerAlias.displayAlias,
        atSec: detected.startSec,
        confidence: input.ownerAlias.confidence,
        evidenceRef: input.ownerAlias.evidenceRef,
      })
    }

    for (const participant of aliases.values()) {
      const observedAt = observationTime(source, participant.atSec)
      const resolution = await resolveMemberAlias(db, participant.alias, observedAt)
      const confidence = Math.max(0, Math.min(1, Number(participant.confidence) || 0))
      await db.query(
        `insert into match_member_observations
           (segment_id,detected_alias,normalized_alias,resolved_profile_id,resolution_status,
            team,confidence,evidence,observed_at,updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,now())
         on conflict (segment_id,normalized_alias) do update set
           detected_alias=excluded.detected_alias,
           resolved_profile_id=excluded.resolved_profile_id,
           resolution_status=excluded.resolution_status,
           team=coalesce(excluded.team,match_member_observations.team),
           confidence=greatest(match_member_observations.confidence,excluded.confidence),
           evidence=excluded.evidence,
           observed_at=case
             when match_member_observations.observed_at <= excluded.observed_at
               then match_member_observations.observed_at else excluded.observed_at end,
           updated_at=now()`,
        [
          segment.id,
          participant.alias,
          normalizeGameAlias(participant.alias),
          resolution.profileId,
          resolution.status,
          participant.team || null,
          confidence,
          JSON.stringify({ evidence_ref: participant.evidenceRef || null }),
          observedAt,
        ],
      )
    }
    await refreshSegmentMembers(db, String(segment.id))

    const recordedAt = observationTime(source, detected.startSec)
    const clipRecord = (await db.query(
      `insert into clip_records
         (player_id,player_handle,participants,youtube_id,duration_sec,recorded_at,
          ocr_confidence,mode,map,source_id,segment_id,source_start_sec,source_end_sec,
          segment_index,boundary_confidence,score_verification_status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'shadow')
       on conflict (segment_id,player_id)
       do update set
         player_handle=coalesce(excluded.player_handle,clip_records.player_handle),
         participants=excluded.participants,duration_sec=excluded.duration_sec,
         recorded_at=excluded.recorded_at,ocr_confidence=excluded.ocr_confidence,
         mode=excluded.mode,map=excluded.map,source_start_sec=excluded.source_start_sec,
         source_end_sec=excluded.source_end_sec,segment_index=excluded.segment_index,
         boundary_confidence=excluded.boundary_confidence,
         score_verification_status=case
           when clip_records.score_verification_status='verified' then 'verified' else 'shadow' end
       returning id`,
      [
        source.owner_id,
        input.ownerAlias?.displayAlias || null,
        [...aliases.values()].map((item) => item.alias),
        source.provider === 'youtube' ? source.external_id : null,
        Math.max(0, Math.round(detected.endSec - detected.startSec)),
        recordedAt,
        detected.boundaryConfidence,
        detected.mode,
        detected.map,
        source.id,
        segment.id,
        detected.startSec,
        detected.endSec,
        segmentIndex,
        detected.boundaryConfidence,
      ],
    )).rows[0]
    clipRecordIds.push(String(clipRecord.id))
    await db.query('update match_segments set clip_record_id=$2 where id=$1', [segment.id, clipRecord.id])

    for (const event of input.combatEvents || []) {
      if (event.atSec < detected.startSec || event.atSec > detected.endSec) continue
      combatEventIds.push(await saveCombatObservation(db, source, segment, event))
    }
    for (const result of input.results || []) {
      if (result.atSec < detected.startSec || result.atSec > detected.endSec) continue
      resultObservationIds.push(await saveResultObservation(db, source, segment, result))
    }
  }

  await db.query(
    `update media_sources
        set status=$2, duration_sec=coalesce($3,duration_sec),
            analysis_cursor_sec=greatest(analysis_cursor_sec,$4), updated_at=now()
      where id=$1`,
    [
      source.id,
      input.final === false ? 'recording' : 'complete',
      input.sourceDurationSec == null ? null : bounded(input.sourceDurationSec),
      input.sourceDurationSec == null ? Math.max(0, ...segments.map((segment) => segment.endSec)) : bounded(input.sourceDurationSec),
    ],
  )
  return { sourceId: String(source.id), segmentIds, clipRecordIds, combatEventIds, resultObservationIds }
}

export async function reconcileCombatEvidence(db: MediaQueryable, matchGroupId: string): Promise<number> {
  const result = await reconcileVerifiedMatchScoring(db, matchGroupId)
  return result.combatEvents
}

export async function autoMatchIngestedSegments(
  db: MediaQueryable,
  clipRecordIds: string[],
): Promise<Array<{ clipRecordId: string; matched: boolean; matchId?: string }>> {
  const results: Array<{ clipRecordId: string; matched: boolean; matchId?: string }> = []
  for (const clipRecordId of clipRecordIds) {
    const result = await runAutoMatch(db as any, clipRecordId)
    results.push({ clipRecordId, matched: result.matched, matchId: result.matchId })
    if (!result.matchId) continue
    await db.query(
      `update match_segments set match_group_id=$2, updated_at=now()
        where clip_record_id=$1`,
      [clipRecordId, result.matchId],
    )
    await db.query(
      `update combat_events set match_group_id=$2, updated_at=now()
        where segment_id=(select segment_id from clip_records where id=$1)`,
      [clipRecordId, result.matchId],
    )
    await db.query(
      `update match_result_observations set match_group_id=$2, updated_at=now()
        where segment_id=(select segment_id from clip_records where id=$1)`,
      [clipRecordId, result.matchId],
    )
    await reconcileCombatEvidence(db, result.matchId)
  }
  return results
}

export async function registerAndQueueMediaSource(
  db: MediaQueryable,
  input: RegisterMediaSourceInput,
  reason: string,
): Promise<any> {
  const source = await registerMediaSource(db, input)
  await queueMediaAnalysis(db, String(source.id), reason)
  if (String(source.source_kind || '').endsWith('_live') && String(source.status) !== 'recording') {
    await queueTournamentIntegrityAnalysis(db, String(source.id), `${reason}:tournament_integrity`)
  }
  return source
}

export async function closeExternalLiveSource(
  db: MediaQueryable,
  provider: MediaProvider,
  externalId: string,
): Promise<void> {
  const source = (await db.query(
    `update media_sources set status='queued', ended_at=coalesce(ended_at,now()), updated_at=now()
      where provider=$1 and external_id=$2 returning id`,
    [provider, externalId],
  )).rows[0]
  if (source) {
    await queueMediaAnalysis(db, String(source.id), 'live_ended_final_pass')
    await queueTournamentIntegrityAnalysis(db, String(source.id), 'live_ended_integrity_pass')
  }
}

export function mediaWorkerId(prefix = 'detector'): string {
  return `${prefix}-${randomUUID()}`
}
