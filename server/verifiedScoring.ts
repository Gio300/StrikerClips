import { recomputePower, type PowerQueryable } from './power'

export type ScoringQueryable = PowerQueryable

export type RawCombatEvidence = {
  id: string
  sourceId: string
  sourceOwnerId: string
  eventType?: 'ko' | 'death' | 'assist'
  killerProfileId: string
  victimProfileId: string
  matchClockSec: number | null
  confidence: number
}

export type CanonicalCombatEvent = {
  eventType: 'ko' | 'death' | 'assist'
  killerProfileId: string
  victimProfileId: string
  matchClockSec: number
  sourceIds: string[]
  sourceOwnerIds: string[]
  rawEventIds: string[]
  confidence: number
}

export type RawResultEvidence = {
  id: string
  sourceId: string
  sourceOwnerId: string
  outcome: 'victory' | 'defeat' | 'draw'
  team?: string | null
  scoreLine?: string | null
  kills?: number | null
  deaths?: number | null
  assists?: number | null
  explicitEvidence: boolean
  confidence: number
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

/** Collapse the same KO seen by both players into one canonical scoring event. */
export function canonicalizeCombatEvidence(
  input: RawCombatEvidence[],
  clockToleranceSec = 4,
): CanonicalCombatEvent[] {
  const usable = input
    .filter((row) => row.killerProfileId && row.victimProfileId)
    .filter((row) => row.killerProfileId !== row.victimProfileId)
    .filter((row) => row.eventType !== 'assist')
    .filter((row) => Number.isFinite(Number(row.matchClockSec)))
    .sort((a, b) => {
      const pairA = `${a.killerProfileId}:${a.victimProfileId}`
      const pairB = `${b.killerProfileId}:${b.victimProfileId}`
      return pairA.localeCompare(pairB) || Number(a.matchClockSec) - Number(b.matchClockSec)
    })

  const clusters: RawCombatEvidence[][] = []
  for (const row of usable) {
    const previous = clusters.at(-1)
    const anchor = previous?.[0]
    const samePair = anchor
      && anchor.killerProfileId === row.killerProfileId
      && anchor.victimProfileId === row.victimProfileId
    const closeClock = samePair
      && Math.abs(Number(previous.at(-1)?.matchClockSec) - Number(row.matchClockSec)) <= clockToleranceSec
    if (previous && closeClock) previous.push(row)
    else clusters.push([row])
  }

  const verified: CanonicalCombatEvent[] = []
  for (const cluster of clusters) {
    const first = cluster[0]
    const sourceIds = unique(cluster.map((row) => row.sourceId))
    const ownerIds = unique(cluster.map((row) => row.sourceOwnerId))
    const hasKillerCamera = ownerIds.includes(first.killerProfileId)
    const hasVictimCamera = ownerIds.includes(first.victimProfileId)
    if (sourceIds.length < 2 || !hasKillerCamera || !hasVictimCamera) continue

    const clocks = cluster.map((row) => Number(row.matchClockSec))
    const confidence = cluster.reduce((sum, row) => sum + Math.max(0, Math.min(1, row.confidence)), 0)
      / cluster.length
    verified.push({
      // The attacking camera normally reports a KO while the victim's gray
      // defeat screen reports a death. They are two views of one scored KO.
      eventType: 'ko',
      killerProfileId: first.killerProfileId,
      victimProfileId: first.victimProfileId,
      matchClockSec: Math.round(clocks.reduce((sum, value) => sum + value, 0) / clocks.length),
      sourceIds,
      sourceOwnerIds: ownerIds,
      rawEventIds: unique(cluster.map((row) => row.id)),
      confidence,
    })
  }
  return verified
}

function normalizedTeam(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase()
}

function parsedScore(value: string | null | undefined): [number, number] | null {
  const match = String(value || '').match(/(\d+)\s*[-:]\s*(\d+)/)
  return match ? [Number(match[1]), Number(match[2])] : null
}

export function resultEvidenceCompatible(a: RawResultEvidence, b: RawResultEvidence): boolean {
  if (a.sourceId === b.sourceId || a.sourceOwnerId === b.sourceOwnerId) return false
  if (!a.explicitEvidence || !b.explicitEvidence || a.confidence < 0.85 || b.confidence < 0.85) return false

  const scoreA = parsedScore(a.scoreLine)
  const scoreB = parsedScore(b.scoreLine)
  if (scoreA && scoreB) {
    const same = scoreA[0] === scoreB[0] && scoreA[1] === scoreB[1]
    const reversed = scoreA[0] === scoreB[1] && scoreA[1] === scoreB[0]
    if (!same && !reversed) return false
  }

  if (a.outcome === 'draw' || b.outcome === 'draw') return a.outcome === 'draw' && b.outcome === 'draw'
  if (a.outcome !== b.outcome) return true
  const teamA = normalizedTeam(a.team)
  const teamB = normalizedTeam(b.team)
  return Boolean(teamA && teamB && teamA === teamB)
}

export function verifiedResultEvidence(rows: RawResultEvidence[]): Set<string> {
  const verified = new Set<string>()
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (!resultEvidenceCompatible(rows[i], rows[j])) continue
      verified.add(rows[i].id)
      verified.add(rows[j].id)
    }
  }
  return verified
}

