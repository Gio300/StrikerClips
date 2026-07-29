import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { findKing } from '@/lib/kingTournament'
import { upcomingBattles, battleTimingLabel, type BattleLike } from '@/lib/tkoKing'
import type { TournamentBattle } from '@/types/database'

/**
 * NextBattlesStrip — ADVERTISE the King's battles.
 *
 * A horizontal, phone-first strip of the battles worth watching right now:
 * anything LIVE first, then the soonest scheduled fights. Each card shows the
 * two fighters, the scheduled time and a live countdown that ticks.
 *
 * Mirrors LiveNowStrip: it renders nothing when there's nothing to advertise,
 * so it never clutters the home launcher.
 */

type Row = TournamentBattle & { a_name?: string; b_name?: string }

export function NextBattlesStrip({ limit = 6, className }: { limit?: number; className?: string }) {
  const [battles, setBattles] = useState<Row[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    async function load() {
      const king = await findKing()
      if (!king) return
      const { data } = await supabase
        .from('tournament_battles')
        .select('*')
        .eq('tournament_id', king.id)
      const rows = (data ?? []) as Row[]
      const picked = upcomingBattles(rows as BattleLike[], Date.now(), limit) as Row[]
      if (picked.length === 0) {
        if (!cancelled) setBattles([])
        return
      }
      // Enrich fighter names in one query.
      const ids = new Set<string>()
      picked.forEach((b) => { ids.add(b.player_a); if (b.player_b) ids.add(b.player_b) })
      const names = new Map<string, string>()
      if (ids.size > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, username')
          .in('id', Array.from(ids))
        for (const p of profs ?? []) names.set(p.id, p.username)
      }
      if (!cancelled) {
        setBattles(
          picked.map((b) => ({
            ...b,
            a_name: names.get(b.player_a) ?? 'shinobi',
            b_name: b.player_b ? names.get(b.player_b) ?? 'shinobi' : undefined,
          })),
        )
      }
    }
    load()
    return () => { cancelled = true }
  }, [limit])

  // Tick the countdowns once a minute (cheap, and the strip is always visible).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  if (battles.length === 0) return null

  return (
    <section className={`mb-6 ${className ?? ''}`}>
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="text-lg">⚔️</span>
        <h2 className="text-sm font-semibold tracking-wide uppercase text-gray-300">Next battles</h2>
        <Link to="/king/board" className="ml-auto text-xs text-accent hover:underline">
          Full board →
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {battles.map((b) => {
          const live = b.status === 'live'
          return (
            <Link
              key={b.id}
              to="/king"
              className={`group shrink-0 w-60 snap-start rounded-xl border p-3 transition-all hover:shadow-glow ${
                live
                  ? 'border-kunai/60 bg-kunai/10 hover:border-kunai'
                  : 'border-dark-border bg-dark-card hover:border-accent/60'
              }`}
            >
              <div className="flex items-center gap-2">
                {live ? (
                  <span className="pill-kunai"><span className="live-dot" />LIVE</span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent uppercase tracking-wider">
                    Upcoming
                  </span>
                )}
                <span className="ml-auto text-[11px] text-gray-400 tabular-nums">
                  {battleTimingLabel(b as BattleLike, now)}
                </span>
              </div>
              <p className="mt-2 font-bold text-white text-sm leading-snug truncate">
                @{b.a_name}
              </p>
              <p className="text-[11px] text-gray-500 my-0.5">vs</p>
              <p className="font-bold text-white text-sm leading-snug truncate">
                @{b.b_name ?? 'TBD'}
              </p>
              {b.scheduled_at && (
                <p className="mt-2 text-[11px] text-gray-500 truncate">
                  {new Date(b.scheduled_at).toLocaleString()}
                </p>
              )}
            </Link>
          )
        })}
      </div>
    </section>
  )
}

export default NextBattlesStrip
