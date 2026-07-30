import type { AvailabilityState } from '@/hooks/useIdentityAvailability'

/**
 * AvailabilityHint — the inline "✓ available" / "✗ that name's taken" line that
 * sits under every name field, plus tappable suggestion chips.
 *
 * Pairs with `useIdentityAvailability`. The suggestions are BUTTONS, not just
 * text: a blocked user is one tap from a name that works.
 */
export interface AvailabilityHintProps {
  state: AvailabilityState
  /** Called when the user taps a suggested alternative. */
  onPick?: (suggestion: string) => void
  /** Persistent rule copy shown while idle (e.g. the tag format). */
  hint?: string
}

const TONE: Record<AvailabilityState['status'], string> = {
  idle: 'text-gray-500',
  invalid: 'text-red-400',
  checking: 'text-gray-500',
  available: 'text-leaf',
  taken: 'text-red-400',
  unknown: 'text-gray-500',
}

export function AvailabilityHint({ state, onPick, hint }: AvailabilityHintProps) {
  const showHint = hint && (state.status === 'idle' || state.status === 'unknown')
  if (!state.message && !showHint) return null

  return (
    <div className="mt-1 space-y-1">
      {state.message && (
        <p className={`text-xs ${TONE[state.status]}`} role="status" aria-live="polite">
          {state.message}
        </p>
      )}
      {showHint && <p className="text-xs text-gray-500">{hint}</p>}
      {state.status === 'taken' && state.suggestions.length > 0 && onPick && (
        <div className="flex flex-wrap gap-1.5">
          {state.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="text-xs px-2 py-1 rounded-md border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              Use {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default AvailabilityHint
