import { normalizeGameAlias, type MatchBoundaryObservation } from './matchDetection'
import { resolveMemberAlias, type IdentityQueryable } from './memberIdentity'
import type { CombatObservation, MatchResultObservation, ParticipantObservation } from './mediaEvidence'

export type LiveMatchPhase = 'waiting' | 'active' | 'result_pending' | 'finished' | 'uncertain'
export type LiveMatchFormat = 'unknown' | '1v1' | '2v2' | 'team'

export type LiveMatchEvidenceInput = {
  sourceId: string
  observations?: MatchBoundaryObservation[]
  participants?: ParticipantObservation[]
  combatEvents?: CombatObservation[]
  results?: MatchResultObservation[]
  final?: boolean
  detectorVersion?: string
  observedAt?: Date | string
}

export type DerivedLiveMatchSnapshot = {
  phase: LiveMatchPhase
  matchFormat: LiveMatchFormat
  fighterAliases: string[]
  result: MatchResultObservation | null
  confidence: number
  evidence: Record<string, unknown>
}

function confidence(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback
}

function latestAt(values: Array<{ atSec: number }>): number {
  return values.reduce((latest, value) => Math.max(latest, Number(value.atSec) || 0), -1)
}

function uniqueAliases(input: LiveMatchEvidenceInput): string[] {
  const aliases = new Map<string, string>()
  const add = (raw: unknown) => {
    const display = String(raw || '').trim()
    const key = normalizeGameAlias(display)
    if (key && !aliases.has(key)) aliases.set(key, display)
  }
  for (const participant of input.participants || []) add(participant.alias)
  for (const observation of input.observations || []) {
    for (const alias of observation.roster || []) add(alias)
  }
  for (const event of input.combatEvents || []) {
    add(event.killerAlias)
    add(event.victimAlias)
  }
  return [...aliases.values()]
}

function matchFormat(fighterCount: number): LiveMatchFormat {
  if (fighterCount === 2) return '1v1'
  if (fighterCount === 4) return '2v2'
  if (fighterCount > 4) return 'team'
  return 'unknown'
}

/**
 * Convert OCR/VLM facts into the state Oracle is allowed to trust. Empty or
 * contradictory evidence is deliberately UNCERTAIN; it never re-opens betting.
 */
export function deriveLiveMatchSnapshot(input: LiveMatchEvidenceInput): DerivedLiveMatchSnapshot {
  const observations = [...(input.observations || [])].sort((a, b) => a.atSec - b.atSec)
  const combatEvents = [...(input.combatEvents || [])].sort((a, b) => a.atSec - b.atSec)
  const results = [...(input.results || [])].sort((a, b) => a.atSec - b.atSec)
  const fighterAliases = uniqueAliases(input)
  const explicitStarts = observations.filter((item) => item.cue === 'start' || item.cue === 'timer')
  const rosterCues = observations.filter((item) => item.cue === 'roster')
  const result = results.at(-1) || null
  const latestResultAt = result ? Number(result.atSec) || 0 : -1
  const latestActiveAt = Math.max(latestAt(explicitStarts), latestAt(combatEvents))

  let phase: LiveMatchPhase = 'uncertain'
  let stateConfidence = 0.25
  if (result && latestResultAt >= latestActiveAt) {
    phase = input.final ? 'finished' : 'result_pending'
    stateConfidence = Math.max(0.78, confidence(result.confidence, 0.82))
  } else if (latestActiveAt >= 0) {
    phase = 'active'
    const activeConfidence = [
      ...explicitStarts.map((item) => confidence(item.confidence, item.cue === 'timer' ? 0.78 : 0.9)),
      ...combatEvents.map((item) => confidence(item.confidence, 0.78)),
    ]
    stateConfidence = Math.max(0.72, ...activeConfidence)
  } else if (rosterCues.length > 0 || fighterAliases.length >= 2) {
    phase = 'waiting'
    stateConfidence = Math.max(
      0.62,
      ...rosterCues.map((item) => confidence(item.confidence, 0.7)),
      ...(input.participants || []).map((item) => confidence(item.confidence, 0.65)),
    )
  }

  return {
    phase,
    matchFormat: matchFormat(fighterAliases.length),
    fighterAliases,
    result,
    confidence: Number(stateConfidence.toFixed(3)),
    evidence: {
      detector_version: input.detectorVersion || 'unknown',
      boundary_cues: observations.slice(-24),
      combat_events: combatEvents.slice(-24),
      result: result || null,
      final: input.final === true,
    },
  }
}

function observationTime(source: any, atSec = 0): string {
  const base = new Date(source.recorded_at || source.created_at || Date.now()).getTime()
  return new Date((Number.isFinite(base) ? base : Date.now()) + Math.max(0, atSec) * 1_000).toISOString()
}

