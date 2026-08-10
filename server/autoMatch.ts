/* eslint-disable @typescript-eslint/no-explicit-any */
// ===========================================================================
// AUTO-MATCH ORCHESTRATION (server side)
//
// The product's headline loop: strangers upload their own angles of one match,
// and the system figures out — with no human curation — that they belong
// together, bunches them, and kicks off assembling one multi-angle video.
//
// This module is the BRAIN of that loop (the render/upload muscle is
// server/renderWorker.ts). When a clip's analysis row lands, `runAutoMatch`:
//   1. pulls candidate clips in a time neighbourhood,
//   2. rejects contradictory identity evidence, then groups compatible angles,
//   3. if ≥2 angles of one match are found, records a `match_groups` row and
//      stamps every clip's `match_id`,
//   4. enqueues exactly ONE `render_jobs` row for that canonical match/version,
//   5. notifies every participant that their match is being assembled.
//
// It is pure orchestration over the pool + the grouping engine, so it unit-tests
// against pg-mem with no video, no ffmpeg, no network.
// ===========================================================================
import {
  groupClipsByMatch,
  normalizeHandle,
  participantsOf,
  type ClipMeta,
  type MatchGroup,
} from '../src/lib/matchGrouping'
import { normalizeReelUsePrivacy } from '../src/lib/reelPrivacy'
import { canUsePlayerReels } from './reelPrivacy'

type Pool = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }

// Normal clips look 30 minutes ahead. A bounded 12-hour lookback admits console
// recordings that began before the analyzed segment; strict evidence checks do
// the precise work after this indexed SQL prefilter.
const CANDIDATE_WINDOW_MS = 30 * 60_000
const MAX_SOURCE_DURATION_MS = 12 * 60 * 60_000
const MATCH_TIME_TOLERANCE_MS = 3 * 60_000
const DURATION_TOLERANCE_SEC = 90
const AMBIGUITY_SCORE_MARGIN = 5
const TARGET_PLAYER_COUNT = 4
const PARTIAL_GROUP_SETTLE_MS = 45 * 60_000
const FULL_GROUP_SETTLE_MS = 5 * 60_000

export interface AutoMatchResult {
  matched: boolean
  matchId?: string // match_groups.id (uuid)
  matchKey?: string // deterministic engine id (m_xxxxxxxx)
  clipCount: number
  jobId?: string
  jobAlreadyExisted?: boolean
  notified: number
  reason?: string
}

function rowTime(r: any): number | undefined {
  const v = r.recorded_at ?? r.created_at
  if (!v) return undefined
  const time = new Date(v).getTime()
  return Number.isFinite(time) ? time : undefined
}

/** Map a clip_records row to the grouping engine's ClipMeta shape. */
function rowToClipMeta(r: any): ClipMeta {
  return {
    clipId: String(r.id),
    playerId: String(r.player_handle || r.player_id || r.id),
    participants: Array.isArray(r.participants) ? r.participants.map(String) : undefined,
    lobbyId: r.lobby_id ? String(r.lobby_id) : undefined,
    recordedAt: rowTime(r),
    durationSec: r.duration_sec != null ? Number(r.duration_sec) : undefined,
    resultSignature: {
      outcome: r.outcome || undefined,
      kills: r.kills != null ? Number(r.kills) : undefined,
      deaths: r.deaths != null ? Number(r.deaths) : undefined,
      assists: r.assists != null ? Number(r.assists) : undefined,
      map: r.map || undefined,
      mode: r.mode || undefined,
      scoreLine: r.score_line || undefined,
    },
  }
}

function playerKey(row: any): string {
  if (row.player_id) return `id:${String(row.player_id)}`
  return `handle:${String(row.player_handle || row.id).trim().toLowerCase()}`
}

function sourceKey(row: any): string {
  if (row.youtube_id) return `youtube:${normalizeHandle(String(row.youtube_id))}`
  if (row.clip_id) return `clip:${String(row.clip_id)}`
  return `record:${String(row.id)}`
}