type PlayerStats = {
  kills: number
  deaths: number
  assists: number
  outcome: 'victory' | 'defeat' | 'draw' | null
  outcomeVerification: 'shadow' | 'verified'
  sourceIds: Set<string>
  confidence: number
}

function emptyStats(): PlayerStats {
  return {
    kills: 0,
    deaths: 0,
    assists: 0,
    outcome: null,
    outcomeVerification: 'shadow',
    sourceIds: new Set<string>(),
    confidence: 0,
  }
}

/**
 * Rebuild the verified ledger for one match and then recompute affected power.
 * It is intentionally idempotent: rerunning analysis replaces canonical rows.
 */
export async function reconcileVerifiedMatchScoring(
  db: ScoringQueryable,
  matchGroupId: string,
): Promise<{ combatEvents: number; verifiedResults: number; affectedPlayers: string[] }> {
  const previousPlayers = (await db.query(
    'select profile_id from verified_match_player_stats where match_group_id=$1',
    [matchGroupId],
  )).rows.map((row) => String(row.profile_id))

  const combatRows = (await db.query(
    `select e.id,e.source_id,s.owner_id as source_owner_id,e.event_type,
            e.killer_profile_id,e.victim_profile_id,e.match_clock_sec,e.confidence
       from combat_events e
       join media_sources s on s.id=e.source_id
      where e.match_group_id=$1 and e.verification_status <> 'ambiguous'
        and e.killer_profile_id is not null and e.victim_profile_id is not null`,
    [matchGroupId],
  )).rows.map((row) => ({
    id: String(row.id),
    sourceId: String(row.source_id),
    sourceOwnerId: String(row.source_owner_id),
    eventType: String(row.event_type || 'ko') as RawCombatEvidence['eventType'],
    killerProfileId: String(row.killer_profile_id),
    victimProfileId: String(row.victim_profile_id),
    matchClockSec: row.match_clock_sec == null ? null : Number(row.match_clock_sec),
    confidence: Number(row.confidence || 0),
  }))
  const canonicalEvents = canonicalizeCombatEvidence(combatRows)

  const resultRows = (await db.query(
    `select r.id,r.source_id,s.owner_id as source_owner_id,r.outcome,r.team,r.score_line,
            r.kills,r.deaths,r.assists,r.explicit_evidence,r.confidence
       from match_result_observations r
       join media_sources s on s.id=r.source_id
      where r.match_group_id=$1 and r.verification_status <> 'ambiguous'`,
    [matchGroupId],
  )).rows.map((row) => ({
    id: String(row.id),
    sourceId: String(row.source_id),
    sourceOwnerId: String(row.source_owner_id),
    outcome: String(row.outcome) as RawResultEvidence['outcome'],
    team: row.team == null ? null : String(row.team),
    scoreLine: row.score_line == null ? null : String(row.score_line),
    kills: row.kills == null ? null : Number(row.kills),
    deaths: row.deaths == null ? null : Number(row.deaths),
    assists: row.assists == null ? null : Number(row.assists),
    explicitEvidence: Boolean(row.explicit_evidence),
    confidence: Number(row.confidence || 0),
  }))
  const verifiedResultIds = verifiedResultEvidence(resultRows)

  await db.query('delete from verified_combat_events where match_group_id=$1', [matchGroupId])
  await db.query('delete from verified_match_player_stats where match_group_id=$1', [matchGroupId])
  await db.query(
    `update combat_events set verification_status=case
       when killer_profile_id is not null and victim_profile_id is not null and confidence >= 0.75
         then 'single_camera' else 'candidate' end, updated_at=now()
      where match_group_id=$1 and verification_status <> 'ambiguous'`,
    [matchGroupId],
  )
  await db.query(
    `update match_result_observations set verification_status=case
       when explicit_evidence and confidence >= 0.85 then 'single_camera' else 'candidate' end,
       updated_at=now() where match_group_id=$1 and verification_status <> 'ambiguous'`,
    [matchGroupId],
  )

  const stats = new Map<string, PlayerStats>()
  for (const event of canonicalEvents) {
    await db.query(
      `insert into verified_combat_events
         (match_group_id,event_type,killer_profile_id,victim_profile_id,match_clock_sec,
          source_ids,source_owner_ids,raw_event_ids,evidence_count,confidence)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        matchGroupId, event.eventType, event.killerProfileId, event.victimProfileId,
        event.matchClockSec, event.sourceIds, event.sourceOwnerIds, event.rawEventIds,
        event.rawEventIds.length, event.confidence,
      ],
    )
    for (const rawId of event.rawEventIds) {
      await db.query(
        `update combat_events set verification_status='verified', updated_at=now() where id=$1`,
        [rawId],
      )
    }
    const killer = stats.get(event.killerProfileId) || emptyStats()
    killer.kills++
    event.sourceIds.forEach((id) => killer.sourceIds.add(id))
    killer.confidence = Math.max(killer.confidence, event.confidence)
    stats.set(event.killerProfileId, killer)

    const victim = stats.get(event.victimProfileId) || emptyStats()
    victim.deaths++
    event.sourceIds.forEach((id) => victim.sourceIds.add(id))
    victim.confidence = Math.max(victim.confidence, event.confidence)
    stats.set(event.victimProfileId, victim)
  }

  for (const result of resultRows) {
    if (!verifiedResultIds.has(result.id)) continue
    await db.query(
      `update match_result_observations set verification_status='verified', updated_at=now() where id=$1`,
      [result.id],
    )
    const player = stats.get(result.sourceOwnerId) || emptyStats()
    player.outcome = result.outcome
    player.outcomeVerification = 'verified'
    player.kills = result.kills == null ? player.kills : Math.max(0, result.kills)
    player.deaths = result.deaths == null ? player.deaths : Math.max(0, result.deaths)
    player.assists = result.assists == null ? player.assists : Math.max(0, result.assists)
    player.sourceIds.add(result.sourceId)
    player.confidence = Math.max(player.confidence, result.confidence)
    stats.set(result.sourceOwnerId, player)
  }

  await db.query(
    `update clip_records set score_verification_status='shadow',
        kills=null,deaths=null,assists=null,outcome=null
      where match_id=$1 and source_id is not null`,
    [matchGroupId],
  )
  for (const [profileId, player] of stats.entries()) {
    await db.query(
      `insert into verified_match_player_stats
         (match_group_id,profile_id,kills,deaths,assists,outcome,outcome_verification,
          source_count,confidence,evidence,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())
       on conflict (match_group_id,profile_id) do update set
         kills=excluded.kills,deaths=excluded.deaths,assists=excluded.assists,
         outcome=excluded.outcome,outcome_verification=excluded.outcome_verification,
         source_count=excluded.source_count,confidence=excluded.confidence,
         evidence=excluded.evidence,updated_at=now()`,
      [
        matchGroupId, profileId, player.kills, player.deaths, player.assists,
        player.outcome, player.outcomeVerification, player.sourceIds.size, player.confidence,
        JSON.stringify({ source_ids: [...player.sourceIds], canonical_combat: true }),
      ],
    )
    await db.query(
      `update clip_records set kills=$3,deaths=$4,assists=$5,
          outcome=case when $6='verified' then $7 else outcome end,
          score_verification_status=case when $6='verified' then 'verified' else score_verification_status end
        where match_id=$1 and player_id=$2`,
      [
        matchGroupId, profileId, player.kills, player.deaths, player.assists,
        player.outcomeVerification, player.outcome,
      ],
    )
  }

  const affectedPlayers = unique([...previousPlayers, ...stats.keys()])
  for (const profileId of affectedPlayers) await recomputePower(db, profileId)
  return {
    combatEvents: canonicalEvents.length,
    verifiedResults: verifiedResultIds.size,
    affectedPlayers,
  }
}
