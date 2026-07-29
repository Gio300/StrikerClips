/**
 * WagerPanel — live sweeps wagering on a match.
 *
 * SWEEPS ONLY. Sweeps are the in-app, non-cashable currency — there is no real
 * money in or out here, so this is play, not gambling. A host opens a pool with
 * named options; viewers stake sweeps on an option; when the host resolves,
 * winners split the whole pool pro-rata (server-side, escrow through the trusted
 * wallet path). One wager per person per pool.
 *
 * Backend fns: wager-open / wager-place / wager-lock / wager-resolve /
 * wager-cancel. Pools are public-read (wager_pools); a viewer's own wager is
 * owner-read (wagers). Tailwind core + inline SVG only.
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useWallet } from '@/hooks/useWallet'
import { callFn } from '@/lib/backend'
import { supabase } from '@/lib/supabase'

interface WagerPool {
  id: string
  match_ref: string
  title: string
  options: string[]
  status: 'open' | 'locked' | 'resolved' | 'cancelled'
  winning_option: string | null
}

interface MyWager {
  option: string
  sweeps: number
  status: string
  payout: number
}

export interface WagerPanelProps {
  /** Stable id for the match (same ref used by the Oracle widget). */
  matchRef: string
  /** Default option labels a host can open a pool with (e.g. the two teams). */
  defaultOptions?: string[]
  title?: string
  className?: string
}

