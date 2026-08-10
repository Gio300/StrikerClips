import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { extractYouTubeId } from '@/lib/youtubeApi'
import { thumbUrl } from '@/lib/youtubeConnect'
import { reelIdsFeaturing } from '@/lib/reelParticipants'
import { PlayerProducedVideos } from '@/components/PlayerProducedVideos'
import { AutoMergeStatus } from '@/components/AutoMergeStatus'
import { reelBadgeLabel, reelStatus } from '@/lib/reelStatus'
import {
  detectedBattleLabel,
  detectedBattleWatchUrl,
  isVisibleDetectedBattle,
  type DetectedBattleRow,
} from '@/lib/detectedBattles'
import type { Reel, Clip } from '@/types/database'

/**
 * My Clips — everything the signed-in user has made, newest first. This is the
 * "where did my clip go" answer: after a reel finishes it lands here with a
 * truthful saved/playable/produced badge (and a one-time saved banner).
 */
export function MyClips() {
  const { user } = useAuth()
  const location = useLocation()
  const justCreated = (location.state as { justCreated?: boolean } | null)?.justCreated
  const [reels, setReels] = useState<Reel[]>([])
  // Reels the user APPEARS in but didn't upload — flagged "you're in it".
  const [featuredIn, setFeaturedIn] = useState<Set<string>>(new Set())
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [detectedBattles, setDetectedBattles] = useState<DetectedBattleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(!!justCreated)
  const [query, setQuery] = useState('')

  // Client-side title filter over the user's own reels.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return reels
    return reels.filter((r) => (r.title ?? '').toLowerCase().includes(q))
  }, [reels, query])

  useEffect(() => {
    if (!user) { setLoading(false); return }
    let alive = true
    ;(async () => {
      // My Clips is "clips I'm in", not "clips I uploaded": a combined
      // multi-angle reel belongs in the list of everyone who appears in it, so
      // we union the reels I uploaded with the reels that list me as a
      // participant (see lib/reelParticipants + the reel_participants table).
      const [mineRes, featuredIds, detectedRes] = await Promise.all([
        supabase
          .from('reels')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        reelIdsFeaturing(user.id),
        supabase
          .from('clip_records')
          .select('id, segment_id, youtube_id, source_start_sec, source_end_sec, duration_sec, boundary_confidence, score_verification_status, mode, map, recorded_at, created_at')
          .eq('player_id', user.id)
          .eq('score_verification_status', 'shadow')
          .order('recorded_at', { ascending: false }),
      ])
      const mine = (mineRes.data ?? []) as Reel[]
      const mineIds = new Set(mine.map((r) => r.id))
      const otherIds = featuredIds.filter((id) => !mineIds.has(id))
      let featured: Reel[] = []
      if (otherIds.length > 0) {
        const { data: featRes } = await supabase.from('reels').select('*').in('id', otherIds)
        featured = (featRes ?? []) as Reel[]
      }
      const rows = [...mine, ...featured].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      if (!alive) return
      setFeaturedIn(new Set(featured.map((r) => r.id)))
      setReels(rows)
      setDetectedBattles(
        ((detectedRes.data ?? []) as unknown as DetectedBattleRow[]).filter(isVisibleDetectedBattle),
      )
      setLoading(false)
      // Best-effort thumbnail: first YouTube clip of each reel.
      const firstIds = rows.map((r) => r.clip_ids?.[0]).filter(Boolean) as string[]
      if (firstIds.length) {
        const { data: clips } = await supabase.from('clips').select('*').in('id', firstIds)
        const map: Record<string, string> = {}
        for (const r of rows) {
          const c = (clips as Clip[] | null)?.find((x) => x.id === r.clip_ids?.[0])
          const yid = c ? extractYouTubeId((c as Clip).url_or_path ?? '') : null
          if (yid) map[r.id] = thumbUrl(yid)
        }
        if (alive) setThumbs(map)
      }
    })()
    return () => { alive = false }
  }, [user?.id])

  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(false), 6000)
    return () => clearTimeout(t)
  }, [banner])

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">My Clips</h1>
          <p className="text-sm text-gray-500 mt-1">
            Every reel you've made — plus the multi-angle clips you appear in. Newest first.
          </p>
        </div>
        <Link to="/highlight/create" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow">
          + New clip
        </Link>
      </div>

      {banner && (
        <div className="mb-5 rounded-lg border border-leaf/40 bg-leaf/10 text-leaf px-4 py-3 text-sm flex items-center gap-2">
          <span>✓</span> Your reel is saved — it's at the top of the list.
        </div>
      )}

      {/* Auto-merge unlock: ON when YouTube is connected AND a paid tier is
          active; otherwise a prompt to connect / subscribe. */}
      {user && <AutoMergeStatus className="mb-5" />}

      {!loading && detectedBattles.length > 0 && (
        <section className="mb-7" aria-labelledby="detected-battles-title">
          <div className="mb-3">
            <h2 id="detected-battles-title" className="text-lg font-semibold text-white">
              Detected livestream battles
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Found automatically in your connected YouTube footage. Screenshots and manual result claims do not qualify for power.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {detectedBattles.map((battle) => (
              <a
                key={battle.id}
                href={detectedBattleWatchUrl(battle)}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-xl border border-accent/30 bg-dark-card transition-colors hover:border-accent"
              >
                <div className="relative aspect-video bg-dark">
                  <img
                    src={thumbUrl(String(battle.youtube_id), 'mq')}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute left-2 top-2 rounded border border-accent/40 bg-dark/90 px-2 py-1 text-[10px] font-bold text-accent">
                    SYSTEM DETECTED
                  </span>
                </div>
                <div className="p-3">
                  <h3 className="font-semibold text-white group-hover:text-accent">
                    {detectedBattleLabel(battle.mode)}
                  </h3>
                  <p className="mt-1 text-xs text-gray-500">
                    {battle.recorded_at ? new Date(battle.recorded_at).toLocaleDateString() : 'Livestream archive'}
                    {' · '}Watch from {Math.floor(Number(battle.source_start_sec) / 60)}:{String(Math.floor(Number(battle.source_start_sec) % 60)).padStart(2, '0')}
                  </p>
                  <p className="mt-2 text-xs text-leaf">Participation counted · result points await verification</p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {!loading && reels.length > 0 && (
        <div className="mb-6">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your clips by title…"
            className="w-full md:max-w-md px-4 py-2 rounded-lg bg-dark border border-dark-border text-white placeholder-gray-500 focus:outline-none focus:border-accent/50"
          />
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-accent animate-pulse">Loading your clips…</div>
      ) : reels.length === 0 && detectedBattles.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          <p>No clips yet.</p>
          <p className="text-sm mt-1">Make your first one — pull from your squad, describe a moment, or paste a link.</p>
          <Link to="/highlight/create" className="mt-4 inline-block px-4 py-2 rounded-lg bg-accent text-dark font-semibold">
            Create a clip
          </Link>
        </div>
      ) : reels.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.length === 0 ? (
            <p className="col-span-full py-10 text-center text-gray-400">No clips match “{query}”.</p>
          ) : filtered.map((reel, i) => (
            <Link
              key={reel.id}
              to={`/reels/${reel.id}`}
              className="group rounded-xl border border-dark-border bg-dark-card overflow-hidden hover:border-accent/50 transition-all"
            >
              <div className="relative aspect-video bg-dark flex items-center justify-center">
                {thumbs[reel.id] ? (
                  <img src={thumbs[reel.id]} alt="" className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.2' }} />
                ) : (
                  <svg className="w-14 h-14 text-dark-border group-hover:text-accent/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
                <span
                  className={`absolute top-2 left-2 text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                    featuredIn.has(reel.id)
                      ? 'bg-chakra/20 text-chakra border-chakra/30'
                      : reelStatus(reel) === 'saved'
                        ? 'bg-yellow-500/15 text-yellow-200 border-yellow-500/40'
                        : 'bg-leaf/20 text-leaf border-leaf/30'
                  }`}
                >
                  {featuredIn.has(reel.id)
                    ? "YOU'RE IN IT"
                    : reelBadgeLabel(reel, i === 0 && !!justCreated)}
                </span>
              </div>
              <div className="p-3">
                <h2 className="font-semibold truncate">{reel.title}</h2>
                <p className="text-xs text-gray-500 mt-1">
                  {reel.clip_ids?.length ?? 0} clip{(reel.clip_ids?.length ?? 0) === 1 ? '' : 's'}
                  {reel.created_at ? ` · ${new Date(reel.created_at).toLocaleDateString()}` : ''}
                </p>
              </div>
            </Link>
          ))}
        </div>
      ) : null}

      {/* Produced multi-angle videos this player appears in (clip_records with a
          youtube_id), joined across everyone in each video. */}
      {user && <PlayerProducedVideos playerId={user.id} isOwn />}
    </div>
  )
}
