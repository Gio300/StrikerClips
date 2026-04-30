import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { ShareButtons } from '@/components/ShareButtons'
import { SyncedYouTubeReel } from '@/components/SyncedYouTubeReel'
import { AdSlot } from '@/components/AdSlot'
import { AutoUploadButton } from '@/components/AutoUploadButton'
import { resolveLayout, resolveSlots, isPlayableUrl, buildInviteTitle, isInviteTitleFor } from '@/lib/reelLayout'
import { extractYouTubeId } from '@/lib/youtubeApi'
import type { Reel, Clip, ReelLayout } from '@/types/database'

export function ReelDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const [reel, setReel] = useState<(Reel & { profiles?: { username: string; power_level?: number } }) | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [inviteClips, setInviteClips] = useState<Clip[]>([])
  const [loading, setLoading] = useState(true)

  // Friend submission form state
  const [submitUrl, setSubmitUrl] = useState('')
  const [submitStart, setSubmitStart] = useState('')
  const [submitEnd, setSubmitEnd] = useState('')
  const [submitErr, setSubmitErr] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!id) return
    async function fetchAll() {
      const { data: reelData } = await supabase
        .from('reels')
        .select('*, profiles(username, power_level)')
        .eq('id', id)
        .single()
      setReel(reelData)

      // 1) Officially-attached clips, in saved order.
      let ordered: Clip[] = []
      if (reelData?.clip_ids?.length) {
        const { data: clipsData } = await supabase.from('clips').select('*').in('id', reelData.clip_ids)
        const byId = new Map((clipsData ?? []).map((c) => [c.id, c]))
        ordered = reelData.clip_ids.map((cid: string) => byId.get(cid)).filter(Boolean) as Clip[]
      }
      setClips(ordered)

      // 2) Friend-submitted clips (tagged via title `[for:<reelId>]`). These
      //    aren't in clip_ids but should be playable once the reel unlocks.
      //    `like` filter pulls anything starting with the tag.
      const { data: invites } = await supabase
        .from('clips')
        .select('*')
        .like('title', `[for:${id}]%`)
        .order('created_at', { ascending: true })
      setInviteClips((invites ?? []).filter((c) => isInviteTitleFor(c.title, id!)))

      setLoading(false)
    }
    fetchAll()
  }, [id])

  if (loading || !reel) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading...</div>
      </div>
    )
  }

  const allClips = [...clips, ...inviteClips]
  const youtubeClips = allClips.filter((c) => c.source_type === 'youtube')
  const uploadClips = allClips.filter((c) => c.source_type === 'upload')
  const layout: ReelLayout = resolveLayout(reel)
  const requiredSlots = resolveSlots(reel)
  const totalCount = allClips.length
  const isLocked = !!requiredSlots && totalCount < requiredSlots
  const isOwner = user?.id === reel.user_id

  // Decide which playback surface to render. Order matters:
  //  1) Locked → invite UI in place of player
  //  2) Pre-rendered combined MP4 (uploads stitched via ffmpeg.wasm)
  //  3) Synced YouTube reel (link-only multi-angle, free)
  //  4) Single uploaded file fallback
  let body: React.ReactNode
  if (isLocked) {
    body = (
      <LockedSurface
        reelId={reel.id}
        creatorName={reel.profiles?.username ?? 'the creator'}
        have={totalCount}
        need={requiredSlots!}
      />
    )
  } else if (isPlayableUrl(reel.combined_video_url)) {
    body = <video src={reel.combined_video_url!} controls className="w-full h-full" />
  } else if (youtubeClips.length > 0) {
    body = <SyncedYouTubeReel layout={layout} clips={youtubeClips} />
  } else if (uploadClips.length > 0) {
    body = <video src={uploadClips[0].url_or_path} controls className="w-full h-full" />
  } else {
    body = (
      <div className="w-full h-full flex items-center justify-center text-gray-500">
        <p>No clips.</p>
      </div>
    )
  }

  // Multi-angle layouts need more vertical room for controls + grid; single-angle stays 16:9.
  // 'action' and 'ultra' have an extra meter HUD + thumbnail strip so they get extra height.
  const surfaceClass = isLocked
    ? 'min-h-[420px]'
    : youtubeClips.length > 0 && (layout === 'action' || layout === 'ultra') ? 'h-[560px]'
    : youtubeClips.length > 0 && layout !== 'concat' ? 'h-[480px]'
    : 'aspect-video'

  async function handleFriendSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitErr('')
    if (!user) {
      setSubmitErr('Sign in to add your clip.')
      return
    }
    const ytId = extractYouTubeId(submitUrl.trim())
    if (!ytId) {
      setSubmitErr('Paste a valid YouTube link.')
      return
    }
    const start = parseInt(submitStart, 10) || 0
    const end = parseInt(submitEnd, 10) || 0
    if (end > 0 && end <= start) {
      setSubmitErr('End time must be after start time.')
      return
    }
    setSubmitting(true)
    try {
      const fullUrl = submitUrl.startsWith('http') ? submitUrl.trim() : `https://www.youtube.com/watch?v=${ytId}`
      const { data: clipData, error: insErr } = await supabase
        .from('clips')
        .insert({
          user_id: user.id,
          source_type: 'youtube',
          url_or_path: fullUrl,
          start_sec: start,
          end_sec: end || null,
          title: buildInviteTitle(reel!.id),
        })
        .select('*')
        .single()
      if (insErr) throw insErr
      if (clipData) setInviteClips((prev) => [...prev, clipData])
      setSubmitUrl('')
      setSubmitStart('')
      setSubmitEnd('')
    } catch (err: unknown) {
      setSubmitErr(err instanceof Error ? err.message : 'Failed to submit clip.')
    } finally {
      setSubmitting(false)
    }
  }

  // Anyone (logged in) can submit a clip while the reel is locked AND fewer
  // clips are present than slots. Once unlocked the form goes away.
  const canSubmit = isLocked && !!user

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Ad above the reel — consistent placement no matter where the link is shared back to. */}
      <div className="mb-4">
        <AdSlot slotId="reel-top" shape="leaderboard" />
      </div>

      <div className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
        <div className={`${surfaceClass} bg-dark`}>
          {body}
        </div>
        <div className="p-6">
          <h1 className="text-2xl font-bold">{reel.title}</h1>
          <p className="text-gray-400 mt-2">
            by <Link to={`/profile/${reel.user_id}`} className="text-accent hover:underline">{reel.profiles?.username ?? 'Unknown'}</Link>
            {reel.profiles?.power_level != null && reel.profiles.power_level > 0 && (
              <> · PL {reel.profiles.power_level}</>
            )}
            {' • '}
            {requiredSlots
              ? <>{totalCount}/{requiredSlots} angles in</>
              : <>{reel.clip_ids?.length ?? 0} clips</>}
            {layout !== 'concat' && <span className="ml-2 text-xs text-accent">· {layoutBadge(layout)}</span>}
            {isLocked && <span className="ml-2 text-xs text-yellow-400">· locked</span>}
          </p>
          <div className="mt-4">
            <ShareButtons title={reel.title} />
          </div>
          {isOwner && !isLocked && reel?.user_id && (
            <div className="mt-4">
              <AutoUploadButton reelId={reel.id} ownerId={reel.user_id} />
            </div>
          )}
        </div>
      </div>

      {/* Friend submission panel — visible while reel is locked. */}
      {isLocked && (
        <div className="mt-5 rounded-xl border border-yellow-400/30 bg-yellow-400/5 p-5">
          <h2 className="text-lg font-semibold mb-1">
            {isOwner ? 'Add another angle' : `${reel.profiles?.username ?? 'The creator'} invited you to drop your angle`}
          </h2>
          <p className="text-sm text-gray-400 mb-4">
            Paste a YouTube link of your perspective. The reel auto-unlocks once {requiredSlots} clips
            are in. Currently: <span className="text-accent">{totalCount}/{requiredSlots}</span>.
          </p>
          {!user ? (
            <Link to="/signup" className="btn-primary inline-flex">Sign in to contribute</Link>
          ) : !canSubmit ? null : (
            <form onSubmit={handleFriendSubmit} className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={submitUrl}
                  onChange={(e) => setSubmitUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className="flex-1 min-w-[220px] px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
                />
                <input
                  type="number"
                  value={submitStart}
                  onChange={(e) => setSubmitStart(e.target.value)}
                  placeholder="Start"
                  className="w-20 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white"
                />
                <input
                  type="number"
                  value={submitEnd}
                  onChange={(e) => setSubmitEnd(e.target.value)}
                  placeholder="End"
                  className="w-20 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold disabled:opacity-50"
                >
                  {submitting ? 'Adding…' : 'Add my angle'}
                </button>
              </div>
              {submitErr && <p className="text-red-400 text-xs">{submitErr}</p>}
              <p className="text-xs text-gray-500">
                Your clip is tagged to this reel automatically — you'll see it in the player as soon as it unlocks.
              </p>
            </form>
          )}
        </div>
      )}

      {/* Ad below the reel — runs on every share view, the monetization "floor". */}
      <div className="mt-6">
        <AdSlot slotId="reel-bottom" shape="banner" />
      </div>

      <Link to="/reels" className="inline-block mt-6 text-accent hover:underline">← Back to Reels</Link>
    </div>
  )
}

