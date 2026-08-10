import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { callFn } from '@/lib/backend'
import { tierFor } from '@/lib/kingLadder'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'
import { kingLadderDisplayName } from '@/lib/displayBrand'

/**
 * KingLadderPanel — the never-ending TKO King ladder, in one card.
 *
 * Register → you're rated and auto-paired with someone in your rank band. You
 * both propose times; the match schedules itself when they overlap. Report the
 * verified result and you're re-rated + re-paired. No brackets, no host picking
 * fights — the ladder runs itself.
 */
interface KingMatchRow {
  id: string
  player_a: string
  player_b: string
  agreed_time: string | null
  status: string
  winner_id: string | null
  report_a_winner_id?: string | null
  report_b_winner_id?: string | null
}

export function kingMatchStatusLabel(status: string): string {
  if (status === 'proposing') return 'Choosing a time'
  if (status === 'scheduled') return 'Scheduled'
  if (status === 'awaiting_result') return 'Ready for result'
  if (status === 'awaiting_confirmation') return 'Waiting for confirmation'
  if (status === 'disputed') return 'Reports do not match'
  if (status === 'done') return 'Result confirmed'
  return 'Match active'
}

export function KingLadderPanel() {
  const { user } = useAuth()
  const { display } = useLeagueTheme()
  const ladderName = kingLadderDisplayName(display)
  const [match, setMatch] = useState<KingMatchRow | null>(null)
  const [rating, setRating] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [slot, setSlot] = useState('')
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async () => {
    if (!user) return
    try {
      const r = (await callFn('king', { action: 'status' })) as { match?: KingMatchRow | null; rating?: number } | null
      setMatch(r?.match ?? null)
      if (typeof r?.rating === 'number') setRating(r.rating)
    } catch {
      setMsg('The ladder could not be reached. Check your connection and try again.')
    }
  }, [user])

  useEffect(() => { refresh() }, [refresh])

  async function register() {
    setBusy(true); setMsg('')
    try {
      const r = (await callFn('king', { action: 'register' })) as { match?: KingMatchRow | null } | null
      setMatch(r?.match ?? null)
      setMsg(r?.match ? 'Matched! Propose a time below.' : "You're in the queue — we'll pair you as challengers arrive.")
    } catch {
      setMsg('The ladder could not be reached. Check your connection and try again.')
    } finally { setBusy(false) }
  }

  async function propose() {
    if (!match || !slot) return
    setBusy(true); setMsg('')
    try {
      const iso = new Date(slot).toISOString()
      const r = (await callFn('king', { action: 'propose', matchId: match.id, slots: [iso] })) as { match?: KingMatchRow } | null
      if (r?.match) setMatch({ ...match, ...r.match })
      setMsg(r?.match?.agreed_time || r?.match?.status === 'scheduled' ? 'Time locked — you both agreed!' : 'Proposed. Waiting on your opponent to agree.')
      setSlot('')
      refresh()
    } catch {
      setMsg('That time could not be saved. Check your connection and try again.')
    } finally { setBusy(false) }
  }

  async function report(winnerId: string) {
    if (!match) return
    const outcome = winnerId === user?.id ? 'you won' : 'you lost'
    if (!window.confirm(`Confirm that ${outcome}? Your rating will not change until your opponent submits the same result.`)) return
    setBusy(true); setMsg('')
    try {
      const r = (await callFn('king', { action: 'report', matchId: match.id, winnerId })) as {
        ok?: boolean
        settled?: boolean
        conflict?: boolean
        error?: string
      } | null
      if (!r?.ok) {
        setMsg(r?.error || 'Your result could not be saved. Try again.')
      } else if (r.settled) {
        setMsg('Both players confirmed the same result. Ratings are updated and the ladder can pair you again.')
      } else if (r.conflict) {
        setMsg('The two reports do not match. No rating changed. Correct your report below or wait for a trusted review.')
      } else {
        setMsg('Your report is saved. No rating changes until your opponent submits the same result.')
      }
      await refresh()
    } catch {
      setMsg('Your result could not be saved. Check your connection and try again.')
    } finally { setBusy(false) }
  }

  if (!user) return null
  const oppId = match ? (match.player_a === user.id ? match.player_b : match.player_a) : null
  const tier = rating != null ? tierFor(rating) : null
  const myReport = match
    ? (match.player_a === user.id ? match.report_a_winner_id : match.report_b_winner_id) ?? null
    : null
  const opponentReport = match
    ? (match.player_a === user.id ? match.report_b_winner_id : match.report_a_winner_id) ?? null
    : null
  const reportsConflict = Boolean(myReport && opponentReport && myReport !== opponentReport)

  return (
    <div className="rounded-xl border border-accent/30 bg-dark-card p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white">{ladderName}</h2>
          <p className="text-xs text-gray-500">Auto-matched, rank-banded, never-ending. Climb to become King.</p>
        </div>
        {rating != null && (
          <div className="text-right">
            <div className="text-sm font-semibold" style={{ color: tier?.color }}>{tier?.name}</div>
            <div className="text-xs text-gray-500">Rating {rating}</div>
          </div>
        )}
      </div>

      {!match ? (
        <button
          type="button"
          onClick={register}
          disabled={busy}
          className="mt-4 w-full py-2.5 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
        >
          {busy ? 'Finding your match…' : 'Enter the ladder — find my match'}
        </button>
      ) : (
        <div className="mt-4 rounded-lg border border-dark-border bg-dark p-4">
          <div className="text-sm text-gray-300">
            Your match — <span className="text-accent">vs opponent</span>
            <span className="ml-2 text-[11px] uppercase tracking-wide text-gray-500">{kingMatchStatusLabel(match.status)}</span>
          </div>
          {match.agreed_time ? (
            <p className="mt-1 text-sm text-leaf">Scheduled for {new Date(match.agreed_time).toLocaleString()}</p>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); propose() }} className="mt-3 flex gap-2 flex-wrap items-center">
              <input
                type="datetime-local"
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                className="min-w-0 flex-1 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
              />
              <button type="submit" disabled={busy || !slot} className="shrink-0 px-4 py-2 rounded-lg bg-accent text-dark text-sm font-semibold disabled:opacity-50">
                Propose time
              </button>
            </form>
          )}
          {(myReport || opponentReport) && (
            <div
              role={reportsConflict ? 'alert' : 'status'}
              className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                reportsConflict
                  ? 'border-red-500/40 bg-red-500/10 text-red-200'
                  : 'border-accent/30 bg-accent/10 text-gray-300'
              }`}
            >
              {reportsConflict
                ? 'Your reports do not match. No rating changed. Choose the correct result below, or wait for trusted review.'
                : myReport && !opponentReport
                  ? 'Your report is saved. Waiting for your opponent to confirm the same winner.'
                  : !myReport && opponentReport
                    ? 'Your opponent submitted a result. Choose your result below to confirm or dispute it.'
                    : 'Both reports match. Confirming the result now.'}
            </div>
          )}
          {/* Each player reports independently; the server settles only when both agree. */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => report(user.id)} disabled={busy} className="px-3 py-1.5 rounded-lg border border-leaf/50 text-leaf text-sm hover:bg-leaf/10 disabled:opacity-50">
              I won
            </button>
            {oppId && (
              <button type="button" onClick={() => report(oppId)} disabled={busy} className="px-3 py-1.5 rounded-lg border border-dark-border text-gray-400 text-sm hover:text-white disabled:opacity-50">
                I lost
              </button>
            )}
          </div>
        </div>
      )}
      {msg && <p className="mt-3 text-xs text-gray-400">{msg}</p>}
    </div>
  )
}

export default KingLadderPanel
