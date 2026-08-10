import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import {
  GIF_PAGE_SIZE,
  gifProvider,
  searchGifs,
  type GifResult,
} from '@/lib/gifs'

/**
 * GifPicker — the shared GIF search panel. ONE implementation, consumed by
 * every chat composer (StreamChat, TournamentChat, and the ChatComposer that
 * ChatSpace + DirectMessages share).
 *
 * It never renders unless a provider key is configured — callers ask
 * `gifsEnabled()` before showing the button, and this component also returns
 * null defensively so an accidental mount cannot paint an empty panel.
 *
 * Keyboard: type to search, ↑↓←→ to move through the grid, Enter to send the
 * highlighted GIF, Escape to close. The grid is a listbox so a screen reader
 * announces the selection rather than "image, image, image".
 *
 * The grid animates (that is what a GIF picker is FOR) but requests the
 * provider's SMALL animated format, and the chat stream itself does not — a
 * posted GIF renders as a still with a play affordance (see GifMessage.tsx), so
 * a busy channel never becomes a wall of motion.
 */
export function GifPicker({
  onPick,
  onClose,
  className = '',
}: {
  onPick: (gif: GifResult) => void
  onClose: () => void
  className?: string
}) {
  const provider = useMemo(() => gifProvider(), [])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GifResult[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Trending on open, debounced search as you type. `searchGifs` never throws
  // and returns [] on any failure, so there is no error branch to render — an
  // outage looks like "no results", and chat keeps working.
  useEffect(() => {
    if (!provider) return
    let cancelled = false
    setLoading(true)
    const t = window.setTimeout(async () => {
      const hits = await searchGifs(query, { provider })
      if (cancelled) return
      setResults(hits.slice(0, GIF_PAGE_SIZE))
      setActive(0)
      setLoading(false)
    }, query ? 250 : 0)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [query, provider])

  if (!provider) return null

  const COLS = 3
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (!results.length) return
    const move = (next: number) => {
      e.preventDefault()
      setActive(((next % results.length) + results.length) % results.length)
    }
    if (e.key === 'ArrowRight') move(active + 1)
    else if (e.key === 'ArrowLeft') move(active - 1)
    else if (e.key === 'ArrowDown') move(active + COLS)
    else if (e.key === 'ArrowUp') move(active - COLS)
    else if (e.key === 'Enter') { e.preventDefault(); onPick(results[active]) }
  }

  return (
    <div
      onKeyDown={onKeyDown}
      className={`rounded-lg border border-dark-border bg-dark-card shadow-2xl ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-dark-border p-2">
        <Search className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={100}
          placeholder={`Search ${provider.label}…`}
          aria-label={`Search ${provider.label} for a GIF`}
          className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the GIF picker"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-500 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        role="listbox"
        aria-label="GIF results"
        aria-busy={loading}
        className="grid max-h-64 grid-cols-3 gap-1 overflow-y-auto p-1"
      >
        {loading && results.length === 0 ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded bg-dark-border/30" />
          ))
        ) : results.length === 0 ? (
          <p className="col-span-3 py-6 text-center text-xs text-gray-500">
            {query ? `No GIFs for “${query}”.` : 'No GIFs right now.'}
          </p>
        ) : (
          results.map((gif, i) => (
            <button
              key={gif.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(gif)}
              className={`h-20 overflow-hidden rounded border ${
                i === active ? 'border-accent' : 'border-transparent hover:border-dark-border'
              }`}
            >
              <img
                src={gif.url}
                alt={gif.alt}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          ))
        )}
      </div>

      {/* Both networks require visible attribution on the search surface. */}
      <p className="border-t border-dark-border px-2 py-1 text-[10px] uppercase tracking-wide text-gray-600">
        via {provider.label}
      </p>
    </div>
  )
}

export default GifPicker
