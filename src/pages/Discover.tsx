import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { FollowControl } from '@/components/FollowControl'
import { Avatar } from '@/components/ui'
import { ProfileTagBadge } from '@/components/TagBadge'
import type { Profile } from '@/types/database'

/**
 * Discover — find people by username and follow them.
 *
 * Searches the `profiles` table with a case-insensitive `ilike` match, which
 * works against the hosted Supabase, the realSupabase shim (forwarded to the
 * Express /db endpoint), and the mock backend (its `ilike` now filters).
 */
export function Discover() {
  const { user } = useAuth()
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [following, setFollowing] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  // Load who the signed-in user already follows so result buttons show the
  // correct Follow / Following state.
  useEffect(() => {
    if (!user) {
      setFollowing(new Set())
      return
    }
    let cancelled = false
    supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', user.id)
      .then(({ data }) => {
        if (cancelled) return
        setFollowing(new Set((data ?? []).map((f) => f.following_id)))
      })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  const runSearch = useCallback(
    async (raw: string) => {
      const q = raw.trim()
      setSearched(true)
      if (!q) {
        setResults([])
        return
      }
      setLoading(true)
      // Match by USERNAME.
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .ilike('username', `%${q}%`)
        .limit(30)
      let rows = (data ?? []) as Profile[]
      // ALSO match by clan TAG — "ai" should surface everyone tagged AI. Find the
      // clans whose tag matches, then their members, and merge them in.
      try {
        const { data: clans } = await supabase
          .from('servers')
          .select('id, clan_tag')
          .ilike('clan_tag', `%${q}%`)
          .limit(20)
        const clanIds = ((clans ?? []) as { id: string }[]).map((c) => c.id)
        if (clanIds.length) {
          const { data: mems } = await supabase.from('clan_members').select('user_id').in('server_id', clanIds)
          const memberIds = [...new Set(((mems ?? []) as { user_id: string }[]).map((m) => m.user_id))]
          if (memberIds.length) {
            const { data: byTag } = await supabase.from('profiles').select('*').in('id', memberIds).limit(30)
            const have = new Set(rows.map((r) => r.id))
            for (const p of (byTag ?? []) as Profile[]) if (!have.has(p.id)) rows.push(p)
          }
        }
      } catch { /* tag search best-effort — username results still stand */ }
      // Never list yourself as someone to follow.
      if (user) rows = rows.filter((p) => p.id !== user.id)
      setResults(rows)
      setLoading(false)
    },
    [user?.id],
  )

  function handleFollowChange(targetId: string, next: boolean) {
    setFollowing((prev) => {
      const s = new Set(prev)
      if (next) s.add(targetId)
      else s.delete(targetId)
      return s
    })
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Search players</h1>
      <p className="text-gray-400 mb-6">Find players by username or clan tag, open their profile, and follow them.</p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          runSearch(term)
        }}
        className="flex gap-2 mb-6"
      >
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search name or clan tag (e.g. ai)…"
          className="flex-1 px-4 py-2.5 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2.5 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {loading ? (
        <div className="animate-pulse text-gray-400">Searching…</div>
      ) : results.length === 0 ? (
        searched ? (
          <p className="text-gray-500">No players found. Try a different username.</p>
        ) : (
          <p className="text-gray-500">Type a username above to find people.</p>
        )
      ) : (
        <div className="space-y-3">
          {results.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-4 rounded-xl border border-dark-border bg-dark-card p-4"
            >
              {/* Whole left area is tappable → opens their profile (where Follow
                  also lives), so a small username link is never the only target. */}
              <Link to={`/profile/${p.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                <Avatar src={p.avatar_url} name={p.username} seed={p.id} size={48} />
                <div className="min-w-0">
                  <span className="font-semibold text-white inline-flex items-center gap-1.5">
                    {p.username}
                    <ProfileTagBadge user={p} />
                  </span>
                  {p.power_level != null && p.power_level > 0 && (
                    <p className="text-accent text-xs">PL {p.power_level}</p>
                  )}
                  {p.bio && <p className="text-gray-500 text-sm truncate">{p.bio}</p>}
                  <p className="text-gray-500 text-xs mt-0.5">Tap to view profile →</p>
                </div>
              </Link>
              {user && user.id !== p.id && (
                <FollowControl
                  followerId={user.id}
                  targetId={p.id}
                  targetUsername={p.username}
                  isFollowing={following.has(p.id)}
                  onFollowChange={(next) => handleFollowChange(p.id, next)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
