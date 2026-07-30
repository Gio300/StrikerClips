import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { fetchLikeState, setReelLike, fetchCommentCount } from '@/lib/reelSocial'
import type { ProducedVideo } from '@/lib/producedVideos'

/**
 * ReelScrollFeed — a TikTok-style, full-screen VERTICAL snap-scroll of produced
 * reels. Each match video (vertical 1080×1920, YouTube-hosted) fills the screen;
 * you flick up/down to move between them. The in-view reel autoplays (muted,
 * looped); the rest show their poster to keep playback to one at a time.
 *
 * Floating controls per reel: right-side action rail (Like / Comment / Share),
 * creator handle + title bottom-left, and the moving TKO watermark. Like is wired
 * to the real reel_likes table (via reelSocial); Comment/Share deep-link to the
 * full reel page.
 */
export function ReelScrollFeed({ videos }: { videos: ProducedVideo[] }) {
  const [active, setActive] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Track which slide is centered so only it autoplays.
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            const idx = Number((e.target as HTMLElement).dataset.idx)
            if (!Number.isNaN(idx)) setActive(idx)
          }
        }
      },
      { root, threshold: [0.6] },
    )
    root.querySelectorAll('[data-idx]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [videos.length])

  if (videos.length === 0) {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center text-gray-400 bg-black">
        <p>No reels yet.</p>
        <p className="text-sm mt-1">Produced match reels will show up here to scroll.</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="h-[100dvh] overflow-y-scroll bg-black"
      style={{ scrollSnapType: 'y mandatory', scrollbarWidth: 'none' }}
    >
      <style>{`
        .tko-reel-scroll::-webkit-scrollbar { display: none; }
        @keyframes tkoHeartRise {
          0% { opacity: 0; transform: translateY(0) scale(0.5); }
          12% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-190px) scale(1.15); }
        }
      `}</style>
      {videos.map((v, i) => (
        <ReelSlide key={v.youtubeId} video={v} idx={i} active={i === active} />
      ))}
    </div>
  )
}

function ReelSlide({ video, idx, active }: { video: ProducedVideo; idx: number; active: boolean }) {
  const { user } = useAuth()
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [commentCount, setCommentCount] = useState(0)
  const [hearts, setHearts] = useState<number[]>([])
  const heartSeq = useRef(0)

  useEffect(() => {
    let alive = true
    fetchLikeState(video.youtubeId, user?.id).then((s) => {
      if (!alive) return
      setLiked(s.liked)
      setLikeCount(s.count)
    })
    fetchCommentCount(video.youtubeId).then((n) => alive && setCommentCount(n))
    return () => {
      alive = false
    }
  }, [video.youtubeId, user?.id])

  async function toggleLike() {
    if (!user) return
    const next = !liked
    setLiked(next)
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)))
    if (next) {
      const id = ++heartSeq.current
      setHearts((h) => [...h, id])
      setTimeout(() => setHearts((h) => h.filter((x) => x !== id)), 1200)
    }
    const persisted = await setReelLike(video.youtubeId, user.id, next)
    if (persisted !== next) {
      setLiked(persisted)
      setLikeCount((c) => Math.max(0, c + (persisted ? 1 : -1)))
    }
  }

  const creator = video.handles[0] || 'TKO'
  const embed =
    `https://www.youtube.com/embed/${video.youtubeId}` +
    `?autoplay=1&mute=1&loop=1&playlist=${video.youtubeId}&controls=0&modestbranding=1&playsinline=1&rel=0`

  return (
    <section
      data-idx={idx}
      className="relative w-full flex items-center justify-center overflow-hidden bg-black"
      style={{ height: '100dvh', scrollSnapAlign: 'start' }}
    >
      {/* 9:16 column centered (letterbox on desktop). */}
      <div className="relative h-full" style={{ aspectRatio: '9 / 16', maxWidth: '100%' }}>
        {active ? (
          <iframe
            title={video.title}
            src={embed}
            className="absolute inset-0 w-full h-full"
            style={{ border: 0 }}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <img src={video.thumbnail} alt={video.title} className="absolute inset-0 w-full h-full object-cover" />
        )}

        {/* Moving TKO watermark. */}
        <div className="absolute top-[15%] right-[6%] z-10 font-bold text-white pointer-events-none select-none"
             style={{ opacity: 0.3, fontSize: 15, textShadow: '0 1px 3px rgba(0,0,0,0.6)' }} aria-hidden="true">
          TKO.cam
        </div>

        {/* Bottom scrim. */}
        <div className="absolute bottom-0 left-0 right-0 h-40 z-10 pointer-events-none"
             style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0))' }} aria-hidden="true" />

        {/* Creator + title. */}
        <div className="absolute bottom-6 left-4 z-20 max-w-[68%]" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.7)' }}>
          <span className="text-white font-bold text-base">@{creator}</span>
          <p className="text-gray-100 text-sm mt-1 leading-snug">{video.title}</p>
          <span className="inline-block mt-1 text-[11px] font-semibold text-accent">{video.angleCount} angles</span>
        </div>

        {/* Rising hearts. */}
        <div className="absolute bottom-28 right-2 z-30 pointer-events-none" style={{ width: 60, height: 200 }}>
          {hearts.map((h) => (
            <span key={h} className="absolute bottom-0 right-3"
                  style={{ animation: 'tkoHeartRise 1100ms ease-out forwards' }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="#ef4444" aria-hidden="true">
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
              </svg>
            </span>
          ))}
        </div>

        {/* Right action rail. */}
        <div className="absolute right-3 bottom-24 z-20 flex flex-col items-center gap-5">
          <Rail label={liked ? 'Unlike' : 'Like'} count={likeCount} onClick={toggleLike}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill={liked ? '#ef4444' : 'none'}
                 stroke={liked ? '#ef4444' : 'currentColor'} strokeWidth="2" aria-hidden="true">
              <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
            </svg>
          </Rail>
          <RailLink to={`/reels/${video.youtubeId}`} label="Comments" count={commentCount}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8 8.38 8.38 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5z" />
            </svg>
          </RailLink>
          <RailLink to={`/reels/${video.youtubeId}`} label="Share">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
            </svg>
          </RailLink>
        </div>
      </div>
    </section>
  )
}

function Rail({ label, count, onClick, children }: {
  label: string; count?: number; onClick: () => void; children: ReactNode
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="flex flex-col items-center gap-1 text-white">
      <span className="flex items-center justify-center w-12 h-12 rounded-full"
            style={{ background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(3px)' }}>{children}</span>
      {count != null && <span className="text-xs font-semibold" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>{count}</span>}
    </button>
  )
}

function RailLink({ to, label, count, children }: {
  to: string; label: string; count?: number; children: ReactNode
}) {
  return (
    <Link to={to} aria-label={label} className="flex flex-col items-center gap-1 text-white">
      <span className="flex items-center justify-center w-12 h-12 rounded-full"
            style={{ background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(3px)' }}>{children}</span>
      {count != null && <span className="text-xs font-semibold" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>{count}</span>}
    </Link>
  )
}

export default ReelScrollFeed
