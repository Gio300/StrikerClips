import { normalizeGameAlias } from './matchDetection'
import { reconcileVerifiedMatchScoring } from './verifiedScoring'

export type IdentityQueryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

export type AliasEvidenceDecision = {
  status: 'candidate' | 'verified' | 'ambiguous'
  confidence: number
  reason: string
}

export type OwnedAliasEvidence = {
  sourceId: string
  evidenceType: string
  accountOwned: boolean
  confidence: number
}

const AUTO_VERIFY_CONFIDENCE = 0.85

export function decideAliasPromotion(
  evidence: OwnedAliasEvidence[],
  hasConflictingOwner: boolean,
): AliasEvidenceDecision {
  if (hasConflictingOwner) {
    return { status: 'ambiguous', confidence: 0, reason: 'alias overlaps another verified member' }
  }
  const strongOwned = evidence.filter((item) => item.accountOwned && item.confidence >= AUTO_VERIFY_CONFIDENCE)
  const distinctSources = new Set(strongOwned.map((item) => item.sourceId)).size
  const explicit = strongOwned.some((item) => item.evidenceType === 'account_confirmation' || item.evidenceType === 'platform_account')
  if (explicit) {
    return { status: 'verified', confidence: Math.max(...strongOwned.map((item) => item.confidence)), reason: 'member confirmed the alias' }
  }
  if (distinctSources >= 2) {
    const confidence = strongOwned.reduce((sum, item) => sum + item.confidence, 0) / strongOwned.length
    return { status: 'verified', confidence, reason: 'alias appeared in two independent member-owned sources' }
  }
  return {
    status: 'candidate',
    confidence: strongOwned.length ? Math.max(...strongOwned.map((item) => item.confidence)) : 0,
    reason: 'waiting for a second member-owned source',
  }
}

export type AliasResolution = {
  status: 'resolved' | 'unresolved' | 'ambiguous'
  profileId: string | null
  aliasId: string | null
  confidence: number
}

export async function resolveMemberAlias(
  db: IdentityQueryable,
  displayAlias: string,
  observedAt: Date | string,
  game = 'shinobi_striker',
): Promise<AliasResolution> {
  const normalized = normalizeGameAlias(displayAlias)
  if (!normalized) return { status: 'unresolved', profileId: null, aliasId: null, confidence: 0 }
  const rows = (await db.query(
    `select id, profile_id, confidence
       from player_aliases
      where game=$1 and normalized_alias=$2 and status='verified'
        and valid_from <= $3
        and (valid_to is null or valid_to > $3)
      order by confidence desc, verified_at desc nulls last`,
    [game, normalized, new Date(observedAt).toISOString()],
  )).rows
  const profileIds = [...new Set(rows.map((row) => String(row.profile_id)))]
  if (profileIds.length > 1) return { status: 'ambiguous', profileId: null, aliasId: null, confidence: 0 }
  if (!rows.length) return { status: 'unresolved', profileId: null, aliasId: null, confidence: 0 }
  return {
    status: 'resolved',
    profileId: String(rows[0].profile_id),
    aliasId: String(rows[0].id),
    confidence: Number(rows[0].confidence || 0),
  }
}

async function refreshSegmentResolution(db: IdentityQueryable, segmentId: string): Promise<void> {
  const rows = (await db.query(
    `select distinct resolved_profile_id
       from match_member_observations
      where segment_id=$1 and resolution_status='resolved' and resolved_profile_id is not null`,
    [segmentId],
  )).rows
  const ids = rows.map((row) => String(row.resolved_profile_id))
  await db.query(
    `update match_segments
        set resolved_member_ids=$2, member_vs_member=$3, updated_at=now()
      where id=$1`,
    [segmentId, ids, ids.length >= 2],
  )
}

async function backfillAliasObservations(
  db: IdentityQueryable,
  profileId: string,
  normalizedAlias: string,
  validFrom: string,
  validTo: string | null,
): Promise<void> {
  const params: unknown[] = [profileId, normalizedAlias, validFrom]
  let range = `observed_at >= $3`
  if (validTo) {
    params.push(validTo)
    range += ` and observed_at < $4`
  }
  const updated = (await db.query(
    `update match_member_observations
        set resolved_profile_id=$1, resolution_status='resolved',
            updated_at=now()
      where normalized_alias=$2 and ${range}
        and resolution_status <> 'ambiguous'
      returning segment_id`,
    params,
  )).rows
  for (const segmentId of new Set(updated.map((row) => String(row.segment_id)))) {
    await refreshSegmentResolution(db, segmentId)
  }
}

