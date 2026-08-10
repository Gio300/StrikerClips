/**
 * OracleBet — the live Oracle BETTING widget (sits beside the Oracle CALL vote).
 *
 * MONEY-SAFE by construction, and it only appears where a bet is legal:
 *   • LIVE + HOST-TIER ONLY. On mount it asks the trusted `oracle-bet-config`
 *     endpoint whether this exact stream is eligible (genuinely live AND hosted
 *     by a top-tier user who may host). If not, the widget renders NOTHING —
 *     pre-recorded / non-host lives never show a bet slip.
 *   • ONE BET PER GAME. If the server reports an existing bet for this match it
 *     opens straight into the locked state.
 *   • STAKES (Rule 3): oracle TICKETS ($0), PAID sweeps (real ¢ — the only stake
 *     that earns the streamer anything), or a FORGED/PURCHASED artifact ($0).
 *   • The server is authoritative for every rule; the client only mirrors the
 *     minimum + balances for a good UX. Tailwind core utilities + inline SVG.
 */

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useWallet } from '@/hooks/useWallet'
import { callFn } from '@/lib/backend'
import { WAGERING_UI_ENABLED } from '@/lib/storeBuild'

export interface OracleBetChoice {
  key: string
  label: string
}

export interface OracleBetProps {
  /** The live stream id (must be a real, live, host-tier stream to show). */
  streamId: string
  /** Stable id for the match/game being bet on — ONE bet per (matchRef, user). */
  matchRef: string
  /** Outcomes to bet on (2+). Defaults to a two-way call. */
  choices?: OracleBetChoice[]
  title?: string
  className?: string
}

const DEFAULT_CHOICES: OracleBetChoice[] = [
  { key: 'p1', label: 'Player 1' },
  { key: 'p2', label: 'Player 2' },
]

type StakeKind = 'ticket' | 'sweeps' | 'artifact'

type BettableArtifact = { id: string; name: string; rarity: string; origin: string }

type Config = {
  eligible: boolean
  reason?: string
  min_bet?: number
  min_stake_kind?: StakeKind
  oracle_tickets?: number
  existing_bet?: { choice: string; stake_kind: string; stake_amount: number; status: string } | null
  artifacts?: BettableArtifact[]
  match_ref?: string | null
  match_state?: {
    phase?: 'waiting' | 'active' | 'result_pending' | 'finished' | 'uncertain'
    match_ref?: string | null
    started_at?: string | null
    ended_at?: string | null
    last_clock_seconds?: number | null
    confidence?: number | null
  } | null
}

export function OracleBet(props: OracleBetProps) {
  if (!WAGERING_UI_ENABLED) return null
  return <OracleBetEnabled {...props} />
}

