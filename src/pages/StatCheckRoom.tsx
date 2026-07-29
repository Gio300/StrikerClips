import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { extractYouTubeId } from '@/lib/youtubeApi'
import { effectiveDisplayName } from '@/lib/founder'

type Submission = {
  id: string
  user_id: string
  video_url: string
  character_name: string | null
  description: string | null
  created_at: string
}

/**
 * Stat Check Room — a simple shared room where players post their stat-check
 * clip (a YouTube link) and the tournament host + other players can watch them.
 *
 * Deliberately minimal: no AI, no cheating detection. Just post a link + note,
 * and everyone can browse the grid and play any clip inline. Viewing is public;
 * submitting needs a signed-in account.
 */
export function StatCheckRoom() {
  const { user } = useAuth()
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [profiles, setProfiles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [videoUrl, setVideoUrl] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [playingId, setPlayingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [subRes, profRes] = await Promise.all([
        supabase
          .from('stat_check_submissions')
          .select('id, user_id, video_url, character_name, description, created_at')
          .order('created_at', { ascending: false }),
        supabase.from('profiles').select('id, username'),
      ])
      setSubmissions((subRes.data as Submission[]) ?? [])
      const map: Record<string, string> = {}
      for (const p of (profRes.data as { id: string; username: string }[]) ?? []) {
        map[p.id] = p.username
      }
      setProfiles(map)
    } catch {
      setError('Could not load stat checks. Try again in a moment.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!user) {
      setError('Sign in to post your stat check.')
      return
    }
    const videoId = extractYouTubeId(videoUrl)
    if (!videoId) {
      setError('Paste a valid YouTube link.')
      return
    }
    setSubmitting(true)
    try {
      await supabase.from('stat_check_submissions').insert({
        user_id: user.id,
        video_url: videoUrl.trim(),
        character_name: note.trim() || null,
      })
      setVideoUrl('')
      setNote('')
      await load()
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

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Stat Check Room</h1>
      <p className="text-gray-400 mb-6">
        Post a short clip showing your character&apos;s stats/buffs (loadout). Everyone in the room —
        the tournament host and other players — can watch what you post here.
      </p>

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
            <button
              type="submit"
              disabled={submitting || !videoUrl.trim()}
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
      ) : submissions.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center">
          <p className="text-gray-400">No stat checks yet — post yours.</p>
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
