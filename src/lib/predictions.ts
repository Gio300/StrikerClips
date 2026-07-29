/**
 * Oracle Predictions — tier-gated tournament winner guessing.
 *
 * This is the new, cash-free form of the old "sweepstakes store". Users do NOT
 * bet money. They GUESS the winner of a tournament; a correct guess earns a
 * cosmetic DigitalAsset (badge skin / emote) into their locker plus progress
 * toward Oracle badges. A user's TIER caps how many tournaments they can hold an
 * OPEN prediction on at once (see predictionQuota in tiers.ts).
 *
 * REAL PERSISTENCE. This used to be a `kc_predictions:<userId>` localStorage
 * key, and — worse — resolution ran client-side per user, so two people could
 * grade the same tournament differently and nothing stopped a user from marking
 * their own pick correct. Predictions now live in the `predictions` table:
 *
 *   • READ   — `predictions` is select-'owner': your own rows, nobody else's.
 *              `readPredictions()` stays synchronous over a cache that
 *              `loadPredictions()` hydrates.
 *   • WRITE  — insert/update/delete are ALL 'deny' through the generic API. The
 *              three mutations go through trusted handlers:
 *                submitPrediction()  -> /api/fn/prediction-make
 *                withdrawPrediction()-> /api/fn/prediction-cancel
 *                gradePrediction()   -> /api/fn/prediction-resolve
 *              The tier quota is enforced from the account's real tier, and the
 *              GRADE is read from the recorded `tournament_results` row — the
 *              client no longer says who won. A correct pick's cosmetic is
 *              granted by the server into `asset_ownership` (source='reward').
 *
 * The pure helpers (canPredict / openCount / correctCount / currentStreak /
 * accuracy) still take a Prediction[] and touch nothing, so they stay
 * unit-testable without a DOM. Stats are DERIVED rather than cached, so there is
 * a single source of truth. Broadcasts `kc:predictions` on every change.
 *
 * NO cash anywhere: a correct guess earns a cosmetic and Oracle-badge progress.
 *
 * LOCAL MODE: the mutating helpers (makePrediction / cancelPrediction /
 * resolvePrediction) take a REQUIRED `storage` and operate on it alone. They are
 * for unit tests and offline demos; nothing they write reaches the server. The
 * required parameter is what stops a client-side grade sneaking back in.
 */

import { backend, callFn } from './backend'
import { predictionQuota } from './tiers'
import { grantAsset, noteGranted, rowToAsset, type DigitalAsset, type AssetStorage } from './assets'

export type PredictionStatus = 'open' | 'correct' | 'wrong'

export interface PredictionPick {
  /**
   * Who the user thinks will win, as an id we can resolve against a recorded
   * winner. When picking a known entrant this is their profile id (matches
   * tournament_results.winner_profile_id). For a free-text fallback it's just
   * the typed name (won't auto-match a profile id — see the UI note).
   */
  winnerId: string
  /** Human label shown in the UI (team name or username). */
  label: string
}

export interface Prediction {
  tournamentId: string
  userId: string
  pick: PredictionPick
  createdAt: number
  status: PredictionStatus
  /** Set when the prediction is graded correct/wrong against a recorded winner. */
  resolvedAt?: number
}

const KEY_PREFIX = 'kc_predictions:'
const EVENT = 'kc:predictions'

