import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { ShareButton } from '@/components/ShareButton'
import { canonicalShareUrl } from '@/lib/canonicalUrl'
import { OracleLivePanel } from '@/components/OracleLivePanel'
import { AdSlot } from '@/components/AdSlot'
import { LiveControlLayout } from '@/components/LiveControlLayout'
import { TournamentBracket } from '@/components/TournamentBracket'
import type { LayoutPreset } from '@/components/LiveControlLayout'
import { useAuth } from '@/hooks/useAuth'

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
type StreamRow = {
  id: string
  youtube_url: string
  title: string | null
  user_id?: string
  tournament_id?: string | null
  show_bracket?: boolean | null
  background_url?: string | null
  /** Stored placement preset from the go-live setup (feature: layout presets). */
  layout?: LayoutPreset | null
}

/**
 * CollapsibleOracle keeps the optional Oracle call behind a small slide tab. It
 * starts closed so a healthy stream never opens with an optional Oracle network
 * error. The panel mounts only after the viewer opens it, and that choice is
 * remembered per stream for the session.
 */
export function CollapsibleOracle({ streamId, hostControls = false, children }: { streamId: string; hostControls?: boolean; children: React.ReactNode }) {
  const key = `tko_oracle_open:${streamId}`
  const [open, setOpen] = useState<boolean>(() => {
    try { return sessionStorage.getItem(key) === '1' } catch { return false }
  })
  function toggle() {
    setOpen((o) => {
      const next = !o
      try { sessionStorage.setItem(key, next ? '1' : '0') } catch { /* best-effort */ }
      return next
    })
  }
  return (
    <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-purple-200 hover:bg-purple-500/10"
      >
        <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Oracle
        <span className="ml-auto text-[10px] font-medium text-purple-300/70">
          {hostControls ? `Host controls - ${open ? 'Hide' : 'Show'}` : open ? 'Tap to hide' : 'Tap to call it'}
        </span>
      </button>
      {open && <div className="border-t border-purple-500/20 p-2">{children}</div>}
    </div>
  )
}

export function LiveWatch() {
  const { user } = useAuth()
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
    ? canonicalShareUrl(`/watch/${stream.id}${q}`)
    : canonicalShareUrl(`/watch${q}`)

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto">
      {/* Twitch-style control-room layout: banner (host facecam + team scores +
          dono goal), big stage, gift-sub leaderboard + colored chat on the right. */}
      <LiveControlLayout
        streamId={stream.id}
        youtubeUrl={stream.youtube_url}
        title={stream.title}
        backgroundUrl={stream.background_url}
        hostId={stream.user_id}
        enableChat={stream.id !== 'direct'}
        layout={stream.layout ?? 'auto'}
        headerRight={
          <ShareButton url={shareUrl} title={stream.title ?? 'Live on TKO'} text="Watch this live on TKO" />
        }
        underStage={
          // Oracle call — a 30s LIVE prediction, mounted directly under the
          // gameplay stage (not the page bottom). Only on a real live stream
          // (never a direct/pre-recorded URL); the viewer can slide it closed.
          stream.id !== 'direct' ? (
            <div className="space-y-2">
              {stream.show_bracket && stream.tournament_id && (
                <details className="overflow-hidden rounded-md border border-accent/30 bg-accent/5" open>
                  <summary className="cursor-pointer px-3 py-2 text-xs font-bold uppercase tracking-wider text-accent">
                    Live tournament bracket
                  </summary>
                  <div className="border-t border-accent/20 p-3">
                    <TournamentBracket tournamentId={stream.tournament_id} compact />
                  </div>
                </details>
              )}
              <CollapsibleOracle streamId={stream.id} hostControls={!!user && user.id === stream.user_id}>
                <OracleLivePanel streamId={stream.id} />
              </CollapsibleOracle>
            </div>
          ) : null
        }
      />

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
