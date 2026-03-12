import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Match, Reel, Clip } from '@/types/database'

export function MatchDetail() {
  const { id } = useParams()
  const [match, setMatch] = useState<Match | null>(null)
  const [reels, setReels] = useState<Reel[]>([])
  const [clips, setClips] = useState<Clip[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    async function fetch() {
      const { data: matchData } = await supabase.from('matches').select('*').eq('id', id).single()
      setMatch(matchData)
      if (matchData?.reel_ids?.length) {
        const { data: reelsData } = await supabase
          .from('reels')
          .select('*')
          .in('id', matchData.reel_ids)
        setReels(reelsData ?? [])
        const clipIds = (reelsData ?? []).flatMap((r) => r.clip_ids ?? [])
        if (clipIds.length) {
          const { data: clipsData } = await supabase.from('clips').select('*').in('id', clipIds)
          setClips(clipsData ?? [])
        }
      }
      setLoading(false)
    }
    fetch()
  }, [id])

  if (loading || !match) {
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
      <h1 className="text-2xl font-bold mb-2">{match.name}</h1>
      {match.description && <p className="text-gray-400 mb-8">{match.description}</p>}
      {(youtubeClips.length > 0 || uploadClips.length > 0) && (
        <div className="space-y-4 mb-8">
          <h2 className="font-semibold">Clips</h2>
          <div className="grid gap-4">
            {youtubeClips.map((clip) => (
              <YouTubeEmbed key={clip.id} clip={clip} />
            ))}
            {uploadClips.map((clip) => (
              <div key={clip.id} className="aspect-video rounded-lg overflow-hidden border border-dark-border">
                <video src={clip.url_or_path} controls className="w-full h-full" />
              </div>
            ))}
          </div>
        </div>
      )}
      {reels.length > 0 && (
        <div>
          <h2 className="font-semibold mb-4">Reels</h2>
          <div className="space-y-6">
            {reels.map((reel) => (
              <div key={reel.id} className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
                <h3 className="p-4 font-medium">{reel.title}</h3>
                {reel.combined_video_url && (
                  <video src={reel.combined_video_url} controls className="w-full" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <Link to="/matches" className="inline-block mt-8 text-accent hover:underline">← Back to Matches</Link>
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
