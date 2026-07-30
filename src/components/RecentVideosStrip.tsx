import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { recentProducedVideos, type ProducedVideo } from '@/lib/producedVideos'
import { ProducedVideoCard } from '@/components/ProducedVideoCard'

/**
 * "Fresh videos" — the compact horizontal rail of the most recently produced
 * multi-angle videos, shown on the home launcher. Mirrors LiveNowStrip: renders
 * NOTHING when there are no produced videos yet, so it never clutters a fresh
 * account, and links to the full /videos feed.
 */
export function RecentVideosStrip({ limit = 12, className }: { limit?: number; className?: string }) {
  const [videos, setVideos] = useState<ProducedVideo[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    recentProducedVideos(limit)
      .then((v) => {
        if (alive) setVideos(v)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [limit])

  if (!loaded || videos.length === 0) return null

  return (
    <section className={`mb-6 ${className ?? ''}`}>
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-gray-300">Fresh videos</h2>
        <Link to="/videos" className="text-xs text-accent hover:underline">
          See all
        </Link>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {videos.map((v) => (
          <ProducedVideoCard key={v.youtubeId} video={v} variant="strip" />
        ))}
      </div>
    </section>
  )
}

export default RecentVideosStrip
