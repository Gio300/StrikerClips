import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { isPersistedMessageId } from '@/lib/chatReplies'
import {
  aggregateByMessage,
  applyLocalToggle,
  normalizeReactionEmoji,
  type ReactionRow,
  type ReactionSurface,
  type ReactionTally,
} from '@/lib/chatReactions'

/**
 * useChatReactions — tap-to-react for every chat surface, over the single
 * polymorphic `chat_reactions` table (server/ensureSchema.ts).
 *
 * OPTIMISTIC, THEN RECONCILED. A tap flips the chip immediately via the pure
 * fold in lib/chatReactions.ts, then writes. If the write fails the local state
 * is rolled back to exactly what it was — no ghost counts.
 *
 * DEGRADES ALL THE WAY DOWN, in three steps, because reactions must never be
 * able to break a chat that works today:
 *   • no signed-in viewer  -> chips render read-only; tapping does nothing.
 *   • table unavailable    -> the first load errors, `supported` goes false, and
 *                             every surface hides its reaction UI entirely.
 *   • message not persisted -> an optimistic `local-…` row has no uuid to point
 *                             at, so its reactions stay in local state only
 *                             (this is also how the ephemeral StageChat works).
 */

export interface ChatReactions {
  /** False when the backend can't serve reactions — hide the UI on this. */
  supported: boolean
  /** Chips for one message, ready to render. */
  talliesFor: (messageId: string) => ReactionTally[]
  /** Add/remove the viewer's reaction. Safe to call when signed out (no-op). */
  toggle: (messageId: string, emoji: string) => void
  /** Re-read from the backend (e.g. after new messages land). */
  refresh: () => void
}

const EMPTY: ReactionTally[] = []

export function useChatReactions({
  surface,
  messageIds,
  userId,
  enabled = true,
}: {
  surface: ReactionSurface
  /** Ids currently on screen. Only real row uuids are fetched. */
  messageIds: readonly string[]
  /** Viewer id — null when signed out, which makes the chips read-only. */
  userId?: string | null
  /** Set false for surfaces with no backing table (e.g. StageChat). */
  enabled?: boolean
}): ChatReactions {
  const [rows, setRows] = useState<ReactionRow[]>([])
  const [supported, setSupported] = useState(true)
  const [nonce, setNonce] = useState(0)

  // Keep the newest rows in a ref so `toggle` can roll back precisely without
  // re-creating itself on every state change.
  const rowsRef = useRef<ReactionRow[]>(rows)
  rowsRef.current = rows

  // Stable dependency: the sorted persisted ids. Without this the effect
  // re-runs on every render because `messageIds` is a fresh array each time.
  const persistedKey = useMemo(
    () => [...messageIds].filter(isPersistedMessageId).sort().join(','),
    [messageIds],
  )

  useEffect(() => {
    if (!enabled || !persistedKey) return
    let cancelled = false
    const ids = persistedKey.split(',')

    async function load() {
      const { data, error } = await supabase
        .from('chat_reactions')
        .select('message_id, user_id, emoji')
        .eq('surface', surface)
        .in('message_id', ids)
      if (cancelled) return
      if (error) {
        // The table isn't there (or isn't readable). Stop asking and let every
        // consumer drop its reaction UI — chat itself is unaffected.
        setSupported(false)
        return
      }
      setRows((data ?? []) as ReactionRow[])
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [enabled, nonce, persistedKey, surface])

  const byMessage = useMemo(() => aggregateByMessage(rows, userId ?? null), [rows, userId])

  const talliesFor = useCallback(
    (messageId: string) => byMessage.get(messageId) ?? EMPTY,
    [byMessage],
  )

  const toggle = useCallback(
    (messageId: string, emoji: string) => {
      if (!userId || !messageId) return
      const before = rowsRef.current
      const next = applyLocalToggle(before, messageId, emoji, userId)
      // Refused by the pure layer (bad emoji / per-user cap) — write nothing.
      if (!next.changed) return
      setRows(next.rows)

      // Local-only rows (optimistic ids, StageChat) never reach the database.
      if (!enabled || !supported || !isPersistedMessageId(messageId)) return
      const normalized = normalizeReactionEmoji(emoji)
      if (!normalized) return

      void (async () => {
        const query = next.added
          ? supabase
              .from('chat_reactions')
              .insert({ surface, message_id: messageId, user_id: userId, emoji: normalized })
          : supabase
              .from('chat_reactions')
              .delete()
              .eq('surface', surface)
              .eq('message_id', messageId)
              .eq('user_id', userId)
              .eq('emoji', normalized)
        const { error } = await query
        if (error) setRows(before)
      })()
    },
    [enabled, supported, surface, userId],
  )

  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  return useMemo<ChatReactions>(
    () => ({ supported, talliesFor, toggle, refresh }),
    [refresh, supported, talliesFor, toggle],
  )
}
