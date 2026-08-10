import { Link } from 'react-router-dom'
import { producedVideoRoute, type ProducedVideo } from '@/lib/producedVideos'
import { YouTubeEmbed } from '@/components/YouTubeEmbed'

/**
 * One produced multi-angle video — an IN-APP YouTube player (click-to-load),
 * title, the players/angles in it, a timestamp, and a keep-it link out to the
 * YouTube watch page. Used by the Recent videos feed, the home strip and a
 * player's "My Clips" produced section. The primary play is the in-app embed;
 * the external link stays as a secondary "open on YouTube".
 *
 * `variant='strip'` is the compact fixed-width card for a horizontal rail;
 * `variant='grid'` fills its grid cell.
 */
export function ProducedVideoCard({
  video,
  variant = 'grid',
}: {
  video: ProducedVideo
  variant?: 'grid' | 'strip'
}) {
  const who =
    video.handles.length > 0
      ? video.handles.slice(0, 3).join(', ') + (video.handles.length > 3 ? ` +${video.handles.length - 3}` : '')
      : video.angleCount > 0
        ? `${video.angleCount} angle${video.angleCount === 1 ? '' : 's'}`
        : 'TKO · multi-angle'
  const when = video.createdAt ? new Date(video.createdAt).toLocaleDateString() : null

  return (
    <div
      className={`group rounded-xl border border-dark-border bg-dark-card overflow-hidden hover:border-accent/50 hover:shadow-glow transition-all ${
        variant === 'strip' ? 'shrink-0 w-64 snap-start' : 'block'
      }`}
    >
      <YouTubeEmbed
        videoId={video.youtubeId}
        title={video.title}
        preview
        shareRoute={producedVideoRoute(video.youtubeId)}
        overlay={
          <>
            <span className="absolute top-2 left-2 text-[10px] font-bold px-1.5 py-0.5 rounded border bg-accent/20 text-accent border-accent/30">
              MULTI-ANGLE
            </span>
            {video.angleCount > 1 && (
              <span className="absolute bottom-2 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-dark/80 text-gray-200">
                {video.angleCount} angles
              </span>
            )}
          </>
        }
      />
      <div className="p-3">
        <h3 className="font-semibold truncate">
          <Link to={producedVideoRoute(video.youtubeId)} className="hover:text-accent">
            {video.title}
          </Link>
        </h3>
        <p className="text-xs text-gray-400 mt-1 truncate">{who}</p>
        {when && <p className="text-[11px] text-gray-500 mt-0.5">{when}</p>}
        <a
          href={video.watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-1.5 text-[11px] text-gray-500 hover:text-accent"
        >
          Watch on YouTube ↗
        </a>
      </div>
    </div>
  )
}

/**
 * A thin row of clickable player chips for a produced video — links each
 * appearing profile to their page. Rendered under a card where useful.
 *
 * Labels come off `participants`, where the gamertag travels WITH its player
 * id. It used to index a separate `handles` array by position, which silently
 * put the wrong name on a chip (or the placeholder "player" on all of them)
 * whenever a handle was missing.
 */
export function ProducedVideoPlayers({ video }: { video: ProducedVideo }) {
  if (video.participants.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {video.participants.map((p) => (
        <Link
          key={p.id}
          to={`/profile/${p.id}`}
          className="text-[11px] px-1.5 py-0.5 rounded bg-dark-border/40 text-accent hover:bg-accent/20"
        >
          {p.handle ?? 'player'}
        </Link>
      ))}
    </div>
  )
}

export default ProducedVideoCard
