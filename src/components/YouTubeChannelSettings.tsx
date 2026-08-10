import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ExternalLink, Loader2, Save, TvMinimalPlay, Unlink } from 'lucide-react'
import {
  clearYouTubeConnection,
  rememberYouTubeChannel,
} from '@/lib/youtubeConnect'
import { normalizeConnectedYouTubeChannelUrl } from '@/lib/signupYouTube'
import {
  disconnectYouTubeChannel,
  loadConnectedYouTubeChannel,
  saveConnectedYouTubeChannel,
  type ConnectedYouTubeChannel,
} from '@/lib/youtubeSettings'

export function YouTubeChannelSettings({ userId }: { userId: string }) {
  const [channel, setChannel] = useState<ConnectedYouTubeChannel | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const [error, setError] = useState('')
  const normalized = useMemo(() => normalizeConnectedYouTubeChannelUrl(draft), [draft])

  useEffect(() => {
    let alive = true
    setLoading(true)
    loadConnectedYouTubeChannel()
      .then((current) => {
        if (!alive) return
        setChannel(current)
        setDraft(current?.url || '')
      })
      .catch((reason) => alive && setError(reason instanceof Error ? reason.message : 'Could not load YouTube settings.'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [userId])

  async function save() {
    if (!normalized || saving) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const next = await saveConnectedYouTubeChannel(normalized)
      clearYouTubeConnection(userId)
      rememberYouTubeChannel(userId, normalized)
      setChannel(next)
      setDraft(next?.url || normalized)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this channel.')
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await disconnectYouTubeChannel()
      clearYouTubeConnection(userId)
      setChannel(null)
      setDraft('')
      setConfirmingDisconnect(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not disconnect this channel.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-red-500/10 text-red-400">
          <TvMinimalPlay size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-white">YouTube channel</h2>
          <p className="mt-1 text-sm text-gray-400">
            This is the channel used for your live status, footage, and player profile.
          </p>
          {channel && (
            <a
              href={channel.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex max-w-full items-center gap-1.5 truncate text-sm text-accent hover:underline"
            >
              <span className="truncate">{channel.url}</span>
              <ExternalLink size={13} className="shrink-0" aria-hidden />
            </a>
          )}
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="account-youtube-url" className="mb-1.5 block text-xs font-medium text-gray-300">
          Channel URL
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="account-youtube-url"
            type="url"
            inputMode="url"
            value={draft}
            disabled={loading || saving}
            onChange={(event) => {
              setDraft(event.target.value)
              setSaved(false)
              setError('')
            }}
            placeholder="https://youtube.com/@yourchannel"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-dark-border bg-dark px-3 text-sm text-white outline-none focus:border-accent disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving || !normalized || normalized === channel?.url}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-dark transition-colors hover:brightness-110 disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Save size={16} aria-hidden />}
            {channel ? 'Save change' : 'Connect channel'}
          </button>
        </div>
        {draft.trim() && !normalized && (
          <p className="mt-2 text-xs text-red-400">Enter a channel link, not a video or Shorts link.</p>
        )}
        {saved && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-leaf">
            <CheckCircle2 size={14} aria-hidden /> Saved on your account
          </p>
        )}
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      {channel && (
        <div className="mt-4 border-t border-dark-border pt-4">
          {!confirmingDisconnect ? (
            <button
              type="button"
              onClick={() => setConfirmingDisconnect(true)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-red-400 hover:bg-red-500/10"
            >
              <Unlink size={16} aria-hidden /> Disconnect channel
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-300">Disconnect this YouTube channel?</span>
              <button
                type="button"
                onClick={() => setConfirmingDisconnect(false)}
                className="min-h-10 rounded-lg px-3 text-sm text-gray-300 hover:bg-dark-elevated"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void disconnect()}
                disabled={saving}
                className="min-h-10 rounded-lg bg-red-500 px-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
