import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Reel, Clip } from '@/types/database'

export function ReelDetail() {
  const { id } = useParams()
  const [reel, setReel] = useState<(Reel & { profiles?: { username: string } }) | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    async function fetch() {
      const { data: reelData } = await supabase
        .from('reels')
        .select('*, profiles(username, power_level)')
        .eq('id', id)
        .single()
      setReel(reelData)
      if (reelData?.clip_ids?.length) {
        const { data: clipsData } = await supabase.from('clips').select('*').in('id', reelData.clip_ids)
        setClips(clipsData ?? [])
      }
      setLoading(false)
    }
    fetch()
  }, [id])

  if (loading || !reel) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading...</div>
      </div>
    )
  }

  const youtubeClips = clips.filter((c) => c.source_type === 'youtube')
  const uploadClips = clips.filter((c) => c.source_type === 'upload')

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
        <div className="aspect-video bg-dark">
          {reel.combined_video_url ? (
            <video src={reel.combined_video_url} controls className="w-full h-full" />
          ) : youtubeClips.length > 0 ? (
            <div className="w-full h-full p-4 overflow-auto space-y-4">
              {youtubeClips.map((clip) => (
                <YouTubeEmbed key={clip.id} clip={clip} />
              ))}
            </div>
          ) : uploadClips.length > 0 ? (
            <video src={uploadClips[0].url_or_path} controls className="w-full h-full" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500">
              <p>No clips.</p>
            </div>
          )}
        </div>
        <div className="p-6">
          <h1 className="text-2xl font-bold">{reel.title}</h1>
          <p className="text-gray-400 mt-2">
            by <Link to={`/profile/${reel.user_id}`} className="text-accent hover:underline">{reel.profiles?.username ?? 'Unknown'}</Link>
            {(reel.profiles as { power_level?: number })?.power_level != null && (reel.profiles as { power_level?: number }).power_level! > 0 && (
              <> · PL {(reel.profiles as { power_level?: number }).power_level}</>
            )}
            {' • '}{reel.clip_ids?.length ?? 0} clips
          </p>
        </div>
      </div>
      <Link to="/reels" className="inline-block mt-6 text-accent hover:underline">← Back to Reels</Link>
    </div>
  )
}

function YouTubeEmbed({ clip }: { clip: Clip }) {
  const videoId = clip.url_or_path.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] ?? clip.url_or_path
  const start = clip.start_sec ?? 0
  const end = clip.end_sec ? `&end=${clip.end_sec}` : ''
  const src = `https://www.youtube.com/embed/${videoId}?start=${start}${end}`

  return (
    <div className="aspect-video rounded-lg overflow-hidden border border-dark-border">
      <iframe
        src={src}
        title={clip.title ?? 'Clip'}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="w-full h-full"
      />
    </div>
  )
}
