export const MIN_DETECTED_BATTLE_CONFIDENCE = 0.7
export const MIN_DETECTED_BATTLE_SECONDS = 60

export type DetectedBattleRow = {
  id: string
  segment_id: string | null
  youtube_id: string | null
  source_start_sec: number | string | null
  source_end_sec: number | string | null
  duration_sec: number | null
  boundary_confidence: number | string | null
  score_verification_status: string | null
  mode: string | null
  map: string | null
  recorded_at: string | null
  created_at: string | null
}

export function isVisibleDetectedBattle(row: DetectedBattleRow): boolean {
  const start = Number(row.source_start_sec)
  const end = Number(row.source_end_sec)
  const duration = Number(row.duration_sec ?? end - start)
  const confidence = Number(row.boundary_confidence)
  return row.score_verification_status === 'shadow'
    && Boolean(row.segment_id)
    && /^[A-Za-z0-9_-]{11}$/.test(String(row.youtube_id || ''))
    && Number.isFinite(start)
    && start >= 0
    && Number.isFinite(end)
    && end > start
    && Number.isFinite(duration)
    && duration >= MIN_DETECTED_BATTLE_SECONDS
    && Number.isFinite(confidence)
    && confidence >= MIN_DETECTED_BATTLE_CONFIDENCE
}

export function detectedBattleWatchUrl(row: DetectedBattleRow): string {
  const seconds = Math.max(0, Math.floor(Number(row.source_start_sec) || 0))
  return `https://www.youtube.com/watch?v=${encodeURIComponent(String(row.youtube_id || ''))}&t=${seconds}s`
}

export function detectedBattleLabel(value: string | null): string {
  if (!value) return 'Detected battle'
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
