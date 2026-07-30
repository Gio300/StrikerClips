import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { ClipFinder } from '@/components/ClipFinder'
import { isYouTubeConnectConfigured } from '@/lib/youtubeConnect'
import { prettyClip } from '@/lib/clipLabel'
import { BRAND } from '@/lib/brand'
import type { UserYoutubeLink } from '@/types/database'

/**
 * Connect accounts — a dedicated home for linking external sources, so the
 * YouTube connect isn't buried inside the reel builder.
 *
 * The ClipFinder below already renders the real one-tap "Connect YouTube"
 * button (client-side Google OAuth) the moment `VITE_YT_CLIENT_ID` is set, and
 * falls back to pasting links when it isn't. Anything you pick here is saved to
 * your YouTube sources so it's one tap away when you build a reel.
 */
export function Connect() {
  const { user } = useAuth()
  const [links, setLinks] = useState<UserYoutubeLink[]>([])
  const canOAuth = isYouTubeConnectConfigured()

  useEffect(() => {
    if (!user) return
    supabase
      .from('user_youtube_links')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setLinks(data ?? []))
  }, [user?.id])

  async function saveSource(url: string) {
    if (!user) return
    // Dedupe against what's already saved.
    if (links.some((l) => l.url === url)) return
    const { data } = await supabase
      .from('user_youtube_links')
      .insert({ user_id: user.id, url })
      .select()
      .single()
    if (data) setLinks((prev) => [data as UserYoutubeLink, ...prev])
  }

  async function removeLink(id: string) {
    await supabase.from('user_youtube_links').delete().eq('id', id)
    setLinks((prev) => prev.filter((l) => l.id !== id))
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Connect accounts</h1>
        <p className="text-gray-400">
          Link YouTube so {BRAND.name} can pull <em>your</em> uploads for reels — no link hunting.
        </p>
        {canOAuth ? (
          <p className="text-xs text-leaf mt-2">One-tap YouTube connect is available on this build.</p>
        ) : (
          <p className="text-xs text-gray-500 mt-2">
            One-tap connect turns on the moment tko.cam has its Google client ID. Until then, paste your
            clip links below.
          </p>
        )}
      </div>

      <ClipFinder
        onAdd={saveSource}
        username={(user?.user_metadata as { username?: string } | undefined)?.username}
      />

      <div>
        <h2 className="text-lg font-semibold mb-3">Your saved sources</h2>
        {links.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No saved sources yet. Connect YouTube or add a link above.
          </p>
        ) : (
          <div className="space-y-2">
            {links.map((link) => (
              <div
                key={link.id}
                className="flex items-center justify-between rounded-lg border border-dark-border bg-dark-card p-3"
              >
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 truncate flex-1 min-w-0"
                >
                  <span className="text-leaf text-xs shrink-0">✓ saved</span>
                  <span className="text-accent hover:underline truncate">
                    {prettyClip(link.url, link.title)}
                  </span>
                </a>
                <button
                  onClick={() => removeLink(link.id)}
                  className="text-red-400 hover:text-red-300 text-sm ml-2"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-sm text-gray-500">
        Ready to make something?{' '}
        <Link to="/highlight/create" className="text-accent hover:underline">
          Build a reel →
        </Link>
      </p>
    </div>
  )
}