export function WagerPanel({ matchRef, defaultOptions, title = 'Sweeps wager', className = '' }: WagerPanelProps) {
  const { user } = useAuth()
  const { sweeps, refresh } = useWallet()
  const isHost = user?.user_metadata?.tko_host === true

  const [pool, setPool] = useState<WagerPool | null>(null)
  const [mine, setMine] = useState<MyWager | null>(null)
  const [amount, setAmount] = useState(10)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const loadPool = useCallback(async () => {
    if (!matchRef) return
    // wager_pools / wagers aren't in the generated Supabase types yet — cast to
    // reach them (same approach the artifact-tag reads use).
    const db = supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => any
      }
    }
    const { data } = await db
      .from('wager_pools')
      .select('*')
      .eq('match_ref', matchRef)
      .order('created_at', { ascending: false })
      .limit(1)
    const p = ((data ?? [])[0] as WagerPool) || null
    setPool(p)
    if (p && user) {
      const { data: w } = await db
        .from('wagers')
        .select('option, sweeps, status, payout')
        .eq('pool_id', p.id)
        .limit(1)
      setMine(((w ?? [])[0] as MyWager) || null)
    } else {
      setMine(null)
    }
  }, [matchRef, user?.id])

  useEffect(() => {
    loadPool()
    const id = window.setInterval(loadPool, 8000)
    return () => window.clearInterval(id)
  }, [loadPool])

  async function place(option: string) {
    if (!user || busy) return
    const stake = Math.floor(Number(amount) || 0)
    if (stake <= 0) { setNote('Enter how many sweeps to stake.'); return }
    if (stake > sweeps) { setNote("You don't have that many sweeps."); return }
    setBusy(true); setNote(null)
    const res = await callFn<{ ok: boolean; reason?: string }>('wager-place', { poolId: pool!.id, option, sweeps: stake })
    setBusy(false)
    if (res?.ok) { await Promise.all([refresh(), loadPool()]); setNote('Stake locked in. Good luck!') }
    else setNote(reason(res?.reason))
  }

  async function host(name: string, body: Record<string, unknown>, ok: string) {
    if (busy) return
    setBusy(true); setNote(null)
    const res = await callFn<{ ok: boolean; reason?: string }>(name, body)
    setBusy(false)
    if (res?.ok) { await Promise.all([refresh(), loadPool()]); setNote(ok) }
    else setNote(reason(res?.reason))
  }

  const opts = pool?.options ?? defaultOptions ?? ['Team A', 'Team B']

  if (!user) {
    return (
      <div className={`rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 ${className}`}>
        <Header title={title} />
        <p className="text-sm text-gray-400">Log in to wager sweeps on this match.</p>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <Header title={pool?.title || title} />
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-amber-200">
          <SweepIcon /> {sweeps.toLocaleString()}
        </span>
      </div>

      {/* No pool yet */}
      {!pool && (
        isHost ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => host('wager-open', { matchRef, title, options: opts }, 'Wager opened — viewers can stake now.')}
            className="w-full px-3 py-2.5 rounded-lg bg-amber-500 text-dark font-semibold hover:brightness-110 disabled:opacity-50"
          >
            Open a sweeps wager
          </button>
        ) : (
          <p className="text-sm text-gray-400">No wager open for this match yet.</p>
        )
      )}

      {/* Open pool — place a stake */}
      {pool?.status === 'open' && !mine && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-gray-400">Stake</span>
            <input
              type="number" min={1} value={amount}
              onChange={(e) => setAmount(Math.max(1, Math.floor(Number(e.target.value) || 0)))}
              className="w-24 px-2 py-1.5 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-amber-400"
            />
            <span className="text-xs text-gray-400">sweeps on…</span>
          </div>
          <div className={`grid gap-2 ${opts.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {opts.map((o) => (
              <button key={o} type="button" disabled={busy} onClick={() => place(o)}
                className="px-3 py-2.5 rounded-lg border border-amber-500/40 bg-dark-card text-sm font-semibold text-amber-100 hover:bg-amber-500/15 disabled:opacity-50 transition-colors">
                {o}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-500 mt-2">Winners split the whole pool. Sweeps have no cash value.</p>
        </>
      )}

      {/* Your locked stake */}
      {mine && (
        <div className="rounded-lg border border-amber-500/30 bg-dark-card px-3 py-3 text-sm">
          You staked <span className="font-semibold text-amber-200">{mine.sweeps.toLocaleString()}</span> sweeps on{' '}
          <span className="font-semibold text-amber-200">{mine.option}</span>.
          {pool?.status === 'resolved' && (
            <div className="mt-1 text-xs">
              {mine.status === 'won'
                ? <span className="text-green-400">You won {mine.payout.toLocaleString()} sweeps! 🎉</span>
                : mine.status === 'refunded'
                  ? <span className="text-gray-400">Refunded.</span>
                  : <span className="text-gray-400">No luck this time.</span>}
            </div>
          )}
          {pool?.status === 'locked' && <div className="mt-1 text-xs text-gray-400">Locked — waiting on the result.</div>}
        </div>
      )}

      {pool && pool.status !== 'open' && !mine && (
        <p className="text-sm text-gray-400">
          This wager is {pool.status}{pool.winning_option ? ` · winner: ${pool.winning_option}` : ''}.
        </p>
      )}

      {/* Host controls */}
      {isHost && pool && (pool.status === 'open' || pool.status === 'locked') && (
        <div className="mt-3 border-t border-amber-500/20 pt-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Host controls</p>
          <div className="flex flex-wrap gap-2">
            {pool.status === 'open' && (
              <button type="button" disabled={busy} onClick={() => host('wager-lock', { poolId: pool.id }, 'Locked — no more stakes.')}
                className="px-3 py-1.5 rounded-lg border border-dark-border text-xs font-semibold text-gray-200 hover:bg-dark-border disabled:opacity-50">Lock</button>
            )}
            {opts.map((o) => (
              <button key={o} type="button" disabled={busy}
                onClick={() => host('wager-resolve', { poolId: pool.id, winningOption: o }, `Resolved — ${o} wins the pool.`)}
                className="px-3 py-1.5 rounded-lg bg-amber-500 text-dark text-xs font-semibold hover:brightness-110 disabled:opacity-50">
                {o} wins
              </button>
            ))}
            <button type="button" disabled={busy} onClick={() => host('wager-cancel', { poolId: pool.id }, 'Cancelled — everyone refunded.')}
              className="px-3 py-1.5 rounded-lg border border-red-500/40 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50">Cancel & refund</button>
          </div>
        </div>
      )}

      {note && <p className="text-[11px] text-amber-300 mt-2">{note}</p>}
    </div>
  )
}

function reason(r?: string): string {
  switch (r) {
    case 'insufficient': return "You don't have enough sweeps."
    case 'duplicate': return 'You already have a wager on this pool.'
    case 'not-open': return 'This wager is closed.'
    case 'tokens-not-allowed': return 'Only sweeps can be staked.'
    case 'invalid-option': return 'Pick a valid option.'
    case 'invalid-amount': return 'Enter a valid stake.'
    default: return r ? `Could not complete: ${r}` : 'Something went wrong. Try again.'
  }
}

function Header({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <SweepIcon />
      <h3 className="text-sm font-bold text-amber-200">{title}</h3>
    </div>
  )
}

function SweepIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-300" fill="none" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v18M7 6l10 12M17 6L7 18" />
      <circle cx="12" cy="12" r="9" strokeWidth={1.2} opacity={0.4} />
    </svg>
  )
}

export default WagerPanel
