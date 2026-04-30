import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useFFmpeg, layoutLimits, type ReelLayout } from '@/hooks/useFFmpeg'
import { useEntitlements } from '@/hooks/useEntitlements'
import { detectHighlights, formatTimestamp, type HighlightMoment } from '@/lib/highlightDetector'
import { extractYouTubeId } from '@/lib/youtubeApi'
import { encodeLayoutMarker } from '@/lib/reelLayout'
import { BRAND } from '@/lib/brand'
import { CreationSponsorGate } from '@/components/CreationSponsorGate'
import type { UserYoutubeLink } from '@/types/database'

type ClipInput =
  | { type: 'youtube'; url: string; startSec: number; endSec: number; title?: string }
  | { type: 'upload'; file: File; title?: string }

const LAYOUT_OPTIONS: { id: ReelLayout; name: string; tagline: string; needs: string }[] = [
  { id: 'ultra', name: 'Ultra reel (director cut)', tagline: 'Flows between single, side-by-side, and PiP shots', needs: '2–8 angles · YouTube only' },
  { id: 'action', name: 'Action cam', tagline: 'One screen, auto-switches between angles', needs: '2–8 angles · YouTube only' },
  { id: 'concat', name: 'Highlight reel', tagline: 'Stitch clips end-to-end', needs: '2–8 clips' },
  { id: 'grid', name: 'Squad view (2x2)', tagline: 'Same fight, 4 perspectives', needs: 'Exactly 4 clips' },
  { id: 'side-by-side', name: 'Side-by-side', tagline: 'Compare two angles', needs: 'Exactly 2 clips' },
  { id: 'pip', name: 'Picture-in-picture', tagline: 'Main angle + small overlay', needs: 'Exactly 2 clips (1st = main)' },
]

/** One-tap starting points when “Simple” mode is on. */
const SIMPLE_PRESETS: { id: ReelLayout; label: string; sub: string }[] = [
  { id: 'concat', label: 'Quick', sub: 'Stitch clips' },
  { id: 'action', label: 'Action', sub: 'One screen' },
  { id: 'ultra', label: 'Ultra', sub: 'Director cut' },
]

function creationAdRequiredSec(): number {
  const v = import.meta.env.VITE_CREATION_AD_SECONDS
  if (v === '' || v === undefined) return 30
  return Math.max(0, Number(v) || 0)
}

