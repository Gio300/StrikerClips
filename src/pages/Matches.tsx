import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase'
import type { Match } from '@/types/database'

export function Matches() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from('matches')
        .select('*')
        .order('created_at', { ascending: false })
      setMatches(data ?? [])
      setLoading(false)
    }
    fetch()
  }, [])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading matches...</div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Matches</h1>
        <Link
          to="/matches/create"
          className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow transition-all"
        >
          Create Match
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {matches.map((match) => (
          <Link
            key={match.id}
            to={`/matches/${match.id}`}
            className="rounded-xl border border-dark-border bg-dark-card p-6 hover:border-accent/50 hover:shadow-glow transition-all animate-slide-up"
          >
            <h2 className="font-semibold text-lg">{match.name}</h2>
            <p className="text-sm text-gray-400 mt-2 line-clamp-2">{match.description}</p>
            <p className="text-xs text-accent mt-4">{match.reel_ids?.length ?? 0} reels</p>
          </Link>
        ))}
      </div>
      {matches.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p>No matches yet.</p>
        </div>
      )}
    </div>
  )
}
