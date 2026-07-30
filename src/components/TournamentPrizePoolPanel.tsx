import { useCallback, useEffect, useMemo, useState } from 'react'
import { Coins, LockKeyhole, RefreshCw, ShieldCheck, Trophy, UsersRound } from 'lucide-react'
import { callFn } from '@/lib/backend'
import { useAuth } from '@/hooks/useAuth'
import { useWallet } from '@/hooks/useWallet'

type PrizeEntry = {
  id: string
  user_id: string
  amount: number
  status: 'pending' | 'escrowed' | 'refunded' | 'paid' | 'forfeited'
  username?: string | null
  avatar_url?: string | null
}

type PrizePayout = {
  user_id: string
  placement: number
  gross_amount: number
  net_amount: number
  status: string
  username?: string | null
}

type PrizePool = {
  id: string
  tournament_id: string
  currency: 'sweeps' | 'cash'
  entry_amount: number
  paid_places: number
  prize_split_bps: number[]
  status: 'draft' | 'open' | 'locked' | 'settled' | 'cancelled'
  pot: number
  entries: PrizeEntry[]
  payouts: PrizePayout[]
  mine: PrizeEntry | null
}

type PoolResponse = {
  ok: boolean
  pool?: PrizePool | null
  reason?: string
  error?: string
}

