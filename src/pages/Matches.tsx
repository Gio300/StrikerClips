import { useDeferredValue, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import type { Match } from '@/types/database'

export function Matches() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [retry, setRetry] = useState(0)
  const deferredSearch = useDeferredValue(search.trim())

  useEffect(() => {
    let alive = true
    async function fetch() {
      setLoading(true)
      setError('')
      let query = supabase
        .from('matches')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)
      if (deferredSearch) query = query.ilike('name', `%${deferredSearch}%`)
      const { data, error: loadError } = await query
      if (!alive) return
      setMatches(data ?? [])
      setError(loadError ? 'Matches could not be loaded. Check your connection and try again.' : '')
      setLoading(false)
    }
    void fetch()
    return () => { alive = false }
  }, [deferredSearch, retry])

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Matches</h1>
          <p className="mt-1 text-sm text-gray-400">Watch published match pages or host a new match.</p>
        </div>
        <Link
          to="/matches/create"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-dark transition-all hover:shadow-glow"
        >
          Host a match
        </Link>
      </div>

      <label className="relative mb-6 block max-w-xl">
        <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden />
        <span className="sr-only">Search matches</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search matches by name"
          className="w-full rounded-lg border border-dark-border bg-dark py-2.5 pl-10 pr-3 text-sm text-white placeholder-gray-500 outline-none focus:border-accent"
        />
      </label>

      {loading ? (
        <div className="flex items-center justify-center p-12">
          <div className="animate-pulse text-accent">Loading matches...</div>
        </div>
      ) : error ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="text-sm text-red-200">{error}</p>
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            className="mt-3 rounded-lg border border-red-400/40 px-4 py-2 text-sm font-semibold text-red-200"
          >
            Try again
          </button>
        </div>
      ) : matches.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {matches.map((match) => (
              <Link
                key={match.id}
                to={`/matches/${match.id}`}
                className="animate-slide-up rounded-xl border border-dark-border bg-dark-card p-6 transition-all hover:border-accent/50 hover:shadow-glow"
              >
                <h2 className="text-lg font-semibold">{match.name}</h2>
                {match.description && <p className="mt-2 line-clamp-2 text-sm text-gray-400">{match.description}</p>}
                <p className="mt-4 text-xs text-accent">{match.reel_ids?.length ?? 0} reels</p>
              </Link>
            ))}
          </div>
          {matches.length === 50 && (
            <p className="mt-6 text-center text-xs text-gray-500">Showing the newest 50 matches. Search by name to narrow the list.</p>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-dark-border bg-dark-card px-5 py-12 text-center">
          <p className="font-semibold text-white">
            {deferredSearch ? `No matches found for “${deferredSearch}”.` : 'No match pages have been published yet.'}
          </p>
          <p className="mt-2 text-sm text-gray-400">
            {deferredSearch ? 'Try a shorter player, event, or match name.' : 'Host the first match, or browse tournaments that are already accepting players.'}
          </p>
          {!deferredSearch && (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link to="/matches/create" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-dark">Host a match</Link>
              <Link to="/tournaments" className="rounded-lg border border-dark-border px-4 py-2 text-sm font-semibold text-gray-200">Browse tournaments</Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
