import { useEffect, useRef, useState } from 'react'
import { NinjaIcon } from './NinjaIcon'

/**
 * ChipInput — "type once, then tap".
 *
 * A free-text field that REMEMBERS what a user enters. The first time, they type
 * a value (opponent name, team tag, reel title…) and confirm; it's saved to
 * localStorage under `tko:chips:<fieldKey>` and rendered as a tappable CHIP. Next
 * time they just tap the chip instead of retyping. Great for the handful of
 * strings a player reuses constantly.
 *
 *   <ChipInput
 *     fieldKey="opponent"
 *     label="Opponent"
 *     value={opponent}
 *     onChange={setOpponent}
 *     placeholder="Who did you beat?"
 *   />
 *
 * Persistence: chips live in `localStorage['tko:chips:<fieldKey>']` as a JSON
 * string array (most-recent first, capped at `maxChips`). Selecting a chip sets
 * the field value; confirming a new value prepends it. The bare helpers
 * (readChips / addChip / removeChip) are exported for tests or seeding.
 */

const PREFIX = 'tko:chips:'
const DEFAULT_MAX = 12

function keyFor(fieldKey: string): string {
  return `${PREFIX}${fieldKey}`
}

export function readChips(fieldKey: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(keyFor(fieldKey))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function writeChips(fieldKey: string, chips: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(keyFor(fieldKey), JSON.stringify(chips))
  } catch {
    /* quota / private mode — the field still works, just won't remember */
  }
}

/** Prepend a value (deduped, trimmed), capped at `max`. Returns the new list. */
export function addChip(fieldKey: string, value: string, max: number = DEFAULT_MAX): string[] {
  const v = value.trim()
  if (!v) return readChips(fieldKey)
  const existing = readChips(fieldKey).filter((c) => c.toLowerCase() !== v.toLowerCase())
  const next = [v, ...existing].slice(0, max)
  writeChips(fieldKey, next)
  return next
}

export function removeChip(fieldKey: string, value: string): string[] {
  const next = readChips(fieldKey).filter((c) => c.toLowerCase() !== value.toLowerCase())
  writeChips(fieldKey, next)
  return next
}

export type ChipInputProps = {
  /** Stable key — the localStorage bucket the chips persist under. */
  fieldKey: string
  /** Controlled text value. */
  value: string
  /** Called on every keystroke AND when a chip is tapped. */
  onChange: (value: string) => void
  /** Called when a value is CONFIRMED (Enter / Add / chip tap). */
  onCommit?: (value: string) => void
  label?: string
  placeholder?: string
  /** Cap the remembered chips. Default 12. */
  maxChips?: number
  className?: string
  inputClassName?: string
}

export function ChipInput({
  fieldKey,
  value,
  onChange,
  onCommit,
  label,
  placeholder,
  maxChips = DEFAULT_MAX,
  className = '',
  inputClassName = '',
}: ChipInputProps) {
  const [chips, setChips] = useState<string[]>(() => readChips(fieldKey))
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Re-read if the field key changes (e.g. switching contexts).
  useEffect(() => {
    setChips(readChips(fieldKey))
  }, [fieldKey])

  function commit(v: string) {
    const trimmed = v.trim()
    if (!trimmed) return
    setChips(addChip(fieldKey, trimmed, maxChips))
    onChange(trimmed)
    onCommit?.(trimmed)
  }

  function selectChip(chip: string) {
    // Bump it to most-recent and select it.
    setChips(addChip(fieldKey, chip, maxChips))
    onChange(chip)
    onCommit?.(chip)
  }

  function forget(chip: string) {
    setChips(removeChip(fieldKey, chip))
  }

  const selected = value.trim().toLowerCase()

  return (
    <div className={className}>
      {label && <label className="block text-sm text-gray-400 mb-2">{label}</label>}

      {chips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {chips.map((chip) => {
            const isSel = chip.toLowerCase() === selected
            return (
              <span
                key={chip}
                className={`group inline-flex items-center rounded-full border text-sm transition-colors ${
                  isSel
                    ? 'border-chakra bg-chakra/15 text-white'
                    : 'border-dark-border bg-dark-card text-gray-200 hover:border-chakra/50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectChip(chip)}
                  className="pl-3 pr-1.5 py-1.5 font-medium"
                >
                  {chip}
                </button>
                <button
                  type="button"
                  aria-label={`Forget ${chip}`}
                  onClick={() => forget(chip)}
                  className="pr-2 pl-0.5 py-1.5 text-gray-500 hover:text-kunai"
                >
                  <NinjaIcon name="plus" size={13} className="rotate-45" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit(value)
            }
          }}
          placeholder={placeholder}
          className={`flex-1 min-w-0 px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-chakra ${inputClassName}`}
        />
        <button
          type="button"
          onClick={() => commit(value)}
          disabled={!value.trim()}
          className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-chakra/50 text-chakra text-sm font-medium hover:bg-chakra/10 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <NinjaIcon name="plus" size={15} />
          Save
        </button>
      </div>
      {chips.length === 0 && (
        <p className="mt-1 text-xs text-gray-600">Type it once — we'll remember it as a tap-to-fill chip.</p>
      )}
    </div>
  )
}

export default ChipInput
