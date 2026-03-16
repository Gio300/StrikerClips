import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useFFmpeg } from '@/hooks/useFFmpeg'
import type { UserYoutubeLink } from '@/types/database'

type ClipInput =
  | { type: 'youtube'; url: string; startSec: number; endSec: number; title?: string }
  | { type: 'upload'; file: File; title?: string }

export function CreateHighlight() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { concatVideos, loading: ffmpegLoading, progress } = useFFmpeg()
  const [title, setTitle] = useState('')
  const [clips, setClips] = useState<ClipInput[]>([])
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [youtubeStart, setYoutubeStart] = useState('')
  const [youtubeEnd, setYoutubeEnd] = useState('')
  const [savedLinks, setSavedLinks] = useState<UserYoutubeLink[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase
      .from('user_youtube_links')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setSavedLinks(data ?? []))
  }, [user?.id])

  function addYoutubeClip(url: string) {
    const videoId = extractYouTubeId(url)
    if (!videoId) {
      setError('Invalid YouTube URL')
      return
    }
    const start = parseInt(youtubeStart, 10) || 0
    const end = parseInt(youtubeEnd, 10) || 0
    if (end > 0 && end <= start) {
      setError('End time must be after start time')
      return
    }
    const fullUrl = url.startsWith('http') ? url : `https://www.youtube.com/watch?v=${videoId}`
    setClips((c) => [...c, { type: 'youtube', url: fullUrl, startSec: start, endSec: end || 0 }])
    setYoutubeUrl('')
    setYoutubeStart('')
    setYoutubeEnd('')
    setError('')
  }

  function addYoutubeFromInput() {
    addYoutubeClip(youtubeUrl)
  }

  function addFileClip(files: FileList | null) {
    if (!files?.length) return
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (f.type.startsWith('video/')) {
        setClips((c) => [...c, { type: 'upload', file: f }])
      }
    }
  }

  function removeClip(i: number) {
    setClips((c) => c.filter((_, j) => j !== i))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!title.trim()) {
      setError('Enter a title')
      return
    }
    const uploadClips = clips.filter((c): c is ClipInput & { type: 'upload' } => c.type === 'upload')
    const youtubeClips = clips.filter((c): c is ClipInput & { type: 'youtube' } => c.type === 'youtube')

    if (uploadClips.length > 0 && uploadClips.length < 4) {
      setError('Need 4–8 uploaded clips to combine. Use YouTube clips only for reference-only reels.')
      return
    }
    if (uploadClips.length > 8) {
      setError('Maximum 8 upload clips')
      return
    }

    setSaving(true)

    try {
      let combinedUrl: string | null = null

      if (uploadClips.length >= 4) {
        const blob = await concatVideos(uploadClips.map((c) => c.file))
        if (blob) {
          const path = `${user!.id}/${crypto.randomUUID()}.mp4`
          const { error: uploadErr } = await supabase.storage.from('videos').upload(path, blob, {
            contentType: 'video/mp4',
            upsert: false,
          })
          if (uploadErr) throw uploadErr
          const { data: urlData } = supabase.storage.from('videos').getPublicUrl(path)
          combinedUrl = urlData.publicUrl
        }
      }

      const clipIds: string[] = []

      for (const c of youtubeClips) {
        const { data: clipData } = await supabase
          .from('clips')
          .insert({
            user_id: user!.id,
            source_type: 'youtube',
            url_or_path: c.url,
            start_sec: c.startSec,
            end_sec: c.endSec || null,
            title: c.title,
          })
          .select('id')
          .single()
        if (clipData) clipIds.push(clipData.id)
      }

      for (const c of uploadClips) {
        const path = `${user!.id}/clips/${crypto.randomUUID()}_${c.file.name}`
        const { error: upErr } = await supabase.storage.from('videos').upload(path, c.file, {
          contentType: c.file.type,
          upsert: false,
        })
        if (upErr) throw upErr
        const { data: urlData } = supabase.storage.from('videos').getPublicUrl(path)
        const { data: clipData } = await supabase
          .from('clips')
          .insert({
            user_id: user!.id,
            source_type: 'upload',
            url_or_path: urlData.publicUrl,
            title: c.title,
          })
          .select('id')
          .single()
        if (clipData) clipIds.push(clipData.id)
      }

      const { data: reelData, error: reelErr } = await supabase
        .from('reels')
        .insert({
          user_id: user!.id,
          title: title.trim(),
          clip_ids: clipIds,
          combined_video_url: combinedUrl,
        })
        .select('id')
        .single()

      if (reelErr) throw reelErr
      navigate(`/reels/${reelData.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create highlight')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create Highlight</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
            placeholder="Weekend Match Highlights"
          />
        </div>

        {savedLinks.length > 0 && (
          <div>
            <label className="block text-sm text-gray-400 mb-2">From my saved YouTube links (set start/end below, then click Add)</label>
            <div className="space-y-2">
              {savedLinks.map((link) => (
                <div key={link.id} className="flex items-center gap-2 flex-wrap">
                  <span className="truncate text-sm text-gray-300 flex-1 min-w-0">{link.url}</span>
                  <button
                    type="button"
                    onClick={() => addYoutubeClip(link.url)}
                    className="px-3 py-1 rounded border border-accent text-accent text-sm hover:bg-accent/10"
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm text-gray-400 mb-2">Add YouTube clip (URL)</label>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="flex-1 min-w-[200px] px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
            />
            <input
              type="number"
              value={youtubeStart}
              onChange={(e) => setYoutubeStart(e.target.value)}
              placeholder="Start (sec)"
              className="w-24 px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
            />
            <input
              type="number"
              value={youtubeEnd}
              onChange={(e) => setYoutubeEnd(e.target.value)}
              placeholder="End (sec)"
              className="w-24 px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
            />
            <button type="button" onClick={addYoutubeFromInput} className="px-4 py-2 rounded-lg border border-accent text-accent hover:bg-accent/10">
              Add
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2">Or upload clips (4–8 for combining)</label>
          <input
            type="file"
            accept="video/*"
            multiple
            onChange={(e) => addFileClip(e.target.files)}
            className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-accent file:text-dark file:font-semibold"
          />
        </div>

        {clips.length > 0 && (
          <div>
            <label className="block text-sm text-gray-400 mb-2">Clips ({clips.length})</label>
            <ul className="space-y-2">
              {clips.map((c, i) => (
                <li key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-dark-card border border-dark-border">
                  <span className="truncate text-sm">{c.type === 'youtube' ? c.url : c.file.name}</span>
                  <button type="button" onClick={() => removeClip(i)} className="text-red-400 hover:text-red-300 text-sm">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {ffmpegLoading && <p className="text-accent text-sm">Combining videos... {progress}%</p>}

        <button
          type="submit"
          disabled={saving || ffmpegLoading || clips.length === 0}
          className="w-full py-3 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Create Highlight'}
        </button>
      </form>
    </div>
  )
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  return m ? m[1] : null
}
