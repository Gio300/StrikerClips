import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Clapperboard,
  Crown,
  Play,
  Radio,
  Swords,
  Trophy,
  Video,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { BRAND } from '@/lib/brand'
import { AdSlot } from '@/components/AdSlot'
import { LiveNowStrip } from '@/components/LiveNowStrip'
import { resolveLayout } from '@/lib/reelLayout'
import type { Reel, ReelLayout } from '@/types/database'

type HomeReel = Reel & {
  profiles?: { username: string; power_level?: number }
}

export function Landing() {
  const { user } = useAuth()
  const [reels, setReels] = useState<HomeReel[]>([])
  const [streams, setStreams] = useState<{ id: string; youtube_url: string; title: string | null }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchHome() {
      const [reelsRes, streamsRes] = await Promise.all([
        supabase
          .from('reels')
          .select('*, profiles(username, power_level)')
          .order('created_at', { ascending: false })
          .limit(6),
        supabase
          .from('live_streams')
          .select('id, youtube_url, title, is_live')
          .order('created_at', { ascending: false })
          .limit(12),
      ])

      setReels((reelsRes.data ?? []) as unknown as HomeReel[])
      const liveOnly = (streamsRes.data ?? [])
        .filter((row) => (row as { is_live?: boolean | null }).is_live !== false)
        .slice(0, 4)
        .map(({ id, youtube_url, title }) => ({ id, youtube_url, title }))
      setStreams(liveOnly)
      setLoading(false)
    }

    fetchHome()
  }, [])

  return (
    <div className="page-shell animate-fade-in">
      <header className="mb-5 flex flex-col gap-4 border-b border-dark-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-kunai">TKO home</p>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">
            {user ? 'Your arena is ready.' : 'Watch the play. Build the replay.'}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-400">
            Multi-angle highlights, live squads, tournaments, power levels, and clan competition in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={user ? '/highlight/create' : '/signup'} className="btn-primary">
            <Clapperboard size={17} />
            {user ? 'Create reel' : 'Join TKO'}
          </Link>
          <Link to="/live" className="btn-ghost">
            <Radio size={17} />
            Live
          </Link>
        </div>
      </header>

      <nav className="mb-7 grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="TKO quick actions">
        <QuickAction to="/highlight/create" icon={Video} title="Create" detail="Build a multi-angle reel" />
        <QuickAction to="/tournaments" icon={Trophy} title="Compete" detail="Find or run a bracket" />
        <QuickAction to="/conquest" icon={Swords} title="Conquest" detail="Fight for clan territory" />
        <QuickAction to="/rankings" icon={Crown} title="Rankings" detail="Track your power level" />
      </nav>

      <LiveNowStrip placement="front_page" />

      {streams.length > 0 && (
        <section className="mb-8">
          <SectionHeader title="Community live" detail="Active feeds from across TKO." to="/live" />
          <div className="grid gap-3 md:grid-cols-2">
            {streams.slice(0, 2).map((stream) => {
              const videoId = stream.youtube_url?.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1]
              return (
                <Link key={stream.id} to="/live" className="card card-hover group">
                  <div className="relative aspect-video bg-black">
                    {videoId ? (
                      <img
                        src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-gray-600">
                        <Radio size={32} />
                      </div>
                    )}
                    <span className="pill-kunai absolute left-3 top-3">
                      <span className="live-dot" />
                      LIVE
                    </span>
                    <span className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-dark">
                        <Play size={20} fill="currentColor" />
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <p className="truncate font-medium">{stream.title ?? 'Live stream'}</p>
                    <ArrowRight size={16} className="shrink-0 text-gray-500" />
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      <section className="mb-8">
        <SectionHeader title="Recent highlights" detail="Fresh multi-angle plays from the community." to="/reels" />

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="card animate-pulse">
                <div className="aspect-[9/16] bg-dark-elevated sm:aspect-video" />
                <div className="space-y-2 p-4">
                  <div className="h-4 w-3/4 rounded bg-dark-elevated" />
                  <div className="h-3 w-1/2 rounded bg-dark-elevated" />
                </div>
              </div>
            ))}
          </div>
        ) : reels.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-dark-border bg-dark-card/60 p-6 text-center">
            <Clapperboard size={32} className="mb-3 text-gray-500" />
            <p className="text-sm text-gray-300">No highlights have landed yet.</p>
            <Link to={user ? '/highlight/create' : '/signup'} className="btn-primary mt-4">
              {user ? 'Create the first reel' : 'Join and create one'}
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {reels.map((reel) => (
              <ReelCard key={reel.id} reel={reel} />
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <AdSlot slotId="landing-mid" shape="banner" />
      </section>

      <footer className="border-t border-dark-border py-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
          <span>© {new Date().getFullYear()} {BRAND.domain}</span>
          <Link to="/terms" className="hover:text-white">Terms</Link>
          <Link to="/privacy" className="hover:text-white">Privacy</Link>
          <Link to="/data-deletion" className="hover:text-white">Data deletion</Link>
        </div>
      </footer>
    </div>
  )
}

function SectionHeader({ title, detail, to }: { title: string; detail: string; to: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="section-heading">{title}</h2>
        <p className="mt-1 text-sm text-gray-500">{detail}</p>
      </div>
      <Link to={to} className="inline-flex shrink-0 items-center gap-1 text-sm text-gray-400 hover:text-white">
        View all
        <ArrowRight size={15} />
      </Link>
    </div>
  )
}

function QuickAction({
  to,
  icon: Icon,
  title,
  detail,
}: {
  to: string
  icon: typeof Video
  title: string
  detail: string
}) {
  return (
    <Link
      to={to}
      className="group flex min-h-20 items-center gap-3 rounded-lg border border-dark-border bg-dark-card px-3 py-3 transition-colors hover:border-gray-500 hover:bg-dark-elevated"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-dark-elevated text-accent group-hover:text-white">
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="block truncate text-xs text-gray-500">{detail}</span>
      </span>
    </Link>
  )
}

function ReelCard({ reel }: { reel: HomeReel }) {
  const layout: ReelLayout = resolveLayout(reel)

  return (
    <Link to={`/reels/${reel.id}`} className="card card-hover group">
      <div className="relative aspect-[9/16] overflow-hidden bg-black sm:aspect-video">
        {reel.thumbnail ? (
          <img
            src={reel.thumbnail}
            alt=""
            className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.02] sm:object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-600">
            <Video size={34} />
          </div>
        )}
        {layout !== 'concat' && (
          <span className="pill absolute left-2 top-2 bg-black/70">
            {layout === 'grid'
              ? '2x2'
              : layout === 'side-by-side'
                ? 'SxS'
                : layout === 'pip'
                  ? 'PiP'
                  : layout === 'ultra'
                    ? 'Ultra'
                    : 'Action'}
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-dark">
            <Play size={20} fill="currentColor" />
          </span>
        </span>
      </div>
      <div className="p-4">
        <h3 className="truncate font-semibold text-white">{reel.title}</h3>
        <p className="mt-1 truncate text-sm text-gray-500">
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
