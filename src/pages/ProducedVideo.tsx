import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { YouTubeEmbed } from '@/components/YouTubeEmbed'
import { ShareButton } from '@/components/ShareButton'
import { Avatar } from '@/components/ui'
import { canonicalShareUrl } from '@/lib/canonicalUrl'
import { producedVideoById, producedVideoRoute, type ProducedVideo as ProducedVideoModel } from '@/lib/producedVideos'
import { domainLeagueSlug } from '@/lib/leagueDomain'
import { fetchLeagueBySlug, fetchLeagueForMembers, type LeagueConfig } from '@/lib/leagueConfig'

/**
 * PRODUCED VIDEO — the public page for ONE multi-angle upload, at
 * `/produced/:youtubeId`.
 *
 * Why it exists: a produced video had no page of its own, so the Share button
 * on a playing video could only offer the page it happened to sit on (a feed,
 * or the profile you were browsing). A recipient landed somewhere that may not
 * even contain the video, and a member had nothing to post to their league
 * feed. This is that missing per-video destination, and the share target.
 *
 * PUBLIC READ, like the tournament detail page: `clip_records`, `match_versions`,
 * `profiles`, `leagues` and `league_members` are all `select: 'public'` in the
 * server's TABLE POLICY, so a SIGNED-OUT visitor following a shared link sees
 * the video, who is in it, and which league it belongs to — then gets a join
 * prompt instead of a wall.
 */
export function ProducedVideo() {
  const { youtubeId } = useParams()
  const { user } = useAuth()
  const [video, setVideo] = useState<ProducedVideoModel | null>(null)
  const [profiles, setProfiles] = useState<Record<string, { username: string | null; avatar_url: string | null }>>({})
  const [league, setLeague] = useState<LeagueConfig | null>(null)
  const [loading, setLoading] = useState(true)

  const id = (youtubeId ?? '').trim()

  useEffect(() => {
    let alive = true
    setLoading(true)
    setVideo(null)
    setProfiles({})
    setLeague(null)
    if (!id) {
      setLoading(false)
      return
    }
    ;(async () => {
      const found = await producedVideoById(id).catch(() => null)
      if (!alive) return
      setVideo(found)
      setLoading(false)
      if (!found) return

      const ids = found.participants.map((p) => p.id)
      if (ids.length) {
        // Avatars + canonical usernames for the participant strip.
        try {
          const { data } = await supabase.from('profiles').select('id, username, avatar_url').in('id', ids)
          if (alive && data) {
            setProfiles(
              Object.fromEntries(
                (data as { id: string; username: string | null; avatar_url: string | null }[]).map((row) => [
                  String(row.id),
                  { username: row.username, avatar_url: row.avatar_url },
                ]),
              ),
            )
          }
        } catch { /* profiles unreadable — chips still render from the handle */ }
      }

      const resolved = await leagueForParticipants(ids)
      if (alive) setLeague(resolved)
    })()
    return () => { alive = false }
  }, [id])

  const shareUrl = canonicalShareUrl(producedVideoRoute(id))

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading video…</div>
      </div>
    )
  }

  if (!video) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center gap-3 py-20">
        <p className="text-gray-300">We can't find that video.</p>
        <p className="text-sm text-gray-500 max-w-md">
          Produced videos appear here once the multi-angle render is uploaded and its players are credited. If it
          was just made, give it a moment.
        </p>
        <Link to="/videos" className="mt-2 px-4 py-2 rounded-lg bg-accent text-dark font-semibold">
          Browse videos
        </Link>
      </div>
    )
  }

  const when = video.createdAt ? new Date(video.createdAt).toLocaleDateString() : null

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
        <YouTubeEmbed videoId={video.youtubeId} title={video.title} shareRoute={producedVideoRoute(video.youtubeId)} />
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">{video.title}</h1>
              <p className="text-gray-400 mt-1 text-sm">
                {video.angleCount} {video.angleCount === 1 ? 'angle' : 'angles'}
                {when && <> · {when}</>}
                {league && (
                  <>
                    {' · '}
                    <Link to="/leagues" className="text-accent hover:underline">{league.name}</Link>
                  </>
                )}
              </p>
            </div>
            <ShareButton url={shareUrl} title={video.title} />
          </div>

          {video.participants.length > 0 && (
            <div className="mt-5">
              <h2 className="text-xs uppercase tracking-wide text-gray-500 mb-2">In this match</h2>
              <div className="flex flex-wrap gap-2">
                {video.participants.map((p) => {
                  const profile = profiles[p.id]
                  const name = p.handle ?? profile?.username ?? 'player'
                  return (
                    <Link
                      key={p.id}
                      to={`/profile/${p.id}`}
                      className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border border-dark-border bg-dark-elevated/60 hover:border-accent/50 hover:text-accent transition-colors"
                    >
                      <Avatar src={profile?.avatar_url ?? undefined} name={name} seed={p.id} size={24} />
                      <span className="text-sm">{name}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-4 text-sm">
            <a
              href={video.watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-accent"
            >
              Watch on YouTube ↗
            </a>
            <Link to="/videos" className="text-gray-500 hover:text-accent">All produced videos</Link>
          </div>
        </div>
      </div>

      {!user && (
        <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-5 text-center">
          <p className="text-sm text-gray-300">
            Every angle of this match, in one cut. Join {league?.name ?? 'TKO'} to get your own matches produced.
          </p>
          <Link to="/signup" className="inline-block mt-3 px-4 py-2 rounded-lg bg-accent text-dark font-semibold">
            Create an account
          </Link>
        </div>
      )}
    </div>
  )
}

/**
 * Which league does this video belong to? A produced video carries no league
 * column — its league is the one its PLAYERS compete in. Falls back to the
 * league whose domain the visitor is on, so a shared link opened on a league
 * domain stays in-league.
 */
async function leagueForParticipants(userIds: string[]): Promise<LeagueConfig | null> {
  const byMembership = await fetchLeagueForMembers(userIds).catch(() => null)
  if (byMembership) return byMembership
  const domain = domainLeagueSlug()
  return domain ? fetchLeagueBySlug(domain).catch(() => null) : null
}

export default ProducedVideo
