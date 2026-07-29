import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { ReelComments } from '@/components/ReelComments'
import { ShareButtons } from '@/components/ShareButtons'
import { fetchLikeState, setReelLike, fetchCommentCount } from '@/lib/reelSocial'

/**
 * ImmersivePlayer — a full-bleed, TikTok/Sora-style watch surface for a produced
 * (vertical 1080×1920) reel.
 *
 * The video FILLS the viewport (fixed inset, black letterbox on desktop where a
 * 9:16 column is centered); all controls float ON TOP:
 *   • a right-side action rail (Like / Comment / Save / Share / More)
 *   • floating rising hearts when you like
 *   • a low-opacity TKO watermark that hops corners (~8–12s) so screen-rips are
 *     harder to pass off as original — the Sora anti-rip trick
 *   • the creator handle + title bottom-left
 *
 * Like + Comment are wired to the real `reel_likes` / `reel_comments` Supabase
 * tables (see `@/lib/reelSocial`). Save/Bookmark has no table yet, so it stays
 * optimistic-only (clearly marked TODO).
 */

// ── Inline icons ──────────────────────────────────────────────────────────
// lucide-react isn't a dependency in this app, so we hand-roll the five glyphs
// the rail needs as tiny stroke/fill SVGs. Keeps the bundle + tsc clean.
function HeartIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill={filled ? '#ef4444' : 'none'} stroke={filled ? '#ef4444' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  )
}
function CommentIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8 8.38 8.38 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5z" />
    </svg>
  )
}
function BookmarkIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill={filled ? '#f59e0b' : 'none'} stroke={filled ? '#f59e0b' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}
function ShareIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
      <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
    </svg>
  )
}
function MoreIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  )
}

// Corners the watermark cycles through (Sora-style moving anti-rip mark).
const WATERMARK_CORNERS: React.CSSProperties[] = [
  { top: '14%', left: '6%' },
  { top: '18%', right: '6%' },
  { bottom: '22%', left: '7%' },
  { bottom: '28%', right: '6%' },
]

type Drawer = null | 'comments' | 'share' | 'more'

interface FloatingHeart {
  id: number
  left: number
}

export interface ImmersivePlayerProps {
  reelId: string
  title: string
  creatorName: string
  creatorId: string
  /** The actual video surface (a <video> or a SyncedYouTubeReel). */
  children: ReactNode
  /** Extra rows for the "…" sheet (e.g. an owner-only Upload control). */
  moreMenu?: ReactNode
  /** Optional minimize-to-PiP handler; surfaced in the "…" sheet when provided. */
  onMinimize?: () => void
  /** Where the top-left back chevron goes. Falls back to history-back. */
  backTo?: string
}

