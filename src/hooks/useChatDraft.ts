import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { activeMentionAt } from '@/lib/streamChatMarkup'
import { searchPeople, type PersonHit } from '@/lib/liveAngles'
import {
  insertMention,
  sanitizeMentions,
  serializeMentions,
  type ChatMention,
} from '@/lib/chatMentions'

/**
 * useChatDraft — the ONE composer brain every chat surface consumes.
 *
 * Four surfaces share this chat (live, stage/merged, tournament, channel + DM);
 * before this hook the @mention autocomplete existed only in StreamChat, as
 * ~60 lines of state + keyboard handling inlined in the component. Copying that
 * into three more files is how the four surfaces drift. Everything a composer
 * needs is here:
 *
 *   • the draft TEXT and its STRUCTURAL MENTIONS, kept in lockstep — every edit
 *     re-validates the mention offsets (src/lib/chatMentions.ts), so a mention
 *     the user typed over simply falls away instead of pointing at the wrong
 *     words. `mentionsColumn()` is what you write to the `mentions` jsonb column.
 *   • the @-autocomplete: debounced people search, keyboard nav, and insertion
 *     that re-anchors the surrounding mentions.
 *   • emoji insertion at the caret.
 *
 * DEGRADES TO A PLAIN TEXT BOX. searchPeople already swallows its own errors and
 * returns []; with no results the menu never opens and the composer is an
 * ordinary input. Signed out, the search is skipped entirely.
 */

/** How long the composer waits before searching for an @mention candidate. */
const MENTION_SEARCH_DEBOUNCE_MS = 150

/** Max rows in the autocomplete menu. */
const MENTION_MENU_SIZE = 6

export type ChatDraftInput = HTMLInputElement | HTMLTextAreaElement

export interface ChatDraft {
  /** Current draft text. */
  text: string
  /** Validated mentions anchored into `text`. */
  mentions: ChatMention[]
  /** Attach to the composer's input/textarea. */
  inputRef: React.MutableRefObject<ChatDraftInput | null>
  /** onChange handler — pass the element so the caret can be read. */
  onChange: (event: React.ChangeEvent<ChatDraftInput>) => void
  /** onClick/onSelect handler — keeps the @-menu in sync when the caret moves. */
  onCaretMove: (event: { currentTarget: ChatDraftInput }) => void
  /** onKeyDown handler. Returns nothing; consumes keys only while the menu is open. */
  onKeyDown: (event: React.KeyboardEvent<ChatDraftInput>) => void
  /** onBlur handler — closes the menu after a beat so a click can land first. */
  onBlur: () => void
  /** True when the mention menu should render. */
  menuOpen: boolean
  /** Candidates for the menu. */
  hits: PersonHit[]
  /** Index of the highlighted candidate. */
  activeIndex: number
  setActiveIndex: (index: number) => void
  /** Choose a candidate (mouse or keyboard). */
  pick: (person: PersonHit) => void
  /** Insert an emoji character at the caret. */
  insertEmoji: (char: string) => void
  /** Replace the whole draft (e.g. restoring a failed send). */
  setDraft: (text: string, mentions?: readonly ChatMention[]) => void
  /** Clear text + mentions and close the menu. */
  reset: () => void
  /** The value for the `mentions` jsonb column, validated against `text`. */
  mentionsColumn: () => Array<{ user_id: string; username: string; start: number; end: number }>
}

