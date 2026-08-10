import { useState } from 'react'
import { Play } from 'lucide-react'
import type { GifMessage as GifPayload } from '@/lib/gifs'

/**
 * GifMessageView — how a posted GIF renders IN THE STREAM.
 *
 * Click-to-play, deliberately: a live chat with ten GIFs in it should not be
 * ten things moving at once. The first frame (the provider's still) is shown
 * with a play badge; one click swaps in the animated asset. A GIF cannot be
 * paused once it is decoding, so the still is the only way to keep a busy
 * channel readable — and it is also the bandwidth-honest default on mobile.
 *
 * When the provider gave us no still (rare), there is nothing safe to show as a
 * frozen frame, so the tile stays a neutral placeholder until the reader asks
 * for it. Either way NOTHING animates until a human clicks.
 *
 * `prefers-reduced-motion` is honoured for free by that design: the resting
 * state is static.
 */
export function GifMessageView({
  gif,
  className = '',
}: {
  gif: GifPayload
  className?: string
}) {
  const [playing, setPlaying] = useState(false)

  // Cap the on-screen box so a tall GIF can't blow out a chat row, but keep the
  // aspect ratio when the provider told us the dimensions.
  const ratio = gif.width > 0 && gif.height > 0 ? gif.width / gif.height : 0
  const style = ratio > 0 ? { aspectRatio: String(ratio) } : { minHeight: '96px' }

  if (playing) {
    return (
      <div className={`mt-1 max-w-[220px] overflow-hidden rounded-lg border border-dark-border ${className}`}>
        <img
          src={gif.url}
          alt={gif.alt}
          className="w-full"
          style={style}
        />
        <span className="sr-only">Animated GIF: {gif.alt}</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={`Play GIF: ${gif.alt}`}
      className={`group relative mt-1 block max-w-[220px] overflow-hidden rounded-lg border border-dark-border ${className}`}
      style={style}
    >
      {gif.poster ? (
        <img src={gif.poster} alt={gif.alt} loading="lazy" className="w-full" style={style} />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-dark-elevated/60 px-3 py-6 text-xs text-gray-400">
          {gif.alt}
        </span>
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/10">
        <span className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
          <Play className="h-3 w-3" aria-hidden />
          GIF
        </span>
      </span>
    </button>
  )
}

export default GifMessageView