async function backfillAliasCombatEvents(
  db: IdentityQueryable,
  profileId: string,
  normalizedAlias: string,
  validFrom: string,
  validTo: string | null,
): Promise<void> {
  const fromMs = new Date(validFrom).getTime()
  const toMs = validTo ? new Date(validTo).getTime() : Number.POSITIVE_INFINITY
  const events = (await db.query(
    `select e.id,e.killer_alias,e.victim_alias,e.killer_profile_id,e.victim_profile_id,
            e.confidence,e.match_group_id,e.at_sec,s.recorded_at,s.created_at as source_created_at
       from combat_events e
       join media_sources s on s.id=e.source_id
      where (e.killer_profile_id is null and e.killer_alias is not null)
         or (e.victim_profile_id is null and e.victim_alias is not null)`,
  )).rows
  const affectedMatches = new Set<string>()
  for (const event of events) {
    const baseMs = new Date(event.recorded_at || event.source_created_at || 0).getTime()
    const eventMs = baseMs + Math.max(0, Number(event.at_sec) || 0) * 1_000
    if (!Number.isFinite(eventMs) || eventMs < fromMs || eventMs >= toMs) continue

    const killerMatches = !event.killer_profile_id
      && normalizeGameAlias(String(event.killer_alias || '')) === normalizedAlias
    const victimMatches = !event.victim_profile_id
      && normalizeGameAlias(String(event.victim_alias || '')) === normalizedAlias
    if (!killerMatches && !victimMatches) continue
    const killerProfileId = event.killer_profile_id || (killerMatches ? profileId : null)
    const victimProfileId = event.victim_profile_id || (victimMatches ? profileId : null)
    const verificationStatus = killerProfileId && victimProfileId && killerProfileId !== victimProfileId
      && Number(event.confidence || 0) >= 0.75
      ? 'single_camera'
      : 'candidate'
    await db.query(
      `update combat_events
          set killer_profile_id=$2,victim_profile_id=$3,verification_status=$4,updated_at=now()
        where id=$1`,
      [event.id, killerProfileId, victimProfileId, verificationStatus],
    )
    if (event.match_group_id) affectedMatches.add(String(event.match_group_id))
  }
  for (const matchGroupId of affectedMatches) {
    await reconcileVerifiedMatchScoring(db, matchGroupId)
  }
}

export type ObserveOwnedAliasInput = {
  profileId: string
  sourceId: string
  segmentId?: string | null
  displayAlias: string
  observedAt: Date | string
  confidence: number
  evidenceType?: 'owned_hud' | 'account_confirmation' | 'platform_account'
  evidence?: Record<string, unknown>
  game?: string
}

