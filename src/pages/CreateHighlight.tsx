import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useFFmpeg, layoutLimits, type ReelLayout } from '@/hooks/useFFmpeg'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useAutoMerge } from '@/hooks/useAutoMerge'
import { formatTimestamp, type HighlightMoment } from '@/lib/highlightDetector'
import { detectByCategory } from '@/lib/categoryDetector'
import { HIGHLIGHT_CATEGORIES, type HighlightCategoryId } from '@/lib/highlightCategories'
import { extractYouTubeId, isValidYouTubeUrl, youtubeLinkError } from '@/lib/youtubeApi'
import { thumbUrl, loadLibrary } from '@/lib/youtubeConnect'
import { demoSquad } from '@/lib/squad'
import { parseMatchScreenshot } from '@/lib/ocrMatchResult'
import { suggestOtherAngles, type ClipMeta, type ResultSignature } from '@/lib/matchGrouping'
import {
  libraryVideoToMeta,
  squadClipToMeta,
  demoMatchAngles,
  recordAddedYouTubeClip,
} from '@/lib/clipRecords'
import {
  recordReelParticipants,
  resolveParticipantsFromVideoIds,
} from '@/lib/reelParticipants'
import { prettyClip } from '@/lib/clipLabel'
import { encodeLayoutMarker } from '@/lib/reelLayout'
import { recordActivity } from '@/lib/activity'
import { BRAND } from '@/lib/brand'
import { CreationSponsorGate } from '@/components/CreationSponsorGate'
import { ClipFinder } from '@/components/ClipFinder'
import { useAskTko } from '@/components/AskTkoContext'
import { ActionCard } from '@/components/ui/ActionCard'
import { ChipInput } from '@/components/ui/ChipInput'
import type { NinjaIconName } from '@/components/ui/NinjaIcon'
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

/**
 * The two-mode picker shown once there are 2+ clips. Auto (auto-switch action
 * cam) is the default; Director is the cinematic multi-angle 'ultra' cut. The
 * old "Simple/concat" preset was dropped from this selector — the concat layout
 * itself still lives in Advanced options and the single-clip path.
 */
const SIMPLE_PRESETS: { id: ReelLayout; label: string; sub: string; icon: NinjaIconName }[] = [
  { id: 'action', label: 'Auto', sub: 'We auto-cut between your clips on one screen', icon: 'bolt' },
  { id: 'ultra', label: 'Director', sub: 'Cinematic multi-angle (side-by-side + PiP)', icon: 'sword' },
]

function creationAdRequiredSec(): number {
  const v = import.meta.env.VITE_CREATION_AD_SECONDS
  if (v === '' || v === undefined) return 30
  return Math.max(0, Number(v) || 0)
}