/** One source per actual player, and one actual camera source per angle. */
function distinctPlayerRows(rows: any[], triggerId: string): any[] {
  const byPlayer = new Map<string, any>()
  for (const row of rows) {
    const key = playerKey(row)
    if (!byPlayer.has(key) || String(row.id) === triggerId) byPlayer.set(key, row)
  }
  const bySource = new Map<string, any>()
  for (const row of byPlayer.values()) {
    const key = sourceKey(row)
    if (!bySource.has(key) || String(row.id) === triggerId) bySource.set(key, row)
  }
  return [...bySource.values()]
}

function normalizedValue(value: unknown): string | undefined {
  if (value == null) return undefined
  const normalized = normalizeHandle(String(value))
  return normalized || undefined
}

function explicitMatchKey(row: any): string | undefined {
  return normalizedValue(
    row.game_match_id
      ?? row.platform_match_id
      ?? row.external_match_id
      ?? row.source_match_id
      ?? row.match_key,
  )
}

function normalizeScore(value: unknown): string | undefined {
  const raw = normalizedValue(value)
  if (!raw) return undefined
  const numbers = raw.match(/\d+/g)
  return numbers && numbers.length >= 2 ? numbers.join('-') : raw
}

function scoresCompatible(a: unknown, b: unknown): boolean {
  const left = normalizeScore(a)
  const right = normalizeScore(b)
  if (!left || !right || left === right) return true
  const l = left.split('-')
  const r = right.split('-')
  return l.length === 2 && r.length === 2 && l[0] === r[1] && l[1] === r[0]
}

function outcomesCompatible(a: unknown, b: unknown): boolean {
  const left = normalizedValue(a)
  const right = normalizedValue(b)
  if (!left || !right) return true
  return (left === 'draw') === (right === 'draw')
}

function rowParticipants(row: any): Set<string> {
  return new Set(participantsOf(rowToClipMeta(row)))
}

function sharedPlayerCount(a: any, b: any): number {
  const right = rowParticipants(b)
  let count = 0
  for (const participant of rowParticipants(a)) {
    if (right.has(participant)) count++
  }
  return count
}

function rowWindow(row: any): { start: number; end: number } | undefined {
  const start = rowTime(row)
  if (start == null) return undefined
  const seconds = Number(row.duration_sec)
  const duration = Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, MAX_SOURCE_DURATION_MS)
    : 0
  return { start, end: start + duration }
}

function timeEvidence(a: any, b: any): { compatible: boolean; score: number } {
  const left = rowWindow(a)
  const right = rowWindow(b)
  if (!left || !right) return { compatible: false, score: 0 }
  const gap = Math.max(left.start, right.start) - Math.min(left.end, right.end)
  if (gap > MATCH_TIME_TOLERANCE_MS) return { compatible: false, score: 0 }
  const startsNear = Math.abs(left.start - right.start) <= MATCH_TIME_TOLERANCE_MS
  return { compatible: true, score: startsNear ? 8 : 3 }
}

function structuralConflict(a: any, b: any): string | undefined {
  if (a.match_id && b.match_id && String(a.match_id) !== String(b.match_id)) return 'match id'

  const externalA = explicitMatchKey(a)
  const externalB = explicitMatchKey(b)
  if (externalA && externalB && externalA !== externalB) return 'platform match id'

  for (const [field, label] of [
    ['lobby_id', 'lobby'],
    ['map', 'map'],
    ['mode', 'mode'],
  ] as const) {
    const left = normalizedValue(a[field])
    const right = normalizedValue(b[field])
    if (left && right && left !== right) return label
  }

  if (!scoresCompatible(a.score_line, b.score_line)) return 'score'
  if (!outcomesCompatible(a.outcome, b.outcome)) return 'outcome'
  return undefined
}

interface PairEvidence {
  qualifies: boolean
  score: number
  conflict?: string
}

/**
 * Server-side identity is deliberately stricter than the client suggestion
 * engine. Every explicit contradiction vetoes the pair, and long/partial
 * duration mismatches need several independent corroborating signals.
 */
