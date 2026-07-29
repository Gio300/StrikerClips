import { useCallback, useEffect, useState } from 'react'
import { CameraOff, Clock3, History, Radio, UsersRound } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { hostSourceLabel, latestHostVersion } from '@/lib/hostCommentary'
import { isPlayableUrl } from '@/lib/reelLayout'
import { supabase } from '@/lib/supabase'
import type {
  Clip,
  HostCommentary,
  Match,
  MatchAngleRow,
  MatchGroupRow,
  MatchVersionRow,
  Reel,
  RenderJobRow,
} from '@/types/database'

type AutoMatchView = {
  group: MatchGroupRow
  job: RenderJobRow | null
  versions: MatchVersionRow[]
  angles: MatchAngleRow[]
  isLive: boolean
}

export function MatchDetail() {
  const { id } = useParams()
  const [match, setMatch] = useState<Match | null>(null)
  const [autoMatch, setAutoMatch] = useState<AutoMatchView | null>(null)
  const [reels, setReels] = useState<Reel[]>([])
  const [clips, setClips] = useState<Clip[]>([])
  const [loading, setLoading] = useState(true)
  const [hostVersion, setHostVersion] = useState<HostCommentary | null>(null)
  const [withHost, setWithHost] = useState(false)

  const fetchMatch = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const { data: matchData } = await supabase.from('matches').select('*').eq('id', id).maybeSingle()
    setMatch(matchData)

    if (matchData) {
      setAutoMatch(null)
      setHostVersion(await latestHostVersion(id))
      if (matchData.reel_ids?.length) {
        const { data: reelsData } = await supabase.from('reels').select('*').in('id', matchData.reel_ids)
        const nextReels = reelsData ?? []
        setReels(nextReels)
        const clipIds = nextReels.flatMap((reel) => reel.clip_ids ?? [])
        if (clipIds.length) {
          const { data: clipsData } = await supabase.from('clips').select('*').in('id', clipIds)
          setClips(clipsData ?? [])
        } else {
          setClips([])
        }
      } else {
        setReels([])
        setClips([])
      }
      setLoading(false)
      return
    }

    const { data: group } = await supabase.from('match_groups').select('*').eq('id', id).maybeSingle()
    if (!group) {
      setAutoMatch(null)
      setLoading(false)
      return
    }
    const [jobResult, versionResult, angleResult, liveResult] = await Promise.all([
      supabase.from('render_jobs').select('*').eq('match_id', id).maybeSingle(),
      supabase.from('match_versions').select('*').eq('match_key', id).order('version', { ascending: false }),
      supabase.from('match_angles').select('*').eq('match_key', id),
      supabase.from('live_sessions').select('id').eq('match_id', id).eq('status', 'live').limit(1),
    ])
    setAutoMatch({
      group,
      job: jobResult.data,
      versions: versionResult.data ?? [],
      angles: angleResult.data ?? [],
      isLive: (liveResult.data?.length ?? 0) > 0,
    })
    setReels([])
    setClips([])
    setHostVersion(null)
    setLoading(false)
  }, [id])

  useEffect(() => {
    void fetchMatch()
  }, [fetchMatch])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-pulse text-accent">Loading...</div>
      </div>
    )
  }

  if (!match && autoMatch) {
    return <AutoMatchDetail value={autoMatch} onRefresh={fetchMatch} />
  }

  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-8 py-20 text-center">
        <p className="text-gray-300">This match is not available.</p>
        <Link to="/matches" className="rounded-md bg-accent px-4 py-2 font-semibold text-dark">
          Back to matches
        </Link>
      </div>
    )
  }

  const youtubeClips = clips.filter((clip) => clip.source_type === 'youtube')
  const uploadClips = clips.filter((clip) => clip.source_type === 'upload')

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <h1 className="mb-2 text-2xl font-bold">{match.name}</h1>
      {match.description && <p className="mb-4 text-gray-400">{match.description}</p>}

      {hostVersion && (
        <div className="mb-8 rounded-lg border border-dark-border bg-dark-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Version</span>
            <span className="text-xs text-gray-500">Choose how you watch</span>
          </div>
          <div className="inline-flex overflow-hidden rounded-md border border-dark-border">
            <button
              type="button"
              onClick={() => setWithHost(false)}
              className={`px-3 py-1.5 text-sm font-medium ${
                !withHost ? 'bg-accent text-dark' : 'bg-dark text-gray-300'
              }`}
            >
              Without host
            </button>
            <button
              type="button"
              onClick={() => setWithHost(true)}
              className={`px-3 py-1.5 text-sm font-medium ${
                withHost ? 'bg-accent text-dark' : 'bg-dark text-gray-300'
              }`}
            >
              With host
            </button>
          </div>
          {withHost && (
            <div className="mt-3">
              <p className="mb-2 text-xs text-gray-400">
                Hosted commentary · {hostSourceLabel(hostVersion.capture_source)}
                {hostVersion.title ? ` · ${hostVersion.title}` : ''}
              </p>
              {isPlayableUrl(hostVersion.commentary_url) ? (
                <video
                  src={hostVersion.commentary_url!}
                  controls
                  className="w-full rounded-lg border border-dark-border"
                />
              ) : (
                <p className="text-xs text-gray-500">The hosted track has not been linked yet.</p>
              )}
            </div>
          )}
        </div>
      )}

      {(youtubeClips.length > 0 || uploadClips.length > 0) && (
        <div className="mb-8 space-y-4">
          <h2 className="font-semibold">Clips</h2>
          <div className="grid gap-4">
            {youtubeClips.map((clip) => <YouTubeEmbed key={clip.id} clip={clip} />)}
            {uploadClips.map((clip) => (
              <div key={clip.id} className="aspect-video overflow-hidden rounded-lg border border-dark-border">
                <video src={clip.url_or_path} controls className="h-full w-full" />
              </div>
            ))}
          </div>
        </div>
      )}

      {reels.length > 0 && (
        <div>
          <h2 className="mb-4 font-semibold">Reels</h2>
          <div className="space-y-6">
            {reels.map((reel) => (
              <div key={reel.id} className="overflow-hidden rounded-lg border border-dark-border bg-dark-card">
                <h3 className="p-4 font-medium">{reel.title}</h3>
                {isPlayableUrl(reel.combined_video_url) && (
                  <video src={reel.combined_video_url!} controls className="w-full" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <Link to="/matches" className="mt-8 inline-block text-accent hover:underline">Back to matches</Link>
    </div>
  )
}

function AutoMatchDetail({
  value,
  onRefresh,
}: {
  value: AutoMatchView
  onRefresh: () => Promise<void>
}) {
  const { user } = useAuth()
  const [removing, setRemoving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const currentAngle = value.angles.find(
    (angle) => angle.user_id === user?.id && angle.status === 'active',
  )
  const removedAngle = value.angles.find(
    (angle) => angle.user_id === user?.id && angle.status === 'removed',
  )
  const angleCount = value.job?.participant_ids?.length
    ?? value.angles.filter((angle) => angle.status === 'active').length
  const currentYoutubeId = value.job?.youtube_id
  const statusLabel = value.isLive
    ? 'Live now'
    : value.job?.status === 'done' && currentYoutubeId
      ? 'Current version ready'
      : value.job?.status === 'rendering' || value.job?.status === 'uploading'
        ? 'Building current version'
        : 'Collecting and syncing cameras'

  const removeCamera = async () => {
    if (!currentAngle || value.isLive || removing) return
    const confirmed = window.confirm(
      'Remove your camera from the current recorded game? TKO will keep the earlier public upload in version history and rebuild the current version without your angle.',
    )
    if (!confirmed) return
    setRemoving(true)
    setError('')
    setNotice('')
    const { data, error: fnError } = await supabase.functions.invoke('remove-match-angle', {
      body: { matchId: value.group.id, reason: 'player requested removal in app' },
    })
    if (fnError || data?.ok === false) {
      setError(data?.error || fnError?.message || 'Camera removal failed.')
    } else {
      setNotice(
        data?.rerenderQueued
          ? 'Your camera is removed. TKO is building the reduced-angle version.'
          : 'Your camera is removed from the current game.',
      )
      await onRefresh()
    }
    setRemoving(false)
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">TKO multi-angle game</p>
          <h1 className="mt-1 text-2xl font-bold">
            {value.group.map || value.group.mode || 'Synchronized match'}
          </h1>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-dark-border bg-dark-card px-2.5 py-1.5 text-xs text-gray-300">
          {value.isLive ? <Radio size={14} className="text-red-400" /> : <Clock3 size={14} />}
          {statusLabel}
        </span>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-dark-border bg-dark-border">
        <div className="bg-dark-card p-4">
          <UsersRound size={18} className="mb-2 text-accent" />
          <div className="text-2xl font-semibold text-white">{angleCount}</div>
          <div className="text-xs text-gray-400">Current cameras</div>
        </div>
        <div className="bg-dark-card p-4">
          <History size={18} className="mb-2 text-orange-400" />
          <div className="text-2xl font-semibold text-white">{value.versions.length}</div>
          <div className="text-xs text-gray-400">Saved versions</div>
        </div>
      </div>

      {currentYoutubeId ? (
        <div className="mb-5 aspect-video overflow-hidden rounded-lg border border-dark-border bg-black">
          <iframe
            src={`https://www.youtube.com/embed/${currentYoutubeId}`}
            title="Current TKO multi-angle game"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
      ) : (
        <div className="mb-5 rounded-lg border border-dark-border bg-dark-card px-4 py-6 text-sm text-gray-300">
          {statusLabel}. This page updates when the current version is ready.
        </div>
      )}

      {currentAngle && (
        <div className="mb-5 rounded-lg border border-dark-border bg-dark-card p-4">
          <div className="font-semibold text-white">You are tagged in this recorded game.</div>
          <p className="mt-1 text-xs leading-5 text-gray-400">
            You can remove your camera from the current TKO version. Earlier public uploads remain in
            version history; live broadcasts cannot be edited.
          </p>
          <button
            type="button"
            disabled={removing || value.isLive}
            onClick={() => void removeCamera()}
            className="mt-3 inline-flex items-center gap-2 rounded-md border border-red-400/40 px-3 py-2 text-sm font-semibold text-red-300 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CameraOff size={16} aria-hidden="true" />
            {value.isLive ? 'Camera locked while live' : removing ? 'Removing...' : 'Remove my camera'}
          </button>
        </div>
      )}

      {removedAngle && (
        <div className="mb-5 rounded-lg border border-leaf/30 bg-leaf/10 p-4 text-sm text-leaf">
          Your camera is removed from the current version.
        </div>
      )}
      {notice && <p className="mb-4 text-sm text-leaf">{notice}</p>}
      {error && <p className="mb-4 text-sm text-red-300">{error}</p>}

      {value.versions.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-white">Version history</h2>
          <div className="divide-y divide-dark-border overflow-hidden rounded-lg border border-dark-border">
            {value.versions.map((version) => (
              <div key={version.id} className="flex items-center gap-3 bg-dark-card px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white">Version {version.version}</div>
                  <div className="text-xs text-gray-400">
                    {version.angle_count} cameras · {version.reason}
                  </div>
                </div>
                {version.youtube_id && (
                  <a
                    href={`https://youtu.be/${version.youtube_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-dark-border px-2.5 py-1.5 text-xs font-semibold text-accent"
                  >
                    Watch
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <Link to="/matches" className="text-accent hover:underline">Back to matches</Link>
    </div>
  )
}

function YouTubeEmbed({ clip }: { clip: Clip }) {
  const videoId = clip.url_or_path.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1] ?? clip.url_or_path
  const start = clip.start_sec ?? 0
  const end = clip.end_sec ? `&end=${clip.end_sec}` : ''
  return (
    <div className="aspect-video overflow-hidden rounded-lg border border-dark-border">
      <iframe
        src={`https://www.youtube.com/embed/${videoId}?start=${start}${end}`}
        title={clip.title ?? 'Clip'}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="h-full w-full"
      />
    </div>
  )
}
