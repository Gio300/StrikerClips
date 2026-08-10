export type IntegrityQueryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

export type IntegrityVerdict = 'clear' | 'needs_review' | 'confirmed_mod' | 'skipped'

export type TournamentIntegrityInput = {
  sourceId: string
  tournamentId: string
  participantId: string
  detectorVersion: string
  report: Record<string, unknown>
}

const VERDICTS = new Set<IntegrityVerdict>(['clear', 'needs_review', 'confirmed_mod', 'skipped'])
const DETERMINISTIC_CODES = new Set([
  'CROSS_ROLE_ABILITY',
  'STACKED_OUTFIT_SKILLS',
  'IMPOSSIBLE_COOLDOWN',
])

function finite(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function gameIsShinobiStriker(value: unknown): boolean {
  return /shinobi\s*striker/i.test(String(value || ''))
}

export function normalizeIntegrityReport(raw: Record<string, unknown>): {
  verdict: IntegrityVerdict
  report: Record<string, unknown>
  clipWindows: Array<{ t0: number; t1: number; evidence_codes: string[] }>
  publicAccusationAllowed: boolean
  clipEligible: boolean
} {
  const verdict = String(raw.verdict || '') as IntegrityVerdict
  if (!VERDICTS.has(verdict)) throw new Error('invalid integrity verdict')

  const evidence = Array.isArray(raw.evidence) ? raw.evidence.filter((item): item is Record<string, unknown> => (
    Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  )) : []
  const confirmed = evidence.filter((item) => (
    item.level === 'confirmed_mod'
    && item.deterministic === true
    && (finite(item.confidence) || 0) >= 0.99
    && DETERMINISTIC_CODES.has(String(item.code || ''))
  ))
  const confirmedCodes = new Set(confirmed.map((item) => String(item.code)))

  if (verdict === 'confirmed_mod' && confirmed.length === 0) {
    throw new Error('confirmed_mod requires deterministic evidence at confidence >= 0.99')
  }
  if (verdict !== 'confirmed_mod' && confirmed.length > 0) {
    throw new Error('deterministic confirmed evidence requires a confirmed_mod verdict')
  }

  const missing = Array.isArray(raw.missing_coverage) ? raw.missing_coverage : []
  if (verdict === 'clear' && missing.length > 0) {
    throw new Error('clear verdict requires complete review coverage')
  }

  const clipWindows: Array<{ t0: number; t1: number; evidence_codes: string[] }> = []
  if (verdict === 'confirmed_mod') {
    for (const item of Array.isArray(raw.clip_windows) ? raw.clip_windows : []) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const window = item as Record<string, unknown>
      const t0 = finite(window.t0)
      const t1 = finite(window.t1)
      const codes = Array.isArray(window.evidence_codes)
        ? [...new Set(window.evidence_codes.map(String).filter((code) => confirmedCodes.has(code)))]
        : []
      if (t0 == null || t1 == null || t0 < 0 || t1 <= t0 || t1 - t0 > 120 || codes.length === 0) continue
      clipWindows.push({ t0, t1, evidence_codes: codes })
      if (clipWindows.length >= 20) break
    }
  }

  const publicAccusationAllowed = verdict === 'confirmed_mod' && confirmed.length > 0
  const clipEligible = publicAccusationAllowed && clipWindows.length > 0
  const report = {
    ...raw,
    verdict,
    confirmed_count: confirmed.length,
    clip_windows: clipWindows,
    public_accusation_allowed: publicAccusationAllowed,
    server_validation: {
      deterministic_codes: [...confirmedCodes].sort(),
      clip_eligible: clipEligible,
    },
  }
  return { verdict, report, clipWindows, publicAccusationAllowed, clipEligible }
}

export async function tournamentIntegrityContext(
  db: IntegrityQueryable,
  sourceId: string,
): Promise<any | null> {
  return (await db.query(
    `select s.id as source_id,s.owner_id,s.source_kind,s.source_url,s.duration_sec,
            s.live_stream_id,l.tournament_id,l.game,t.status as tournament_status,
            t.league_slug,
            p.username
       from media_sources s
       join live_streams l on l.id=s.live_stream_id
       join tournaments t on t.id=l.tournament_id
       join profiles p on p.id=s.owner_id
      where s.id=$1`,
    [sourceId],
  )).rows[0] || null
}

export async function saveTournamentIntegrityReport(
  db: IntegrityQueryable,
  input: TournamentIntegrityInput,
): Promise<any> {
  const sourceId = String(input.sourceId || '').trim()
  const tournamentId = String(input.tournamentId || '').trim()
  const participantId = String(input.participantId || '').trim()
  const detectorVersion = String(input.detectorVersion || '').trim().slice(0, 160)
  if (!sourceId || !tournamentId || !participantId || !detectorVersion) {
    throw new Error('sourceId, tournamentId, participantId, and detectorVersion are required')
  }

  const context = await tournamentIntegrityContext(db, sourceId)
  if (!context) throw new Error('source is not attached to a tournament live stream')
  if (String(context.tournament_id) !== tournamentId) throw new Error('source belongs to a different tournament')
  if (String(context.owner_id) !== participantId) throw new Error('participant must own the reviewed camera')
  if (!String(context.source_kind || '').endsWith('_live')) throw new Error('integrity review is tournament-live only')
  if (!gameIsShinobiStriker(context.game)) throw new Error('integrity detector only supports Shinobi Striker')

  const normalized = normalizeIntegrityReport(input.report || {})
  return (await db.query(
    `insert into tournament_integrity_reports
       (tournament_id,source_id,participant_id,detector_version,verdict,report,
        clip_windows,public_accusation_allowed,clip_eligible,updated_at)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,now())
     on conflict (tournament_id,source_id,participant_id,detector_version) do update set
       verdict=excluded.verdict,
       report=excluded.report,
       clip_windows=excluded.clip_windows,
       public_accusation_allowed=excluded.public_accusation_allowed,
       clip_eligible=excluded.clip_eligible,
       updated_at=now()
     returning *`,
    [
      tournamentId,
      sourceId,
      participantId,
      detectorVersion,
      normalized.verdict,
      JSON.stringify(normalized.report),
      JSON.stringify(normalized.clipWindows),
      normalized.publicAccusationAllowed,
      normalized.clipEligible,
    ],
  )).rows[0]
}

export async function listTournamentIntegrityReports(
  db: IntegrityQueryable,
  tournamentId: string,
  limit = 100,
): Promise<any[]> {
  const take = Math.max(1, Math.min(500, Math.round(limit)))
  return (await db.query(
    `select * from tournament_integrity_reports
      where tournament_id=$1 order by created_at desc limit $2`,
    [tournamentId, take],
  )).rows
}
