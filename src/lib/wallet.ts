/**
 * Wallet — the per-user balance of the two platform currencies.
 *
 * REAL PERSISTENCE. This used to be a `kc_wallet:<userId>` localStorage key,
 * which meant balances were per-browser and a cache clear wiped them. Balances
 * now live in the `wallets` table (db/schema.sql) and are **server-authoritative**:
 *
 *   • Reads      — `wallets` is select-'owner', so you can read your own row and
 *                  nobody else's. `readWallet()` stays SYNCHRONOUS by serving a
 *                  module-level cache that `loadWallet()` hydrates; React
 *                  surfaces render immediately and refresh on the wallet event.
 *   • Writes     — there are none from here. `wallets.tokens` / `.sweeps` are in
 *                  PRIVILEGE_COLS and the table is insert/write-'deny', so a
 *                  client CANNOT credit itself even with a hand-rolled request.
 *                  Every movement goes through a trusted /api/fn/* handler that
 *                  computes the amount from server state and books a
 *                  `wallet_ledger` row.
 *
 * Two currencies, deliberately kept distinct for legal-safety reasons:
 *   • Tokens — a UTILITY currency the user buys. Spent on premium match entry,
 *              profile customization and team gear. NEVER cashable.
 *   • Sweeps — FREE promotional points (the daily "no purchase necessary" grant
 *              and promos). Never sold directly. No cash payout, ever.
 *
 * LOCAL MODE: passing an explicit `storage` argument keeps the old localStorage
 * behaviour. That path is for unit tests and offline/no-backend use only — it
 * mints nothing that the server will ever see. The production callers pass
 * nothing and go through the server.
 */

import { callFn } from './backend'

export type Wallet = {
  /** utility currency — bought, never cashable */
  tokens: number
  /** free promotional points — never sold, prize-redeemable where legal */
  sweeps: number
  /** purchased marketplace credit, stored in integer USD cents */
  paid_sweeps_cents: number
}

const KEY_PREFIX = 'kc_wallet:'
const EVENT = 'kc:wallet'