export function useChatDraft({
  userId,
  onTyping,
}: {
  /** Viewer id — excluded from mention results; null disables the search. */
  userId?: string | null
  /** Optional: called on every edit, for the typing indicator. */
  onTyping?: () => void
} = {}): ChatDraft {
  const [text, setText] = useState('')
  const [mentions, setMentions] = useState<ChatMention[]>([])
  const [fragment, setFragment] = useState<{ query: string; start: number } | null>(null)
  const [hits, setHits] = useState<PersonHit[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<ChatDraftInput | null>(null)

  // Debounced people search for the fragment under the caret. searchPeople
  // returns [] on any failure, so a broken backend closes the menu rather than
  // breaking the composer.
  useEffect(() => {
    const query = fragment?.query ?? ''
    if (!query || !userId) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const people = await searchPeople(query, userId)
      if (cancelled) return
      setHits(people.slice(0, MENTION_MENU_SIZE))
      setActiveIndex(0)
    }, MENTION_SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [fragment?.query, userId])

  const menuOpen = Boolean(fragment) && hits.length > 0

  const syncFragment = useCallback((value: string, caret: number) => {
    setFragment(activeMentionAt(value, caret))
  }, [])

  const onChange = useCallback(
    (event: React.ChangeEvent<ChatDraftInput>) => {
      const value = event.target.value
      const caret = event.target.selectionStart ?? value.length
      setText(value)
      // Re-validate on EVERY edit: an offset that no longer reads "@name" is
      // dropped here rather than surviving to become a wrong chip at render.
      setMentions((current) => sanitizeMentions(value, current))
      syncFragment(value, caret)
      onTyping?.()
    },
    [onTyping, syncFragment],
  )

  const onCaretMove = useCallback(
    (event: { currentTarget: ChatDraftInput }) => {
      const element = event.currentTarget
      syncFragment(element.value, element.selectionStart ?? element.value.length)
    },
    [syncFragment],
  )

  /** Move the caret after React has committed the new value. */
  const focusCaret = useCallback((position: number) => {
    window.requestAnimationFrame(() => {
      const element = inputRef.current
      if (!element) return
      element.focus()
      element.setSelectionRange(position, position)
    })
  }, [])

  const pick = useCallback(
    (person: PersonHit | undefined) => {
      if (!person || !fragment) return
      const caret = inputRef.current?.selectionStart ?? text.length
      const next = insertMention({ text, mentions }, fragment.start, caret, {
        id: person.id,
        username: person.username,
      })
      setText(next.text)
      setMentions(next.mentions)
      setFragment(null)
      setHits([])
      focusCaret(next.caret)
    },
    [focusCaret, fragment, mentions, text],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<ChatDraftInput>) => {
      if (!menuOpen) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((index) => (index + 1) % hits.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((index) => (index - 1 + hits.length) % hits.length)
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        pick(hits[activeIndex])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setFragment(null)
      }
    },
    [activeIndex, hits, menuOpen, pick],
  )

  const onBlur = useCallback(() => {
    // Delay so a mousedown on a menu row still resolves.
    window.setTimeout(() => setFragment(null), 120)
  }, [])

  const insertEmoji = useCallback(
    (char: string) => {
      if (!char) return
      const element = inputRef.current
      const start = element?.selectionStart ?? text.length
      const end = element?.selectionEnd ?? start
      const next = `${text.slice(0, start)}${char}${text.slice(end)}`
      const delta = char.length - (end - start)
      setText(next)
      setMentions((current) =>
        sanitizeMentions(
          next,
          current.map((m) => (m.start >= end ? { ...m, start: m.start + delta, end: m.end + delta } : m)),
        ),
      )
      focusCaret(start + char.length)
      onTyping?.()
    },
    [focusCaret, onTyping, text],
  )

  const setDraft = useCallback((value: string, nextMentions: readonly ChatMention[] = []) => {
    setText(value)
    setMentions(sanitizeMentions(value, nextMentions))
  }, [])

  const reset = useCallback(() => {
    setText('')
    setMentions([])
    setFragment(null)
    setHits([])
  }, [])

  const mentionsColumn = useCallback(() => serializeMentions(text, mentions), [mentions, text])

  return useMemo<ChatDraft>(
    () => ({
      text,
      mentions,
      inputRef,
      onChange,
      onCaretMove,
      onKeyDown,
      onBlur,
      menuOpen,
      hits,
      activeIndex,
      setActiveIndex,
      pick,
      insertEmoji,
      setDraft,
      reset,
      mentionsColumn,
    }),
    [
      activeIndex,
      hits,
      insertEmoji,
      menuOpen,
      mentions,
      mentionsColumn,
      onBlur,
      onCaretMove,
      onChange,
      onKeyDown,
      pick,
      reset,
      setDraft,
      text,
    ],
  )
}