export function ImmersivePlayer({
  reelId,
  title,
  creatorName,
  creatorId,
  children,
  moreMenu,
  onMinimize,
  backTo,
}: ImmersivePlayerProps) {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [likeBusy, setLikeBusy] = useState(false)
  const [commentCount, setCommentCount] = useState(0)
  // Save/Bookmark is UI-only for now — see TODO in toggleSave().
  const [saved, setSaved] = useState(false)
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [hearts, setHearts] = useState<FloatingHeart[]>([])
  const [cornerIdx, setCornerIdx] = useState(0)
  const heartSeq = useRef(0)

  // Initial social state (real tables).
  useEffect(() => {
    let alive = true
    fetchLikeState(reelId, user?.id).then((s) => {
      if (!alive) return
      setLiked(s.liked)
      setLikeCount(s.count)
    })
    fetchCommentCount(reelId).then((n) => {
      if (alive) setCommentCount(n)
    })
    return () => {
      alive = false
    }
  }, [reelId, user?.id])

  // Watermark corner hop every 8–12s.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    function schedule() {
      const delay = 8000 + Math.random() * 4000
      timer = setTimeout(() => {
        setCornerIdx((i) => (i + 1) % WATERMARK_CORNERS.length)
        schedule()
      }, delay)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])

  function spawnHeart() {
    const id = ++heartSeq.current
    const left = 30 + Math.random() * 24 // % across the rail column
    setHearts((hs) => [...hs, { id, left }])
    setTimeout(() => setHearts((hs) => hs.filter((h) => h.id !== id)), 1200)
  }

  async function toggleLike() {
    if (!user) {
      navigate('/login')
      return
    }
    if (likeBusy) return
    const next = !liked
    // Optimistic update + rising heart on a like.
    setLiked(next)
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)))
    if (next) spawnHeart()
    setLikeBusy(true)
    const persisted = await setReelLike(reelId, user.id, next)
    if (persisted !== next) {
      // Write failed — roll the optimistic change back.
      setLiked(persisted)
      setLikeCount((c) => Math.max(0, c + (persisted ? 1 : -1)))
    }
    setLikeBusy(false)
  }

  function toggleSave() {
    // TODO(reel_bookmarks): there is no bookmarks table yet, so Save is purely
    // visual/optimistic. When a `reel_bookmarks` (reel_id, user_id) table lands,
    // wire this the same way as likes via lib/reelSocial.
    setSaved((s) => !s)
  }

  function closeDrawer() {
    setDrawer(null)
  }

  return (
    <div className="fixed inset-0 bg-black" style={{ zIndex: 80 }} role="dialog" aria-label={`Watching ${title}`}>
      {/* Animations live here — core Tailwind has no keyframe utilities. */}
      <style>{`
        @keyframes tkoHeartRise {
          0%   { opacity: 0; transform: translateY(0) scale(0.5) rotate(-8deg); }
          12%  { opacity: 1; }
          100% { opacity: 0; transform: translateY(-190px) scale(1.15) rotate(8deg); }
        }
        @keyframes tkoDrawerUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes tkoPop {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.35); }
          100% { transform: scale(1); }
        }
      `}</style>

      {/* 9:16 column, centered with black letterbox on wide screens. All floating
          UI is anchored to THIS column so the rail hugs the video, not the screen. */}
      <div className="relative h-full w-full mx-auto" style={{ maxWidth: 'calc(100vh * 9 / 16)' }}>
        {/* Video surface — fills the column. */}
        <div className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden bg-black">
          {children}
        </div>

        {/* Moving TKO watermark (anti-rip). */}
        <div
          className="absolute z-10 select-none pointer-events-none font-bold tracking-wide text-white"
          style={{
            ...WATERMARK_CORNERS[cornerIdx],
            opacity: 0.3,
            fontSize: '15px',
            textShadow: '0 1px 3px rgba(0,0,0,0.6)',
            transition: 'top 600ms ease, left 600ms ease, right 600ms ease, bottom 600ms ease',
          }}
          aria-hidden="true"
        >
          TKO.cam
        </div>

        {/* Top gradient + back button. */}
        <div
          className="absolute top-0 left-0 right-0 z-30 h-24 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0))' }}
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={() => (backTo ? navigate(backTo) : navigate(-1))}
          aria-label="Back"
          className="absolute top-4 left-3 z-40 flex items-center justify-center w-10 h-10 rounded-full text-white"
          style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {/* Bottom gradient scrim so text/rail stay legible over bright video. */}
        <div
          className="absolute bottom-0 left-0 right-0 z-10 h-48 pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0))' }}
          aria-hidden="true"
        />

        {/* Creator handle + title, bottom-left. */}
        <div className="absolute bottom-6 left-4 z-20 max-w-[70%]" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.7)' }}>
          <Link to={`/profile/${creatorId}`} className="text-white font-bold text-base hover:underline">
            @{creatorName}
          </Link>
          <p className="text-gray-100 text-sm mt-1 leading-snug">{title}</p>
        </div>

        {/* Rising hearts — anchored near the rail. Pointer-events off. */}
        <div className="absolute bottom-28 right-0 z-30 pointer-events-none" style={{ width: 120, height: 220 }}>
          {hearts.map((h) => (
            <span
              key={h.id}
              className="absolute bottom-0"
              style={{ left: `${h.left}%`, animation: 'tkoHeartRise 1100ms ease-out forwards' }}
            >
              <svg width="34" height="34" viewBox="0 0 24 24" fill="#ef4444" aria-hidden="true">
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
              </svg>
            </span>
          ))}
        </div>

        {/* Right action rail. */}
        <div className="absolute right-3 bottom-24 z-20 flex flex-col items-center gap-5">
          <RailButton
            label={liked ? 'Unlike' : 'Like'}
            count={likeCount}
            onClick={toggleLike}
            active={liked}
          >
            <span style={liked ? { animation: 'tkoPop 320ms ease-out' } : undefined} key={liked ? 'on' : 'off'}>
              <HeartIcon filled={liked} />
            </span>
          </RailButton>

          <RailButton label="Comments" count={commentCount} onClick={() => setDrawer('comments')}>
            <CommentIcon />
          </RailButton>

          <RailButton label={saved ? 'Saved' : 'Save'} onClick={toggleSave} active={saved}>
            <BookmarkIcon filled={saved} />
          </RailButton>

          <RailButton label="Share" onClick={() => setDrawer('share')}>
            <ShareIcon />
          </RailButton>

          <RailButton label="More options" onClick={() => setDrawer('more')}>
            <MoreIcon />
          </RailButton>
        </div>

        {/* ── Bottom-sheet drawers ─────────────────────────────────────────── */}
        {drawer !== null && (
          <button
            type="button"
            aria-label="Close"
            onClick={closeDrawer}
            className="absolute inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.45)' }}
          />
        )}

        {drawer === 'comments' && (
          <Sheet title="Comments" onClose={closeDrawer}>
            <ReelComments reelId={reelId} embedded onCountChange={setCommentCount} />
          </Sheet>
        )}

        {drawer === 'share' && (
          <Sheet title="Share" onClose={closeDrawer}>
            <ShareButtons title={title} />
          </Sheet>
        )}

        {drawer === 'more' && (
          <Sheet title="More" onClose={closeDrawer}>
            <div className="space-y-2">
              {onMinimize && (
                <button
                  type="button"
                  onClick={() => {
                    closeDrawer()
                    onMinimize()
                  }}
                  className="w-full text-left px-4 py-3 rounded-lg border border-dark-border text-gray-200 hover:border-accent/50 hover:text-accent"
                >
                  Minimize to a floating player
                </button>
              )}
              {moreMenu}
              <Link
                to={`/reels/${reelId}`}
                onClick={closeDrawer}
                className="block px-4 py-3 rounded-lg border border-dark-border text-gray-200 hover:border-accent/50 hover:text-accent"
              >
                Reel details &amp; contributors
              </Link>
            </div>
          </Sheet>
        )}
      </div>
    </div>
  )
}

/** One vertically-stacked rail item: a circular icon button + a count/label. */
function RailButton({
  label,
  count,
  onClick,
  active,
  children,
}: {
  label: string
  count?: number
  onClick: () => void
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className="flex flex-col items-center gap-1 text-white"
    >
      <span
        className="flex items-center justify-center w-12 h-12 rounded-full"
        style={{ background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(3px)' }}
      >
        {children}
      </span>
      {count != null && <span className="text-xs font-semibold" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>{formatCount(count)}</span>}
    </button>
  )
}

/** A rounded bottom sheet that animates up from the base of the video column. */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-dark-border bg-dark-card"
      style={{ maxHeight: '72%', animation: 'tkoDrawerUp 260ms ease-out', display: 'flex', flexDirection: 'column' }}
      role="dialog"
      aria-label={title}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-border shrink-0">
        <span className="mx-auto absolute left-0 right-0 top-2 h-1 w-10 rounded-full bg-dark-border" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-white mt-1">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-gray-400 hover:text-white"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="overflow-y-auto p-4">{children}</div>
    </div>
  )
}

/** 1234 -> "1.2K" style compaction for the rail counts. */
function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export default ImmersivePlayer