export function CreateHighlight() {
  const { user } = useAuth()
  const { isPremium } = useEntitlements()
  const navigate = useNavigate()
  const { runLayout, loading: ffmpegLoading, progress, stage } = useFFmpeg()

  const [layout, setLayout] = useState<ReelLayout>('concat')
  const [title, setTitle] = useState('')
  const [clips, setClips] = useState<ClipInput[]>([])
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [youtubeStart, setYoutubeStart] = useState('')
  const [youtubeEnd, setYoutubeEnd] = useState('')
  const [savedLinks, setSavedLinks] = useState<UserYoutubeLink[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [sponsorUnlocked, setSponsorUnlocked] = useState(false)
  const onSponsorUnlocked = useCallback(() => setSponsorUnlocked(true), [])

  const adWaitSec = creationAdRequiredSec()
  const needsSponsorAd = !isPremium && adWaitSec > 0

  // Friend invite mode: when on, the reel saves "locked" until at least
  // `inviteSlots` total clips exist. Friends contribute via the share link
  // on the reel detail page (clips tagged with [for:<reelId>] in title).
  const [inviteFriends, setInviteFriends] = useState(false)
  const [inviteSlots, setInviteSlots] = useState<number>(4)

  const [aiAnalyzing, setAiAnalyzing] = useState<number | null>(null)
  const [suggestionsByIdx, setSuggestionsByIdx] = useState<Record<number, HighlightMoment[]>>({})

  const limits = layoutLimits(layout)
  // 'concat', 'action', and 'ultra' all accept a range of clip counts; the
  // rest are fixed-arity multi-angle layouts.
  const isFixedArity = layout !== 'concat' && layout !== 'action' && layout !== 'ultra'

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
    if (clips.length >= limits.max) {
      setError(`This layout fits ${limits.max} clips max.`)
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

  function addFileClip(files: FileList | null) {
    if (!files?.length) return
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (!f.type.startsWith('video/')) continue
      if (clips.length + 1 > limits.max) {
        setError(`This layout fits ${limits.max} clips max.`)
        break
      }
      setClips((c) => [...c, { type: 'upload', file: f }])
    }
  }

  function removeClip(i: number) {
    setClips((c) => c.filter((_, j) => j !== i))
    setSuggestionsByIdx((prev) => {
      const next: Record<number, HighlightMoment[]> = {}
      Object.entries(prev).forEach(([k, v]) => {
        const idx = Number(k)
        if (idx === i) return
        next[idx > i ? idx - 1 : idx] = v
      })
      return next
    })
  }

  async function analyzeClip(i: number) {
    const c = clips[i]
    if (!c || c.type !== 'upload') return
    setAiAnalyzing(i)
    try {
      const moments = await detectHighlights(c.file)
      setSuggestionsByIdx((prev) => ({ ...prev, [i]: moments }))
    } finally {
      setAiAnalyzing(null)
    }
  }

  // Layout switch: clear clips so we don't carry over wrong counts/types.
  function changeLayout(next: ReelLayout) {
    setLayout(next)
    setClips([])
    setSuggestionsByIdx({})
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (needsSponsorAd && !sponsorUnlocked) {
      setError('Finish the sponsor message above, or go Pro to skip it.')
      return
    }
    if (!title.trim()) {
      setError('Enter a title')
      return
    }

    const uploadClips = clips.filter((c): c is ClipInput & { type: 'upload' } => c.type === 'upload')
    const youtubeClips = clips.filter((c): c is ClipInput & { type: 'youtube' } => c.type === 'youtube')
    const allYoutube = uploadClips.length === 0 && youtubeClips.length > 0
    const allUpload = youtubeClips.length === 0 && uploadClips.length > 0

    if (!allYoutube && !allUpload) {
      setError('Mix detected. Use either all YouTube links OR all uploaded files for one reel.')
      return
    }

    // When inviting friends, the creator can save with FEWER clips than
    // the layout's normal minimum — the rest get filled in by friends via
    // the share link. We still require at least 1 clip from the creator
    // so the reel has something to anchor to (and so we can fetch the
    // first heatmap immediately).
    const minRequiredNow = inviteFriends ? 1 : limits.min

    if (inviteFriends) {
      if (inviteSlots < 2) {
        setError('Invite mode needs at least 2 total slots.')
        return
      }
      if (inviteSlots > limits.max) {
        setError(`${LAYOUT_OPTIONS.find((l) => l.id === layout)?.name} fits ${limits.max} clips max.`)
        return
      }
      if (clips.length < 1) {
        setError('Add at least one clip yourself before inviting friends.')
        return
      }
      if (clips.length > inviteSlots) {
        setError(`You added more clips (${clips.length}) than invited slots (${inviteSlots}).`)
        return
      }
    } else if (isFixedArity && clips.length !== limits.min) {
      setError(`${LAYOUT_OPTIONS.find((l) => l.id === layout)?.name} needs exactly ${limits.min} clips.`)
      return
    } else if (!isFixedArity && (clips.length < minRequiredNow || clips.length > limits.max)) {
      const name = LAYOUT_OPTIONS.find((l) => l.id === layout)?.name ?? 'This layout'
      setError(`${name} needs ${limits.min}–${limits.max} clips.`)
      return
    }
    if (layout === 'action' && !allYoutube) {
      setError('Action cam currently runs on YouTube angles. Stick to YouTube links for this layout.')
      return
    }
    if (layout === 'ultra' && !allYoutube) {
      setError('Ultra reels currently run on YouTube angles. Stick to YouTube links for this layout.')
      return
    }

    setSaving(true)

    try {
      let combinedUrl: string | null = null

      // Only render via ffmpeg.wasm when the user uploaded files. YouTube reels stay free.
      if (allUpload) {
        const blob = await runLayout(layout, uploadClips.map((c) => c.file))
        if (!blob) {
          setError('Render failed. The total file size may exceed 200 MB, or one of the clips is in an unsupported codec.')
          setSaving(false)
          return
        }
        const path = `${user!.id}/${crypto.randomUUID()}.mp4`
        const { error: uploadErr } = await supabase.storage.from('videos').upload(path, blob, {
          contentType: 'video/mp4',
          upsert: false,
        })
        if (uploadErr) throw uploadErr
        const { data: urlData } = supabase.storage.from('videos').getPublicUrl(path)
        combinedUrl = urlData.publicUrl
      } else if (allYoutube && (layout !== 'concat' || inviteFriends)) {
        // YouTube multi-angle OR pending invites: no MP4 to upload — encode
        // layout (and optional invite slot count) into the URL column so we
        // don't depend on the (yet-to-apply) `reels.layout` column.
        combinedUrl = encodeLayoutMarker(layout, inviteFriends ? { slots: inviteSlots } : undefined)
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

      // NOTE: we deliberately don't send `layout` here. Until migration 009 is
      // applied, that column doesn't exist and PostgREST would 400. The
      // resolveLayout() helper recovers layout from combined_video_url.
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

  const uploadCount = clips.filter((c) => c.type === 'upload').length
  const youtubeCount = clips.filter((c) => c.type === 'youtube').length
  const hasMix = uploadCount > 0 && youtubeCount > 0

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Build a reel</h1>
          <p className="text-sm text-gray-500 mt-1">{BRAND.tagline}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowAdvanced((v) => {
              const next = !v
              if (next === false) setInviteFriends(false)
              return next
            })
          }}
          className="shrink-0 px-3 py-1.5 rounded-lg border border-dark-border text-sm text-gray-300 hover:border-accent/40"
        >
          {showAdvanced ? 'Simple' : 'Advanced options'}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
            placeholder="4-stack clutch, all angles"
          />
        </div>

        {!showAdvanced ? (
          <div>
            <label className="block text-sm text-gray-400 mb-2">Reel type</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {SIMPLE_PRESETS.map((p) => {
                const active = layout === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => changeLayout(p.id)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      active
                        ? 'border-accent bg-accent/10'
                        : 'border-dark-border bg-dark-card hover:border-accent/40'
                    }`}
                  >
                    <div className="font-medium">{p.label}</div>
                    <div className="text-sm text-gray-500">{p.sub}</div>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-gray-500 mt-2">YouTube links first — we sync angles in the browser. Advanced has every layout, invites, and file uploads.</p>
          </div>
        ) : (
          <div>
            <label className="block text-sm text-gray-400 mb-2">All layouts</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {LAYOUT_OPTIONS.map((opt) => {
                const active = layout === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => changeLayout(opt.id)}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      active
                        ? 'border-accent bg-accent/10'
                        : 'border-dark-border bg-dark-card hover:border-accent/40'
                    }`}
                  >
                    <div className="font-medium">{opt.name}</div>
                    <div className="text-sm text-gray-400">{opt.tagline}</div>
                    <div className="text-xs text-gray-500 mt-1">{opt.needs}</div>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-gray-500 mt-2">YouTube: synced playback. File uploads: rendered in your browser (200 MB cap).</p>
          </div>
        )}

        {showAdvanced && (
          <div className="rounded-lg border border-dark-border bg-dark-card p-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={inviteFriends}
                onChange={(e) => setInviteFriends(e.target.checked)}
                className="w-4 h-4 accent-accent"
              />
              <span className="font-medium">Invite friends to upload their angle</span>
            </label>
            <p className="text-xs text-gray-500 mt-1 ml-6">
              Share the reel link on social; the reel stays locked until every slot is filled. Great for clans
              and tournament squads.
            </p>
            {inviteFriends && (
              <div className="mt-3 ml-6 flex items-center gap-3 flex-wrap">
                <label className="text-sm text-gray-300">
                  Total angles needed:
                  <input
                    type="number"
                    min={2}
                    max={layoutLimits(layout).max}
                    value={inviteSlots}
                    onChange={(e) => setInviteSlots(Math.max(2, Math.min(layoutLimits(layout).max, Number(e.target.value) || 2)))}
                    className="ml-2 w-20 px-2 py-1 rounded bg-dark border border-dark-border text-white"
                  />
                </label>
                <span className="text-xs text-gray-500">
                  You: {clips.length} · Friends: {Math.max(0, inviteSlots - clips.length)} pending
                </span>
              </div>
            )}
          </div>
        )}

        {showAdvanced && (
          <div className="rounded-lg border border-chakra/25 bg-dark-card/60 p-4">
            <p className="text-sm font-medium text-white">Paid add-ons (connecting at launch)</p>
            <p className="text-sm text-gray-500 mt-1">
              <strong className="text-chakra/90">AI play-by-play from ~$0.99</strong> — full voice commentary, tighter
              “clutch / kill window” selection, and optional music bed. We’ll also route paid YouTube or Twitch restreams
              through a similar checkout when the desktop app drops.
            </p>
            <p className="text-xs text-gray-600 mt-2">This web build keeps multi-angle; billing and cloud renders ship next.</p>
          </div>
        )}

        {savedLinks.length > 0 && (
          <div>
            <label className="block text-sm text-gray-400 mb-2">From my saved YouTube links</label>
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
            {showAdvanced && (
              <>
                <input
                  type="number"
                  value={youtubeStart}
                  onChange={(e) => setYoutubeStart(e.target.value)}
                  placeholder="Start s"
                  className="w-20 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
                />
                <input
                  type="number"
                  value={youtubeEnd}
                  onChange={(e) => setYoutubeEnd(e.target.value)}
                  placeholder="End s"
                  className="w-20 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
                />
              </>
            )}
            <button
              type="button"
              onClick={() => addYoutubeClip(youtubeUrl)}
              className="px-4 py-2 rounded-lg border border-accent text-accent hover:bg-accent/10"
            >
              Add
            </button>
          </div>
          {showAdvanced ? (
            <p className="text-xs text-gray-500 mt-1">Start/End in seconds. Trims per clip on every layout.</p>
          ) : (
            <p className="text-xs text-gray-500 mt-1">Full video per link. Trims: open Advanced options.</p>
          )}
        </div>

        {showAdvanced && (
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Or upload files ({uploadCount} added — {isFixedArity ? `exactly ${limits.min}` : `${limits.min}–${limits.max}`} in upload mode)
            </label>
            <input
              type="file"
              accept="video/*"
              multiple
              onChange={(e) => addFileClip(e.target.files)}
              className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-accent file:text-dark file:font-semibold"
            />
            <p className="text-xs text-gray-500 mt-1">
              Browser only — 200 MB total. MP4 H.264 is best. Big files: upload to your YouTube, then link here. Connect
              your channel when we add OAuth to pull <em>only</em> your uploads (coming soon in desktop).
            </p>
          </div>
        )}

        {clips.length > 0 && (
          <div>
            <label className="block text-sm text-gray-400 mb-2">Clips ({clips.length})</label>
            {hasMix && (
              <p className="text-xs text-yellow-400 mb-2">
                Mix detected. A reel must be either all YouTube links or all uploaded files. Remove one type before saving.
              </p>
            )}
            <ul className="space-y-2">
              {clips.map((c, i) => (
                <li
                  key={i}
                  className="rounded-lg bg-dark-card border border-dark-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm flex-1 min-w-0">
                      {i === 0 && layout === 'pip' && <span className="text-accent text-xs mr-2">MAIN</span>}
                      {layout === 'action' && <span className="text-accent text-xs mr-2">A{i + 1}</span>}
                      {layout === 'ultra' && <span className="text-accent text-xs mr-2">A{i + 1}</span>}
                      {c.type === 'youtube' ? (
                        <>
                          <span className="text-xs text-gray-500 mr-1">YT</span>
                          {c.url}
                          {c.endSec > 0 && (
                            <span className="text-xs text-gray-500 ml-2">
                              {c.startSec}s–{c.endSec}s
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-gray-500 mr-1">FILE</span>
                          {c.file.name}
                          <span className="text-xs text-gray-500 ml-2">
                            {(c.file.size / 1024 / 1024).toFixed(1)} MB
                          </span>
                        </>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      {c.type === 'upload' && (
                        <button
                          type="button"
                          onClick={() => analyzeClip(i)}
                          disabled={aiAnalyzing === i}
                          className="text-xs px-2 py-1 rounded border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-50"
                          title="Detect big moments via audio (clutch spikes)"
                        >
                          {aiAnalyzing === i ? 'Analyzing…' : 'Find clutch moments'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeClip(i)}
                        className="text-red-400 hover:text-red-300 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {c.type === 'upload' && suggestionsByIdx[i]?.length > 0 && (
                    <div className="mt-2 pl-1">
                      <div className="text-xs text-gray-400 mb-1">
                        {suggestionsByIdx[i].length} action moments detected:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestionsByIdx[i].map((m, mi) => (
                          <span
                            key={mi}
                            className="text-xs px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/20"
                            title={`Intensity ${m.intensity.toFixed(1)}σ above baseline`}
                          >
                            {formatTimestamp(m.startSec)} – {formatTimestamp(m.endSec)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {c.type === 'upload' && suggestionsByIdx[i] && suggestionsByIdx[i].length === 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      No clear action spikes detected — try a clip with louder hits or longer than 3 seconds.
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {ffmpegLoading && (
          <p className="text-accent text-sm">{stage}… {progress}%</p>
        )}

        <CreationSponsorGate isPremium={isPremium} onUnlocked={onSponsorUnlocked} />

        <button
          type="submit"
          disabled={saving || ffmpegLoading || clips.length === 0 || hasMix || (needsSponsorAd && !sponsorUnlocked)}
          className="w-full py-3 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
        >
          {saving ? 'Saving…' : ffmpegLoading ? 'Rendering…' : 'Create reel'}
        </button>
      </form>
    </div>
  )
}
