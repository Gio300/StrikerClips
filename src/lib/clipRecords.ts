/**
 * Clip records — the normalized, per-clip analysis that upload/add produces, and
 * the bridge from our various clip sources (connected YouTube library, squad
 * shelf, demo) into the pure `matchGrouping` engine.
 *
 * SCAFFOLDING ONLY. Mirrors src/lib/assets.ts / predictions.ts: a localStorage-
 * backed, DOM-light store with injectable storage for tests and a window-event
 * broadcast so mounted surfaces refresh live. A real backend plugs into the
 * `clip_records` + `match_groups` tables added to db/schema.sql; nothing here is
 * load-bearing beyond the demo/scaffold.
 *
 * What this adds on top of the pure engine:
 *   • auto-categorization at add time — infer a ClipRecord.category from the
 *     clip's title/description using the existing clipSearch parser, and read
 *     opponents out of "vs X" / "against X" phrasing.
 *   • result-screen fusion — turn a client OCR read (ocrMatchResult.ts) into a
 *     ResultSignature and merge it onto a clip so grouping gets sharper.
 *   • source → ClipMeta mappers so the UI can feed real clips to
 *     groupClipsByMatch / suggestOtherAngles.
 *
 * One localStorage key:
 *   • kc_clip_records:<userId> — the user's per-clip analysis records.
 * Broadcasts `kc:clip_records`.
 */

import { parseClipQuery, type ClipCategory, type ClipRecord } from './clipSearch'
import type { LibraryVideo } from './describeClip'
import type { SquadClip } from './squad'
import type { MatchOcrResult } from './ocrMatchResult'
import {
  groupClipsByMatch,
  normalizeHandle,
  type ClipMeta,
  type MatchGroup,
  type ResultSignature,
} from './matchGrouping'
import { backend, callFn } from './backend'

const KEY_PREFIX = 'kc_clip_records:'
const EVENT = 'kc:clip_records'

