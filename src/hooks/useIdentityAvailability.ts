import { useEffect, useRef, useState } from 'react'
import { checkReason, takenMessage } from '@/lib/identity'
import {
  canonicalValue,
  checkAvailability,
  identityLabel,
  validateIdentity,
  type IdentityKind,
} from '@/lib/identityAvailability'

/**
 * useIdentityAvailability — one hook behind every "claim a name" field.
 *
 * Validates the format locally (instant, no network), then debounces a
 * case-insensitive availability read against the backend. Exposes a single
 * `blocked` flag so the four call sites (Signup username, Profile username,
 * CreateServer clan name + tag, ClanSettingsPanel clan name + tag) all disable
 * submit on exactly the same conditions — and `suggestions`, so a taken name is
 * a fork in the road rather than a wall.
 *
 * Empty + `required: false` is a valid, non-blocking state (an optional clan
 * tag), which is why "idle" is distinct from "invalid".
 */

export type AvailabilityStatus =
  | 'idle' // nothing typed yet (or optional + empty)
  | 'invalid' // fails the format rules — no point asking the server
  | 'checking' // debounced query in flight
  | 'available'
  | 'taken'
  | 'unknown' // backend read failed; don't block on our own outage

export interface AvailabilityState {
  status: AvailabilityStatus
  /** Inline copy to render under the field ('' when idle). */
  message: string
  /** Free alternatives, only populated when `status === 'taken'`. */
  suggestions: string[]
  /** True when submit should be disabled because of this field. */
  blocked: boolean
  /** The value that should actually be written (trimmed / uppercased tag). */
  value: string
}

const DEBOUNCE_MS = 350

export function useIdentityAvailability(
  kind: IdentityKind,
  raw: string,
  opts: { excludeId?: string; required?: boolean } = {},
): AvailabilityState {
  const required = opts.required ?? true
  const { excludeId } = opts

  const [status, setStatus] = useState<AvailabilityStatus>('idle')
  const [message, setMessage] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])

  // Guards against a slow earlier request overwriting a newer verdict.
  const seq = useRef(0)

  const trimmed = (raw ?? '').trim()
  const value = trimmed ? canonicalValue(kind, trimmed) : ''

  useEffect(() => {
    const run = ++seq.current

    if (trimmed === '') {
      setStatus(required ? 'invalid' : 'idle')
      setMessage('')
      setSuggestions([])
      return
    }

    const invalid = checkReason(validateIdentity(kind, trimmed))
    if (invalid) {
      setStatus('invalid')
      setMessage(invalid)
      setSuggestions([])
      return
    }

    setStatus('checking')
    setMessage('Checking availability…')
    setSuggestions([])

    const t = setTimeout(() => {
      void checkAvailability(kind, trimmed, { excludeId }).then((res) => {
        if (seq.current !== run) return
        if (res.errored) {
          setStatus('unknown')
          setMessage('')
          setSuggestions([])
          return
        }
        if (res.available) {
          setStatus('available')
          setMessage('✓ available')
          setSuggestions([])
          return
        }
        setStatus('taken')
        setMessage(`✗ ${takenMessage(identityLabel(kind), res.suggestions)}`)
        setSuggestions(res.suggestions)
      })
    }, DEBOUNCE_MS)

    return () => clearTimeout(t)
  }, [kind, trimmed, excludeId, required])

  // 'unknown' does NOT block — a backend hiccup shouldn't stop a legitimate
  // claim. The DB's unique index still rejects a genuine collision on write.
  const blocked = status === 'invalid' || status === 'taken' || status === 'checking'

  return { status, message, suggestions, blocked, value }
}
