import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { fetchUploadsByHandle, isYouTubeApiConfigured, rememberYouTubeChannel, saveLibrary } from '@/lib/youtubeConnect'
import { normalizeConnectedYouTubeChannelUrl, youtubeHandleFromChannelUrl } from '@/lib/signupYouTube'
import { saveConnectedYouTubeChannel } from '@/lib/youtubeSettings'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'
import UnlockReveal from '@/components/UnlockReveal'

/**
 * ConnectYouTubePrompt — the "you must connect YouTube" gate.
 *
 * TKO's whole match-merge engine needs each player's own clips, so connecting
 * the SAME YouTube that's linked to their gaming device is required. This popup
 * appears the next time a signed-in player without a linked YouTube opens the
 * app (e.g. Hollywood), and again until they connect. Connecting fires the
 * UnlockReveal so it feels like opening a power box.
 *
 * Mount once near the app root; it self-gates on the auth + auto-merge signals.
 */
function normalizeHandle(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  if (s.includes('youtube.com') || s.includes('youtu.be')) {
    return normalizeConnectedYouTubeChannelUrl(s)
  }
  const h = s.replace(/^@/, '')
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(h)) return null
  return normalizeConnectedYouTubeChannelUrl(`https://www.youtube.com/@${h}`)
}

export default function ConnectYouTubePrompt() {
  const { user } = useAuth()
  const { league } = useLeagueTheme()
  const brandName = league?.name || 'TKO'
  const location = useLocation()
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)
  // Gate on SERVER truth — whether they actually have a linked YouTube — not on
  // the local clip cache (demo clips or any prior interaction would poison that
  // and wrongly suppress the prompt, which is why it never appeared).
  const [hasLink, setHasLink] = useState<boolean | null>(null)

  useEffect(() => {
    if (!user) { setHasLink(null); return }
    let alive = true
    supabase
      .from('user_youtube_links')
      .select('url')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (alive) {
          setHasLink((data ?? []).some((row) => Boolean(normalizeConnectedYouTubeChannelUrl(row.url))))
        }
      })
    return () => { alive = false }
  }, [user?.id])

  // Connecting a video source is unrelated to buying or managing merchandise.
  // Keep this app-level gate from obscuring those transactional screens.
  const isCommerceRoute = ['/physical', '/forge/physical', '/shop', '/store'].some(
    (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
  )
  const show = !!user && hasLink === false && !isCommerceRoute

  async function saveUrl(url: string) {
    if (!user) return
    const saved = await saveConnectedYouTubeChannel(url)
    rememberYouTubeChannel(user.id, saved?.url || url)
    setHasLink(true)
    setReveal(true)
  }

  async function submitHandle(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const url = normalizeHandle(handle)
    if (!url) { setErr('Enter your channel @handle or link.'); return }
    setBusy(true)
    try {
      await saveUrl(url)
      // Actually PULL their uploads from the handle (no OAuth — works in the app)
      // and cache them so their clips show immediately.
      const uploadHandle = youtubeHandleFromChannelUrl(url)
      if (isYouTubeApiConfigured() && uploadHandle) {
        try {
          const vids = await fetchUploadsByHandle(uploadHandle)
          if (user) saveLibrary(user.id, vids)
        } catch { /* uploads can hydrate on a later visit */ }
      }
    } catch {
      setErr('Could not reach that channel — check the handle and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (reveal) {
    return (
      <UnlockReveal
        open
        emoji="📺"
        accent="#ff8a1e"
        title="YOUTUBE CONNECTED"
        subtitle={`Your clips can now be auto-matched into multi-angle ${brandName} videos.`}
        onClose={() => setReveal(false)}
      />
    )
  }

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-dark-border bg-dark p-6 shadow-2xl">
        <div className="text-4xl">📺</div>
        <h2 className="mt-3 text-xl font-bold">Connect your YouTube</h2>
        <p className="mt-1 text-sm text-gray-400">
          {brandName} finds <em>your</em> clips and merges them with the other players' angles into
          multi-angle videos. Just enter your channel handle — no Google sign-in needed.
        </p>

        {/* Handle is the PRIMARY path: it reads your public uploads with no OAuth,
            so it works inside the app (Google blocks the sign-in popup here, and
            the app isn't through Google verification yet). */}
        <form onSubmit={submitHandle} className="mt-4 space-y-2">
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@yourhandle  or  youtube.com/@you"
            className="w-full rounded-lg border border-dark-border bg-dark px-4 py-3 text-white focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-accent py-3 font-semibold text-dark hover:shadow-glow disabled:opacity-50"
          >
            {busy ? 'Connecting…' : 'Connect my YouTube'}
          </button>
        </form>
        {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
        <p className="mt-4 text-center text-xs text-gray-500">
          A channel is required so your battles and clips can be matched to your account.
        </p>
      </div>
    </div>
  )
}