// Storage is injectable so tests can pass a fake; defaults to localStorage.
export interface PredictionStorage {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId || 'anon'}`
}

function broadcast(): void {
  if (typeof window === 'undefined') return
  try { window.dispatchEvent(new CustomEvent(EVENT)) } catch { /* non-DOM */ }
}

// ─────────────────────────────────────────────────────────────────────────
//  Pure, DOM-free stat helpers — operate on a Prediction[] and touch nothing.
// ─────────────────────────────────────────────────────────────────────────

/** Number of still-open (ungraded) predictions. */
export function openCount(preds: Prediction[]): number {
  return preds.filter((p) => p.status === 'open').length
}

/** Cumulative CORRECT predictions — the number that drives oracle badges. */
export function correctCount(preds: Prediction[]): number {
  return preds.filter((p) => p.status === 'correct').length
}

/** Cumulative WRONG predictions. */
export function wrongCount(preds: Prediction[]): number {
  return preds.filter((p) => p.status === 'wrong').length
}

/**
 * Accuracy over RESOLVED predictions (correct / (correct + wrong)), 0..1.
 * Returns 0 when nothing has resolved yet (avoids divide-by-zero).
 */
export function accuracy(preds: Prediction[]): number {
  const c = correctCount(preds)
  const w = wrongCount(preds)
  const resolved = c + w
  return resolved === 0 ? 0 : c / resolved
}

/**
 * Current winning streak: consecutive CORRECT predictions counting back from the
 * most recently resolved. A single wrong result resets it to 0. Open predictions
 * are ignored (they haven't been graded). Deterministic given resolvedAt.
 */
export function currentStreak(preds: Prediction[]): number {
  const resolved = preds
    .filter((p) => p.status === 'correct' || p.status === 'wrong')
    .sort((a, b) => (a.resolvedAt ?? a.createdAt) - (b.resolvedAt ?? b.createdAt))
  let streak = 0
  for (let i = resolved.length - 1; i >= 0; i--) {
    if (resolved[i].status === 'correct') streak++
    else break
  }
  return streak
}

/**
 * PURE quota gate: may a user with `open` currently-open predictions start
 * another, given their tier? This is the one the UI + tests call to enforce the
 * cap. Free tiers → 1, creator → Infinity (see PREDICTION_QUOTA in tiers.ts).
 */
export function canPredict(open: number, tier: string | undefined | null): boolean {
  return open < predictionQuota(tier)
}

// ─────────────────────────────────────────────────────────────────────────
//  Reward pool — cosmetics a correct prediction awards into the locker.
//  All rewards share the `oracle-reward-` id prefix + teamName 'Oracle' so the
//  Oracle page can pick them out of getOwned(). priceTokens is 0 — these are
//  never for sale, only earned. (A real backend seeds these as reward rows.)
// ─────────────────────────────────────────────────────────────────────────

export const REWARD_ID_PREFIX = 'oracle-reward-'

export const PREDICTION_REWARDS: DigitalAsset[] = [
  {
    id: 'oracle-reward-crystal-emote',
    name: 'Crystal Ball Emote',
    teamName: 'Oracle',
    imageUrl: 'https://placehold.co/400x400/2a1a3e/c084fc?text=Oracle+Emote',
    priceTokens: 0,
    kind: 'emote',
    sellerType: 'official',
    clanId: null,
    createdBy: 'oracle',
    createdAt: 0,
  },
  {
    id: 'oracle-reward-violet-skin',
    name: 'Violet Oracle Badge Skin',
    teamName: 'Oracle',
    imageUrl: 'https://placehold.co/400x400/1e1b4b/a78bfa?text=Oracle+Skin',
    priceTokens: 0,
    kind: 'badge_skin',
    sellerType: 'official',
    clanId: null,
    createdBy: 'oracle',
    createdAt: 0,
  },
  {
    id: 'oracle-reward-starfall-emote',
    name: 'Starfall Emote',
    teamName: 'Oracle',
    imageUrl: 'https://placehold.co/400x400/3b2f0b/fde68a?text=Starfall',
    priceTokens: 0,
    kind: 'emote',
    sellerType: 'official',
    clanId: null,
    createdBy: 'oracle',
    createdAt: 0,
  },
  {
    id: 'oracle-reward-astral-skin',
    name: 'Astral Oracle Badge Skin',
    teamName: 'Oracle',
    imageUrl: 'https://placehold.co/400x400/0b1e3b/93c5fd?text=Astral',
    priceTokens: 0,
    kind: 'badge_skin',
    sellerType: 'official',
    clanId: null,
    createdBy: 'oracle',
    createdAt: 0,
  },
]

/** True when an asset id belongs to the earned-reward pool (not a bought item). */
export function isRewardAssetId(id: string): boolean {
  return id.startsWith(REWARD_ID_PREFIX)
}

/**
 * The reward a user gets for their Nth correct prediction (1-indexed). Cycles
 * through the pool so it's deterministic and testable. `correctCountAfter` is
 * the user's total correct count AFTER this resolution.
 */
export function rewardForCorrect(correctCountAfter: number): DigitalAsset {
  const n = Number.isFinite(correctCountAfter) ? Math.max(1, Math.floor(correctCountAfter)) : 1
  const i = (n - 1) % PREDICTION_REWARDS.length
  return PREDICTION_REWARDS[i]
}

// ─────────────────────────────────────────────────────────────────────────
//  Storage-backed read/write + actions (mirror assets.ts).
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
//  The server-backed cache + its hydration.
// ─────────────────────────────────────────────────────────────────────────

const cache = new Map<string, Prediction[]>()

/** A `predictions` row as the table stores it. */
type PredictionRow = {
  id: string
  user_id: string
  tournament_id: string
  winner_id: string
  pick_label: string | null
  status: string | null
  reward_asset_id: string | null
  resolved_at: string | null
  created_at: string | null
}

const millis = (v: string | null | undefined): number => {
  const t = v ? new Date(v).getTime() : 0
  return Number.isFinite(t) ? t : 0
}

function rowToPrediction(r: PredictionRow): Prediction {
  const status: PredictionStatus =
    r.status === 'correct' || r.status === 'wrong' ? r.status : 'open'
  return {
    tournamentId: String(r.tournament_id),
    userId: String(r.user_id),
    pick: { winnerId: String(r.winner_id ?? ''), label: String(r.pick_label ?? '') },
    createdAt: millis(r.created_at),
    status,
    ...(r.resolved_at ? { resolvedAt: millis(r.resolved_at) } : {}),
  }
}

/** Drop cached predictions (sign-out). */
export function clearPredictionCache(): void {
  cache.clear()
  broadcast()
}

/** Pull the signed-in user's predictions from the server into the cache. */
export async function loadPredictions(userId: string): Promise<Prediction[]> {
  if (!userId) return []
  try {
    const sb = await backend()
    if (!sb) return readPredictions(userId)
    const { data, error } = await sb
      .from('predictions')
      .select('*')
      .eq('user_id', userId)
    if (error) return readPredictions(userId)
    const rows = (Array.isArray(data) ? data : []) as PredictionRow[]
    cache.set(userId, rows.map(rowToPrediction))
    broadcast()
    return readPredictions(userId)
  } catch {
    return readPredictions(userId)
  }
}

/**
 * A user's predictions.
 *
 * Sync. With no `storage` this serves the server-hydrated cache; with an
 * explicit `storage` it reads that store — LOCAL MODE, for tests.
 */
export function readPredictions(
  userId: string,
  storage?: PredictionStorage | null,
): Prediction[] {
  if (storage === undefined) return [...(cache.get(userId) ?? [])]
  if (!storage) return []
  try {
    const raw = storage.getItem(keyFor(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Prediction[]) : []
  } catch {
    return []
  }
}

function writePredictions(
  userId: string,
  preds: Prediction[],
  storage: PredictionStorage | null,
): void {
  if (!storage) return
  try {
    storage.setItem(keyFor(userId), JSON.stringify(preds))
  } catch { /* quota / private mode */ }
  broadcast()
}

export type MakePredictionResult =
  | { ok: true; prediction: Prediction }
  | { ok: false; reason: 'no-user' | 'exists' | 'quota' }

/**
 * LOCAL MODE. Make a prediction in the given store. Enforces:
 *   • one OPEN prediction per tournament per user ('exists'),
 *   • the tier quota on total open predictions ('quota').
 *
 * `storage` is REQUIRED: the server path is `submitPrediction()`, which enforces
 * the same two rules against the account's real tier rather than a value the
 * caller passed in.
 */
export function makePrediction(
  input: {
    userId: string
    tournamentId: string
    pick: PredictionPick
    tier: string | undefined | null
  },
  storage: PredictionStorage | null,
  now: number = Date.now(),
): MakePredictionResult {
  if (!input.userId) return { ok: false, reason: 'no-user' }
  const all = readPredictions(input.userId, storage)
  const hasOpen = all.some(
    (p) => p.tournamentId === input.tournamentId && p.status === 'open',
  )
  if (hasOpen) return { ok: false, reason: 'exists' }
  if (!canPredict(openCount(all), input.tier)) return { ok: false, reason: 'quota' }

  const prediction: Prediction = {
    tournamentId: input.tournamentId,
    userId: input.userId,
    pick: { winnerId: input.pick.winnerId, label: input.pick.label },
    createdAt: now,
    status: 'open',
  }
  writePredictions(input.userId, [prediction, ...all], storage)
  return { ok: true, prediction }
}

/**
 * LOCAL MODE. Cancel a user's OPEN prediction for a tournament (before it's
 * graded). Resolved predictions are kept as history. Returns true if one was
 * removed. The server path is `withdrawPrediction()`, which likewise can only
 * ever delete an OPEN row — a resolved loss cannot be erased to inflate
 * accuracy.
 */
export function cancelPrediction(
  userId: string,
  tournamentId: string,
  storage: PredictionStorage | null,
): boolean {
  const all = readPredictions(userId, storage)
  const next = all.filter(
    (p) => !(p.tournamentId === tournamentId && p.status === 'open'),
  )
  if (next.length === all.length) return false
  writePredictions(userId, next, storage)
  return true
}

export type ResolveResult =
  | { resolved: false }
  | { resolved: true; status: 'correct' | 'wrong'; reward?: DigitalAsset }

/**
 * LOCAL MODE. Resolve a user's OPEN prediction against a winner id the CALLER
 * supplies. Correct ⇒ status 'correct' plus a reward cosmetic in the locker;
 * wrong ⇒ status 'wrong', which resets the derived streak. No-op when there's
 * no open prediction.
 *
 * `storage` and `winnerId` are both required here precisely because this shape
 * is not safe against a real backend — a client that names the winner can name
 * itself correct. The server path is `gradePrediction(userId, tournamentId)`,
 * which takes NO winner: it reads the recorded `tournament_results` row.
 */
export function resolvePrediction(
  userId: string,
  tournamentId: string,
  winnerId: string,
  storage: PredictionStorage | null,
  now: number = Date.now(),
): ResolveResult {
  const all = readPredictions(userId, storage)
  const idx = all.findIndex(
    (p) => p.tournamentId === tournamentId && p.status === 'open',
  )
  if (idx === -1) return { resolved: false }

  const p = all[idx]
  const correct = Boolean(winnerId) && p.pick.winnerId === winnerId
  const status: 'correct' | 'wrong' = correct ? 'correct' : 'wrong'
  const next = [...all]
  next[idx] = { ...p, status, resolvedAt: now }
  writePredictions(userId, next, storage)

  if (!correct) return { resolved: true, status }

  const reward = rewardForCorrect(correctCount(next))
  // Reuse the assets grant mechanism. PredictionStorage + AssetStorage are the
  // same shape, so a single mem shim covers both keys in tests.
  grantAsset(userId, reward, storage as AssetStorage | null)
  return { resolved: true, status, reward }
}

// ─────────────────────────────────────────────────────────────────────────
//  Convenience reads for the surfaces.
// ─────────────────────────────────────────────────────────────────────────

export interface PredictionStats {
  total: number
  openCount: number
  correctCount: number
  wrongCount: number
  streak: number
  /** 0..1 over resolved predictions. */
  accuracy: number
}

/** Derived stats for a user — all pure helpers applied to their stored array. */
export function getStats(
  userId: string,
  storage?: PredictionStorage | null,
): PredictionStats {
  const all = readPredictions(userId, storage)
  return {
    total: all.length,
    openCount: openCount(all),
    correctCount: correctCount(all),
    wrongCount: wrongCount(all),
    streak: currentStreak(all),
    accuracy: accuracy(all),
  }
}

/** The user's current OPEN prediction for a tournament, or null. */
export function getOpenForTournament(
  userId: string,
  tournamentId: string,
  storage?: PredictionStorage | null,
): Prediction | null {
  return (
    readPredictions(userId, storage).find(
      (p) => p.tournamentId === tournamentId && p.status === 'open',
    ) ?? null
  )
}

/**
 * The user's latest prediction for a tournament — the open one if any, otherwise
 * the most recently resolved. Used to render the Oracle card's outcome.
 */
export function getPredictionForTournament(
  userId: string,
  tournamentId: string,
  storage?: PredictionStorage | null,
): Prediction | null {
  const all = readPredictions(userId, storage).filter(
    (p) => p.tournamentId === tournamentId,
  )
  const open = all.find((p) => p.status === 'open')
  if (open) return open
  return (
    all
      .slice()
      .sort((a, b) => (b.resolvedAt ?? b.createdAt) - (a.resolvedAt ?? a.createdAt))[0] ??
    null
  )
}

/** All of a user's predictions, newest first (open + resolved). */
export function getPredictions(
  userId: string,
  storage?: PredictionStorage | null,
): Prediction[] {
  return readPredictions(userId, storage)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
}

// ─────────────────────────────────────────────────────────────────────────
//  SERVER PATH — the three mutations, as trusted /api/fn/* calls.
//
//  None of these takes an amount, a grade or a winner from the caller. That is
//  the whole difference between this and the localStorage version it replaced.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Make a prediction. The server re-checks BOTH gates — one open prediction per
 * tournament, and the tier quota read off the account — so the `tier` the UI
 * knows about is a display hint, not the enforcement.
 */
export async function submitPrediction(input: {
  userId: string
  tournamentId: string
  pick: PredictionPick
}): Promise<MakePredictionResult> {
  if (!input.userId) return { ok: false, reason: 'no-user' }
  try {
    const data = await callFn<{ ok: boolean; reason?: string; prediction?: PredictionRow }>(
      'prediction-make',
      {
        tournamentId: input.tournamentId,
        winnerId: input.pick.winnerId,
        label: input.pick.label,
      },
    )
    if (!data) return { ok: false, reason: 'quota' }
    if (!data.ok || !data.prediction) {
      return { ok: false, reason: data.reason === 'exists' ? 'exists' : 'quota' }
    }
    const prediction = rowToPrediction(data.prediction)
    cache.set(input.userId, [prediction, ...readPredictions(input.userId)])
    broadcast()
    return { ok: true, prediction }
  } catch {
    return { ok: false, reason: 'quota' }
  }
}

/** Withdraw an OPEN prediction. Resolved history is never touched. */
export async function withdrawPrediction(userId: string, tournamentId: string): Promise<boolean> {
  if (!userId) return false
  try {
    const data = await callFn<{ ok: boolean; cancelled: boolean }>('prediction-cancel', { tournamentId })
    if (!data?.cancelled) return false
    cache.set(
      userId,
      readPredictions(userId).filter((p) => !(p.tournamentId === tournamentId && p.status === 'open')),
    )
    broadcast()
    return true
  } catch {
    return false
  }
}

/**
 * Grade the caller's open prediction for a tournament.
 *
 * Note what is NOT a parameter: the winner. The server reads the recorded
 * `tournament_results` row, so every user is graded against the same result and
 * nobody can declare themselves correct. On a correct pick the server also
 * inserts the reward cosmetic into `asset_ownership` (source='reward'); we only
 * mirror that into the local locker cache here.
 */
export async function gradePrediction(userId: string, tournamentId: string): Promise<ResolveResult> {
  if (!userId) return { resolved: false }
  try {
    const data = await callFn<{
      ok: boolean; resolved: boolean; status?: string; asset?: Parameters<typeof rowToAsset>[0]
    }>('prediction-resolve', { tournamentId })
    if (!data?.ok || !data.resolved) return { resolved: false }
    const status: 'correct' | 'wrong' = data.status === 'correct' ? 'correct' : 'wrong'
    // Refresh from the server so status + resolvedAt are the stored values.
    await loadPredictions(userId)
    if (status === 'wrong') return { resolved: true, status }
    const reward = data.asset ? rowToAsset(data.asset) : undefined
    if (reward) noteGranted(userId, reward)
    return { resolved: true, status, reward }
  } catch {
    return { resolved: false }
  }
}

/** Subscribe a component to prediction changes. Returns an unsubscribe fn. */
export function subscribePredictions(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => cb()
  window.addEventListener(EVENT, handler)
  // storage event fires cross-tab; local dispatch covers same-tab.
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}
