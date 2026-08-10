import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleStop, LockKeyhole, Play, RefreshCw, Scale, Trophy } from 'lucide-react'
import { callFn } from '@/lib/backend'
import { OracleBet, type OracleBetChoice } from '@/components/OracleBet'
import type { LiveScoreboard } from '@/lib/liveAngles'
import { WAGERING_UI_ENABLED } from '@/lib/storeBuild'

type OracleRound = {
  match_ref: string
  status: 'open' | 'locked' | 'settled' | 'cancelled'
  locks_at: string
  choices?: OracleBetChoice[]
}

type OracleConfig = {
  ok: boolean
  eligible: boolean
  reason?: string
  can_manage?: boolean
  match_ref?: string | null
  choices?: OracleBetChoice[]
  round?: OracleRound | null
  scoreboard?: LiveScoreboard | null
}

const FALLBACK_SCOREBOARD: LiveScoreboard = {
  team_a: 'Team A',
  team_b: 'Team B',
  score_a: 0,
  score_b: 0,
  score_revision: 0,
}

function messageFor(reason?: string): string {
  switch (reason) {
    case 'host-has-not-started': return 'Waiting for the live host to start the next Oracle round.'
    case 'not-enough-participants': return 'Add at least two live participants before starting Oracle.'
    case 'betting-closed': return 'Predictions are locked. The host must award the point before another round can begin.'
    case 'not-host-tier': return 'Oracle is available on eligible host-tier live streams.'
    case 'not-live': return 'Oracle opens only while this show is live.'
    case 'no-stream': return 'This live session is no longer available.'
    default: return 'Oracle is waiting for the host.'
  }
}

export function OracleLivePanel(props: { streamId: string }) {
  if (!WAGERING_UI_ENABLED) return null
  return <OracleLivePanelEnabled {...props} />
}

