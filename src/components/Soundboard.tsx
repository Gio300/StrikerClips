import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { SoundboardPad } from '@/types/database'

/**
 * Soundboard — six-pad sound trigger that plays mp3s locally so OBS captures
 * them through Desktop Audio. Files live in Supabase Storage under the
 * `soundboard` bucket; metadata lives in `public.soundboard_pads`.
 *
 * Hotkeys 1–6 map to pads 0–5 when the panel is focused or any non-input
 * element has focus on /live (the panel is mounted there).
 */

const STORAGE_BUCKET = 'soundboard'
const PAD_COUNT = 6

export function Soundboard() {
  const { user } = useAuth()
  const [pads, setPads] = useState<SoundboardPad[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const fileInputs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    if (!user) {
      setPads([])
      return
    }
    let cancelled = false
    supabase
      .from('soundboard_pads')
      .select('*')
      .eq('user_id', user.id)
      .order('position', { ascending: true })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) setError(err.message)
        else setPads((data ?? []) as SoundboardPad[])
      })
    return () => {
      cancelled = true
    }
  }, [user])

  // Hotkeys 1-6 trigger pads 0-5 unless typing in an input.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const idx = '123456'.indexOf(e.key)
      if (idx === -1) return
      const pad = pads.find((p) => p.position === idx)
      if (pad) playPad(pad)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pads])

  function publicUrlFor(path: string): string {
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
    return data.publicUrl
  }

  async function playPad(pad: SoundboardPad) {
    setError(null)
    if (!audioRef.current) audioRef.current = new Audio()
    const audio = audioRef.current
    const url = publicUrlFor(pad.storage_path)
    try {
      audio.pause()
      audio.src = url
      audio.currentTime = 0
      await audio.play()
      setHint(`▶ ${pad.label}`)
      window.setTimeout(() => setHint(null), 1500)
    } catch (e) {
      setError(`Playback failed: ${(e as Error).message}`)
    }
  }

  async function handleFile(position: number, file: File) {
    if (!user) return
    setBusy(true)
    setError(null)
    const safeName = file.name.replace(/[^\w.\-]+/g, '_')
    const path = `${user.id}/${position}-${Date.now()}-${safeName}`

    const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'audio/mpeg',
    })
    if (upErr) {
      // If the bucket doesn't exist yet, surface a helpful message.
      const msg = upErr.message
      if (msg.toLowerCase().includes('bucket') && msg.toLowerCase().includes('not found')) {
        setError(
          'Soundboard bucket missing — create a public bucket named "soundboard" in Supabase Storage, then retry.',
        )
      } else {
        setError(msg)
      }
      setBusy(false)
      return
    }

    const existing = pads.find((p) => p.position === position)
    if (existing) {
      const { data: updated } = await supabase
        .from('soundboard_pads')
        .update({
          storage_path: path,
          label: file.name.replace(/\.[^.]+$/, ''),
        })
        .eq('id', existing.id)
        .select()
        .single()
      if (updated) {
        setPads((prev) => prev.map((p) => (p.id === existing.id ? (updated as SoundboardPad) : p)))
      }
      // Best-effort cleanup of the previous file.
      void supabase.storage.from(STORAGE_BUCKET).remove([existing.storage_path])
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('soundboard_pads')
        .insert({
          user_id: user.id,
          label: file.name.replace(/\.[^.]+$/, ''),
          storage_path: path,
          hotkey: String(position + 1),
          position,
        })
        .select()
        .single()
      if (insErr) {
        setError(insErr.message)
      } else if (inserted) {
        setPads((prev) => [...prev, inserted as SoundboardPad].sort((a, b) => a.position - b.position))
      }
    }
    setBusy(false)
  }

  async function clearPad(pad: SoundboardPad) {
    if (!user) return
    setBusy(true)
    void supabase.storage.from(STORAGE_BUCKET).remove([pad.storage_path])
    await supabase.from('soundboard_pads').delete().eq('id', pad.id)
    setPads((prev) => prev.filter((p) => p.id !== pad.id))
    setBusy(false)
  }

  async function rename(pad: SoundboardPad, label: string) {
    if (!user) return
    setPads((prev) => prev.map((p) => (p.id === pad.id ? { ...p, label } : p)))
    await supabase.from('soundboard_pads').update({ label }).eq('id', pad.id)
  }

  if (!user) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark-card p-5 text-sm text-gray-400">
        Log in to use the soundboard.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-5">
      <div className="flex items-baseline justify-between mb-1 gap-2 flex-wrap">
        <h3 className="font-semibold">Soundboard</h3>
        <span className="text-[11px] text-gray-500">
          Press 1–6 to fire pads. Audio plays through Desktop Audio so OBS picks it up.
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Drop short mp3 / wav clips here. Files are stored privately in your Supabase project.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Array.from({ length: PAD_COUNT }).map((_, i) => {
          const pad = pads.find((p) => p.position === i)
          return (
            <div
              key={i}
              className="rounded-lg border border-dark-border bg-dark p-3 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Pad {i + 1}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-dark-elevated text-[10px] font-mono text-gray-400">
                  {i + 1}
                </kbd>
              </div>
              {pad ? (
                <>
                  <input
                    type="text"
                    value={pad.label}
                    onChange={(e) => rename(pad, e.target.value)}
                    className="px-2 py-1 rounded bg-dark-elevated border border-dark-border text-sm w-full"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => playPad(pad)}
                      className="flex-1 px-2 py-2 rounded bg-accent/15 border border-accent/40 text-accent text-sm font-medium hover:bg-accent/25"
                    >
                      ▶ Play
                    </button>
                    <button
                      type="button"
                      onClick={() => clearPad(pad)}
                      className="px-2 py-2 rounded border border-dark-border text-gray-400 text-xs hover:border-kunai/50 hover:text-kunai"
                    >
                      ✕
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileInputs.current[i]?.click()}
                    className="flex-1 px-2 py-3 rounded border border-dashed border-dark-border text-gray-400 text-sm hover:border-accent/50 hover:text-accent disabled:opacity-40"
                  >
                    + Add sound
                  </button>
                  <input
                    ref={(el) => (fileInputs.current[i] = el)}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleFile(i, f)
                      e.target.value = ''
                    }}
                  />
                </>
              )}
            </div>
          )
        })}
      </div>
      {hint && <p className="mt-3 text-xs text-accent">{hint}</p>}
      {error && <p className="mt-3 text-xs text-kunai">{error}</p>}
    </div>
  )
}
