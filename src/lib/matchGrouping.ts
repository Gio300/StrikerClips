/**
 * Match grouping — the "bunch clips of the SAME match together" engine.
 *
 * The product's core: uploaded clips shouldn't be an endless scroll of loose
 * videos. They should collapse into BUNCHES — every angle of one match grouped
 * so the UI can say "3 other angles of this match — add all." This is the pure,
 * zero-cost, fully-testable heart of that. It takes normalized per-clip metadata
 * (who was in it, when it was recorded, and — when a result screen was read by
 * the client OCR in ocrMatchResult.ts — the outcome / K-D-A / score) and decides
 * which clips describe the same match.
 *
 * Deliberately dependency-free and DOM-free so it unit-tests offline and the
 * future cloud vision reader (see docs/ai-video-system.md) can simply enrich the
 * `resultSignature` without touching this logic.
 *
 * Grouping rule (see `sameMatch`): two clips are the SAME match when
 *   1. their recorded time-windows overlap within a tolerance, AND
 *   2. they share ≥1 participant OR the same host/lobby match id, AND
 *   3. their result signatures are COMPATIBLE (not contradictory: same-or-
 *      complementary outcome, same-or-reversed score, same mode/map, close
 *      duration).
 * A confidence score reflects how many of those signals actually agreed.
 */

export type MatchOutcome = 'victory' | 'defeat' | 'draw'

/**
 * The match-identifying features read off a clip. Everything is optional because
 * a $0 v1 rarely has all of it — the more that's present, the higher confidence.
 */
export interface ResultSignature {
  outcome?: MatchOutcome
  kills?: number
  deaths?: number
  assists?: number
  map?: string
  mode?: string
  /** e.g. "3-1" — normalized + reversible so opposing angles still match. */
  scoreLine?: string
}

/** Normalized per-clip metadata the grouping engine reasons over. */
export interface ClipMeta {
  clipId: string
  /** uploader / owner handle or id (also counted as a participant). */
  playerId: string
  /** player handles known to appear in the clip (teammates + opponents), when known. */
  participants?: string[]
  /** epoch ms the clip was RECORDED — the preferred grouping signal. */
  recordedAt?: number
  /** epoch ms the clip was UPLOADED — fallback when recordedAt is unknown. */
  uploadedAt?: number
  durationSec?: number
  resultSignature?: ResultSignature
  category?: string
  /** an explicit host/lobby/game match id, when the platform provides one. */
  lobbyId?: string
}

/** The stable, comparable/­hashable fingerprint of a match. */
export interface MatchSignature {
  /** normalized, sorted participant handles (incl. the uploader). */
  participants: string[]
  outcome?: MatchOutcome
  scoreLine?: string
  mode?: string
  map?: string
  /** duration rounded to a coarse bucket (sec) for stable comparison. */
  durationBucket?: number
  lobbyId?: string
  /** normalized string form used for hashing / dedup. */
  raw: string
}

export interface GroupOptions {
  /** how far apart two clip time-windows may be and still be the same match (ms). */
  timeToleranceMs?: number
  /** how different two reported durations may be and still be compatible (ms). */
  durationToleranceMs?: number
}

export interface MatchGroup {
  /** deterministic id: hash(earliest clip id + merged signature). Stable across re-runs. */
  matchId: string
  /** clips in the match, sorted by recorded time then id. */
  clips: ClipMeta[]
  /** 0..1 — how strongly the signals agreed. */
  confidence: number
  /** handles that appear in ≥2 clips of the group (the connective tissue). */
  sharedParticipants: string[]
  timeWindow: { startMs: number; endMs: number }
}

// ── tolerances ──────────────────────────────────────────────────────────────
const DEFAULT_TIME_TOL = 3 * 60_000 // 3 minutes between windows still = same match
const DEFAULT_DUR_TOL = 90_000 // reported durations may differ by ≤ 90s
const DURATION_BUCKET_SEC = 30 // duration signature is bucketed to 30s

