export type PowerQueryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>
}

export const POWER_WIN = 250
export const POWER_LOSS = 75
export const POWER_UPLOAD = 100
export const POWER_PRODUCED = 150
export const POWER_VERIFIED_KO = 25
export const POWER_VERIFIED_ASSIST = 10
export const POWER_VERIFIED_DEATH = 10
export const POWER_DETECTED_PARTICIPATION = 100
export const MIN_DETECTED_BOUNDARY_CONFIDENCE = 0.7
export const MIN_DETECTED_BATTLE_SECONDS = 60

type ScoredClip = {
  id: unknown
  match_id?: unknown
  outcome?: unknown
  composite_youtube_id?: unknown
  score_verification_status?: unknown
}

/** Recompute power once per verified match, not once per camera angle. */
export async function recomputePower(db: PowerQueryable, playerId: string): Promise<number> {
  if (!playerId) return 0
  try {
    const clips = (await db.query(
      `select id,match_id,outcome,composite_youtube_id,
              coalesce(score_verification_status,'legacy') as score_verification_status
         from clip_records where player_id=$1`,
      [playerId],
    )).rows as ScoredClip[]

    // A neutral participation award is allowed for a system-detected battle on
    // the player's own connected YouTube footage. The joins are deliberate:
    // browser rows cannot mint a source/segment, and screenshots/direct uploads
    // do not satisfy this provenance check. Outcomes and combat stats from
    // these single-camera detections remain unscored until separately verified.
    let detectedParticipation = 0
    try {
      const detected = await db.query(
        `select distinct cr.segment_id
           from clip_records cr
           join media_sources s on s.id=cr.source_id and s.owner_id=cr.player_id
           join match_segments ms on ms.id=cr.segment_id and ms.source_id=s.id
          where cr.player_id=$1
            and coalesce(cr.score_verification_status,'legacy')='shadow'
            and s.provider='youtube'
            and s.source_kind in ('youtube_upload','youtube_live')
            and s.status='complete'
            and cr.youtube_id is not null
            and cr.youtube_id=s.external_id
            and ms.boundary_confidence >= $2
            and (ms.end_sec - ms.start_sec) >= $3`,
        [playerId, MIN_DETECTED_BOUNDARY_CONFIDENCE, MIN_DETECTED_BATTLE_SECONDS],
      )
      detectedParticipation = detected.rows.length
    } catch {
      // Older/slim schemas do not have the evidence tables. They simply cannot
      // earn this new award; verified/produced scoring below still works.
      detectedParticipation = 0
    }

    const outcomesByMatch = new Map<string, Set<string>>()
    const produced = new Set<string>()
    for (const clip of clips) {
      const compositeId = String(clip.composite_youtube_id || '').trim()
      if (compositeId) produced.add(compositeId)

      // Legacy rows came from the retired browser/screenshot flow and are not
      // scoring evidence. Only canonical verified rows can carry outcomes.
      if (String(clip.score_verification_status || 'legacy') !== 'verified') continue
      const id = String(clip.id || '').trim()
      if (!id) continue
      const matchId = String(clip.match_id || '').trim()
      const scoreKey = matchId ? `match:${matchId}` : `clip:${id}`
      const outcomes = outcomesByMatch.get(scoreKey) || new Set<string>()
      const outcome = String(clip.outcome || '').trim().toLowerCase()
      if (outcome === 'victory' || outcome === 'defeat' || outcome === 'draw') outcomes.add(outcome)
      outcomesByMatch.set(scoreKey, outcomes)
    }

    let wins = 0
    let losses = 0
    let neutral = 0
    for (const outcomes of outcomesByMatch.values()) {
      if (outcomes.size === 1 && outcomes.has('victory')) wins++
      else if (outcomes.size === 1 && outcomes.has('defeat')) losses++
      else neutral++
    }

    let oraclePoints = 0
    try {
      const profile = await db.query(
        'select coalesce(oracle_points,0)::int as pts from profiles where id=$1',
        [playerId],
      )
      oraclePoints = Number(profile.rows[0]?.pts ?? 0)
    } catch {
      oraclePoints = 0
    }

    // Canonical player stats are written only after independent camera
    // evidence agrees. Reading this table prevents duplicate angles and
    // single-camera guesses from changing public power.
    let verifiedKills = 0
    let verifiedDeaths = 0
    let verifiedAssists = 0
    try {
      const verified = await db.query(
        `select coalesce(sum(kills),0)::int as kills,
                coalesce(sum(deaths),0)::int as deaths,
                coalesce(sum(assists),0)::int as assists
           from verified_match_player_stats where profile_id=$1`,
        [playerId],
      )
      verifiedKills = Math.max(0, Number(verified.rows[0]?.kills ?? 0))
      verifiedDeaths = Math.max(0, Number(verified.rows[0]?.deaths ?? 0))
      verifiedAssists = Math.max(0, Number(verified.rows[0]?.assists ?? 0))
    } catch {
      // Older/test schemas can predate canonical scoring. Their legacy power
      // path remains valid until the media-evidence migration is present.
    }

    if (
      wins + losses + neutral + produced.size + detectedParticipation === 0
      && oraclePoints === 0
      && verifiedKills + verifiedDeaths + verifiedAssists === 0
    ) {
      const current = await db.query(
        'select coalesce(power_level,0)::int as p from profiles where id=$1',
        [playerId],
      )
      return Number(current.rows[0]?.p ?? 0)
    }

    const power = Math.max(
      0,
      wins * POWER_WIN
        - losses * POWER_LOSS
        + neutral * POWER_UPLOAD
        + produced.size * POWER_PRODUCED
        + verifiedKills * POWER_VERIFIED_KO
        + verifiedAssists * POWER_VERIFIED_ASSIST
        - verifiedDeaths * POWER_VERIFIED_DEATH
        + detectedParticipation * POWER_DETECTED_PARTICIPATION
        + oraclePoints,
    )
    await db.query('update profiles set power_level=$1 where id=$2', [power, playerId])
    return power
  } catch {
    return 0
  }
}
