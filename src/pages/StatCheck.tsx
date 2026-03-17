import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { AdSlot } from '@/components/AdSlot'

type Tournament = {
  id: string
  name: string
  description: string | null
  created_at: string
}

export function StatCheck() {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('tournaments')
        .select('id, name, description, created_at')
        .order('created_at', { ascending: false })
      setTournaments(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Stat Check</h1>
      <p className="text-gray-400 mb-6">
        Submit videos showing character buffs for a tournament. Select a tournament to submit or review stat checks.
      </p>

      <AdSlot slotId="stat-check-hero-below" className="mb-6" />

      {loading ? (
        <div className="animate-pulse text-gray-400">Loading tournaments...</div>
      ) : tournaments.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center">
          <p className="text-gray-400 mb-4">No tournaments yet.</p>
          <Link to="/tournaments" className="text-accent hover:underline">
            Create or browse tournaments
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="font-semibold">Select a tournament</h2>
          {tournaments.map((t) => (
            <Link
              key={t.id}
              to={`/tournaments/${t.id}`}
              className="block rounded-xl border border-dark-border bg-dark-card p-6 hover:border-accent/50 transition-colors"
            >
              <h3 className="font-semibold text-lg">{t.name}</h3>
              {t.description && (
                <p className="text-gray-400 text-sm mt-1 line-clamp-2">{t.description}</p>
              )}
              <p className="text-accent text-sm mt-2">Submit or review stat checks →</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
