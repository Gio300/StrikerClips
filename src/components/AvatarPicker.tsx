import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Avatar } from '@/components/ui'
import { AVATAR_SIZE_PX, isSafeAvatarUrl, normalizeAvatarUrl } from '@/lib/avatar'
import { fileToAvatarDataUrl } from '@/lib/avatarImage'

/**
 * AvatarPicker — set your profile picture, two ways.
 *
 *   • Pick a photo — downscaled + centre-cropped client-side to a 256px square
 *     JPEG before it is written, so nothing large ever reaches Postgres.
 *   • Paste an image link — validated (http/https only) and stored as-is.
 *
 * Writes `profiles.avatar_url` for the signed-in user only. `avatar_url` is a
 * plain profile column (not in the server's PRIVILEGE_COLS), and the `profiles`
 * TABLE_POLICY is owner-write keyed on `id`, so the API re-targets the update
 * at the caller's own row — a client can never set someone else's picture.
 */
export function AvatarPicker({
  userId,
  username,
  currentUrl,
  onChange,
}: {
  userId: string
  username?: string | null
  currentUrl?: string | null
  /** Fired with the newly saved value (null when cleared). */
  onChange?: (next: string | null) => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null)
  const [linkDraft, setLinkDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save(next: string | null) {
    setBusy(true)
    setError(null)
    setSaved(false)
    const { error: err } = await supabase
      .from('profiles')
      .update({ avatar_url: next, updated_at: new Date().toISOString() })
      .eq('id', userId)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setPreview(next)
    setSaved(true)
    onChange?.(next)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Let the same file be picked again after a failure.
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const dataUrl = await fileToAvatarDataUrl(file)
      setBusy(false)
      await save(dataUrl)
    } catch (err: unknown) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'That image could not be used.')
    }
  }

  async function handleLink(e: React.FormEvent) {
    e.preventDefault()
    const next = normalizeAvatarUrl(linkDraft)
    if (!next) {
      setError('Paste a direct image link starting with https://')
      return
    }
    setLinkDraft('')
    await save(next)
  }

  return (
    <div className="rounded-lg border border-dark-border bg-dark p-3 space-y-3">
      <div className="flex items-center gap-3">
        <Avatar src={preview} name={username} seed={userId} size={56} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">Profile picture</p>
          <p className="text-[11px] text-gray-500">
            Pick a photo or paste a link. Photos are resized to {AVATAR_SIZE_PX}×{AVATAR_SIZE_PX}.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="px-3 py-1.5 rounded-lg bg-accent text-dark text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Choose photo'}
        </button>
        {preview && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(null)}
            className="px-3 py-1.5 rounded-lg border border-dark-border text-sm text-gray-400 hover:text-kunai disabled:opacity-50"
          >
            Remove
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="hidden"
          aria-label="Choose a profile picture"
        />
      </div>

      <form onSubmit={handleLink} className="flex gap-2">
        <input
          type="url"
          value={linkDraft}
          onChange={(e) => setLinkDraft(e.target.value)}
          placeholder="…or paste an image URL"
          className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-dark-card border border-dark-border text-white text-sm"
        />
        <button
          type="submit"
          disabled={busy || !isSafeAvatarUrl(linkDraft)}
          className="px-3 py-1.5 rounded-lg border border-accent text-accent text-sm disabled:opacity-40"
        >
          Use link
        </button>
      </form>

      {error && <p className="text-xs text-kunai">{error}</p>}
      {saved && !error && <p className="text-xs text-leaf">✓ Saved.</p>}
    </div>
  )
}

export default AvatarPicker
