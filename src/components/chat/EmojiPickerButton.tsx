import { useEffect, useMemo, useRef, useState } from 'react'
import { Smile } from 'lucide-react'
import { EMOJI_GROUPS, searchEmoji, type EmojiEntry } from '@/lib/chatEmoji'

/**
 * EmojiPickerButton — the composer's emoji picker, shared by every chat surface.
 *
 * Deliberately dependency-free: the table lives in src/lib/chatEmoji.ts, so this
 * is a popover over plain data with a search box. It renders the character
 * itself (not an image sprite), so there is nothing to load and nothing to fail
 * — the picker works with no network, no key and no config, which is the repo's
 * degrade-gracefully rule applied to a feature that has no config to miss.
 */

export function EmojiPickerButton({
  onPick,
  title = 'Emoji',
  className = '',
  align = 'right',
}: {
  onPick: (char: string) => void
  title?: string
  className?: string
  /** Which edge of the button the panel hangs from. */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on an outside click or Escape — the same affordances the rest of the
  // app's popovers use.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const results = useMemo<EmojiEntry[] | null>(
    () => (query.trim() ? searchEmoji(query) : null),
    [query],
  )

  function pick(entry: EmojiEntry) {
    onPick(entry.char)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={title}
        aria-expanded={open}
        title={title}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${
          open ? 'border-accent bg-accent/10 text-accent' : 'border-dark-border text-gray-400 hover:text-white'
        }`}
      >
        <Smile className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div
          className={`absolute bottom-full z-30 mb-2 w-72 rounded-lg border border-dark-border bg-dark-card shadow-2xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="border-b border-dark-border p-2">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search emoji"
              maxLength={32}
              className="w-full rounded-lg border border-dark-border bg-dark px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-accent focus:outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-2">
            {results ? (
              results.length === 0 ? (
                <p className="py-6 text-center text-xs text-gray-500">No emoji match that.</p>
              ) : (
                <EmojiGrid emoji={results} onPick={pick} />
              )
            ) : (
              EMOJI_GROUPS.map((group) => (
                <div key={group.name} className="mb-2 last:mb-0">
                  <p className="mb-1 px-1 text-[10px] uppercase tracking-wider text-gray-500">
                    {group.name}
                  </p>
                  <EmojiGrid emoji={group.emoji} onPick={pick} />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function EmojiGrid({
  emoji,
  onPick,
}: {
  emoji: readonly EmojiEntry[]
  onPick: (entry: EmojiEntry) => void
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emoji.map((entry) => (
        <button
          key={entry.shortcode}
          type="button"
          // onMouseDown, not onClick: the composer input must not lose focus
          // before we insert, or the caret position is gone.
          onMouseDown={(event) => {
            event.preventDefault()
            onPick(entry)
          }}
          title={`:${entry.shortcode}:`}
          aria-label={entry.shortcode}
          className="flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-dark-border/60"
        >
          {entry.char}
        </button>
      ))}
    </div>
  )
}

export default EmojiPickerButton