function LockedSurface({ reelId, creatorName, have, need }: { reelId: string; creatorName: string; have: number; need: number }) {
  const url = typeof window !== 'undefined' ? window.location.href : `/reels/${reelId}`
  const [copied, setCopied] = useState(false)

  function copyLink() {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }

  const pct = Math.round((have / Math.max(1, need)) * 100)

  return (
    <div className="w-full h-full p-8 flex flex-col items-center justify-center text-center bg-gradient-to-br from-dark to-dark-elevated">
      <div className="text-5xl mb-4">🔒</div>
      <h2 className="text-2xl font-semibold mb-2">Locked until everyone's angle is in</h2>
      <p className="text-sm text-gray-400 max-w-md mb-5">
        {creatorName} started this reel and is waiting on {need - have} more {need - have === 1 ? 'angle' : 'angles'}.
        Share the link — once {need} angles are uploaded, the team reel goes live.
      </p>

      {/* Progress bar */}
      <div className="w-full max-w-md mb-3">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>{have} of {need} angles in</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 bg-dark-border rounded-full overflow-hidden">
          <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex items-center gap-2 max-w-md w-full">
        <input
          type="text"
          readOnly
          value={url}
          className="flex-1 px-3 py-2 rounded-lg bg-dark border border-dark-border text-gray-300 text-sm font-mono"
        />
        <button
          type="button"
          onClick={copyLink}
          className="px-4 py-2 rounded-lg bg-accent text-dark text-sm font-semibold hover:shadow-glow"
        >
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
    </div>
  )
}

function layoutBadge(layout: ReelLayout): string {
  switch (layout) {
    case 'grid': return '2x2 squad view'
    case 'side-by-side': return 'side-by-side'
    case 'pip': return 'picture-in-picture'
    case 'action': return 'action cam'
    case 'ultra': return 'ultra · director cut'
    default: return ''
  }
}
