import { useEffect, useMemo, useState, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { extractYouTubeId } from '@/lib/youtubeApi'
import { thumbUrl } from '@/lib/youtubeConnect'
import {
  orderCreatorFeed,
  reelsFetchWindow,
  REELS_PAGE_SIZE,
  reelFeedMediaLabel,
  takeFeedPage,
} from '@/lib/feedDiversity'
import { AdSlot } from '@/components/AdSlot'
import type { Reel, Clip } from '@/types/database'

type AuthorMeta = { username?: string; power_level?: number }

export function Reels() {
  const [reels, setReels] = useState<Reel[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [authors, setAuthors] = useState<Record<string, AuthorMeta>>({})
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [requestedLimit, setRequestedLimit] = useState(REELS_PAGE_SIZE)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    let alive = true
    async function fetchReels() {
      if (requestedLimit > REELS_PAGE_SIZE) setLoadingMore(true)
      try {
        // Scan a bounded window wider than the displayed page. Otherwise one
        // creator with 24 fresh uploads could occupy the whole first page even
        // though other creators are immediately behind them.
        const fetchWindow = reelsFetchWindow(requestedLimit)
        const { data } = await supabase
          .from('reels')
          .select('*, profiles(username, power_level)')
          .order('created_at', { ascending: false })
          // Initial Watch must stay cheap. One look-ahead row tells us whether
          // to show Load more without downloading the entire promoted table.
          .limit(fetchWindow + 1)
        // FRONT-PAGE EXCLUSION: free members' auto weekly videos are inserted
        // with promoted=false — they live on the member's own profile + share
        // link only, never this feed. Filtered client-side (not `.eq(...)`) so
        // a backend whose reels rows predate the `promoted` column — or the
        // mock backend's seed data — still shows everything: a missing value
        // reads as promoted, matching the column's default of true.
        const fetched = (data ?? []) as Reel[]
        const page = takeFeedPage(fetched, fetchWindow)
        const rows = page.items.filter((r) => r.promoted !== false)
        if (!alive) return
        setHasMore(page.hasMore || rows.length > requestedLimit)
        setReels(rows)
        setLoading(false)

        // Author names: the mock can't do the profiles(...) join, so resolve
        // them with a second query and map onto the reels client-side.
        const authorIds = Array.from(
          new Set(rows.map((r) => r.user_id).filter(Boolean) as string[])
        )
        if (authorIds.length) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, username, power_level')
            .in('id', authorIds)
          const amap: Record<string, AuthorMeta> = {}
          for (const p of (profiles ?? []) as Array<{ id: string; username?: string; power_level?: number }>) {
            amap[p.id] = { username: p.username, power_level: p.power_level }
          }
          if (alive) setAuthors(amap)
        }

        // Best-effort thumbnail: first YouTube clip of each reel (same approach
        // as MyClips.tsx).
        const firstIds = rows.map((r) => r.clip_ids?.[0]).filter(Boolean) as string[]
        if (firstIds.length) {
          const { data: clips } = await supabase.from('clips').select('*').in('id', firstIds)
          const tmap: Record<string, string> = {}
          for (const r of rows) {
            const c = (clips as Clip[] | null)?.find((x) => x.id === r.clip_ids?.[0])
            const yid = c ? extractYouTubeId((c as Clip).url_or_path ?? '') : null
            if (yid) tmap[r.id] = thumbUrl(yid)
          }
          if (alive) setThumbs(tmap)
        }
      } catch {
        if (alive && requestedLimit === REELS_PAGE_SIZE) setReels([])
      } finally {
        if (alive) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    }
    fetchReels()
    return () => { alive = false }
  }, [requestedLimit])

  // Resolve an author label for a reel, preferring the join then the second
  // query, and falling back to a friendly label (never "Unknown").
  function authorName(reel: Reel): string {
    const joined = (reel as Reel & { profiles?: AuthorMeta }).profiles?.username
    return joined ?? authors[reel.user_id ?? '']?.username ?? 'Anonymous shinobi'
  }
  function authorPower(reel: Reel): number | undefined {
    const joined = (reel as Reel & { profiles?: AuthorMeta }).profiles?.power_level
    return joined ?? authors[reel.user_id ?? '']?.power_level
  }

  // Client-side filter over already-loaded reels: match title or author name.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return reels
    return reels.filter((r) => {
      const title = (r.title ?? '').toLowerCase()
      const author = authorName(r).toLowerCase()
      return title.includes(q) || author.includes(q)
    })
  }, [reels, query, authors])

  // Discovery gets a stable creator round-robin. Search stays in newest-first
  // order so results do not mysteriously jump around while the user types.
  const visible = useMemo(
    () => orderCreatorFeed(filtered, (reel) => reel.user_id || reel.id, query)
      .slice(0, requestedLimit),
    [filtered, query, requestedLimit],
  )

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading reels...</div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Highlight Reels</h1>
        <Link
          to="/reels/create"
          className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow transition-all"
        >
          Create Reel
        </Link>
      </div>
      <div className="mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search reels by title or creator…"
          className="w-full md:max-w-md px-4 py-2 rounded-lg bg-dark border border-dark-border text-white placeholder-gray-500 focus:outline-none focus:border-accent/50"
        />
        {query.trim() && hasMore && (
          <p className="mt-2 text-xs text-gray-500">
            Searching {reels.length} loaded reels. Load more to include older posts.
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visible.map((reel, idx) => (
          <Fragment key={reel.id}>
            <Link
              to={`/reels/${reel.id}`}
              className="group rounded-xl border border-dark-border bg-dark-card overflow-hidden hover:border-accent/50 hover:shadow-glow transition-all animate-slide-up"
            >
              <div className="aspect-video bg-dark flex items-center justify-center">
                {thumbs[reel.id] || reel.thumbnail ? (
                  <img
                    src={thumbs[reel.id] ?? reel.thumbnail ?? undefined}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.2' }}
                  />
                ) : (
                  <div className="text-4xl text-dark-border group-hover:text-accent/50 transition-colors">
                    <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="p-4">
                <h2 className="font-semibold truncate">{reel.title}</h2>
                <p className="text-sm text-gray-400 mt-1">
                  <Link to={`/profile/${reel.user_id}`} className="text-accent hover:underline">{authorName(reel)}</Link>
                  {(authorPower(reel) != null && authorPower(reel)! > 0) && (
                    <> · PL {authorPower(reel)}</>
                  )}
                  {' • '}{reelFeedMediaLabel(reel)}
                </p>
              </div>
            </Link>
            {/* Inline ad after every 6 reels — feels native to the feed. */}
            {(idx + 1) % 6 === 0 && idx !== visible.length - 1 && (
              <div className="md:col-span-2 lg:col-span-3">
                <AdSlot slotId="reels-list-inline" shape="leaderboard" />
              </div>
            )}
          </Fragment>
        ))}
      </div>
      {hasMore && (
        <div className="flex flex-col items-center gap-2 py-8">
          <button
            type="button"
            onClick={() => setRequestedLimit((current) => current + REELS_PAGE_SIZE)}
            disabled={loadingMore}
            className="px-5 py-2 rounded-lg border border-accent text-accent font-semibold hover:bg-accent/10 disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : query.trim() ? 'Load more reels to search' : 'Load more'}
          </button>
          <p className="text-xs text-gray-500">
            Showing {visible.length} of {reels.length} loaded reels
          </p>
        </div>
      )}
      {reels.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p>No reels yet. Create the first one!</p>
          <Link to="/reels/create" className="mt-4 inline-block text-accent hover:underline">Create Reel</Link>
        </div>
      )}
      {reels.length > 0 && visible.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p>No reels match “{query}”.</p>
        </div>
      )}
    </div>
  )
}