// Storage is injectable so tests can pass a fake (LOCAL MODE — see the header).
export interface WalletStorage {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId || 'anon'}`
}

function empty(): Wallet {
  return { tokens: 0, sweeps: 0, paid_sweeps_cents: 0 }
}

function broadcast(): void {
  if (typeof window === 'undefined') return
  try { window.dispatchEvent(new CustomEvent(EVENT)) } catch { /* non-DOM */ }
}

// ─────────────────────────────────────────────────────────────────────────
//  The server-backed cache. `readWallet` is sync because every balance chip in
//  the app reads it during render; `loadWallet` fills it from the API and
//  broadcasts, so those chips update a tick later.
// ─────────────────────────────────────────────────────────────────────────

const cache = new Map<string, Wallet>()

/** Replace the cached balance for a user and notify every mounted surface. */
export function applyWalletSnapshot(userId: string, w: Partial<Wallet> | null | undefined): Wallet {
  const next: Wallet = {
    tokens: Number.isFinite(w?.tokens) ? Math.max(0, Number(w!.tokens)) : 0,
    sweeps: Number.isFinite(w?.sweeps) ? Math.max(0, Number(w!.sweeps)) : 0,
    paid_sweeps_cents: Number.isFinite(w?.paid_sweeps_cents)
      ? Math.max(0, Math.round(Number(w!.paid_sweeps_cents)))
      : 0,
  }
  cache.set(userId || 'anon', next)
  broadcast()
  return next
}

/** Drop cached balances (sign-out). */
export function clearWalletCache(): void {
  cache.clear()
  broadcast()
}

function readLocal(userId: string, storage: WalletStorage | null): Wallet {
  if (!storage) return empty()
  try {
    const raw = storage.getItem(keyFor(userId))
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as Partial<Wallet>
    return {
      tokens: Number.isFinite(parsed?.tokens) ? Number(parsed!.tokens) : 0,
      sweeps: Number.isFinite(parsed?.sweeps) ? Number(parsed!.sweeps) : 0,
      paid_sweeps_cents: Number.isFinite(parsed?.paid_sweeps_cents)
        ? Math.max(0, Math.round(Number(parsed!.paid_sweeps_cents)))
        : 0,
    }
  } catch {
    return empty()
  }
}

function writeLocal(userId: string, wallet: Wallet, storage: WalletStorage | null): void {
  if (!storage) return
  try {
    storage.setItem(keyFor(userId), JSON.stringify(wallet))
  } catch { /* quota / private mode */ }
  broadcast()
}

/**
 * A user's current balances.
 *
 * Sync. With no `storage` argument this serves the server-hydrated cache (call
 * `loadWallet` once per session / on sign-in). With an explicit `storage` it
 * reads that store directly — LOCAL MODE, for tests.
 */
export function readWallet(userId: string, storage?: WalletStorage | null): Wallet {
  if (storage !== undefined) return readLocal(userId, storage)
  return { ...(cache.get(userId || 'anon') ?? empty()) }
}

/**
 * Fetch the authoritative balances from the server into the cache. Creates the
 * wallet row on first call (that is the only thing this endpoint does — it
 * cannot credit anything). Returns an empty wallet when signed out or offline.
 */
export async function loadWallet(userId: string): Promise<Wallet> {
  if (!userId) return empty()
  const data = await callFn<{ ok: boolean; wallet: Wallet }>('wallet')
  if (!data?.wallet) return readWallet(userId)
  return applyWalletSnapshot(userId, data.wallet)
}

export type DailyClaim = { ok: boolean; granted: number; wallet: Wallet; reason?: string }

/**
 * Claim the free daily Sweeps points ("no purchase necessary", Rule 3 of
 * docs/sweepstakes-economics.md).
 *
 * The once-a-day guard is the SERVER's `wallet_ledger` row for today, not a
 * localStorage key — the old `kc_daily_sweeps:<user>:<date>` key could simply be
 * deleted from devtools for unlimited points.
 */
export async function claimDailySweeps(userId: string): Promise<DailyClaim> {
  if (!userId) return { ok: false, granted: 0, wallet: empty(), reason: 'no-user' }
  const data = await callFn<{ ok: boolean; granted?: number; wallet?: Wallet; reason?: string }>('sweeps-daily')
  if (!data) return { ok: false, granted: 0, wallet: readWallet(userId), reason: 'unavailable' }
  const wallet = data.wallet ? applyWalletSnapshot(userId, data.wallet) : readWallet(userId)
  return { ok: !!data.ok, granted: Number(data.granted ?? 0), wallet, reason: data.reason }
}

// ─────────────────────────────────────────────────────────────────────────
//  LOCAL MODE ONLY — the `storage` parameter is REQUIRED on purpose.
//
//  Nothing in the app credits a wallet from the client any more. Making the
//  store explicit means the compiler catches any attempt to reintroduce a
//  client-side mint: there is no `addToWallet(userId, { tokens: 1000 })`.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Add to (or subtract from) balances IN A LOCAL STORE. Clamped at zero. Used by
 * unit tests and the no-backend offline path; the server is the real ledger.
 */
export function addToWallet(
  userId: string,
  delta: Partial<Wallet>,
  storage: WalletStorage | null,
): Wallet {
  const cur = readLocal(userId, storage)
  const next: Wallet = {
    tokens: Math.max(0, cur.tokens + (delta.tokens ?? 0)),
    sweeps: Math.max(0, cur.sweeps + (delta.sweeps ?? 0)),
    paid_sweeps_cents: Math.max(
      0,
      cur.paid_sweeps_cents + Math.round(delta.paid_sweeps_cents ?? 0),
    ),
  }
  writeLocal(userId, next, storage)
  return next
}

/** Local-store token credit. See addToWallet. */
export function addTokens(userId: string, amount: number, storage: WalletStorage | null): Wallet {
  return addToWallet(userId, { tokens: amount }, storage)
}

/** Local-store sweeps credit. See addToWallet. */
export function addSweeps(userId: string, amount: number, storage: WalletStorage | null): Wallet {
  return addToWallet(userId, { sweeps: amount }, storage)
}

/** Subscribe a component to wallet changes. Returns an unsubscribe fn. */
export function subscribeWallet(cb: () => void): () => void {
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