export interface ClipRecordStorage {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

function defaultStorage(): ClipRecordStorage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* access blocked */
  }
  return null
}

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId || 'anon'}`
}

function broadcast(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(EVENT))
  } catch {
    /* non-DOM */
  }
}

// ── auto-categorization helpers (pure) ────────────────────────────────────────

const VALID_CATEGORIES: ClipCategory[] = ['kill', 'death', 'ultimate', 'flag', 'win', 'clutch']

/** Infer a clip category from free text (title/description). Reuses clipSearch. */
export function inferCategory(text: string): ClipCategory | undefined {
  return parseClipQuery(text).category
}

/** Coerce an arbitrary string to a valid ClipCategory, defaulting to 'kill'. */
export function coerceCategory(cat: string | undefined): ClipCategory {
  if (cat && (VALID_CATEGORIES as string[]).includes(cat)) return cat as ClipCategory
  return 'kill'
}

/**
 * Pull opponent/participant handles out of "vs X" / "against X" phrasing in a
 * title. Best-effort; returns normalized handles.
 */
export function parseParticipants(text: string): string[] {
  const out = new Set<string>()
  const re = /\b(?:vs\.?|versus|against|v\.)\s+([A-Za-z0-9_@]{2,20})/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.add(normalizeHandle(m[1]))
  const at = text.match(/@([a-z0-9_]{2,20})/gi)
  if (at) for (const a of at) out.add(normalizeHandle(a))
  return [...out]
}

/** Turn a client OCR result-screen read into a ResultSignature (only what's known). */
export function ocrToResultSignature(ocr: MatchOcrResult): ResultSignature {
  const rs: ResultSignature = {}
  if (ocr.outcome) rs.outcome = ocr.outcome
  if (ocr.kills != null) rs.kills = ocr.kills
  if (ocr.deaths != null) rs.deaths = ocr.deaths
  if (ocr.assists != null) rs.assists = ocr.assists
  return rs
}

// ── source → ClipMeta mappers ─────────────────────────────────────────────────

/** A connected-library YouTube video → ClipMeta (category + opponents inferred). */
export function libraryVideoToMeta(video: LibraryVideo, ownerHandle: string): ClipMeta {
  const text = `${video.title} ${video.description}`
  const owner = normalizeHandle(ownerHandle || video.channelTitle || 'me')
  const participants = [owner, ...parseParticipants(text)]
  return {
    clipId: video.id,
    playerId: owner,
    participants,
    recordedAt: video.publishedAt,
    uploadedAt: video.publishedAt,
    category: inferCategory(text),
  }
}

/** A squad-shelf clip → ClipMeta. Owner + any "vs X" opponents in the title. */
export function squadClipToMeta(clip: SquadClip): ClipMeta {
  const owner = normalizeHandle(clip.ownerName || clip.ownerId)
  return {
    clipId: clip.id,
    playerId: owner,
    participants: [owner, ...parseParticipants(clip.title)],
    recordedAt: clip.publishedAt,
    uploadedAt: clip.publishedAt,
    category: clip.category,
  }
}

/** A stored ClipRecord → ClipMeta for grouping. */
export function recordToMeta(rec: ClipRecord): ClipMeta {
  const owner = normalizeHandle(rec.playerName || rec.playerId)
  return {
    clipId: rec.youtubeId || rec.id,
    playerId: owner,
    participants: [owner],
    recordedAt: rec.createdAt,
    uploadedAt: rec.createdAt,
    category: rec.category,
    lobbyId: rec.matchId,
  }
}

// ── storage-backed records (mirror assets.ts) ─────────────────────────────────

export function readClipRecords(
  userId: string,
  storage: ClipRecordStorage | null = defaultStorage(),
): ClipRecord[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(keyFor(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ClipRecord[]) : []
  } catch {
    return []
  }
}

function writeClipRecords(
  userId: string,
  records: ClipRecord[],
  storage: ClipRecordStorage | null,
): void {
  if (!storage) return
  try {
    storage.setItem(keyFor(userId), JSON.stringify(records))
  } catch {
    /* quota / private mode */
  }
  broadcast()
}

/**
 * Upsert a per-clip record (keyed by youtubeId, else id). Idempotent: adding the
 * same clip again merges rather than duplicating. This is the auto-categorize
 * write the add/upload flow calls. Never throws — stores what we have.
 */
export function upsertClipRecord(
  userId: string,
  rec: ClipRecord,
  storage: ClipRecordStorage | null = defaultStorage(),
): ClipRecord[] {
  const all = readClipRecords(userId, storage)
  const keyId = rec.youtubeId || rec.id
  const idx = all.findIndex((r) => (r.youtubeId || r.id) === keyId)
  const next = [...all]
  if (idx >= 0) next[idx] = { ...all[idx], ...rec }
  else next.unshift(rec)
  writeClipRecords(userId, next, storage)
  return next
}

/**
 * Build + store a ClipRecord for an added YouTube clip. Auto-assigns category
 * from `title` (falls back to 'kill'); optional `ocr` fills outcome/stats. Kept
 * graceful: low OCR confidence still stores whatever was read.
 */
export function recordAddedYouTubeClip(
  input: {
    userId: string
    youtubeId: string
    playerId: string
    playerName: string
    title?: string
    startSec?: number
    ocr?: MatchOcrResult
    /**
     * Whether this user may enter the CROSS-USER auto-merge pipeline (YouTube
     * connected + a paid tier — see `autoMergeEnabled` in lib/entitlements).
     * Posting their own single match is never gated; only the auto-match enqueue
     * is. Defaults to false so a caller that hasn't resolved entitlement can't
     * accidentally enqueue.
     */
    autoMergeEnabled?: boolean
  },
  storage: ClipRecordStorage | null = defaultStorage(),
  now: number = Date.now(),
): ClipRecord {
  const title = input.title ?? ''
  const rec: ClipRecord = {
    id: `cr_${input.youtubeId}`,
    playerId: input.playerId,
    playerName: input.playerName,
    category: coerceCategory(inferCategory(title)),
    youtubeId: input.youtubeId,
    startSec: input.startSec ?? 0,
    createdAt: now,
  }
  upsertClipRecord(input.userId, rec, storage)
  // Feed the backend so this clip can be matched against other users' angles.
  // Fire-and-forget: the local record above is the source of truth for the UI;
  // this is the additive cross-user path.
  void syncClipRecordToBackend({
    playerId: input.playerId,
    playerHandle: input.playerName,
    youtubeId: input.youtubeId,
    recordedAt: now,
    category: rec.category,
    participants: input.ocr ? parseParticipants(input.title ?? '') : undefined,
    result: input.ocr ? ocrToResultSignature(input.ocr) : undefined,
    autoMergeEnabled: input.autoMergeEnabled === true,
  })
  return rec
}

/**
 * Push a clip's match metadata to the BACKEND `clip_records` table and trigger
 * server-side auto-match. This is what lets a clip be bunched with OTHER users'
 * angles of the same match — cross-user matching that the per-user localStorage
 * grouping can't do. The stronger the join keys we can supply (a shared lobby id,
 * or the other handles seen in the clip), the more reliably strangers link;
 * with only time + result the server leans on the clock+audio detector.
 *
 * Fire-and-forget and fully graceful: never throws, and no-ops on the mock
 * backend, so local grouping keeps working regardless.
 *
 * GATING: inserting the clip_records row is the user's OWN post (a single match)
 * and is never gated — anyone may post their own clip. The cross-user AUTO-MERGE
 * (the `auto-match` enqueue that bunches this clip with OTHER users' angles) is
 * unlocked ONLY when `autoMergeEnabled` is true — i.e. the user has connected
 * YouTube AND holds a paid tier (see `autoMergeEnabled` in lib/entitlements).
 */
export interface SyncClipRecordDeps {
  /** Insert a clip_records row, returning its id (or null on failure/no backend). */
  insertClipRecord: (values: Record<string, unknown>) => Promise<string | null>
  /** Enqueue the server-side cross-user auto-match for a clip record id. */
  enqueueAutoMatch: (clipRecordId: string) => Promise<void>
}

/** Default deps: the real Supabase-compatible backend (lazy so tests stay pure). */
const defaultSyncDeps: SyncClipRecordDeps = {
  async insertClipRecord(values) {
    const sb = await backend()
    if (!sb) return null
    const { data, error } = await sb.from('clip_records').insert(values).select('id').single()
    const id = (data as { id?: string } | null)?.id
    return error || !id ? null : id
  },
  async enqueueAutoMatch(clipRecordId) {
    await callFn('auto-match', { clipRecordId })
  },
}

export async function syncClipRecordToBackend(
  input: {
    playerId: string
    playerHandle: string
    youtubeId?: string
    recordedAt?: number
    durationSec?: number
    lobbyId?: string
    participants?: string[]
    category?: string
    result?: ResultSignature
    /** Cross-user auto-merge entitlement — gates only the auto-match enqueue. */
    autoMergeEnabled?: boolean
  },
  deps: SyncClipRecordDeps = defaultSyncDeps,
): Promise<void> {
  try {
    const values: Record<string, unknown> = {
      player_id: input.playerId,
      player_handle: input.playerHandle,
      youtube_id: input.youtubeId ?? null,
      recorded_at: input.recordedAt ? new Date(input.recordedAt).toISOString() : null,
      duration_sec: input.durationSec ?? null,
      lobby_id: input.lobbyId ?? null,
      participants: input.participants ?? [],
      category: input.category ?? null,
      outcome: input.result?.outcome ?? null,
      score_line: input.result?.scoreLine ?? null,
      map: input.result?.map ?? null,
      mode: input.result?.mode ?? null,
      kills: input.result?.kills ?? null,
      deaths: input.result?.deaths ?? null,
      assists: input.result?.assists ?? null,
    }
    const id = await deps.insertClipRecord(values)
    if (!id) return
    // Cross-user auto-merge is gated: a non-entitled user's clip record still
    // lands (their own post), but it never enters the auto-match pipeline.
    if (input.autoMergeEnabled !== true) return
    await deps.enqueueAutoMatch(id)
  } catch {
    /* mock backend / offline — additive only, local grouping is unaffected */
  }
}

/** Group the user's stored clip records into match bunches. */
export function groupUserClips(
  userId: string,
  storage: ClipRecordStorage | null = defaultStorage(),
): MatchGroup[] {
  return groupClipsByMatch(readClipRecords(userId, storage).map(recordToMeta))
}

export function subscribeClipRecords(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => cb()
  window.addEventListener(EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

// ── demo match (so the "other angles" bunch is visible before real data) ───────

const DAY = 86_400_000

/**
 * A single real 3-angle match, using the SAME public YouTube ids the demo
 * library/squad already surface, so adding e.g. the "Triple K.O." clip reveals
 * two other angles of that match. Shared lobby + participants + reversible score
 * → a high-confidence bunch. Replaced entirely by real analyzed clips.
 */
export function demoMatchAngles(now: number = Date.now()): ClipMeta[] {
  const base = now - DAY
  const lobbyId = 'nwl-8842'
  const participants = ['you', 'rekt', 'auryn']
  const mode = 'ninja_world_league'
  const map = 'valley-end'
  return [
    {
      clipId: 'dPCS6ACHeQ0',
      playerId: 'you',
      participants,
      recordedAt: base,
      durationSec: 210,
      lobbyId,
      category: 'kill',
      resultSignature: { outcome: 'victory', scoreLine: '3-1', mode, map, kills: 8, deaths: 2, assists: 3 },
    },
    {
      clipId: 'IZcwiJrMwas',
      playerId: 'rekt',
      participants,
      recordedAt: base + 15_000,
      durationSec: 205,
      lobbyId,
      category: 'flag',
      resultSignature: { outcome: 'victory', scoreLine: '3-1', mode, map },
    },
    {
      clipId: 'xU45LZvPkYg',
      playerId: 'auryn',
      participants,
      recordedAt: base + 30_000,
      durationSec: 208,
      lobbyId,
      category: 'ultimate',
      resultSignature: { outcome: 'defeat', scoreLine: '1-3', mode, map },
    },
  ]
}
