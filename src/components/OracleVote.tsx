/**
 * OracleVote — a 30-second live "call it" widget.
 *
 * Mounted where a live match is watched. The moment it opens it stamps
 * `openedAt = Date.now()` and starts a 30s countdown. Tap a choice to lock in
 * your Oracle call — it POSTs {matchRef, choice, openedAt} to the trusted
 * `oracle-vote` fn. After a vote (or once the timer runs out) it shows a locked
 * state. Correct calls are +10 power, credited server-side.
 *
 * Not mounted inside ImmersivePlayer (owned elsewhere) — this is the standalone
 * widget the live/match page renders. Tailwind core utilities + inline SVG only.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { callFn } from '@/lib/backend'

const WINDOW_MS = 30_000

export interface OracleChoice {
  /** Stable value sent to the server. */
  key: string
  /** Button label. */
  label: string
}

export interface OracleVoteProps {
  /** Stable id for the thing being called (derive from the match / video id). */
  matchRef: string
  /** The choices to offer (2 or more). Defaults to a two-way call. */
  choices?: OracleChoice[]
  /** Optional heading. */
  title?: string
  className?: string
}

type Phase = 'open' | 'voting' | 'locked'

const DEFAULT_CHOICES: OracleChoice[] = [
  { key: 'p1', label: 'Player 1' },
  { key: 'p2', label: 'Player 2' },
]

export function OracleVote({ matchRef, choices, title = 'Oracle call', className = '' }: OracleVoteProps) {
  const { user } = useAuth()
  const opts = choices && choices.length >= 2 ? choices : DEFAULT_CHOICES

  // openedAt is stamped once, when the widget first mounts for this match.
  const openedAtRef = useRef<number>(Date.now())
  const [remaining, setRemaining] = useState(WINDOW_MS)
  const [phase, setPhase] = useState<Phase>('open')
  const [choice, setChoice] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // Reset when the match changes.
  useEffect(() => {
    openedAtRef.current = Date.now()
    setRemaining(WINDOW_MS)
    setPhase('open')
    setChoice(null)
    setNote(null)
  }, [matchRef])

  // Countdown — ticks to zero, then locks (timeout) if no vote was cast.
  useEffect(() => {
    if (phase === 'locked') return
    const id = window.setInterval(() => {
      const left = WINDOW_MS - (Date.now() - openedAtRef.current)
      if (left <= 0) {
        setRemaining(0)
        setPhase((p) => (p === 'locked' ? p : 'locked'))
        setNote((n) => n ?? 'Time’s up — the window closed.')
        window.clearInterval(id)
      } else {
        setRemaining(left)
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [phase])

  const secondsLeft = Math.ceil(remaining / 1000)
  const pct = useMemo(() => Math.max(0, Math.min(100, (remaining / WINDOW_MS) * 100)), [remaining])

  async function vote(key: string) {
    if (phase !== 'open' || !user) return
    setPhase('voting')
    setChoice(key)
    const res = await callFn<
      { ok: true } | { ok: false; reason: 'exists' | 'late' }
    >('oracle-vote', { matchRef, choice: key, openedAt: openedAtRef.current })

    if (res?.ok) {
      setPhase('locked')
      setNote('Your Oracle call is locked. Correct calls earn +10 power.')
      return
    }
    // Business refusals still lock the widget — the call is over either way.
    if (res && res.ok === false) {
      setPhase('locked')
      setNote(res.reason === 'exists' ? 'You already called this one.' : 'Too late — the window closed.')
      return
    }
    // Null = never reached the server. Let them try again.
    setPhase('open')
    setChoice(null)
    setNote('Couldn’t reach the Oracle. Try again.')
  }

  const locked = phase === 'locked'

  return (
    <div className={`rounded-xl border border-purple-500/40 bg-purple-500/5 p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <OracleIcon />
        <h3 className="text-sm font-bold text-purple-200">{title}</h3>
        {!locked && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-purple-200">
            <span className="tabular-nums">{secondsLeft}s</span>
          </span>
        )}
      </div>

      {/* Countdown bar */}
      {!locked && (
        <div className="h-1.5 w-full rounded-full bg-dark-border overflow-hidden mb-3" aria-hidden>
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-fuchsia-500 transition-[width] duration-200 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {!user ? (
        <p className="text-sm text-gray-400">Log in to make an Oracle call.</p>
      ) : locked ? (
        <div className="rounded-lg border border-purple-500/30 bg-dark-card px-3 py-3 text-center">
          <div className="flex items-center justify-center gap-2 text-purple-200 font-semibold text-sm">
            <LockIcon />
            Your Oracle call is locked
          </div>
          {choice && (
            <p className="text-xs text-gray-400 mt-1">
              You called: <span className="text-purple-200 font-medium">{opts.find((o) => o.key === choice)?.label ?? choice}</span>
            </p>
          )}
          {note && <p className="text-[11px] text-gray-500 mt-1">{note}</p>}
        </div>
      ) : (
        <>
          <div className={`grid gap-2 ${opts.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {opts.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => vote(o.key)}
                disabled={phase === 'voting'}
                className="px-3 py-2.5 rounded-lg border border-purple-500/40 bg-dark-card text-sm font-semibold text-purple-100 hover:bg-purple-500/15 disabled:opacity-50 transition-colors"
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-500 mt-2">Call it before the timer runs out. Correct calls earn +10 power.</p>
          {note && <p className="text-[11px] text-amber-300 mt-1">{note}</p>}
        </>
      )}
    </div>
  )
}

function OracleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-purple-300" fill="none" stroke="currentColor" aria-hidden>
      <circle cx="12" cy="10" r="6" strokeWidth={1.8} />
      <path strokeLinecap="round" strokeWidth={1.8} d="M9.5 8.5a3 3 0 012.5-1.5M8 20h8M10 16l-.5 4M14 16l.5 4" />
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

export default OracleVote
