/**
 * Winnings / prizes ledger — the "Winnings & Prizes" card on the profile.
 *
 * REAL PERSISTENCE. This used to be a `kc_ledger:<userId>` localStorage key with
 * no backing table, which meant a settled prize existed only in the winner's own
 * browser. Entries now come from the `wallet_ledger` table (db/schema.sql), the
 * same append-only table that records every Token/Sweeps movement:
 *
 *   • READ  — `wallet_ledger` is select-'owner': your own rows only.
 *   • WRITE — insert is 'deny'. There is no `addLedgerEntry` any more, because a
 *             client-written ledger row is a claim, not a record. Rows are
 *             written by the trusted handlers at the moment the thing they
 *             describe actually happens: /api/fn/prediction-resolve books the
 *             Win/Loss, /api/fn/king-prize books the artifact, /api/fn/asset-buy
 *             and /api/fn/clan-pay book the spend.
 *
 * `getLedger()` stays synchronous over a cache that `loadLedger()` hydrates, so
 * the profile card renders without a loading state.
 *
 * NO CASH. `amount` is Sweeps Points (a free promotional currency) or 0 for a
 * pure-prestige artifact. Nothing here cashes out.
 */

import { supabase } from './supabase'

export type LedgerResult = 'Win' | 'Loss'
export type LedgerStatus = 'Pending' | 'Paid'
export type LedgerKind = 'tournament' | 'prediction'

export interface LedgerEntry {
  id: string
  /** ISO timestamp of when the result settled. */
  date: string
  /** Human label for the event, e.g. "Weekly Shinobi Cup" or "TKO King". */
  event: string
  /** Whether this entry is a tournament payout or a sweeps prediction. */
  kind: LedgerKind
  result: LedgerResult
  /** Sweeps Points amount (positive number). 0 for a pure-prestige artifact. */
  amount: number
  /** Prize description (e.g. "TKO King Crown") when the reward isn't points. */
  prize?: string | null
  status: LedgerStatus
}

/** A `wallet_ledger` row as the table stores it. */
type LedgerRow = {
  id: string
  kind: string | null
  tokens_delta: number | null
  sweeps_delta: number | null
  event: string | null
  result: string | null
  prize: string | null
  status: string | null
  created_at: string | null
}

const EVENT = 'kc:ledger'
const cache = new Map<string, LedgerEntry[]>()

function broadcast(): void {
  if (typeof window === 'undefined') return
  try { window.dispatchEvent(new CustomEvent(EVENT)) } catch { /* non-DOM */ }
}

/**
 * Only the rows that represent a SETTLED outcome belong on the winnings card —
 * a token spend is a purchase, not a win. Those rows carry a `result`.
 */
function rowToEntry(r: LedgerRow): LedgerEntry | null {
  if (r.result !== 'Win' && r.result !== 'Loss') return null
  return {
    id: String(r.id),
    date: r.created_at ?? new Date(0).toISOString(),
    event: String(r.event ?? 'Event'),
    kind: r.kind === 'tournament' ? 'tournament' : 'prediction',
    result: r.result,
    amount: Math.max(0, Number(r.sweeps_delta ?? 0)),
    prize: r.prize ?? null,
    status: r.status === 'Pending' ? 'Pending' : 'Paid',
  }
}

/** Drop cached ledger entries (sign-out). */
export function clearLedgerCache(): void {
  cache.clear()
  broadcast()
}

/**
 * All settled entries for a user, newest first. Synchronous over the cache —
 * call `loadLedger()` to fill it.
 */
export function getLedger(userId: string): LedgerEntry[] {
  if (!userId) return []
  return [...(cache.get(userId) ?? [])]
}

/** Fetch the user's settled ledger rows from the server into the cache. */
export async function loadLedger(userId: string): Promise<LedgerEntry[]> {
  if (!userId) return []
  try {
    const { data, error } = await supabase
      .from('wallet_ledger')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) return getLedger(userId)
    const rows = (Array.isArray(data) ? data : []) as LedgerRow[]
    cache.set(
      userId,
      rows.map(rowToEntry).filter((e): e is LedgerEntry => e !== null),
    )
    broadcast()
    return getLedger(userId)
  } catch {
    return getLedger(userId)
  }
}

/** Subscribe a component to ledger changes. Returns an unsubscribe fn. */
export function subscribeLedger(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => cb()
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

export interface LedgerTotals {
  /** Sum of Sweeps Points from winning entries (no prize attached). */
  totalWon: number
  /** Count of prizes received (Paid entries that carry a prize label). */
  totalPrizes: number
}

/** Derive headline totals for the "Winnings & Prizes" card. */
export function ledgerTotals(entries: LedgerEntry[]): LedgerTotals {
  let totalWon = 0
  let totalPrizes = 0
  for (const e of entries) {
    if (e.result === 'Win' && !e.prize) totalWon += e.amount
    if (e.prize && e.status === 'Paid') totalPrizes += 1
  }
  return { totalWon, totalPrizes }
}
