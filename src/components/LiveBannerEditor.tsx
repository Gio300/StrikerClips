import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Link2, Sparkles, Trash2 } from 'lucide-react'
import {
  fileToLiveBannerDataUrl,
  makeTkoLiveBannerDataUrl,
  normalizeLiveBannerUrl,
} from '@/lib/liveBanner'

type Props = {
  value: string
  onChange: (value: string) => void | Promise<void>
  title?: string | null
  teamA?: string | null
  teamB?: string | null
  compact?: boolean
}

export function LiveBannerEditor({ value, onChange, title, teamA, teamB, compact = false }: Props) {
  const picker = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [linkDraft, setLinkDraft] = useState(/^https:\/\//i.test(value) ? value : '')
  const preview = normalizeLiveBannerUrl(value)

  useEffect(() => {
    if (/^https:\/\//i.test(value)) setLinkDraft(value)
  }, [value])

  async function commit(next: string) {
    setError('')
    setBusy(true)
    try {
      await onChange(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The banner could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return
    setError('')
    setBusy(true)
    try {
      await onChange(await fileToLiveBannerDataUrl(file))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The banner could not be prepared.')
    } finally {
      if (picker.current) picker.current.value = ''
      setBusy(false)
    }
  }

  async function createBanner() {
    setError('')
    setBusy(true)
    try {
      await onChange(await makeTkoLiveBannerDataUrl({ title, teamA, teamB }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The TKO banner could not be created.')
    } finally {
      setBusy(false)
    }
  }

  function useLink() {
    const normalized = normalizeLiveBannerUrl(linkDraft)
    if (!normalized || !/^https:\/\//i.test(normalized)) {
      setError('Paste a secure https:// image link.')
      return
    }
    void commit(normalized)
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="relative aspect-video overflow-hidden rounded-lg border border-dark-border bg-dark">
        {preview ? (
          <img src={preview} alt="Current stream banner" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center bg-[linear-gradient(110deg,#07181d,#11121a_52%,#2a0d08)] text-center">
            <div>
              <p className="text-sm font-black text-white">TKO<span className="text-kunai">.cam</span></p>
              <p className="mt-1 text-xs text-gray-400">Your stream banner</p>
            </div>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/65 text-sm font-semibold text-white">
            Preparing banner...
          </div>
        )}
      </div>

      <input
        ref={picker}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => { void upload(event.target.files?.[0]) }}
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => picker.current?.click()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-dark disabled:opacity-50"
        >
          <ImagePlus className="h-4 w-4" /> Upload
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => { void createBanner() }}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-kunai/60 bg-kunai/10 px-3 py-2 text-sm font-bold text-kunai disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" /> Make banner
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <details className="min-w-0 flex-1">
          <summary className="cursor-pointer list-none text-xs text-gray-400 hover:text-accent">
            <span className="inline-flex items-center gap-1"><Link2 className="h-3.5 w-3.5" /> Use image link</span>
          </summary>
          <div className="mt-2 flex gap-2">
            <input
              type="url"
              value={linkDraft}
              onChange={(event) => setLinkDraft(event.target.value)}
              placeholder="https://..."
              className="min-w-0 flex-1 rounded-lg border border-dark-border bg-dark px-3 py-2 text-sm text-white outline-none focus:border-accent"
            />
            <button type="button" onClick={useLink} disabled={busy} className="rounded-lg border border-accent/50 px-3 text-xs font-semibold text-accent disabled:opacity-50">
              Use
            </button>
          </div>
        </details>
        {preview && (
          <button
            type="button"
            disabled={busy}
            onClick={() => { void commit('') }}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-kunai disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </button>
        )}
      </div>
      {error && <p className="text-xs text-kunai">{error}</p>}
    </div>
  )
}
