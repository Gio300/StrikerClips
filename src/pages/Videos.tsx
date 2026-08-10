import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { recentProducedVideos, type ProducedVideo } from '@/lib/producedVideos'
import {
  interleaveCreators,
  PRODUCED_WATCH_LIMIT,
  producedVideoCreatorKey,
} from '@/lib/feedDiversity'
import { ReelScrollFeed } from '@/components/ReelScrollFeed'

/**
 * Watch — a full-screen, TikTok-style VERTICAL scroll of produced match reels.
 * Flick up/down to move between reels; the in-view one autoplays with the
 * floating action rail (like/comment/share) on top. Replaces the old card grid
 * so the Watch surface feels like the app you scroll, not a list you browse.
 * "Make a clip" floats top-right; the app's bottom nav stays for navigation.
 */
export function Videos() {
  const [videos, setVideos] = useState<ProducedVideo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    recentProducedVideos(PRODUCED_WATCH_LIMIT)
      .then((v) => alive && setVideos(interleaveCreators(v, producedVideoCreatorKey)))
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  if (loading) {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-black text-accent animate-pulse">
        Loading reels…
      </div>
    )
  }

  return (
    <div className="relative bg-black">
      <ReelScrollFeed videos={videos} />
      <Link
        to="/highlight/create"
        className="fixed top-3 right-3 z-[60] px-4 py-2 rounded-full bg-accent text-dark font-semibold text-sm shadow-glow"
      >
        + Clip
      </Link>
    </div>
  )
}

export default Videos
