import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { ShareButton } from '@/components/ShareButton'
import { OracleVote } from '@/components/OracleVote'
import { AdSlot } from '@/components/AdSlot'
import { LiveControlLayout } from '@/components/LiveControlLayout'

/**
 * LiveWatch — a single stream, playing inline, on its own shareable page.
 *
 * Two ways in:
 *   /watch/:id    → look the stream up in live_streams and play it
 *   /watch?u=URL  → play a URL directly (used right after you go live, before
 *                   we round-trip the row id)
 *
 * The share link points at the TKO page so anyone can watch on the site.
 */
type StreamRow = { id: string; youtube_url: string; title: string | null; user_id?: string }

export function LiveWatch() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const [stream, setStream] = useState<StreamRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setNotFound(false)
      const u = params.get('u')
      const t = params.get('t')
      const direct = () => ({ id: 'direct', youtube_url: u as string, title: t })

      // With an id, prefer the stored row (full experience incl. chat). If it
      // isn't on THIS backend — e.g. someone opened your shared link on their
      // own device where the standalone stream doesn't exist — fall back to the
      // url carried in the link so the video still plays with no profile.
      if (id) {
        try {
          const { data } = await supabase.from('live_streams').select('*').eq('id', id).single()
          if (cancelled) return
          if (data) setStream(data as StreamRow)
          else if (u) setStream(direct())
          else setNotFound(true)
        } catch {
          if (!cancelled) { if (u) setStream(direct()); else setNotFound(true) }
        } finally {
          if (!cancelled) setLoading(false)
        }
        return
      }

      // No id: pure direct-URL mode (/watch?u=<url>&t=<title>).
      if (u) {
        if (!cancelled) { setStream(direct()); setLoading(false) }
        return
      }
      if (!cancelled) { setNotFound(true); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [id, params])

  if (loading) {
    return <div className="p-8 text-center text-accent animate-pulse">Loading…</div>
  }

  if (notFound || !stream) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center">
        <h1 className="text-2xl font-bold mb-2">Stream not found</h1>
        <p className="text-gray-400 mb-4">This stream may have ended or the link is off.</p>
        <Link to="/live" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">See who's live</Link>
      </div>
    )
  }

  // Carry the video url in the link so it plays for anyone who opens it, even
  // on a device where the stream row doesn't exist (no backend / no profile).
  const q = `?u=${encodeURIComponent(stream.youtube_url)}${stream.title ? `&t=${encodeURIComponent(stream.title)}` : ''}`
  const shareUrl = stream.id !== 'direct'
    ? `https://tko.cam/watch/${stream.id}${q}`
    : `https://tko.cam/watch${q}`

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto">
      {/* Twitch-style control-room layout: banner (host facecam + team scores +
          dono goal), big stage, gift-sub leaderboard + colored chat on the right. */}
      <LiveControlLayout
        streamId={stream.id}
        youtubeUrl={stream.youtube_url}
        title={stream.title}
        hostId={stream.user_id}
        enableChat={stream.id !== 'direct'}
        headerRight={
          <ShareButton url={shareUrl} title={stream.title ?? 'Live on TKO'} text="Watch this live on TKO" />
        }
      />

      {/* Oracle call — a 30s live prediction on this stream. matchRef is derived
          from the stream id (or the carried video url in direct mode). */}
      {stream.id !== 'direct' && (
        <div className="mt-4">
          <OracleVote matchRef={`live:${stream.id}`} title="Call this match" />
        </div>
      )}

      {/* Ad below the stream — free viewers only (AdSlot self-hides for paid). */}
      <div className="mt-4">
        <AdSlot slotId="reel-bottom" shape="leaderboard" />
      </div>

      <div className="mt-4">
        <Link to="/live" className="text-accent hover:underline text-sm">← Back to all live</Link>
      </div>
    </div>
  )
}

export default LiveWatch