export async function updateLiveMatchStateFromEvidence(
  db: IdentityQueryable,
  input: LiveMatchEvidenceInput,
): Promise<any | null> {
  const source = (await db.query(
    `select id,owner_id,live_stream_id,recorded_at,created_at
       from media_sources where id=$1`,
    [input.sourceId],
  )).rows[0]
  if (!source?.live_stream_id) return null

  const snapshot = deriveLiveMatchSnapshot(input)
  const observedAt = input.observedAt
    ? new Date(input.observedAt).toISOString()
    : new Date().toISOString()
  const resolvedIds = new Set<string>([String(source.owner_id)])
  for (const alias of snapshot.fighterAliases) {
    const atSec = (input.participants || []).find((item) => normalizeGameAlias(item.alias) === normalizeGameAlias(alias))?.atSec || 0
    const resolution = await resolveMemberAlias(db, alias, observationTime(source, atSec))
    if (resolution.status === 'resolved' && resolution.profileId) resolvedIds.add(resolution.profileId)
  }

  const previous = (await db.query(
    'select * from live_match_states where stream_id=$1',
    [source.live_stream_id],
  )).rows[0]
  const startsNewRound = Boolean(
    previous
    && (previous.phase === 'result_pending' || previous.phase === 'finished')
    && (snapshot.phase === 'waiting' || snapshot.phase === 'active'),
  )
  const sequence = Math.max(1, Number(previous?.match_sequence || 1) + (startsNewRound ? 1 : 0))
  const matchRef = `live:${source.live_stream_id}:${sequence}`
  const resultOutcome = snapshot.phase === 'result_pending' || snapshot.phase === 'finished'
    ? snapshot.result?.outcome || null
    : null
  const otherResolved = [...resolvedIds].find((id) => id !== String(source.owner_id)) || null
  const winnerProfileId = resultOutcome === 'victory'
    ? String(source.owner_id)
    : resultOutcome === 'defeat' ? otherResolved : null
  const loserProfileId = resultOutcome === 'defeat'
    ? String(source.owner_id)
    : resultOutcome === 'victory' ? otherResolved : null
  const startedAt = snapshot.phase === 'active'
    ? (previous?.phase === 'active' && !startsNewRound ? previous.started_at : observedAt)
    : (startsNewRound ? null : previous?.started_at || null)
  const endedAt = snapshot.phase === 'result_pending' || snapshot.phase === 'finished'
    ? observedAt
    : null

  return (await db.query(
    `insert into live_match_states
       (stream_id,source_id,phase,match_sequence,match_ref,match_format,
        fighter_aliases,fighter_profile_ids,result_outcome,winner_profile_id,
        loser_profile_id,confidence,started_at,ended_at,observed_at,evidence,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,now())
     on conflict (stream_id) do update set
       source_id=excluded.source_id, phase=excluded.phase,
       match_sequence=excluded.match_sequence, match_ref=excluded.match_ref,
       match_format=excluded.match_format, fighter_aliases=excluded.fighter_aliases,
       fighter_profile_ids=excluded.fighter_profile_ids,
       result_outcome=excluded.result_outcome,
       winner_profile_id=excluded.winner_profile_id,
       loser_profile_id=excluded.loser_profile_id,
       confidence=excluded.confidence, started_at=excluded.started_at,
       ended_at=excluded.ended_at, observed_at=excluded.observed_at,
       evidence=excluded.evidence, updated_at=now()
     returning *`,
    [
      source.live_stream_id, source.id, snapshot.phase, sequence, matchRef,
      snapshot.matchFormat, snapshot.fighterAliases, [...resolvedIds], resultOutcome,
      winnerProfileId, loserProfileId, snapshot.confidence, startedAt, endedAt,
      observedAt, JSON.stringify(snapshot.evidence),
    ],
  )).rows[0]
}

export async function finishLiveMatchStates(
  db: IdentityQueryable,
  streamIds: string[],
): Promise<void> {
  for (const streamId of [...new Set(streamIds.filter(Boolean))]) {
    await db.query(
      `update live_match_states
          set phase='finished', ended_at=coalesce(ended_at,now()),
              observed_at=now(), updated_at=now()
        where stream_id=$1 and phase <> 'finished'`,
      [streamId],
    )
  }
}

export async function readOracleLiveMatchState(
  db: IdentityQueryable,
  streamId: string,
): Promise<any | null> {
  return (await db.query(
    `select stream_id,phase,match_sequence,match_ref,match_format,
            fighter_aliases,fighter_profile_ids,result_outcome,
            winner_profile_id,loser_profile_id,confidence,started_at,ended_at,
            observed_at
       from live_match_states where stream_id=$1`,
    [streamId],
  )).rows[0] || null
}
