import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react'
import { thumbUrl } from '@/lib/youtubeConnect'
import { canonicalCurrentUrl, canonicalShareUrl } from '@/lib/canonicalUrl'

/**
 * YouTubeEmbed — play a YouTube video INSIDE the app instead of only linking out.
 *
 * Performance-first: we render a lightweight click-to-load thumbnail (a public
 * i.ytimg.com image, no API key) with a play button; the real iframe only mounts
 * after the user taps it. That keeps feeds cheap (no dozens of iframes booting on
 * mount) while still letting a produced video / live play in place. We use the
 * privacy-friendly youtube-nocookie host and `autoplay=1` — allowed because the
 * click that mounts the iframe is the required user gesture.
 *
 * HOVER PREVIEW (`preview`, on by default): on hover/focus we mount a MUTED,
 * controls-less, looping iframe after a short delay so the card shows a moving
 * preview of the clip — just like YouTube's thumbnail hover. Leaving reverts to
 * the still. Muted autoplay needs no gesture, so this is allowed. It self-
 * disables under prefers-reduced-motion and on touch/coarse pointers (where
 * there's no hover), so mobile just taps straight to the full player.
 *
 * `overlay` is decorative chrome (badges) shown ON the thumbnail only; it's
 * pointer-events-none and disappears once the player is live so it never covers
 * the video controls.
 */
export function YouTubeEmbed({
  videoId,
  title,
  className,
  overlay,
  preview = false,
  shareRoute,
}: {
  videoId: string
  title?: string
  className?: string
  overlay?: ReactNode
  /** Enable the muted, looping hover preview (feed cards pass this). */
  preview?: boolean
  /**
   * App route this video has a page of its own at (e.g. `/produced/<id>`).
   * Share sends THIS instead of whatever page the embed happens to sit on —
   * a card in a feed or on a profile would otherwise share the feed/profile,
   * and the recipient would never find the video that was shared.
   */
  shareRoute?: string
}) {
  const [active, setActive] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [shared, setShared] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = (videoId ?? '').trim()

  // Floating Share — visible while the video plays in-app. Uses the native share
  // sheet on mobile, falls back to copying the link. Shares THIS VIDEO's own
  // page when it has one (`shareRoute`), otherwise the current watch page — so
  // the recipient lands on TKO, not raw YouTube, and on the right thing.
  async function shareVideo(e: MouseEvent) {
    e.stopPropagation()
    // Canonicalized: the raw location.href is `https://localhost/...` inside
    // the installed app — a dead link for the recipient.
    const url =
      typeof window !== 'undefined'
        ? shareRoute
          ? canonicalShareUrl(shareRoute)
          : canonicalCurrentUrl()
        : `https://youtu.be/${id}`
    const data = { title: title || 'TKO.cam', url }
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share(data)
        return
      }
    } catch { /* user cancelled or unsupported — fall through to copy */ }
    try {
      await navigator.clipboard.writeText(url)
      setShared(true)
      setTimeout(() => setShared(false), 1800)
    } catch { /* clipboard blocked — nothing else to do */ }
  }

  // Only preview where hover is real and motion is welcome.
  const canPreview =
    preview &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  if (!id) return null

  function startPreview() {
    if (!canPreview || active) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setPreviewing(true), 450)
  }
  function stopPreview() {
    if (timer.current) clearTimeout(timer.current)
    setPreviewing(false)
  }

  return (
    <div
      className={`aspect-video bg-dark relative overflow-hidden ${className ?? ''}`}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
    >
      {active ? (
        <>
          <iframe
            className="absolute inset-0 w-full h-full"
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(
              id,
            )}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
            title={title || 'YouTube video'}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
          {/* Floating Share — sits over the top-right of the playing video. */}
          <button
            type="button"
            onClick={shareVideo}
            aria-label="Share this video"
            className="absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-full bg-dark/70 hover:bg-accent hover:text-dark text-white px-3 py-1.5 text-xs font-semibold backdrop-blur transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
              <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />
            </svg>
            {shared ? 'Copied!' : 'Share'}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setActive(true)}
          onFocus={startPreview}
          onBlur={stopPreview}
          className="group absolute inset-0 w-full h-full"
          aria-label={title ? `Play ${title}` : 'Play video'}
        >
          <img
            src={thumbUrl(id)}
            alt=""
            loading="lazy"
            className={`w-full h-full object-cover transition-transform group-hover:scale-105 ${
              previewing ? 'opacity-0' : 'opacity-100'
            }`}
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.opacity = '0.2'
            }}
          />
          {/* Muted, looping hover preview — mounts only while hovering. */}
          {previewing && (
            <iframe
              className="absolute inset-0 w-full h-full pointer-events-none"
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(
                id,
              )}?autoplay=1&mute=1&controls=0&loop=1&playlist=${encodeURIComponent(
                id,
              )}&modestbranding=1&playsinline=1&rel=0&disablekb=1&fs=0`}
              title={title ? `Preview of ${title}` : 'Video preview'}
              loading="lazy"
              allow="autoplay; encrypted-media"
              tabIndex={-1}
              aria-hidden="true"
            />
          )}
          {/* Play glyph — dimmed while previewing so the motion reads clearly. */}
          <span className={`absolute inset-0 flex items-center justify-center transition-opacity ${previewing ? 'opacity-60' : 'opacity-100'}`}>
            <span className="flex items-center justify-center w-14 h-14 rounded-full bg-dark/70 group-hover:bg-accent transition-colors">
              <svg viewBox="0 0 24 24" className="w-6 h-6 ml-0.5 fill-white group-hover:fill-dark" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
          {overlay != null && <span className="pointer-events-none">{overlay}</span>}
        </button>
      )}
    </div>
  )
}

export default YouTubeEmbed
