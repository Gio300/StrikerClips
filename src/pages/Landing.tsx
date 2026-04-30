import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { BrandLogo } from '@/components/BrandLogo'
import { BRAND } from '@/lib/brand'
import { AdSlot } from '@/components/AdSlot'
import { resolveLayout } from '@/lib/reelLayout'
import type { Reel, ReelLayout } from '@/types/database'

export function Landing() {
  const { user } = useAuth()
  const [reels, setReels] = useState<(Reel & { profiles?: { username: string; power_level?: number } })[]>([])
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
    <div className="px-6 md:px-10 py-10 md:py-16 max-w-6xl mx-auto animate-fade-in">
      {/* HERO */}
      <section className="text-center mb-16 md:mb-20">
        <div className="inline-flex items-center gap-2 mb-6 pill-kunai whitespace-nowrap">
          <span className="live-dot" /> Free to start · {BRAND.name} — {BRAND.tagline}
        </div>
        <BrandLogo as="h1" className="text-5xl md:text-6xl lg:text-7xl block mb-5" />
        <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-8">
          Turn squad clips into one reel, run brackets, and share everywhere — any game, right in the browser. Optional
          desktop app later for OAuth, local AI help, and stream tools.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          {user ? (
            <>
              <Link to="/highlight/create" className="btn-primary">
                <PlusIcon /> Create a reel
              </Link>
              <Link to="/reels" className="btn-ghost">Browse Reels</Link>
              <Link to="/live" className="btn-ghost">Live Now</Link>
            </>
          ) : (
            <>
              <Link to="/signup" className="btn-primary">
                Get Started <ArrowRightIcon />
              </Link>
              <Link to="/reels" className="btn-ghost">Browse Reels</Link>
            </>
          )}
        </div>

        {/* Feature strip */}
        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
          <FeaturePill icon="🎬" label="Multi-angle reels" />
          <FeaturePill icon="🏆" label="Tournaments" />
          <FeaturePill icon="⚡" label="Power-level rankings" />
          <FeaturePill icon="💬" label="Community boards" />
        </div>
      </section>

      {/* LIVE NOW */}
      {streams.length > 0 && (
        <section className="mb-14">
          <div className="flex items-end justify-between mb-5">
            <div>
              <h2 className="text-2xl font-semibold">Live Now</h2>
              <p className="text-sm text-gray-500 mt-1">Catch active community streams.</p>
            </div>
            <Link to="/live" className="text-sm text-kunai hover:underline">View all →</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {streams.slice(0, 2).map((s) => {
              const videoId = s.youtube_url?.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1]
              return (
                <Link key={s.id} to="/live" className="card card-hover">
                  {videoId && (
                    <div className="aspect-video bg-black">
                      <iframe
                        src={`https://www.youtube.com/embed/${videoId}`}
                        title={s.title ?? 'Stream'}
                        className="w-full h-full"
                        allowFullScreen
                      />
                    </div>
                  )}
                  <div className="p-4 flex items-center justify-between gap-3">
                    <p className="font-medium truncate">{s.title ?? 'Stream'}</p>
                    <span className="pill-kunai shrink-0"><span className="live-dot" />LIVE</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* MID-PAGE AD */}
      <section className="mb-12">
        <AdSlot slotId="landing-mid" shape="banner" />
      </section>

      {/* RECENT HIGHLIGHTS */}
      <section>
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="text-2xl font-semibold">Recent Highlights</h2>
            <p className="text-sm text-gray-500 mt-1">Multi-angle plays from the squad.</p>
          </div>
          <Link to="/reels" className="text-sm text-kunai hover:underline">View all →</Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card animate-pulse">
                <div className="aspect-video bg-dark-elevated" />
                <div className="p-4 space-y-2">
                  <div className="h-4 w-3/4 bg-dark-elevated rounded" />
                  <div className="h-3 w-1/2 bg-dark-elevated rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : reels.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="text-5xl mb-3">🎬</div>
            <p className="text-gray-400 mb-3">No highlights yet. Be the first.</p>
            <Link to={user ? '/highlight/create' : '/signup'} className="btn-primary">
              {user ? 'Create the first reel' : 'Sign up to create one'}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {reels.map((reel) => (
              <ReelCard key={reel.id} reel={reel} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ReelCard({ reel }: { reel: Reel & { profiles?: { username: string; power_level?: number } } }) {
  const layout: ReelLayout = resolveLayout(reel)
  return (
    <Link to={`/reels/${reel.id}`} className="card card-hover group">
      <div className="aspect-video bg-dark-elevated relative overflow-hidden">
        {reel.thumbnail ? (
          <img src={reel.thumbnail} alt="" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-12 h-12 text-dark-border" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {/* Layout badge */}
        {layout !== 'concat' && (
          <div className="absolute top-2 left-2 pill-kunai">
            {layout === 'grid' ? '2×2'
              : layout === 'side-by-side' ? 'SxS'
              : layout === 'pip' ? 'PiP'
              : layout === 'ultra' ? 'ULTRA'
              : 'ACTION'}
          </div>
        )}
        {/* Play overlay on hover */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity w-14 h-14 rounded-full bg-gradient-kunai flex items-center justify-center shadow-kunai">
            <svg className="w-6 h-6 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-semibold truncate group-hover:text-kunai transition-colors">{reel.title}</h3>
        <p className="text-sm text-gray-400 mt-1 truncate">
          <span className="text-gray-300">{reel.profiles?.username ?? 'Unknown'}</span>
          {reel.profiles?.power_level != null && reel.profiles.power_level > 0 && (
            <> · <span className="text-chakra">PL {reel.profiles.power_level}</span></>
          )}
          {' · '}{reel.clip_ids?.length ?? 0} clips
        </p>
      </div>
    </Link>
  )
}

function FeaturePill({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dark-border bg-dark-card/50 text-sm text-gray-300">
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </div>
  )
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 4v16m8-8H4" />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
    </svg>
  )
}