// ── small pure helpers ───────────────────────────────────────────────────────

/** Lowercase, trim, strip a leading @. Handles compare case/®-insensitively. */
export function normalizeHandle(h: string): string {
  return h.trim().toLowerCase().replace(/^@+/, '')
}

/** All participant handles of a clip (uploader + listed participants), deduped + sorted. */
export function participantsOf(meta: ClipMeta): string[] {
  const set = new Set<string>()
  if (meta.playerId) {
    const p = normalizeHandle(meta.playerId)
    if (p) set.add(p)
  }
  for (const p of meta.participants ?? []) {
    const n = normalizeHandle(p)
    if (n) set.add(n)
  }
  return [...set].sort()
}

/** The clip's best-known time (recorded preferred, uploaded fallback). */
export function effectiveTime(meta: ClipMeta): number {
  return meta.recordedAt ?? meta.uploadedAt ?? 0
}

function clipWindow(meta: ClipMeta): { start: number; end: number } {
  const start = effectiveTime(meta)
  const durMs = meta.durationSec && meta.durationSec > 0 ? meta.durationSec * 1000 : 0
  return { start, end: start + durMs }
}

/** "3 - 1" / "3:1" → "3-1". Non-numeric input is lowercased/trimmed as-is. */
function normalizeScore(s: string): string {
  const nums = s.match(/\d+/g)
  if (!nums || nums.length < 2) return s.trim().toLowerCase()
  return nums.join('-')
}

/** Scores agree when equal, or reversed (same match from the opposing side). */
function scoresCompatible(a?: string, b?: string): boolean {
  if (!a || !b) return true
  if (a === b) return true
  const an = a.split('-')
  const bn = b.split('-')
  if (an.length === 2 && bn.length === 2) return an[0] === bn[1] && an[1] === bn[0]
  return false
}

/**
 * Outcomes agree unless one side calls it a draw and the other doesn't. Victory
 * and defeat freely pair — that's exactly two opposing angles of one match.
 */
function outcomesCompatible(a?: MatchOutcome, b?: MatchOutcome): boolean {
  if (!a || !b) return true
  return (a === 'draw') === (b === 'draw')
}

/** Two result signatures are compatible when nothing about them contradicts. */
export function resultsCompatible(a?: ResultSignature, b?: ResultSignature): boolean {
  if (!a || !b) return true
  if (a.mode && b.mode && a.mode !== b.mode) return false
  if (a.map && b.map && a.map !== b.map) return false
  if (!outcomesCompatible(a.outcome, b.outcome)) return false
  const sa = a.scoreLine ? normalizeScore(a.scoreLine) : undefined
  const sb = b.scoreLine ? normalizeScore(b.scoreLine) : undefined
  if (!scoresCompatible(sa, sb)) return false
  return true
}

function windowsWithinTolerance(a: ClipMeta, b: ClipMeta, tol: number): boolean {
  const wa = clipWindow(a)
  const wb = clipWindow(b)
  // Gap between the two intervals; ≤ 0 means they already overlap.
  const gap = Math.max(wa.start, wb.start) - Math.min(wa.end, wb.end)
  return gap <= tol
}

function sharedParticipants(a: ClipMeta, b: ClipMeta): string[] {
  const sb = new Set(participantsOf(b))
  return participantsOf(a).filter((p) => sb.has(p))
}

function sameLobby(a: ClipMeta, b: ClipMeta): boolean {
  return !!a.lobbyId && !!b.lobbyId && normalizeHandle(a.lobbyId) === normalizeHandle(b.lobbyId)
}

