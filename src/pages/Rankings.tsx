import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { AdSlot } from '@/components/AdSlot'

type MatchType = 'survival' | 'quick_match' | 'red_white' | 'ninja_world_league' | 'tournament'

type RankedProfile = {
  id: string
  username: string
  avatar_url: string | null
  power_level: number
  rating: number
}

export function Rankings() {
  const [matchType, setMatchType] = useState<MatchType>('survival')
  const [ranked, setRanked] = useState<RankedProfile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      try {
        const { data: ratings } = await supabase
          .from('power_ratings')
          .select('profile_id, rating')
          .eq('match_type', matchType)
          .order('rating', { ascending: false })
          .limit(50)
        const ids = (ratings ?? []).map((r) => r.profile_id)
        if (ids.length === 0) {
          setRanked([])
          setLoading(false)
          return
        }
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, avatar_url, power_level')
          .in('id', ids)
        const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))
        const ordered = (ratings ?? [])
          .map((r) => {
            const p = profileMap.get(r.profile_id)
            return p ? { ...p, rating: r.rating, power_level: p.power_level ?? 0 } : null
          })
          .filter((x): x is RankedProfile => x != null)
        setRanked(ordered)
      } catch {
        setRanked([])
      }
      setLoading(false)
    }
    fetch()
  }, [matchType])

  const matchLabels: Record<MatchType, string> = {
    survival: 'Survival',
    quick_match: 'Quick Match',
    red_white: 'Red vs White',
    ninja_world_league: 'Ninja World League',
    tournament: 'Tournament',
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Hall of Fame</h1>
      <p className="text-gray-400 mb-6">Top players by power rating. Submit match results to climb the ranks.</p>

      <AdSlot slotId="rankings-hero-below" className="mb-6" />

      <div className="flex flex-wrap gap-2 mb-6">
        {(Object.keys(matchLabels) as MatchType[]).map((t) => (
          <button
            key={t}
            onClick={() => setMatchType(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              matchType === t ? 'bg-accent text-dark' : 'bg-dark-border/30 text-gray-400 hover:text-white'
            }`}
          >
            {matchLabels[t]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="animate-pulse text-gray-400">Loading rankings...</div>
      ) : ranked.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark-card p-12 text-center text-gray-400">
          <p>No rankings yet for this mode.</p>
          <Link to="/submit-result" className="text-accent hover:underline mt-2 inline-block">
            Submit a match result
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {ranked.map((p, i) => (
            <div key={p.id}>
              {i > 0 && i % 10 === 0 && <AdSlot slotId="rankings-between" className="my-6" />}
              <Link
                to={`/profile/${p.id}`}
                className="flex items-center gap-4 rounded-lg border border-dark-border bg-dark-card p-4 hover:border-accent/50 transition-colors"
              >
                <span className="text-gray-500 w-8 font-mono">#{i + 1}</span>
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold">
                    {p.username[0]?.toUpperCase() ?? '?'}
                  </div>
                )}
                <span className="font-medium flex-1">{p.username}</span>
                <span className="text-accent font-semibold">PL {p.power_level}</span>
                <span className="text-gray-500 text-sm">Rating {p.rating}</span>
              </Link>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8">
        <Link to="/submit-result" className="text-accent hover:underline">
          Submit match result →
        </Link>
      </div>
    </div>
  )
}