function OracleLivePanelEnabled({ streamId }: { streamId: string }) {
  const [config, setConfig] = useState<OracleConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    const next = await callFn<OracleConfig>('oracle-bet-config', { streamId })
    if (!next) {
      setLoadError('Oracle could not connect to this live. Check the connection and retry.')
      setLoading(false)
      return
    }
    setConfig(next)
    setLoadError(null)
    setLoading(false)
  }, [streamId])

  useEffect(() => {
    void refresh(true)
    const timer = window.setInterval(() => { void refresh() }, 4_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const round = config?.round ?? null
  const scoreboard = config?.scoreboard ?? FALLBACK_SCOREBOARD
  const choices = useMemo(
    () => (config?.choices && config.choices.length >= 2 ? config.choices : round?.choices ?? []),
    [config?.choices, round?.choices],
  )

  useEffect(() => {
    if (!round?.locks_at || round.status !== 'open') {
      setSecondsLeft(0)
      return
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((Date.parse(round.locks_at) - Date.now()) / 1000)))
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [round?.locks_at, round?.status])

  async function startRound() {
    setBusy(true)
    setNote(null)
    const result = await callFn<{ ok: boolean; reason?: string }>('oracle-round-start', { streamId })
    setBusy(false)
    if (!result?.ok) setNote(messageFor(result?.reason))
    else setNote('Oracle is open for 30 seconds. The server will lock it automatically.')
    await refresh()
  }

  async function awardPoint(winningChoice: 'team:a' | 'team:b') {
    if (!round) return
    const losingChoice = winningChoice === 'team:a' ? 'team:b' : 'team:a'
    setBusy(true)
    setNote(null)
    const result = await callFn<{
      ok: boolean
      reason?: string
      scoreboard?: LiveScoreboard
    }>('oracle-bet-resolve', {
      matchRef: round.match_ref,
      winningChoice,
      losingChoice,
    })
    setBusy(false)
    if (!result?.ok) {
      setNote(result?.reason === 'betting-open' ? 'Wait for the prediction window to lock.' : 'Oracle could not settle this round.')
    } else {
      const winner = winningChoice === 'team:a' ? scoreboard.team_a : scoreboard.team_b
      setNote(`${winner} received the point. The next Oracle round is now available.`)
      if (result.scoreboard) {
        setConfig((current) => current ? { ...current, scoreboard: result.scoreboard, round: null, eligible: false, reason: 'host-has-not-started' } : current)
      }
    }
    await refresh()
  }

  async function cancelRound() {
    if (!round) return
    setBusy(true)
    setNote(null)
    const result = await callFn<{ ok: boolean }>('oracle-bet-cancel', { matchRef: round.match_ref })
    setBusy(false)
    setNote(result?.ok ? 'Round cancelled and every active stake was returned.' : 'Oracle could not cancel this round.')
    await refresh()
  }

  if (!config) {
    return (
      <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-4 text-sm text-gray-400">
        {loading && !loadError ? (
          <span className="inline-flex items-center gap-2">
            <RefreshCw size={16} className="animate-spin text-purple-200" aria-hidden /> Loading Oracle...
          </span>
        ) : (
          <div className="space-y-3">
            <p>{loadError ?? 'Oracle is temporarily unavailable.'}</p>
            <button
              type="button"
              onClick={() => { void refresh(true) }}
              disabled={loading}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-purple-400/40 px-3 text-sm font-semibold text-purple-100 hover:bg-purple-500/10 disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden />
              {loading ? 'Retrying...' : 'Retry Oracle'}
            </button>
          </div>
        )}
      </div>
    )
  }

  if (config.can_manage) {
    return (
      <div className="space-y-3 rounded-lg border border-purple-500/30 bg-purple-500/5 p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-purple-500/15 text-purple-200">
            <Scale size={18} aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white">Host Oracle control</h3>
            <p className="mt-0.5 text-xs leading-5 text-gray-400">Start when the match begins. After predictions lock, award one point to the winning team.</p>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-md border border-purple-400/20 bg-black/25 px-3 py-2 text-center">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-gray-300">{scoreboard.team_a}</p>
            <p className="text-2xl font-black tabular-nums text-white">{scoreboard.score_a}</p>
          </div>
          <span className="text-xs font-bold text-purple-300">VS</span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-gray-300">{scoreboard.team_b}</p>
            <p className="text-2xl font-black tabular-nums text-white">{scoreboard.score_b}</p>
          </div>
        </div>

        {!round ? (
          <button type="button" onClick={startRound} disabled={busy} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-purple-500 px-4 text-sm font-bold text-white disabled:opacity-50">
            <Play size={17} fill="currentColor" aria-hidden />
            {busy ? 'Starting...' : 'Start Oracle'}
          </button>
        ) : round.status === 'open' && secondsLeft > 0 ? (
          <div className="rounded-md border border-purple-400/30 bg-black/20 px-4 py-3 text-center">
            <p className="text-xs font-semibold uppercase text-purple-200">Predictions open</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-white">{secondsLeft}s</p>
            <p className="mt-1 text-xs text-gray-500">{scoreboard.team_a} vs {scoreboard.team_b}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-purple-100"><LockKeyhole size={16} aria-hidden /> Predictions locked</div>
            <p className="text-xs text-gray-400">Award one score point before the next Oracle round can open.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => { void awardPoint('team:a') }} disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-cyan-500 px-3 text-sm font-bold text-black disabled:opacity-40">
                <Trophy size={17} aria-hidden /> {scoreboard.team_a} wins
              </button>
              <button type="button" onClick={() => { void awardPoint('team:b') }} disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-orange-500 px-3 text-sm font-bold text-black disabled:opacity-40">
                <Trophy size={17} aria-hidden /> {scoreboard.team_b} wins
              </button>
            </div>
            <button type="button" onClick={cancelRound} disabled={busy} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-dark-border text-xs font-semibold text-gray-300 hover:border-kunai hover:text-kunai disabled:opacity-40">
              <CircleStop size={16} aria-hidden /> Cancel and refund round
            </button>
          </div>
        )}
        {note && <p className="text-xs text-purple-200">{note}</p>}
      </div>
    )
  }

  if (config.eligible && round) {
    return <OracleBet streamId={streamId} matchRef={round.match_ref} choices={choices} title={`Call it - ${secondsLeft}s`} />
  }

  return (
    <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-purple-100"><Scale size={16} aria-hidden /> Oracle</div>
      <p className="mt-2 text-sm text-gray-400">{messageFor(config.reason)}</p>
    </div>
  )
}

export default OracleLivePanel