/** The stable signature of ONE clip. */
export function matchSignature(meta: ClipMeta): MatchSignature {
  const participants = participantsOf(meta)
  const rs = meta.resultSignature
  const durationBucket =
    meta.durationSec && meta.durationSec > 0
      ? Math.round(meta.durationSec / DURATION_BUCKET_SEC) * DURATION_BUCKET_SEC
      : undefined
  const scoreLine = rs?.scoreLine ? normalizeScore(rs.scoreLine) : undefined
  const lobbyId = meta.lobbyId ? normalizeHandle(meta.lobbyId) : undefined
  const raw = [
    participants.join(','),
    rs?.outcome ?? '',
    scoreLine ?? '',
    rs?.mode ?? '',
    rs?.map ?? '',
    lobbyId ? `lobby:${lobbyId}` : '',
    durationBucket !== undefined ? `d:${durationBucket}` : '',
  ].join('|')
  return {
    participants,
    outcome: rs?.outcome,
    scoreLine,
    mode: rs?.mode,
    map: rs?.map,
    durationBucket,
    lobbyId,
    raw,
  }
}

/**
 * Do two clips describe the same match? (See file header for the full rule.)
 * Pure + symmetric.
 */
export function sameMatch(a: ClipMeta, b: ClipMeta, opts: GroupOptions = {}): boolean {
  const timeTol = opts.timeToleranceMs ?? DEFAULT_TIME_TOL
  if (!windowsWithinTolerance(a, b, timeTol)) return false

  // Must be linked either by a shared participant or a shared lobby id.
  if (sharedParticipants(a, b).length === 0 && !sameLobby(a, b)) return false

  // Result signatures must not contradict.
  if (!resultsCompatible(a.resultSignature, b.resultSignature)) return false

  // If both report a duration, they must be close.
  if (a.durationSec && b.durationSec) {
    const durTol = opts.durationToleranceMs ?? DEFAULT_DUR_TOL
    if (Math.abs(a.durationSec - b.durationSec) * 1000 > durTol) return false
  }
  return true
}

// ── grouping ──────────────────────────────────────────────────────────────────

/** FNV-1a → stable short hex id, so re-runs (and reordered input) produce the same matchId. */
function hashMatchId(earliestClipId: string, sigRaw: string): string {
  const input = `${earliestClipId}::${sigRaw}`
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return 'm_' + (h >>> 0).toString(16).padStart(8, '0')
}

/** Merge every clip's signature into one group-level signature (union of participants). */
function mergedSignature(clips: ClipMeta[]): MatchSignature {
  const partSet = new Set<string>()
  let outcome: MatchOutcome | undefined
  let scoreLine: string | undefined
  let mode: string | undefined
  let map: string | undefined
  let durationBucket: number | undefined
  let lobbyId: string | undefined
  for (const c of clips) {
    for (const p of participantsOf(c)) partSet.add(p)
    const s = matchSignature(c)
    if (outcome === undefined) outcome = s.outcome
    if (scoreLine === undefined) scoreLine = s.scoreLine
    if (mode === undefined) mode = s.mode
    if (map === undefined) map = s.map
    if (durationBucket === undefined) durationBucket = s.durationBucket
    if (lobbyId === undefined) lobbyId = s.lobbyId
  }
  const participants = [...partSet].sort()
  const raw = [
    participants.join(','),
    scoreLine ?? '',
    mode ?? '',
    map ?? '',
    lobbyId ? `lobby:${lobbyId}` : '',
    durationBucket !== undefined ? `d:${durationBucket}` : '',
  ].join('|')
  return { participants, outcome, scoreLine, mode, map, durationBucket, lobbyId, raw }
}

/** How confident are we these clips are one match? More agreeing signals → higher. */
function groupConfidence(
  clips: ClipMeta[],
  shared: string[],
  sig: MatchSignature,
): number {
  // A lone clip is trivially its own match, but nothing corroborates it.
  if (clips.length <= 1) return 0.5

  let conf = 0.4 // overlapping time-window got them this far
  const allHaveLobby = clips.every((c) => !!c.lobbyId)
  const oneLobby = allHaveLobby && new Set(clips.map((c) => normalizeHandle(c.lobbyId!))).size === 1
  if (oneLobby) conf += 0.3
  if (shared.length >= 1) conf += 0.2
  if (shared.length >= 2) conf += 0.1

  const withResult = clips.filter((c) => c.resultSignature)
  if (withResult.length >= 2) conf += 0.1
  else if (sig.scoreLine || sig.mode || sig.map) conf += 0.05

  return Math.min(1, Number(conf.toFixed(3)))
}