export async function observeOwnedAlias(
  db: IdentityQueryable,
  input: ObserveOwnedAliasInput,
): Promise<{ aliasId: string; decision: AliasEvidenceDecision; normalizedAlias: string }> {
  const game = input.game || 'shinobi_striker'
  const displayAlias = String(input.displayAlias || '').trim()
  const normalizedAlias = normalizeGameAlias(displayAlias)
  if (normalizedAlias.length < 2 || normalizedAlias.length > 48) throw new Error('invalid in-game alias')
  const observedAt = new Date(input.observedAt).toISOString()
  const source = (await db.query('select owner_id from media_sources where id=$1', [input.sourceId])).rows[0]
  if (!source || String(source.owner_id) !== input.profileId) {
    throw new Error('alias evidence must come from the member\'s own source')
  }

  let alias = (await db.query(
    `select * from player_aliases
      where profile_id=$1 and game=$2 and normalized_alias=$3
        and status in ('candidate','verified','ambiguous')
      order by is_primary desc, last_seen_at desc limit 1`,
    [input.profileId, game, normalizedAlias],
  )).rows[0]
  if (!alias) {
    alias = (await db.query(
      `insert into player_aliases
         (profile_id,game,display_alias,normalized_alias,status,valid_from,confidence,
          is_primary,first_seen_at,last_seen_at)
       values ($1,$2,$3,$4,'candidate',$5,0,false,$5,$5) returning *`,
      [input.profileId, game, displayAlias, normalizedAlias, observedAt],
    )).rows[0]
  } else {
    alias = (await db.query(
      `update player_aliases
          set display_alias=$2,
              first_seen_at=case when first_seen_at <= $3 then first_seen_at else $3 end,
              last_seen_at=case when last_seen_at >= $3 then last_seen_at else $3 end,
              updated_at=now()
        where id=$1 returning *`,
      [alias.id, displayAlias, observedAt],
    )).rows[0]
  }

  const evidenceType = input.evidenceType || 'owned_hud'
  const confidence = Math.max(0, Math.min(1, Number(input.confidence) || 0))
  await db.query(
    `insert into player_alias_evidence
       (alias_id,source_id,segment_id,evidence_type,account_owned,confidence,observed_at,evidence)
     values ($1,$2,$3,$4,true,$5,$6,$7::jsonb)
     on conflict (alias_id,source_id,evidence_type) do update set
       segment_id=coalesce(excluded.segment_id,player_alias_evidence.segment_id),
       confidence=greatest(player_alias_evidence.confidence,excluded.confidence),
       observed_at=case
         when player_alias_evidence.observed_at <= excluded.observed_at
           then player_alias_evidence.observed_at else excluded.observed_at end,
       evidence=excluded.evidence`,
    [alias.id, input.sourceId, input.segmentId || null, evidenceType, confidence, observedAt, JSON.stringify(input.evidence || {})],
  )

  const evidence = (await db.query(
    `select source_id, evidence_type, account_owned, confidence
       from player_alias_evidence where alias_id=$1`,
    [alias.id],
  )).rows.map((row) => ({
    sourceId: String(row.source_id),
    evidenceType: String(row.evidence_type),
    accountOwned: Boolean(row.account_owned),
    confidence: Number(row.confidence || 0),
  }))
  const effectiveFrom = new Date(alias.valid_from).toISOString()
  const conflicting = (await db.query(
    `select id from player_aliases
      where game=$1 and normalized_alias=$2 and profile_id <> $3 and status='verified'
        and valid_from <= $4 and (valid_to is null or valid_to > $4)
      limit 1`,
    [game, normalizedAlias, input.profileId, effectiveFrom],
  )).rows.length > 0
  const decision = decideAliasPromotion(evidence, conflicting)

  let validTo: string | null = null
  let isPrimary = false
  if (decision.status === 'verified') {
    const current = (await db.query(
      `select id, valid_from from player_aliases
        where profile_id=$1 and game=$2 and is_primary=true and status='verified' and id <> $3
        order by valid_from desc limit 1`,
      [input.profileId, game, alias.id],
    )).rows[0]
    if (!current || new Date(effectiveFrom).getTime() >= new Date(current.valid_from).getTime()) {
      isPrimary = true
      await db.query(
        `update player_aliases
            set valid_to=$3, status='retired', is_primary=false, updated_at=now()
          where profile_id=$1 and game=$2 and is_primary=true and status='verified'
            and id <> $4 and valid_from <= $3`,
        [input.profileId, game, effectiveFrom, alias.id],
      )
    } else {
      validTo = new Date(current.valid_from).toISOString()
    }
  }

  alias = (await db.query(
    `update player_aliases
        set status=$2, confidence=$3, is_primary=$4, valid_to=$5,
            verified_at=case when $2='verified' then coalesce(verified_at,now()) else verified_at end,
            updated_at=now()
      where id=$1 returning *`,
    [alias.id, decision.status, decision.confidence, isPrimary, validTo],
  )).rows[0]
  if (decision.status === 'verified') {
    await backfillAliasObservations(
      db,
      input.profileId,
      normalizedAlias,
      new Date(alias.valid_from).toISOString(),
      alias.valid_to ? new Date(alias.valid_to).toISOString() : null,
    )
    await backfillAliasCombatEvents(
      db,
      input.profileId,
      normalizedAlias,
      new Date(alias.valid_from).toISOString(),
      alias.valid_to ? new Date(alias.valid_to).toISOString() : null,
    )
  }
  return { aliasId: String(alias.id), decision, normalizedAlias }
}
