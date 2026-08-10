import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { extractYouTubeId } from '@/lib/youtubeApi'
import { effectiveDisplayName } from '@/lib/founder'

type Submission = {
  id: string
  user_id: string
  tournament_id: string | null
  video_url: string
  character_name: string | null
  description: string | null
  created_at: string
}

type RoomTournament = {
  id: string
  name: string
  /** True when the viewer has an entrant row or a King registration here. */
  mine: boolean
}

/**
 * Stat Check Room — the shared room where the players in ONE tournament post
 * their stat-check clip (a YouTube link) and the host + the other entrants can
 * watch them.
 *
 * A STAT CHECK ALWAYS BELONGS TO A TOURNAMENT. This page used to write
 * `stat_check_submissions` rows with no `tournament_id` at all, and the entire
 * review surface is keyed by that column: the host's queue reads the
 * submissions for the tournaments they own or admin, and the entrant-approval
 * fn resolves them by (tournament_id, user_id). Every clip posted here was
 * therefore invisible to every reviewer — it could never be approved, rejected,
 * or even seen. The page was also linked from nowhere, so the rows piled up
 * unread. The tournament is now a required part of the room:
 *
 *   • `?tournament=<id>` selects it (that is the link the tournament's own
 *     stat-check tab uses, so the room opens already scoped);
 *   • without one, a picker offers the viewer's own tournaments first and the
 *     rest of the open board after;
 *   • posting is disabled until one is chosen, and the insert always carries
 *     it. The server refuses a submission without a tournament regardless of
 *     what any client sends (see server/app.ts).
 *
 * Viewing is public; posting needs a signed-in account.
 */