function buildGroup(clipsSortedByTime: ClipMeta[]): MatchGroup {
  const counts = new Map<string, number>()
  for (const c of clipsSortedByTime) {
    for (const p of participantsOf(c)) counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  const shared = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([p]) => p)
    .sort()

  let startMs = Infinity
  let endMs = -Infinity
  for (const c of clipsSortedByTime) {
    const w = clipWindow(c)
    if (w.start < startMs) startMs = w.start
    if (w.end > endMs) endMs = w.end
  }

  const sig = mergedSignature(clipsSortedByTime)
  const earliest = clipsSortedByTime[0]
  return {
    matchId: hashMatchId(earliest.clipId, sig.raw),
    clips: clipsSortedByTime,
    confidence: groupConfidence(clipsSortedByTime, shared, sig),
    sharedParticipants: shared,
    timeWindow: { startMs, endMs },
  }
}

/**
 * Group clips into matches. O(n²) pairwise + union-find — fine for a user's
 * library. Deterministic: groups and the clips inside them are stably sorted,
 * and matchId is independent of input order.
 */
export function groupClipsByMatch(metas: ClipMeta[], opts: GroupOptions = {}): MatchGroup[] {
  const n = metas.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => {
    let r = x
    while (parent[r] !== r) {
      parent[r] = parent[parent[r]]
      r = parent[r]
    }
    return r
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sameMatch(metas[i], metas[j], opts)) union(i, j)
    }
  }

  const buckets = new Map<number, ClipMeta[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const arr = buckets.get(r) ?? []
    arr.push(metas[i])
    buckets.set(r, arr)
  }

  const groups: MatchGroup[] = []
  for (const clips of buckets.values()) {
    const sorted = [...clips].sort(
      (a, b) => effectiveTime(a) - effectiveTime(b) || a.clipId.localeCompare(b.clipId),
    )
    groups.push(buildGroup(sorted))
  }
  return groups.sort(
    (a, b) => a.timeWindow.startMs - b.timeWindow.startMs || a.matchId.localeCompare(b.matchId),
  )
}

/**
 * The other angles of `targetClip`'s match within `library` — what powers the
 * "N other angles of this match — add all" bunch affordance. Returns the same-
 * match clips (excluding the target), sorted by time then id.
 */
export function suggestOtherAngles(
  targetClip: ClipMeta,
  library: ClipMeta[],
  opts: GroupOptions = {},
): ClipMeta[] {
  // Combine + dedupe by clipId; the passed target wins over a library copy.
  const byId = new Map<string, ClipMeta>()
  byId.set(targetClip.clipId, targetClip)
  for (const c of library) if (!byId.has(c.clipId)) byId.set(c.clipId, c)

  const groups = groupClipsByMatch([...byId.values()], opts)
  const group = groups.find((g) => g.clips.some((c) => c.clipId === targetClip.clipId))
  if (!group) return []
  return group.clips.filter((c) => c.clipId !== targetClip.clipId)
}

/** The full MatchGroup a clip belongs to (incl. the target), or null. */
export function matchGroupFor(
  targetClip: ClipMeta,
  library: ClipMeta[],
  opts: GroupOptions = {},
): MatchGroup | null {
  const byId = new Map<string, ClipMeta>()
  byId.set(targetClip.clipId, targetClip)
  for (const c of library) if (!byId.has(c.clipId)) byId.set(c.clipId, c)
  const groups = groupClipsByMatch([...byId.values()], opts)
  return groups.find((g) => g.clips.some((c) => c.clipId === targetClip.clipId)) ?? null
}
