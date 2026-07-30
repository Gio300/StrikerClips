import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadLiveLinkContext, type LiveCard, type LiveLinkContext } from '@/lib/liveLinkService'
import { bestCandidateForStream, linkBadge, type LiveLinkCandidate } from '@/lib/liveLink'

/**
 * useLiveLinks — everyone who is live right now, plus the link engine's verdict
 * on who belongs with whom.
 *
 * One shared loader for every live surface (the hub board, the home launcher
 * strip, the combined-view page) so the badges are consistent wherever they
 * appear. Polls gently so a stream that just went live shows up without a
 * refresh; pass `pollMs = 0` to disable.
 */
export interface UseLiveLinks extends LiveLinkContext {
  loading: boolean
  reload: () => void
  /** The strongest link for a stream, or null. */
  bestFor: (streamId: string) => LiveLinkCandidate | null
  /** Card badge copy, e.g. "⚔ Scheduled battle vs @rex" — null when there's no link. */
  badgeFor: (streamId: string) => string | null
}

const EMPTY: LiveLinkContext = { cards: [], facts: {}, candidates: [], stages: [], pending: [] }

export function useLiveLinks(pollMs = 60_000): UseLiveLinks {
  const [ctx, setCtx] = useState<LiveLinkContext>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const next = await loadLiveLinkContext()
        if (!cancelled) setCtx(next)
      } catch {
        if (!cancelled) setCtx(EMPTY)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [tick])

  useEffect(() => {
    if (!pollMs) return
    const t = window.setInterval(() => setTick((n) => n + 1), pollMs)
    return () => window.clearInterval(t)
  }, [pollMs])

  const bestFor = useCallback(
    (streamId: string) => bestCandidateForStream(ctx.candidates, streamId),
    [ctx.candidates],
  )

  const badgeFor = useCallback(
    (streamId: string) => {
      const best = bestCandidateForStream(ctx.candidates, streamId)
      // "Also live now" adds nothing on a page that is already a list of live
      // streams — only surface a badge when there's a real relationship.
      if (!best || best.reason === 'concurrent_only') return null
      return linkBadge(best, streamId)
    },
    [ctx.candidates],
  )

  return useMemo(
    () => ({ ...ctx, loading, reload, bestFor, badgeFor }),
    [ctx, loading, reload, bestFor, badgeFor],
  )
}

export type { LiveCard }
