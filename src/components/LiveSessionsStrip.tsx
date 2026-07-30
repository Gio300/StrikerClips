import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { liveSessionsNow, liveSessionsForHost } from '@/lib/liveSessions'
import { extractYouTubeId } from '@/lib/youtubeApi'
import { YouTubeEmbed } from '@/components/YouTubeEmbed'
import type { LiveSession } from '@/types/database'

/**
 * The YouTube id to play in-app for a session, if any: the produced video once
 * the session has ended, else a YouTube live URL we can extract an id from.
 * In-app routes / non-YouTube links have no id and fall back to the link-out.
 */
function embedIdFor(s: LiveSession): string | null {
  const yid = (s.youtube_id ?? '').trim()
  if (yid) return yid
  return extractYouTubeId((s.watch_url ?? '').trim()) || null
}

/**
 * "Live now" — the unified live indicator read from `live_sessions`. Shows who
 * is live (a host going live, a player battle, a solo stream) with a way to open
 * the live view. Two scopes:
 *
 *   • no `hostId`  → everyone live right now (home + the Live hub);
 *   • `hostId`     → just that player's live sessions (their profile).
 *
 * Like LiveNowStrip it renders NOTHING when nobody is live, so it never clutters
 * a quiet page.
 */

const KIND_LABEL: Record<LiveSession['kind'], string> = {
  host: 'Hosting live',
  battle: 'Live battle',
  stream: 'Live',
}

/** Open the live view: external YouTube URL in a new tab, in-app route inline. */
function OpenLive({ session }: { session: LiveSession }) {
  const url = (session.watch_url ?? '').trim()
  const label = 'Watch'
  if (/^https?:\/\//i.test(url)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-semibold text-dark bg-accent px-2.5 py-1 rounded-full hover:shadow-glow"
      >
        {label}
      </a>
    )
  }
  return (
    <Link
      to={url || '/live?tab=watch'}
      className="text-xs font-semibold text-dark bg-accent px-2.5 py-1 rounded-full hover:shadow-glow"
    >
      {label}
    </Link>
  )
}

export function LiveSessionsStrip({
  hostId,
  limit = 12,
  className,
}: {
  hostId?: string
  limit?: number
  className?: string
}) {
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    const load = hostId ? liveSessionsForHost(hostId) : liveSessionsNow(limit)
    load
      .then((s) => {
        if (alive) setSessions(s.slice(0, limit))
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [hostId, limit])

  if (!loaded || sessions.length === 0) return null

  return (
    <section className={`mb-6 ${className ?? ''}`}>
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="live-dot" />
        <h2 className="text-sm font-semibold tracking-wide uppercase text-gray-300">
          {hostId ? 'Live now' : "Who's live"}
        </h2>
      </div>
      <div className="space-y-2">
        {sessions.map((s) => {
          const embedId = embedIdFor(s)
          return (
            <div
              key={s.id}
              className="rounded-lg border border-accent/40 bg-dark-card overflow-hidden"
            >
              {/* In-app player when the live has a YouTube id (produced video or a
                  YouTube live URL); the link-out stays as a secondary action. */}
              {embedId && <YouTubeEmbed videoId={embedId} title={s.title || 'Live session'} />}
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="pill-kunai">
                      <span className="live-dot" />
                      LIVE
                    </span>
                    <span className="text-xs text-gray-400">{KIND_LABEL[s.kind] ?? 'Live'}</span>
                  </div>
                  <p className="text-sm font-medium text-white truncate mt-1">
                    {s.title || 'Live session'}
                  </p>
                </div>
                <OpenLive session={s} />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default LiveSessionsStrip
