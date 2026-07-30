import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { topBadge, type BadgeMeta } from '@/lib/badges'
import { BadgeChip } from '@/components/BadgeChip'
import { effectiveDisplayName } from '@/lib/founder'
import { Avatar } from '@/components/ui'

/**
 * ReelComments — a comment thread pinned under a reel/video.
 *
 * Read access is open to everyone (guests can watch the video and READ the
 * comments), but the composer is gated: logged-out visitors see a
 * "Sign in to comment" prompt (linking to /login) instead of an input box.
 *
 * Storage mirrors the chat pattern: a `reel_comments` table keyed by
 * `reel_id` (id, reel_id, user_id, content, created_at) with optimistic
 * append + id-dedupe, so it maps cleanly onto a real Supabase table + RLS.
 */

interface ReelComment {
  id: string
  reel_id: string
  user_id: string | null
  content: string
  created_at: string
}

// `meta` carries the commenter's badge metadata when available (the signed-in
// user's own optimistic comments); others degrade to no badge.
type EnrichedComment = ReelComment & {
  username?: string
  avatarUrl?: string | null
  meta?: BadgeMeta
}

export function ReelComments({
  reelId,
  embedded = false,
  onCountChange,
}: {
  reelId: string
  /** When true, drop the outer card + "Comments" heading (a CollapsibleSection
   *  supplies them instead). Keeps the composer + list only. */
  embedded?: boolean
  /** Reports the live comment count so a parent can show it in a section header. */
  onCountChange?: (n: number) => void
}) {
  const { user, profile } = useAuth()
  const [comments, setComments] = useState<EnrichedComment[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function init() {
      const { data, error: err } = await supabase
        .from('reel_comments')
        .select('id, reel_id, user_id, content, created_at')
        .eq('reel_id', reelId)
        .order('created_at', { ascending: true })
        .limit(200)
      if (cancelledRef.current) return
      if (err) {
        setError(err.message)
        return
      }
      const rows = (data ?? []) as ReelComment[]
      const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean) as string[]))
      let nameMap = new Map<string, { username: string; avatar_url: string | null }>()
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .in('id', userIds)
        nameMap = new Map(
          (profiles ?? []).map((p) => [p.id, { username: p.username, avatar_url: p.avatar_url ?? null }]),
        )
      }
      if (cancelledRef.current) return
      setComments(
        rows.map((r) => ({
          ...r,
          username: r.user_id ? nameMap.get(r.user_id)?.username : undefined,
          avatarUrl: r.user_id ? nameMap.get(r.user_id)?.avatar_url ?? null : null,
        })),
      )

      channel = supabase
        .channel(`reel-comments:${reelId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'reel_comments', filter: `reel_id=eq.${reelId}` },
          async (payload) => {
            const row = payload.new as ReelComment
            let username: string | undefined
            let avatarUrl: string | null = null
            if (row.user_id) {
              const { data: prof } = await supabase
                .from('profiles')
                .select('username, avatar_url')
                .eq('id', row.user_id)
                .maybeSingle()
              username = prof?.username
              avatarUrl = prof?.avatar_url ?? null
            }
            setComments((prev) =>
              prev.some((c) => c.id === row.id) ? prev : [...prev, { ...row, username, avatarUrl }],
            )
          },
        )
        .subscribe()
    }

    init()
    return () => {
      cancelledRef.current = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [reelId])

  // Surface the live count so an enclosing CollapsibleSection can badge it.
  useEffect(() => {
    onCountChange?.(comments.length)
  }, [comments.length, onCountChange])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Hard gate: a logged-out visitor can never post. The UI hides the input
    // too, but we guard here so nothing slips through.
    if (!user || !draft.trim() || sending) return
    setSending(true)
    setError(null)
    const content = draft.trim().slice(0, 1000)
    const { data: inserted, error: err } = await supabase
      .from('reel_comments')
      .insert({ reel_id: reelId, user_id: user.id, content })
      .select()
      .single()
    setSending(false)
    if (err) {
      setError(err.message)
      return
    }
    setDraft('')
    const realName =
      profile?.username ??
      ((user.user_metadata as Record<string, unknown> | undefined)?.username as string | undefined)
    // Founder mode posts under the founder handle (PatternAft3r).
    const myName = effectiveDisplayName(realName)
    const row =
      (inserted as ReelComment | null) ?? {
        id: `local-${Date.now()}`,
        reel_id: reelId,
        user_id: user.id,
        content,
        created_at: new Date().toISOString(),
      }
    setComments((prev) =>
      prev.some((c) => c.id === row.id)
        ? prev
        : [
            ...prev,
            {
              ...row,
              username: myName,
              avatarUrl: profile?.avatar_url ?? null,
              meta: user.user_metadata as BadgeMeta,
            },
          ],
    )
  }

  return (
    <div className={embedded ? '' : 'mt-6 rounded-xl border border-dark-border bg-dark-card p-6'}>
      {!embedded && (
        <h2 className="text-lg font-semibold mb-4">
          Comments
          <span className="ml-2 text-sm text-gray-500">{comments.length}</span>
        </h2>
      )}

      {/* Composer — auth-gated. Guests get a sign-in prompt, not an input. */}
      {user ? (
        <form onSubmit={handleSubmit} className="mb-5 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Add a comment…"
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-accent resize-none"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold text-sm disabled:opacity-50"
            >
              {sending ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </form>
      ) : (
        <div className="mb-5 rounded-lg border border-dark-border bg-dark p-4 text-center text-sm text-gray-400">
          <Link to="/login" className="text-accent hover:underline font-semibold">Sign in to comment</Link>
          <span className="text-gray-500"> — you can keep watching either way.</span>
        </div>
      )}

      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

      {comments.length === 0 ? (
        <p className="text-gray-500 text-sm">No comments yet. Be the first.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5 text-sm">
              <Avatar
                src={c.avatarUrl}
                name={c.user_id ? c.username : 'deleted'}
                seed={c.user_id ?? 'deleted'}
                size={28}
              />
              <div className="min-w-0 flex-1">
                {c.user_id ? (
                  <>
                    {topBadge(c.meta) && <BadgeChip badge={topBadge(c.meta)!} compact className="mr-1" />}
                    <Link to={`/profile/${c.user_id}`} className="text-accent font-semibold mr-2 hover:underline">
                      {c.username ?? 'someone'}
                    </Link>
                  </>
                ) : (
                  <span className="text-gray-500 font-semibold mr-2">deleted</span>
                )}
                <span className="text-gray-200 break-words whitespace-pre-wrap">{c.content}</span>
                <span className="block text-[11px] text-gray-600 mt-0.5">
                  {new Date(c.created_at).toLocaleString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default ReelComments