export function TournamentPrizePoolPanel({
  tournamentId,
  isHost,
}: {
  tournamentId: string
  isHost: boolean
}) {
  const { user } = useAuth()
  const { sweeps, refresh: refreshWallet } = useWallet()
  const [pool, setPool] = useState<PrizePool | null>(null)
  const [entryAmount, setEntryAmount] = useState(25)
  const [paidPlaces, setPaidPlaces] = useState(3)
  const [placements, setPlacements] = useState<string[]>(['', '', ''])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    const response = await callFn<PoolResponse>('tournament-prize-get', { tournamentId })
    if (response?.ok) {
      setPool(response.pool ?? null)
      const count = response.pool?.paid_places ?? 3
      setPlacements((current) => Array.from({ length: count }, (_, index) => current[index] ?? ''))
    }
  }, [tournamentId, user?.id])

  useEffect(() => {
    void load()
    const interval = window.setInterval(() => void load(), 10_000)
    return () => window.clearInterval(interval)
  }, [load])

  const activeEntries = useMemo(
    () => (pool?.entries ?? []).filter((entry) => entry.status === 'escrowed'),
    [pool],
  )

  async function act(
    name: string,
    body: Record<string, unknown>,
    successMessage: string,
  ) {
    if (busy) return
    setBusy(true)
    setNote(null)
    const response = await callFn<PoolResponse>(name, body)
    setBusy(false)
    if (!response?.ok) {
      setNote(prizePoolError(response?.reason, response?.error))
      return
    }
    setNote(successMessage)
    await Promise.all([load(), refreshWallet()])
  }

  if (!user) return null

  return (
    <section className="border-y border-dark-border py-5" aria-labelledby="prize-pool-heading">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
          <Trophy className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="prize-pool-heading" className="text-lg font-bold text-white">
              Tournament prize pool
            </h2>
            {pool && <StatusBadge status={pool.status} />}
          </div>
          <p className="mt-1 text-sm text-gray-400">
            Players enter with non-cash Sweeps. Verified finishers split the escrowed pot.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-amber-200">
          <Coins className="h-4 w-4" aria-hidden />
          {sweeps.toLocaleString()} Sweeps
        </div>
      </div>

      {!pool && isHost && (
        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="text-sm text-gray-300">
            Entry per player
            <input
              type="number"
              min={1}
              max={1_000_000}
              value={entryAmount}
              onChange={(event) => setEntryAmount(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
              className="mt-1.5 w-full rounded-lg border border-dark-border bg-dark px-3 py-2.5 text-white outline-none focus:border-amber-400"
            />
          </label>
          <label className="text-sm text-gray-300">
            Paid places
            <select
              value={paidPlaces}
              onChange={(event) => setPaidPlaces(Number(event.target.value))}
              className="mt-1.5 w-full rounded-lg border border-dark-border bg-dark px-3 py-2.5 text-white outline-none focus:border-amber-400"
            >
              <option value={1}>Winner takes all</option>
              <option value={2}>Top 2: 70 / 30</option>
              <option value={3}>Top 3: 70 / 20 / 10</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(
              'tournament-prize-open',
              { tournamentId, currency: 'sweeps', entryAmount, paidPlaces },
              'Sweeps pool is open.',
            )}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 font-bold text-black hover:bg-amber-300 disabled:opacity-50"
          >
            <Coins className="h-4 w-4" aria-hidden />
            Open pool
          </button>
        </div>
      )}

      {!pool && !isHost && (
        <p className="mt-4 text-sm text-gray-500">The host has not opened a prize pool for this tournament.</p>
      )}

      {pool && (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-3 divide-x divide-dark-border border-y border-dark-border">
            <Metric icon={<Coins className="h-4 w-4" />} label="Pot" value={`${pool.pot.toLocaleString()} Sweeps`} />
            <Metric icon={<ShieldCheck className="h-4 w-4" />} label="Entry" value={`${pool.entry_amount.toLocaleString()}`} />
            <Metric icon={<UsersRound className="h-4 w-4" />} label="Players" value={`${activeEntries.length}`} />
          </div>

          {pool.status === 'open' && !pool.mine && (
            <button
              type="button"
              disabled={busy || sweeps < pool.entry_amount}
              onClick={() => void act(
                'tournament-prize-join',
                { poolId: pool.id },
                `${pool.entry_amount.toLocaleString()} Sweeps entered into escrow.`,
              )}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 font-bold text-black hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              <Coins className="h-4 w-4" aria-hidden />
              Enter for {pool.entry_amount.toLocaleString()} Sweeps
            </button>
          )}

          {pool.status === 'open' && !pool.mine && sweeps < pool.entry_amount && (
            <p className="text-xs text-amber-300">You need more Sweeps to enter this pool.</p>
          )}

          {pool.mine && (
            <div className="flex items-center gap-2 text-sm text-cyan-200">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Your {pool.mine.amount.toLocaleString()} Sweeps are {entryStatus(pool.mine.status)}.
            </div>
          )}

          {pool.status === 'settled' && pool.payouts.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Final payouts</h3>
              <ol className="mt-2 divide-y divide-dark-border border-y border-dark-border">
                {pool.payouts.map((payout) => (
                  <li key={payout.user_id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="w-7 font-bold text-amber-300">#{payout.placement}</span>
                    <span className="min-w-0 flex-1 truncate text-white">{payout.username || 'Player'}</span>
                    <span className="font-semibold text-cyan-300">
                      {payout.net_amount.toLocaleString()} Sweeps
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {isHost && (pool.status === 'open' || pool.status === 'locked') && (
            <div className="border-t border-dark-border pt-4">
              <div className="flex flex-wrap items-center gap-2">
                {pool.status === 'open' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(
                      'tournament-prize-lock',
                      { poolId: pool.id },
                      'Pool locked. No more entries.',
                    )}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-dark-border px-3 py-2 text-sm font-semibold text-white hover:border-amber-400/60 disabled:opacity-50"
                  >
                    <LockKeyhole className="h-4 w-4" aria-hidden />
                    Lock entries
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(
                    'tournament-prize-cancel',
                    { poolId: pool.id },
                    'Pool cancelled. Every escrowed entry was refunded.',
                  )}
                  className="min-h-10 rounded-lg border border-red-500/40 px-3 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                >
                  Cancel and refund
                </button>
              </div>

              {activeEntries.length >= pool.paid_places && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-white">Verify placements</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    Select the official finishers. The server calculates every payout.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {placements.map((selected, index) => (
                      <label key={index} className="text-xs text-gray-400">
                        Place {index + 1}
                        <select
                          value={selected}
                          onChange={(event) => setPlacements((current) => (
                            current.map((value, place) => place === index ? event.target.value : value)
                          ))}
                          className="mt-1 w-full rounded-lg border border-dark-border bg-dark px-2.5 py-2 text-sm text-white outline-none focus:border-cyan-400"
                        >
                          <option value="">Select player</option>
                          {activeEntries.map((entry) => (
                            <option key={entry.user_id} value={entry.user_id}>
                              {entry.username || 'Player'}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={busy || placements.some((value) => !value)}
                    onClick={() => void act(
                      'tournament-prize-resolve',
                      { poolId: pool.id, placements },
                      'Placements verified and the prize pool was paid.',
                    )}
                    className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-black hover:bg-amber-300 disabled:opacity-50"
                  >
                    <Trophy className="h-4 w-4" aria-hidden />
                    Pay winners
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex items-start gap-2 border-t border-dark-border pt-4 text-xs text-gray-500">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Cash entry pools are prepared in the product model but remain off until an approved
          tournament-payment provider and legal review are complete. TKO does not route them through Stripe.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto shrink-0 rounded-md p-1 text-gray-400 hover:bg-white/5 hover:text-white"
          title="Refresh prize pool"
          aria-label="Refresh prize pool"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {note && <p className="mt-3 text-sm text-amber-200">{note}</p>}
    </section>
  )
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="min-w-0 px-3 py-3 first:pl-0 last:pr-0">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-bold text-white">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: PrizePool['status'] }) {
  const classes = status === 'open'
    ? 'border-green-400/40 bg-green-400/10 text-green-300'
    : status === 'locked'
      ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
      : status === 'settled'
        ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200'
        : 'border-gray-500/40 bg-gray-500/10 text-gray-400'
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${classes}`}>
      {status}
    </span>
  )
}

function entryStatus(status: PrizeEntry['status']): string {
  if (status === 'escrowed') return 'locked in escrow'
  if (status === 'paid') return 'included in the settled pool'
  if (status === 'refunded') return 'refunded'
  if (status === 'forfeited') return 'settled'
  return 'processing'
}

function prizePoolError(reason?: string, error?: string): string {
  if (error) return error
  switch (reason) {
    case 'insufficient':
      return 'You do not have enough Sweeps.'
    case 'duplicate':
      return 'You already entered this prize pool.'
    case 'not-open':
      return 'Entries are closed.'
    case 'age-verification-required':
      return 'Prize pools require a verified age of 18 or older.'
    case 'active-pool-exists':
      return 'This tournament already has an active prize pool.'
    case 'not-enough-entrants':
      return 'There are not enough entrants for every paid place.'
    case 'invalid-placements':
    case 'placement-not-entered':
      return 'Choose a different entered player for each paid place.'
    case 'approved-tournament-payment-provider-required':
      return 'Cash pools require an approved tournament-payment provider and are not enabled yet.'
    default:
      return reason ? `Could not complete: ${reason}` : 'The prize pool could not be updated.'
  }
}

export default TournamentPrizePoolPanel
