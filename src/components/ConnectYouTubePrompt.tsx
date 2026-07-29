import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { connectYouTube, fetchMyUploads, fetchUploadsByHandle, isYouTubeApiConfigured, isYouTubeConnectConfigured, saveLibrary, saveHandle } from '@/lib/youtubeConnect'
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
  if (s.includes('youtube.com') || s.includes('youtu.be')) return s
  const h = s.replace(/^@/, '')
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(h)) return null
  return `https://www.youtube.com/@${h}`
}

export default function ConnectYouTubePrompt() {
  const { user } = useAuth()
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
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
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .then(({ data }) => { if (alive) setHasLink((data?.length ?? 0) > 0) })
    return () => { alive = false }
  }, [user?.id])

  const canOAuth = isYouTubeConnectConfigured()
  const show = !!user && hasLink === false && !dismissed

  async function saveUrl(url: string) {
    if (!user) return
    const { data: existing } = await supabase
      .from('user_youtube_links')
      .select('id')
      .eq('user_id', user.id)
      .eq('url', url)
      .limit(1)
    if (!existing?.length) {
      await supabase.from('user_youtube_links').insert({ user_id: user.id, url })
    }
    setReveal(true)
  }

  async function submitHandle(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    const url = normalizeHandle(handle)
    if (!url) { setErr('Enter your channel @handle or link.'); return }
    setBusy(true)
    try {
      // Actually PULL their uploads from the handle (no OAuth — works in the app)
      // and cache them so their clips show immediately.
      if (isYouTubeApiConfigured()) {
        const vids = await fetchUploadsByHandle(handle)
        if (user) { saveLibrary(user.id, vids); saveHandle(user.id, handle) }
        if (vids.length === 0) {
          setErr('Saved, but no public uploads found on that handle yet.')
        }
      }
      await saveUrl(url)
    } catch {
      setErr('Could not reach that channel — check the handle and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function oneTap() {
    if (!user) return
    setErr(null)
    setBusy(true)
    try {
      const token = await connectYouTube()
      const uploads = await fetchMyUploads(token)
      saveLibrary(user.id, uploads)                         // cache their clips locally
      await saveUrl('oauth://youtube')                      // mark connected server-side
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Connect cancelled.')
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
        subtitle="Your clips can now be auto-matched into multi-angle TKO videos."
        onClose={() => { setReveal(false); setDismissed(true) }}
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
          TKO finds <em>your</em> clips and merges them with the other players' angles into
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
        {canOAuth && (
          <button
            onClick={oneTap}
            disabled={busy}
            className="mt-3 w-full text-xs text-gray-500 underline"
          >
            Advanced: sign in with Google instead (may not work on mobile)
          </button>
        )}

        {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
        <button onClick={() => setDismissed(true)} className="mt-4 w-full text-xs text-gray-500">
          Later
        </button>
      </div>
    </div>
  )
}