export function CreateHighlight() {
  const { user } = useAuth()
  const { isPremium } = useEntitlements()
  // Cross-user auto-merge unlock (YouTube connected + a paid tier). Only clips
  // from an entitled user enter the auto-match pipeline; own posts still land.
  const { enabled: autoMergeOn } = useAutoMerge()
  const { open: openAskTko } = useAskTko()
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
  const [draftRestored, setDraftRestored] = useState(false)
  const hydratedRef = useRef(false)

  // Inline validity of the manual "paste a YouTube link" box.
  const manualLinkErr = youtubeLinkError(youtubeUrl)
  const canAddManualLink = isValidYouTubeUrl(youtubeUrl)
  const [sponsorUnlocked, setSponsorUnlocked] = useState(false)
  const onSponsorUnlocked = useCallback(() => setSponsorUnlocked(true), [])

  const adWaitSec = creationAdRequiredSec()
  const needsSponsorAd = !isPremium && adWaitSec > 0

  // Squad invite mode: when on, the reel saves "locked" until at least
  // `inviteSlots` total clips exist. Squadmates (people you follow / your clan)
  // contribute via the share link on the reel detail page (clips tagged with
  // [for:<reelId>] in title).
  const [inviteFriends, setInviteFriends] = useState(false)
  const [inviteSlots, setInviteSlots] = useState<number>(4)

  const [aiAnalyzing, setAiAnalyzing] = useState<number | null>(null)
  const [suggestionsByIdx, setSuggestionsByIdx] = useState<Record<number, HighlightMoment[]>>({})
  const [category, setCategory] = useState<HighlightCategoryId>('all')
  const [scanProgress, setScanProgress] = useState<{ idx: number; pct: number } | null>(null)

  // ── Same-match bunching: "other angles of this match" ──────────────────────
  const uid = user?.id ?? 'anon'
  const username = (user?.user_metadata as { username?: string } | undefined)?.username ?? 'me'
  // Result signatures read from a match-result screenshot (client OCR), per video
  // id — they sharpen grouping. Kept out of band so a low-confidence read never
  // blocks the user; we just store what we got.
  const [resultByVideoId, setResultByVideoId] = useState<Record<string, ResultSignature>>({})
  const [ocrBusyId, setOcrBusyId] = useState<string | null>(null)

  // The candidate library the grouping engine searches: the user's connected
  // clips + their squad's clips + the demo match, mapped to ClipMeta and deduped,
  // with any OCR-read result signatures overlaid.
  const clipMetaPool = useMemo<ClipMeta[]>(() => {
    const byId = new Map<string, ClipMeta>()
    for (const m of demoMatchAngles()) byId.set(m.clipId, m)
    for (const v of loadLibrary(uid)) if (!byId.has(v.id)) byId.set(v.id, libraryVideoToMeta(v, username))
    for (const c of demoSquad().clips) if (!byId.has(c.id)) byId.set(c.id, squadClipToMeta(c))
    return [...byId.values()].map((m) =>
      resultByVideoId[m.clipId]
        ? { ...m, resultSignature: { ...m.resultSignature, ...resultByVideoId[m.clipId] } }
        : m,
    )
  }, [uid, username, resultByVideoId])

  const titleByVideoId = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const v of loadLibrary(uid)) map[v.id] = v.title
    for (const c of demoSquad().clips) if (!map[c.id]) map[c.id] = c.title
    return map
  }, [uid])

  // YouTube video ids already added to the reel.
  const addedYoutubeIds = useMemo(() => {
    const s = new Set<string>()
    for (const c of clips) {
      if (c.type !== 'youtube') continue
      const id = extractYouTubeId(c.url)
      if (id) s.add(id)
    }
    return s
  }, [clips])

  // The bunch: other angles of the SAME match as any clip already in the reel.
  const bunchSuggestions = useMemo<ClipMeta[]>(() => {
    if (addedYoutubeIds.size === 0) return []
    const seen = new Set<string>()
    const out: ClipMeta[] = []
    for (const id of addedYoutubeIds) {
      const target = clipMetaPool.find((m) => m.clipId === id)
      if (!target) continue
      for (const other of suggestOtherAngles(target, clipMetaPool)) {
        if (addedYoutubeIds.has(other.clipId) || seen.has(other.clipId)) continue
        seen.add(other.clipId)
        out.push(other)
      }
    }
    return out
  }, [addedYoutubeIds, clipMetaPool])

  // Auto-categorize + read a result screenshot for an added YouTube clip.
  async function handleTagResult(videoId: string, files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setOcrBusyId(videoId)
    try {
      const ocr = await parseMatchScreenshot(file)
      const rs: ResultSignature = {}
      if (ocr.outcome) rs.outcome = ocr.outcome
      if (ocr.kills != null) rs.kills = ocr.kills
      if (ocr.deaths != null) rs.deaths = ocr.deaths
      if (ocr.assists != null) rs.assists = ocr.assists
      setResultByVideoId((prev) => ({ ...prev, [videoId]: rs }))
      try {
        recordAddedYouTubeClip({
          userId: uid,
          youtubeId: videoId,
          playerId: uid,
          playerName: username,
          title: titleByVideoId[videoId],
          ocr,
          autoMergeEnabled: autoMergeOn,
        })
      } catch {
        /* persistence is best-effort; never block the user */
      }
    } finally {
      setOcrBusyId(null)
    }
  }

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

  // ── Don't-lose-progress: a small per-user draft in localStorage ────────────
  // We autosave the title + any YouTube clips (uploads hold File handles that
  // can't be serialized, so those aren't part of the draft). On return we
  // restore it and show a subtle "Draft restored" note.
  const draftKey = `tko:reel-draft:${uid}`

  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(draftKey) } catch { /* ignore */ }
    setDraftRestored(false)
  }, [draftKey])

  // Restore once per user.
  useEffect(() => {
    hydratedRef.current = false
    try {
      const raw = localStorage.getItem(`tko:reel-draft:${uid}`)
      if (raw) {
        const d = JSON.parse(raw) as {
          title?: string
          clips?: { url: string; startSec?: number; endSec?: number; title?: string }[]
        }
        const ytClips = (d.clips ?? []).filter((c) => c.url && extractYouTubeId(c.url))
        if ((d.title && d.title.trim()) || ytClips.length > 0) {
          if (d.title) setTitle(d.title)
          if (ytClips.length > 0) {
            setClips(
              ytClips.map((c) => ({
                type: 'youtube' as const,
                url: c.url,
                startSec: c.startSec || 0,
                endSec: c.endSec || 0,
                title: c.title,
              })),
            )
          }
          setDraftRestored(true)
        }
      }
    } catch {
      /* corrupt draft — ignore */
    }
    hydratedRef.current = true
    // Restore keyed to the user only; run once per uid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  // Autosave on every title/clip change (after the initial hydration pass, so
  // we never clobber a restored draft before it's applied).
  useEffect(() => {
    if (!hydratedRef.current) return
    try {
      const yt = clips
        .filter((c): c is ClipInput & { type: 'youtube' } => c.type === 'youtube')
        .map((c) => ({ url: c.url, startSec: c.startSec, endSec: c.endSec, title: c.title }))
      if (title.trim() || yt.length > 0) {
        localStorage.setItem(draftKey, JSON.stringify({ title, clips: yt }))
      } else {
        localStorage.removeItem(draftKey)
      }
    } catch {
      /* quota / private mode — non-blocking */
    }
  }, [title, clips, draftKey])

  function addYoutubeClip(url: string) {
    const videoId = extractYouTubeId(url)
    if (!videoId) {
      setError('Invalid YouTube URL')
      return
    }
    // Idempotent: if a YouTube clip with the same video id is already added,
    // do nothing (no duplicate).
    const already = clips.some(
      (c) => c.type === 'youtube' && extractYouTubeId(c.url) === videoId
    )
    if (already) {
      setError('')
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
    // Auto-categorize + persist a normalized clip record so this clip can be
    // grouped into a match bunch later. Best-effort — never blocks the add.
    try {
      recordAddedYouTubeClip({
        userId: uid,
        youtubeId: videoId,
        playerId: uid,
        playerName: username,
        title: titleByVideoId[videoId],
        startSec: start,
        autoMergeEnabled: autoMergeOn,
      })
    } catch {
      /* non-blocking */
    }
    setClips((c) => [...c, { type: 'youtube', url: fullUrl, startSec: start, endSec: end || 0 }])
    setYoutubeUrl('')
    setYoutubeStart('')
    setYoutubeEnd('')
    setError('')
  }

  // Remove a YouTube clip by url (matched on video id). Lets ClipFinder
  // deselect an already-added thumbnail and keep its picked state in sync.
  function removeYoutubeClip(url: string) {
    const videoId = extractYouTubeId(url)
    if (!videoId) return
    setClips((c) =>
      c.filter((clip) => !(clip.type === 'youtube' && extractYouTubeId(clip.url) === videoId))
    )
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
    setScanProgress({ idx: i, pct: 0 })
    try {
      const moments = await detectByCategory(c.file, category, {
        onProgress: (done, total) => setScanProgress({ idx: i, pct: Math.round((done / total) * 100) }),
      })
      setSuggestionsByIdx((prev) => ({ ...prev, [i]: moments }))
    } finally {
      setAiAnalyzing(null)
      setScanProgress(null)
    }
  }

  // Layout switch: preserve the user's work when the already-added clips still
  // fit the new layout. Fixed-arity layouts (grid/side-by-side/pip) need an
  // exact count — if the current clips don't match, clear them; otherwise keep.
  // Range layouts (concat/action/ultra) only trim the overflow past max.
  function changeLayout(next: ReelLayout) {
    const nextLimits = layoutLimits(next)
    const nextFixedArity = next !== 'concat' && next !== 'action' && next !== 'ultra'
    setLayout(next)
    setClips((prev) => {
      if (nextFixedArity) {
        // Keep only if the count already matches the required arity.
        return prev.length === nextLimits.min ? prev : []
      }
      // Range layout: drop only the clips that exceed the new max.
      return prev.length > nextLimits.max ? prev.slice(0, nextLimits.max) : prev
    })
    setSuggestionsByIdx({})
    setError('')
  }

  // Default the two-mode picker to Auto. The picker only appears at 2+ clips
  // (in the simple view); the moment it does, snap the mode to Auto ('action')
  // unless the user already chose Director ('ultra'). The single-clip case
  // stays on 'concat' (min 1) so a lone highlight can still be created.
  useEffect(() => {
    if (showAdvanced) return
    if (clips.length >= 2 && layout !== 'action' && layout !== 'ultra') {
      changeLayout('action')
    }
    // changeLayout is a stable local closure; intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips.length, showAdvanced])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (needsSponsorAd && !sponsorUnlocked) {
      setError('Finish the sponsor message above, or go Pro to skip it.')
      return
    }
    // Title is optional — a basic user shouldn't be blocked inventing a name.
    // Default to a friendly, dated title they can rename later.
    const finalTitle = title.trim() || `My highlight — ${new Date().toLocaleDateString()}`

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
        setError('Add at least one clip yourself before inviting your squad.')
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
      const { data: reelRow, error: reelErr } = await supabase
        .from('reels')
        .insert({
          user_id: user!.id,
          title: finalTitle,
          clip_ids: clipIds,
          combined_video_url: combinedUrl,
        })
        .select('id')
        .single()

      if (reelErr) throw reelErr

      // Record a feed activity so this shows up on your (and your followers')
      // Activity tab. Best-effort — never blocks the create.
      if (reelRow?.id) void recordActivity(user!.id, 'reel_created', reelRow.id, { title: finalTitle })

      // ── "You're in a new clip" ────────────────────────────────────────────
      // A multi-angle reel is several PEOPLE's uploads of one match, so the
      // reel does not belong to the uploader alone. Record the cast (owners of
      // the source clips, resolved from the shared catalogue — never from
      // anything typed here) and notify everyone but the uploader. Best-effort:
      // the reel is already saved and must not be undone if this fails.
      if (reelRow?.id) {
        try {
          const videoIds = youtubeClips
            .map((c) => extractYouTubeId(c.url))
            .filter((v): v is string => !!v)
          const candidates = await resolveParticipantsFromVideoIds(videoIds)
          await recordReelParticipants({
            reelId: reelRow.id,
            uploaderId: user!.id,
            reelTitle: finalTitle,
            candidates,
          })
        } catch {
          // Never block the "your clip is ready" hand-off on the fan-out.
        }
      }

      // Reel is saved — the draft has served its purpose; drop it.
      clearDraft()
      // Land on My Clips with a "ready" banner so the user always sees where
      // their clip went (instead of a detail page that may still be assembling).
      navigate('/my-clips', { state: { justCreated: true } })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create highlight')
    } finally {
      setSaving(false)
    }
  }

  const uploadCount = clips.filter((c) => c.type === 'upload').length
  const youtubeCount = clips.filter((c) => c.type === 'youtube').length
  const hasMix = uploadCount > 0 && youtubeCount > 0
  const activeCat = HIGHLIGHT_CATEGORIES.find((c) => c.id === category) ?? HIGHLIGHT_CATEGORIES[0]

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
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
        {draftRestored && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-gray-300">
            <span>Draft restored — we kept your title and links from last time.</span>
            <button
              type="button"
              onClick={() => {
                setTitle('')
                setClips([])
                clearDraft()
              }}
              className="shrink-0 text-gray-400 hover:text-white underline"
            >
              Start fresh
            </button>
          </div>
        )}

        <ChipInput
          fieldKey="reel_title"
          label="Title (optional)"
          value={title}
          onChange={setTitle}
          placeholder="4-stack clutch, all angles"
        />

        <ActionCard
          icon="bolt"
          label="Get clips"
          sublabel="Pull up PlayStation, YouTube, Twitch — grab a clip, send it here"
          to="/browser"
        />

        <ClipFinder
          onAdd={addYoutubeClip}
          onRemove={removeYoutubeClip}
          username={(user?.user_metadata as { username?: string } | undefined)?.username}
        />

        {/* Same-match bunch: the other angles of a clip already in the reel. */}
        {bunchSuggestions.length > 0 && (
          <div className="rounded-xl border border-accent/40 bg-accent/5 p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div>
                <div className="font-semibold text-white">
                  Other angles of this match ({bunchSuggestions.length})
                </div>
                <div className="text-xs text-gray-400">
                  Same match, different players — add the whole bunch as one multi-angle set.
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  bunchSuggestions.forEach((m) =>
                    addYoutubeClip(`https://www.youtube.com/watch?v=${m.clipId}`),
                  )
                }
                className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow"
              >
                Add all
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {bunchSuggestions.map((m) => (
                <button
                  key={m.clipId}
                  type="button"
                  onClick={() => addYoutubeClip(`https://www.youtube.com/watch?v=${m.clipId}`)}
                  className="group shrink-0 w-32 text-left rounded-lg overflow-hidden border border-dark-border hover:border-accent/60"
                  title={titleByVideoId[m.clipId] || m.playerId}
                >
                  <div className="relative aspect-video bg-dark">
                    <img
                      src={thumbUrl(m.clipId)}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.2' }}
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-black/60 text-[10px] text-white px-1 py-0.5 opacity-0 group-hover:opacity-100">
                      + Add angle
                    </div>
                  </div>
                  <div className="p-1.5 text-[11px] text-gray-300 truncate">
                    {m.playerId}
                    {m.category ? ` · ${m.category}` : ''}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {!showAdvanced ? (
          // A single clip has no layout choice to make — only show reel type
          // once there are 2+ clips, so basic users aren't asked a needless question.
          clips.length < 2 ? null : (
          <div>
            <label className="block text-sm text-gray-400 mb-2">How to combine them</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SIMPLE_PRESETS.map((p) => (
                <ActionCard
                  key={p.id}
                  icon={p.icon}
                  label={p.label}
                  sublabel={p.sub}
                  selected={layout === p.id}
                  onClick={() => changeLayout(p.id)}
                />
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">YouTube links first — we sync angles in the browser. Advanced has every layout, invites, and file uploads.</p>
          </div>
          )
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
              <span className="font-medium">Invite your squad to upload their angle</span>
            </label>
            <p className="text-xs text-gray-500 mt-1 ml-6">
              Share the reel link with people you follow or your clan; the reel stays locked until every slot is
              filled. Great for clans and tournament squads.
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
                  You: {clips.length} · Squad: {Math.max(0, inviteSlots - clips.length)} pending
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
                  <span className="truncate text-sm text-gray-300 flex-1 min-w-0">
                    <span className="text-accent text-xs mr-1">▶</span>
                    {prettyClip(link.url, link.title)}
                  </span>
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
          <div className="flex items-center justify-between gap-2 mb-2">
            <label className="block text-sm text-gray-400">
              {showAdvanced ? 'Add YouTube clip (URL)' : 'Or paste a link manually'}
            </label>
            {/* Blocking-point helper — opens the Ask TKO guided panel straight
                to the "Make your first clip" walkthrough. */}
            <button
              type="button"
              onClick={() => openAskTko('make-clip')}
              className="text-[11px] text-accent hover:underline shrink-0"
            >
              Need help? Ask TKO
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              aria-invalid={!!manualLinkErr}
              className={`flex-1 min-w-[200px] px-4 py-2 rounded-lg bg-dark border text-white focus:outline-none ${
                manualLinkErr ? 'border-red-500/70 focus:border-red-500' : 'border-dark-border focus:border-accent'
              }`}
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
              disabled={!canAddManualLink}
              title={canAddManualLink ? 'Add this clip' : 'Paste a valid YouTube link first'}
              className="px-4 py-2 rounded-lg border border-accent text-accent hover:bg-accent/10 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Add
            </button>
          </div>
          {manualLinkErr ? (
            <p className="text-red-400 text-xs mt-1">{manualLinkErr}</p>
          ) : showAdvanced ? (
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

        {uploadCount > 0 && (
          <div>
            <label className="block text-sm text-gray-400 mb-2">What to pull</label>
            <div className="flex flex-wrap gap-2">
              {HIGHLIGHT_CATEGORIES.map((cat) => {
                const active = category === cat.id
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`px-3 py-2 rounded-lg border text-left transition-colors ${
                      active ? 'border-accent bg-accent/10' : 'border-dark-border bg-dark-card hover:border-accent/40'
                    }`}
                  >
                    <div className="text-sm font-medium">{cat.label}</div>
                    <div className="text-xs text-gray-500">{cat.sub}</div>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Pick a category, then hit “Find {activeCat.label}” on a clip below. K.O.s, ultimates, flags, opening, and
              closing are matched from the on-screen text; “All highlights” uses audio.
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
                    {c.type === 'youtube' && (() => {
                      const yid = extractYouTubeId(c.url)
                      return yid ? (
                        <img
                          src={thumbUrl(yid, 'mq')}
                          alt=""
                          loading="lazy"
                          className="w-16 h-9 rounded object-cover shrink-0 border border-dark-border"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.2' }}
                        />
                      ) : null
                    })()}
                    <span className="truncate text-sm flex-1 min-w-0">
                      {i === 0 && layout === 'pip' && <span className="text-accent text-xs mr-2">MAIN</span>}
                      {layout === 'action' && <span className="text-accent text-xs mr-2">A{i + 1}</span>}
                      {layout === 'ultra' && <span className="text-accent text-xs mr-2">A{i + 1}</span>}
                      {c.type === 'youtube' ? (
                        <>
                          <span className="text-accent text-xs mr-1">▶</span>
                          {prettyClip(c.url, c.title)}
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
                          title={category === 'all' ? 'Detect big moments via audio (clutch spikes)' : `Scan on-screen text for ${activeCat.label}`}
                        >
                          {aiAnalyzing === i
                            ? scanProgress?.idx === i
                              ? `Scanning ${scanProgress.pct}%`
                              : 'Analyzing…'
                            : `Find ${activeCat.label}`}
                        </button>
                      )}
                      {c.type === 'youtube' && (() => {
                        const yid = extractYouTubeId(c.url)
                        if (!yid) return null
                        const tagged = !!resultByVideoId[yid]
                        return (
                          <label
                            className="text-xs px-2 py-1 rounded border border-chakra/40 text-chakra hover:bg-chakra/10 cursor-pointer"
                            title="Attach the match result screen — we read outcome + K/D to bunch same-match angles"
                          >
                            {ocrBusyId === yid ? 'Reading…' : tagged ? 'Result ✓' : 'Tag result'}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handleTagResult(yid, e.target.files)}
                            />
                          </label>
                        )
                      })()}
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
