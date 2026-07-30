import { Link } from 'react-router-dom'
import { KING_SCHEDULE, KING_TAGLINE } from '@/lib/tkoKing'

/**
 * TkoKingHero — PRIME front-page placement for the TKO King.
 *
 * The King is a NEVER-ENDING ladder: you register any time and get auto-matched.
 * This hero reflects that — no enrollment countdown, no "get ready" gate that
 * contradicts "play anytime". Just: here's the ladder, enter it. (Season/crowned
 * events layer on top and live inside the King page, not here.)
 */
export function TkoKingHero() {
  return (
    <Link
      to="/king"
      className="group block mb-6 rounded-2xl border border-kunai/50 bg-gradient-to-br from-kunai/15 via-dark-card to-dark-card p-5 md:p-6 hover:border-kunai transition-all hover:shadow-glow animate-fade-in"
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-3xl">👑</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl md:text-2xl font-bold text-white">TKO King</h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-kunai/50 bg-kunai/10 text-kunai uppercase tracking-wider">
              {KING_SCHEDULE.season}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent uppercase tracking-wider">
              Ladder · always open
            </span>
          </div>
          <p className="text-sm text-gray-300 mt-0.5">{KING_TAGLINE}</p>
          <p className="text-[11px] text-gray-400 mt-1">
            Auto-matched, rank-banded, never-ending — register any time and climb to become King.
          </p>
          <p className="text-[11px] text-accent mt-1">🔴 Battles stream to our YouTube + front page</p>
        </div>
        <span className="ml-auto shrink-0 px-4 py-2 rounded-lg bg-kunai text-dark font-semibold group-hover:scale-[1.03] transition-transform">
          Enter the ladder →
        </span>
      </div>
    </Link>
  )
}

export default TkoKingHero
