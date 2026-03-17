import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { BrandLogo } from '@/components/BrandLogo'
import type { Reel } from '@/types/database'

export function Landing() {
  const { user } = useAuth()
  const [reels, setReels] = useState<(Reel & { profiles?: { username: string } })[]>([])
  const [streams, setStreams] = useState<{ id: string; youtube_url: string; title: string | null }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      const [reelsRes, streamsRes] = await Promise.all([
        supabase.from('reels').select('*, profiles(username, power_level)').order('created_at', { ascending: false }).limit(6),
        supabase.from('live_streams').select('id, youtube_url, title').order('created_at', { ascending: false }).limit(4),
      ])
      setReels(reelsRes.data ?? [])
      setStreams(streamsRes.data ?? [])
      setLoading(false)
    }
    fetch()
  }, [])

  return (
    <div className="p-8 max-w-4xl mx-auto animate-fade-in">
      <div className="text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
          <BrandLogo as="h1" className="text-4xl md:text-5xl" />
        </h1>
        <p className="text-lg text-gray-400 mb-6">
          Combine clips into highlight reels. Watch live. Connect with the community.
        </p>
        <div className="flex flex-wrap gap-4 justify-center">
          {user ? (
            <>
              <Link
                to="/highlight/create"
                className="px-6 py-3 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow transition-all"
              >
                Create Highlight
              </Link>
              <Link
                to="/reels"
                className="px-6 py-3 rounded-lg border border-dark-border text-gray-300 hover:border-accent/50 hover:text-accent transition-colors"
              >
                Browse Reels
              </Link>
              <Link
                to="/live"
                className="px-6 py-3 rounded-lg border border-dark-border text-gray-300 hover:border-accent/50 hover:text-accent transition-colors"
              >
                Live Now
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/signup"
                className="px-6 py-3 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow transition-all"
              >
                Get Started
              </Link>
              <Link
                to="/reels"
                className="px-6 py-3 rounded-lg border border-dark-border text-gray-300 hover:border-accent/50 hover:text-accent transition-colors"
              >
                Browse Reels
              </Link>
            </>
          )}
        </div>
      </div>

      {streams.length > 0 && (
        <div className="mb-12">
          <h2 className="text-xl font-semibold mb-4">Live Now</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {streams.slice(0, 2).map((s) => {
              const videoId = s.youtube_url?.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1]
              return (
                <Link key={s.id} to="/live" className="rounded-xl border border-dark-border bg-dark-card overflow-hidden hover:border-accent/50 transition-colors">
                  {videoId && (
                    <div className="aspect-video">
                      <iframe
                        src={`https://www.youtube.com/embed/${videoId}`}
                        title={s.title ?? 'Stream'}
                        className="w-full h-full"
                        allowFullScreen
                      />
                    </div>
                  )}
                  <div className="p-3">
                    <span className="text-sm text-accent font-medium">LIVE</span>
                    <p className="font-medium truncate">{s.title ?? 'Stream'}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Recent Highlights</h2>
          <Link to="/reels" className="text-accent hover:underline text-sm">View all</Link>
        </div>
        {loading ? (
          <div className="animate-pulse text-gray-400">Loading...</div>
        ) : reels.length === 0 ? (
          <div className="rounded-xl border border-dark-border bg-dark-card p-12 text-center text-gray-400">
            <p>No highlights yet.</p>
            <Link to="/signup" className="text-accent hover:underline mt-2 inline-block">Sign up to create one</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {reels.map((reel) => (
              <Link
                key={reel.id}
                to={`/reels/${reel.id}`}
                className="rounded-xl border border-dark-border bg-dark-card overflow-hidden hover:border-accent/50 transition-colors"
              >
                <div className="aspect-video bg-dark flex items-center justify-center">
                  {reel.thumbnail ? (
                    <img src={reel.thumbnail} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <svg className="w-12 h-12 text-dark-border" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-medium truncate">{reel.title}</h3>
                  <p className="text-sm text-gray-400">
                    <Link to={`/profile/${reel.user_id}`} className="text-accent hover:underline">{reel.profiles?.username ?? 'Unknown'}</Link>
                    {(reel.profiles as { power_level?: number })?.power_level != null && (reel.profiles as { power_level?: number }).power_level! > 0 && (
                      <> · PL {(reel.profiles as { power_level?: number }).power_level}</>
                    )}
                    {' • '}{reel.clip_ids?.length ?? 0} clips
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
