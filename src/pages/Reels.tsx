import { useEffect, useState, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { AdSlot } from '@/components/AdSlot'
import type { Reel } from '@/types/database'

export function Reels() {
  const [reels, setReels] = useState<Reel[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from('reels')
        .select('*, profiles(username, power_level)')
        .order('created_at', { ascending: false })
      setReels(data ?? [])
      setLoading(false)
    }
    fetch()
  }, [])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading reels...</div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Highlight Reels</h1>
        <Link
          to="/reels/create"
          className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow transition-all"
        >
          Create Reel
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reels.map((reel, idx) => (
          <Fragment key={reel.id}>
            <Link
              to={`/reels/${reel.id}`}
              className="group rounded-xl border border-dark-border bg-dark-card overflow-hidden hover:border-accent/50 hover:shadow-glow transition-all animate-slide-up"
            >
              <div className="aspect-video bg-dark flex items-center justify-center">
                {reel.thumbnail ? (
                  <img src={reel.thumbnail} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-4xl text-dark-border group-hover:text-accent/50 transition-colors">
                    <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="p-4">
                <h2 className="font-semibold truncate">{reel.title}</h2>
                <p className="text-sm text-gray-400 mt-1">
                  <Link to={`/profile/${reel.user_id}`} className="text-accent hover:underline">{(reel as Reel & { profiles?: { username: string; power_level?: number } }).profiles?.username ?? 'Unknown'}</Link>
                  {((reel as Reel & { profiles?: { power_level?: number } }).profiles?.power_level != null && (reel as Reel & { profiles?: { power_level?: number } }).profiles!.power_level! > 0) && (
                    <> · PL {(reel as Reel & { profiles?: { power_level?: number } }).profiles!.power_level}</>
                  )}
                  {' • '}{reel.clip_ids?.length ?? 0} clips
                </p>
              </div>
            </Link>
            {/* Inline ad after every 6 reels — feels native to the feed. */}
            {(idx + 1) % 6 === 0 && idx !== reels.length - 1 && (
              <div className="md:col-span-2 lg:col-span-3">
                <AdSlot slotId="reels-list-inline" shape="leaderboard" />
              </div>
            )}
          </Fragment>
        ))}
      </div>
      {reels.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p>No reels yet. Create the first one!</p>
          <Link to="/reels/create" className="mt-4 inline-block text-accent hover:underline">Create Reel</Link>
        </div>
      )}
    </div>
  )
}