function compareIdentityEvidence(a: any, b: any): PairEvidence {
  const conflict = structuralConflict(a, b)
  if (conflict) return { qualifies: false, score: 0, conflict }

  const time = timeEvidence(a, b)
  if (!time.compatible) return { qualifies: false, score: 0, conflict: 'clock/time' }

  const sameCanonicalMatch = !!a.match_id && !!b.match_id && String(a.match_id) === String(b.match_id)
  const externalA = explicitMatchKey(a)
  const externalB = explicitMatchKey(b)
  const sameExternalMatch = !!externalA && externalA === externalB
  const lobbyA = normalizedValue(a.lobby_id)
  const lobbyB = normalizedValue(b.lobby_id)
  const sameLobby = !!lobbyA && lobbyA === lobbyB
  const sharedPlayers = sharedPlayerCount(a, b)

  if (!sameCanonicalMatch && !sameExternalMatch && !sameLobby && sharedPlayers === 0) {
    return { qualifies: false, score: 0 }
  }

  const sameMap = !!normalizedValue(a.map) && normalizedValue(a.map) === normalizedValue(b.map)
  const sameMode = !!normalizedValue(a.mode) && normalizedValue(a.mode) === normalizedValue(b.mode)
  const bothHaveScore = !!normalizeScore(a.score_line) && !!normalizeScore(b.score_line)
  const bothHaveOutcome = !!normalizedValue(a.outcome) && !!normalizedValue(b.outcome)
  const durationA = Number(a.duration_sec)
  const durationB = Number(b.duration_sec)
  const durationMismatch = Number.isFinite(durationA)
    && durationA > 0
    && Number.isFinite(durationB)
    && durationB > 0
    && Math.abs(durationA - durationB) > DURATION_TOLERANCE_SEC

  const supplementalMatches = Number(sameMap)
    + Number(sameMode)
    + Number(bothHaveScore)
    + Number(sharedPlayers > 0)
  const partialStronglyIdentified = sameCanonicalMatch
    || sameExternalMatch
    || (sameLobby && supplementalMatches >= 2)
    || (sharedPlayers >= 2 && supplementalMatches >= 3)
  if (durationMismatch && !partialStronglyIdentified) {
    return { qualifies: false, score: 0 }
  }

  let score = time.score
  if (sameCanonicalMatch) score += 100
  if (sameExternalMatch) score += 40
  if (sameLobby) score += 16
  score += Math.min(sharedPlayers, 2) * 4
  if (sameMap) score += 3
  if (sameMode) score += 3
  if (bothHaveScore) score += 4
  if (bothHaveOutcome) score += 1
  if (!durationMismatch && durationA > 0 && durationB > 0) score += 2
  return { qualifies: true, score }
}

function conflictingGroupEvidence(rows: any[]): string | undefined {
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const conflict = structuralConflict(rows[i], rows[j])
      if (conflict) return conflict
      if (!timeEvidence(rows[i], rows[j]).compatible) return 'clock/time'
    }
  }
  return undefined
}

