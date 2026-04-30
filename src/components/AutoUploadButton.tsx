import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { youtubeAutoUploadEnabled } from '@/lib/featureFlags'
import type { PendingUpload } from '@/types/database'

/**
 * AutoUploadButton — queues a Reel for re-upload to OUR YouTube channel.
 *
 * The actual upload is performed offline by `scripts/youtube-uploader.ts`
 * (see docs/youtube-uploader.md). The browser only writes to the
 * `pending_uploads` table; the worker does:
 *   - download the source clip(s) via yt-dlp
 *   - bake the multi-angle composite (we already have layout info on the reel)
 *   - upload via googleapis YouTube v3
 *   - write the new `youtube_video_id` back to the row
 *
 * This split keeps the browser zero-cost: no FFmpeg in WASM, no Google OAuth
 * popup at upload time, no broadband upload from the user's laptop.
 */
export function AutoUploadButton({ reelId, ownerId }: { reelId: string; ownerId: string }) {
  const { user } = useAuth()
  const [pending, setPending] = useState<PendingUpload | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('pending_uploads')
        .select('*')
        .eq('reel_id', reelId)
        .order('queued_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      setPending((data ?? null) as PendingUpload | null)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [reelId])

  const isOwner = user?.id === ownerId
  if (!isOwner) return null

  // No deploy-level feature flag — the queue still works locally; the
  // operator just hasn't run the worker yet. Show a hint instead of hiding.
  async function queue() {
    if (!user) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('pending_uploads')
      .insert({ reel_id: reelId, requested_by: user.id, status: 'queued' })
      .select()
      .single()
    setBusy(false)
    if (err) {
      // Unique-index protects us from queueing twice; surface that politely.
      if (err.message.includes('uq_pending_uploads_reel_open')) {
        setError('This reel is already in the upload queue.')
      } else {
        setError(err.message)
      }
      return
    }
    setPending(data as PendingUpload)
  }

  if (pending && (pending.status === 'queued' || pending.status === 'processing')) {
    return (
      <div className="rounded-lg border border-chakra/40 bg-chakra/10 p-3 text-sm text-chakra">
        Queued for ReelOne YouTube upload — the worker will pick it up next pass.
        {!youtubeAutoUploadEnabled && (
          <p className="text-xs text-gray-400 mt-1">
            Worker is not running on this deploy yet. See{' '}
            <a href="/docs/youtube-uploader.md" className="text-accent hover:underline">
              docs/youtube-uploader.md
            </a>
            {' '}for setup.
          </p>
        )}
      </div>
    )
  }

  if (pending && pending.status === 'uploaded' && pending.youtube_video_id) {
    return (
      <div className="rounded-lg border border-leaf/40 bg-leaf/10 p-3 text-sm text-leaf">
        Uploaded to ReelOne YouTube ·{' '}
        <a
          href={`https://www.youtube.com/watch?v=${pending.youtube_video_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-accent"
        >
          watch on YouTube
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={busy}
        onClick={queue}
        className="px-4 py-2 rounded-lg border border-accent/40 bg-accent/10 text-accent text-sm font-semibold hover:bg-accent/20 disabled:opacity-50"
      >
        {busy ? 'Queuing…' : 'Upload to ReelOne YouTube'}
      </button>
      {!youtubeAutoUploadEnabled && (
        <p className="text-[11px] text-gray-500">
          Auto-upload worker is not configured on this deploy. Reel will sit in the queue until
          the operator runs <code className="text-accent">node scripts/youtube-uploader.ts</code>.
        </p>
      )}
      {error && <p className="text-kunai text-xs">{error}</p>}
    </div>
  )
}
