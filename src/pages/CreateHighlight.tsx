import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  GripVertical,
  Link2,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react'
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
import { moveListItem } from '@/lib/reelEditor'
import { recordActivity } from '@/lib/activity'
import { CreationSponsorGate } from '@/components/CreationSponsorGate'
import { ClipFinder } from '@/components/ClipFinder'
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
  const navigate = useNavigate()
  const { runLayout, loading: ffmpegLoading, progress, stage } = useFFmpeg()

  const [layout, setLayout] = useState<ReelLayout>('concat')
  const [title, setTitle] = useState('')
  const [clips, setClips] = useState<ClipInput[]>([])
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [savedLinks, setSavedLinks] = useState<UserYoutubeLink[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showClipFinder, setShowClipFinder] = useState(false)
  const [draggedClipIndex, setDraggedClipIndex] = useState<number | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const hydratedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    const start = 0
    const end = 0
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

  function moveClip(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= clips.length || to >= clips.length) return
    setClips((current) => moveListItem(current, from, to))
    setSuggestionsByIdx((current) => {
      const ordered = Array.from({ length: clips.length }, (_, index) => current[index])
      const moved = moveListItem(ordered, from, to)
      return moved.reduce<Record<number, HighlightMoment[]>>((next, moments, index) => {
        if (moments) next[index] = moments
        return next
      }, {})
    })
  }

  function updateYoutubeTrim(index: number, field: 'startSec' | 'endSec', value: number) {
    setClips((current) =>
      current.map((clip, clipIndex) =>
        clipIndex === index && clip.type === 'youtube'
          ? { ...clip, [field]: Math.max(0, value || 0) }
          : clip,
      ),
    )
  }

  function handleClipDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    addFileClip(event.dataTransfer.files)
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
    const invalidYoutubeTrim = youtubeClips.find(
      (clip) => clip.endSec > 0 && clip.endSec <= clip.startSec,
    )
    if (invalidYoutubeTrim) {
      setError('Each YouTube clip end time must be later than its start time.')
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
      <div className="mb-6">
        <div>
          <div className="mb-2 flex items-center gap-2 text-kunai">
            <Clapperboard size={16} />
            <span className="text-xs font-semibold uppercase">Reel builder</span>
          </div>
          <h1 className="text-2xl font-bold">Create a reel</h1>
          <p className="mt-1 text-sm text-gray-400">Add footage first. Arrange and edit it next.</p>
        </div>
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

        <section
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleClipDrop}
          className="rounded-lg border border-dashed border-kunai/50 bg-kunai/5 p-4 sm:p-5"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-kunai/15 text-kunai">
              <Upload size={22} />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold text-white">Add your footage</h2>
              <p className="mt-1 text-sm text-gray-400">
                Drop video here, choose files, or pull clips from a connected account.
              </p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            onChange={(event) => addFileClip(event.target.files)}
            className="hidden"
          />

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-kunai px-4 text-sm font-semibold text-dark transition-colors hover:bg-kunai/90"
            >
              <Upload size={17} />
              Choose video
            </button>
            <button
              type="button"
              onClick={() => setShowClipFinder((current) => !current)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dark-border bg-dark-card px-4 text-sm font-semibold text-white transition-colors hover:border-kunai/60"
            >
              <Link2 size={17} />
              {showClipFinder ? 'Hide connected clips' : 'Find connected clips'}
            </button>
          </div>

          <div className="mt-3 flex gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Paste a YouTube link</span>
              <Link2
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
              />
              <input
                type="text"
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
                placeholder="Paste a YouTube link"
                aria-invalid={!!manualLinkErr}
                className={`h-11 w-full rounded-lg border bg-dark pl-9 pr-3 text-sm text-white outline-none placeholder:text-gray-600 ${
                  manualLinkErr ? 'border-red-500/70' : 'border-dark-border focus:border-kunai'
                }`}
              />
            </label>
            <button
              type="button"
              onClick={() => addYoutubeClip(youtubeUrl)}
              disabled={!canAddManualLink}
              className="h-11 rounded-lg border border-kunai px-4 text-sm font-semibold text-kunai disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {manualLinkErr && <p className="mt-1 text-xs text-red-400">{manualLinkErr}</p>}
        </section>

        {showClipFinder && (
          <section className="rounded-lg border border-dark-border bg-dark-card p-4">
            <ClipFinder
              onAdd={addYoutubeClip}
              onRemove={removeYoutubeClip}
              username={(user?.user_metadata as { username?: string } | undefined)?.username}
            />
          </section>
        )}

        {clips.length > 0 && (
          <section>
            <div className="mb-2 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-semibold text-white">Arrange and trim</h2>
                <p className="text-xs text-gray-500">Drag clips, or use the arrow buttons on a phone.</p>
              </div>
              <span className="text-xs text-gray-500">{clips.length} added</span>
            </div>
            {hasMix && (
              <p className="mb-2 text-xs text-yellow-400">
                Use all YouTube links or all uploaded files in one reel.
              </p>
            )}
            <ol className="space-y-2">
              {clips.map((clip, index) => {
                const youtubeId = clip.type === 'youtube' ? extractYouTubeId(clip.url) : null
                return (
                  <li
                    key={clip.type === 'youtube' ? `${clip.url}-${index}` : `${clip.file.name}-${index}`}
                    draggable
                    onDragStart={() => setDraggedClipIndex(index)}
                    onDragEnd={() => setDraggedClipIndex(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (draggedClipIndex != null) moveClip(draggedClipIndex, index)
                      setDraggedClipIndex(null)
                    }}
                    className={`rounded-lg border bg-dark-card p-3 transition-colors ${
                      draggedClipIndex === index ? 'border-kunai' : 'border-dark-border'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <GripVertical size={18} className="hidden shrink-0 cursor-grab text-gray-600 sm:block" />
                      {youtubeId ? (
                        <img
                          src={thumbUrl(youtubeId, 'mq')}
                          alt=""
                          className="h-10 w-16 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <span className="flex h-10 w-12 shrink-0 items-center justify-center rounded bg-dark-elevated text-kunai">
                          <Clapperboard size={18} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          {clip.type === 'youtube' ? prettyClip(clip.url, clip.title) : clip.file.name}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">Angle {index + 1}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveClip(index, index - 1)}
                          disabled={index === 0}
                          aria-label="Move clip up"
                          title="Move up"
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-dark-elevated hover:text-white disabled:opacity-25"
                        >
                          <ArrowUp size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveClip(index, index + 1)}
                          disabled={index === clips.length - 1}
                          aria-label="Move clip down"
                          title="Move down"
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-dark-elevated hover:text-white disabled:opacity-25"
                        >
                          <ArrowDown size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeClip(index)}
                          aria-label="Remove clip"
                          title="Remove"
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </div>

                    {clip.type === 'youtube' && (
                      <div className="mt-3 border-t border-dark-border pt-3">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-xs text-gray-500">
                            Start
                            <input
                              type="number"
                              min={0}
                              value={clip.startSec}
                              onChange={(event) => updateYoutubeTrim(index, 'startSec', Number(event.target.value))}
                              className="mt-1 h-9 w-full rounded-lg border border-dark-border bg-dark px-3 text-sm text-white outline-none focus:border-kunai"
                            />
                          </label>
                          <label className="text-xs text-gray-500">
                            End
                            <input
                              type="number"
                              min={0}
                              value={clip.endSec || ''}
                              placeholder="Full clip"
                              onChange={(event) => updateYoutubeTrim(index, 'endSec', Number(event.target.value))}
                              className="mt-1 h-9 w-full rounded-lg border border-dark-border bg-dark px-3 text-sm text-white outline-none focus:border-kunai"
                            />
                          </label>
                        </div>
                        {youtubeId && (
                          <label
                            className="mt-2 inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-chakra/40 px-3 text-xs font-semibold text-chakra hover:bg-chakra/10"
                            title="Attach the match result screen to improve same-match grouping"
                          >
                            {ocrBusyId === youtubeId
                              ? 'Reading result'
                              : resultByVideoId[youtubeId]
                                ? 'Result attached'
                                : 'Attach result screen'}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(event) => handleTagResult(youtubeId, event.target.files)}
                            />
                          </label>
                        )}
                      </div>
                    )}

                    {clip.type === 'upload' && (
                      <div className="mt-3 border-t border-dark-border pt-3">
                        <button
                          type="button"
                          onClick={() => analyzeClip(index)}
                          disabled={aiAnalyzing === index}
                          className="inline-flex min-h-9 items-center rounded-lg border border-kunai/40 px-3 text-xs font-semibold text-kunai disabled:opacity-50"
                        >
                          {aiAnalyzing === index
                            ? scanProgress?.idx === index
                              ? `Scanning ${scanProgress.pct}%`
                              : 'Analyzing'
                            : `Find ${activeCat.label}`}
                        </button>
                        {suggestionsByIdx[index]?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {suggestionsByIdx[index].map((moment, momentIndex) => (
                              <span
                                key={momentIndex}
                                className="rounded border border-kunai/20 bg-kunai/10 px-2 py-0.5 text-xs text-kunai"
                              >
                                {formatTimestamp(moment.startSec)} - {formatTimestamp(moment.endSec)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        {clips.length > 0 && (
          <div className="space-y-3">
            <ChipInput
              fieldKey="reel_title"
              label="Reel title (optional)"
              value={title}
              onChange={setTitle}
              placeholder="4-stack clutch, all angles"
            />
            <button
              type="button"
              onClick={() => {
                setShowAdvanced((current) => {
                  const next = !current
                  if (!next) setInviteFriends(false)
                  return next
                })
              }}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-dark-border px-3 text-sm text-gray-300 hover:border-kunai/50"
            >
              <SlidersHorizontal size={16} />
              {showAdvanced ? 'Hide editing options' : 'More editing options'}
            </button>
          </div>
        )}

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

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {ffmpegLoading && (
          <p className="text-accent text-sm">{stage}… {progress}%</p>
        )}

        {clips.length > 0 && (
          <>
            <CreationSponsorGate isPremium={isPremium} onUnlocked={onSponsorUnlocked} />
            <button
              type="submit"
              disabled={saving || ffmpegLoading || hasMix || (needsSponsorAd && !sponsorUnlocked)}
              className="w-full rounded-lg bg-accent py-3 font-semibold text-dark hover:shadow-glow disabled:opacity-50"
            >
              {saving ? 'Saving…' : ffmpegLoading ? 'Rendering…' : 'Create reel'}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
