import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { extractYouTubeId, CLEAN_EMBED_PARAMS } from '@/lib/youtubeApi'
import { StreamChat } from '@/components/StreamChat'
import { CroppedFrame, TkoWatermark } from '@/components/CroppedFrame'

/**
 * ProgramView — the clean broadcast OUTPUT the host screen-records or points OBS
 * at. NO app sidebar, NO host buttons, NO PowerBar chrome — just the composed
 * show on a black background, plus a compact live chat for the focused feed.
 *
 * It reads `live_streams` exactly like LiveNowStrip / Live (select('*'), keep
 * rows where `is_live !== false`, map the URL via extractYouTubeId). Only the
 * focused (or first) feed carries audio; every other feed is muted so the
 * capture has no echo/feedback. Layout is driven by `?layout=` (1 | 4 | 8,
 * default 4). `program/:groupId` scopes the feeds to a live group's members.
 *
 * Full-bleed via `fixed inset-0 z-50`, so it covers the surrounding Layout
 * chrome even though it still mounts inside the normal <Layout> route.
 */

type Feed = { id: string; title: string; videoId: string }

// Autoplay requires mute=1 (browser policy); the one unmuted feed only starts
// with sound after a user gesture, which is exactly the click that toggles it —
// so we rebuild the src (and key) whenever a feed's mute state changes.
function embedSrc(videoId: string, unmuted: boolean): string {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=${unmuted ? 0 : 1}&${CLEAN_EMBED_PARAMS}`
}

export function ProgramView() {
  const { groupId } = useParams()
  const [params] = useSearchParams()
  const layout: 1 | 4 | 8 = (() => {
    const l = Number(params.get('layout'))
    return l === 1 || l === 8 ? l : 4
  })()

  const [feeds, setFeeds] = useState<Feed[]>([])
  const [focused, setFocused] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Optional group scoping: restrict to the stream_ids linked in this group.
      let allowedIds: string[] | null = null
      if (groupId) {
        const { data: members } = await supabase
          .from('live_group_members')
          .select('stream_id')
          .eq('group_id', groupId)
        allowedIds = (members ?? [])
          .map((m) => m.stream_id)
          .filter((id): id is string => Boolean(id))
      }

      const { data } = await supabase
        .from('live_streams')
        .select('*')
        .order('created_at', { ascending: false })

      const rows = (data ?? []) as Array<{
        id: string
        youtube_url?: string | null
        url?: string | null
        title?: string | null
        is_live?: boolean
      }>

      const mapped = rows
        .filter((r) => r.is_live !== false) // treat undefined/true as live
        .filter((r) => !allowedIds || allowedIds.includes(r.id))
        .map((r) => {
          const raw = r.youtube_url ?? r.url ?? ''
          return { id: r.id, title: r.title ?? 'Stream', videoId: extractYouTubeId(raw) ?? '' }
        })
        .filter((f) => f.videoId)

      if (!cancelled) setFeeds(mapped)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [groupId])

  const shown = feeds.slice(0, layout)
  const focusedFeed = shown[focused] ?? shown[0]

  const gridClass =
    layout === 1
      ? 'grid-cols-1'
      : layout === 8
        ? 'grid-cols-2 sm:grid-cols-4'
        : 'grid-cols-1 sm:grid-cols-2'

  return (
    <div className="fixed inset-0 z-[100] bg-black text-white flex">
      <div className="relative flex-1 min-w-0">
        {shown.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
            <div>
              <p className="font-semibold text-white">No live feeds are available yet</p>
              <p className="mt-1 text-sm text-gray-400">
                Start a stream or choose an active show before opening the program output.
              </p>
            </div>
            <Link to="/live" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-dark">
              Back to Live
            </Link>
          </div>
        ) : (
          <>
            <div className={`grid ${gridClass} auto-rows-fr gap-0.5 h-full`}>
              {shown.map((f, i) => {
                const unmuted = i === focused
                return (
                  <div
                    key={f.id}
                    data-live-feed={f.id}
                    onClick={() => setFocused(i)}
                    className="relative bg-black cursor-pointer overflow-hidden"
                  >
                    {/* Crop out YouTube chrome; the shield lets the click reach the pane for focus. */}
                    <CroppedFrame overscan={1}>
                      <iframe
                        key={`${f.id}-${unmuted}`}
                        src={embedSrc(f.videoId, unmuted)}
                        title={f.title}
                        allow="autoplay; encrypted-media; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full"
                      />
                    </CroppedFrame>
                    <span className="absolute top-1 left-1 z-10 px-1.5 py-0.5 rounded bg-black/70 text-[11px] font-medium pointer-events-none">
                      {f.title} {unmuted ? '🔊' : '🔇'}
                    </span>
                  </div>
                )
              })}
            </div>
            {/* One TKO watermark over the whole program output. */}
            <TkoWatermark />
          </>
        )}
      </div>

      {focusedFeed && (
        <div className="w-[320px] shrink-0 border-l border-white/10 hidden lg:block">
          <StreamChat streamId={focusedFeed.id} title={focusedFeed.title} />
        </div>
      )}
    </div>
  )
}

export default ProgramView
