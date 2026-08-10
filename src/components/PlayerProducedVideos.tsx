import { useEffect, useState } from 'react'
import { producedVideosForPlayer, type ProducedVideo } from '@/lib/producedVideos'
import { ProducedVideoCard, ProducedVideoPlayers } from '@/components/ProducedVideoCard'

/**
 * The produced multi-angle videos a player appears in — their finished clips
 * with a `youtube_id`, joined across everyone in each video. Used both on the
 * signed-in user's My Clips page and on any player's public profile.
 *
 * Renders a heading + grid; on an empty result it shows a short empty state
 * (own profile) or nothing (someone else's), matching the profile's other
 * sections. Reads are public, so it works for any `playerId`.
 */
export function PlayerProducedVideos({
  playerId,
  isOwn = false,
  limit = 24,
}: {
  playerId: string
  isOwn?: boolean
  limit?: number
}) {
  const [videos, setVideos] = useState<ProducedVideo[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    setLoaded(false)
    producedVideosForPlayer(playerId, limit)
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
  }, [playerId, limit])

  // On someone else's profile, stay invisible until we know there's something.
  if (!loaded && !isOwn) return null
  if (loaded && videos.length === 0 && !isOwn) return null

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold mb-4">Produced videos</h2>
      {!loaded ? (
        <p className="text-gray-400 text-sm animate-pulse">Loading videos…</p>
      ) : videos.length === 0 ? (
        <p className="text-gray-400 text-sm">
          No produced videos yet. Eligible new Shinobi Striker gameplay uploaded after signup is analyzed,
          rendered, and published automatically. Processing can take time; older pre-signup uploads are not backfilled.
        </p>
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
    </section>
  )
}

export default PlayerProducedVideos
