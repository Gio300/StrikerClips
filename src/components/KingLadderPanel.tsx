import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { callFn } from '@/lib/backend'
import { tierFor } from '@/lib/kingLadder'

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
}

export function KingLadderPanel() {
  const { user } = useAuth()
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
    } catch { /* offline / mock */ }
  }, [user])

  useEffect(() => { refresh() }, [refresh])

  async function register() {
    setBusy(true); setMsg('')
    try {
      const r = (await callFn('king', { action: 'register' })) as { match?: KingMatchRow | null } | null
      setMatch(r?.match ?? null)
      setMsg(r?.match ? 'Matched! Propose a time below.' : "You're in the queue — we'll pair you as challengers arrive.")
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
    } finally { setBusy(false) }
  }

  async function report(winnerId: string) {
    if (!match) return
    setBusy(true); setMsg('')
    try {
      const r = (await callFn('king', { action: 'report', matchId: match.id, winnerId })) as { ok?: boolean; king?: string } | null
      if (r?.ok) setMsg('Result recorded — you\'ve been re-rated and re-paired.')
      await refresh()
    } finally { setBusy(false) }
  }

  if (!user) return null
  const oppId = match ? (match.player_a === user.id ? match.player_b : match.player_a) : null
  const tier = rating != null ? tierFor(rating) : null

  return (
    <div className="rounded-xl border border-accent/30 bg-dark-card p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white">TKO King ladder</h2>
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
            <span className="ml-2 text-[11px] uppercase tracking-wide text-gray-500">{match.status}</span>
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
          {/* Report the verified result once played. */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => report(user.id)} disabled={busy} className="px-3 py-1.5 rounded-lg border border-leaf/50 text-leaf text-sm hover:bg-leaf/10 disabled:opacity-50">
              I won
            </button>
            {oppId && (
              <button type="button" onClick={() => report(oppId)} disabled={busy} className="px-3 py-1.5 rounded-lg border border-dark-border text-gray-400 text-sm hover:text-white disabled:opacity-50">
                Opponent won
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
