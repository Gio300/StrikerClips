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
  rating?: number
  count?: number
}

type HallOfFameCategory = 'tournament_wins' | 'power_level' | 'trophies'

export function Rankings() {
  const [mainTab, setMainTab] = useState<'players' | 'hall-of-fame'>('players')
  const [matchType, setMatchType] = useState<MatchType>('survival')
  const [ranked, setRanked] = useState<RankedProfile[]>([])
  const [hofCategory, setHofCategory] = useState<HallOfFameCategory>('tournament_wins')
  const [hofData, setHofData] = useState<RankedProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [hofLoading, setHofLoading] = useState(false)

  useEffect(() => {
    if (mainTab !== 'players') return
    setLoading(true)
    async function fetch() {
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
  }, [mainTab, matchType])

  useEffect(() => {
    if (mainTab !== 'hall-of-fame') return
    setHofLoading(true)
    async function fetchHof() {
      try {
        if (hofCategory === 'tournament_wins') {
          const { data: results } = await supabase
            .from('tournament_results')
            .select('winner_profile_id')
          const counts = new Map<string, number>()
          for (const r of results ?? []) {
            counts.set(r.winner_profile_id, (counts.get(r.winner_profile_id) ?? 0) + 1)
          }
          const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
          const ids = sorted.map(([id]) => id)
          if (ids.length === 0) {
            setHofData([])
            setHofLoading(false)
            return
          }
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, username, avatar_url, power_level')
            .in('id', ids)
          const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))
          setHofData(
            sorted.map(([id, count]) => {
              const p = profileMap.get(id)
              return p ? { ...p, count, power_level: p.power_level ?? 0 } : null
            }).filter((x): x is RankedProfile => x != null)
          )
        } else if (hofCategory === 'power_level') {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, username, avatar_url, power_level')
            .not('power_level', 'is', null)
            .order('power_level', { ascending: false })
            .limit(10)
          setHofData(
            (profiles ?? []).map((p) => ({
              ...p,
              power_level: p.power_level ?? 0,
            }))
          )
        } else {
          const { data: trophies } = await supabase
            .from('trophies')
            .select('profile_id')
          const counts = new Map<string, number>()
          for (const t of trophies ?? []) {
            counts.set(t.profile_id, (counts.get(t.profile_id) ?? 0) + 1)
          }
          const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
          const ids = sorted.map(([id]) => id)
          if (ids.length === 0) {
            setHofData([])
            setHofLoading(false)
            return
          }
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, username, avatar_url, power_level')
            .in('id', ids)
          const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))
          setHofData(
            sorted.map(([id, count]) => {
              const p = profileMap.get(id)
              return p ? { ...p, count, power_level: p.power_level ?? 0 } : null
            }).filter((x): x is RankedProfile => x != null)
          )
        }
      } catch {
        setHofData([])
      }
      setHofLoading(false)
    }
    fetchHof()
  }, [mainTab, hofCategory])

  const matchLabels: Record<MatchType, string> = {
    survival: 'Survival',
    quick_match: 'Quick Match',
    red_white: 'Red vs White',
    ninja_world_league: 'Ninja World League',
    tournament: 'Tournament',
  }

  const hofLabels: Record<HallOfFameCategory, string> = {
    tournament_wins: 'Most Tournament Wins',
    power_level: 'Highest Power Level',
    trophies: 'Most Trophies',
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Rankings</h1>
      <p className="text-gray-400 mb-6">
        Top players by power rating and Hall of Fame. Submit match results to climb the ranks.
      </p>

      <AdSlot slotId="rankings-hero-below" className="mb-6" />

      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setMainTab('players')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            mainTab === 'players' ? 'bg-accent text-dark' : 'bg-dark-border/30 text-gray-400 hover:text-white'
          }`}
        >
          Players
        </button>
        <button
          onClick={() => setMainTab('hall-of-fame')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            mainTab === 'hall-of-fame' ? 'bg-accent text-dark' : 'bg-dark-border/30 text-gray-400 hover:text-white'
          }`}
        >
          Hall of Fame
        </button>
      </div>

      {mainTab === 'players' && (
        <>
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
                    {p.rating != null && (
                      <span className="text-gray-500 text-sm">Rating {p.rating}</span>
                    )}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mainTab === 'hall-of-fame' && (
        <>
          <div className="flex flex-wrap gap-2 mb-6">
            {(Object.keys(hofLabels) as HallOfFameCategory[]).map((c) => (
              <button
                key={c}
                onClick={() => setHofCategory(c)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  hofCategory === c ? 'bg-accent text-dark' : 'bg-dark-border/30 text-gray-400 hover:text-white'
                }`}
              >
                {hofLabels[c]}
              </button>
            ))}
          </div>

          {hofLoading ? (
            <div className="animate-pulse text-gray-400">Loading Hall of Fame...</div>
          ) : hofData.length === 0 ? (
            <div className="rounded-xl border border-dark-border bg-dark-card p-12 text-center text-gray-400">
              <p>No data yet for this category.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <h2 className="font-semibold">{hofLabels[hofCategory]}</h2>
              {hofData.map((p, i) => (
                <Link
                  key={p.id}
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
                  {hofCategory === 'tournament_wins' && p.count != null && (
                    <span className="text-accent font-semibold">{p.count} wins</span>
                  )}
                  {hofCategory === 'power_level' && (
                    <span className="text-accent font-semibold">PL {p.power_level}</span>
                  )}
                  {hofCategory === 'trophies' && p.count != null && (
                    <span className="text-accent font-semibold">{p.count} trophies</span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      <div className="mt-8">
        <Link to="/submit-result" className="text-accent hover:underline">
          Submit match result →
        </Link>
      </div>
    </div>
  )
}
