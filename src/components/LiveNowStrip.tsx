/**
 * LiveNowStrip — the compact "🔴 Live now" horizontal strip used on the home
 * launcher, the Live hub and clan boards.
 *
 * It now reads from the SHARED live-link context (`useLiveLinks`) instead of
 * querying `live_streams` itself, which buys three things:
 *
 *   1. One load for every live surface on the page — the same streams and the
 *      same verdicts everywhere. Every concurrent stream shows up: `live_streams`
 *      is public-read by policy, so other people's live runs are visible too.
 *   2. RELATIONSHIP INDICATORS on the cards: "⚔ Scheduled battle vs @rex",
 *      "Same clan", "Both in TKO King" (see src/lib/liveLink.ts).
 *   3. A direct route into the combined multi-angle view when the engine found
 *      a scheduled battle — the strongest "these two belong together" signal.
 *
 * Placement filtering stays client-side (the `placement` column, with the legacy
 * "[front_page] title" prefix as a fallback) so it works on every backend.
 */
import { Link } from 'react-router-dom'
import { useLiveLinks } from '@/hooks/useLiveLinks'
import { handleOf } from '@/lib/liveLink'

type Placement = 'profile' | 'clan' | 'front_page' | 'tournament'

interface Props {
  placement: Placement
  /** Scope clan-placement streams to a single clan/server. */
  clanId?: string
  /** Scope tournament-placement streams to a single tournament. */
  tournamentId?: string
  /** Max cards to show (default 12). */
  limit?: number
  className?: string
}

export function LiveNowStrip({ placement, clanId, tournamentId, limit = 12, className }: Props) {
  const { cards, loading, badgeFor, bestFor } = useLiveLinks()
  const scopeId = clanId ?? tournamentId

  const streams = cards
    .filter((c) => c.placement === placement)
    .filter((c) => {
      if (!scopeId) return true
      const rowScope = c.clanId ?? c.tournamentId ?? null
      // A row that carries no scope id (older / mock rows) is included
      // best-effort so nothing is silently hidden.
      return rowScope == null || rowScope === scopeId
    })
    .filter((c) => c.videoId) // need a YouTube id for the thumbnail
    .slice(0, limit)

  // Renders nothing when a placement has no live streams, so it never clutters
  // a page that has other content.
  if (loading || streams.length === 0) return null

  return (
    <section className={`mb-6 ${className ?? ''}`}>
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="live-dot" />
        <h2 className="text-sm font-semibold tracking-wide uppercase text-gray-300">Live now</h2>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {streams.map((s) => {
          const badge = badgeFor(s.streamId)
          const best = bestFor(s.streamId)
          const isBattle = best?.reason === 'scheduled_battle'
          // A scheduled battle goes straight to both angles; everything else
          // opens the single stream.
          const to =
            isBattle && best
              ? `/live-stage/new?s=${encodeURIComponent([best.a.streamId, best.b.streamId].join(','))}`
              : `/watch/${s.streamId}?u=${encodeURIComponent(s.url ?? '')}${
                  s.title ? `&t=${encodeURIComponent(s.title)}` : ''
                }`
          return (
            <Link
              key={s.streamId}
              to={to}
              className={`group shrink-0 w-64 snap-start rounded-xl border bg-dark-card overflow-hidden transition-all hover:shadow-glow ${
                isBattle ? 'border-accent' : 'border-dark-border hover:border-accent/60'
              }`}
            >
              <div className="aspect-video bg-dark relative overflow-hidden">
                <img
                  src={`https://i.ytimg.com/vi/${s.videoId}/hqdefault.jpg`}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />
                <span className="absolute top-2 left-2 pill-kunai">
                  <span className="live-dot" />
                  LIVE
                </span>
                {isBattle && (
                  <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-accent text-dark text-[11px] font-bold">
                    Watch both angles
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="font-medium text-sm truncate group-hover:text-accent transition-colors">{s.title}</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{handleOf(s)}</p>
                {badge && (
                  <span
                    className={`mt-1.5 inline-block max-w-full truncate px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      isBattle ? 'bg-accent text-dark' : 'bg-dark border border-accent/40 text-accent'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

export default LiveNowStrip