function OracleBetEnabled({ streamId, matchRef, choices, title = 'Oracle bet', className = '' }: OracleBetProps) {
  const { user } = useAuth()
  const wallet = useWallet()
  const opts = choices && choices.length >= 2 ? choices : DEFAULT_CHOICES

  const [config, setConfig] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [choice, setChoice] = useState<string | null>(null)
  const [stakeKind, setStakeKind] = useState<StakeKind>('ticket')
  const [amount, setAmount] = useState<number>(1)
  const [artifactId, setArtifactId] = useState<string>('')
  const [artifacts, setArtifacts] = useState<BettableArtifact[]>([])
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // Ask the server whether a bet is legal HERE, plus the minimum + my tickets.
  useEffect(() => {
    let cancelled = false
    async function load(initial = false) {
      if (initial) setLoading(true)
      const res = await callFn<Config & { ok: boolean }>('oracle-bet-config', { streamId, matchRef })
      if (cancelled) return
      if (res && res.eligible) {
        setConfig(res)
        setStakeKind((res.min_stake_kind === 'sweeps' ? 'sweeps' : 'ticket') as StakeKind)
        setAmount(Math.max(1, Number(res.min_bet || 1)))
        const arts = Array.isArray(res.artifacts) ? res.artifacts : []
        setArtifacts(arts)
        if (arts[0]) setArtifactId(arts[0].id)
        if (res.existing_bet) { setLocked(true); setChoice(res.existing_bet.choice) }
      } else {
        setConfig(res ? { ...res, eligible: false } : null)
      }
      setLoading(false)
    }
    void load(true)
    const timer = window.setInterval(() => { void load(false) }, 8_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [streamId, matchRef])

  const minBet = config?.min_bet ?? 1
  const sweepsOnly = config?.min_stake_kind === 'sweeps'
  const belowMin = (stakeKind === 'ticket' || stakeKind === 'sweeps') && amount < minBet
  const canBet = useMemo(() => {
    if (!choice || busy || locked) return false
    if (stakeKind === 'artifact') return !!artifactId
    return amount >= minBet && amount > 0
  }, [choice, busy, locked, stakeKind, artifactId, amount, minBet])

  async function placeBet() {
    if (!canBet || !choice) return
    setBusy(true)
    setNote(null)
    const payload: Record<string, unknown> = {
      matchRef: config?.match_ref || config?.match_state?.match_ref || matchRef,
      streamId,
      choice,
      stakeKind,
    }
    if (stakeKind === 'artifact') payload.artifactId = artifactId
    else payload.amount = amount
    const res = await callFn<{ ok: boolean; reason?: string; oracle_tickets?: number }>('oracle-bet', payload)
    setBusy(false)
    if (res?.ok) {
      setLocked(true)
      setNote('Your Oracle bet is locked in. Winners split the pot when the host calls it.')
      void wallet.refresh()
      return
    }
    if (res && res.ok === false) {
      setNote(reasonText(res.reason))
      void wallet.refresh()
      return
    }
    setNote('Couldn’t reach the Oracle. Try again.')
  }

  // Non-eligible streams show nothing at all (bet is live-host only).
  if (loading) return null
  if (!config) return null
  if (!config.eligible) {
    const visibleReasons = new Set([
      'match-state-unavailable',
      'match-state-uncertain',
      'match-underway',
      'result-pending',
      'match-finished',
    ])
    if (!visibleReasons.has(String(config.reason || ''))) return null
    return (
      <div className={`rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 ${className}`}>
        <div className="flex items-center gap-2">
          <CoinIcon />
          <h3 className="text-sm font-bold text-amber-200">Oracle match status</h3>
        </div>
        <p className="mt-2 text-sm text-gray-300">{reasonText(config.reason)}</p>
        {config.match_state?.last_clock_seconds != null && (
          <p className="mt-1 text-xs text-gray-500">Detected match clock: {formatClock(config.match_state.last_clock_seconds)}</p>
        )}
      </div>
    )
  }

  return (
    <div className={`rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <CoinIcon />
        <h3 className="text-sm font-bold text-amber-200">{title}</h3>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-amber-200">
          <TicketIcon />
          <span className="tabular-nums">{wallet.oracle_tickets}</span>
          <span className="text-amber-300/70">tickets</span>
        </span>
      </div>

      {!user ? (
        <p className="text-sm text-gray-400">Log in to place an Oracle bet.</p>
      ) : locked ? (
        <div className="rounded-lg border border-amber-500/30 bg-dark-card px-3 py-3 text-center">
          <div className="flex items-center justify-center gap-2 text-amber-200 font-semibold text-sm">
            <LockIcon /> Your Oracle bet is locked
          </div>
          {choice && (
            <p className="text-xs text-gray-400 mt-1">
              You backed: <span className="text-amber-200 font-medium">{opts.find((o) => o.key === choice)?.label ?? choice}</span>
            </p>
          )}
          {note && <p className="text-[11px] text-gray-500 mt-1">{note}</p>}
        </div>
      ) : (
        <>
          {/* Outcome */}
          <div className={`grid gap-2 mb-3 ${opts.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {opts.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setChoice(o.key)}
                className={`px-3 py-2.5 rounded-lg border text-sm font-semibold transition-colors ${
                  choice === o.key
                    ? 'border-amber-400 bg-amber-500/20 text-amber-100'
                    : 'border-amber-500/40 bg-dark-card text-amber-100 hover:bg-amber-500/15'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Stake kind */}
          <div className="flex gap-1.5 mb-3">
            {(['ticket', 'sweeps', 'artifact'] as StakeKind[]).map((k) => {
              const disabled = sweepsOnly && k !== 'sweeps'
              return (
                <button
                  key={k}
                  type="button"
                  disabled={disabled}
                  onClick={() => setStakeKind(k)}
                  className={`flex-1 px-2 py-1.5 rounded-md border text-[11px] font-semibold capitalize transition-colors disabled:opacity-40 ${
                    stakeKind === k
                      ? 'border-amber-400 bg-amber-500/20 text-amber-100'
                      : 'border-dark-border bg-dark-card text-gray-300 hover:border-amber-500/40'
                  }`}
                >
                  {k === 'sweeps' ? 'Paid Sweeps' : k === 'ticket' ? 'Tickets' : 'Artifact'}
                </button>
              )
            })}
          </div>

          {/* Stake amount / artifact picker */}
          {stakeKind === 'artifact' ? (
            artifacts.length ? (
              <select
                value={artifactId}
                onChange={(e) => setArtifactId(e.target.value)}
                className="w-full mb-2 rounded-md border border-dark-border bg-dark-card px-2 py-2 text-sm text-gray-100"
              >
                {artifacts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} · {a.rarity}</option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-gray-500 mb-2">No forged or purchased artifacts to stake. Free and earned items can’t be bet.</p>
            )
          ) : (
            <div className="flex items-center gap-2 mb-2">
              <button type="button" onClick={() => setAmount((a) => Math.max(minBet, a - 1))} className="h-8 w-8 rounded-md border border-dark-border bg-dark-card text-amber-200 font-bold">–</button>
              <input
                type="number"
                min={minBet}
                value={amount}
                onChange={(e) => setAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="w-full text-center rounded-md border border-dark-border bg-dark-card px-2 py-1.5 text-sm text-gray-100 tabular-nums"
              />
              <button type="button" onClick={() => setAmount((a) => a + 1)} className="h-8 w-8 rounded-md border border-dark-border bg-dark-card text-amber-200 font-bold">+</button>
              <span className="text-[11px] text-amber-300/70 whitespace-nowrap">{stakeKind === 'sweeps' ? '¢' : 'tickets'}</span>
            </div>
          )}

          <p className="text-[11px] text-gray-500 mb-2">
            Minimum {minBet} {sweepsOnly ? '¢ (paid sweeps only)' : ''}. One bet per match. Winners split the pot.
          </p>
          {belowMin && <p className="text-[11px] text-amber-300 mb-1">Below the {minBet} minimum.</p>}

          <button
            type="button"
            onClick={placeBet}
            disabled={!canBet}
            className="w-full px-3 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-dark text-sm font-bold disabled:opacity-40 transition-opacity"
          >
            {busy ? 'Placing…' : 'Place Oracle bet'}
          </button>
          {note && <p className="text-[11px] text-amber-300 mt-2">{note}</p>}
        </>
      )}
    </div>
  )
}

function reasonText(reason?: string): string {
  switch (reason) {
    case 'already-bet': return 'You already have a bet on this match.'
    case 'below-minimum': return 'That’s below the streamer’s minimum bet.'
    case 'insufficient-tickets': return 'Not enough Oracle tickets. Claim your daily tickets.'
    case 'insufficient-sweeps': return 'Not enough paid sweeps for that stake.'
    case 'sweeps-only-stream': return 'This streamer takes paid-sweeps bets only.'
    case 'artifact-not-bettable': return 'Only forged or purchased artifacts can be bet.'
    case 'artifact-not-owned': return 'You don’t own that artifact.'
    case 'artifact-in-use': return 'That artifact is already staked in a live bet.'
    case 'not-live': case 'no-stream': return 'Betting is only open on a live, host-tier stream.'
    case 'not-host-tier': return 'Betting is available on host-tier streams only.'
    case 'match-state-unavailable': return 'Oracle is waiting for the match detector to confirm the game state.'
    case 'match-state-uncertain': return 'Oracle cannot verify the match state yet. Betting stays locked for safety.'
    case 'match-underway': return 'The match has started. New bets are closed.'
    case 'result-pending': return 'The match ended and Oracle is checking the result.'
    case 'match-finished': return 'This match is finished. Oracle has closed betting.'
    case 'stale-match': return 'A new match was detected. Refresh before placing a bet.'
    default: return 'That bet couldn’t be placed.'
  }
}

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

function CoinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-300" fill="none" stroke="currentColor" aria-hidden>
      <circle cx="12" cy="12" r="8" strokeWidth={1.8} />
      <path strokeLinecap="round" strokeWidth={1.8} d="M12 8v8M9.5 9.5a2 2 0 012.5-1 1.8 1.8 0 010 3.4 1.8 1.8 0 000 3.2 2 2 0 002.5-1" />
    </svg>
  )
}

function TicketIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" aria-hidden>
      <path strokeWidth={1.6} strokeLinejoin="round" d="M4 8a2 2 0 012-2h12a2 2 0 012 2 2 2 0 000 4 2 2 0 00-2 2v0a2 2 0 01-2 2H6a2 2 0 01-2-2 2 2 0 000-4 2 2 0 002-2z" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" strokeWidth={1.8} />
      <path strokeLinecap="round" strokeWidth={1.8} d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  )
}

export default OracleBet