export function StatCheckRoom() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const tournamentId = searchParams.get('tournament') ?? ''

  const [tournaments, setTournaments] = useState<RoomTournament[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [profiles, setProfiles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [videoUrl, setVideoUrl] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [playingId, setPlayingId] = useState<string | null>(null)
  /** The one-shot "open their only tournament for them" convenience. */
  const autoPicked = useRef(false)

  const selected = useMemo(
    () => tournaments.find((t) => t.id === tournamentId) ?? null,
    [tournaments, tournamentId],
  )

  function chooseTournament(next: string) {
    // Keep the choice in the URL so the room is linkable and survives a reload.
    if (next) setSearchParams({ tournament: next }, { replace: true })
    else setSearchParams({}, { replace: true })
    setPlayingId(null)
  }

  /** The tournaments this viewer can post a stat check to. */
  async function loadTournaments() {
    const [openRes, entrantRes, regRes] = await Promise.all([
      supabase.from('tournaments').select('id, name, status').order('created_at', { ascending: false }),
      user
        ? supabase.from('tournament_entrants').select('tournament_id, status').eq('user_id', user.id)
        : Promise.resolve({ data: [] as { tournament_id: string; status: string }[] }),
      user
        ? supabase.from('tournament_registrations').select('tournament_id').eq('user_id', user.id)
        : Promise.resolve({ data: [] as { tournament_id: string }[] }),
    ])

    const mine = new Set<string>()
    for (const row of (entrantRes.data as { tournament_id: string; status: string }[] | null) ?? []) {
      // A withdrawn or rejected entry is not a room you still post to.
      if (row.status === 'pending' || row.status === 'accepted') mine.add(String(row.tournament_id))
    }
    for (const row of (regRes.data as { tournament_id: string }[] | null) ?? []) {
      mine.add(String(row.tournament_id))
    }

    const all = ((openRes.data as { id: string; name: string; status: string | null }[] | null) ?? [])
      .filter((t) => mine.has(String(t.id)) || String(t.status ?? 'open') !== 'closed')
      .map((t) => ({ id: String(t.id), name: String(t.name || 'Tournament'), mine: mine.has(String(t.id)) }))
    // The viewer's own tournaments first — that is almost always the one meant.
    all.sort((a, b) => Number(b.mine) - Number(a.mine))
    setTournaments(all)
    return all
  }

  async function loadSubmissions(forTournament: string) {
    if (!forTournament) {
      setSubmissions([])
      return
    }
    const [subRes, profRes] = await Promise.all([
      supabase
        .from('stat_check_submissions')
        .select('id, user_id, tournament_id, video_url, character_name, description, created_at')
        .eq('tournament_id', forTournament)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, username'),
    ])
    setSubmissions((subRes.data as Submission[]) ?? [])
    const map: Record<string, string> = {}
    for (const p of (profRes.data as { id: string; username: string }[]) ?? []) {
      map[p.id] = p.username
    }
    setProfiles(map)
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      try {
        const list = await loadTournaments()
        if (!alive) return
        // No tournament in the URL? Open the viewer's own one when it is the
        // only candidate. ONCE — after that the picker is theirs, so clearing
        // it back to "Choose a tournament…" sticks instead of snapping back.
        let resolved = tournamentId
        if (!resolved && !autoPicked.current) {
          const ownOnly = list.filter((t) => t.mine)
          if (ownOnly.length === 1) resolved = ownOnly[0].id
        }
        autoPicked.current = true
        if (resolved !== tournamentId) chooseTournament(resolved)
        await loadSubmissions(resolved)
      } catch {
        if (alive) setError('Could not load stat checks. Try again in a moment.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tournamentId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!user) {
      setError('Sign in to post your stat check.')
      return
    }
    // THE GUARANTEE: never write a submission that cannot reach a review queue.
    if (!tournamentId) {
      setError('Choose the tournament this stat check is for.')
      return
    }
    const videoId = extractYouTubeId(videoUrl)
    if (!videoId) {
      setError('Paste a valid YouTube link.')
      return
    }
    setSubmitting(true)
    try {
      const { error: insertError } = await supabase.from('stat_check_submissions').insert({
        user_id: user.id,
        tournament_id: tournamentId,
        video_url: videoUrl.trim(),
        character_name: note.trim() || null,
      })
      if (insertError) throw new Error(insertError.message)
      setVideoUrl('')
      setNote('')
      await loadSubmissions(tournamentId)
    } catch {
      setError('Could not post your stat check. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function displayName(uid: string): string {
    if (user && uid === user.id) {
      const uname = (user.user_metadata as { username?: string } | undefined)?.username
      // Founder mode attributes your posted clips to the founder handle.
      return effectiveDisplayName(uname) || 'You'
    }
    return profiles[uid] || 'Player'
  }

  const ownTournaments = tournaments.filter((t) => t.mine)
  const otherTournaments = tournaments.filter((t) => !t.mine)

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Stat Check Room</h1>
      <p className="text-gray-400 mb-6">
        Post a short clip showing your character&apos;s stats/buffs (loadout). Everyone in the
        tournament — the host and the other players — can watch what you post here, and the host
        reviews it from their stat-check queue.
      </p>

      {/* Tournament picker — a stat check with no tournament reaches no host. */}
      <div className="rounded-xl border border-dark-border bg-dark-card p-4 mb-4">
        <label className="block text-sm text-gray-400 mb-1" htmlFor="statcheck-tournament">
          Tournament <span className="text-gray-600">(required)</span>
        </label>
        {tournaments.length === 0 && !loading ? (
          <div className="text-sm text-gray-400">
            No tournaments are open right now.{' '}
            <Link to="/tournaments" className="text-accent hover:underline">
              Browse tournaments →
            </Link>
          </div>
        ) : (
          <select
            id="statcheck-tournament"
            value={tournamentId}
            onChange={(e) => chooseTournament(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
          >
            <option value="">Choose a tournament…</option>
            {ownTournaments.length > 0 && (
              <optgroup label="Your tournaments">
                {ownTournaments.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </optgroup>
            )}
            {otherTournaments.length > 0 && (
              <optgroup label="Open tournaments">
                {otherTournaments.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        )}
        {selected && (
          <p className="mt-2 text-[11px] text-gray-500">
            Posting to <span className="text-gray-300">{selected.name}</span>.{' '}
            <Link to={`/tournaments/${selected.id}`} className="text-accent hover:underline">
              Open the tournament →
            </Link>
          </p>
        )}
      </div>

      {/* Post form */}
      <div className="rounded-xl border border-dark-border bg-dark-card p-4 mb-8">
        {user ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Paste your stat-check clip (YouTube link)
              </label>
              <input
                type="text"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Note <span className="text-gray-600">(optional — character / loadout)</span>
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Naruto (Sage), full attack build"
                className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            {!tournamentId && (
              <p className="text-xs text-gray-500">
                Choose a tournament above — a stat check has to name one to reach its host.
              </p>
            )}
            <button
              type="submit"
              disabled={submitting || !videoUrl.trim() || !tournamentId}
              className="px-6 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
            >
              {submitting ? 'Posting…' : 'Post stat check'}
            </button>
          </form>
        ) : (
          <div className="text-center py-4">
            <p className="text-gray-400 mb-3">Sign in to post your stat check. Anyone can watch below.</p>
            <Link
              to="/login"
              className="inline-block px-5 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow"
            >
              Sign in
            </Link>
          </div>
        )}
      </div>

      {/* Submissions */}
      {loading ? (
        <div className="animate-pulse text-gray-400">Loading stat checks…</div>
      ) : !tournamentId ? (
        <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center">
          <p className="text-gray-400">Choose a tournament to see its stat checks.</p>
        </div>
      ) : submissions.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center">
          <p className="text-gray-400">No stat checks yet for this tournament — post yours.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {submissions.map((s) => {
            const vid = extractYouTubeId(s.video_url)
            const playing = playingId === s.id
            return (
              <div
                key={s.id}
                className="rounded-xl border border-dark-border bg-dark-card overflow-hidden"
              >
                <div className="relative aspect-video bg-dark">
                  {playing && vid ? (
                    <iframe
                      src={`https://www.youtube.com/embed/${vid}?autoplay=1`}
                      title={s.character_name || 'Stat check'}
                      className="w-full h-full"
                      allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                      allowFullScreen
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => vid && setPlayingId(s.id)}
                      className="group w-full h-full"
                      title={vid ? 'Play clip' : 'Invalid link'}
                    >
                      {vid ? (
                        <img
                          src={`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`}
                          alt={s.character_name || 'Stat check thumbnail'}
                          loading="lazy"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            ;(e.currentTarget as HTMLImageElement).style.opacity = '0.2'
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                          Invalid link
                        </div>
                      )}
                      {vid && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="w-12 h-12 rounded-full bg-accent/90 text-dark flex items-center justify-center group-hover:scale-110 transition-transform">
                            <svg className="w-5 h-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        </span>
                      )}
                    </button>
                  )}
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white truncate">
                      {displayName(s.user_id)}
                    </span>
                    <span className="text-[11px] text-gray-600 shrink-0">
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {(s.character_name || s.description) && (
                    <p className="text-sm text-gray-400 mt-1 line-clamp-2">
                      {s.character_name || s.description}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