function hashIdentity(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `m_${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function fallbackMatchGroup(rows: any[]): MatchGroup {
  const clips = rows
    .map(rowToClipMeta)
    .sort((a, b) => (a.recordedAt ?? 0) - (b.recordedAt ?? 0) || a.clipId.localeCompare(b.clipId))
  const counts = new Map<string, number>()
  for (const clip of clips) {
    for (const participant of participantsOf(clip)) {
      counts.set(participant, (counts.get(participant) ?? 0) + 1)
    }
  }
  const sharedParticipants = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([participant]) => participant)
    .sort()
  const starts = rows.map(rowTime).filter((value): value is number => value != null)
  const ends = rows
    .map(rowWindow)
    .filter((value): value is { start: number; end: number } => !!value)
    .map((window) => window.end)
  const first = rows
    .slice()
    .sort((a, b) => (rowTime(a) ?? 0) - (rowTime(b) ?? 0) || String(a.id).localeCompare(String(b.id)))[0]
  const identity = [
    String(first.id),
    explicitMatchKey(first) ?? '',
    normalizedValue(first.lobby_id) ?? '',
    normalizedValue(first.map) ?? '',
    normalizedValue(first.mode) ?? '',
  ].join('|')
  return {
    matchId: hashIdentity(identity),
    clips,
    confidence: 0.9,
    sharedParticipants,
    timeWindow: {
      startMs: starts.length ? Math.min(...starts) : 0,
      endMs: ends.length ? Math.max(...ends) : 0,
    },
  }
}

function buildNewMatchGroup(rows: any[], triggerId: string): MatchGroup {
  const groups = groupClipsByMatch(rows.map(rowToClipMeta), {
    durationToleranceMs: Number.MAX_SAFE_INTEGER,
  })
  const group = groups.find((candidate) =>
    candidate.clips.some((clip) => clip.clipId === triggerId)
      && candidate.clips.length === rows.length,
  )
  return group ?? fallbackMatchGroup(rows)
}

function collectionDeadline(playerCount: number): string {
  const settleMs = playerCount >= TARGET_PLAYER_COUNT
    ? FULL_GROUP_SETTLE_MS
    : PARTIAL_GROUP_SETTLE_MS
  return new Date(Date.now() + settleMs).toISOString()
}

function sameIds(a: unknown, b: string[]): boolean {
  const left = Array.isArray(a) ? a.map(String).sort() : []
  const right = [...b].map(String).sort()
  return left.length === right.length && left.every((id, index) => id === right[index])
}

async function refreshRenderJob(
  pool: Pool,
  job: any,
  clipIds: string[],
  participantIds: string[],
  readyAt: string,
  allowReopen: boolean,
): Promise<void> {
  const clipsChanged = !sameIds(job.clip_ids, clipIds)
  const rosterChanged = !sameIds(job.participant_ids, participantIds)
  if (!clipsChanged && !rosterChanged) return

  const status = String(job.status || 'pending')
  if (status === 'pending') {
    // A replacement upload from an already represented player is a better
    // source for the SAME canonical version, not a reason to create another
    // version or restart the collection window.
    if (!rosterChanged) {
      await pool.query(
        `update render_jobs set clip_ids=$1, updated_at=now() where id=$2`,
        [clipIds, job.id],
      )
      return
    }
    if (!allowReopen) return
    await pool.query(
      `update render_jobs
          set clip_ids=$1, participant_ids=$2, ready_at=$3,
              rerender_requested=false, updated_at=now()
        where id=$4`,
      [clipIds, participantIds, readyAt, job.id],
    )
    return
  }
  if (!rosterChanged || !allowReopen) return
  if (status === 'rendering' || status === 'uploading') {
    await pool.query(
      `update render_jobs
          set clip_ids=$1, participant_ids=$2, ready_at=$3,
              rerender_requested=true, updated_at=now()
        where id=$4`,
      [clipIds, participantIds, readyAt, job.id],
    )
    return
  }

  // A finished/failed pair gained another player. Reuse the row but create a
  // fuller output, replacing the app-visible composite for every participant.
  await pool.query(
    `update render_jobs
        set status='pending', clip_ids=$1, participant_ids=$2, ready_at=$3,
            rerender_requested=false, youtube_id=null, combined_video_url=null,
            error=null, attempts=0, updated_at=now()
      where id=$4`,
    [clipIds, participantIds, readyAt, job.id],
  )
}

/**
 * Run auto-match for one freshly-analyzed clip record. Returns a summary; never
 * throws for the "no match yet" case (a lone clip is normal and just waits for
 * its co-stars). Safe to call again for the same clip — it's idempotent.
 */
export async function runAutoMatch(pool: Pool, triggerClipRecordId: string): Promise<AutoMatchResult> {
  const trg = await pool.query('select * from clip_records where id=$1', [triggerClipRecordId])
  const trigger = trg.rows[0]
  if (!trigger) return { matched: false, clipCount: 0, notified: 0, reason: 'clip record not found' }
  if (trigger.player_id) {
    const pref = await pool.query(
      'select auto_merge_opt_out,reel_usage_privacy from profiles where id=$1',
      [trigger.player_id],
    )
    if (pref.rows[0]?.auto_merge_opt_out) {
      return { matched: false, clipCount: 1, notified: 0, reason: 'player opted out of future auto-merge' }
    }
    const privacy = normalizeReelUsePrivacy(pref.rows[0]?.reel_usage_privacy)
    if (privacy === 'only_me' || privacy === 'tournaments' || privacy === 'lives') {
      return { matched: false, clipCount: 1, notified: 0, reason: 'reel privacy excludes general auto-merge' }
    }
  }

  const t = rowTime(trigger)
  // Candidate window: everything recorded near this clip. If we have no time at
  // all, we can't group on time — bail rather than group the whole table.
  if (t == null) return { matched: false, clipCount: 0, notified: 0, reason: 'no recorded/created time on clip' }

  const triggerDurationSec = Number(trigger.duration_sec)
  const triggerDurationMs = Number.isFinite(triggerDurationSec) && triggerDurationSec > 0
    ? Math.min(triggerDurationSec * 1000, MAX_SOURCE_DURATION_MS)
    : 0
  // A long console recording can begin well before the analyzed match segment.
  // Cast a wider SQL net, then let the strict evidence checks below decide.
  const lo = new Date(t - MAX_SOURCE_DURATION_MS - MATCH_TIME_TOLERANCE_MS).toISOString()
  const hi = new Date(
    t + Math.max(CANDIDATE_WINDOW_MS, triggerDurationMs) + MATCH_TIME_TOLERANCE_MS,
  ).toISOString()
  const cand = await pool.query(
    `select cr.* from clip_records cr
       left join profiles p on p.id=cr.player_id
       where coalesce(cr.recorded_at, cr.created_at) between $1 and $2
         and coalesce(p.auto_merge_opt_out, false)=false`,
    [lo, hi],
  )

  // Dedup rows by id (the trigger is normally already in the window query).
  const byId = new Map<string, any>()
  for (const r of cand.rows) {
    if (
      trigger.player_id
      && r.player_id
      && String(r.player_id) !== String(trigger.player_id)
      && !(await canUsePlayerReels(pool, {
        ownerUserId: String(r.player_id),
        actorUserId: String(trigger.player_id),
        context: 'general',
      }))
    ) continue
    byId.set(String(r.id), r)
  }
  byId.set(String(trigger.id), trigger)
  const rows = [...byId.values()]

  // Prefer a compatible canonical match. A clip may only join when it agrees
  // with the whole existing group; a low-information bridge cannot override a
  // conflicting map, mode, lobby, result, or clock on another member.
  const candidateMatchIds = new Set<string>()
  if (trigger.match_id) {
    candidateMatchIds.add(String(trigger.match_id))
  } else {
    for (const row of rows) {
      if (row.match_id) candidateMatchIds.add(String(row.match_id))
    }
  }

  const existingCandidates: Array<{ id: string; rows: any[]; score: number }> = []
  let rejectedEvidence: string | undefined
  for (const id of candidateMatchIds) {
    const grouped = await pool.query('select * from clip_records where match_id=$1', [id])
    const groupRows = grouped.rows
    const canonicalResult = await pool.query(
      `select outcome,score_line,mode,map,time_window_start,time_window_end
         from match_groups where id=$1`,
      [id],
    )
    const canonical = canonicalResult.rows[0]
    if (canonical) {
      const canonicalStart = canonical.time_window_start
        ? new Date(canonical.time_window_start).getTime()
        : undefined
      const canonicalEnd = canonical.time_window_end
        ? new Date(canonical.time_window_end).getTime()
        : canonicalStart
      const canonicalRow = {
        ...canonical,
        match_id: id,
        recorded_at: canonical.time_window_start,
        duration_sec: canonicalStart != null && canonicalEnd != null
          ? Math.max(0, (canonicalEnd - canonicalStart) / 1000)
          : null,
      }
      const canonicalConflict = structuralConflict(trigger, canonicalRow)
      if (
        canonicalConflict
        || (canonical.time_window_start && !timeEvidence(trigger, canonicalRow).compatible)
      ) {
        rejectedEvidence = canonicalConflict || 'clock/time'
        continue
      }
    }
    const internalConflict = conflictingGroupEvidence(groupRows)
    if (internalConflict) {
      rejectedEvidence = internalConflict
      continue
    }

    let bestScore = -1
    let conflict: string | undefined
    for (const row of groupRows) {
      if (String(row.id) === String(trigger.id)) continue
      const evidence = compareIdentityEvidence(trigger, row)
      if (evidence.conflict) {
        conflict = evidence.conflict
        break
      }
      if (evidence.qualifies) bestScore = Math.max(bestScore, evidence.score)
    }
    if (conflict) {
      rejectedEvidence = conflict
      continue
    }
    if (bestScore >= 0) existingCandidates.push({ id, rows: groupRows, score: bestScore })
  }

  existingCandidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  if (
    !trigger.match_id
    && existingCandidates.length > 1
    && existingCandidates[0].score - existingCandidates[1].score < AMBIGUITY_SCORE_MARGIN
  ) {
    return {
      matched: false,
      clipCount: 1,
      notified: 0,
      reason: 'ambiguous match evidence across existing matches',
    }
  }

  let clipRows: any[]
  let matchedExistingId: string | undefined
  if (existingCandidates.length) {
    matchedExistingId = existingCandidates[0].id
    const selected = new Map(
      existingCandidates[0].rows.map((row) => [String(row.id), row]),
    )
    selected.set(String(trigger.id), trigger)
    clipRows = [...selected.values()]
  } else {
    const eligible = rows
      .filter((row) => String(row.id) !== String(trigger.id) && !row.match_id)
      .map((row) => ({ row, evidence: compareIdentityEvidence(trigger, row) }))
      .filter((candidate) => candidate.evidence.qualifies)
      .sort((a, b) =>
        b.evidence.score - a.evidence.score
          || String(a.row.id).localeCompare(String(b.row.id)),
      )

    if (!eligible.length) {
      return {
        matched: false,
        clipCount: 1,
        notified: 0,
        reason: rejectedEvidence
          ? `conflicting ${rejectedEvidence} evidence`
          : 'no co-star angle found yet',
      }
    }

    const top = eligible[0]
    const ambiguous = eligible.slice(1).some((candidate) => {
      if (top.evidence.score - candidate.evidence.score >= AMBIGUITY_SCORE_MARGIN) return false
      return !!compareIdentityEvidence(top.row, candidate.row).conflict
    })
    if (ambiguous) {
      return {
        matched: false,
        clipCount: 1,
        notified: 0,
        reason: 'ambiguous conflicting evidence between possible matches',
      }
    }

    clipRows = [trigger, top.row]
    for (const candidate of eligible.slice(1)) {
      if (clipRows.every((row) => compareIdentityEvidence(row, candidate.row).qualifies)) {
        clipRows.push(candidate.row)
      }
    }
  }

  const triggerId = String(trigger.id)
  const group = buildNewMatchGroup(clipRows, triggerId)
  const allGroupClipIds = clipRows.map((row) => String(row.id))
  const angleRows = distinctPlayerRows(clipRows, triggerId)
  if (angleRows.length < 2) {
    return {
      matched: false,
      matchKey: group.matchId,
      clipCount: angleRows.length,
      notified: 0,
      reason: 'only duplicate clips from one player found',
    }
  }

  // ---- 1. find or create the match_groups row ----
  // Existing reuse was already evidence-checked above. The stored signature is
  // canonical because a recomputed key changes as distinct players join.
  let matchGroupId = matchedExistingId
  const proposedMatchKey = group.matchId
  if (!matchGroupId) {
    // First time for this bunch: dedup a concurrent first-run on the engine id.
    const existing = await pool.query(
      'select id from match_groups where sig_hash=$1',
      [proposedMatchKey],
    )
    matchGroupId = existing.rows[0]?.id
  }
  if (!matchGroupId) {
    const firstValue = (field: string) =>
      clipRows.find((row) => row[field] != null)?.[field] ?? null
    try {
      const ins = await pool.query(
        `insert into match_groups
           (signature, sig_hash, participants, outcome, score_line, mode, map,
            confidence, time_window_start, time_window_end, game)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [
          proposedMatchKey,
          proposedMatchKey,
          group.sharedParticipants,
          firstValue('outcome'),
          firstValue('score_line'),
          firstValue('mode'),
          firstValue('map'),
          group.confidence,
          new Date(group.timeWindow.startMs).toISOString(),
          new Date(group.timeWindow.endMs).toISOString(),
          'shinobi_striker',
        ],
      )
      matchGroupId = ins.rows[0].id
    } catch {
      // Raced with a simultaneous trigger for the SAME match (the uq_match_groups
      // _sig unique key rejected the duplicate) — reuse the group they created.
      const again = await pool.query(
        'select id from match_groups where sig_hash=$1',
        [proposedMatchKey],
      )
      matchGroupId = again.rows[0]?.id
    }
  }
  if (!matchGroupId) {
    return {
      matched: false,
      matchKey: proposedMatchKey,
      clipCount: angleRows.length,
      notified: 0,
      reason: 'match group create race unresolved',
    }
  }

  // ---- 2. stamp every clip in the bunch with the match id (loop = pg portable) ----
  for (const id of allGroupClipIds) {
    await pool.query('update clip_records set match_id=$1 where id=$2', [matchGroupId, id])
  }

  const storedGroup = await pool.query(
    'select sig_hash from match_groups where id=$1',
    [matchGroupId],
  )
  const jobs = await pool.query(
    `select id,status,clip_ids,participant_ids,match_key,youtube_id,
            rerender_requested,created_at
       from render_jobs where match_id=$1 order by created_at asc`,
    [matchGroupId],
  )
  const job = jobs.rows[0]
  const matchKey = String(job?.match_key || storedGroup.rows[0]?.sig_hash || proposedMatchKey)
  const versions = matchKey === proposedMatchKey
    ? await pool.query(
      `select version,youtube_id,participant_ids,clip_ids,created_at
         from match_versions where match_key=$1 order by created_at desc`,
      [matchKey],
    )
    : await pool.query(
      `select version,youtube_id,participant_ids,clip_ids,created_at
         from match_versions
        where match_key=$1 or match_key=$2
        order by created_at desc`,
      [matchKey, proposedMatchKey],
    )
  // ---- 3. register one canonical camera per player for this recorded match ----
  // A removed camera stays removed. Re-uploading another source from the same
  // player may refresh an active camera, but it cannot silently override their
  // removal request.
  const priorAngleResult = await pool.query(
    `select id,user_id,youtube_video_id,clip_record_id,status
       from match_angles where match_key=$1`,
    [matchGroupId],
  )
  const priorAngles = priorAngleResult.rows
  const priorByUser = new Map(
    priorAngles.map((angle) => [String(angle.user_id), angle]),
  )
  const representedUsers = new Set<string>()
  for (const angle of priorAngles) {
    if (String(angle.status || 'active') === 'active') representedUsers.add(String(angle.user_id))
  }
  for (const id of job?.participant_ids ?? []) representedUsers.add(String(id))
  for (const version of versions.rows) {
    for (const id of version.participant_ids ?? []) representedUsers.add(String(id))
  }

  const rowById = new Map(clipRows.map((row) => [String(row.id), row]))
  const representedSources = new Set<string>()
  for (const angle of priorAngles) {
    if (String(angle.status || 'active') === 'active' && angle.youtube_video_id) {
      representedSources.add(`youtube:${normalizeHandle(String(angle.youtube_video_id))}`)
    }
  }
  const representedClipIds = [
    ...(job?.clip_ids ?? []),
    ...versions.rows.flatMap((version) => version.clip_ids ?? []),
  ]
  for (const id of representedClipIds) {
    const representedRow = rowById.get(String(id))
    if (representedRow) representedSources.add(sourceKey(representedRow))
  }

  let newDistinctAngleAdded = false
  for (const row of angleRows) {
    if (!row.player_id) continue
    const userId = String(row.player_id)
    const existingAngle = priorByUser.get(userId)
    const youtubeId = String(row.youtube_id || row.clip_id || row.id)
    const identity = sourceKey(row)
    if (!existingAngle) {
      // A repost of somebody else's exact source is not a new camera angle.
      if (representedSources.has(identity)) continue
      try {
        await pool.query(
          `insert into match_angles
             (match_key,user_id,youtube_video_id,clip_record_id,status)
           values ($1,$2,$3,$4,'active')`,
          [matchGroupId, userId, youtubeId, row.id],
        )
        if (!representedUsers.has(userId)) newDistinctAngleAdded = true
        representedUsers.add(userId)
        representedSources.add(identity)
      } catch {
        // A concurrent trigger inserted it first.
      }
    } else if (String(existingAngle.status || 'active') === 'active') {
      const sameSource = normalizeHandle(String(existingAngle.youtube_video_id || ''))
        === normalizeHandle(youtubeId)
      if (sameSource) continue
      await pool.query(
        `update match_angles
            set youtube_video_id=$1, clip_record_id=$2
          where id=$3 and status='active'`,
        [youtubeId, row.id, existingAngle.id],
      )
    }
  }

  const activeResult = await pool.query(
    `select user_id,youtube_video_id,clip_record_id
       from match_angles where match_key=$1 and status='active'`,
    [matchGroupId],
  )
  const activeAngles = activeResult.rows
  if (activeAngles.length < 2) {
    return {
      matched: false,
      matchId: matchGroupId,
      matchKey,
      clipCount: activeAngles.length,
      notified: 0,
      reason: 'fewer than two distinct active player angles',
    }
  }
  const clipIds = [...new Set(
    activeAngles.map((angle) => angle.clip_record_id).filter(Boolean).map(String),
  )]
  const participantIds = [...new Set(activeAngles.map((angle) => String(angle.user_id)))]
  const readyAt = collectionDeadline(activeAngles.length)
  const producedVersion = versions.rows.find((version) =>
    sameIds(version.participant_ids, participantIds),
  )

  // ---- 4. enqueue exactly one render job per match and produced roster ----
  let jobId: string | undefined
  let jobAlreadyExisted = false
  if (producedVersion) {
    // The immutable version ledger wins over an archived or stale queue row.
    // Repeated triggers for the same roster can never create another upload.
    jobAlreadyExisted = true
    if (job) {
      jobId = job.id
      if (String(job.status) !== 'done' || job.rerender_requested) {
        await pool.query(
          `update render_jobs
              set status='done', rerender_requested=false,
                  youtube_id=coalesce($1,youtube_id), updated_at=now()
            where id=$2`,
          [producedVersion.youtube_id || null, job.id],
        )
      }
    }
  } else if (job) {
    jobId = job.id
    jobAlreadyExisted = true
    await refreshRenderJob(
      pool,
      job,
      clipIds,
      participantIds,
      readyAt,
      newDistinctAngleAdded,
    )
  } else {
    try {
      const created = await pool.query(
        `insert into render_jobs
           (match_id, match_key, status, clip_ids, participant_ids, ready_at)
         values ($1,$2,'pending',$3,$4,$5) returning id`,
        [matchGroupId, matchKey, clipIds, participantIds, readyAt],
      )
      jobId = created.rows[0].id
    } catch {
      // A simultaneous trigger already queued this match (match_key is unique).
      const again = await pool.query(
        `select id,status,clip_ids,participant_ids,match_key,youtube_id,
                rerender_requested
           from render_jobs where match_key=$1`,
        [matchKey],
      )
      jobId = again.rows[0]?.id
      jobAlreadyExisted = true
      if (jobId) {
        await refreshRenderJob(
          pool,
          again.rows[0],
          clipIds,
          participantIds,
          readyAt,
          newDistinctAngleAdded,
        )
      }
    }
  }

  // ---- 5. notify every participant once per match (new angles get told too) ----
  let notified = 0
  const n = activeAngles.length
  for (const uid of participantIds) {
    const dup = await pool.query(
      `select 1 from notifications where user_id=$1 and kind='auto_match' and related_id=$2`,
      [uid, matchGroupId],
    )
    if (dup.rows.length) continue
    await pool.query(
      `insert into notifications (user_id, kind, title, body, link, related_id)
       values ($1,'auto_match',$2,$3,$4,$5)`,
      [
        uid,
        'You were tagged in a game',
        `TKO found your camera in a ${n}-player match. We are assembling the synchronized multi-angle version now.`,
        `/matches/${matchGroupId}`,
        matchGroupId,
      ],
    )
    notified++
  }

  return {
    matched: true,
    matchId: matchGroupId,
    matchKey,
    clipCount: activeAngles.length,
    jobId,
    jobAlreadyExisted,
    notified,
  }
}
