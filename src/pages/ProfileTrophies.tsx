import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

type Trophy = {
  id: string
  profile_id: string
  trophy_type: string
  metadata: Record<string, unknown>
  earned_at: string
}

const TROPHY_LABELS: Record<string, string> = {
  centurion: 'Centurion (100+ points)',
  top_dog: 'Top Dog (1000+ points)',
  legendary: 'Legendary (5000+ points)',
  its_over_9000: "It's Over 9000!",
  tournament_win: 'Tournament Win',
}

export function ProfileTrophies() {
  const { userId } = useParams()
  const [trophies, setTrophies] = useState<Trophy[]>([])
  const [username, setUsername] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) return
    async function load() {
      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', userId)
        .single()
      setUsername(profile?.username ?? null)

      const { data } = await supabase
        .from('trophies')
        .select('id, profile_id, trophy_type, metadata, earned_at')
        .eq('profile_id', userId)
        .order('earned_at', { ascending: false })
      setTrophies(data ?? [])
      setLoading(false)
    }
    load()
  }, [userId])

  if (loading) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="animate-pulse text-gray-400">Loading trophies...</div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link to={`/profile/${userId}`} className="text-accent hover:underline text-sm mb-4 inline-block">
        ← Back to {username ?? 'profile'}
      </Link>
      <h1 className="text-2xl font-bold mb-2">Trophies earned</h1>
      <p className="text-gray-400 mb-6">
        {username ? `${username}'s trophies` : 'All trophies earned'}
      </p>

      {trophies.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark-card p-12 text-center text-gray-400">
          No trophies yet.
        </div>
      ) : (
        <div className="space-y-4">
          {trophies.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-dark-border bg-dark-card p-4 flex items-center justify-between"
            >
              <div>
                <span className="font-medium">
                  {t.trophy_type === 'tournament_win' && t.metadata?.tournament_name
                    ? `Winner: ${String(t.metadata.tournament_name)}`
                    : TROPHY_LABELS[t.trophy_type] ?? t.trophy_type}
                </span>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(t.earned_at).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
