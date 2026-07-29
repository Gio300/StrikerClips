import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { recentProducedVideos, type ProducedVideo } from '@/lib/producedVideos'
import { ProducedVideoCard, ProducedVideoPlayers } from '@/components/ProducedVideoCard'
import { LiveSessionsStrip } from '@/components/LiveSessionsStrip'

/**
 * Recent videos — the feed of recently produced multi-angle match videos,
 * newest first. Each card carries a thumbnail, title, the players/angles in it,
 * a timestamp and a link to the YouTube video. The "Who's live" strip sits on
 * top so the live surface and the produced-video feed live in one place.
 */
export function Videos() {
  const [videos, setVideos] = useState<ProducedVideo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    recentProducedVideos(48)
      .then((v) => {
        if (alive) setVideos(v)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Recent videos</h1>
          <p className="text-sm text-gray-500 mt-1">
            Freshly produced multi-angle match videos — every angle combined into one. Newest first.
          </p>
        </div>
        <Link
          to="/highlight/create"
          className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow"
        >
          + Make a clip
        </Link>
      </div>

      <LiveSessionsStrip />

      {loading ? (
        <div className="py-16 text-center text-accent animate-pulse">Loading videos…</div>
      ) : videos.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          <p>No produced videos yet.</p>
          <p className="text-sm mt-1">
            When several angles of one match are combined and posted, they show up here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {videos.map((v) => (
            <div key={v.youtubeId}>
              <ProducedVideoCard video={v} variant="grid" />
              <ProducedVideoPlayers video={v} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Videos
